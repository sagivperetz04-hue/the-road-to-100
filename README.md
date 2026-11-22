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

## Courses

Twelve courses, each with its topics (`content.py courses` lists them with counts): תולדות האדריכלות א' and ב'+ג',
תחנות בתרבות המערב א' and ב', התפתחות זהות בגיל ההתבגרות, מבוא כללי (פילוסופיה, סוציולוגיה ופסיכולוגיה),
הצטיינות ושינוי בחינוך, ייעוץ חינוכי, אוכלוסיות עם לקויות, מתודולוגיה מחקרית א+ב and תרבות חזותית.
"Real" questions come from exams, exam reconstructions, the lecturers' sample questions and graded quizzes (the `ref`
says which); questions from students' practice sets or ChatGPT were rewritten and filed as generated. The course
number (`code`) is optional.

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

To install over an older build, sign with the same keystore and keep the same application id (`APP_ID`, default
`com.plap.studystairs`). The signing key is **not in git**: put `keystore/madregot-release.jks` in place and either
set `KS_PASS` / `KEY_ALIAS` / `KEY_PASS` or create `keystore/signing.properties` with those three lines
(`keystore/` is git-ignored).

**Not in git either: the music.** The songs and the "Fahh" effect listed in `app/assets/audio/manifest.json` are
copyrighted, so `app/assets/audio/music/` and `app/assets/audio/sfx/` are git-ignored. Put your own files there
(same names, or edit the manifest) before building; `validate_data.py` lists anything missing.

## Question updates without a new APK

New questions, topics and courses reach installed apps from this GitHub repo; app code still needs a new APK.

1. Add or edit questions as usual (`tools/content.py ...`). The validator stamps `app/assets/data/version.json`
   (`hash` of all data files, `updated` time, `format`) whenever the data changes.
2. Commit and push to `master`. That's it.

On launch the app checks `raw.githubusercontent.com/.../master/app/assets/data/version.json` at most once an hour.
When it is newer than the data in use, it downloads `courses.json` and every course's files, checks them the way
loading does (every course loads and has questions), and only then switches to them and keeps them in
localStorage (`stairs.data.v1`); a cut or broken download changes nothing. A short notice says "נוספו N שאלות
חדשות". Progress is kept (it's keyed by question id; never renumber ids). An APK whose bundled data is newer wins
over the downloaded copy. `MainActivity` allows exactly one online address: GET of `.json` files under the repo's
`app/assets/data/`; everything else stays blocked, and nothing is ever sent. Only push data that may be public.

## Progress

Progress is stored in `localStorage` on a fixed in-app origin, so it survives app updates:
- per course + source: best streak, number of summits, last topic selection;
- per question: times seen and times answered wrong, plus a learning state (`L` in `stairs.v1`): when it is due
  for review, its interval step, and whether it was "recalled later".

## Learning loop (spaced review and study sessions)

Worked out with GPT-6 Astra from the core-loop / progression ideas on gamedesignskills.com: the climb is the game,
but every answer also builds a learning record that survives falls.

- **Spaced review:** a first correct answer makes a question due tomorrow; a correct answer to a due question moves
  it to 3, 7, then 14 days. A wrong answer makes it due tomorrow. Early practice and retries never move a due date.
- **Picking questions:** due questions first (oldest first), then unseen ones, then the rest (least recently seen
  first). Never the same question twice in a row.
- **Sessions ("סבב"):** 10 distinct questions (or the pool size), counted across falls. A missed question comes back
  once, after 5 other questions, as "ניסיון נוסף" (moves the stairs, not the session count). At 10 a 3-line summary:
  first-try accuracy, new questions, correct scheduled reviews; then keep climbing or finish.
- **Review from the courses screen:** "לחזרה היום: N" in the header and an "N לחזרה היום" row on each course with due
  questions; it starts a review of exactly those questions (all topics, all sources).
- **Topic progress:** a thin bar per topic: seen, and "recalled later" (a correct answer after at least 72 hours
  without seeing the question, following an earlier correct answer; a wrong answer clears it), plus a due chip.
- On the first launch with this version, questions answered wrong before become due at once (no recall credit).

## Self-check ("בוחן עצמי")

A quiet row under the source cards (selected topics, all sources). Needs at least 10 questions; takes 20 (or the
pool size). The batch is fixed before it starts: slots go round-robin over the selected topics in a shuffled order;
inside a topic unseen questions first, then least recently seen, real questions only break ties; then shuffled.
No stairs, no right/wrong cues, no explanations while answering; "הבא" commits the choice. Answers update the
review schedule (it is retrieval practice too) but never the climb records; leaving discards the check.

The results: score, how many questions were new and how many came from real exams, a per-topic breakdown
("לא נבדק בבוחן זה" for topics that got no question), the mistakes with the chosen and correct answers and the
explanation, "כל התשובות", and the last three results. "לתרגול הטעויות" is one pass through the missed questions with
explanations. The last 10 results per course are kept (`checks` in `stairs.v1`) with the questions as answered;
"תוצאות קודמות בקורס" on the source screen reopens them. No readiness percentage or predicted grade, on purpose.

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

## Start screen, modes and difficulty

The loading screen turns into the start screen: the sky card shrinks to the top, the monster takes the crown and
says a line of the day (`LINES` in `app.js`, picked by date), and the two modes rise below. The last-used mode is
the big card. Three independent settings (all in `stairs.v1`):

- **Theme** (`settings.theme`): light, dark, pink; colours, materials and scenery.
- **Presentation mode** (`settings.mode`): **משעמם** (`boring`) is the calm miniature world: no music, golden
  light instead of hell on stair 19, drifting stars on the summit, no bobbing. **למגניבים בלבד** (`cool`): music,
  hell mode on stair 19, beat-synced confetti. The "מצב" pill on the courses screen opens the start screen again.
- **Difficulty** (`settings.difficulty`): **casual** ("עם נקודות שמירה": a wrong answer falls back to the last
  checkpoint, stair 5, 10 or 15) or **hardcore** ("נפילה להתחלה": back to 0). New installs start casual; players
  from before keep hardcore. A run's difficulty is fixed when it starts. Casual summits are counted apart
  (`casualSummits`); the best streak is always real consecutive answers.

## Design system

Reviewed over four rounds with GPT-6 Astra (design) and GPT-6.1 Sol (engineering); see `docs/ui-design-notes.md`.

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

`Reminders.java` shows a notification at 08:00 and at 20:00. The texts in `res/values/strings.xml` are neutral
defaults; personal texts go in `app/res-private/values/strings.xml` (git-ignored, same string names
`reminder_morning` / `reminder_evening`), which the build lays over them. Each alarm books the next day; boot, app updates
and clock changes book both again. Android 13+ asks once for permission to show notifications. On debug builds,
`AndroidBridge.testReminder(0|1)` shows one at once.

## Test on a phone or emulator

```bash
tools/build.sh --debuggable                       # debug build: WebView open to Chrome DevTools
adb install -r build/outputs/the-road-to-100-v4.5-11-debug.apk
python3 tests/device_test.py                      # drives the real app: ground, climb, fall, summit, progress
```

Install the release APK again afterwards (`adb install -r build/outputs/the-road-to-100-v4.5-11.apk`); both are signed with
the same key, so progress is kept. UI and design notes from device testing: `docs/ui-design-notes.md`.

Emulator on Windows with Hyper-V (AMD CPU and GPU): keep the SDK and AVDs in English-only paths
(`ANDROID_AVD_HOME=C:\Android\avd`, `ANDROID_EMULATOR_HOME=C:\Android\emuhome`), and start it with one core and
netsim features off, otherwise it freezes before Android boots:

```bash
emulator -avd madregot_test -no-snapshot -gpu swiftshader_indirect -cores 1 -feature -WiFiPacketStream,-Uwb,-NetsimWebUi,-NetsimCliUi,-Vulkan
```
