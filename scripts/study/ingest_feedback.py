"""Carry the live feedback into the save file (owner 2026-10-21: "a system for
reviewing in site or in the discord and giving feedback for the quiz and test
so we can manually do this and ingest and update the information").

Where the feedback comes from: `GET /api/study/admin/feedback/export?since_id=N`
on the web pod (the review screen's "Export feedback" link), saved as JSON under
docs/study/feedback/exports/<anything>.json. Every row there is one thing a
member or the owner said about one item, from the reveal card or from `/study`
in Discord (see api/services/study_store.py: study_feedback).

What this writes, idempotently (a row already carried is skipped by its id):

  docs/study/corrections/feedback.jsonl
      one standard verdict record per OWNER row that carries approve / reject,
      in the shape scripts/study/corrections.py applies on regeneration, so the
      bank keeps the verdict the pod already applied;
  docs/study/feedback/REPORT.md
      every row that is still open (not handled on the screen), grouped by
      item with the question, the note, who said it and the verdict, for the
      session to act on (a lesson fix, a better example, a rejected chart),
      then the notes on whole SCREENS (layout, visuals, effects, how it
      behaves, what it teaches), grouped by screen.

A screen note never becomes an item verdict. The one verdict it can carry, the
owner's approve / fix on a lesson from the review hub's reading view, is
written to feedback.jsonl as a `source_ruling` with `about: "lesson"` (no
item id, so `corrections.apply` leaves every item alone).

Run from the repo root:
  python -m scripts.study.ingest_feedback             # exports -> jsonl + report
  python -m scripts.study.ingest_feedback --report-only
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import pathlib
from collections import defaultdict
from typing import Iterable, Optional

REPO = pathlib.Path(__file__).resolve().parents[2]
DOCS = REPO / "docs" / "study"
EXPORTS_DIR = DOCS / "feedback" / "exports"
REPORT_PATH = DOCS / "feedback" / "REPORT.md"
FEEDBACK_JSONL = DOCS / "corrections" / "feedback.jsonl"
BANK_DIR = DOCS / "bank"

APPLIED_VERDICTS = ("approve", "reject")
KIND_WORD = {
    "wrong_answer": "wrong answer", "bad_chart": "bad chart", "unclear_question": "question unclear",
    "unclear_lesson": "lesson unclear", "too_easy": "too easy", "too_hard": "too hard",
    "great": "great example", "other": "other",
    # screen notes (study_store.SCREEN_KINDS); "great" and "other" are shared
    "layout": "layout", "visuals": "visuals", "effects": "effects", "interaction": "interaction",
    "learning": "learning", "broken": "broken",
}
SCREEN_KIND_WORD = dict(KIND_WORD, great="great")
#: The segment a candle lesson ruling is filed under (the lessons ride on the chart items).
LESSON_SEGMENT = "candles.chart"


def is_screen_row(row: dict) -> bool:
    return bool(row.get("screen"))


def load_exports(directory: pathlib.Path = EXPORTS_DIR) -> list[dict]:
    """Every row from every export file, deduped by id, oldest first."""
    rows: dict[int, dict] = {}
    if not directory.exists():
        return []
    for path in sorted(directory.glob("*.json")):
        doc = json.loads(path.read_text(encoding="utf-8"))
        for r in (doc.get("feedback") if isinstance(doc, dict) else doc) or []:
            if isinstance(r, dict) and r.get("id") is not None:
                rows[int(r["id"])] = r            # a later export wins (it carries handled_at)
    return [rows[k] for k in sorted(rows)]


def segment_index(bank_dir: pathlib.Path = BANK_DIR) -> dict[str, str]:
    """{item_id: segment} from the committed bank, so a verdict record names
    the segment the way the hand-written ones do."""
    out: dict[str, str] = {}
    if not bank_dir.exists():
        return out
    for path in sorted(bank_dir.glob("*.json")):
        try:
            doc = json.loads(path.read_text(encoding="utf-8"))
        except ValueError:
            continue
        items = doc.get("items") if isinstance(doc, dict) else doc
        for it in items or []:
            if isinstance(it, dict) and it.get("id"):
                out[it["id"]] = path.stem
    return out


def carried_ids(path: pathlib.Path = FEEDBACK_JSONL) -> set[int]:
    out: set[int] = set()
    if not path.exists():
        return out
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line:
            rec = json.loads(line)
            if rec.get("feedback_id") is not None:
                out.add(int(rec["feedback_id"]))
    return out


def lesson_ruling(row: dict) -> Optional[dict]:
    """The source ruling for an OWNER verdict on a lesson (the review hub's
    reading view), else None. Approve is a confirmed ruling; fix is work for
    the next regeneration of docs/study/terms/candle_lessons.json."""
    ctx = row.get("context") if isinstance(row.get("context"), dict) else {}
    key = ctx.get("lesson_key")
    if (row.get("role") != "owner" or row.get("screen") != "lessons" or not key
            or row.get("verdict") not in ("approve", "fix")):
        return None
    label = ctx.get("label") or key
    words = row.get("text") or ""
    if row["verdict"] == "approve":
        action, status = f"the {label} lesson is approved as written", "confirmed"
    else:
        action = f"rewrite the {label} lesson in docs/study/terms/candle_lessons.json" + (f": {words}" if words else "")
        status = "build_required"
    return {"ts": (row.get("at") or "")[:10] or dt.date.today().isoformat(), "segment": LESSON_SEGMENT,
            "verdict": "source_ruling", "about": "lesson", "lesson_key": key, "lesson_verdict": row["verdict"],
            "owner_words": words, "action": action, "status": status, "channel": "review hub",
            "feedback_id": int(row["id"])}


def verdict_record(row: dict, segments: dict[str, str]) -> Optional[dict]:
    """The corrections record for an OWNER row with an applied verdict, else None.
    A screen note is never an item verdict; a lesson verdict is a source ruling."""
    if is_screen_row(row):
        return lesson_ruling(row)
    if row.get("role") != "owner" or row.get("verdict") not in APPLIED_VERDICTS:
        return None
    ts = (row.get("at") or "")[:10] or dt.date.today().isoformat()
    door = "discord" if row.get("channel") == "discord" else "site feedback"
    note = f"{KIND_WORD.get(row.get('kind'), row.get('kind'))}"
    if row.get("text"):
        note += f": {row['text']}"
    rec = {
        "ts": ts, "item_id": row["item_id"], "segment": segments.get(row["item_id"], "unknown"),
        "verdict": row["verdict"], "owner_words": row.get("text") or "",
        "note": f"{row.get('sym') or ''} {row.get('asof') or ''} {row.get('subject') or ''}".strip() + f" · {note}",
        "channel": door, "feedback_id": int(row["id"]),
    }
    if row["verdict"] == "reject":
        rec["reason"] = row.get("kind") or "other"
    return rec


def append_verdicts(rows: Iterable[dict], *, path: pathlib.Path = FEEDBACK_JSONL,
                    segments: Optional[dict[str, str]] = None) -> int:
    segments = segment_index() if segments is None else segments
    done = carried_ids(path)
    new = [verdict_record(r, segments) for r in rows if int(r["id"]) not in done]
    new = [r for r in new if r]
    if new:
        path.parent.mkdir(parents=True, exist_ok=True)
        with open(path, "a", encoding="utf-8", newline="\n") as fh:
            for rec in new:
                fh.write(json.dumps(rec, ensure_ascii=False) + "\n")
    return len(new)


def render_report(rows: list[dict], *, now: Optional[dt.datetime] = None) -> str:
    """REPORT.md: the open rows grouped by item, plus the counts by kind."""
    now = now or dt.datetime.now(dt.timezone.utc)
    open_all = [r for r in rows if not r.get("handled_at")]
    open_rows = [r for r in open_all if not is_screen_row(r)]
    open_screens = [r for r in open_all if is_screen_row(r)]
    by_item: dict[str, list[dict]] = defaultdict(list)
    for r in open_rows:
        by_item[r["item_id"]].append(r)
    kinds: dict[str, int] = defaultdict(int)
    for r in open_rows:
        kinds[r.get("kind") or "other"] += 1
    lines = ["# Study feedback — open items", "",
             f"Rendered {now.strftime('%Y-%m-%d %H:%MZ')} from {len(rows)} exported rows; "
             f"{len(open_rows)} open across {len(by_item)} items, {len(open_screens)} on screens. "
             "A row leaves this report when it is marked handled on the review screen.", ""]
    if kinds:
        lines.append("| kind | open |")
        lines.append("|---|---|")
        for k, n in sorted(kinds.items(), key=lambda kv: (-kv[1], kv[0])):
            lines.append(f"| {KIND_WORD.get(k, k)} | {n} |")
        lines.append("")
    for item_id, group in sorted(by_item.items(), key=lambda kv: (-len(kv[1]), kv[0])):
        head = group[0]
        label = " ".join(x for x in (head.get("sym"), head.get("asof"), head.get("subject")) if x) or item_id
        lines.append(f"## {label} · `{item_id}` (ref {head.get('ref') or item_id[3:9]})")
        if head.get("q"):
            lines.append(f"> {head['q']}")
        lines.append("")
        for r in sorted(group, key=lambda x: int(x["id"])):
            who = f"{r.get('role')} via {r.get('channel')}"
            verdict = f" · **{r['verdict']}**" if r.get("verdict") else ""
            ans = ""
            if r.get("answer_json") is not None:
                a = r["answer_json"] if isinstance(r["answer_json"], str) else json.dumps(r["answer_json"])
                ans = f" · answered {a}{' (correct)' if r.get('correct') else ' (not quite)' if r.get('correct') is False else ''}"
            text = f" — {r['text']}" if r.get("text") else ""
            lines.append(f"- #{r['id']} {KIND_WORD.get(r.get('kind'), r.get('kind'))}{verdict}{text}  "
                         f"({who}, {(r.get('at') or '')[:16].replace('T', ' ')}{ans})")
        lines.append("")
    if not by_item:
        lines.append("Nothing open.")
        lines.append("")
    lines += render_screens(open_screens)
    return "\n".join(lines)


def render_screens(open_screens: list[dict]) -> list[str]:
    """The notes on whole screens, grouped by screen, oldest first."""
    lines = ["## Screens", ""]
    if not open_screens:
        return lines + ["Nothing open on screens.", ""]
    by_screen: dict[str, list[dict]] = defaultdict(list)
    for r in open_screens:
        by_screen[r["screen"]].append(r)
    for screen, group in sorted(by_screen.items(), key=lambda kv: (-len(kv[1]), kv[0])):
        lines.append(f"### {screen} ({len(group)})")
        lines.append("")
        for r in sorted(group, key=lambda x: int(x["id"])):
            ctx = r.get("context") if isinstance(r.get("context"), dict) else {}
            where = ", ".join(f"{k} {v}" for k, v in ctx.items())
            verdict = f" · **{r['verdict']}**" if r.get("verdict") else ""
            text = f" — {r['text']}" if r.get("text") else ""
            lines.append(f"- #{r['id']} {SCREEN_KIND_WORD.get(r.get('kind'), r.get('kind'))}{verdict}{text}  "
                         f"({r.get('role')}, {(r.get('at') or '')[:16].replace('T', ' ')}"
                         f"{'; ' + where if where else ''})")
        lines.append("")
    return lines


def run(*, report_only: bool = False, exports_dir: pathlib.Path = EXPORTS_DIR,
        report_path: pathlib.Path = REPORT_PATH, jsonl_path: pathlib.Path = FEEDBACK_JSONL,
        bank_dir: pathlib.Path = BANK_DIR) -> dict:
    rows = load_exports(exports_dir)
    added = 0 if report_only else append_verdicts(rows, path=jsonl_path, segments=segment_index(bank_dir))
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(render_report(rows), encoding="utf-8", newline="\n")
    return {"rows": len(rows), "open": sum(1 for r in rows if not r.get("handled_at")), "verdicts_added": added}


def main(argv: Optional[list[str]] = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n", 1)[0])
    ap.add_argument("--report-only", action="store_true", help="rewrite REPORT.md, append no verdicts")
    args = ap.parse_args(argv)
    out = run(report_only=args.report_only)
    print(f"feedback rows {out['rows']} · open {out['open']} · verdict records added {out['verdicts_added']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
