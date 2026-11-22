"""Plan an overbuild wave: split lessons into risk-routed chunks for the wave workflow.

    python -m scripts.study.wave_plan SET.12 SET.13 ... [--out args.json] [--light-max 36] [--skip-upgraded]

For each lesson: the HIGH-risk live questions form one FULL chunk (research, write, check + red team, resolve, recheck);
the rest are split into LIGHT chunks of at most --light-max questions (write, combined check-and-break, resolve, targeted
recheck). The risk score is the OVERBUILD_PLAN.md rubric computed from the lesson file: +3 one cited fact; +2 a computed
key or a rule that changes over time; +2 rests on the owner's rulebook (a house fact) or a held decision; +1 answer over
60 characters; +1 fixed before. Score 4 or more is high risk. Questions that already carry `simple` are skipped.

The output is the `args` for the wave workflow: {"chunks": [{unit, chunk, route, file, keys}, ...]}.
"""
from __future__ import annotations

import argparse
import json
import re
import sys

from scripts.study import courses_lib as cl

CHANGING = re.compile(r"\b(margin|settle|settlement|pattern day|PDT|fee|commission|contract spec|trading hours|FINRA|SEC rule|tax)\b", re.I)
HIGH = 4


def risk_score(doc: dict, q: dict) -> int:
    s = 0
    facts = q.get("facts") or []
    if len(facts) <= 1:
        s += 3
    text = " ".join(str(q.get(k) or "") for k in ("q", "why", "story")) + " ".join(map(str, q.get("choices") or []))
    if q.get("calc") or q.get("format") == "numeric" or CHANGING.search(text):
        s += 2
    conflicts = " ".join(doc.get("conflicts") or [])
    if any(f.startswith("h") for f in facts) or re.search(r"\b" + re.escape(str(q.get("key"))) + r"\b", conflicts):
        s += 2
    if len(str(q.get("answer") or "")) > 60:
        s += 1
    if (doc.get("verify", {}).get(q.get("key"), {}) or {}).get("fixed"):
        s += 1
    return s


def live_keys(doc: dict) -> list[dict]:
    v = doc.get("verify") or {}
    return [q for q in doc.get("questions", []) if (v.get(q["key"]) or {}).get("status") == "pass"]


FULL_SHARE = 0.4   # a balanced chunk takes the full path when at least this share of it is high risk


def plan_balanced(units: list[str], chunk_max: int = 36, skip_upgraded: bool = True) -> list[dict]:
    """Chunk each lesson into evenly sized chunks (at most chunk_max), riskiest questions first, so the large fixed cost of an
    agent (about 190k tokens of reading) is shared by 30 or so questions instead of a dozen (wave 1 measured 93k tokens per
    question for 9 to 16 question chunks against about 44k for 22 to 36). A chunk is FULL when 40% or more of it is high
    risk, otherwise LIGHT."""
    chunks: list[dict] = []
    for unit in units:
        track = unit.split(".")[0]
        path = cl.COURSES_DIR / track / f"{unit}.json"
        doc = cl.load_unit(path)
        qs = [q for q in live_keys(doc) if not (skip_upgraded and q.get("simple"))]
        if not qs:
            continue
        scored = sorted(((risk_score(doc, q), q["key"]) for q in qs), key=lambda t: (-t[0], t[1]))
        n = -(-len(scored) // chunk_max)
        size = -(-len(scored) // n)
        file = str(path).replace("\\", "/")
        for i in range(n):
            part = scored[i * size:(i + 1) * size]
            hi = sum(1 for sc, _ in part if sc >= HIGH)
            route = "full" if hi / len(part) >= FULL_SHARE else "light"
            chunks.append({"unit": unit, "chunk": f"{unit}-{route}{chr(97 + i)}", "route": route, "file": file,
                           "keys": sorted(k for _, k in part)})
    return chunks


def plan(units: list[str], light_max: int = 36, skip_upgraded: bool = True) -> list[dict]:
    chunks: list[dict] = []
    for unit in units:
        track = unit.split(".")[0]
        path = cl.COURSES_DIR / track / f"{unit}.json"
        doc = cl.load_unit(path)
        qs = [q for q in live_keys(doc) if not (skip_upgraded and q.get("simple"))]
        hi = [q["key"] for q in qs if risk_score(doc, q) >= HIGH]
        lo = [q["key"] for q in qs if risk_score(doc, q) < HIGH]
        file = str(path).replace("\\", "/")
        if hi:
            chunks.append({"unit": unit, "chunk": f"{unit}-full", "route": "full", "file": file, "keys": hi})
        if lo:
            n = -(-len(lo) // light_max)
            size = -(-len(lo) // n)
            for i in range(n):
                chunks.append({"unit": unit, "chunk": f"{unit}-light{chr(97 + i)}", "route": "light", "file": file,
                               "keys": lo[i * size:(i + 1) * size]})
    return chunks


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("units", nargs="+")
    ap.add_argument("--out")
    ap.add_argument("--light-max", type=int, default=36)
    ap.add_argument("--include-upgraded", action="store_true")
    ap.add_argument("--split", action="store_true", help="the wave 1 form: a small full chunk of risky questions per lesson")
    a = ap.parse_args(argv)
    chunks = (plan(a.units, a.light_max, not a.include_upgraded) if a.split
              else plan_balanced(a.units, a.light_max, not a.include_upgraded))
    blob = json.dumps({"chunks": chunks})
    if a.out:
        with open(a.out, "w", encoding="utf-8", newline="\n") as fh:
            fh.write(blob)
    full = sum(len(c["keys"]) for c in chunks if c["route"] == "full")
    light = sum(len(c["keys"]) for c in chunks if c["route"] == "light")
    print(f"{len(chunks)} chunks over {len(a.units)} lessons: {full} full-path questions, {light} light-path questions")
    return 0


if __name__ == "__main__":
    sys.exit(main())
