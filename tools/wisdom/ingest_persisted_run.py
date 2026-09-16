#!/usr/bin/env python
"""R40 — put ONE persisted gate run into a LOCAL store, through the production writer.

⛔⛔ DEV-ONLY. This is a tool, never a chain step, and nothing under `api/**` may import it. It
exists for one reason: item 2 and item 3 both act on the DATABASE, and the golden gate persists to
JSONL and never ingests — so session 9's chain run reconciled 1,223 identities correctly and wrote
them to **zero rows**. Until something puts records in a store, the floor blocks nothing in
practice and the review queue cannot hold anything.

⭐ IT USES THE PRODUCTION WRITER, `writer.write_output` (writer.py:675) — the SAME function the
daily chain reaches through `batch.handle_result` (batch.py:519), the only non-test caller. So
`record_hash` (writer.py:321) and `record_id` (writer.py:199) are the production ones and the rows
join to everything that reads them. A parallel INSERT would produce rows that look right and key
wrong.

⛔ THREE REFUSALS, each for a different accident:
  1. any of the five switches set in this process's environment — an ingest tool must never run
     inside something that is also live;
  2. a `--db` that does not resolve under `data/wisdom/` or a temp directory — the shared root on
     this box is REAL and a mistyped path writes to the owner's live data;
  3. a production-looking `DATA_DIR` / `DATABASE_URL`.
Each refusal exits 2 and names itself. ⚠️ Refusal 2 is the load-bearing one; the other two are
cheap and catch a different kind of mistake.

⚠️ THE SOURCE ROW IS SYNTHESISED AND SAYS SO. A persisted gate run carries segment text and the
raw model output, but not the source's provenance (published_at_et, external_ref, raw_sha256).
Those are NOT NULL, so this tool writes a row marked `DEV-INGEST` in `title`/`show` and an
`external_ref` of `gate-run:<run_id>:<source_id>`. ⛔ Never mistake one of these for a capture: a
real ingest comes from the capture lane with real provenance, and a row that claims a publication
date it does not have is worse than a row that admits it is synthetic.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import pathlib
import sys
import tempfile

REPO = pathlib.Path(__file__).resolve().parents[2]
if str(REPO) not in sys.path:
    sys.path.insert(0, str(REPO))

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass

#: The five the brief names. ⛔ Read, never written — this tool refuses if any is SET.
SWITCHES = ("WISDOM_INGEST_ENABLED", "WISDOM_CAPTURE_ENABLED", "WISDOM_SOURCES_INGEST_ENABLED",
            "WISDOM_EXTRACT_ENABLED", "ASKAI_WISDOM_RETRIEVAL_ENABLED")

DEV_MARKER = "DEV-INGEST"
OK, REFUSED, FAILED = 0, 2, 1


class Refused(Exception):
    """A refusal is a named exit, never a traceback the operator has to interpret."""


def check_switches(env=None) -> None:
    env = os.environ if env is None else env
    lit = [n for n in SWITCHES if str(env.get(n, "")).strip() not in ("", "0", "false", "no", "off")]
    if lit:
        # ⛔ names only. The VALUE of a switch is not printed even though it is not a secret —
        # the habit is the point (§11.3), and a switch value is one grep away from a key value.
        raise Refused(f"refusing: {len(lit)} of the five wisdom switches are SET in this "
                      f"environment ({', '.join(sorted(lit))}). An ingest tool does not run "
                      f"inside a live process.")


def check_db_path(db: pathlib.Path) -> pathlib.Path:
    """⛔ THE LOAD-BEARING REFUSAL. `C:\\data` is REAL on this box."""
    resolved = db.resolve()
    allowed_repo = (REPO / "data" / "wisdom").resolve()
    allowed_tmp = pathlib.Path(tempfile.gettempdir()).resolve()
    for root in (allowed_repo, allowed_tmp):
        try:
            resolved.relative_to(root)
            return resolved
        except ValueError:
            continue
    raise Refused(f"refusing: --db must resolve under {allowed_repo} or {allowed_tmp}; "
                  f"got {resolved}")


def check_environment(env=None) -> None:
    env = os.environ if env is None else env
    for name in ("DATA_DIR", "DATABASE_URL", "DATABASE"):
        value = str(env.get(name, "") or "")
        if not value:
            continue
        low = value.lower()
        if low in ("/data", "\\data") or low.startswith("/data/") or "railway" in low:
            raise Refused(f"refusing: {name} looks like production ({value!r} — reported because "
                          f"it is a PATH, not a credential). Pin it to a sandbox first.")


#: ⛔ DERIVED FROM THE LIVE TABLE, NEVER TYPED. `wisdom_sources` grew `ingest_version` and
#: `ingested_at` — both NOT NULL with NO DEFAULT — in a migration later than the base contract DDL.
#: Typing a column list from the .sql file omitted them, every INSERT OR IGNORE failed the NOT NULL,
#: and OR IGNORE swallowed it: 63 attempts, 0 rows, reported as success. Reading the columns from
#: the connection means the next migration cannot repeat that.
_SOURCE_DEFAULTS = {"version": 1, "guest_names_json": "[]", "incomplete": 0,
                    "ingest_version": DEV_MARKER}


def _source_values(conn, run_id: str, source_id: str, stream: str, text_blob: str, as_of: str) -> tuple:
    cols = [r[1] for r in conn.execute("PRAGMA table_info(wisdom_sources)")]
    row = dict(_SOURCE_DEFAULTS)
    row.update(source_id=source_id, stream=stream or "zoom_live",
               external_ref=f"gate-run:{run_id}:{source_id}",
               published_at_et=as_of, recording_started_at_et=as_of,
               title=DEV_MARKER, show=DEV_MARKER, ingested_at=as_of,
               raw_sha256=hashlib.sha256(text_blob.encode("utf-8")).hexdigest())
    return cols, tuple(row.get(c) for c in cols)


def ingest(run_dir: pathlib.Path, conn, *, extractor_version: str, as_of: str) -> dict:
    """Insert the segments (and their synthetic sources), then run the production writer."""
    from api.services.wisdom.extract import writer

    rows = [json.loads(l) for l in (run_dir / "segments.jsonl").read_text(encoding="utf-8").splitlines() if l.strip()]
    by_source: dict = {}
    for r in rows:
        by_source.setdefault(r["source_id"], []).append(r)

    # ⛔ ROWS WRITTEN, NEVER ATTEMPTS MADE. `INSERT OR IGNORE` turns a constraint violation into
    # silence, so a counter incremented beside the call reports success for zero rows — which is
    # exactly what happened here on the first run (63 "sources", 0 rows). Same lesson as
    # reconcile.write_scores returning counts: a write that matched nothing must be visible.
    counts: dict = {"sources": 0, "source_attempts": 0, "segments": 0, "segment_attempts": 0,
                    "segments_with_output": 0}
    for source_id, segs in sorted(by_source.items()):
        blob = "".join(s.get("text") or "" for s in segs)
        cols, values = _source_values(conn, run_dir.name, source_id, segs[0].get("stream"), blob, as_of)
        cur = conn.execute(
            f"INSERT OR IGNORE INTO wisdom_sources ({','.join(cols)}) "
            f"VALUES ({','.join('?' * len(cols))})", values)
        counts["source_attempts"] += 1
        counts["sources"] += cur.rowcount or 0
        for ordinal, s in enumerate(segs):
            text = s.get("text") or ""
            cur = conn.execute(
                "INSERT OR IGNORE INTO wisdom_segments (segment_id, source_id, source_version, "
                "ordinal, kind, path, t_start_s, t_end_s, char_start, char_end, speaker_label, "
                "author_id, speaker_confidence, text, text_sha256, normalizer_version) "
                "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (s["segment_id"], source_id, s.get("source_version") or 1, ordinal, "section",
                 None, None, None, None, None, None, None, None, text,
                 hashlib.sha256(text.encode("utf-8")).hexdigest(), DEV_MARKER))
            counts["segment_attempts"] += 1
            counts["segments"] += cur.rowcount or 0

    if counts["source_attempts"] and not counts["sources"]:
        # ⛔ a first ingest that writes no sources is a swallowed constraint failure, not an
        # idempotent re-run — those differ, and only this can tell them apart on run 1.
        existing = conn.execute("SELECT COUNT(*) FROM wisdom_sources").fetchone()[0]
        if not existing:
            raise Refused(f"refusing to report success: {counts['source_attempts']} source inserts "
                          f"wrote 0 rows and the table is empty — a constraint was violated and "
                          f"INSERT OR IGNORE swallowed it.")

    written: dict = {}
    for r in rows:
        output = r.get("raw_output")
        if not isinstance(output, dict):
            continue
        counts["segments_with_output"] += 1
        segment = {"segment_id": r["segment_id"], "source_id": r["source_id"],
                   "source_version": r.get("source_version") or 1, "text": r.get("text") or "",
                   "cue_map": []}
        source = {"source_id": r["source_id"], "stream": r.get("stream"),
                  "published_at_et": as_of, "recording_started_at_et": as_of}
        report = writer.write_output(conn, segment=segment, source=source, output=output,
                                     extractor_version=extractor_version)
        for k, v in dict(report).items():
            written[k] = written.get(k, 0) + int(v)
    return {"inserted": counts, "writer": written}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--run-dir", required=True, help="one persisted gate run directory")
    ap.add_argument("--db", required=True, help="LOCAL store; must be under data/wisdom/ or temp")
    ap.add_argument("--as-of", default="2026-09-15", help="synthetic source date (see the docstring)")
    args = ap.parse_args()

    try:
        check_switches()
        check_environment()
        db = check_db_path(pathlib.Path(args.db))
    except Refused as exc:
        print(exc)
        return REFUSED

    run_dir = pathlib.Path(args.run_dir)
    manifest = json.loads((run_dir / "manifest.json").read_text(encoding="utf-8"))
    version = manifest["extractor_version"]
    print(f"run {run_dir.name}  extractor_version {version}  -> {db}")

    from api.services.wisdom.core import store

    with store.write() as conn:
        result = ingest(run_dir, conn, extractor_version=version, as_of=args.as_of)
    print(json.dumps(result, indent=1, sort_keys=True))
    return OK


if __name__ == "__main__":
    raise SystemExit(main())
