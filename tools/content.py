#!/usr/bin/env python3
"""Add courses, topics (נושאים) and questions without editing JSON by hand.

    python3 tools/content.py courses                                   # what exists: courses, topics, counts
    python3 tools/content.py add-course art-b --name "תולדות האמנות ב'" --code 0881120702 \\
            --topic "renaissance=הרנסנס" --topic "baroque=הבארוק" [--subtitle ... --color "#FF2D55" --icon columns]
    python3 tools/content.py add-topic arch-history-a rome-1 --name "רומא I" [--note "..." --order 7]
    python3 tools/content.py add-question arch-history-a --topic egypt --source real \\
            --q "..." --correct "..." --wrong "..." --wrong "..." --wrong "..." \\
            --explanation "..." --ref "מבחן 2024 מועד א שאלה 3" [--difficulty 2]
    python3 tools/content.py template arch-history-a [--out questions.csv]  # a CSV to fill in Excel / Google Sheets
    python3 tools/content.py import arch-history-a questions.csv [--source real] [--dry-run]

Everything is checked before it is written (the same rules as tools/validate_data.py, plus duplicate questions),
and an import with any bad row writes nothing. Ids continue each course's numbering (e.g. arch-a-real-0001) and
are never reused. Each command ends by running the validator.

CSV columns (Hebrew or English headers; one question per row):
    topic / נושא          topic id or topic name
    question / שאלה
    correct / תשובה נכונה
    wrong1..wrong3 / מסיח 1..3
    explanation / הסבר     at most two sentences
    ref / מקור             e.g. "מבחן 2024 מועד א שאלה 3"
    difficulty / רמה       1, 2 or 3 (default 2)
    source / סוג           real / generated, or אמיתית / כללית (default: --source, else real)
Save it as "CSV UTF-8". The app shuffles the options, so their order in the file does not matter.
"""
import argparse, csv, io, json, os, random, re, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, ".."))
DATA = os.path.join(ROOT, "app", "assets", "data")
SOURCES = os.path.join(ROOT, "tools", "sources")
sys.path.insert(0, HERE)
from validate_data import summary_phrases  # noqa: E402

FILES = {"real": "questions-real.json", "generated": "questions-generated.json"}
TAG = {"real": "real", "generated": "gen"}
ICONS = ("columns", "scroll", "book")
BANNED = ("כל התשובות", "אף אחת מהתשובות", "אף תשובה", "כל הנ\"ל", "אף לא אחת", "all of the above", "none of the above")
ID_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
SOURCE_WORDS = {"real": "real", "אמיתית": "real", "אמיתי": "real", "generated": "generated", "gen": "generated",
                "כללית": "generated", "כללי": "generated", "מחוללת": "generated", "מחולל": "generated"}
HEADERS = {
    "topic": ("topic", "נושא"), "q": ("question", "q", "שאלה"), "correct": ("correct", "תשובה נכונה", "נכונה"),
    "wrong1": ("wrong1", "wrong 1", "מסיח 1", "מסיח1"), "wrong2": ("wrong2", "wrong 2", "מסיח 2", "מסיח2"),
    "wrong3": ("wrong3", "wrong 3", "מסיח 3", "מסיח3"), "explanation": ("explanation", "הסבר"),
    "ref": ("ref", "source ref", "מקור"), "difficulty": ("difficulty", "רמה", "קושי"), "source": ("source", "סוג"),
}


# ------------------------------------------------------------------ files
def load(path, default=None):
    try:
        with open(path, encoding="utf-8-sig") as f:
            return json.load(f)
    except FileNotFoundError:
        if default is not None:
            return default
        raise


def save(path, data, indent):
    """Write JSON the way the repo already stores it (UTF-8, Hebrew unescaped)."""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    text = json.dumps(data, ensure_ascii=False, indent=indent)
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write(text + ("\n" if indent == 2 else ""))


def manifest():
    return load(os.path.join(DATA, "courses.json"), [])


def find_course(key):
    """A course by id, folder or exact name -> (manifest entry, folder path, course.json dict)."""
    for e in manifest():
        if key in (e.get("id"), e.get("folder"), e.get("name")):
            folder = os.path.join(DATA, e["folder"])
            return e, folder, load(os.path.join(folder, "course.json"))
    sys.exit(f"no course '{key}'. Courses: " + ", ".join(e["id"] for e in manifest()))


def norm(s):
    return re.sub(r"\s+", " ", str(s)).strip()


# ------------------------------------------------------------------ ids
def id_prefix(course, folder, source):
    """'arch-a-real-' style prefix: course.json idPrefix, else the prefix already used in that file or the other one."""
    tag = TAG[source]
    if course.get("idPrefix"):
        return f"{course['idPrefix']}-{tag}-"
    for s in (source, "generated" if source == "real" else "real"):
        for q in load(os.path.join(folder, FILES[s]), []):
            m = re.match(r"^(.*)-(real|gen)-\d+$", q.get("id", ""))
            if m:
                return f"{m.group(1)}-{tag}-"
    return f"{course['id']}-{tag}-"


def all_ids():
    ids = set()
    for e in manifest():
        for f in FILES.values():
            ids.update(q.get("id") for q in load(os.path.join(DATA, e["folder"], f), []))
    return ids


def id_allocator(course, folder, source):
    """Returns next() -> a fresh id. Numbers continue after the highest used one, so ids are never reused."""
    prefix = id_prefix(course, folder, source)
    taken = all_ids()
    nums = [int(i[len(prefix):]) for i in taken if i and i.startswith(prefix) and i[len(prefix):].isdigit()]
    state = {"n": max(nums, default=0)}
    def nxt():
        while True:
            state["n"] += 1
            qid = f"{prefix}{state['n']:04d}"
            if qid not in taken:
                taken.add(qid)
                return qid
    return nxt


# ------------------------------------------------------------------ checks
def check_question(item, topic_ids):
    """Problems with one question dict (q, options, answer, explanation, ref, difficulty, topic); [] if fine."""
    errs = []
    if item.get("topic") not in topic_ids:
        errs.append(f"unknown topic '{item.get('topic')}' (topics: {', '.join(topic_ids)})")
    if not norm(item.get("q", "")):
        errs.append("empty question")
    opts = [norm(o) for o in item.get("options", [])]
    if len(opts) != 4 or any(not o for o in opts):
        errs.append("needs a correct answer and exactly 3 wrong answers, none empty")
    elif len(set(opts)) != 4:
        errs.append("the 4 answers must be different")
    if any(b in o.lower() for o in opts for b in BANNED):
        errs.append("'all/none of the above' answers are not allowed")
    ex = norm(item.get("explanation", ""))
    if not ex:
        errs.append("empty explanation")
    elif len([s for s in re.split(r"[.!?](?:\s|$)", ex) if s.strip()]) > 2:
        errs.append("explanation longer than 2 sentences")
    if not norm(item.get("ref", "")):
        errs.append("empty ref (where the question comes from)")
    if item.get("difficulty") not in (1, 2, 3):
        errs.append("difficulty must be 1, 2 or 3")
    for field, phrase in summary_phrases({"q": item.get("q"), "options": opts, "explanation": ex}):
        errs.append(f"{field} refers to the summary (\"{phrase}\"); ask about the material itself")
    return errs


def make_question(qid, source, topic, q, correct, wrongs, explanation, ref, difficulty, rng=random):
    opts = [norm(correct)] + [norm(w) for w in wrongs]
    shuffled = opts[:]
    rng.shuffle(shuffled)
    return {"id": qid, "topic": topic, "source": source, "q": norm(q), "options": shuffled,
            "answer": shuffled.index(opts[0]) if opts[0] in shuffled else 0,
            "explanation": norm(explanation), "ref": norm(ref), "difficulty": difficulty}


def add_questions(entry, folder, course, rows, write=True):
    """rows: list of dicts with topic, source, q, correct, wrongs, explanation, ref, difficulty.
    Checks everything first; writes only if every row is fine. Returns the number added."""
    topic_ids = [t["id"] for t in course.get("topics", [])]
    existing = {s: load(os.path.join(folder, FILES[s]), []) for s in FILES}
    seen = {norm(q["q"]) for s in FILES for q in existing[s]}
    alloc = {s: id_allocator(course, folder, s) for s in FILES}
    new = {s: [] for s in FILES}
    problems = []
    for n, r in enumerate(rows, 1):
        where = r.get("_where", f"question {n}")
        if r.get("source") not in FILES:
            problems.append(f"{where}: source must be real or generated (got '{r.get('source')}')")
            continue
        item = make_question("?", r["source"], r.get("topic"), r.get("q", ""), r.get("correct", ""), r.get("wrongs", []),
                             r.get("explanation", ""), r.get("ref", ""), r.get("difficulty"))
        errs = check_question(item, topic_ids)
        if norm(item["q"]) in seen:
            errs.append("the same question text already exists in this course")
        if errs:
            problems += [f"{where}: {e}" for e in errs]
            continue
        seen.add(norm(item["q"]))
        item["id"] = alloc[r["source"]]()
        new[r["source"]].append(item)
    if problems:
        print(f"nothing written: {len(problems)} problem(s)", file=sys.stderr)
        for p in problems:
            print("  - " + p, file=sys.stderr)
        sys.exit(1)
    for s in FILES:
        if new[s] and write:
            save(os.path.join(folder, FILES[s]), existing[s] + new[s], indent=1)
    for s in FILES:
        for q in new[s]:
            print(f"  + {q['id']}  [{q['topic']}]  {q['q'][:60]}")
    return sum(len(v) for v in new.values())


def topic_by_key(course, key):
    key = norm(key)
    for t in course.get("topics", []):
        if key in (t["id"], norm(t.get("name", ""))):
            return t["id"]
    return key   # reported as unknown by check_question


def validate():
    sys.stdout.flush()
    env = dict(os.environ, PYTHONUTF8="1", PYTHONIOENCODING="utf-8")
    return subprocess.call([sys.executable, os.path.join(HERE, "validate_data.py")], env=env)


# ------------------------------------------------------------------ commands
def cmd_courses(a):
    for e in manifest():
        folder = os.path.join(DATA, e["folder"])
        course = load(os.path.join(folder, "course.json"))
        qs = {s: load(os.path.join(folder, FILES[s]), []) for s in FILES}
        print(f"\n{e['id']}  ({e['name']}, {e['code']})   ids: {id_prefix(course, folder, 'real')}NNNN, {id_prefix(course, folder, 'generated')}NNNN")
        for t in sorted(course.get("topics", []), key=lambda t: t.get("order", 0)):
            r = sum(q["topic"] == t["id"] for q in qs["real"]); g = sum(q["topic"] == t["id"] for q in qs["generated"])
            src = source_state(e["folder"], t["id"])
            print(f"  {t.get('order', ''):>2}. {t['id']:<16} {t['name']:<34} real {r:>3}  generated {g:>3}   {src}")


STUB_MARK = "<!-- Paste the material for this topic here."


def source_state(folder, topic_id):
    """For the generator: is there material for this topic? 'source ✓', 'source empty' or 'no source'."""
    for x in (".md", ".txt", ".pdf"):
        p = os.path.join(SOURCES, folder, topic_id + x)
        if os.path.exists(p):
            if x == ".pdf":
                return "source ✓"
            text = open(p, encoding="utf-8").read()
            body = re.sub(r"^#.*$", "", re.sub(r"<!--.*?-->", "", text, flags=re.S), flags=re.M).strip()
            return "source ✓" if body else "source empty"
    return "no source"


def parse_topic_arg(s):
    if "=" not in s:
        sys.exit(f"--topic needs id=name, e.g. --topic \"renaissance=הרנסנס\" (got '{s}')")
    tid, name = s.split("=", 1)
    return tid.strip(), name.strip()


def check_id(kind, value):
    if not ID_RE.match(value or ""):
        sys.exit(f"{kind} id '{value}' must be lowercase English letters, digits and dashes, e.g. 'rome-1'")


def cmd_add_course(a):
    check_id("course", a.id)
    man = manifest()
    if any(a.id in (e["id"], e["folder"]) for e in man):
        sys.exit(f"course '{a.id}' already exists")
    if a.color and not re.match(r"^#[0-9A-Fa-f]{6}$", a.color):
        sys.exit("--color must look like #FF9500")
    prefix = a.prefix or a.id
    check_id("prefix", prefix)
    topics = []
    for i, s in enumerate(a.topic or [], 1):
        tid, name = parse_topic_arg(s)
        check_id("topic", tid)
        topics.append({"id": tid, "name": name, "order": i})
    if len({t["id"] for t in topics}) != len(topics):
        sys.exit("topic ids must be different")
    course = {"id": a.id, "name": a.name, "code": a.code}
    for k in ("subtitle", "color", "icon"):
        if getattr(a, k):
            course[k] = getattr(a, k)
    course["idPrefix"] = prefix
    course["topics"] = topics
    folder = os.path.join(DATA, a.id)
    save(os.path.join(folder, "course.json"), course, indent=2)
    for f in FILES.values():
        save(os.path.join(folder, f), [], indent=1)
    for t in topics:
        stub_source(a.id, t)
    man.append({"id": a.id, "code": a.code, "name": a.name, "folder": a.id})
    save(os.path.join(DATA, "courses.json"), man, indent=2)
    print(f"created course {a.id} with {len(topics)} topic(s); ids will look like {prefix}-real-0001")
    if not topics:
        print("next: add at least one topic (add-topic), the build needs one")
    sys.exit(validate())


def stub_source(course_id, topic):
    """An empty source file for the question generator, so it is obvious where the material goes."""
    path = os.path.join(SOURCES, course_id, topic["id"] + ".md")
    if os.path.exists(path):
        return
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write(f"# {topic['name']}\n\n<!-- Paste the material for this topic here. generate_questions.py writes questions only "
                f"from what is in this file. -->\n")
    print(f"  source file for the generator: tools/sources/{course_id}/{topic['id']}.md")


def cmd_add_topic(a):
    entry, folder, course = find_course(a.course)
    check_id("topic", a.topic_id)
    topics = course.setdefault("topics", [])
    if any(t["id"] == a.topic_id for t in topics):
        sys.exit(f"topic '{a.topic_id}' already exists in {entry['id']}")
    order = a.order if a.order is not None else max((t.get("order", 0) for t in topics), default=0) + 1
    for t in topics:                       # make room when inserting in the middle
        if a.order is not None and t.get("order", 0) >= order:
            t["order"] = t.get("order", 0) + 1
    t = {"id": a.topic_id, "name": a.name, "order": order}
    if a.note:
        t["note"] = a.note
    topics.append(t)
    topics.sort(key=lambda x: x.get("order", 0))
    save(os.path.join(folder, "course.json"), course, indent=2)
    print(f"added topic {a.topic_id} ('{a.name}') to {entry['id']} at position {order}")
    stub_source(entry["folder"], t)
    sys.exit(validate())


def cmd_add_question(a):
    entry, folder, course = find_course(a.course)
    if len(a.wrong or []) != 3:
        sys.exit("give exactly 3 --wrong answers")
    row = {"topic": topic_by_key(course, a.topic), "source": a.source, "q": a.q, "correct": a.correct, "wrongs": a.wrong,
           "explanation": a.explanation, "ref": a.ref, "difficulty": a.difficulty}
    n = add_questions(entry, folder, course, [row])
    print(f"added {n} question to {entry['id']}")
    sys.exit(validate())


def cmd_template(a):
    entry, folder, course = find_course(a.course)
    out = a.out or os.path.join(ROOT, f"{entry['id']}-questions.csv")
    topics = sorted(course.get("topics", []), key=lambda t: t.get("order", 0))
    with open(out, "w", encoding="utf-8-sig", newline="") as f:   # BOM: Excel then opens the Hebrew correctly
        w = csv.writer(f)
        w.writerow(["נושא", "שאלה", "תשובה נכונה", "מסיח 1", "מסיח 2", "מסיח 3", "הסבר", "מקור", "רמה", "סוג"])
        ex = topics[0]["name"] if topics else ""
        w.writerow([ex, "(דוגמה – למחוק) מי תכנן את מתחם הקבר של ג'וסר?", "אימחוטפ", "סנמוט", "מנס", "סנפרו",
                    "אימחוטפ הוא האדריכל הראשון הידוע לנו בשמו.", "מבחן 2024 מועד א שאלה 3", 1, "אמיתית"])
    print(f"wrote {out}")
    print("topics (write the id or the name in the נושא column):")
    for t in topics:
        print(f"  {t['id']:<16} {t['name']}")
    print("rows whose question starts with '(דוגמה' are skipped by import")


def read_rows(path, default_source):
    if path.lower().endswith(".json"):
        data = load(path)
        rows = []
        for i, d in enumerate(data, 1):
            rows.append({"_where": f"item {i}", "topic": d.get("topic"), "q": d.get("q") or d.get("question", ""),
                         "correct": d.get("correct", ""), "wrongs": d.get("wrong") or d.get("wrongs") or [],
                         "explanation": d.get("explanation", ""), "ref": d.get("ref", ""),
                         "difficulty": int(d.get("difficulty") or 2),
                         "source": SOURCE_WORDS.get(str(d.get("source") or default_source).strip().lower())})
        return rows
    with open(path, encoding="utf-8-sig", newline="") as f:
        text = f.read()
    dialect = csv.Sniffer().sniff(text.splitlines()[0], delimiters=",;\t") if text.strip() else csv.excel
    reader = csv.reader(io.StringIO(text), dialect)
    header = [norm(h).lower() for h in next(reader, [])]
    col = {}
    for key, names in HEADERS.items():
        for i, h in enumerate(header):
            if h in names:
                col[key] = i
    missing = [k for k in ("topic", "q", "correct", "wrong1", "wrong2", "wrong3", "explanation", "ref") if k not in col]
    if missing:
        sys.exit(f"{path}: missing column(s) {missing}. Run the 'template' command for a file with the right headers.")
    rows = []
    for n, cells in enumerate(reader, 2):
        get = lambda k: cells[col[k]].strip() if k in col and col[k] < len(cells) else ""
        if not any(c.strip() for c in cells) or get("q").startswith("(דוגמה"):
            continue
        diff = get("difficulty") or "2"
        src = get("source") or default_source
        rows.append({"_where": f"row {n}", "topic": get("topic"), "q": get("q"), "correct": get("correct"),
                     "wrongs": [get("wrong1"), get("wrong2"), get("wrong3")], "explanation": get("explanation"),
                     "ref": get("ref"), "difficulty": int(diff) if diff.isdigit() else diff,
                     "source": SOURCE_WORDS.get(src.strip().lower(), src)})
    return rows


def cmd_import(a):
    entry, folder, course = find_course(a.course)
    rows = read_rows(a.file, a.source)
    for r in rows:
        r["topic"] = topic_by_key(course, r["topic"] or "")
    if not rows:
        sys.exit("no question rows found")
    if a.dry_run:
        n = add_questions(entry, folder, course, rows, write=False)
        print(f"dry run: all {n} question(s) are fine; nothing was written")
        return
    n = add_questions(entry, folder, course, rows)
    print(f"imported {n} question(s) into {entry['id']}")
    sys.exit(validate())


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("courses", help="list courses, topics and question counts").set_defaults(fn=cmd_courses)

    p = sub.add_parser("add-course", help="create a course (folder, files, manifest line)")
    p.add_argument("id", help="lowercase id, e.g. art-history-b")
    p.add_argument("--name", required=True); p.add_argument("--code", required=True, help="course number")
    p.add_argument("--subtitle"); p.add_argument("--color", help="#RRGGBB"); p.add_argument("--icon", choices=ICONS)
    p.add_argument("--prefix", help="short id prefix for its questions, e.g. art-b (default: the course id)")
    p.add_argument("--topic", action="append", help='id=name, repeatable: --topic "baroque=הבארוק"')
    p.set_defaults(fn=cmd_add_course)

    p = sub.add_parser("add-topic", help="add a topic to a course")
    p.add_argument("course"); p.add_argument("topic_id")
    p.add_argument("--name", required=True); p.add_argument("--note"); p.add_argument("--order", type=int)
    p.set_defaults(fn=cmd_add_topic)

    p = sub.add_parser("add-question", help="add one question")
    p.add_argument("course")
    p.add_argument("--topic", required=True, help="topic id or name")
    p.add_argument("--source", choices=list(FILES), default="real")
    p.add_argument("--q", required=True, help="question text")
    p.add_argument("--correct", required=True); p.add_argument("--wrong", action="append", help="repeat 3 times")
    p.add_argument("--explanation", required=True); p.add_argument("--ref", required=True)
    p.add_argument("--difficulty", type=int, default=2, choices=(1, 2, 3))
    p.set_defaults(fn=cmd_add_question)

    p = sub.add_parser("template", help="write a CSV template to fill in a spreadsheet")
    p.add_argument("course"); p.add_argument("--out")
    p.set_defaults(fn=cmd_template)

    p = sub.add_parser("import", help="add questions from a CSV (or JSON) file")
    p.add_argument("course"); p.add_argument("file")
    p.add_argument("--source", choices=list(FILES), default="real", help="for rows without a source column")
    p.add_argument("--dry-run", action="store_true", help="check only, write nothing")
    p.set_defaults(fn=cmd_import)

    a = ap.parse_args()
    a.fn(a)


if __name__ == "__main__":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8"); sys.stderr.reconfigure(encoding="utf-8")
    main()
