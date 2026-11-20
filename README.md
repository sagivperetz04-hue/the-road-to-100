# The Road To 100 – multi-course study quiz (Android, Hebrew RTL)

(Formerly "מדרגות". The app id `com.plap.studystairs` and the `madregot` keystore keep their old names on purpose:
updates must use the same id and signing key.)

An Android app: one Activity hosting a WebView that runs a self-contained HTML/JS game from `app/assets`.
Pick a course, the topics, and real or generated questions. Every correct answer is one stair up, and a wrong
answer drops the climber back to the bottom. 20 correct in a row reaches the summit:
**"ציציפלצת האולטימטיבית"**. Everything runs offline.

## Layout

```
app/
  AndroidManifest.xml, version.properties, res/ (icon, theme)
  java/com/plap/studystairs/MainActivity.java   WebView + in-app asset server + hardware Back + haptics
  assets/
    index.html, css/app.css, js/*.js            the game (4 screens, iOS look, RTL)
    fonts/                                      Heebo (Hebrew) + Inter (Latin), bundled
    audio/manifest.json                         music, clips and sound effects (see audio/README.md)
    data/courses.json                           course manifest
    data/<folder>/course.json                   topics
    data/<folder>/questions-real.json           real exam / quiz / lecturer questions
    data/<folder>/questions-generated.json      AI-generated questions
tools/
  validate_data.py      data checks + counts table (the build stops on any error)
  generate_questions.py Claude API generator (build time only)
  sources/<course>/<topic>.md   source material for the generator
  build.sh              validate -> aapt2 -> javac -> d8 -> zipalign -> apksigner
tests/
  e2e_test.py           Playwright: every source to the summit at 393x851, Back button, layout checks at 360x640 and 393x851
  fixtures/             a test course with real + generated questions
keystore/madregot-release.jks   signing key. Keep it: updates must be signed with the same key.
```

## Add courses, topics and questions (no code changes)

`tools/content.py` does it for you: it writes the JSON, picks ids, checks everything with the build's own rules
(plus duplicate questions) before writing, and runs the validator at the end.

```bash
python3 tools/content.py courses          # what exists: courses, topics (ids + names), question counts, sources

# a new course, with its topics (נושאים)
python3 tools/content.py add-course art-history-b --name "תולדות האמנות ב'" --code 0881120702 \
    --prefix art-b --color "#FF2D55" --icon columns --subtitle "מהרנסנס עד הבארוק" \
    --topic "renaissance=הרנסנס" --topic "baroque=הבארוק"

# one more topic; --order puts it at that position (default: last)
python3 tools/content.py add-topic art-history-b mannerism --name "מנייריזם" --note "בין הרנסנס לבארוק" --order 2

# one question (--topic takes the id or the Hebrew name; --source real is the default)
python3 tools/content.py add-question art-history-b --topic הרנסנס \
    --q "מי צייר את תקרת הקפלה הסיסטינית?" --correct "מיכלאנג'לו" \
    --wrong "רפאל" --wrong "לאונרדו" --wrong "טיציאן" \
    --explanation "מיכלאנג'לו צייר את התקרה בין 1508 ל-1512." --ref "מבחן 2025 מועד א שאלה 2" --difficulty 1
```

**Many questions at once, from a spreadsheet** (the easiest way to add real exam questions):

```bash
python3 tools/content.py template arch-history-a          # writes arch-history-a-questions.csv and lists the topics
# fill it in Excel or Google Sheets, save as "CSV UTF-8", then:
python3 tools/content.py import arch-history-a arch-history-a-questions.csv --dry-run   # check only
python3 tools/content.py import arch-history-a arch-history-a-questions.csv
```

Columns (Hebrew or English headers): נושא / topic, שאלה / question, תשובה נכונה / correct, מסיח 1–3 / wrong1–3,
הסבר / explanation, מקור / ref, רמה / difficulty (1–3, default 2), סוג / source (אמיתית or כללית, default
אמיתית). The answer order in the file does not matter; the app shuffles it. If any row has a problem, nothing is
written and every problem is listed with its row number.

Notes:
- Ids are lowercase English (`art-history-b`, `rome-1`); names are free Hebrew text.
- Question ids continue each course's numbering from `idPrefix` in `course.json` (`arch-a-real-0001`, …) and are
  never reused, since progress is stored per id. Don't renumber them.
- `add-course` and `add-topic` create an empty `tools/sources/<course>/<topic>.md` for the question generator.
  Paste the material there, then run `generate_questions.py` (below).
- `course.json` fields: `name`, `code`, optional `subtitle`, `color` (hex), `icon` (`columns`, `scroll`, `book`),
  `idPrefix`, and per topic `id`, `name`, `order`, optional `note`.
- Then build: `tools/build.sh --bump`. `tests/content_test.py` tests the tool on a throwaway copy.

## Question format

```json
{ "id": "arch-a-real-0001", "topic": "egypt", "source": "real",
  "q": "question text", "options": ["...", "...", "...", "..."], "answer": 2,
  "explanation": "one or two sentences", "ref": "מבחן 2024 מועד א שאלה 3", "difficulty": 2 }
```

The `id` must be unique across the whole app. `answer` is the index into `options`, and the app shuffles the
option order every time. `source` must match the file the question is in.

## Generate questions

```bash
export ANTHROPIC_API_KEY=...            # used only on your computer, never inside the APK
python3 tools/generate_questions.py arch-history-a egypt --count 15
python3 tools/generate_questions.py arch-history-a egypt --dry-run   # just print the prompt
```

The generator reads `tools/sources/<course>/<topic>.md|txt|pdf`. It re-checks every item: 4 distinct options,
no "all/none of the above", an explanation of at most 2 sentences, and no duplicate text. Then it appends to
`questions-generated.json` and runs the validator.

## Build

```bash
export ANDROID_HOME=/path/to/android-sdk   # needs build-tools/<ver>/ and platforms/android-35/android.jar
tools/build.sh --bump          # bump versionCode, validate, build, sign -> build/outputs/the-road-to-100-vX.Y-N.apk
tools/build.sh --bump --test   # also run the Playwright test first (pip install playwright; uses installed Chrome)
```

On Windows, run it from Git Bash (`ANDROID_HOME=/c/Android/sdk bash tools/build.sh --bump`). The script finds
`d8.bat`/`apksigner.bat`, needs no `zip`, and uses `.venv` (with Playwright) for Python when it exists. Keep the
project and the SDK in folders whose paths are English letters only.

To install over an older build, sign with the same keystore (`KEYSTORE`, `KS_PASS`, `KEY_ALIAS`, `KEY_PASS`)
and keep the same application id (`APP_ID`, default `com.plap.studystairs`).

## Progress

Progress is stored in `localStorage` on a fixed in-app origin, so it survives app updates:
- per course + source: best streak, number of summits, last topic selection;
- per question: times seen and times answered wrong. Questions she got wrong come up about twice as often,
  and the same question never appears twice in a row.

## Themes

Four themes, picked with the palette button on the first screen and saved with the progress: **auto** (follows the
phone's dark mode, through `AndroidBridge.isNightMode()`), **light**, **dark** and **pink** (sunshine, rainbow,
lollipops and unicorns). The theme is set as `<html data-theme="light|dark|pink">`:

- `css/app.css`: colour tokens per theme at the top; every component uses them;
- `js/art.js`: the drawings and `Art.PALETTES` (scene, banner and picker colours);
- `js/scene.js`: draws the staircase world in the current theme;
- `js/theme.js`: the setting, the "auto" logic, and Android's status/navigation bar colours.

To add a theme: add a `[data-theme="name"]` token block in `app.css`, a palette in `Art.PALETTES`, a colour in
`BARS` in `theme.js`, and an entry in `THEME_INFO` in `app.js`. The e2e test screenshots every screen in every
theme (`build/screenshots/theme-*`).

## Modes

The app opens on a mode screen (every launch; the last choice is marked). It is saved as `settings.mode`:
- **משעמם** (`boring`): no music at all, no hell mode on stair 19, no music tab. Sound effects stay.
- **למגניבים בלבד** (`cool`): everything below.

The "מצב" pill on the courses screen goes back to the mode screen.

## Music

Background music (per screen: menu / game / summit), the last-stair track, 5-second milestone clips and sound
effects are listed in `app/assets/audio/manifest.json`; see `app/assets/audio/README.md`. Now: three songs as
background music on the menus and in the game (a song keeps playing between them), "6 AM" on the summit, the BFG
Division mashup on stair 19 (hell mode, 300%, even when muted) and "Fahh" on a wrong answer. Adding or swapping
files needs no code changes; `validate_data.py` checks the manifest.

Only one song plays at a time: each audio element fades on its own and every older song is retired when a new one
starts (`Sound.debugPlaying()` lists what is playing; the tests check it).

**Music tab** (second tab on the home screen, Spotify style): the current song with play/pause, next, previous,
shuffle and a seek bar; the playlist (tap a song to play it, the tick adds or removes it from the menu/game
rotation); and pickers for the summit song and the stair-19 song. A mini player sits above the tabs on the courses
tab. The choices are saved as `settings.musicPrefs` (`null` = the manifest's choice).

## Daily reminders

`Reminders.java` shows a notification at 08:00 ("בוקר טוב, תתחילי ללמוד") and 20:00 ("ערב טוב,
תעשי משחק לפני השינה"); the texts are in `res/values/strings.xml`. Each alarm books the next day; boot, app updates
and clock changes book both again. Android 13+ asks once for permission to show notifications. On debug builds,
`AndroidBridge.testReminder(0|1)` shows one at once.

## Test on a phone or emulator

```bash
tools/build.sh --debuggable                       # debug build: WebView open to Chrome DevTools
adb install -r build/outputs/the-road-to-100-v3.1-4-debug.apk
python3 tests/device_test.py                      # drives the real app: ground, climb, fall, summit, progress
```

Install the release APK again afterwards (`adb install -r build/outputs/the-road-to-100-v3.1-4.apk`); both are signed with
the same key, so progress is kept. UI and design notes from device testing: `docs/ui-design-notes.md`.

Emulator on Windows with Hyper-V (AMD CPU and GPU): keep the SDK and AVDs in English-only paths
(`ANDROID_AVD_HOME=C:\Android\avd`, `ANDROID_EMULATOR_HOME=C:\Android\emuhome`), and start it with one core and
netsim features off, otherwise it freezes before Android boots:

```bash
emulator -avd madregot_test -no-snapshot -gpu swiftshader_indirect -cores 1 -feature -WiFiPacketStream,-Uwb,-NetsimWebUi,-NetsimCliUi,-Vulkan
```
