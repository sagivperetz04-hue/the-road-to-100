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
