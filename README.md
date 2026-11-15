# מדרגות – multi-course study quiz (Android, Hebrew RTL)

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
    audio/manifest.json                         optional 5-second clips (empty = built-in jingles)
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

## Add a course (no code changes)

1. Create `app/assets/data/<folder>/` with `course.json`, `questions-real.json` (can be `[]`) and `questions-generated.json`.
2. Add one line to `app/assets/data/courses.json`:
   `{ "id": "my-course", "code": "0123456789", "name": "שם הקורס", "folder": "my-course" }`
3. Run `python3 tools/validate_data.py`, then `tools/build.sh --bump`.

`course.json` also accepts the optional fields `subtitle`, `color` (hex), `icon` (`columns`, `scroll`, `book`) and per-topic `note`.

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
tools/build.sh --bump          # bump versionCode, validate, build, sign -> build/outputs/madregot-v2.0-N.apk
tools/build.sh --bump --test   # also run the Playwright test first (pip install playwright; uses installed Chrome)
```

To install over an older build, sign with the same keystore (`KEYSTORE`, `KS_PASS`, `KEY_ALIAS`, `KEY_PASS`)
and keep the same application id (`APP_ID`, default `com.plap.studystairs`).

## Progress

Progress is stored in `localStorage` on a fixed in-app origin, so it survives app updates:
- per course + source: best streak, number of summits, last topic selection;
- per question: times seen and times answered wrong. Questions she got wrong come up about twice as often,
  and the same question never appears twice in a row.
