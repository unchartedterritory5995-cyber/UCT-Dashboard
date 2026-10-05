"""D-4 (Lane R): transcript chapters + the recap's review-status label.

Two additions to surfaces that already exist, both DARK behind
TRANSCRIPT_CHAPTERS_ENABLED (read per call; unset = OFF):

1. CHAPTERS. A flat-plus-one chapter model over the verbatim transcript the
   Call panel already reads (`GET /api/earnings/transcript/{sym}`), so "jump to
   the Q&A" -- and to each analyst's question -- is a click, not a scroll.
   Built from the turns alone; no model call, no vendor call.

     level 1  "Prepared remarks"  turns [0, qa_start - 1]
              "Q&A"               turns [qa_start, n - 1]
     level 2  under Prepared remarks: one chapter per run of consecutive turns
              by the same non-operator speaker
              under Q&A: one chapter per question, opened by a turn from a
              speaker who did NOT speak in the prepared remarks (an outside
              questioner), and running until the next questioner's turn

   ⛔ The Q&A boundary is `call_recap_grounded.prepared_remarks_end` -- the one
   rule the existing "Jump to Q&A" chip already uses. When the transcript never
   states where the Q&A begins, there is NO Q&A chapter and no question
   chapters: the payload says `qa_boundary: "not_stated"` and returns only the
   speaker runs under one "Call" chapter. A guessed boundary would be a
   confident claim about where the prepared remarks stopped.

   ⛔ CONTAINMENT INVARIANT (the Quartr rule): every child's [start, end] lies
   inside its parent's, siblings are contiguous and never overlap, and the
   level-1 chapters cover every turn exactly once. `check_containment` states
   it; the rails assert it on every fixture.

2. REVIEW STATUS. Every call recap is written by a model and read by no person
   before a member sees it. With the flag on, the call-recap response carries
   `review_status: "ai_unreviewed"` and the recap header says so in words. The
   value is a FACT about our pipeline, not a hedge: there is no review step.
"""
from __future__ import annotations

import os
import re
from typing import Optional

ENABLED_ENV = "TRANSCRIPT_CHAPTERS_ENABLED"
REVIEW_STATUS = "ai_unreviewed"

_OPERATOR = re.compile(r"^\s*operator\s*$", re.I)


def is_enabled() -> bool:
    """Read PER CALL. Unset means OFF."""
    return os.environ.get(ENABLED_ENV, "").strip() == "1"


def _who(seg: dict) -> str:
    return (seg.get("speaker") or "").strip()


def _is_operator(name: str) -> bool:
    return bool(_OPERATOR.match(name or ""))


def _runs(segments: list[dict], lo: int, hi: int) -> list[dict]:
    """Consecutive-speaker runs over turns [lo, hi]. An operator turn joins the
    run it sits in; operator turns that LEAD the range join the first speaker's
    run. So the runs always tile the range."""
    out: list[dict] = []
    lead: Optional[int] = None
    for i in range(lo, hi + 1):
        name = _who(segments[i])
        if _is_operator(name):
            if out:
                out[-1]["end"] = i
            elif lead is None:
                lead = i
            continue
        key = name or "Unknown speaker"
        if out and out[-1]["title"] == key:
            out[-1]["end"] = i
            continue
        start = lead if (not out and lead is not None) else i
        lead = None
        out.append({"title": key, "kind": "speaker", "level": 2, "start": start, "end": i})
    if not out and lead is not None:
        out.append({"title": "Operator", "kind": "speaker", "level": 2, "start": lead, "end": hi})
    return out


def _questions(segments: list[dict], lo: int, hi: int, insiders: set[str]) -> list[dict]:
    """One chapter per question over turns [lo, hi]. A question opens on a turn
    by a non-operator speaker who did not speak in the prepared remarks, and the
    operator hand-off directly before it belongs to it. Turns before the first
    question form a 'Q&A opening' chapter, so the children still tile the Q&A."""
    out: list[dict] = []
    for i in range(lo, hi + 1):
        name = _who(segments[i])
        outsider = bool(name) and not _is_operator(name) and name not in insiders
        if outsider and (not out or out[-1].get("_asker") != name):
            start = i
            if out and out[-1]["end"] == i - 1 and _is_operator(_who(segments[i - 1])):
                if out[-1]["start"] == i - 1:
                    out.pop()
                else:
                    out[-1]["end"] = i - 2
                start = i - 1
            out.append({"title": f"Question from {name}", "kind": "question", "_asker": name,
                        "start": start, "end": i})
        elif out:
            out[-1]["end"] = i
        else:
            out.append({"title": "Q&A opening", "kind": "qa_opening", "start": i, "end": i})
    for c in out:
        c.pop("_asker", None)
        c["level"] = 2
    return out


def chapters(segments: list[dict], qa_start: Optional[int]) -> dict:
    """The chapter tree for one transcript.

    Returns {qa_boundary: 'stated'|'not_stated', chapters: [level-1 dicts with
    `children`]}. Indices are turn indices into `segments` (the panel's
    `data-segment`), inclusive on both ends."""
    segs = [s for s in (segments or []) if isinstance(s, dict)]
    n = len(segs)
    if n == 0:
        return {"qa_boundary": "not_stated", "chapters": []}
    stated = isinstance(qa_start, int) and 0 < qa_start < n
    if not stated:
        return {"qa_boundary": "not_stated",
                "chapters": [{"title": "Call", "kind": "call", "level": 1, "start": 0, "end": n - 1,
                              "children": _runs(segs, 0, n - 1)}]}
    insiders = {_who(s) for s in segs[:qa_start] if _who(s) and not _is_operator(_who(s))}
    return {"qa_boundary": "stated",
            "chapters": [
                {"title": "Prepared remarks", "kind": "prepared", "level": 1, "start": 0, "end": qa_start - 1,
                 "children": _runs(segs, 0, qa_start - 1)},
                {"title": "Q&A", "kind": "qa", "level": 1, "start": qa_start, "end": n - 1,
                 "children": _questions(segs, qa_start, n - 1, insiders)},
            ]}


def check_containment(tree: dict, n: int) -> list[str]:
    """Every violation of the containment invariant, as sentences ([] = holds)."""
    errs: list[str] = []

    def tiles(items: list[dict], lo: int, hi: int, where: str) -> None:
        cur = lo
        for c in items:
            if c["start"] != cur:
                errs.append(f"{where}: '{c['title']}' starts at {c['start']}, expected {cur}")
            if c["end"] < c["start"]:
                errs.append(f"{where}: '{c['title']}' ends before it starts")
            if c["start"] < lo or c["end"] > hi:
                errs.append(f"{where}: '{c['title']}' [{c['start']},{c['end']}] outside [{lo},{hi}]")
            cur = c["end"] + 1
        if items and cur != hi + 1:
            errs.append(f"{where}: children stop at {cur - 1}, parent ends at {hi}")

    top = tree.get("chapters") or []
    if n:
        tiles(top, 0, n - 1, "root")
    for c in top:
        tiles(c.get("children") or [], c["start"], c["end"], c["title"])
    return errs
