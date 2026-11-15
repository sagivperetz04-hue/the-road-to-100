#!/usr/bin/env python3
"""On-device test: drives the real app on a phone or emulator over adb + Chrome DevTools.

Needs a DEBUG build (tools/build.sh --debuggable) installed and running: only debug builds open their WebView
to DevTools. Release builds are unaffected.

    tools/build.sh --debuggable
    adb install -r build/outputs/madregot-v<ver>-<code>-debug.apk
    python3 tests/device_test.py [--adb path/to/adb] [--shots build/device-shots]

Checks, on the device's own WebView: ground contact at the start / on a stair / after a fall, a fall resets the
streak, 20 correct answers reach the summit screen, progress is saved, no console errors. Screenshots come from
`adb exec-out screencap`, so they show the real device rendering.
"""
import argparse, asyncio, os, re, shutil, subprocess, sys

from playwright.async_api import async_playwright

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import e2e_test as e2e  # noqa: E402  (shared helpers: Session, ground_report, check_feet, check)

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
APP_ID = "com.plap.studystairs"
PORT = 9333


def adb_path(given):
    if given:
        return given
    home = os.environ.get("ANDROID_HOME") or os.environ.get("ANDROID_SDK_ROOT") or ""
    for c in (os.path.join(home, "platform-tools", "adb.exe"), os.path.join(home, "platform-tools", "adb"), shutil.which("adb") or ""):
        if c and os.path.exists(c):
            return c
    sys.exit("adb not found: pass --adb or set ANDROID_HOME")


def run(adb, *args, binary=False):
    r = subprocess.run([adb, *args], capture_output=True, env=dict(os.environ, MSYS_NO_PATHCONV="1"))
    return r.stdout if binary else r.stdout.decode("utf-8", "replace")


def devtools_socket(adb):
    pid = run(adb, "shell", "pidof", APP_ID).strip()
    socks = set(re.findall(r"webview_devtools_remote_\d+", run(adb, "shell", "cat", "/proc/net/unix")))
    want = f"webview_devtools_remote_{pid}"
    if want in socks:
        return want
    sys.exit(f"no DevTools socket for {APP_ID} (pid '{pid}'). Is a --debuggable build installed and running?")


async def main(adb, shots):
    os.makedirs(shots, exist_ok=True)
    def screencap(name):
        with open(os.path.join(shots, name + ".png"), "wb") as f:
            f.write(run(adb, "exec-out", "screencap", "-p", binary=True))

    run(adb, "shell", "am", "force-stop", APP_ID)
    run(adb, "shell", "monkey", "-p", APP_ID, "-c", "android.intent.category.LAUNCHER", "1")
    for _ in range(40):
        await asyncio.sleep(0.5)
        if run(adb, "shell", "pidof", APP_ID).strip():
            break
    await asyncio.sleep(3)
    sock = devtools_socket(adb)
    run(adb, "forward", f"tcp:{PORT}", f"localabstract:{sock}")
    print(f"connected to {sock}")
    async with async_playwright() as p:
        browser = await p.chromium.connect_over_cdp(f"http://127.0.0.1:{PORT}")
        page = next(pg for c in browser.contexts for pg in c.pages if "appassets" in pg.url)
        await page.wait_for_selector(".course-row", timeout=20000)
        # correct answers, read from the app's own bundled data
        answers = await page.evaluate("""async () => {
          const out = {}, man = await (await fetch('data/courses.json')).json();
          for (const c of man) for (const f of ['questions-real.json', 'questions-generated.json']) {
            const r = await fetch(`data/${c.folder}/${f}`); if (!r.ok) continue;
            for (const q of await r.json()) out[q.id] = q.options[q.answer];
          }
          return out; }""")
        print(f"{len(answers)} questions on the device")
        s = e2e.Session(page, answers)
        s.problems.clear()
        ua = await page.evaluate("navigator.userAgent")
        e2e.check("Android" in ua and "wv" in ua, f"running in the device's Android WebView ({ua.split('Chrome/')[-1].split(' ')[0]})")
        best_before = await page.locator(".best-pill").all_inner_texts()
        screencap("1-courses")

        cid = await page.get_attribute(".course-row >> nth=0", "data-id")
        await s.open_course(cid)
        if not await page.evaluate("() => document.querySelector('[data-all] .switch').classList.contains('on')"):
            await page.click("[data-all]")
        await page.click("[data-go]"); await s.wait_screen("source")
        await page.click('.src-card[data-src="generated"]'); await s.wait_screen("game")
        await page.wait_for_selector("[data-card][data-qid] .opt:not([disabled])")
        await page.wait_for_timeout(600)
        g = await e2e.ground_report(page)
        e2e.check_feet(g, 0, "device: game start")
        e2e.check(g["worst_block_gap"] <= 0.5, f"device: stair blocks rest on the grass (worst gap {g['worst_block_gap']:.2f})")
        screencap("2-start")
        await s.answer(True); await page.wait_for_timeout(900)
        e2e.check_feet(await e2e.ground_report(page), 1, "device: after a correct answer")
        screencap("3-climb")
        await s.next(); await s.answer(True); await page.wait_for_timeout(900); await s.next()
        await s.answer(False)
        await page.wait_for_timeout(350); screencap("4-falling")
        await page.wait_for_timeout(1600)
        e2e.check(await page.inner_text("[data-num]") == "0", "device: a wrong answer resets the streak")
        e2e.check_feet(await e2e.ground_report(page), 0, "device: after a fall")
        screencap("5-after-fall")
        await s.next()
        await s.climb_to_summit("device")
        await page.wait_for_timeout(1500)
        e2e.check_feet(await e2e.ground_report(page), e2e.GOAL, "device: summit")
        screencap("6-summit")
        m = await page.evaluate("Sound.musicState()")
        e2e.check(m["scene"] == "summit", f"device: music scene follows the summit ({m})")
        await page.click("[data-menu]"); await s.wait_screen("source")
        await page.evaluate("appBack()"); await s.wait_screen("topics")
        await page.evaluate("appBack()"); await s.wait_screen("courses")
        best_after = await page.locator(".best-pill").all_inner_texts()
        e2e.check(any("20" in b for b in best_after), f"device: best streak saved ({best_before} -> {best_after})")
        screencap("7-courses-after")
        # every theme on the real device: menu + game screenshots, ground contact
        before = await page.evaluate("Theme.setting")
        for theme in ("light", "dark", "pink"):
            await page.evaluate(f"Theme.set('{theme}')")
            e2e.check(await page.get_attribute("html", "data-theme") == theme, f"device: theme {theme} applied")
            await page.wait_for_timeout(500); screencap(f"8-{theme}-courses")
            await s.open_course(cid); await page.click("[data-go]"); await s.wait_screen("source")
            await page.click('.src-card[data-src="generated"]'); await s.wait_screen("game")
            await page.wait_for_selector("[data-card][data-qid] .opt:not([disabled])"); await page.wait_for_timeout(700)
            e2e.check_feet(await e2e.ground_report(page), 0, f"device {theme}: game start")
            await s.answer(True); await page.wait_for_timeout(300); screencap(f"9-{theme}-game")
            await page.click('[data-act="leave"]'); await page.wait_for_selector(".dim-layer .alert")
            await page.click("text=צאי"); await s.wait_screen("source")
            await page.evaluate("appBack()"); await s.wait_screen("topics")
            await page.evaluate("appBack()"); await s.wait_screen("courses")
        await page.evaluate(f"Theme.set({before!r})")
        e2e.check(not s.problems, "device: no console errors" + ("" if not s.problems else ": " + "; ".join(s.problems[:5])))
        await browser.close()
    run(adb, "forward", "--remove", f"tcp:{PORT}")
    print(f"\n{'PASSED' if not e2e.FAILS else 'FAILED'}: {len(e2e.FAILS)} failure(s)   screenshots: {shots}")
    return 0 if not e2e.FAILS else 1


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--adb")
    ap.add_argument("--shots", default=os.path.join(ROOT, "build", "device-shots"))
    a = ap.parse_args()
    sys.exit(asyncio.run(main(adb_path(a.adb), a.shots)))
