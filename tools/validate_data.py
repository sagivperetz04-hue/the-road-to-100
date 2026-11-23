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

# Phrases that point at the structure of the study summaries (their headings, tables or lessons) instead of
# the material. A question must make sense on its own in the app, so these fail the build. `ref` is exempt:
# it is metadata that names the source document.
SUMMARY_PHRASES = (
    "לזכור למבחן", "בשורה אחת", "טבלת ההשוואה", "בטבלת", "בטבלה", "הסיכום", "בסיכום", "לפי הסיכום",
    "מילת מפתח", "מילות מפתח", "משפט לזכור", "שכדאי לזכור", "בשיעור", "במצגת", "מוטיבים שחוזרים",
    "מוטיב שחוזר",
)


def giveaway(options, answer):
    """True when the correct option is much longer than every wrong one (students learn "pick the longest")."""
    if not isinstance(options, list) or len(options) != 4 or not isinstance(answer, int) or not 0 <= answer <= 3:
        return False
    right = str(options[answer])
    longest_wrong = max(len(str(o)) for i, o in enumerate(options) if i != answer)
    return len(right) > 14 and len(right) >= 1.5 * max(1, longest_wrong)


def summary_phrases(q):
    """(field, phrase) pairs for every summary-structure phrase in the question text, options or explanation."""
    fields = [("q", q.get("q"))] + [(f"options[{i}]", o) for i, o in enumerate(q.get("options") or [])]
    fields.append(("explanation", q.get("explanation")))
    return [(name, ph) for name, text in fields if isinstance(text, str) for ph in SUMMARY_PHRASES if ph in text]


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
        for key in ("id", "name", "folder"):   # "code" (the course number) is optional
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
                if giveaway(q.get("options"), q.get("answer")):
                    warnings.append(f"{where}: the correct option is much longer than the others (a giveaway)")
                for field, phrase in summary_phrases(q):
                    errors.append(f"{where}: {field} refers to the summary (\"{phrase}\"); "
                                  "rewrite it as a standalone question about the material")
                text = (str(q.get("q", "")).strip(), str(q.get("image", "")))
                if q.get("image") is not None:
                    img = str(q.get("image"))
                    if not img or ".." in img or img.startswith("/"):
                        errors.append(f"{where}: bad image path '{img}'")
                    elif not os.path.exists(os.path.join(os.path.dirname(data_dir), "images", *img.split("/"))):
                        # photos are git-ignored (copyright); the app hides questions whose picture it doesn't have
                        warnings.append(f"{where}: image missing: images/{img} (put it in app/assets/images/)")
                if text in texts:
                    warnings.append(f"{where}: same question text appears twice in {fname}")
                texts.add(text)
                if (q.get("topic"), source) in counts:
                    counts[(q.get("topic"), source)] += 1
        name_by_id = {t.get("id"): t.get("name", "") for t in topics}
        for t in topic_ids:
            rows.append((cid, name_by_id.get(t, t), counts[(t, "real")], counts[(t, "generated")]))
    return errors, warnings, rows


AUDIO_EXT = (".mp3", ".m4a", ".aac", ".ogg", ".wav")   # the types MainActivity serves
MUSIC_SCENES = ("menu", "game", "summit")
SFX_KINDS = ("correct", "wrong", "fall", "tap")
BIG_AUDIO = 4 * 1024 * 1024


def validate_audio(audio_dir):
    """Check audio/manifest.json: a list of clips, or
    {"clips": [...], "music": {"menu"|"game"|"summit": [...]}, "sfx": {"correct"|"wrong"|"fall"|"tap": {...}},
     "final": {...}}  (final = the track for the last stair, played even when muted, "gain" 1..4)."""
    errors, warnings = [], []
    path = os.path.join(audio_dir, "manifest.json")
    if not os.path.exists(path):
        return errors, warnings
    man = load(path, errors)
    if man is None:
        return errors, warnings
    if isinstance(man, list):
        clips, music = man, {}
    elif isinstance(man, dict):
        unknown = set(man) - {"clips", "music", "sfx", "final"}
        if unknown:
            errors.append(f"audio/manifest.json: unknown keys {sorted(unknown)} (use \"clips\", \"music\", \"sfx\" and \"final\")")
        clips, music, sfx = man.get("clips", []), man.get("music", {}), man.get("sfx", {})
        if not isinstance(sfx, dict):
            errors.append('audio/manifest.json: "sfx" must be an object of kind -> {"file": ...}')
            sfx = {}
        for kind in sfx:
            if kind not in SFX_KINDS:
                errors.append(f'audio/manifest.json: unknown sound effect "{kind}" (use {", ".join(SFX_KINDS)})')
        if not isinstance(music, dict):
            errors.append('audio/manifest.json: "music" must be an object of scene -> list of tracks')
            music = {}
        for sc in music:
            if sc not in MUSIC_SCENES:
                errors.append(f'audio/manifest.json: unknown music scene "{sc}" (use {", ".join(MUSIC_SCENES)})')
    else:
        errors.append("audio/manifest.json: must be a list of clips or an object with clips/music/sfx")
        return errors, warnings
    entries = [("clips", i, c) for i, c in enumerate(clips if isinstance(clips, list) else [])]
    if not isinstance(clips, list):
        errors.append('audio/manifest.json: "clips" must be a list')
    for sc, tracks in music.items():
        if not isinstance(tracks, list):
            errors.append(f'audio/manifest.json: music "{sc}" must be a list')
            continue
        entries += [(f"music.{sc}", i, t) for i, t in enumerate(tracks)]
    if isinstance(man, dict):
        entries += [(f"sfx.{k}", 0, v) for k, v in (man.get("sfx") or {}).items() if isinstance(man.get("sfx"), dict)]
        if "final" in man:
            entries.append(("final", 0, man["final"]))
            g = man["final"].get("gain") if isinstance(man["final"], dict) else None
            if g is not None and not (isinstance(g, (int, float)) and 1 <= g <= 4):
                errors.append("audio/manifest.json final: gain must be between 1 and 4")
    for where, i, e in entries:
        tag = f"audio/manifest.json {where}[{i}]"
        if not isinstance(e, dict) or not isinstance(e.get("file"), str) or not e["file"].strip():
            errors.append(f"{tag}: needs a \"file\"")
            continue
        f = e["file"]
        if not f.lower().endswith(AUDIO_EXT):
            errors.append(f"{tag}: {f}: unsupported type (use {', '.join(AUDIO_EXT)})")
        full = os.path.join(audio_dir, f)
        if not os.path.isfile(full):
            errors.append(f"{tag}: file not found: app/assets/audio/{f}")
        elif os.path.getsize(full) > BIG_AUDIO:
            warnings.append(f"{tag}: {f} is {os.path.getsize(full) // 1024} KB; the APK grows by that much")
        vol = e.get("volume")
        if vol is not None and not (isinstance(vol, (int, float)) and 0 <= vol <= 1):
            errors.append(f"{tag}: volume must be between 0 and 1")
        start = e.get("start")
        if start is not None and not (isinstance(start, (int, float)) and start >= 0):
            errors.append(f"{tag}: start must be a number of seconds >= 0")
    return errors, warnings


def main():
    data_dir = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else DEFAULT_DATA)
    errors, warnings, rows = validate(data_dir)
    audio_dir = os.path.join(os.path.dirname(data_dir), "audio")
    ae, aw = validate_audio(audio_dir)
    errors += ae
    warnings += aw
    errors += validate_sentences(os.path.join(HERE, "..", "app"))
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
    stamp_version(data_dir)
    write_image_index(os.path.join(os.path.dirname(data_dir), "images"))
    print("\ndata OK")


def validate_sentences(app_dir):
    """The home-screen widget's sentence of the day: res/values/sentences.xml (public) and, when present,
    res-private/values/sentences.xml (personal, git-ignored). Each needs 365 different, short lines."""
    import xml.etree.ElementTree as ET
    errs = []
    for sub in ("res", "res-private"):
        path = os.path.join(app_dir, sub, "values", "sentences.xml")
        if not os.path.exists(path):
            if sub == "res":
                errs.append(f"{path}: missing (the widget needs its sentences)")
            continue
        try:
            arr = ET.parse(path).getroot().find("string-array[@name='widget_sentences']")
        except ET.ParseError as e:
            errs.append(f"{sub}/values/sentences.xml: {e}")
            continue
        items = [(i.text or "").replace("\'", "'").strip() for i in (arr if arr is not None else [])]
        if len(items) != 365:
            errs.append(f"{sub}/values/sentences.xml: {len(items)} sentences, expected 365 (one per day)")
        dups = sorted({t for t in items if items.count(t) > 1})
        if dups:
            errs.append(f"{sub}/values/sentences.xml: repeated: {dups[:3]}")
        for n, t in enumerate(items, 1):
            if not t:
                errs.append(f"{sub}/values/sentences.xml: sentence {n} is empty")
            elif len(t) > 80:
                errs.append(f"{sub}/values/sentences.xml: sentence {n} is {len(t)} characters (max 80, it must fit the widget)")
    return errs


def write_image_index(images_dir):
    """images/index.json: the pictures bundled in this build. The app hides questions whose picture is missing
    (photos are git-ignored, and a question update from GitHub may name pictures that only a newer APK has)."""
    import json as _json
    files = []
    if os.path.isdir(images_dir):
        for root, _, names in os.walk(images_dir):
            for n in names:
                if n.lower().endswith((".jpg", ".jpeg", ".png", ".webp")):
                    files.append(os.path.relpath(os.path.join(root, n), images_dir).replace(os.sep, "/"))
    os.makedirs(images_dir, exist_ok=True)
    text = _json.dumps(sorted(files), indent=0) + "\n"
    path = os.path.join(images_dir, "index.json")
    if not os.path.exists(path) or open(path, encoding="utf-8").read() != text:
        open(path, "w", encoding="utf-8", newline="\n").write(text)


DATA_FORMAT = 1   # bump only when the app can no longer read older data (the app ignores newer formats)


def stamp_version(data_dir):
    """data/version.json tells installed apps whether the questions on GitHub are newer than theirs.
    The hash covers courses.json and every course folder; "updated" changes only when the hash does."""
    import hashlib, json as _json, datetime
    path = os.path.join(data_dir, "version.json")
    h = hashlib.sha1()
    manifest = os.path.join(data_dir, "courses.json")
    files = [manifest]
    try:
        for entry in _json.load(open(manifest, encoding="utf-8")):
            for f in ("course.json", "questions-real.json", "questions-generated.json"):
                p = os.path.join(data_dir, entry["folder"], f)
                if os.path.exists(p):
                    files.append(p)
    except Exception:
        return
    for p in files:
        h.update(os.path.relpath(p, data_dir).replace(os.sep, "/").encode())
        h.update(open(p, "rb").read().replace(b"\r\n", b"\n"))
    digest = h.hexdigest()[:16]
    try:
        old = _json.load(open(path, encoding="utf-8"))
    except Exception:
        old = {}
    if old.get("hash") == digest and old.get("format") == DATA_FORMAT:
        return
    stamp = {"format": DATA_FORMAT, "hash": digest,
             "updated": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")}
    open(path, "w", encoding="utf-8", newline="\n").write(_json.dumps(stamp, indent=1) + "\n")
    print(f"data version: {digest} ({stamp['updated']})")


if __name__ == "__main__":
    main()
