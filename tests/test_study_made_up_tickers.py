"""A made-up example stock must not wear a real company's ticker (REVIEW_LEARNINGS rule 7: tickers, not "Stock A";
made-up numbers never on a real name). "XYZ" read as a placeholder for years, but it has been Block, Inc.'s real
ticker since January 2025 and sits in our own universe (api/data/cap_universe.json). Our made-up stock is "ZQRT".
Found 2026-11-17 by the F6.13 checker. A source's own quote that says XYZ stays word for word in its fact (facts are
not member text)."""
import glob
import json
import re

from scripts.study import courses_lib as cl
from scripts.study.library_audit import live_questions

PLACEHOLDERS = re.compile(r"\bXYZ\b")
FIELDS = ("q", "story", "sentence", "answer", "why", "simple", "lesson_line", "choices", "wrong", "deeper", "bank")


def _texts(v):
    if isinstance(v, str):
        yield v
    elif isinstance(v, list):
        for x in v:
            yield from _texts(x)
    elif isinstance(v, dict):
        for k, x in v.items():
            yield k
            yield from _texts(x)


def test_our_made_up_ticker_is_not_a_real_one():
    universe = json.load(open(cl.REPO / "api" / "data" / "cap_universe.json", encoding="utf-8"))
    syms = {x if isinstance(x, str) else (x.get("ticker") or x.get("sym") or x.get("symbol"))
            for x in (universe if isinstance(universe, list) else universe.get("tickers", universe.keys()))}
    assert "ZQRT" not in syms and "XYZ" in syms


def test_no_member_text_uses_xyz():
    bad = []
    for f in sorted(glob.glob(str(cl.REPO / "docs" / "study" / "courses" / "*" / "*.json"))):
        d = json.load(open(f, encoding="utf-8"))
        for q in live_questions(d):
            if any(PLACEHOLDERS.search(t) for k in FIELDS for t in _texts(q.get(k))):
                bad.append(f"{d['unit']} {q['key']}")
        verify = d.get("verify") or {}
        for w in d.get("walkthroughs") or []:
            if (verify.get(w.get("key")) or {}).get("status") == "pass" and any(
                    PLACEHOLDERS.search(t) for t in _texts([w.get("title"), w.get("steps")])):
                bad.append(f"{d['unit']} {w['key']}")
    assert bad == []
