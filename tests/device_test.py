#!/usr/bin/env python3
"""On-device test: drives the real app on a phone or emulator over adb + Chrome DevTools.

Needs a DEBUG build (tools/build.sh --debuggable) installed and running: only debug builds open their WebView
to DevTools. Release builds are unaffected.

    tools/build.sh --debuggable
    adb install -r build/outputs/the-road-to-100-v<ver>-<code>-debug.apk
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
        await page.wait_for_selector(".mode-card, .course-row", timeout=20000)
        await e2e.enter(page)
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
        await page.evaluate("Store.sound = true; Store.music = true; Sound.refresh()")   # earlier runs may have left them off
        # background songs: when one ends the next starts (played fast so it ends quickly)
        await page.wait_for_function("Sound.musicState().playing", timeout=15000)
        first = (await page.evaluate("Sound.musicState()"))["file"]
        await page.evaluate("Sound.debugSpeed(16)")
        try:
            await page.wait_for_function(f"(() => {{ const m = Sound.musicState(); return m.playing && m.file && m.file !== {first!r}; }})()", timeout=45000)
            e2e.check(True, f"device: when a song ends the next one plays ({first} -> {(await page.evaluate('Sound.musicState()'))['file']})")
        except Exception:
            e2e.check(False, f"device: when a song ends the next one plays (stuck: {await page.evaluate('Sound.musicState()')})")
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
        bgm = await page.evaluate("Sound.musicState()")
        e2e.check(bgm["scene"] == "game" and bgm["playing"] and bool(bgm["file"]), f"device: background music plays in the game ({bgm['file']}, {bgm['time']}s)")
        await s.answer(False)
        fx = await page.evaluate("Sound.sfxState()")
        e2e.check(bool(fx) and fx["file"] == "sfx/fahh.mp3", f"device: a wrong answer plays Fahh ({fx})")
        await page.wait_for_timeout(350); screencap("4-falling")
        await page.wait_for_timeout(1600)
        e2e.check(await page.inner_text("[data-num]") == "0", "device: a wrong answer resets the streak")
        e2e.check_feet(await e2e.ground_report(page), 0, "device: after a fall")
        screencap("5-after-fall")
        await s.next()
        # the last stair: hell mode, the boosted final track (even with sound off) and the vibrator
        await page.evaluate("Store.sound = false")
        for _ in range(e2e.GOAL - 1):
            await s.answer(True); await s.next()
        await page.wait_for_selector(".game.rage .rage-fx", timeout=4000)
        e2e.check(True, "device: stair 19 turns on hell mode")
        try:
            await page.wait_for_function("(() => { const f = Sound.finalState(); return f.on && f.playing; })()", timeout=8000)
            e2e.check(True, "device: the final track plays at stair 19 with sound off")
        except Exception:
            e2e.check(False, f"device: the final track plays at stair 19 with sound off ({await page.evaluate('Sound.finalState()')})")
        f = await page.evaluate("Sound.finalState()")
        e2e.check(f["boosted"] and abs(f["gain"] - 3) < 1e-6 and f["file"] == "music/final-step.mp3", f"device: final track boosted to 300% through Web Audio ({f})")
        vib = run(adb, "shell", "dumpsys", "vibrator_manager")
        e2e.check(APP_ID in vib, "device: the app drives the vibrator on stair 19")
        await page.wait_for_timeout(500); screencap("6-hell-mode")
        await page.evaluate("Store.sound = true")
        await s.answer(True)
        await page.wait_for_selector(".summit h2", timeout=8000)
        e2e.check(not await page.locator(".rage-fx").count() and not (await page.evaluate("Sound.finalState()"))["on"], "device: the summit ends hell mode")
        await page.wait_for_timeout(1500)
        e2e.check_feet(await e2e.ground_report(page), e2e.GOAL, "device: summit")
        screencap("7-summit")
        m = await page.evaluate("Sound.musicState()")
        e2e.check(m["scene"] == "summit", f"device: music scene follows the summit ({m})")
        e2e.check(m["played"] == "summit" or (m["file"] == "music/summit-6am.mp3" and m["playing"]), f"device: the summit sound plays ({m})")
        e2e.check(await page.locator(".summit canvas").count() == 1, "device: confetti show on the summit")
        await page.click("[data-menu]"); await s.wait_screen("source")
        await page.evaluate("appBack()"); await s.wait_screen("topics")
        await page.evaluate("appBack()"); await s.wait_screen("courses")
        best_after = await page.locator(".best-pill").all_inner_texts()
        e2e.check(any("20" in b for b in best_after), f"device: best streak saved ({best_before} -> {best_after})")
        screencap("8-courses-after")
        # every theme on the real device: menu + game screenshots, ground contact
        before = await page.evaluate("Theme.setting")
        for theme in ("light", "dark", "pink", "gallery"):
            await page.evaluate(f"Theme.set('{theme}')")
            e2e.check(await page.get_attribute("html", "data-theme") == theme, f"device: theme {theme} applied")
            await page.wait_for_timeout(500); screencap(f"9-{theme}-courses")
            await s.open_course(cid); await page.click("[data-go]"); await s.wait_screen("source")
            await page.click('.src-card[data-src="generated"]'); await s.wait_screen("game")
            await page.wait_for_selector("[data-card][data-qid] .opt:not([disabled])"); await page.wait_for_timeout(700)
            e2e.check_feet(await e2e.ground_report(page), 0, f"device {theme}: game start")
            await s.answer(True); await page.wait_for_timeout(300); screencap(f"10-{theme}-game")
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
