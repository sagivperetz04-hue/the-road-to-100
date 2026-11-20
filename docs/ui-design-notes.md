# UI and design notes from device testing (v3)

Tested on 15 Nov 2026 on an Android 17 emulator (Pixel-size phone, 1080×2400, Android System WebView 145), plus
Playwright at 360×640 and 393×851. The screenshots are in [`device-shots/`](device-shots/).
**Fixed already:** the floating creature (compare `0-v2-floating.png` with `2-start.png`) and the
summary-dependent questions.

**Game-style redesign (later the same day):**
- **Themes:** auto (follows the phone), light, dark and pink (sunshine, rainbow, lollipops, unicorns). Pick one
  with the palette button on the first screen.
- **Look:** chunky 3D cards and buttons, gem letters on the answers, a themed banner, progress bars per course,
  a star burst and a "+1" on correct answers, and a sunburst on the summit.
- **From the list below:** the sun no longer sits behind the streak pill (item 3), and the scene is taller on
  tall phones (part of item 4).
- **After a ChatGPT design review** (the "Design critique improvements" chat in your ChatGPT history):
  - the explanation is always fully visible above the "next" button (item 2 below, now tested);
  - the options you didn't pick stay readable after answering;
  - lighter type for questions, answers and explanations;
  - thinner answer edges and a softer gloss;
  - a shorter scene, so the question starts higher;
  - course details wrap as whole items, and the progress bar shows only once there's a best streak;
  - the unavailable source card is a readable dashed outline;
  - the summit's line is readable, its rays calmer, and the streak stat leads;
  - fainter background patterns, softer grass in light mode, a hairline around dark-mode cards;
  - a short stumble instead of a full fall when a wrong answer comes at streak 0.

  Not taken: neutral answer letters (the coloured gems are the game look), a 20-segment track (the ring already
  shows progress), and removing the "Now Playing" island (it's the app's own feature, not a phone notch).
- **Code:** colours live in `css/app.css` theme tokens and `Art.PALETTES` in `js/art.js`. The drawings (unicorn,
  lollipop, rainbow, sun, moon, climber) are original and also live in `js/art.js`.

Nothing below blocks a release. Ordered by how much each would improve the app.

## Worth doing next

1. **The explanation's "מקור:" line still names the summaries.**
   - What the student sees: "מקור: טבלת ההשוואה ושאלונים משולבים", "מקור: סיכום שיעור 4 – כרתים ומיקני",
     "מקור: סיכום הקריאה – אריסטו…" (see `4-falling.png`).
   - Why it matters: the questions no longer refer to the summaries, but this line does, and for the comparison
     topic it names a table she never sees.
   - Options:
     - show a lecture or reading name instead ("שיעור 4 – כרתים ומיקני", "אריסטו, פואטיקה"), which is a data
       change to `ref` only; or
     - hide the line for generated questions and keep it for real exam questions, where it says which exam.

2. **The bottom of the explanation hides under the "לשאלה הבאה" bar.**
   - Seen after a long explanation on a 1080×2400 screen: the "מקור" line sits under the bar's white gradient
     until she scrolls.
   - Fix: when the bar appears, give `.game-body` enough bottom padding for the bar's real height, or scroll the
     explanation into view.

3. **The sun sits behind the streak pill.**
   - At the top left, the sun and its glow show through the frosted "רצף / שיא" pill on every game screen.
   - Fix: move the sun to the top right, in the open sky above the mountains, or lower its glow.

4. **Unused space on tall phones.**
   - Game screen: the answer card ends at about 75% of the height, leaving a band of empty background below it
     before an answer. The scene is capped at `clamp(190px, 36vh, 330px)`.
   - Fix: raise the cap on tall screens (for example `40vh` above 800px), so the climb gets more room and the
     card sits lower, closer to the thumb.
   - Course list: half the screen is empty under two courses. A small "continue where you left off" row (last
     course, source and best streak) would use it and save three taps.

5. **The app doesn't recover if Android's WebView renderer crashes.**
   - On the emulator's first boot the WebView renderer started broken and the app showed a blank screen until
     restarted.
   - `MainActivity` has no `onRenderProcessGone` handler, so a real renderer crash closes the app.
   - Fix: handle `onRenderProcessGone` by recreating the WebView. Progress is in `localStorage`, so nothing is lost.

## Smaller polish

- **Summit screen** (`6-summit.png`): about a quarter of the screen is empty under the buttons. Moving the content
  block down slightly, or anchoring the two buttons to the bottom like iOS sheet actions, would balance it.
- **"Now Playing" island, screen reader**: it reads "מתנגן עכשיוMarble Steps" as one word, because the two spans
  have no space or separator between them. Add an `aria-label` such as "מתנגן עכשיו: Marble Steps".
- **The fall is short on a real device**: 350 ms after the wrong answer the creature has already landed. The
  shake and the "oops" face carry the moment, but a slightly longer fall (or a short pause at the top before it
  drops) would make the reset easier to read.
- **Mixed Hebrew and Latin topic names** such as "יוון I" render correctly. Keep wrapping Latin in
  `<bdi dir="ltr">` (as the code already does) for any new topic names.

## What looked good

- RTL is correct throughout: the chevrons, the back button direction, the answer letters (א–ד) on the right, and
  the right-aligned option text.
- The correct and wrong states are clear: green with a tick and red with a cross, plus the correct option is
  highlighted after a wrong answer.
- The camera keeps the creature well framed on every stair. Stair numbers and flags every 5 steps give a sense
  of progress.
- The course list's "שיא N ברצף" pills update right away and survive an app update (v2 to v3, tested).

## Testing notes for later

- `tests/device_test.py` drives the real app on a phone or emulator. It needs a debug build
  (`tools/build.sh --debuggable`), which opens the WebView to Chrome DevTools. The release build is unaffected.
- With uiautomator (taps plus the accessibility tree), the WebView's tree often lags seconds behind the screen,
  so it isn't reliable for driving the game. Use DevTools instead.
- Emulator on this PC: it boots only with 1 CPU core and with netsim's features turned off. See the project
  README.

## Premium pass (20 Nov 2026): the design system, frozen

Worked out with an LLM council (five advisors, peer review, chairman) for the start screen, then four review
rounds with GPT-6 Astra; the code was reviewed by GPT-6.1 Sol. Astra's final position: freeze the system; what's
left is device-level (frame pacing and haptic feel on the real phone).

- **One language, three emphasis levels.** Containers: 24px radius, 1px hairline, soft shadow, no lip. Answers:
  18px radius, 2px edge. The primary action: 18px radius, 4px edge + coloured shadow. Pills and badges are flat.
  Gloss only on eyes, gems and the crown.
- **Colour only where it means something.** Neutral 28px answer letters (pink keeps its candy letters on purpose).
  Palette tokens per theme at the end of `app.css` ("PREMIUM PASS").
- **Type scale:** heading 28/34·800, question 23/32·700, answer 18/27·600, explanation 17/27·400, meta 13/20·500.
  16px gutters, 20px card padding, spacing 4/8/12/16/24/32.
- **World:** one light source (upper left). The monster (viewBox 120×128, feet at 60,118) and three-plane stairs
  share materials per theme: light stone, pink candy (icing, sprinkles), dark moonlit (`MAT` in `scene.js`).
- **Game screen:** scene `clamp(180px, 26svh, 224px)`; HUD = ring + "מתוך 20 / שיא N" and a 48px back button;
  scene messages (checkpoint, "עוד תשובה אחת לפסגה") in a reserved strip at the scene bottom; 12px clear gap and
  an 8px fade above the reading area. After an answer the view scrolls only the minimum, never hiding the
  explanation's heading. Celebration effects stay inside the scene.
- **Stair 19:** cool = hell inside the scene only (sky/ground/stone recolour, one skull, a 40px flame line, a lava
  edge, 8 embers; the card stays calm); quiet = golden light.
- **Victory:** the crowned monster, one title, one line, two opaque stat cards, a 56px replay + a quiet text link;
  rays 4%; confetti behind the content (60 pieces, beat bursts, at most 80 alive; quiet: drifting stars).
- **Motion:** press 80ms `cubic-bezier(.2,0,0,1)`, release 140ms `cubic-bezier(.2,.8,.2,1)`, screen entrance
  220ms fade + 12px `cubic-bezier(.22,1,.36,1)`, hop 320ms with a 120ms landing squash; only transform/opacity.
- **Sound and haptics:** music ducks -4 dB (30ms/220ms); short success/wrong motifs; Android semantic haptics
  (CONFIRM, REJECT, EFFECT_HEAVY_CLICK for milestones, THUD primitives for the stair-19 heartbeat on Android 12+);
  nothing vibrates in the background and the touch-feedback setting is respected.

