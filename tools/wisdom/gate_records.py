"""R12 — persist a golden-gate run's validated records so a scoring bug is re-scorable for $0.00.

⚰️ **WHY THIS EXISTS.** On 2026-09-14 `golden.py` bound `_tokens` twice at module level, so the
PRINCIPLE branch of `match_segment` ran the paraphrase lens's tokenizer instead of the similarity
scorer's. Two gate runs were therefore scored with different similarity functions and their
precision/recall delta had to be **withdrawn**. Re-scoring locally was impossible: the gate kept
only aggregates (`segment-scores-*.json`) and record KEYS (`keys-*.json`), and a key is
`(type, normalized_quote_key)` — no span, no fields, no raw output. Closing it needed a **$4.34**
re-run of the API phase. Owner ruling R12 (2026-09-14): persist the records.

⭐ **The rule this generalises is already written beside the drift phase:** *a measurement that
discards its own inputs cannot be diagnosed, only repeated.*

⛔⛔ **PERSISTENCE MUST NEVER TOUCH SCORING.** This module is read-only with respect to the
gate: it is called AFTER `run_phase` returns, it reads the results, it writes files, and it
removes its own private key from each result before anything downstream sees it. A gate run's
aggregates are byte-identical with persistence on or off, and
`tests/test_wisdom_gate_records.py` proves that by running both and comparing.

⛔ **§0.4f is satisfied because of WHERE this writes, not because of what it holds.** The rows
carry quotes, spans and the raw extractor output — quote-bearing paid-transcript material. They
go under `data/wisdom/gate-runs/`, inside the tree `.gitignore:11 (data/)` already excludes and
which is already the home of the golden labels (`data/wisdom/golden/`), the samples and the
gate's existing `keys-*.json`. Nothing here is ever committed, served, or exported.

⭐ **A run directory is SELF-CONTAINED.** It carries the segment text, the golden `expected` rows
and the NULL spans alongside the predictions, so re-scoring needs the directory and nothing else
— not the golden file, which may have moved on, and not the samples tree. That is the difference
between "re-scorable" and "re-scorable if the rest of the world held still".
"""
from __future__ import annotations

import dataclasses
import json
import os
import pathlib

RAW_KEY = "_raw_output"
#: R56, and the distinction here is load-bearing rather than pedantic.
#:
#: There are TWO roots because there are two processes, and they are correct to differ:
#:   * the CHAIN's root is `reconcile.gate_runs_root()` — `<DATA_DIR>/wisdom/gate-runs`, i.e. the
#:     Railway VOLUME on the pod. That is the one authority for anything running in production.
#:   * THIS tool is PC-side. It runs on a developer box where `<DATA_DIR>` resolves to the LIVE
#:     `C:\data`, which `extract_common.out_path` refuses outright — so defaulting to the chain
#:     root would make the gate tool refuse to start, and pointing it at `C:\data` on purpose
#:     would be writing gate runs into the owner's production tree.
#:
#: ⛔ So the local default is REPO-ANCHORED and absolute (never CWD-relative, which was the
#: original defect): `<repo>/data/wisdom/gate-runs`, the gitignored tree §0.4f already governs and
#: where the three persisted 2026-09-15 passes actually are. `--gate-runs-dir` overrides it, and a
#: local run of the chain-side reconciler finds them by setting `WISDOM_GATE_RUNS_DIR` to the same
#: path. `identity_study.py:52` already anchors this way; this now matches it.
LOCAL_ROOT = pathlib.Path(__file__).resolve().parents[2] / "data" / "wisdom" / "gate-runs"

RECORDS_FILE = "records.jsonl"
SEGMENTS_FILE = "segments.jsonl"
MANIFEST_FILE = "manifest.json"


def _jsonl(path: pathlib.Path, rows) -> int:
    """Append rows atomically-per-file. Written with LF and `default=str`, like common.write_json."""
    tmp = path.with_suffix(path.suffix + ".tmp")
    existing = path.read_text(encoding="utf-8") if path.exists() else ""
    body = "".join(json.dumps(r, sort_keys=True, default=str) + "\n" for r in rows)
    tmp.write_text(existing + body, encoding="utf-8", newline="\n")
    os.replace(tmp, path)
    return len(rows)


def run_dir(root, run_id: str) -> pathlib.Path:
    return pathlib.Path(root) / run_id


def record_rows(items, results, *, run_id: str, phase: str, extractor_version: str, model: str,
                effort: str, transport: str) -> list:
    """One row per validated record. `dataclasses.asdict` so the row cannot drift from `Checked`.

    ⛔ The identity fields are DERIVED by calling `writer.record_id_for` / `writer.principle_key_for`
    rather than recomputing them here — the gate never writes to `wisdom_records`, so if these
    expressions were copied the persisted run would stop joining to the database it describes.
    """
    from api.services.wisdom.extract import writer

    rows = []
    for item, res in zip(items, results):
        res = res or {}
        segment = item["segment"]
        segment_id = segment["segment_id"]
        for ch in res.get("kept") or []:
            row = dataclasses.asdict(ch)
            f = ch.fields or {}
            principle_key = None
            if ch.record_type == "PRINCIPLE" and isinstance(f.get("principle"), dict):
                principle_key = writer.principle_key_for(ch.author_id, str(f["principle"].get("statement") or ""))
            market_signal_key = None
            if ch.record_type == "MARKET_SIGNAL":
                # ⚠️ MARKET_SIGNAL has NO id anywhere in the schema — it lives only as
                # wisdom_records.market_signal_json. Its key() tuple is the only identity it has.
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
            rows.append(row)
    return rows


def _expected_row(e):
    """`golden.Expected` -> a plain dict. ⛔ NEVER `default=str` on these.

    ⚰️ The first version of this module let `json.dumps(default=str)` handle `expected` and
    `nulls`. Both are frozen dataclasses, so they serialised to their `repr` — a persisted run
    looked complete, re-scored to nothing, and would have reproduced the very failure R12 exists
    to prevent. `NullSpan.types` is a frozenset, which is not JSON at all.
    """
    return e if isinstance(e, dict) else dataclasses.asdict(e)


def _null_row(n):
    if isinstance(n, dict):
        return n
    return {"gid": n.gid, "quote": n.quote, "types": sorted(n.types)}


def segment_rows(items, results, *, run_id: str, phase: str) -> list:
    """One row per segment: the call's outcome, and the RAW extractor output that produced it.

    ⭐ The raw output lives here, once per segment, not duplicated onto every record. It is the
    one artifact that makes a validator bug (as opposed to a scorer bug) diagnosable offline.
    """
    rows = []
    for item, res in zip(items, results):
        res = res or {}
        segment = item["segment"]
        rows.append({
            "run_id": run_id, "phase": phase,
            "segment_id": segment["segment_id"],
            "source_id": segment.get("source_id"), "source_version": segment.get("source_version"),
            "stream": (item.get("source") or {}).get("stream"),
            "text": segment.get("text"),
            "expected": [_expected_row(e) for e in (item.get("expected") or ())],
            "nulls": [_null_row(n) for n in (item.get("nulls") or ())],
            "gids": list(item.get("gids") or ()),
            "cost": res.get("cost", 0.0),
            "effort": res.get("effort"),
            "error": res.get("error"),
            "skipped": res.get("skipped"),
            "transport_error": bool(res.get("transport_error")),
            "retried_after": res.get("retried_after"),
            "counts": res.get("counts"),
            "kept": len(res.get("kept") or []),
            "usage": res.get("usage"),
            "usage_first": res.get("usage_first"),
            "raw_output": res.get(RAW_KEY),
        })
    return rows


def persist_phase(root, *, run_id: str, phase: str, items, results, extractor_version: str,
                  model: str, effort: str, transport: str, manifest_extra: dict = None) -> dict:
    """Write one phase's records and segments, then STRIP the raw output from every result.

    ⚠️ **Precisely why the aggregates are safe, because the obvious answer is wrong.** They are
    byte-identical because this function only READS the results — `summarise`, `segment_scores`
    and `keys_by_segment` each address named keys, so an extra key changes none of them. Proved
    by mutation 2026-09-14: deleting the strip below leaves every aggregate identical and fails
    only the test that watches for the key leaking. **So do not describe the strip as what keeps
    the aggregates honest** — it is not.

    ⛔ The strip earns its place for two different reasons: the raw outputs are the largest thing
    in the run and holding all of them to the end of a 57-segment phase is pure waste, and any
    future consumer that serialises a result WHOLESALE would otherwise pick up transcript text it
    never asked for. Returns a small summary for the manifest.
    """
    d = run_dir(root, run_id)
    d.mkdir(parents=True, exist_ok=True)
    recs = record_rows(items, results, run_id=run_id, phase=phase, extractor_version=extractor_version,
                       model=model, effort=effort, transport=transport)
    segs = segment_rows(items, results, run_id=run_id, phase=phase)
    _jsonl(d / RECORDS_FILE, recs)
    _jsonl(d / SEGMENTS_FILE, segs)
    for res in results:
        if isinstance(res, dict):
            res.pop(RAW_KEY, None)
    summary = {"phase": phase, "segments": len(segs), "records": len(recs),
               "raw_outputs": sum(1 for s in segs if s.get("raw_output") is not None)}
    manifest = {}
    path = d / MANIFEST_FILE
    if path.exists():
        manifest = json.loads(path.read_text(encoding="utf-8"))
    manifest.setdefault("run_id", run_id)
    manifest.setdefault("extractor_version", extractor_version)
    manifest.update(model=model, effort=effort, transport=transport)
    manifest.update(manifest_extra or {})
    manifest.setdefault("phases", {})[phase] = summary
    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(manifest, indent=1, sort_keys=True, default=str) + "\n",
                   encoding="utf-8", newline="\n")
    os.replace(tmp, path)
    return summary


def note_manifest(root, run_id: str, **fields) -> None:
    """Fold late-arriving provenance (the eval run_id, the gate decision) into the manifest."""
    path = run_dir(root, run_id) / MANIFEST_FILE
    if not path.exists():
        return
    manifest = json.loads(path.read_text(encoding="utf-8"))
    manifest.update(fields)
    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(manifest, indent=1, sort_keys=True, default=str) + "\n",
                   encoding="utf-8", newline="\n")
    os.replace(tmp, path)


# ── offline re-scoring ───────────────────────────────────────────────────────

_CHECKED_FIELDS = None


def _checked_fields() -> set:
    global _CHECKED_FIELDS
    if _CHECKED_FIELDS is None:
        from api.services.wisdom.extract import writer
        _CHECKED_FIELDS = {f.name for f in dataclasses.fields(writer.Checked)}
    return _CHECKED_FIELDS


def load_phase(root, run_id: str, phase: str) -> tuple:
    """Read one phase back as (items, results), shaped exactly as `run_phase` returned them.

    ⭐ This is the whole point of R12: what comes back here re-scores through the SAME
    `segment_scores` / `golden.score` path the live run used, with no API call and no golden file.
    """
    from api.services.wisdom.extract import golden, writer

    d = run_dir(root, run_id)
    by_segment: dict = {}
    for line in (d / RECORDS_FILE).read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        row = json.loads(line)
        if row.get("phase") != phase:
            continue
        by_segment.setdefault(row["segment_id"], []).append(
            writer.Checked(**{k: v for k, v in row.items() if k in _checked_fields()}))
    items, results = [], []
    for line in (d / SEGMENTS_FILE).read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        row = json.loads(line)
        if row.get("phase") != phase:
            continue
        sid = row["segment_id"]
        items.append({
            "segment": {"segment_id": sid, "text": row.get("text"),
                        "source_id": row.get("source_id"), "source_version": row.get("source_version")},
            "source": {"stream": row.get("stream")},
            # ⛔ rebuilt as the dataclasses `match_segment` expects, not left as dicts — a dict
            # has no `.quote` and the re-score would die (or worse, score nothing and look fine).
            "expected": [golden.Expected(**e) for e in (row.get("expected") or ())],
            "nulls": tuple(golden.NullSpan(gid=n["gid"], quote=n["quote"], types=frozenset(n["types"]))
                           for n in (row.get("nulls") or ())),
            "gids": list(row.get("gids") or ()),
        })
        results.append({"kept": by_segment.get(sid, []), "cost": row.get("cost", 0.0),
                        "effort": row.get("effort"), "error": row.get("error"),
                        "counts": row.get("counts")})
    return items, results
