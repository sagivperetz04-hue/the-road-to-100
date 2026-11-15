#!/usr/bin/env python3
"""End-to-end test of the web app (the same files that ship in the APK).

- Copies app/assets to a temp dir and adds tests/fixtures/fixture-course with ONE manifest line
  (proves "new course = folder + manifest line"; the fixture has real + generated questions).
- Plays every source (real / generated / mixed) to the summit at 393x851, plus each bundled course.
- Checks hardware-back behaviour, the leave-confirmation, the disabled "real" card and the topic toggles.
- Fails on any console error/warning, page error or failed request.
- Saves screenshots of every screen at 360x640 and 393x851 and checks for horizontal overflow / clipped text.

Usage: python3 tests/e2e_test.py [--chrome /usr/bin/google-chrome] [--shots out_dir]
Requires: pip install playwright  (uses an installed Chrome/Chromium; no browser download needed)
"""
import argparse, asyncio, functools, http.server, json, math, os, shutil, socketserver, struct, sys, tempfile, threading, wave

from playwright.async_api import async_playwright

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
ASSETS = os.path.join(ROOT, "app", "assets")
FIXTURE = os.path.join(ROOT, "tests", "fixtures", "fixture-course")
SUMMIT_TITLE = "ציציפלצת האולטימטיבית"
GOAL = 20

FAILS = []
def check(cond, msg):
    print(("  ok   " if cond else "  FAIL ") + msg)
    if not cond:
        FAILS.append(msg)


def make_site():
    site = tempfile.mkdtemp(prefix="stairs-site-")
    shutil.copytree(ASSETS, site, dirs_exist_ok=True)
    shutil.copytree(FIXTURE, os.path.join(site, "data", "fixture-course"))
    manifest_path = os.path.join(site, "data", "courses.json")
    manifest = json.load(open(manifest_path, encoding="utf-8"))
    manifest.append({"id": "fixture-course", "code": "0000000001", "name": "קורס בדיקה", "folder": "fixture-course"})
    json.dump(manifest, open(manifest_path, "w", encoding="utf-8"), ensure_ascii=False)
    answers = {}
    for entry in manifest:
        for f in ("questions-real.json", "questions-generated.json"):
            for q in json.load(open(os.path.join(site, "data", entry["folder"], f), encoding="utf-8")):
                answers[q["id"]] = q["options"][q["answer"]]
    return site, manifest, answers


def tone_wav(path, freq, seconds=2.0, rate=8000):
    """A short sine tone: stands in for real music files in the music test."""
    with wave.open(path, "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(rate)
        w.writeframes(b"".join(struct.pack("<h", int(6000 * math.sin(2 * math.pi * freq * i / rate))) for i in range(int(rate * seconds))))


def make_music_site(site):
    """A copy of the site whose audio manifest uses the new {clips, music} format with generated tracks."""
    msite = tempfile.mkdtemp(prefix="stairs-music-")
    shutil.copytree(site, msite, dirs_exist_ok=True)
    adir = os.path.join(msite, "audio")
    for name, f in (("menu.wav", 330), ("game1.wav", 440), ("game2.wav", 494), ("summit.wav", 660), ("clip.wav", 880)):
        tone_wav(os.path.join(adir, name), f)
    json.dump({"clips": [{"file": "clip.wav", "title": "Test clip", "artist": "e2e"}],
               "music": {"menu": [{"file": "menu.wav"}], "game": [{"file": "game1.wav"}, {"file": "game2.wav", "volume": 0.5}],
                         "summit": [{"file": "summit.wav"}]}},
              open(os.path.join(adir, "manifest.json"), "w"))
    return msite


def serve(site):
    class Quiet(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *a):
            pass
    handler = functools.partial(Quiet, directory=site)
    httpd = socketserver.ThreadingTCPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd, f"http://127.0.0.1:{httpd.server_address[1]}/index.html"


class Session:
    def __init__(self, page, answers):
        self.page, self.answers, self.problems = page, answers, []
        page.on("console", lambda m: self.problems.append(f"console {m.type}: {m.text}") if m.type in ("error", "warning") else None)
        page.on("pageerror", lambda e: self.problems.append(f"pageerror: {e}"))
        page.on("requestfailed", lambda r: self.problems.append(f"request failed: {r.url}"))
        page.on("response", lambda r: self.problems.append(f"HTTP {r.status}: {r.url}") if r.status >= 400 else None)

    async def screen(self):
        return await self.page.evaluate("() => { const s = [...document.querySelectorAll('#stack > .screen')].pop(); return s && s.dataset.screen; }")

    async def wait_screen(self, name):
        await self.page.wait_for_function(f"() => {{ const s = [...document.querySelectorAll('#stack > .screen')].pop(); return s && s.dataset.screen === '{name}' && !s.classList.contains('is-enter'); }}")
        await self.page.wait_for_timeout(360)

    async def open_course(self, cid):
        await self.page.click(f'.course-row[data-id="{cid}"]')
        await self.wait_screen("topics")

    async def answer(self, correct=True):
        page = self.page
        await page.wait_for_selector("[data-card][data-qid] .opt:not([disabled])")
        qid = await page.get_attribute("[data-card]", "data-qid")
        right = self.answers[qid]
        texts = await page.locator("[data-card] .opt .opt-text").all_inner_texts()
        idx = texts.index(right) if correct else next(i for i, t in enumerate(texts) if t != right)
        await page.locator("[data-card] .opt").nth(idx).click()
        return qid

    async def next(self):
        await self.page.wait_for_selector("[data-foot].show")
        await self.page.click("[data-next]")

    async def climb_to_summit(self, label):
        page = self.page
        if await page.locator(".dim-layer .alert").count():
            await page.click(".dim-layer .alert-actions button")
        seen = []
        for i in range(GOAL):
            qid = await self.answer(True)
            if seen and seen[-1] == qid:
                check(False, f"{label}: question {qid} repeated back to back")
            seen.append(qid)
            if i < GOAL - 1:
                await self.next()
        await page.wait_for_selector(".summit h2", timeout=8000)
        title = await page.inner_text(".summit h2")
        check(title.strip() == SUMMIT_TITLE, f"{label}: reached the summit screen ('{title.strip()}')")
        return seen


async def ground_report(page):
    """Scene geometry in SVG units: how far the creature's feet are above the grass, and how far the step blocks
    end from the grass line. Feet on the ground at step N -> feet_gap == N * 24 (one stair is 24 units)."""
    return await page.evaluate("""() => {
      const svg = document.querySelector('[data-scene] svg');
      const ground = svg.querySelector('.ground').getBoundingClientRect().top;
      const k = svg.getScreenCTM().d;                      // px per SVG unit (vertical)
      const feet = Math.max(...[...svg.querySelectorAll('.hero-feet .foot')].map(f => f.getBoundingClientRect().bottom));
      const blocks = [...svg.querySelectorAll('.step-block')].map(b => Math.abs(b.getBoundingClientRect().bottom - ground) / k);
      return { feet_gap: (ground - feet) / k, worst_block_gap: Math.max(...blocks), blocks: blocks.length };
    }""")


async def explain_clear(page, label):
    """After answering, the whole explanation (down to its "מקור" line) must sit above the "next" bar."""
    await page.wait_for_timeout(200)
    r = await page.evaluate("""() => {
      const ex = document.querySelector('[data-card] .explain'), foot = document.querySelector('[data-foot]');
      if (!ex || !foot) return null;
      return { ex: ex.getBoundingClientRect().bottom, foot: foot.getBoundingClientRect().top };
    }""")
    check(r is not None and r["ex"] <= r["foot"] + 1, f"{label}: explanation fully visible above the next button" + ("" if r is None else f" ({r['ex']:.0f} <= {r['foot']:.0f})"))


def check_feet(g, step, label):
    want = step * 24
    check(abs(g["feet_gap"] - want) <= 0.6, f"{label}: feet {'on the grass' if step == 0 else f'on stair {step}'} (gap {g['feet_gap']:.2f}, want {want})")


async def shot_page(page, shots, name):
    await page.screenshot(path=os.path.join(shots, f"{name}.png"))
    issues = await overflow_report(page)
    check(not issues, f"{name}: no overflow / clipped text" + ("" if not issues else f" -> {issues[:4]}"))


async def overflow_report(page):
    return await page.evaluate("""() => {
      const vw = innerWidth, issues = [];
      if (document.documentElement.scrollWidth > vw + 1) issues.push('document scrolls horizontally');
      const scr = [...document.querySelectorAll('#stack > .screen')].pop();
      const roots = [scr, ...document.querySelectorAll('#overlay-root > *')].filter(Boolean);
      for (const root of roots) {
        for (const sc of root.querySelectorAll('.scroller, .game-body')) if (sc.scrollWidth > sc.clientWidth + 1) issues.push('horizontal scroll in ' + sc.className);
        for (const el of root.querySelectorAll('*')) {
          if (el.closest('svg') || el.closest('.island')) continue;
          const r = el.getBoundingClientRect();
          if (!r.width || !r.height) continue;
          const st = getComputedStyle(el);
          if (st.visibility === 'hidden' || st.position === 'fixed' && el.tagName === 'CANVAS') continue;
          const hasText = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim());
          if (hasText && (r.right > vw + 1 || r.left < -1)) issues.push('off-screen text: ' + el.textContent.trim().slice(0, 40));
          if (hasText && (st.overflow === 'hidden' || st.textOverflow === 'ellipsis') && el.scrollWidth > el.clientWidth + 1) issues.push('clipped text: ' + el.textContent.trim().slice(0, 40));
        }
      }
      return issues;
    }""")


async def run(chrome, shots):
    site, manifest, answers = make_site()
    httpd, url = serve(site)
    os.makedirs(shots, exist_ok=True)
    async with async_playwright() as p:
        browser = await p.chromium.launch(executable_path=chrome, args=["--no-sandbox", "--autoplay-policy=no-user-gesture-required"])

        # ---------------------------------------------------------------- 1. full flows at 393x851
        print("\n[393x851] flows")
        ctx = await browser.new_context(viewport={"width": 393, "height": 851}, device_scale_factor=2, has_touch=True, locale="he-IL")
        page = await ctx.new_page()
        s = Session(page, answers)
        await page.goto(url)
        await page.wait_for_selector(".course-row")
        names = await page.locator(".course-row .row-title").all_inner_texts()
        check(len(names) == len(manifest), f"course list shows {len(names)} courses (manifest has {len(manifest)}), incl. the fixture added by one manifest line")
        check(await page.evaluate("appBack()") == "exit", "hardware Back on the first screen exits the app")

        # topics toggle logic
        await s.open_course("fixture-course")
        sel = lambda: page.evaluate("() => [...document.querySelectorAll('.topic-row.selected')].map(r => r.dataset.tid)")
        sw_on = lambda: page.evaluate("() => document.querySelector('[data-all] .switch').classList.contains('on')")
        check(await sw_on() and len(await sel()) == 2, "all topics preselected, 'כל הנושאים' on")
        await page.click('.topic-row[data-tid="beta"]')
        check(await sel() == ["beta"] and not await sw_on(), "picking one topic turns 'כל הנושאים' off and keeps only that topic")
        await page.click('.topic-row[data-tid="beta"]')
        check(await sel() == [] and await page.is_disabled("[data-go]"), "with no topic selected, Continue is disabled")
        await page.click('.topic-row[data-tid="alpha"]'); await page.click('.topic-row[data-tid="beta"]')
        check(await sw_on(), "selecting every topic turns 'כל הנושאים' back on")
        check(await page.evaluate("appBack()") == "handled", "Back on topics is handled")
        await s.wait_screen("courses")

        # each source of the fixture to the summit (real has 12 questions -> pool note + repeats)
        for source in ("real", "generated", "mixed"):
            await s.open_course("fixture-course")
            await page.click("[data-go]"); await s.wait_screen("source")
            await page.click(f'.src-card[data-src="{source}"]'); await s.wait_screen("game")
            if source == "real":
                await page.wait_for_selector(".dim-layer .alert")
                msg = await page.inner_text(".dim-layer .alert-msg")
                check(msg == "יש רק 12 שאלות. אחרי שייגמרו הן יחזרו בסדר אחר.", f"pool < 20 shows the note: {msg}")
            badge_expect = {"real": "אמיתית", "generated": "מחוללת"}
            seen = await s.climb_to_summit(f"fixture/{source}")
            if source == "real":
                check(len(seen) == GOAL and len(set(seen)) == 12, f"real pool of 12 repeats after running out ({len(set(seen))} distinct in {len(seen)})")
            if source == "mixed":
                await page.click("[data-again]")
                await page.wait_for_selector("[data-card][data-qid] .opt:not([disabled])")
                kinds = set()
                for _ in range(12):
                    kinds.add((await page.inner_text("[data-card] .badge")).strip())
                    await s.answer(True); await s.next()
                check(kinds == {"אמיתית", "מחוללת"}, f"mixed shows both badges: {sorted(kinds)}")
                await page.wait_for_selector("[data-card][data-qid] .opt:not([disabled])")
            else:
                await page.click("[data-menu]")
                await s.wait_screen("source")
                chips = await page.inner_text(f'.src-card[data-src="{source}"] .src-meta')
                check("שיא 20" in chips and "פסגה אחת" in chips, f"{source} card shows best 20 and one summit")
                await page.evaluate("appBack()"); await s.wait_screen("topics")
                await page.evaluate("appBack()"); await s.wait_screen("courses")

        # wrong answer resets, and leaving mid-climb asks first (we are still in the mixed game)
        await s.answer(False)
        await page.wait_for_selector(".explain.bad")
        check(await page.inner_text("[data-num]") == "0", "a wrong answer resets the streak to 0")
        await page.wait_for_timeout(1700)   # the animated fall from 12 stairs up (about 1 s)
        check_feet(await ground_report(page), 0, "after an animated fall")
        await s.next(); await s.answer(True); await s.next(); await s.answer(True)
        check(await page.inner_text("[data-num]") == "2", "streak counter shows 2 after two correct answers")
        await s.next()
        check(await page.evaluate("appBack()") == "handled", "Back in a game is handled")
        await page.wait_for_selector(".dim-layer .alert")
        t = await page.inner_text(".alert-title")
        btns = await page.locator(".alert-actions button").all_inner_texts()
        check(t == "לצאת? הרצף הנוכחי יאבד" and btns == ["צאי", "המשך לשחק"], f"leave dialog: '{t}' {btns}")
        await page.click("text=המשך לשחק")
        check(await s.screen() == "game", "'המשך לשחק' keeps playing")
        await page.evaluate("appBack()"); await page.wait_for_selector(".dim-layer .alert")
        check(await page.evaluate("appBack()") == "handled", "Back while the dialog is open closes it (= keep playing)")
        check(await page.locator(".dim-layer").count() == 0 and await s.screen() == "game", "dialog closed, still in the game")
        await page.click('[data-act="leave"]'); await page.wait_for_selector(".dim-layer .alert")
        await page.click("text=צאי"); await s.wait_screen("source")
        check(True, "'צאי' leaves to the source screen")
        await page.evaluate("appBack()"); await s.wait_screen("topics")
        await page.evaluate("appBack()"); await s.wait_screen("courses")

        # bundled courses: generated questions, all topics, to the summit
        for entry in manifest:
            if entry["id"] == "fixture-course":
                continue
            await s.open_course(entry["id"])
            # make sure every topic is selected
            if not await page.evaluate("() => document.querySelector('[data-all] .switch').classList.contains('on')"):
                await page.click("[data-all]")
            await page.click("[data-go]"); await s.wait_screen("source")
            check(await page.is_disabled('.src-card[data-src="real"]'), f"{entry['id']}: 'real' card disabled (no real questions yet)")
            check(await page.locator('.src-card[data-src="mixed"]').count() == 0, f"{entry['id']}: no 'mixed' card when one source is empty")
            await page.click('.src-card[data-src="generated"]'); await s.wait_screen("game")
            cap = await page.inner_text("[data-card] .q-caption")
            check(cap.startswith(entry["name"]), f"{entry['id']}: caption shows course + topic ('{cap}')")
            await s.climb_to_summit(f"{entry['id']}/generated")
            await page.click("[data-menu]"); await s.wait_screen("source")
            await page.evaluate("appBack()"); await s.wait_screen("topics")
            # single topic + real -> disabled card with the exact text
            first = await page.get_attribute(".topic-row >> nth=0", "data-tid")
            await page.click(f'.topic-row[data-tid="{first}"]')
            await page.click("[data-go]"); await s.wait_screen("source")
            txt = await page.inner_text('.src-card[data-src="real"] .src-empty')
            check(txt == "אין עדיין שאלות כאלה בנושאים שבחרת", f"{entry['id']}: single topic + real shows the disabled card text")
            await page.evaluate("appBack()"); await s.wait_screen("topics")
            await page.click("[data-all]")   # restore "all topics"
            await page.evaluate("appBack()"); await s.wait_screen("courses")

        best = await page.locator(".best-pill").all_inner_texts()
        check(all("20" in b for b in best), f"course list shows the best streaks: {best}")
        # progress survives a reload
        await page.reload(); await page.wait_for_selector(".course-row")
        best2 = await page.locator(".best-pill").all_inner_texts()
        check(best2 == best, "progress survives a reload (localStorage)")
        check(not s.problems, "no console errors / warnings / failed requests" + ("" if not s.problems else ": " + "; ".join(s.problems[:5])))
        await ctx.close()

        # ---------------------------------------------------------------- 2. screenshots + layout checks
        for (w, hgt) in ((360, 640), (393, 851)):
            print(f"\n[{w}x{hgt}] screens")
            ctx = await browser.new_context(viewport={"width": w, "height": hgt}, device_scale_factor=2, has_touch=True, reduced_motion="reduce")
            page = await ctx.new_page()
            s = Session(page, answers)
            await page.goto(url); await page.wait_for_selector(".course-row")
            async def shot(name):
                await page.wait_for_timeout(250)
                path = os.path.join(shots, f"{w}x{hgt}-{name}.png")
                await page.screenshot(path=path)
                issues = await overflow_report(page)
                check(not issues, f"{name}: no overflow / clipped text" + ("" if not issues else f" -> {issues[:4]}"))
            await shot("1-courses")
            await s.open_course("arch-history-a"); await shot("2-topics")
            await page.click("[data-go]"); await s.wait_screen("source"); await shot("3-source")
            await page.click('.src-card[data-src="generated"]'); await s.wait_screen("game")
            await page.wait_for_selector("[data-card][data-qid]"); await shot("4-game")
            g = await ground_report(page)
            check_feet(g, 0, "game start")
            check(g["blocks"] == 20 and g["worst_block_gap"] <= 0.5, f"all {g['blocks']} stair blocks rest on the grass (worst gap {g['worst_block_gap']:.2f})")
            await s.answer(True); await page.wait_for_selector("[data-foot].show"); await explain_clear(page, f"{w}x{hgt} correct"); await shot("5-correct")
            check_feet(await ground_report(page), 1, "after one correct answer")
            await s.next(); await s.answer(False); await page.wait_for_selector("[data-foot].show"); await explain_clear(page, f"{w}x{hgt} wrong"); await shot("6-wrong")
            check_feet(await ground_report(page), 0, "after a fall")
            await s.next(); await s.answer(True); await s.next()
            await page.click('[data-act="leave"]'); await page.wait_for_selector(".dim-layer .alert"); await shot("7-leave-dialog")
            await page.click("text=המשך לשחק")
            await s.answer(False); await s.next()
            await s.climb_to_summit(f"{w}x{hgt}")
            await shot("8-summit")
            check_feet(await ground_report(page), GOAL, "summit")
            await page.click("[data-menu]"); await s.wait_screen("source")
            await page.evaluate("appBack()"); await s.wait_screen("topics")
            await page.click('.topic-row >> nth=0'); await page.click("[data-go]"); await s.wait_screen("source"); await shot("9-source-single-topic")
            await page.evaluate("appBack()"); await s.wait_screen("topics"); await page.evaluate("appBack()"); await s.wait_screen("courses")
            await s.open_course("western-culture-a"); await page.click("[data-go]"); await s.wait_screen("source")
            await page.click('.src-card[data-src="generated"]'); await s.wait_screen("game"); await page.wait_for_selector("[data-card][data-qid]")
            await shot("10-game-course2")
            check(not s.problems, "no console errors / warnings" + ("" if not s.problems else ": " + "; ".join(s.problems[:5])))
            await ctx.close()
        # ---------------------------------------------------------------- 3. themes: auto / light / dark / pink
        print("\n[themes] picker, saved setting, every screen in every theme")
        for scheme, want in (("dark", "dark"), ("light", "light")):
            ctx = await browser.new_context(viewport={"width": 393, "height": 851}, color_scheme=scheme)
            page = await ctx.new_page()
            await page.goto(url); await page.wait_for_selector(".course-row")
            check(await page.get_attribute("html", "data-theme") == want, f"auto theme follows the system ({scheme} -> {want})")
            await ctx.close()
        for w, hgt in ((393, 851), (360, 640)):
            ctx = await browser.new_context(viewport={"width": w, "height": hgt}, device_scale_factor=2, has_touch=True, reduced_motion="reduce")
            page = await ctx.new_page()
            s = Session(page, answers)
            await page.goto(url); await page.wait_for_selector(".course-row")
            for theme in ("light", "dark", "pink"):
                tag = f"{w}x{hgt} {theme}"
                await page.click('[data-act="theme"]'); await page.wait_for_selector(".sheet .theme-opt")
                if theme == "light":
                    check(await page.locator(".theme-opt").count() == 4, "theme picker offers 4 choices")
                    await shot_page(page, shots, f"theme-{w}x{hgt}-picker")
                await page.click(f'.theme-opt[data-theme-opt="{theme}"]')
                check(await page.get_attribute("html", "data-theme") == theme, f"{tag}: picking it sets the theme")
                check(await page.evaluate("JSON.parse(localStorage.getItem('stairs.v1')).settings.theme") == theme, f"{tag}: the choice is saved")
                await page.evaluate("appBack()")
                check(await page.locator(".sheet").count() == 0, f"{tag}: Back closes the picker")
                await shot_page(page, shots, f"theme-{w}x{hgt}-{theme}-1-courses")
                await s.open_course("arch-history-a"); await shot_page(page, shots, f"theme-{w}x{hgt}-{theme}-2-topics")
                await page.click("[data-go]"); await s.wait_screen("source"); await shot_page(page, shots, f"theme-{w}x{hgt}-{theme}-3-source")
                await page.click('.src-card[data-src="generated"]'); await s.wait_screen("game")
                await page.wait_for_selector("[data-card][data-qid] .opt:not([disabled])")
                check(await page.get_attribute("[data-scene] svg", "data-theme") == theme, f"{tag}: the scene is drawn in the theme")
                check_feet(await ground_report(page), 0, f"{tag}: game start")
                if theme == "pink":
                    n_uni = await page.locator("[data-scene] .unicorn").count(); n_lol = await page.locator("[data-scene] .lollipop").count()
                    check(n_uni >= 2 and n_lol >= 3 and await page.locator("[data-scene] .rainbow").count() == 1, f"{tag}: rainbow, {n_uni} unicorns, {n_lol} lollipops")
                await shot_page(page, shots, f"theme-{w}x{hgt}-{theme}-4-game")
                await s.answer(True); await page.wait_for_selector("[data-foot].show"); await explain_clear(page, f"{tag} correct"); await shot_page(page, shots, f"theme-{w}x{hgt}-{theme}-5-correct")
                check_feet(await ground_report(page), 1, f"{tag}: after a correct answer")
                await s.next(); await s.answer(False); await page.wait_for_selector("[data-foot].show")
                await explain_clear(page, f"{tag} wrong")
                check_feet(await ground_report(page), 0, f"{tag}: after a fall")
                await shot_page(page, shots, f"theme-{w}x{hgt}-{theme}-6-wrong")
                if w == 393:
                    await s.next(); await s.climb_to_summit(tag)
                    await shot_page(page, shots, f"theme-{w}x{hgt}-{theme}-7-summit")
                    if theme == "pink":
                        check(await page.locator(".summit .buddy").count() == 2, f"{tag}: unicorns join the summit")
                    await page.click("[data-menu]"); await s.wait_screen("source")
                else:
                    await s.next(); await s.answer(True)          # a streak of 1, so leaving asks first
                    await page.click('[data-act="leave"]'); await page.wait_for_selector(".dim-layer .alert")
                    await shot_page(page, shots, f"theme-{w}x{hgt}-{theme}-7-leave-dialog")
                    await page.click("text=צאי"); await s.wait_screen("source")
                await page.evaluate("appBack()"); await s.wait_screen("topics")
                await page.evaluate("appBack()"); await s.wait_screen("courses")
            check(not s.problems, f"themes {w}x{hgt}: no console errors" + ("" if not s.problems else ": " + "; ".join(s.problems[:5])))
            await ctx.close()

        # ---------------------------------------------------------------- 4. background music (generated test tracks)
        print("\n[music] background music infrastructure")
        msite = make_music_site(site)
        mhttpd, murl = serve(msite)
        ctx = await browser.new_context(viewport={"width": 393, "height": 851}, device_scale_factor=2, has_touch=True)
        page = await ctx.new_page()
        s = Session(page, answers)
        state = lambda: page.evaluate("Sound.musicState()")
        async def wait_music(pred, label, timeout=6000):
            try:
                await page.wait_for_function(f"(() => {{ const m = Sound.musicState(); return {pred}; }})()", timeout=timeout)
                check(True, label)
            except Exception:
                check(False, f"{label} (state {await state()})")
        await page.goto(murl); await page.wait_for_selector(".course-row")
        check(await page.locator('[data-act="music"]').count() == 1, "music toggle shown when the manifest has tracks")
        await page.click('.course-row >> nth=0')       # a user gesture, like on a phone
        await s.wait_screen("topics")
        await wait_music("m.scene === 'menu' && m.playing && m.file === 'menu.wav'", "menu music plays on the menu screens")
        await page.click("[data-go]"); await s.wait_screen("source")
        await page.click('.src-card[data-src="generated"]'); await s.wait_screen("game")
        await wait_music("m.scene === 'game' && m.playing && m.file === 'game1.wav'", "game music takes over in the game")
        for _ in range(5):
            await s.answer(True); await s.next()
        await wait_music("m.ducked && m.volume < 0.2", "music ducks under the 5-step clip")
        await wait_music("!m.ducked && m.volume > 0.3", "music comes back after the clip", timeout=9000)
        await page.evaluate("Sound.pause()")
        await wait_music("!m.playing", "Sound.pause() (app in background) pauses the music")
        await page.evaluate("Sound.resume()")
        await wait_music("m.playing && m.scene === 'game'", "Sound.resume() picks the game music up again")
        await page.evaluate("appBack()"); await page.wait_for_selector(".dim-layer .alert")
        await page.click("text=צאי"); await s.wait_screen("source")
        await wait_music("m.scene === 'menu' && m.playing", "leaving the game goes back to menu music")
        await page.click('.src-card[data-src="generated"]'); await s.wait_screen("game")
        await s.climb_to_summit("music")
        await wait_music("m.scene === 'summit' && m.playing && m.file === 'summit.wav'", "summit music plays on the summit screen")
        await page.click("[data-again]")
        await wait_music("m.scene === 'game' && m.playing", "'עוד טיפוס' goes back to game music")
        await page.click('[data-act="leave"]'); await s.wait_screen("source")
        await page.evaluate("appBack()"); await s.wait_screen("topics"); await page.evaluate("appBack()"); await s.wait_screen("courses")
        await page.click('[data-act="music"]')
        await wait_music("!m.playing", "music toggle off stops the music")
        check(await page.get_attribute('[data-act="music"]', "aria-pressed") == "false", "music toggle shows off")
        await page.reload(); await page.wait_for_selector(".course-row")
        check(await page.get_attribute('[data-act="music"]', "aria-pressed") == "false", "music off is remembered")
        await page.click('[data-act="music"]')
        await wait_music("m.playing && m.scene === 'menu'", "music toggle on starts the menu music again")
        await shot_page(page, shots, "music-courses")
        check(not s.problems, "music: no console errors" + ("" if not s.problems else ": " + "; ".join(s.problems[:5])))
        await ctx.close()
        mhttpd.shutdown()
        shutil.rmtree(msite, ignore_errors=True)

        await browser.close()
    httpd.shutdown()
    shutil.rmtree(site, ignore_errors=True)
    print(f"\n{'PASSED' if not FAILS else 'FAILED'}: {len(FAILS)} failure(s)")
    return 0 if not FAILS else 1


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    win = [os.path.join(os.environ.get(v, ""), "Google", "Chrome", "Application", "chrome.exe")
           for v in ("PROGRAMFILES", "PROGRAMFILES(X86)", "LOCALAPPDATA") if os.environ.get(v)]
    default = shutil.which("google-chrome") or shutil.which("chromium") or next((c for c in win if os.path.exists(c)), "/usr/bin/google-chrome")
    ap.add_argument("--chrome", default=default)
    ap.add_argument("--shots", default=os.path.join(ROOT, "build", "screenshots"))
    a = ap.parse_args()
    sys.exit(asyncio.run(run(a.chrome, a.shots)))
