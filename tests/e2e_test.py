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
import argparse
import base64, asyncio, functools, http.server, json, math, os, shutil, socketserver, struct, sys, tempfile, threading, wave

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
    for name, f in (("menu.wav", 330), ("game1.wav", 440), ("game2.wav", 494), ("summit.wav", 660), ("clip.wav", 880), ("final.wav", 110)):
        tone_wav(os.path.join(adir, name), f)
    json.dump({"clips": [{"file": "clip.wav", "title": "Test clip", "artist": "e2e"}],
               "music": {"menu": [{"file": "menu.wav"}], "game": [{"file": "game1.wav"}, {"file": "game2.wav", "volume": 0.5}],
                         "summit": [{"file": "summit.wav"}]},
               "final": {"file": "final.wav", "title": "Final", "gain": 3}},
              open(os.path.join(adir, "manifest.json"), "w"))
    return msite


def serve(site):
    class Quiet(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *a):
            pass
    class Server(socketserver.ThreadingTCPServer):
        daemon_threads = True
        def handle_error(self, request, client_address):
            # the browser hangs up mid-file when the app drops a half-loaded song: not an error
            if not isinstance(sys.exc_info()[1], (ConnectionError, BrokenPipeError)):
                super().handle_error(request, client_address)
    handler = functools.partial(Quiet, directory=site)
    httpd = Server(("127.0.0.1", 0), handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd, f"http://127.0.0.1:{httpd.server_address[1]}/index.html"


class Session:
    def __init__(self, page, answers):
        self.page, self.answers, self.problems, self.summaries = page, answers, [], []
        page.on("console", lambda m: self.problems.append(f"console {m.type}: {m.text}") if m.type in ("error", "warning") else None)
        page.on("pageerror", lambda e: self.problems.append(f"pageerror: {e}"))
        page.on("requestfailed", self._failed)
        page.on("response", lambda r: self.problems.append(f"HTTP {r.status}: {r.url}") if r.status >= 400 else None)

    def _failed(self, r):
        # the app cancels the download of a song it fades out (screen change, summit): expected, not a failure
        if "ERR_ABORTED" in (r.failure or "") and r.url.split("?")[0].endswith((".mp3", ".m4a", ".ogg", ".wav", ".aac")):
            return
        self.problems.append(f"request failed: {r.url} ({r.failure})")

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
        # arrows are glued to their neighbours with no-break spaces on screen
        norm = lambda t: " ".join(t.replace(" ", " ").split())
        texts = [norm(t) for t in await page.locator("[data-card] .opt .opt-text").all_inner_texts()]
        right = norm(right)
        idx = texts.index(right) if correct else next(i for i, t in enumerate(texts) if t != right)
        await page.locator("[data-card] .opt").nth(idx).click()
        return qid

    async def next(self):
        await self.page.wait_for_selector("[data-foot].show")
        await self.page.click("[data-next]")
        # every 10 distinct questions the session ends with a summary: keep climbing (the first, bold button)
        if await self.page.locator(".dim-layer .alert").count():
            self.summaries.append(await self.page.inner_text(".dim-layer .alert"))
            await self.page.click(".dim-layer .alert-actions button >> nth=0")

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
        st = await page.evaluate("() => { const c = getComputedStyle(document.querySelector('.summit h2')); return { color: c.color, bg: c.backgroundImage, clip: c.backgroundClip || c.webkitBackgroundClip }; }")
        visible = st["color"] not in ("rgba(0, 0, 0, 0)", "transparent") or ("gradient" in st["bg"] and st["clip"] == "text")
        check(visible, f"{label}: the summit title can be seen ({st['color']}, clip {st['clip']})")
        return seen


async def enter(page, mode="cool", difficulty="hardcore"):
    """The app opens on the start screen: pick a mode (default: the full game) and wait for the courses.
    The flows below assume hardcore (a wrong answer goes back to stair 0); casual has its own checks."""
    await page.wait_for_selector(".mode-card, .course-row")
    await page.evaluate(f"Store.difficulty = '{difficulty}'")
    if await page.locator(".mode-card").count():
        await page.click(f'.mode-card[data-mode="{mode}"]')
    await page.wait_for_selector("#splash", state="detached")   # the start screen has handed over to the courses
    await page.wait_for_selector(".course-row")


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
          if (el.closest('svg') || el.closest('.island') || el.closest('.pick-row')) continue;
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
        await ctx.add_init_script("window.__noDataUpdates = true")   # tests never reach GitHub
        page = await ctx.new_page()
        s = Session(page, answers)
        await page.goto(url)
        await enter(page)
        names = await page.locator(".course-row .row-title").all_inner_texts()
        check(len(names) == len(manifest), f"course list shows {len(names)} courses (manifest has {len(manifest)}), incl. the fixture added by one manifest line")
        check(await page.evaluate("appBack()") == "exit", "hardware Back on the first screen exits the app")
        # background music from audio/manifest.json starts on the first screen
        await page.wait_for_function("(() => { const m = Sound.musicState(); return m.scene === 'menu' && m.playing && m.time > 0.2; })()", timeout=8000)
        bg = await page.evaluate("Sound.musicState()")
        songs = ("music/papa-dont-preach.mp3", "music/bass-persuades.mp3", "music/cruel-angels-thesis.mp3")
        check(bg["file"] in songs, f"background music plays on the menu ({bg['file']})")
        # shuffle: when a song ends the next one starts by itself (played at 16x so it ends quickly)
        await page.evaluate("Sound.debugSpeed(16)")
        try:
            await page.wait_for_function(f"(() => {{ const m = Sound.musicState(); return m.playing && m.file && m.file !== {bg['file']!r}; }})()", timeout=40000)
            nx = await page.evaluate("Sound.musicState()")
            check(nx["file"] in songs and nx["file"] != bg["file"], f"when a song ends the next one plays ({bg['file']} -> {nx['file']})")
        except Exception:
            check(False, f"when a song ends the next one plays (still {await page.evaluate('Sound.musicState()')})")
        bg = await page.evaluate("Sound.musicState()")

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

        # the same song keeps playing into the game (not restarted)
        await s.open_course("fixture-course"); await page.click("[data-go]"); await s.wait_screen("source")
        await page.click('.src-card[data-src="generated"]'); await s.wait_screen("game")
        await page.wait_for_timeout(500)
        gm = await page.evaluate("Sound.musicState()")
        check(gm["scene"] == "game" and gm["playing"] and gm["file"] == bg["file"] and gm["time"] > bg["time"],
              f"the song continues from the menu into the game ({bg['time']}s -> {gm['time']}s)")
        await page.wait_for_selector("[data-card][data-qid] .opt:not([disabled])")
        await s.answer(False)
        await page.wait_for_selector(".explain.bad")
        fx = await page.evaluate("Sound.sfxState()")
        check(fx and fx["kind"] == "wrong" and fx["file"] == "sfx/fahh.mp3", f"a wrong answer plays the Fahh sound ({fx})")
        await s.next(); await s.answer(True)
        fx2 = await page.evaluate("Sound.sfxState()")
        check(fx2 and fx2["kind"] == "correct" and fx2["file"] is None, "a correct answer keeps the built-in sound (Fahh only on failing)")
        await page.click('[data-act="leave"]'); await page.wait_for_selector(".dim-layer .alert"); await page.click('.dim-layer .alert-actions button:text-is("צאי")'); await s.wait_screen("source")
        await page.evaluate("appBack()"); await s.wait_screen("topics")
        await page.evaluate("appBack()"); await s.wait_screen("courses")

        # each source of the fixture to the summit (real has 12 questions -> pool note + repeats)
        for source in ("real", "generated", "mixed"):
            await s.open_course("fixture-course")
            await page.click("[data-go]"); await s.wait_screen("source")
            await page.click(f'.src-card[data-src="{source}"]'); await s.wait_screen("game")
            if source == "real":
                await page.wait_for_selector(".dim-layer .alert")
                msg = await page.inner_text(".dim-layer .alert-msg")
                check(msg == "יש רק 12 שאלות. אחרי שייגמרו הן יחזרו בסדר אחר.", f"pool < 20 shows the note: {msg}")
            badge_expect = {"real": "אמיתית", "generated": "כללית"}
            seen = await s.climb_to_summit(f"fixture/{source}")
            if source == "real":
                # the summit sound from audio/manifest.json plays once, with the confetti show and the island
                await page.wait_for_function("(() => { const m = Sound.musicState(); return m.scene === 'summit' && m.playing && m.time > 0.3; })()", timeout=8000)
                m = await page.evaluate("Sound.musicState()")
                check(m["file"] == "music/summit-6am.mp3", f"summit music plays ({m})")
                check(await page.locator(".summit canvas").count() == 1, "confetti show runs on the summit")
                await page.wait_for_selector(".island.open", timeout=3000)
                check("6 AM" in await page.inner_text(".island .isl-title"), "the island names the summit music (no clip on top)")
                sr = await page.text_content(".island .sr-only")
                check(sr is not None and sr.startswith("מתנגן עכשיו: ") and "6 AM" in sr and await page.get_attribute(".island .isl-text", "aria-hidden") == "true",
                      f"the island reads as one sentence to screen readers ({sr})")
            if source == "real":
                check(len(seen) == GOAL and len(set(seen)) == 12, f"real pool of 12 repeats after running out ({len(set(seen))} distinct in {len(seen)})")
            if source == "mixed":
                await page.click("[data-again]")
                await page.wait_for_selector("[data-card][data-qid] .opt:not([disabled])")
                kinds = set()
                for _ in range(12):
                    kinds.add((await page.inner_text("[data-card] .badge.real, [data-card] .badge.generated")).strip())
                    await s.answer(True); await s.next()
                pool_kinds = await page.evaluate("() => [...new Set(Data.pool(Data.course('fixture-course'), Data.course('fixture-course').topics.map(t => t.id), 'mixed').map(q => q.source))].sort()")
                check(pool_kinds == ["generated", "real"] and kinds <= {"אמיתית", "כללית"} and kinds,
                      f"mixed draws from both sources (pool {pool_kinds}; shown {sorted(kinds)}, unseen questions first)")
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
        await page.click('.dim-layer .alert-actions button:text-is("צאי")'); await s.wait_screen("source")
        check(True, "'צאי' leaves to the source screen")
        await page.evaluate("appBack()"); await s.wait_screen("topics")
        await page.evaluate("appBack()"); await s.wait_screen("courses")

        # bundled courses: all topics, every non-empty source to the summit
        def qcount(folder, src, topic=None):
            path = os.path.join(ASSETS, "data", folder, f"questions-{src}.json")
            qs = json.load(open(path, encoding="utf-8")) if os.path.exists(path) else []
            return sum(1 for q in qs if topic is None or q["topic"] == topic)
        for entry in manifest:
            if entry["id"] == "fixture-course":
                continue
            folder = entry["folder"]
            n_real, n_gen = qcount(folder, "real"), qcount(folder, "generated")
            await s.open_course(entry["id"])
            # make sure every topic is selected
            if not await page.evaluate("() => document.querySelector('[data-all] .switch').classList.contains('on')"):
                await page.click("[data-all]")
            await page.click("[data-go]"); await s.wait_screen("source")
            for src, n in (("real", n_real), ("generated", n_gen)):
                check(await page.is_disabled(f'.src-card[data-src="{src}"]') == (n == 0),
                      f"{entry['id']}: '{src}' card {'disabled' if n == 0 else 'enabled'} ({n} questions)")
            has_mixed = await page.locator('.src-card[data-src="mixed"]').count() > 0
            check(has_mixed == (n_real > 0 and n_gen > 0), f"{entry['id']}: 'mixed' card only when both sources have questions")
            play = "generated" if n_gen else "real"
            await page.click(f'.src-card[data-src="{play}"]'); await s.wait_screen("game")
            if (n_gen or n_real) < 20:   # small pool: the "questions will repeat" note comes first
                await page.wait_for_selector(".dim-layer .alert")
                await page.click(".dim-layer .alert-actions button")
            cap = await page.inner_text("[data-card] .q-caption")
            check(cap.startswith(entry["name"]), f"{entry['id']}: caption shows course + topic ('{cap}')")
            await s.climb_to_summit(f"{entry['id']}/{play}")
            await page.click("[data-menu]"); await s.wait_screen("source")
            await page.evaluate("appBack()"); await s.wait_screen("topics")
            # a single topic whose real pool is empty -> disabled card with the exact text
            tids = await page.eval_on_selector_all(".topic-row", "els => els.map(e => e.dataset.tid)")
            empty = next((t for t in tids if qcount(folder, "real", t) == 0), None)
            if empty and n_real:
                await page.click(f'.topic-row[data-tid="{empty}"]')
                await page.click("[data-go]"); await s.wait_screen("source")
                txt = await page.inner_text('.src-card[data-src="real"] .src-empty')
                check(txt == "אין עדיין שאלות כאלה בנושאים שבחרת", f"{entry['id']}: single topic + empty real shows the disabled card text")
                await page.evaluate("appBack()"); await s.wait_screen("topics")
                await page.click("[data-all]")   # restore "all topics"
            await page.evaluate("appBack()"); await s.wait_screen("courses")

        best = await page.locator(".best-pill").all_inner_texts()
        check(all("20" in b for b in best), f"course list shows the best streaks: {best}")
        # progress survives a reload
        await page.reload(); await enter(page)
        best2 = await page.locator(".best-pill").all_inner_texts()
        check(best2 == best, "progress survives a reload (localStorage)")

        # study sessions: every 10 distinct questions end with a 3-line summary, and climbing continues
        check(any("הסבב הושלם" in t and "נכון בניסיון ראשון" in t for t in s.summaries),
              f"a 10-question session ends with its summary ({len(s.summaries)} summaries seen)")
        # spaced review: make 3 questions due, then review them from the course card
        due_ids = await page.evaluate("""() => {
          const ids = Data.course('arch-history-a').questions.slice(0, 3).map(q => q.id);
          const d = JSON.parse(localStorage.getItem('stairs.v1'));
          ids.forEach(id => { d.L[id] = { d: Date.now() - 60000, s: 1, a: 0, r: 0, l: Date.now() - 2 * 86400000 }; });
          localStorage.setItem('stairs.v1', JSON.stringify(d));
          return ids;
        }""")
        await page.reload(); await enter(page)
        rev = await page.locator('.review-row[data-review="arch-history-a"]').inner_text()
        total = await page.inner_text("[data-duetotal]")
        check(rev.strip() == "3 לחזרה היום" and total.strip() == "לחזרה היום: 3", f"course card and header show the due reviews ('{rev.strip()}', '{total.strip()}')")
        await page.click('.review-row[data-review="arch-history-a"]'); await s.wait_screen("game")
        line = await page.inner_text("[data-blockline]")
        check(line == "חזרה: 0 מתוך 3", f"review session is exactly the due questions ('{line}')")
        reviewed = []
        for i in range(3):
            reviewed.append(await s.answer(True))
            await page.wait_for_selector("[data-foot].show")
            await page.click("[data-next]")
        await page.wait_for_selector(".dim-layer .alert")
        t = await page.inner_text(".dim-layer .alert-title")
        msg = await page.inner_text(".dim-layer .alert-msg")
        check(sorted(reviewed) == sorted(due_ids), "the review asked exactly the due questions")
        check(t == "החזרה הושלמה" and "תשובות נכונות בחזרה מתוזמנת: 3" in msg, f"review ends with its summary ('{t}' / {msg!r})")
        await page.click("text=לסיום"); await s.wait_screen("courses")
        check(await page.locator('.review-row[data-review="arch-history-a"]').count() == 0, "after the review the course has nothing due")
        nxt = await page.evaluate(f"() => {json.dumps(due_ids)}.map(id => Math.round((Store.learning(id).dueAt - Date.now()) / 86400000))")
        check(all(n == 3 for n in nxt), f"a correct review moves the question to the next interval, 3 days ({nxt})")
        # topic progress: the reviewed questions show as seen on the topic rows
        await s.open_course("arch-history-a")
        bar = await page.locator(".topic-row >> nth=0").get_attribute("aria-label")
        check("נצפו" in (bar or "") and "נענו שוב נכון" in (bar or ""), f"topic rows carry seen / recalled numbers ('{bar}')")
        await page.evaluate("appBack()"); await s.wait_screen("courses")

        # self-check: 20 neutral questions, then the results; history and "practise the mistakes"
        await s.open_course("intro-education")
        if not await page.evaluate("() => document.querySelector('[data-all] .switch').classList.contains('on')"):
            await page.click("[data-all]")
        await page.click("[data-go]"); await s.wait_screen("source")
        await page.click("[data-start-check]"); await s.wait_screen("check")
        asked, wrong_n = [], 0
        for k in range(20):
            await page.wait_for_selector("[data-screen='check'] [data-card] .opt")
            qtext = await page.inner_text("[data-screen='check'] .q-text")
            q = await page.evaluate("(t) => { const q = Data.course('intro-education').questions.find(x => x.q === t); return { id: q.id, answer: q.answer }; }", qtext)
            asked.append(q["id"])
            check_next_disabled = await page.is_disabled("[data-screen='check'] [data-next]")
            pick = q["answer"] if k % 5 else (q["answer"] + 1) % 4
            wrong_n += 0 if k % 5 else 1
            await page.click(f"[data-screen='check'] .opt[data-oi='{pick}']")
            cues = await page.locator("[data-screen='check'] .opt.correct, [data-screen='check'] .opt.wrong, [data-screen='check'] .explain").count()
            if k == 0:
                check(check_next_disabled, "self-check: Next stays disabled until an answer is chosen")
                check(cues == 0, "self-check: choosing an answer shows no right/wrong cue")
            await page.click("[data-screen='check'] [data-next]")
        await page.wait_for_selector(".res-score")
        score = await page.inner_text(".res-score")
        check(len(set(asked)) == 20, f"self-check asks 20 different questions ({len(set(asked))})")
        check(score.strip() == f"{20 - wrong_n} מתוך 20", f"result shows the score ('{score.strip()}')")
        check(await page.locator("[data-wrong] .res-item").count() == wrong_n, "every mistake is listed with the correct answer")
        hist = await page.evaluate("() => Store.checks('intro-education').length")
        check(hist == 1, f"the result is saved in the course history ({hist})")
        await page.click("[data-practice]"); await s.wait_screen("practice")
        for k in range(wrong_n):
            await page.click("[data-screen='practice'] .opt >> nth=0")
            await page.wait_for_selector("[data-screen='practice'] .explain")
            await page.click("[data-screen='practice'] [data-next]")
        await page.wait_for_selector(".dim-layer .alert")
        check("תרגול הטעויות" in await page.inner_text(".dim-layer .alert-title"), "practising the mistakes is one pass with a summary")
        await page.click(".dim-layer .alert-actions button"); await s.wait_screen("result")
        await page.click("[data-finish]"); await s.wait_screen("source")
        check(await page.locator("[data-history]").count() == 1, "the source screen offers the past results")
        await page.evaluate("appBack()"); await s.wait_screen("topics")
        await page.evaluate("appBack()"); await s.wait_screen("courses")
        check(not s.problems, "no console errors / warnings / failed requests" + ("" if not s.problems else ": " + "; ".join(s.problems[:5])))
        await ctx.close()

        # ---------------------------------------------------------------- 2. screenshots + layout checks
        for (w, hgt) in ((360, 640), (393, 851)):
            print(f"\n[{w}x{hgt}] screens")
            ctx = await browser.new_context(viewport={"width": w, "height": hgt}, device_scale_factor=2, has_touch=True, reduced_motion="reduce")
            await ctx.add_init_script("window.__noDataUpdates = true")   # tests never reach GitHub
            page = await ctx.new_page()
            s = Session(page, answers)
            await page.goto(url); await enter(page)
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
            await ctx.add_init_script("window.__noDataUpdates = true")   # tests never reach GitHub
            page = await ctx.new_page()
            await page.goto(url); await enter(page)
            check(await page.get_attribute("html", "data-theme") == want, f"auto theme follows the system ({scheme} -> {want})")
            await ctx.close()
        for w, hgt in ((393, 851), (360, 640)):
            ctx = await browser.new_context(viewport={"width": w, "height": hgt}, device_scale_factor=2, has_touch=True, reduced_motion="reduce")
            await ctx.add_init_script("window.__noDataUpdates = true")   # tests never reach GitHub
            page = await ctx.new_page()
            s = Session(page, answers)
            await page.goto(url); await enter(page)
            for theme in ("light", "dark", "pink", "gallery"):
                tag = f"{w}x{hgt} {theme}"
                await page.click('[data-act="theme"]'); await page.wait_for_selector(".sheet .theme-opt")
                if theme == "light":
                    check(await page.locator(".theme-opt").count() == 5, "theme picker offers 5 choices")
                    await shot_page(page, shots, f"theme-{w}x{hgt}-picker")
                await page.click(f'.theme-opt[data-theme-opt="{theme}"]')
                check(await page.get_attribute("html", "data-theme") == theme, f"{tag}: picking it sets the theme")
                check(await page.evaluate("JSON.parse(localStorage.getItem('stairs.v1')).settings.theme") == theme, f"{tag}: the choice is saved")
                await page.evaluate("appBack()")
                check(await page.locator(".sheet").count() == 0, f"{tag}: Back closes the picker")
                await shot_page(page, shots, f"theme-{w}x{hgt}-{theme}-1-courses")
                await s.open_course("arch-history-a"); await shot_page(page, shots, f"theme-{w}x{hgt}-{theme}-2-topics")
                tick = await page.evaluate("() => { const c = document.querySelector('.topic-row.selected .check'); return c ? getComputedStyle(c).backgroundColor : null; }")
                check(tick not in (None, "rgba(0, 0, 0, 0)"), f"{tag}: a selected topic shows a filled tick ({tick})")
                if theme == "gallery":
                    look = await page.evaluate("() => ({ bg: getComputedStyle(document.documentElement).getPropertyValue('--bg').trim(), go: getComputedStyle(document.querySelector('[data-go]')).backgroundColor })")
                    check(look["bg"].upper() == "#F5F5F7" and look["go"] == "rgb(0, 113, 227)", f"{tag}: the gallery colours are applied ({look})")
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
                bg = await page.evaluate("() => { const l = document.querySelector('[data-card] .opt.correct .opt-letter'); return l ? getComputedStyle(l).backgroundColor : null; }")
                check(bg not in (None, "rgb(255, 255, 255)", "rgba(0, 0, 0, 0)"), f"{tag}: the correct answer's letter takes the correct colour ({bg})")
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
                    await page.click('.dim-layer .alert-actions button:text-is("צאי")'); await s.wait_screen("source")
                await page.evaluate("appBack()"); await s.wait_screen("topics")
                await page.evaluate("appBack()"); await s.wait_screen("courses")
            check(not s.problems, f"themes {w}x{hgt}: no console errors" + ("" if not s.problems else ": " + "; ".join(s.problems[:5])))
            await ctx.close()

        # ---------------------------------------------------------------- 4. background music (generated test tracks)
        print("\n[music] background music infrastructure")
        msite = make_music_site(site)
        mhttpd, murl = serve(msite)
        ctx = await browser.new_context(viewport={"width": 393, "height": 851}, device_scale_factor=2, has_touch=True)
        await ctx.add_init_script("window.__noDataUpdates = true")   # tests never reach GitHub
        page = await ctx.new_page()
        s = Session(page, answers)
        state = lambda: page.evaluate("Sound.musicState()")
        async def wait_music(pred, label, timeout=6000):
            try:
                await page.wait_for_function(f"(() => {{ const m = Sound.musicState(); return {pred}; }})()", timeout=timeout)
                check(True, label)
            except Exception:
                check(False, f"{label} (state {await state()})")
        await page.goto(murl); await enter(page)
        check(await page.locator('[data-act="music"]').count() == 1, "music toggle shown when the manifest has tracks")
        await page.click('.course-row >> nth=0')       # a user gesture, like on a phone
        await s.wait_screen("topics")
        await wait_music("m.scene === 'menu' && m.playing && m.file === 'menu.wav'", "menu music plays on the menu screens")
        await page.click("[data-go]"); await s.wait_screen("source")
        await page.click('.src-card[data-src="generated"]'); await s.wait_screen("game")
        await wait_music("m.scene === 'game' && m.playing && m.file === 'game1.wav'", "game music takes over in the game")
        for _ in range(5):
            await s.answer(True); await s.next()
        await wait_music("m.ducked && m.volume < 0.3", "music ducks (-4 dB) under the 5-step clip")
        await wait_music("!m.ducked && m.volume > 0.3", "music comes back after the clip", timeout=9000)
        await page.evaluate("Sound.pause()")
        await wait_music("!m.playing", "Sound.pause() (app in background) pauses the music")
        await page.evaluate("Sound.resume()")
        await wait_music("m.playing && m.scene === 'game'", "Sound.resume() picks the game music up again")
        await page.evaluate("appBack()"); await page.wait_for_selector(".dim-layer .alert")
        await page.click('.dim-layer .alert-actions button:text-is("צאי")'); await s.wait_screen("source")
        await wait_music("m.scene === 'menu' && m.playing", "leaving the game goes back to menu music")
        await page.click('.src-card[data-src="generated"]'); await s.wait_screen("game")
        isl = await page.evaluate("(() => { const s = getComputedStyle(document.querySelector('.island')); return +s.opacity; })()")
        check(isl == 0, f"no resting notch: the island is hidden until a song is announced (opacity {isl})")

        # the last stair: streak 19 turns the game into hell mode with the boosted "final" track, even with sound off
        async def final_state():
            return await page.evaluate("Sound.finalState()")
        await page.evaluate("Store.sound = false")
        for i in range(GOAL - 1):
            await s.answer(True)
            if i < GOAL - 2:
                if i == GOAL - 3:
                    check(not await page.locator(".game.rage").count(), "no hell mode before the 19th stair")
                await s.next()
        await page.wait_for_selector(".game.rage .rage-fx", timeout=3000)
        check(True, "stair 19 turns on hell mode (red, flames)")
        fx = await page.evaluate("""() => { const r = document.querySelector('.rage-fx'); const n = (s) => r.querySelectorAll(s).length;
          return { flames: n('.flame'), demons: n('.demon'), chains: n('.chain') + n('.garland'), skulls: n('.pike') + n('.pile-skull'), lava: n('.lava') }; }""")
        check(fx["flames"] >= 30 and fx["demons"] == 3 and fx["chains"] == 3 and fx["skulls"] >= 9 and fx["lava"] == 1,
              f"hell mode goes metal: demons, flames, chains and skulls ({fx})")
        check(await page.locator(".game .slam").count() == 1, "hell mode slams its 'שלב אחרון' banner")
        try:
            await page.wait_for_function("(() => { const f = Sound.finalState(); return f.on && f.playing; })()", timeout=5000)
            check(True, "the final track plays at stair 19 even though sound is off")
        except Exception:
            check(False, f"the final track plays at stair 19 even though sound is off ({await final_state()})")
        await page.wait_for_timeout(450); await page.screenshot(path=os.path.join(shots, "music-hell-mode-slam.png"))
        await page.wait_for_timeout(2400); await page.screenshot(path=os.path.join(shots, "music-hell-mode.png"))
        f = await final_state()
        check(f["boosted"] and abs(f["gain"] - 3) < 1e-6, f"the final track is boosted to 300% ({f})")
        m = await state()
        check(not m["playing"], f"the background song is held under the final track ({m})")
        await page.evaluate("Sound.pause()")
        check(not (await final_state())["playing"], "Sound.pause() (app in background) pauses the final track")
        await page.evaluate("Sound.resume()")
        await page.wait_for_function("Sound.finalState().playing", timeout=3000)
        check(True, "Sound.resume() picks the final track up again")
        await page.evaluate("Store.sound = true")
        await s.next(); await s.answer(False)
        await page.wait_for_function("!document.querySelector('.game.rage') && !Sound.finalState().on", timeout=3000)
        check(not await page.locator(".rage-fx").count(), "a wrong answer on stair 19 ends hell mode")
        await wait_music("m.scene === 'game' && m.playing", "the background song comes back after hell mode")
        await s.next()
        await s.climb_to_summit("music")
        check(not (await final_state())["on"] and not await page.locator(".rage-fx").count(), "reaching the summit ends hell mode")
        await wait_music("m.scene === 'summit' && m.playing && m.file === 'summit.wav'", "summit music plays on the summit screen")
        await page.click("[data-again]")
        await wait_music("m.scene === 'game' && m.playing", "'עוד טיפוס' goes back to game music")
        await page.click('[data-act="leave"]'); await s.wait_screen("source")
        await page.evaluate("appBack()"); await s.wait_screen("topics"); await page.evaluate("appBack()"); await s.wait_screen("courses")
        await page.click('[data-act="music"]')
        await wait_music("!m.playing", "music toggle off stops the music")
        check(await page.get_attribute('[data-act="music"]', "aria-pressed") == "false", "music toggle shows off")
        await page.reload(); await enter(page)
        check(await page.get_attribute('[data-act="music"]', "aria-pressed") == "false", "music off is remembered")
        await page.click('[data-act="music"]')
        await wait_music("m.playing && m.scene === 'menu'", "music toggle on starts the menu music again")
        await shot_page(page, shots, "music-courses")

        # only one song at a time, through every scene change (the old "mushed" bug: fades left songs playing)
        playing_music = "Sound.debugPlaying().filter(x => x.kind === 'music' || x.kind === 'final').length"
        check(await page.evaluate(playing_music) <= 1, "one song at a time on the courses screen")

        # the music tab: mini player, Spotify-style player, playlist and picks
        await page.wait_for_selector(".mini:not([hidden])", timeout=4000)
        check(True, "the mini player shows the song on the courses tab")
        await page.click('[data-tab-btn="music"]'); await page.wait_for_selector(".music-tab .np-title")
        await shot_page(page, shots, "music-tab")
        lib_n = await page.evaluate("Sound.library().length")
        check(await page.locator(".music-tab .trk").count() == lib_n == 5, f"the music tab lists every song ({lib_n})")
        await page.click(".music-tab [data-p-play]")
        await wait_music("m.userPaused && !m.playing", "the play button pauses the music")
        await page.click(".music-tab [data-p-play]")
        await wait_music("!m.userPaused && m.playing", "and plays it again")
        await page.evaluate("Sound.setPrefs({ playlist: ['menu.wav', 'game1.wav'] })")
        before = (await state())["file"]
        await page.click(".music-tab [data-p-next]")
        await wait_music(f"m.playing && m.file !== {before!r}", "next skips to another song")
        await page.wait_for_timeout(800)
        check(await page.evaluate(playing_music) == 1, f"after next only one song plays ({await page.evaluate('Sound.debugPlaying()')})")
        await page.click('.music-tab .trk[data-file="summit.wav"] [data-play-file]')
        await wait_music("m.playing && m.file === 'summit.wav'", "tapping a song plays it now")
        await page.click('.music-tab .trk[data-file="menu.wav"] [data-toggle-file]')
        pl = await page.evaluate("Sound.prefs().playlist")
        check("menu.wav" not in pl, f"the toggle takes a song out of the playlist ({pl})")
        await page.click('.music-tab [data-pick="final"] .card-pick[data-file="game2.wav"]')
        check((await page.evaluate("Sound.prefs()"))["final"] == "game2.wav", "the last-stair song can be picked")
        await page.reload(); await enter(page)
        pr = await page.evaluate("Sound.prefs()")
        check("menu.wav" not in pr["playlist"] and pr["final"] == "game2.wav", f"music choices are remembered ({pr})")
        await page.evaluate("Sound.setPrefs({ playlist: null, final: null, summit: null })")
        await page.click('[data-tab-btn="music"]'); await page.wait_for_selector(".music-tab .np-title")
        check(await page.evaluate("appBack()") == "handled" and await page.get_attribute(".home", "data-tab") == "courses", "Back on the music tab goes to the courses tab")

        # the boring mode: no music at all and no hell mode on stair 19
        await page.click('[data-act="mode"]'); await page.wait_for_selector(".mode-card")
        check(await page.get_attribute(".mode-card.primary", "data-mode") == "cool", "the start screen makes the last-used mode the big card")
        check(await page.locator(".start-bubble").count() == 1, "the monster says the line of the day")
        await shot_page(page, shots, "mode-screen")
        await wait_music("!m.playing", "no music on the mode screen")
        await page.click('.mode-card[data-mode="boring"]'); await page.wait_for_selector("#splash", state="detached")
        check(await page.locator('[data-tab-btn="music"]').is_hidden() and await page.locator('[data-act="music"]').count() == 0, "boring mode hides the music tab and toggle")
        await page.click('.course-row >> nth=0'); await s.wait_screen("topics")
        await page.click("[data-go]"); await s.wait_screen("source")
        await page.click('.src-card[data-src="generated"]'); await s.wait_screen("game")
        for _ in range(GOAL - 1):
            await s.answer(True); await s.next()
        await page.wait_for_timeout(600)
        check(not await page.locator(".rage-fx").count() and not (await page.evaluate("Sound.finalState()"))["on"], "boring mode: no hell mode on stair 19")
        check(await page.evaluate(playing_music) == 0, "boring mode: no music in the game")
        await page.click('[data-act="leave"]'); await page.wait_for_selector(".dim-layer .alert"); await page.click('.dim-layer .alert-actions button:text-is("צאי")')
        await s.wait_screen("source")
        await page.evaluate("Store.mode = 'cool'")

        # rapid input: a double tap on "next" moves on exactly one question
        await page.click('.src-card[data-src="generated"]') if await s.screen() == "source" else None
        await s.wait_screen("game")
        q0 = await s.answer(True)
        await page.wait_for_selector("[data-foot].show")
        changes = await page.evaluate("""() => new Promise((done) => {
          const card = document.querySelector('[data-card]'); let n = 0;
          const mo = new MutationObserver((m) => { n += m.filter((x) => x.attributeName === 'data-qid').length; });
          mo.observe(card, { attributes: true });
          const b = document.querySelector('[data-next]'); b.click(); b.click();
          setTimeout(() => { mo.disconnect(); done(n); }, 300);
        })""")
        q1 = await page.get_attribute("[data-card]", "data-qid")
        check(changes == 1 and q1 != q0 and await page.locator("[data-card] .opt:not([disabled])").count() == 4,
              f"a double tap on 'next' moves on exactly one question ({changes} change(s))")
        await page.click('[data-act="leave"]'); await page.wait_for_selector(".dim-layer .alert"); await page.click('.dim-layer .alert-actions button:text-is("צאי")')
        await s.wait_screen("source")

        # casual: checkpoints at 5, 10, 15; a wrong answer falls back to the last one
        await page.evaluate("Store.difficulty = 'casual'")
        await page.click('.src-card[data-src="generated"]'); await s.wait_screen("game")
        for _ in range(7):
            await s.answer(True); await s.next()
        flags = await page.evaluate("[...document.querySelectorAll('[data-scene] .checkpoint')].map(f => f.getAttribute('class'))")
        check(len(flags) == 3 and sum("current" in f for f in flags) == 1, f"casual: three checkpoint flags, the one at stair 5 open ({flags})")
        await s.answer(False)
        await page.wait_for_timeout(1600)
        check(await page.inner_text("[data-num]") == "5", "casual: a wrong answer at stair 7 falls back to the checkpoint at 5")
        check_feet(await ground_report(page), 5, "casual: after the fall")
        await page.click('[data-act="leave"]'); await page.wait_for_selector(".dim-layer .alert"); await page.click('.dim-layer .alert-actions button:text-is("צאי")')
        await s.wait_screen("source")
        await page.evaluate("Store.difficulty = 'hardcore'")
        check(not s.problems, "music: no console errors" + ("" if not s.problems else ": " + "; ".join(s.problems[:5])))
        await ctx.close()
        mhttpd.shutdown()
        shutil.rmtree(msite, ignore_errors=True)

        # ---------------------------------------------------------------- question updates from GitHub (served by the test)
        print("\n[question updates]")
        ctx = await browser.new_context(viewport={"width": 393, "height": 851})
        await ctx.add_init_script("window.__updateDelay = 1e9")   # the test drives every check itself
        page = await ctx.new_page()
        s = Session(page, answers)
        data_dir = os.path.join(site, "data")
        remote = {"broken": True, "hits": 0, "down": True}
        new_q = {"id": "west-b-gen-9999", "topic": "romanticism", "source": "generated", "q": "שאלת עדכון לבדיקה?",
                 "options": ["תשובה א", "תשובה ב", "תשובה ג", "תשובה ד"], "answer": 0, "explanation": "בדיקה.", "ref": "בדיקה", "difficulty": 1}

        async def github(route):
            remote["hits"] += 1
            path = route.request.url.split("/app/assets/data/", 1)[-1]
            if remote["down"]:
                await route.fulfill(status=503, body="", headers={"Access-Control-Allow-Origin": "*"}); return
            if path == "version.json":
                body = json.dumps({"format": 1, "hash": "test-update", "updated": "2999-01-01T00:00:00Z"})
            elif path == "western-culture-b/questions-generated.json":
                qs = json.load(open(os.path.join(data_dir, "western-culture-b", "questions-generated.json"), encoding="utf-8"))
                body = json.dumps(qs + [new_q], ensure_ascii=False)
                if remote["broken"]:
                    body = body[:-7]          # a cut download
            else:
                f = os.path.join(data_dir, *path.split("/"))
                if not os.path.exists(f):
                    await route.fulfill(status=404, body="", headers={"Access-Control-Allow-Origin": "*"}); return
                body = open(f, encoding="utf-8").read()
            await route.fulfill(status=200, body=body, headers={"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"})
        await ctx.route("https://raw.githubusercontent.com/**", github)
        await page.goto(url); await enter(page)
        count = "() => Data.courses.reduce((n, c) => n + c.questions.length, 0)"
        before = await page.evaluate(count)
        await page.evaluate("localStorage.removeItem('stairs.data.checked')")
        r = await page.evaluate("Data.checkForUpdates()")
        throttled = await page.evaluate("localStorage.getItem('stairs.data.checked')")
        check(r is None and throttled is None, "when GitHub can't be reached, the next launch tries again (no hourly wait)")
        remote["down"] = False
        r = await page.evaluate("appCheckForQuestionUpdates()")
        check(r is None and not await page.evaluate("Data.fromUpdate") and await page.evaluate(count) == before,
              "a broken download changes nothing")
        remote["broken"] = False
        r = await page.evaluate("appCheckForQuestionUpdates()")
        check(r is not None and r["added"] == 1 and await page.evaluate(count) == before + 1, f"a newer version on GitHub is downloaded and used ({r})")
        await page.wait_for_selector(".update-toast")
        check((await page.inner_text(".update-toast")).strip() == "נוספה שאלה חדשה", "a short notice says what changed")
        await page.reload(); await enter(page)
        kept = await page.evaluate("() => Data.fromUpdate && Data.courses.some(c => c.questions.some(q => q.id === 'west-b-gen-9999'))")
        check(kept, "the downloaded questions are used again after a restart (no network needed)")
        hits = remote["hits"]
        r = await page.evaluate("Data.checkForUpdates()")
        check(r is None and remote["hits"] == hits, "no second check within the hour")
        r = await page.evaluate("Data.checkForUpdates(true)")
        check(r is None, "the same version is not downloaded again")
        await ctx.close()

        # ---------------------------------------------------------------- picture questions (building identification)
        print("\n[picture questions]")
        isite = tempfile.mkdtemp(prefix="stairs-img-")
        shutil.copytree(site, isite, dirs_exist_ok=True)
        os.makedirs(os.path.join(isite, "images", "test"), exist_ok=True)
        png = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNgYGAAAAAEAAH2FzhVAAAAAElFTkSuQmCC")
        open(os.path.join(isite, "images", "test", "pic.png"), "wb").write(png)
        json.dump(["test/pic.png"], open(os.path.join(isite, "images", "index.json"), "w"))
        fq = os.path.join(isite, "data", "fixture-course", "questions-real.json")
        real = json.load(open(fq, encoding="utf-8"))
        for q in real:
            q["image"] = "test/pic.png"
        real[-1]["image"] = "test/missing.png"      # named in the data, but not in this build
        json.dump(real, open(fq, "w", encoding="utf-8"), ensure_ascii=False)
        ihttpd, iurl = serve(isite)
        ctx = await browser.new_context(viewport={"width": 393, "height": 851})
        await ctx.add_init_script("window.__noDataUpdates = true")
        page = await ctx.new_page()
        s = Session(page, answers)
        await page.goto(iurl); await enter(page, mode="boring")
        ids = await page.evaluate("Data.course('fixture-course').questions.filter(q => q.source === 'real').map(q => q.id)")
        check(len(ids) == len(real) - 1 and real[-1]["id"] not in ids, "a picture question whose picture isn't in the build is left out")
        await s.open_course("fixture-course"); await page.click("[data-go]"); await s.wait_screen("source")
        await page.click('.src-card[data-src="real"]'); await s.wait_screen("game")
        if await page.locator(".dim-layer .alert").count():
            await page.click(".dim-layer .alert-actions button >> nth=0")
        await page.wait_for_function("() => { const i = document.querySelector('[data-card] .q-image img'); return i && i.complete && i.naturalWidth > 0; }", timeout=5000)
        check(True, "the picture shows above the question")
        await page.click("[data-card] .q-image")
        check(await page.locator(".zoom-layer img").count() == 1, "tapping the picture opens it full screen")
        check(await page.evaluate("appBack()") == "handled" and await page.locator(".zoom-layer").count() == 0
              and await s.screen() == "game", "Back closes the full-screen picture and stays in the game")
        await page.click("[data-card] .q-image"); await page.click(".zoom-layer")
        check(await page.locator(".zoom-layer").count() == 0, "a tap closes the full-screen picture")
        await s.answer(True); await s.next()
        check(await page.locator("[data-card] .q-image img").count() == 1, "the next picture question shows its picture too")
        check(not s.problems, "picture questions: no console errors" + ("" if not s.problems else ": " + "; ".join(s.problems[:5])))
        await ctx.close()
        ihttpd.shutdown()
        shutil.rmtree(isite, ignore_errors=True)

        # ---------------------------------------------------------------- a damaged save still opens the app
        print("\n[damaged save]")
        ctx = await browser.new_context(viewport={"width": 393, "height": 851})
        await ctx.add_init_script("window.__noDataUpdates = true; if (!sessionStorage.getItem('seeded')) { sessionStorage.setItem('seeded', '1'); localStorage.setItem('stairs.v1', JSON.stringify({ courses: { 'fixture-course': 5, x: [1] }, lv: 1 })); }")
        page = await ctx.new_page()
        await page.goto(url); await enter(page)
        check(await page.locator(".course-row").count() > 0, "a save with broken course entries still opens the courses")
        await ctx.close()

        # ---------------------------------------------------------------- home-screen widget: settings page (browser fallback)
        print("\n[widget settings]")
        ctx = await browser.new_context(viewport={"width": 393, "height": 851})
        await ctx.add_init_script("window.__noDataUpdates = true")
        page = await ctx.new_page()
        s = Session(page, answers)
        await page.goto(url); await enter(page, mode="boring")
        # the timer maths (mirrors TimerWidget.java); "now" is fixed to 2026-11-23
        model = lambda cfg: page.evaluate(f"(() => {{ const n = Math.floor(Date.UTC(2026, 10, 23) / 864e5); return __widgetModel({json.dumps(cfg)}, n); }})()")
        m = await model({"goal": "2027-02-15", "start": "2026-11-01", "unit": "days", "count": "down", "theme": "pink"})
        check(m["label"] == "נשארו" and m["number"] == "84" and m["unit"] == "ימים", f"days left to the goal ({m['number']} {m['unit']})")
        check(abs(m["progress"] - 22 / 106) < 1e-9, "progress runs from the start date to the goal")
        m = await model({"goal": "2027-02-15", "start": "2026-11-01", "unit": "months", "count": "down"})
        check((m["number"], m["unit"], m["sub"]) == ("2", "חודשים", "ועוד 23 ימים"), f"months left, and the days over ({m['number']} {m['unit']} {m['sub']})")
        m = await model({"goal": "2026-12-10", "unit": "months", "count": "down"})
        check((m["number"], m["unit"]) == ("17", "ימים"), "under a month it counts days even in months mode")
        m = await model({"goal": "2026-11-24", "count": "down"})
        check((m["number"], m["unit"]) == ("1", "יום"), "one day: singular")
        m = await model({"goal": "2026-11-23", "count": "down", "theme": "pro"})
        check(m["label"] == "זה היום!", "on the day itself it says so")
        m = await model({"goal": "2026-11-20", "count": "down"})
        check(m["label"] == "הגעת ליעד" and m["sub"] == "לפני 3 ימים", "after the goal date: reached, 3 days ago")
        m = await model({"goal": "2027-02-15", "start": "2026-09-01", "unit": "months", "count": "up"})
        check((m["label"], m["number"], m["sub"]) == ("עברו", "2", "ועוד 22 ימים · מתוך 167 ימים"), f"counting up since the start ({m['number']} · {m['sub']})")
        m = await model({"goal": "", "count": "down"})
        check(m["number"] == "?" and "להגדיר" in m["sub"], "no goal yet: asks to set one")

        await page.click('[data-act="widget"]')
        await page.wait_for_selector(".wset-layer .wprev")
        check(await page.locator(".wprev-wrap .wprev.pink").count() == 1, "the settings open with a preview (pink by default)")
        await page.fill('[data-f="title"]', "המבחן הגדול")
        goal = await page.evaluate("(() => { const d = new Date(); const g = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate() + 30)); return g.toISOString().slice(0, 10); })()")
        await page.fill('[data-f="goal"]', goal)
        num = await page.inner_text(".wprev-wrap .wp-num b")
        check(num == "30" and (await page.inner_text(".wprev-wrap .wp-title")) == "המבחן הגדול", f"the preview follows the goal ({num} days)")
        await page.click('[data-wtheme="pro"]')
        check(await page.locator(".wprev-wrap .wprev.pro").count() == 1 and await page.get_attribute('[data-wtheme="pro"]', "aria-pressed") == "true", "the professional theme can be picked")
        await page.click('[data-seg="count"] [data-v="up"]')
        check((await page.inner_text(".wprev-wrap .wp-label")).strip() == "עברו", "counting up can be picked")
        before = await page.inner_text(".wprev-wrap .wp-sentence span")
        await page.click(".wprev-wrap [data-wnext]")
        after = await page.inner_text(".wprev-wrap .wp-sentence span")
        check(before != after and after, "a tap on the sentence shows the next one")
        check(await page.evaluate("appBack()") == "handled" and await page.locator(".wset-layer").count() == 0, "Back closes the settings")
        saved = await page.evaluate("JSON.parse(localStorage.getItem('stairs.widget.v1'))")
        check(saved["title"] == "המבחן הגדול" and saved["goal"] == goal and saved["theme"] == "pro" and saved["count"] == "up", "the settings are kept")
        await page.click('[data-act="widget"]'); await page.wait_for_selector(".wset-layer .wprev")
        check(await page.input_value('[data-f="title"]') == "המבחן הגדול" and await page.locator(".wprev-wrap .wprev.pro").count() == 1, "they come back when the page opens again")
        await shot_page(page, shots, "widget-settings")
        check(not s.problems, "widget settings: no console errors" + ("" if not s.problems else ": " + "; ".join(s.problems[:5])))
        await ctx.close()

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
