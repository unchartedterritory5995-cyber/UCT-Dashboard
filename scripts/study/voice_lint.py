"""The voice check: does a course question sound like us, or like an AI wrote it?

The owner, 2026-11-17, on a reworked setup question: "Sounds way too AI and not much in my prose at all." The tells
that make a question read that way are listed, with his words, in docs/study/voice_tells.json; the voice to write in
is docs/study/VOICE.md section 10. This reads the live questions (verify status "pass", what reaches a member) and
counts the tells.

    python -m scripts.study.voice_lint                       # library-wide counts, worst lessons first
    python -m scripts.study.voice_lint --units SET.07 SET.08 # just these lessons
    python -m scripts.study.voice_lint --units SET.07 --show # print each flagged sentence
    python -m scripts.study.voice_lint --units SET.07 --strict   # exit 1 on any hard tell or unit flag (rework gate)
    python -m scripts.study.voice_lint --file preview.json --strict  # a lesson file outside the library (a preview)

Pure reading: it never writes a lesson.
"""
from __future__ import annotations

import argparse
import collections
import glob
import json
import os
import re
import sys

sys.path.insert(0, os.path.normpath(os.path.join(os.path.dirname(__file__), "..", "..")))
from scripts.study.library_audit import live_questions  # noqa: E402

ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", ".."))
COURSES = os.path.join(ROOT, "docs", "study", "courses")
TELLS = os.path.join(ROOT, "docs", "study", "voice_tells.json")


def load_tells(path: str = TELLS) -> dict:
    with open(path, encoding="utf-8") as f:
        spec = json.load(f)
    for level in ("hard", "soft"):
        for t in spec.get(level, []):
            t["rx"] = re.compile(t["pattern"], re.IGNORECASE if t["id"] not in ("formula_stem",) else 0)
    return spec


def _texts(q: dict, field: str) -> list[str]:
    v = q.get(field)
    if isinstance(v, str):
        return [v]
    if isinstance(v, list):
        return [x for x in v if isinstance(x, str)]
    if isinstance(v, dict):
        return [x for x in v.values() if isinstance(x, str)]
    return []


def lint_question(q: dict, spec: dict) -> dict:
    """{"hard": [(tell id, field, matched text, the sentence)], "soft": [...]} for one question."""
    out = {"hard": [], "soft": []}
    for level in ("hard", "soft"):
        for t in spec.get(level, []):
            for field in t["fields"]:
                for text in _texts(q, field):
                    m = t["rx"].search(text)
                    if m:
                        out[level].append((t["id"], field, m.group(0), text))
    return out


def live_walkthroughs(unit: dict) -> list[dict]:
    """The lesson's walkthroughs a member reads (verify status "pass"), as question-shaped dicts: the title in `q`,
    the steps in `why`, so the same tells apply (the 2026-11-17 setup rewrite left them untouched)."""
    verify = unit.get("verify") or {}
    return [{"key": w.get("key"), "q": str(w.get("title") or ""), "why": " ".join(str(s) for s in w.get("steps") or [])}
            for w in unit.get("walkthroughs") or [] if (verify.get(w.get("key")) or {}).get("status") == "pass"]


def lint_unit(unit: dict, spec: dict) -> dict:
    qs = live_questions(unit)
    per_q, hard, soft = {}, collections.Counter(), collections.Counter()
    for q in qs + live_walkthroughs(unit):
        r = lint_question(q, spec)
        if r["hard"] or r["soft"]:
            per_q[q.get("key")] = r
        hard.update(t[0] for t in r["hard"])
        soft.update(t[0] for t in r["soft"])
    checks = spec.get("unit_checks", {})
    whys = [str(q.get("why") or "") for q in qs if q.get("why")]
    flags = []
    if whys:
        n = int(checks.get("opener_words", 2))
        openers = collections.Counter(" ".join(w.split()[:n]) for w in whys)
        top, count = openers.most_common(1)[0]
        share = count / len(whys)
        if len(whys) >= 8 and share > float(checks.get("opener_share_max", 0.25)):
            flags.append(f"{count} of {len(whys)} explanations open '{top}' ({share:.0%}); vary how the verdict is said")
        voice = re.compile(checks.get("voice_pattern", r"\b(I|we|you)\b"))
        spoken = sum(1 for w in whys if voice.search(w))
        vshare = spoken / len(whys)
        if len(whys) >= 8 and vshare < float(checks.get("voice_share_min", 0.6)):
            flags.append(f"only {spoken} of {len(whys)} explanations talk as us or to you ({vshare:.0%}); a mentor says I, we and you")
    return {"unit": unit.get("unit"), "questions": len(qs), "hard": hard, "soft": soft, "flags": flags, "per_q": per_q}


def unit_files(units: list[str] | None) -> list[str]:
    files = sorted(glob.glob(os.path.join(COURSES, "*", "*.json")))
    if units:
        want = set(units)
        files = [f for f in files if os.path.splitext(os.path.basename(f))[0] in want]
        missing = want - {os.path.splitext(os.path.basename(f))[0] for f in files}
        if missing:
            raise SystemExit(f"no such lesson: {', '.join(sorted(missing))}")
    return files


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--units", nargs="*")
    ap.add_argument("--file", help="a lesson JSON outside the library (e.g. an apply_upgrade --out preview)")
    ap.add_argument("--show", action="store_true", help="print each flagged sentence")
    ap.add_argument("--strict", action="store_true", help="exit 1 on any hard tell or unit flag")
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args(argv)
    spec = load_tells()
    paths = [a.file] if a.file else unit_files(a.units)
    reports = []
    for p in paths:
        with open(p, encoding="utf-8") as f:
            reports.append(lint_unit(json.load(f), spec))
    if a.json:
        print(json.dumps([{**r, "hard": dict(r["hard"]), "soft": dict(r["soft"]), "per_q": {
            k: {lv: [list(t[:3]) for t in v[lv]] for lv in v} for k, v in r["per_q"].items()}} for r in reports], indent=1))
    else:
        tot_h, tot_s, tot_q = collections.Counter(), collections.Counter(), 0
        for r in reports:
            tot_h.update(r["hard"]); tot_s.update(r["soft"]); tot_q += r["questions"]
        print(f"{len(reports)} lesson(s), {tot_q} live questions")
        print("hard tells (must be 0 in a reworked lesson): " + (", ".join(f"{k} {v}" for k, v in tot_h.most_common()) or "none"))
        print("soft tells (keep rare): " + (", ".join(f"{k} {v}" for k, v in tot_s.most_common()) or "none"))
        ranked = sorted(reports, key=lambda r: (-sum(r["hard"].values()), -len(r["flags"]), r["unit"] or ""))
        for r in ranked[: (len(ranked) if a.units or a.file else 20)]:
            h = sum(r["hard"].values())
            if not (h or r["flags"] or a.show):
                continue
            print(f"\n{r['unit']}: {r['questions']} live, {h} hard, {sum(r['soft'].values())} soft")
            for fl in r["flags"]:
                print(f"  FLAG {fl}")
            if a.show:
                for key, res in r["per_q"].items():
                    for lv in ("hard", "soft"):
                        for tid, field, hit, text in res[lv]:
                            print(f"  {key} {lv} {tid} [{field}] '{hit}': {text[:160]}")
    bad = any(sum(r["hard"].values()) or r["flags"] for r in reports)
    return 1 if (a.strict and bad) else 0


if __name__ == "__main__":
    sys.exit(main())
