#!/usr/bin/env python3
"""Generate multiple-choice questions for one topic with the Claude API (build time only; the APK never calls an API).

    export ANTHROPIC_API_KEY=sk-ant-...
    python3 tools/generate_questions.py arch-history-a stone-age --count 15
    python3 tools/generate_questions.py arch-history-a egypt --count 10 --dry-run   # print the prompt, change nothing

Reads   tools/sources/<course>/<topic>.md | .txt | .pdf   (a PDF needs `pdftotext` or the `pypdf` package)
Writes  app/assets/data/<folder>/questions-generated.json  (appends; skips questions whose text already exists)

Rules sent to the model: facts only from the source, exactly 4 options with plausible distractors,
no "all/none of the above", explanation of at most 2 sentences, Hebrew. Every answer is re-checked here
before it is saved, and tools/validate_data.py runs at the end.
"""
import argparse, json, os, random, re, subprocess, sys, urllib.error, urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from validate_data import giveaway, summary_phrases  # noqa: E402  (same checks the build runs)
from content import id_allocator  # noqa: E402  (shared id numbering with tools/content.py)

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
DATA = os.path.join(ROOT, "app", "assets", "data")
SOURCES = os.path.join(ROOT, "tools", "sources")
API_URL = "https://api.anthropic.com/v1/messages"
BANNED = ("כל התשובות", "כל התשובות נכונות", "אף אחת מהתשובות", "אף תשובה", "כל הנ\"ל", "אף לא אחת", "all of the above", "none of the above")


def load_json(path, default):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        return default


def read_source(course, topic):
    for ext in ("md", "txt", "pdf"):
        path = os.path.join(SOURCES, course, f"{topic}.{ext}")
        if not os.path.exists(path):
            continue
        if ext != "pdf":
            return path, open(path, encoding="utf-8").read()
        try:
            return path, subprocess.run(["pdftotext", "-layout", path, "-"], check=True, capture_output=True, text=True).stdout
        except (OSError, subprocess.CalledProcessError):
            from pypdf import PdfReader  # pip install pypdf
            return path, "\n".join(p.extract_text() or "" for p in PdfReader(path).pages)
    sys.exit(f"no source for {course}/{topic}: put it in tools/sources/{course}/{topic}.md (or .txt / .pdf)")


def norm(s):
    return re.sub(r"[\s\"'״׳.,:;?!()–-]+", " ", s).strip()


def build_prompt(course_name, topic_name, source_text, existing, count):
    have = "\n".join(f"- {q}" for q in existing[:400]) or "(none yet)"
    return f"""You write multiple-choice exam practice questions in Hebrew for a university course.

Course: {course_name}
Topic: {topic_name}

<source>
{source_text}
</source>

Questions that already exist (do not repeat or paraphrase them):
<existing>
{have}
</existing>

Write {count} NEW questions. Rules:
1. Use only facts stated in the source. Nothing from outside knowledge, no guesses.
2. Exactly 4 options. The first option in your list is the correct one; the other 3 are plausible but clearly wrong
   according to the source. Make the wrong options hard: take them from other facts in the same source (another
   site, date, name, phase, quote or term that a student could confuse), never jokes or obviously absurd answers.
   All 4 options must have the same form and similar length; put details in the explanation, not in the answer.
3. Never use "all of the above", "none of the above" or similar options.
4. The explanation says why the answer is right in at most 2 short sentences.
5. Everything in natural, simple Hebrew. Questions should be answerable without seeing the options' order.
6. difficulty: 1 = basic fact, 2 = needs understanding, 3 = detail or comparison.
7. The student sees only the question in an app, never this summary. Ask about the material itself. Never refer
   to the summary's structure: its headings ("לזכור למבחן", "בשורה אחת"), its tables or their columns
   ("טבלת ההשוואה", "מילת מפתח", "משפט לזכור"), "the lesson" or "the course". Options must be real answers,
   not labels copied from a table.

Reply with JSON only, no prose, in this shape:
[{{"q": "...", "options": ["correct", "wrong", "wrong", "wrong"], "explanation": "...", "difficulty": 2}}]"""


def call_claude(prompt, model, max_tokens=8000):
    key = os.environ.get("ANTHROPIC_API_KEY")
    if not key:
        sys.exit("set ANTHROPIC_API_KEY first (the key is only used here, at build time)")
    body = json.dumps({"model": model, "max_tokens": max_tokens, "messages": [{"role": "user", "content": prompt}]}).encode()
    req = urllib.request.Request(API_URL, data=body, headers={
        "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=300) as r:
            data = json.load(r)
    except urllib.error.HTTPError as e:
        sys.exit(f"API error {e.code}: {e.read().decode(errors='replace')[:500]}")
    text = "".join(part.get("text", "") for part in data.get("content", []) if part.get("type") == "text")
    m = re.search(r"\[.*\]", text, flags=re.S)
    if not m:
        sys.exit("the model did not return a JSON array:\n" + text[:800])
    return json.loads(m.group(0))


def check_item(it):
    """Return None if the generated item is usable, else the reason."""
    if not isinstance(it, dict):
        return "not an object"
    q, opts, ex = str(it.get("q", "")).strip(), it.get("options"), str(it.get("explanation", "")).strip()
    if not q:
        return "empty question"
    if not isinstance(opts, list) or len(opts) != 4:
        return "needs exactly 4 options"
    clean = [str(o).strip() for o in opts]
    if any(not o for o in clean) or len(set(clean)) != 4:
        return "options must be non-empty and distinct"
    if any(b in o.lower() for o in clean for b in BANNED):
        return "'all/none of the above' is not allowed"
    if not ex:
        return "missing explanation"
    if giveaway(clean, 0):
        return "the correct option is much longer than the others"
    hits = summary_phrases({"q": q, "options": clean, "explanation": ex})
    if hits:
        return f"refers to the summary (\"{hits[0][1]}\")"
    if len([s for s in re.split(r"[.!?](?:\s|$)", ex) if s.strip()]) > 2:
        return "explanation longer than 2 sentences"
    if it.get("difficulty") not in (1, 2, 3):
        it["difficulty"] = 2
    return None


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("course", help="course folder, e.g. arch-history-a")
    ap.add_argument("topic", help="topic id from course.json, e.g. stone-age")
    ap.add_argument("--count", type=int, default=15)
    ap.add_argument("--model", default=os.environ.get("CLAUDE_MODEL", "claude-sonnet-5-5"))
    ap.add_argument("--ref", help='where the questions come from (default: first heading of the source file)')
    ap.add_argument("--dry-run", action="store_true", help="print the prompt and exit")
    a = ap.parse_args()

    manifest = load_json(os.path.join(DATA, "courses.json"), [])
    entry = next((c for c in manifest if c["folder"] == a.course or c["id"] == a.course), None)
    if not entry:
        sys.exit(f"course '{a.course}' is not in app/assets/data/courses.json")
    folder = os.path.join(DATA, entry["folder"])
    course = load_json(os.path.join(folder, "course.json"), None)
    topic = next((t for t in course["topics"] if t["id"] == a.topic), None)
    if not topic:
        sys.exit(f"topic '{a.topic}' is not in {entry['folder']}/course.json")

    src_path, source_text = read_source(entry["folder"], a.topic)
    heading = re.search(r"^#\s+(.+)$", source_text, flags=re.M)
    ref = a.ref or (heading.group(1).strip() if heading else os.path.basename(src_path))

    gen_path = os.path.join(folder, "questions-generated.json")
    questions = load_json(gen_path, [])
    real = load_json(os.path.join(folder, "questions-real.json"), [])
    existing_texts = [q["q"] for q in questions + real if q.get("topic") == a.topic]
    seen = {norm(q["q"]) for q in questions}

    prompt = build_prompt(course["name"], topic["name"], source_text, existing_texts, a.count)
    if a.dry_run:
        print(prompt)
        return

    items = call_claude(prompt, a.model)

    # ids continue the course's numbering, e.g. arch-a-gen-0186 (course.json idPrefix, never reused)
    next_id = id_allocator(course, folder, "generated")
    added, skipped = 0, []
    rng = random.Random()
    for it in items:
        why = check_item(it)
        if why:
            skipped.append(why); continue
        key = norm(it["q"])
        if key in seen:
            skipped.append("duplicate question text"); continue
        opts = [str(o).strip() for o in it["options"]]
        correct = opts[0]
        rng.shuffle(opts)
        questions.append({"id": next_id(), "topic": a.topic, "source": "generated", "q": it["q"].strip(),
                          "options": opts, "answer": opts.index(correct), "explanation": it["explanation"].strip(),
                          "ref": ref, "difficulty": int(it["difficulty"])})
        seen.add(key); added += 1

    with open(gen_path, "w", encoding="utf-8", newline="\n") as f:
        json.dump(questions, f, ensure_ascii=False, indent=1)
    print(f"added {added} question(s) to {entry['folder']}/{a.topic}; skipped {len(skipped)}" + (f" ({', '.join(sorted(set(skipped)))})" if skipped else ""))
    sys.exit(subprocess.call([sys.executable, os.path.join(ROOT, "tools", "validate_data.py")]))


if __name__ == "__main__":
    main()
