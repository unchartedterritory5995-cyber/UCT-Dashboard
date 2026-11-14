# -*- coding: utf-8 -*-
"""evidence_ledger.py - the LEDGER_ONLY evidence: one row per graded capture, never its source.

The public repo's licence gate (docs/pine/LICENSING.md, `corpus_licence.is_permitted`,
evidence_engine "Licence gate") keeps a capture of a licence-held script out of git. Its verdict
still counts: `evidence_engine promote` files it here (`docs/pine/vendor-harness/evidence-ledger.jsonl`),
and `evidence_engine regrade` re-grades the out-of-git capture store at today's engine and
appends fresh rows. The coverage map (`tools/pine_coverage/coverage_map.py`) and the capability-
admission evidence (`tools/pine_coverage/capability_admission.py`) read this file through this
module, so the freshness rule lives in ONE place.

A ROW CARRIES what a verdict needs to be trusted and re-checked, and nothing else:
  the source sha256 (never the text), the script key and title, symbol, timeframe, the capture's
  receipt and file sha256, the verdict in BOTH lanes (production, runtime-on; None for a lane not
  graded), SCRIPT_ENGINE_VERSION and the grader version at grade time, the UTC time.
  `row_problems` refuses a row that carries source text or anything outside `ROW_FIELDS`.

FRESHNESS (`classify`): rows are grouped per capture (captureId + receipt) and per lane; the
NEWEST row wins (a local regrade supersedes an older row). It counts only when
  * it was graded at the CURRENT `SCRIPT_ENGINE_VERSION`, and
  * its `sourceSha256` is the sample's source sha256 (a sample whose script key names the row but
    whose source differs is a sha MISMATCH, never counted).
A stale row is "unproven (stale)", never proven. A DIVERGE counts as DIVERGE, never dropped.
"""
from __future__ import annotations

import datetime as _dt
import hashlib
import json
import os
import pathlib
import re

HERE = pathlib.Path(__file__).resolve().parent
REPO = HERE.parent.parent
LEDGER = REPO / "docs" / "pine" / "vendor-harness" / "evidence-ledger.jsonl"
SCHEMA = "uct.evidence-ledger/v2"
LANES = ("production", "runtime-on")
VERDICTS = ("MATCH", "DIVERGE", "INCONCLUSIVE")
FILED_BY = ("promote", "regrade")

#: The out-of-git capture store `regrade` reads: `<store>/*/captures/*.json`. The env var wins.
CAPTURE_STORE_ENV = "UCT_VENDOR_CAPTURE_STORE"
DEFAULT_CAPTURE_STORE = pathlib.Path(os.path.expanduser("~")) / "AppData" / "Local" / "uct-vendor-batch" / "runs"

#: Every key a row may carry. Nothing else (a capture's source, its provenance, an account) is filed.
ROW_FIELDS = frozenset({
    "schema", "filedBy", "gradedAtUTC", "captureId", "receipt", "captureSha256", "sourceSha256",
    "scriptKey", "script", "symbol", "timeframe", "bars", "verdicts", "firstDivergence",
    "scriptEngineVersion", "graderVersion", "licence", "promoted", "fixture", "packetSha256",
    "queueTargetId", "rows", "chartDefaulted",
})
REQUIRED = ("schema", "filedBy", "gradedAtUTC", "captureId", "receipt", "captureSha256", "sourceSha256",
            "scriptKey", "symbol", "timeframe", "verdicts", "scriptEngineVersion", "graderVersion")
#: A string longer than this in a row is refused: no field legitimately carries a script.
MAX_STRING = 600
_HEX64 = re.compile(r"[0-9a-f]{64}")
#: The grader: the corpus harness and the lane wiring it runs (their bytes are the grader version).
GRADER_FILES = (
    "app/src/components/chart/engine/__tests__/vendorHarness/vendorHarness.corpus.test.js",
    "app/src/components/chart/engine/__tests__/vendorHarness/harness.js",
    "app/src/components/chart/engine/__tests__/vendorHarness/ourSide.js",
    "app/src/components/chart/engine/__tests__/vendorHarness/objectRecords.js",
    "tools/pine_coverage/runtime_lane.mjs",
)


def engine_version():
    """`SCRIPT_ENGINE_VERSION` as the browser declares it (the server's one reader)."""
    import sys
    if str(REPO) not in sys.path:
        sys.path.insert(0, str(REPO))
    from api.services.user_definitions import read_script_engine_version  # noqa: PLC0415
    return read_script_engine_version()


def grader_version(repo: pathlib.Path = REPO) -> str:
    """sha256 (12 hex) over the grader's files, LF-normalised: it moves when the harness does."""
    h = hashlib.sha256()
    for rel in GRADER_FILES:
        p = pathlib.Path(repo) / rel
        h.update(rel.encode("utf-8") + b"\0")
        h.update(p.read_bytes().replace(b"\r\n", b"\n") if p.exists() else b"<absent>")
    return h.hexdigest()[:12]


def capture_store() -> pathlib.Path:
    v = os.environ.get(CAPTURE_STORE_ENV, "").strip()
    return pathlib.Path(v) if v else DEFAULT_CAPTURE_STORE


def script_key(capture_id: str) -> str:
    """The script part of a capture id `<script>-<sym>-<tf>-<yyyy-mm-dd>` (the capture stem)."""
    m = re.match(r"^(.*)-[a-z0-9.!]+-(?:\d+|1?[dwm]|[0-9]+[dwm])-\d{4}-\d{2}-\d{2}$", capture_id or "")
    return m.group(1) if m else (capture_id or "")


def source_shas(text: str) -> set:
    """The sha256 a capture of this sample would carry: the exact text, and its LF form (a
    checkout's line endings are the box's, not the script's)."""
    out = {hashlib.sha256(text.encode("utf-8")).hexdigest()}
    out.add(hashlib.sha256(text.replace("\r\n", "\n").replace("\r", "\n").encode("utf-8")).hexdigest())
    return out


def _lane_verdict(v) -> dict | None:
    if not isinstance(v, dict) or v.get("verdict") is None:
        return None
    return {"verdict": v.get("verdict"), "reason": (str(v.get("reason") or "")[:MAX_STRING] or None)}


def make_row(*, capture: dict, capture_bytes: bytes, verdicts: dict, filed_by: str, licence,
             engine: int | None, grader: str, stamp: str | None = None, **extra) -> dict:
    """One ledger row for a graded capture. `verdicts` is {lane: {verdict, reason} | None}.
    ⛔ The capture's source text, its provenance and its account never enter the row; the row is
    checked (`row_problems`) and refused before it is returned if anything slipped in."""
    cid = capture.get("id")
    src = capture.get("source") or {}
    row = {
        "schema": SCHEMA, "filedBy": filed_by,
        "gradedAtUTC": stamp or _dt.datetime.now(_dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "captureId": cid, "receipt": (capture.get("receipt") or {}).get("fnv1a"),
        "captureSha256": hashlib.sha256(capture_bytes).hexdigest(),
        "sourceSha256": src.get("sha256"),
        "scriptKey": script_key(cid),
        "script": (str(src.get("declaredTitle") or "")[:200] or None),
        "symbol": (capture.get("symbol") or {}).get("pro_name"), "timeframe": capture.get("timeframe"),
        "bars": (capture.get("bars") or {}).get("count"),
        "verdicts": {lane: _lane_verdict((verdicts or {}).get(lane)) for lane in LANES},
        "scriptEngineVersion": engine, "graderVersion": grader, "licence": licence,
    }
    row.update({k: v for k, v in extra.items() if k in ROW_FIELDS})
    problems = row_problems(row, source_text=src.get("text"))
    if problems:
        raise ValueError(f"ledger row for {cid} refused: {'; '.join(problems)}")
    return row


def _strings(o):
    if isinstance(o, str):
        yield o
    elif isinstance(o, dict):
        for v in o.values():
            yield from _strings(v)
    elif isinstance(o, list):
        for v in o:
            yield from _strings(v)


def row_problems(row, source_text: str | None = None) -> list:
    """Why this row may NOT be filed (empty = it may)."""
    if not isinstance(row, dict):
        return ["not an object"]
    p = []
    extra = sorted(set(row) - ROW_FIELDS)
    if extra:
        p.append(f"keys outside the ledger schema: {extra}")
    for k in REQUIRED:
        if row.get(k) in (None, ""):
            p.append(f"{k} is missing")
    if row.get("schema") not in (None, SCHEMA):
        p.append(f"schema {row.get('schema')!r} is not {SCHEMA}")
    if row.get("filedBy") not in FILED_BY + (None,):
        p.append(f"filedBy {row.get('filedBy')!r}")
    for k in ("sourceSha256", "captureSha256"):
        if row.get(k) is not None and not (isinstance(row[k], str) and _HEX64.fullmatch(row[k])):
            p.append(f"{k} is not a sha256")
    v = row.get("verdicts")
    if not isinstance(v, dict) or set(v) != set(LANES):
        p.append(f"verdicts must name exactly the lanes {list(LANES)}")
    else:
        graded = [x for x in v.values() if x is not None]
        if not graded:
            p.append("no lane carries a verdict")
        for x in graded:
            if not isinstance(x, dict) or x.get("verdict") not in VERDICTS:
                p.append(f"a lane verdict is not one of {VERDICTS}: {x!r}")
    if row.get("scriptEngineVersion") is not None and not isinstance(row.get("scriptEngineVersion"), int):
        p.append("scriptEngineVersion is not an integer")
    for s in _strings(row):
        if len(s) > MAX_STRING:
            p.append(f"a string of {len(s)} characters (no ledger field carries a script)")
            break
    if isinstance(source_text, str) and len(source_text.strip()) >= 40:
        body = [ln.strip() for ln in source_text.splitlines() if len(ln.strip()) >= 40]
        if any(source_text in s or any(ln in s for ln in body) for s in _strings(row)):
            p.append("the row carries the capture's source text")
    return p


def read_rows(path: pathlib.Path = LEDGER) -> list:
    path = pathlib.Path(path)
    if not path.exists():
        return []
    rows = []
    for ln in path.read_text(encoding="utf-8").splitlines():
        if ln.strip():
            rows.append(json.loads(ln))
    return rows


def row_key(row) -> tuple:
    """The identity `append` dedupes on: the same capture graded by the same engine and grader is
    the same evidence; a regrade at a new engine is a new row."""
    return (row.get("captureId"), row.get("receipt"), row.get("scriptEngineVersion"),
            row.get("graderVersion"), row.get("filedBy"))


def append(path: pathlib.Path, rows) -> int:
    path = pathlib.Path(path)
    for r in rows:
        problems = row_problems(r)
        if problems:
            raise ValueError(f"ledger row for {r.get('captureId')} refused: {'; '.join(problems)}")
    have = {row_key(r) for r in read_rows(path)}
    new = [r for r in rows if row_key(r) not in have]
    if not new:
        return 0
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "a", encoding="utf-8", newline="\n") as fh:
        for r in new:
            fh.write(json.dumps(r, ensure_ascii=False, sort_keys=True) + "\n")
        fh.flush()
        os.fsync(fh.fileno())
    return len(new)


def newest_per_capture(rows, lane: str) -> list:
    """The newest row per capture (captureId + receipt) that carries a verdict in `lane`."""
    best = {}
    for r in rows:
        v = (r.get("verdicts") or {}).get(lane)
        if not isinstance(v, dict) or v.get("verdict") not in VERDICTS:
            continue
        k = (r.get("captureId"), r.get("receipt"))
        if k not in best or str(r.get("gradedAtUTC") or "") >= str(best[k].get("gradedAtUTC") or ""):
            best[k] = r
    return list(best.values())


def classify(rows, samples: dict, *, engine: int | None, lane: str, skip_captures=frozenset(),
             slug_of=None) -> dict:
    """Ledger evidence joined to samples.

    `samples`: {sample_key: set of source sha256 it would carry} (`source_shas`).
    `slug_of`: {sample_key: script key} for the sha-MISMATCH check (a sample whose script key names
    the row but whose source does not hash to the row's). `skip_captures`: capture ids already
    graded from a committed fixture (counted there, never twice).

    Returns {"byKey": {key: {"verdicts": [..fresh verdicts..], "stale": n, "captures": [...]}},
             "counts": {fresh, stale, shaMismatch, unjoined, skipped}, "shaMismatch": [...], "stale": [...]}.
    """
    by_sha = {}
    for k, shas in samples.items():
        for s in shas:
            by_sha.setdefault(s, []).append(k)
    by_slug = {}
    for k, slug in (slug_of or {}).items():
        by_slug.setdefault(slug, []).append(k)
    out = {"byKey": {}, "counts": {"fresh": 0, "stale": 0, "shaMismatch": 0, "unjoined": 0, "skipped": 0},
           "shaMismatch": [], "stale": []}
    for r in sorted(newest_per_capture(rows, lane), key=lambda r: (r.get("captureId") or "", r.get("receipt") or "")):
        cid = r.get("captureId")
        if cid in skip_captures:
            out["counts"]["skipped"] += 1
            continue
        keys = by_sha.get(r.get("sourceSha256")) or []
        if not keys:
            named = by_slug.get(r.get("scriptKey")) or []
            if named:
                out["counts"]["shaMismatch"] += 1
                out["shaMismatch"].append({"captureId": cid, "samples": sorted(named)})
            else:
                out["counts"]["unjoined"] += 1
            continue
        fresh = engine is not None and r.get("scriptEngineVersion") == engine
        verdict = r["verdicts"][lane]["verdict"]
        for k in keys:
            e = out["byKey"].setdefault(k, {"verdicts": [], "stale": 0, "captures": []})
            if fresh:
                e["verdicts"].append(verdict)
                e["captures"].append(cid)
            else:
                e["stale"] += 1
        if fresh:
            out["counts"]["fresh"] += 1
        else:
            out["counts"]["stale"] += 1
            out["stale"].append({"captureId": cid, "scriptEngineVersion": r.get("scriptEngineVersion")})
    return out
