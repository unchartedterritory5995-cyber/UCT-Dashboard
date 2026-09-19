"""The R12 persisted-run layout, owned by ONE module (R53 N-pass, 2026-09-15).

⛔⛔ WHY THIS EXISTS AT ALL. Before it, the chain produced DB rows and **no per-run record set**,
while the PC-side gate tool produced a per-run record set and **no DB rows** — and
`reconcile.score_silently`, which runs ON THE CHAIN, consumed the TOOL's output. So stability had
never once been computed from anything the chain itself produced. An N-pass that submits three
passes and persists none would be strictly worse than no N-pass: it triples the bill and leaves
the reconciler with nothing to score.

⛔ ONE AUTHORITY FOR THE ROW SHAPE. `tools/wisdom/gate_records.py` writes the same layout and now
IMPORTS `record_row` from here rather than building its own. Two builders for one on-disk format is
how a writer and a reader come to disagree in silence — the same defect R56 closed for the ROOT,
one level down at the row.

⭐ The identity fields are DERIVED by calling `writer.record_id_for` / `writer.principle_key_for`,
never recomputed. A persisted run whose ids are computed a second way stops joining to the database
it describes.
"""
from __future__ import annotations

import dataclasses
import json
import os
import pathlib
from typing import Optional

from api.services.wisdom.extract.reconcile import (MANIFEST_FILE, RECORDS_FILE, SEGMENTS_SEEN_FILE,
                                                    gate_runs_root)


def record_row(ch, *, segment: dict, run_id: str, phase: str, extractor_version: str,
               model: str, effort: str, transport: str) -> dict:
    """One validated record (`writer.Checked`) as a persisted-run row.

    `dataclasses.asdict` first, so the row cannot drift from `Checked` as fields are added.
    """
    from api.services.wisdom.extract import writer

    segment_id = segment["segment_id"]
    row = dataclasses.asdict(ch)
    f = ch.fields or {}
    principle_key = None
    if ch.record_type == "PRINCIPLE" and isinstance(f.get("principle"), dict):
        principle_key = writer.principle_key_for(ch.author_id, str(f["principle"].get("statement") or ""))
    market_signal_key = None
    if ch.record_type == "MARKET_SIGNAL":
        # ⚠️ MARKET_SIGNAL has no id anywhere in the schema — it lives only as
        # wisdom_records.market_signal_json — so its key() tuple is the only identity it has.
        # ⛔ `fields.market_signal.name` rides along inside `row` and is LOAD-BEARING: without it
        # reconcile's `_name_tokens` returns empty, no pair is ever a merge candidate, and
        # MS_IDENTITY="MERGED_J05" silently degrades to KEY.
        market_signal_key = list(ch.key())
    row.update(
        run_id=run_id, phase=phase, extractor_version=extractor_version,
        model=model, effort=effort, transport=transport,
        segment_id=segment_id,
        source_id=segment.get("source_id"), source_version=segment.get("source_version"),
        record_id=writer.record_id_for(segment_id, extractor_version, ch.record_hash),
        principle_key=principle_key,
        market_signal_key=market_signal_key,
        record_key=list(ch.key()),
        pre_entity_key=list(ch.key(pre_entity=True)),
    )
    return row


def run_dir(run_id: str, *, root=None) -> pathlib.Path:
    """`<gate-runs root>/<run_id>`. ⛔ The root resolves per call (R56) — never at import."""
    base = pathlib.Path(root) if root is not None else gate_runs_root()
    return base / run_id


def append_records(run_id: str, rows: list, *, root=None) -> int:
    """Append rows to this run's records.jsonl, atomically per write.

    ⛔ APPEND, not overwrite: the reap handles ONE result per transaction and a night's segments
    arrive across many reap ticks, so a run directory is built up incrementally. Writing via a
    temp file plus `os.replace` means a crash mid-tick leaves the previous complete file, never a
    half-line that `load_run`'s `json.loads` would refuse.
    """
    if not rows:
        return 0
    d = run_dir(run_id, root=root)
    d.mkdir(parents=True, exist_ok=True)
    path = d / RECORDS_FILE
    tmp = path.with_suffix(path.suffix + ".tmp")
    existing = path.read_text(encoding="utf-8") if path.exists() else ""
    body = "".join(json.dumps(r, sort_keys=True, default=str) + "\n" for r in rows)
    tmp.write_text(existing + body, encoding="utf-8", newline="\n")
    os.replace(tmp, path)
    return len(rows)


def write_manifest(run_id: str, manifest: dict, *, root=None) -> pathlib.Path:
    """The run's manifest. ⚠️ OPTIONAL to `reconcile.discover`, which needs only records.jsonl —
    written anyway so a run on the volume can be read by a human without the database."""
    d = run_dir(run_id, root=root)
    d.mkdir(parents=True, exist_ok=True)
    path = d / MANIFEST_FILE
    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(manifest, indent=1, sort_keys=True, default=str), encoding="utf-8", newline="\n")
    os.replace(tmp, path)
    return path


def persist_result(*, run_id: str, segment: dict, validation, extractor_version: str, model: str,
                   effort: str, pass_index: int, root=None) -> int:
    """Persist ONE reaped result's validated records into its pass's run directory.

    Returns the number of rows written. A result that kept nothing writes nothing and returns 0 —
    ⛔ which is correct and must not be confused with a failure: a segment can legitimately contain
    no records, and `reconcile` compares SEGMENT SETS, not row counts.
    """
    rows = [record_row(ch, segment=segment, run_id=run_id, phase="gate",
                       extractor_version=extractor_version, model=model, effort=effort,
                       transport="batch")
            for ch in (getattr(validation, "kept", None) or [])]
    written = append_records(run_id, rows, root=root)
    write_manifest(run_id, {"run_id": run_id, "phase": "gate", "extractor_version": extractor_version,
                            "model": model, "effort": effort, "transport": "batch",
                            "pass_index": pass_index, "source": "chain"}, root=root)
    return written


def touch_segment(run_id: str, segment_id: str, *, root=None) -> None:
    """Record that this pass SAW a segment, even if it kept nothing.

    ⛔⛔ THE SEGMENT SET IS THE THING RECONCILE COMPARES. `reconcile` REFUSES outright when the
    runs' segment id sets differ (`reconcile.py:310-320`), and a pass that legitimately extracted
    no records from a segment would otherwise be missing that id — so three good passes could
    refuse to reconcile because one of them found nothing in one paragraph. The empty marker keeps
    the sets equal without inventing a record.

    ⛔ `reconcile.load_run` is the ONE reader of this file (2026-09-19 fix) — before that fix this
    marker was written and never read, so it kept the sets equal in name only. Never hand-roll a
    second reader; import `SEGMENTS_SEEN_FILE` if one is ever needed elsewhere.
    """
    d = run_dir(run_id, root=root)
    d.mkdir(parents=True, exist_ok=True)
    seen = d / SEGMENTS_SEEN_FILE
    tmp = seen.with_suffix(".jsonl.tmp")
    existing = seen.read_text(encoding="utf-8") if seen.exists() else ""
    if f'"{segment_id}"' in existing:
        return
    tmp.write_text(existing + json.dumps({"segment_id": segment_id}, sort_keys=True) + "\n",
                   encoding="utf-8", newline="\n")
    os.replace(tmp, seen)
