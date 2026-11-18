"""His ruling D-001: "Yeah short teachings are fine but only recommended for traders who have made $1 Million", in our
words "every short lesson says shorting is recommended only for traders who have already made $1 million trading".
On 2026-11-17 the two shorting lessons (F10b.01, F10b.02) were found never saying it. This keeps every lesson that
teaches a short carrying the line somewhere a member reads it (a live question or walkthrough)."""
import glob
import json
import re

from scripts.study import courses_lib as cl
from scripts.study.library_audit import live_questions

#: lessons whose whole subject is a short: the title says so, plus the setups that are shorts by name
SHORT_TITLE = re.compile(r"\bshort", re.I)
SHORT_SETUPS = {"SET.17"}          # Wedge Drop (a short; its title doesn't say so)
MILLION = re.compile(r"\$1 million", re.I)


def _member_text(d: dict) -> str:
    out = []
    for q in live_questions(d):
        for k in ("q", "story", "why", "simple", "lesson_line"):
            if isinstance(q.get(k), str):
                out.append(q[k])
        for k in ("wrong", "deeper"):
            if isinstance(q.get(k), dict):
                out += [x for x in q[k].values() if isinstance(x, str)]
    verify = d.get("verify") or {}
    for w in d.get("walkthroughs") or []:
        if (verify.get(w.get("key")) or {}).get("status") == "pass":
            out += [str(w.get("title") or "")] + [str(s) for s in w.get("steps") or []]
    return " ".join(out)


def _short_lessons():
    for f in sorted(glob.glob(str(cl.REPO / "docs" / "study" / "courses" / "*" / "*.json"))):
        d = json.load(open(f, encoding="utf-8"))
        if d.get("unit") in SHORT_SETUPS or SHORT_TITLE.search(str(d.get("title") or "")):
            yield d


def test_there_are_short_lessons_to_check():
    units = {d["unit"] for d in _short_lessons()}
    assert {"F10b.01", "F10b.02", "SET.17", "SET.31"} <= units


def test_every_short_lesson_says_the_million_dollar_line():
    missing = [d["unit"] for d in _short_lessons() if not MILLION.search(_member_text(d))]
    assert missing == []
