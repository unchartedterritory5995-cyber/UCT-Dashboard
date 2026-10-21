"""The owner's review verdicts, applied to the generated bank (spec §8.8, §13.6).

The owner reviews items in chat, one at a time. Each verdict is appended to
`docs/study/corrections/<segment>.jsonl` as one JSON object per line:

  {"ts": "2026-10-17", "item_id": "si_…", "segment": "recall.playbooks",
   "verdict": "approve" | "fix" | "reject" | "source_ruling",
   "owner_words": "<verbatim>",            # what the owner actually said
   "field": "answer" | "answer.<key>" | "q" | "lesson_text" | "choices" | "reveal.<key>" | "prompt.<key>",   # fix only
   "after": <new value>,                    # fix only
   "status": "proposed" | "confirmed" | "withdrawn"}   # applied only once confirmed

`apply(items)` runs after a generator builds a segment and before it is
written, so the committed bank always equals a fresh run plus the verdicts:
  * reject   -> the item is dropped from the bank (the record keeps the reason);
  * fix      -> the field is replaced; when the field is `answer` the matching
                choice is replaced too, so the key stays one of the choices;
  * approve  -> review_status becomes "approved" and `reviewed` records who
                and when, which is what lets the importer store it approved.
A generator never reads a verdict; this is the one place verdicts touch items.
"""
from __future__ import annotations

import json
import pathlib
from typing import Any, Iterable, Optional

REPO = pathlib.Path(__file__).resolve().parents[2]
CORRECTIONS_DIR = REPO / "docs" / "study" / "corrections"
VERDICTS = ("approve", "fix", "reject", "source_ruling")


def load(directory: pathlib.Path = CORRECTIONS_DIR) -> list[dict]:
    """Every record in every *.jsonl file, in file then line order, PLUS the
    bulk lists: `<segment>.approved-<date>.json` and `<segment>.retired-<date>.json`
    ({"why": ..., "ids": [...]}) are one approve / reject verdict per id, so a
    delegated bulk decision (owner 2026-10-20: the session judges the candle
    chart examples) is applied on regeneration exactly like a per-item line."""
    out: list[dict] = []
    if not directory.exists():
        return out
    for path in sorted(directory.glob("*.jsonl")):
        with open(path, encoding="utf-8") as fh:
            for n, line in enumerate(fh, 1):
                line = line.strip()
                if not line:
                    continue
                rec = json.loads(line)
                if rec.get("verdict") not in VERDICTS:
                    raise ValueError(f"{path.name}:{n}: bad verdict {rec.get('verdict')!r}")
                out.append(rec)
    for verdict, pattern in (("approve", "*.approved-*.json"), ("reject", "*.retired-*.json")):
        for path in sorted(directory.glob(pattern)):
            segment, _, rest = path.name.partition(f".{'approved' if verdict == 'approve' else 'retired'}-")
            ts = rest[:-len(".json")]
            doc = json.loads(path.read_text(encoding="utf-8"))
            for iid in doc.get("ids") or []:
                out.append({"ts": ts, "item_id": iid, "segment": segment, "verdict": verdict,
                            "owner_words": doc.get("why", ""), "reason": "bad chart" if verdict == "reject" else None,
                            "bulk": path.name})
    return out


def by_item(records: Iterable[dict]) -> dict[str, list[dict]]:
    out: dict[str, list[dict]] = {}
    for r in records:
        iid = r.get("item_id")
        if iid:
            out.setdefault(iid, []).append(r)
    return out


def _apply_fix(it: dict, rec: dict) -> None:
    field = rec.get("field")
    after = rec.get("after")
    if field == "answer":
        before = it["answer_json"].get("answer")
        it["answer_json"]["answer"] = after
        choices = it.get("prompt_json", {}).get("choices")
        if isinstance(choices, list) and before in choices:
            choices[choices.index(before)] = after
    elif isinstance(field, str) and field.startswith("answer."):
        it.setdefault("answer_json", {})[field[len("answer."):]] = after       # e.g. answer.accept
    elif field == "q":
        it["prompt_json"]["q"] = after
    elif field == "choices":
        it["prompt_json"]["choices"] = list(after)
    elif field == "lesson_text":
        it["lesson_text"] = after
        # the owner's own words, unless the record says a session wrote it from
        # the item's facts (the 2026-10-21 audit: lesson_origin "session")
        it["lesson_origin"] = rec.get("lesson_origin") or "source"
    elif isinstance(field, str) and field.startswith("reveal."):
        it.setdefault("reveal_json", {})[field[len("reveal."):]] = after
    elif isinstance(field, str) and field.startswith("prompt."):
        it.setdefault("prompt_json", {})[field[len("prompt."):]] = after      # e.g. prompt.quote
    else:
        raise ValueError(f"fix for {it.get('id')}: unknown field {field!r}")


def apply(items: list[dict], records: Optional[Iterable[dict]] = None) -> list[dict]:
    """The items after the verdicts (a new list; items are mutated in place)."""
    index = by_item(load() if records is None else records)
    out: list[dict] = []
    for it in items:
        recs = index.get(it.get("id"), [])
        drop = False
        for rec in recs:
            v = rec["verdict"]
            if v == "reject":
                drop = True
            elif v == "fix" and rec.get("status", "confirmed") == "confirmed":
                _apply_fix(it, rec)
            elif v == "approve":
                it["review_status"] = "approved"
                it["reviewed"] = {"by": "owner", "ts": rec.get("ts"), "words": rec.get("owner_words")}
        if not drop:
            out.append(it)
    return out


def counts(records: Optional[Iterable[dict]] = None) -> dict[str, int]:
    out: dict[str, int] = {v: 0 for v in VERDICTS}
    for r in (load() if records is None else records):
        out[r["verdict"]] += 1
    return out
