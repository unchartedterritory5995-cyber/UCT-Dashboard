"""Build the data files for the one-by-one Library Review page.

    python build_data.py <repo worktree> <data folder>


Run from anywhere:  python library_review_build.py
Writes C:/Users/pgosz/uct-worktrees/_study-resume/libreview/data/<unit>.json and data/index.json.
Each question is in the order a member sees it (the bank builder's choice order) and carries the bank item id, which
is the key the owner's verdicts are stored under.
"""
import glob
import json
import os
import sys

REPO = sys.argv[1]
DATA = os.path.abspath(sys.argv[2])
sys.path.insert(0, REPO)
os.chdir(REPO)

from scripts.study import courses_lib as cl  # noqa: E402
from scripts.study import library_audit as la  # noqa: E402

TRACK_NAMES = {
    "F1": "Foundations: how markets work", "F5": "Foundations: fundamentals", "F6": "Foundations: options",
    "F7": "Foundations: market history", "F8": "Foundations: psychology", "F9": "Foundations: risk",
    "F10": "Foundations: orders", "F10b": "Foundations: shorting", "F11": "Foundations: styles",
    "F12": "Foundations: process", "V": "Vocabulary", "SET": "Setups",
}


def natural(u):
    head, _, tail = u.partition(".")
    try:
        return (head, int(tail))
    except ValueError:
        return (head, 0)


def main():
    os.makedirs(DATA, exist_ok=True)
    index = []
    total_q = 0
    tracks_data = {}
    for old in glob.glob(DATA + "/*.json"):
        os.remove(old)
    for path in cl.unit_files():
        doc = cl.load_unit(path)
        unit, track = doc["unit"], doc["track"]
        items = cl.build_items(doc)
        by_key = {it["_key"]: it for it in items}
        facts = {f["id"]: f for f in doc.get("facts") or []}
        sources = {s["id"]: s for s in doc.get("sources") or []}
        verify = doc.get("verify") or {}
        audit = la.audit_unit({**doc, "_file": str(path)})
        orders = cl.choice_orders(doc)
        qs = []
        for q in doc.get("questions") or []:
            key = q.get("key")
            it = by_key.get(key)
            if not it:
                continue
            p, a, r = it["prompt_json"], it["answer_json"], it["reveal_json"]
            choices = p.get("choices")
            shown = [str(c) for c in choices] if choices else None
            tell = None
            if shown and q.get("format") in ("mcq", "scenario") and q.get("answer") in shown:
                lens = [len(c) for c in shown]
                if lens.count(max(lens)) == 1 and len(q["answer"]) == max(lens):
                    tell = "right choice is the longest"
            cites = []
            for fid in q.get("facts") or []:
                f = facts.get(fid)
                if not f:
                    continue
                s = sources.get(f.get("source"), {})
                url = s.get("url", "")
                cites.append({
                    "quote": f.get("quote"), "claim": f.get("claim"), "tier": s.get("tier"),
                    "from": s.get("title") or s.get("publisher") or "",
                    "publisher": s.get("publisher") or "",
                    "url": "" if url.startswith("repo:") else url,
                    "house": url.startswith("repo:"), "repo": url[5:] if url.startswith("repo:") else "",
                })
            v = verify.get(key) or {}
            ans = a.get("answer")
            qs.append({
                "id": it["id"], "key": key, "rung": q.get("rung"), "format": q.get("format"),
                "criterion": q.get("criterion"), "story": p.get("story"), "q": p.get("q"),
                "sentence": p.get("sentence"), "bank": p.get("bank"), "prefix": p.get("prefix"), "suffix": p.get("suffix"),
                "choices": shown, "answer": ans, "why": r.get("why"), "lesson": r.get("lesson_line"),
                "wrong": r.get("wrong"), "cites": cites, "tell": tell,
                "calc": (r.get("facts") or {}).get("calc"),
                "check": {"status": v.get("status"), "notes": v.get("notes"), "revised": v.get("revised")},
                "term": q.get("term"),
            })
        walks = [{"title": w.get("title"), "steps": w.get("steps") or []} for w in doc.get("walkthroughs") or []]
        d = {
            "unit": unit, "track": track, "title": doc.get("title"), "teaches": doc.get("teaches"), "as_of": doc.get("as_of"),
            "card": doc.get("card"), "flags": audit.get("flags") or [], "conflicts": doc.get("conflicts") or [],
            "walkthroughs": walks, "questions": qs,
        }
        tracks_data.setdefault(track, {})[unit] = d
        total_q += len(qs)
        index.append({
            "unit": unit, "track": track, "title": doc.get("title"), "n": len(qs), "flags": len(audit.get("flags") or []),
            "revised": sum(1 for x in qs if x["check"]["revised"]), "ids": [x["id"] for x in qs],
            "slug": unit.replace(".", "-"),
        })
    for track, units in tracks_data.items():
        with open(f"{DATA}/track-{track}.json", "w", encoding="utf-8", newline="\n") as fh:
            json.dump(units, fh, ensure_ascii=False, separators=(",", ":"))
    index.sort(key=lambda r: (list(TRACK_NAMES).index(r["track"]) if r["track"] in TRACK_NAMES else 99, natural(r["unit"])))
    with open(f"{DATA}/index.json", "w", encoding="utf-8", newline="\n") as fh:
        json.dump({"tracks": TRACK_NAMES, "units": index}, fh, ensure_ascii=False, separators=(",", ":"))
    size = sum(os.path.getsize(f) for f in glob.glob(DATA + "/*.json"))
    print(f"{len(index)} units, {total_q} questions, {size / 1e6:.1f} MB")


main()
