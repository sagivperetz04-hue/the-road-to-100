#!/usr/bin/env python3
"""Validate the bundled quiz data. Exit code 1 on any error (the build stops).

Usage: python3 tools/validate_data.py [path/to/assets/data]
"""
import json
import os
import sys
import unicodedata

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_DATA = os.path.join(HERE, "..", "app", "assets", "data")
SOURCES = {"questions-real.json": "real", "questions-generated.json": "generated"}
REQUIRED = ("id", "topic", "source", "q", "options", "answer", "explanation", "ref", "difficulty")


def width(s):
    """Display width (Hebrew letters are 1 column, combining marks 0)."""
    return sum(0 if unicodedata.combining(ch) else 1 for ch in s)


def pad(s, n):
    return s + " " * max(0, n - width(s))


def load(path, errors):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        errors.append(f"missing file: {path}")
    except json.JSONDecodeError as e:
        errors.append(f"invalid JSON: {path}: {e}")
    return None


def validate(data_dir):
    errors, warnings, rows = [], [], []
    manifest = load(os.path.join(data_dir, "courses.json"), errors)
    if not isinstance(manifest, list):
        errors.append("courses.json must be a JSON array")
        return errors, warnings, rows

    seen_ids = {}
    seen_courses = set()
    for entry in manifest:
        for key in ("id", "code", "name", "folder"):
            if not entry.get(key):
                errors.append(f"courses.json: entry {entry!r} is missing '{key}'")
        cid, folder = entry.get("id"), entry.get("folder")
        if not folder:
            continue
        if cid in seen_courses:
            errors.append(f"courses.json: duplicate course id '{cid}'")
        seen_courses.add(cid)
        cdir = os.path.join(data_dir, folder)
        if not os.path.isdir(cdir):
            errors.append(f"course '{cid}': folder '{folder}' does not exist")
            continue
        course = load(os.path.join(cdir, "course.json"), errors)
        if not isinstance(course, dict):
            continue
        if course.get("id") != cid:
            errors.append(f"course '{cid}': course.json id is '{course.get('id')}'")
        topics = course.get("topics") or []
        if not topics:
            errors.append(f"course '{cid}': no topics in course.json")
        topic_ids = []
        for t in topics:
            if not t.get("id") or not t.get("name"):
                errors.append(f"course '{cid}': topic without id/name: {t!r}")
            topic_ids.append(t.get("id"))
        if len(set(topic_ids)) != len(topic_ids):
            errors.append(f"course '{cid}': duplicate topic ids")

        counts = {(t, s): 0 for t in topic_ids for s in ("real", "generated")}
        for fname, source in SOURCES.items():
            path = os.path.join(cdir, fname)
            questions = load(path, errors)
            if questions is None:
                continue
            if not isinstance(questions, list):
                errors.append(f"{folder}/{fname}: must be a JSON array")
                continue
            texts = set()
            for i, q in enumerate(questions):
                where = f"{folder}/{fname}[{i}] ({q.get('id', '?') if isinstance(q, dict) else '?'})"
                if not isinstance(q, dict):
                    errors.append(f"{where}: not an object")
                    continue
                for key in REQUIRED:
                    if key not in q:
                        errors.append(f"{where}: missing '{key}'")
                qid = q.get("id")
                if qid in seen_ids:
                    errors.append(f"{where}: duplicate id (also in {seen_ids[qid]})")
                elif qid:
                    seen_ids[qid] = where
                if not isinstance(q.get("q"), str) or not q.get("q", "").strip():
                    errors.append(f"{where}: empty question text")
                opts = q.get("options")
                if not isinstance(opts, list) or len(opts) != 4:
                    errors.append(f"{where}: needs exactly 4 options")
                else:
                    clean = [o.strip() if isinstance(o, str) else "" for o in opts]
                    if any(not o for o in clean):
                        errors.append(f"{where}: empty option")
                    if len(set(clean)) != 4:
                        errors.append(f"{where}: options are not distinct")
                ans = q.get("answer")
                if not isinstance(ans, int) or isinstance(ans, bool) or not 0 <= ans <= 3:
                    errors.append(f"{where}: 'answer' must be an integer 0..3")
                if q.get("topic") not in topic_ids:
                    errors.append(f"{where}: topic '{q.get('topic')}' is not in course.json")
                if q.get("source") != source:
                    errors.append(f"{where}: source '{q.get('source')}' does not match {fname}")
                if q.get("difficulty") not in (1, 2, 3):
                    errors.append(f"{where}: difficulty must be 1, 2 or 3")
                if not str(q.get("explanation", "")).strip():
                    errors.append(f"{where}: empty explanation")
                text = str(q.get("q", "")).strip()
                if text in texts:
                    warnings.append(f"{where}: same question text appears twice in {fname}")
                texts.add(text)
                if (q.get("topic"), source) in counts:
                    counts[(q.get("topic"), source)] += 1
        name_by_id = {t.get("id"): t.get("name", "") for t in topics}
        for t in topic_ids:
            rows.append((cid, name_by_id.get(t, t), counts[(t, "real")], counts[(t, "generated")]))
    return errors, warnings, rows


def main():
    data_dir = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else DEFAULT_DATA)
    errors, warnings, rows = validate(data_dir)
    if rows:
        w1 = max(width(r[0]) for r in rows) + 2
        w2 = max(width(r[1]) for r in rows) + 2
        print(pad("course", w1) + pad("topic", w2) + "  real  generated")
        print("-" * (w1 + w2 + 17))
        tr = tg = 0
        for c, t, r, g in rows:
            print(pad(c, w1) + pad(t, w2) + f"{r:6d}  {g:9d}")
            tr += r
            tg += g
        print("-" * (w1 + w2 + 17))
        print(pad("total", w1 + w2) + f"{tr:6d}  {tg:9d}")
    for w in warnings:
        print("warning:", w)
    if errors:
        print(f"\n{len(errors)} error(s):", file=sys.stderr)
        for e in errors:
            print("  -", e, file=sys.stderr)
        sys.exit(1)
    print("\ndata OK")


if __name__ == "__main__":
    main()
