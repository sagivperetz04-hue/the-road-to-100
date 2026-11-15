#!/usr/bin/env python3
"""Tests tools/content.py on a throwaway copy of the project (the real data is never touched).

Usage: python3 tests/content_test.py
"""
import csv, json, os, shutil, subprocess, sys, tempfile

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
FAILS = []


def check(cond, msg):
    print(("  ok   " if cond else "  FAIL ") + msg)
    if not cond:
        FAILS.append(msg)


def main():
    work = tempfile.mkdtemp(prefix="content-test-")
    try:
        for d in ("app", "tools"):
            shutil.copytree(os.path.join(ROOT, d), os.path.join(work, d), ignore=shutil.ignore_patterns("__pycache__"))
        env = dict(os.environ, PYTHONUTF8="1", PYTHONIOENCODING="utf-8")
        def run(*args):
            r = subprocess.run([sys.executable, os.path.join(work, "tools", "content.py"), *args], capture_output=True, text=True, encoding="utf-8", env=env)
            return r.returncode, r.stdout + r.stderr
        data = os.path.join(work, "app", "assets", "data")
        load = lambda *p: json.load(open(os.path.join(data, *p), encoding="utf-8"))

        code, out = run("add-course", "art-history-b", "--name", "תולדות האמנות ב'", "--code", "0881120702",
                        "--color", "#FF2D55", "--icon", "columns", "--prefix", "art-b",
                        "--topic", "renaissance=הרנסנס", "--topic", "baroque=הבארוק")
        check(code == 0 and "data OK" in out, "add-course creates a valid course")
        check(load("courses.json")[-1]["id"] == "art-history-b", "add-course adds the manifest line")
        check(os.path.exists(os.path.join(work, "tools", "sources", "art-history-b", "baroque.md")), "add-course creates source stubs")
        code, out = run("add-course", "art-history-b", "--name", "x", "--code", "1")
        check(code != 0 and "already exists" in out, "add-course refuses a duplicate id")
        code, out = run("add-course", "Bad Id", "--name", "x", "--code", "1")
        check(code != 0 and "lowercase" in out, "add-course refuses a bad id")

        code, out = run("add-topic", "art-history-b", "mannerism", "--name", "מנייריזם", "--order", "2")
        topics = load("art-history-b", "course.json")["topics"]
        check(code == 0 and [t["id"] for t in topics] == ["renaissance", "mannerism", "baroque"], "add-topic inserts at the given position")
        check([t["order"] for t in topics] == [1, 2, 3], "add-topic renumbers the following topics")

        q = ["--q", "מי צייר את תקרת הקפלה הסיסטינית?", "--correct", "מיכלאנג'לו", "--wrong", "רפאל", "--wrong", "לאונרדו",
             "--wrong", "טיציאן", "--explanation", "מיכלאנג'לו צייר את התקרה.", "--ref", "מבחן 2025 מועד א שאלה 2"]
        code, out = run("add-question", "art-history-b", "--topic", "הרנסנס", *q)
        real = load("art-history-b", "questions-real.json")
        check(code == 0 and real[0]["id"] == "art-b-real-0001" and real[0]["topic"] == "renaissance", "add-question: id from the prefix, topic by name")
        check(real[0]["options"][real[0]["answer"]] == "מיכלאנג'לו", "add-question: answer index points at the correct option")
        code, out = run("add-question", "art-history-b", "--topic", "renaissance", *q)
        check(code != 0 and "already exists" in out, "add-question refuses a duplicate question")

        csv_path = os.path.join(work, "q.csv")
        code, out = run("template", "art-history-b", "--out", csv_path)
        rows = list(csv.reader(open(csv_path, encoding="utf-8-sig")))
        check(code == 0 and rows[0][:3] == ["נושא", "שאלה", "תשובה נכונה"], "template writes Hebrew headers")
        good = [["הרנסנס", "מי תכנן את כיפת הקתדרלה של פירנצה?", "ברונלסקי", "אלברטי", "ברמנטה", "מיכלאנג'לו", "ברונלסקי בנה את הכיפה.", "שיעור 2", "2", "אמיתית"],
                ["baroque", "מי פיסל את האקסטזה של תרזה הקדושה?", "ברניני", "בורומיני", "קאנובה", "דונטלו", "ברניני פיסל אותה.", "מבחן 2024", "", "מחוללת"]]
        bad = [["מנייריזם", "שאלה לפי לזכור למבחן?", "א", "א", "ב", "ג", "הסבר.", "ref", "5", ""]]
        csv.writer(open(csv_path, "w", encoding="utf-8-sig", newline="")).writerows(rows + good + bad)
        before = load("art-history-b", "questions-real.json")
        code, out = run("import", "art-history-b", csv_path)
        check(code != 0 and "nothing written" in out and load("art-history-b", "questions-real.json") == before, "import with a bad row writes nothing")
        check("row 5" in out and "לזכור למבחן" in out, "import names the bad row and the problem")
        csv.writer(open(csv_path, "w", encoding="utf-8-sig", newline="")).writerows(rows + good)
        code, out = run("import", "art-history-b", csv_path, "--dry-run")
        check(code == 0 and load("art-history-b", "questions-real.json") == before, "import --dry-run writes nothing")
        code, out = run("import", "art-history-b", csv_path)
        real, gen = load("art-history-b", "questions-real.json"), load("art-history-b", "questions-generated.json")
        check(code == 0 and "data OK" in out, "import of good rows passes the validator")
        check([x["id"] for x in real] == ["art-b-real-0001", "art-b-real-0002"] and [x["id"] for x in gen] == ["art-b-gen-0001"],
              "import: real and generated rows go to their files with continuing ids (example row skipped)")
        check(gen[0]["difficulty"] == 2, "import: empty difficulty defaults to 2")

        code, out = run("courses")
        check(code == 0 and "art-b-real-NNNN" in out and "source empty" in out, "courses lists the course, its ids and empty sources")
    finally:
        shutil.rmtree(work, ignore_errors=True)
    print(f"\n{'PASSED' if not FAILS else 'FAILED'}: {len(FAILS)} failure(s)")
    return 0 if not FAILS else 1


if __name__ == "__main__":
    sys.exit(main())
