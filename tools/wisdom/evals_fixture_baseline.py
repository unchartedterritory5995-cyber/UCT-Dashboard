"""PROVISIONAL fixture baseline for 6.1 a/b/c, 6.2 and 6.3 (stream S-E; W1 §9.1 "baselines recorded").

FIXTURE-BASED: the records are the golden labels (v1 when present, else the v0 draft), loaded as
CALL / NEGATIVE_CALL rows into a THROWAWAY wisdom.db. STALE-MIRROR-BASED: bars come from a local
bars.db and replay sources from a local ENGINE uct_intelligence.db, both opened read-only; neither
is production. The printout says so on every line that carries a number.

    python tools/wisdom/evals_fixture_baseline.py --golden <golden.jsonl> --bars-db <bars.db> \
        --engine-db <uct_intelligence.db> --out-db <scratch wisdom.db> [--now ISO]

Prints aggregates and golden ids only — never a quote, never a stated level.
Entries stated on OPEN positions are not loaded (they belong to the owner-private store).
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sqlite3
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
from tools.wisdom import evals_common  # noqa: E402

OPEN_STANCES = {"watching", "taking", "in_it", "added"}
STREAMS = {"sunday_scans", "zoom_live", "workshop", "interview", "education", "discord", "x"}


def _slug(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


def seed_fixture_vocabulary(conn, vocab_file: str) -> dict:
    """Draft vocabulary + its maps_to hints as FIXTURE rows (S-B seeds the real ones)."""
    data = json.load(open(vocab_file, encoding="utf-8"))
    maps = 0
    for entry in data.get("entries", []):
        vid = "draft:" + _slug(entry["name"])
        conn.execute("INSERT OR IGNORE INTO wisdom_vocab (vocab_id, name, kind, status, aliases_json, version) "
                     "VALUES (?, ?, ?, ?, ?, 'v0-draft-fixture')",
                     (vid, entry["name"], entry.get("kind") or "setup",
                      "approved" if entry.get("evidence_strength") == "strong" else "candidate",
                      json.dumps(entry.get("aliases_as_used") or [])))
        hints = entry.get("maps_to") or {}
        for list_name, raw in (("setupCatalog.js", hints.get("desk")), ("pattern_engine", hints.get("engine"))):
            if not raw:
                continue
            for part in re.split(r"\s*/\s*", str(raw)):
                external = re.sub(r"\s*\(.*\)\s*$", "", part).strip()
                if external:
                    conn.execute("INSERT OR IGNORE INTO wisdom_vocab_maps (list_name, external_name, vocab_id, note) "
                                 "VALUES (?, ?, ?, 'fixture: draft maps_to hint')", (list_name, external, vid))
                    maps += 1
    return {"vocab": len(data.get("entries", [])), "maps": maps}


def _discord_stated_at(external_ref: str):
    """A Discord message id is a snowflake: its creation instant is exact (minute precision)."""
    from datetime import datetime, timezone

    from api.services.wisdom.core import timeutil

    try:
        message_id = int(str(external_ref).rsplit(":", 1)[-1])
    except ValueError:
        return None
    instant = datetime.fromtimestamp(((message_id >> 22) + 1420070400000) / 1000.0, tz=timezone.utc)
    return timeutil.iso_et(instant)


def _golden_fields(g: dict) -> dict:
    """One shape out of golden v0 (labels) and v1 (expected + evidence + locator). The `private`
    block of v1 is NEVER read: open-position entries and sizes belong to the owner-private store."""
    from api.services.wisdom.core import authors

    stream = g.get("stream") if g.get("stream") in STREAMS else "education"
    if "expected" in g:
        lab, ev, loc = g.get("expected") or {}, g.get("evidence") or {}, g.get("locator") or {}
        entity = ev.get("entity")
        ticker = entity.get("ticker") if isinstance(entity, dict) else entity
        ticker = str(ticker or lab.get("ticker_as_written") or "").lstrip("$").upper() or None
        external = loc.get("external_ref") or g["gid"]
        stated, precision = f"{str(ev.get('session_date'))[:10]}T00:00:00-04:00", "day"
        if stream == "discord" and str(external).startswith("discord:"):
            exact = _discord_stated_at(external)
            if exact:
                stated, precision = exact, "minute"
        zone = lab.get("entry_zone") or [None, None]
        return {"stream": stream, "external": external, "author": g.get("author_id"), "ticker": ticker,
                "stated": stated, "precision": precision, "vocab_name": lab.get("setup_vocab"),
                "setup_raw": lab.get("setup_name_raw"), "entry": lab.get("entry"), "zone": zone,
                "stop": lab.get("stop"), "targets": lab.get("targets") or [], "lab": lab,
                "status": g.get("status") if g.get("status") in ("confirmed", "provisional") else "provisional",
                "hindsight": bool(lab.get("hindsight")) or lab.get("stance") == "hindsight"}
    lab = g.get("labels") or {}
    author_label = str(g.get("author") or "")
    author = authors.author_for_alias(author_label)
    if author is None and stream == "sunday_scans" and author_label.lower().startswith("unattributed"):
        author = "tsdr"                         # D4: unsigned Sunday Scans sections are TSDR's
    return {"stream": stream, "external": g.get("source_ref") or g["gid"], "author": author,
            "ticker": (lab.get("ticker") or "").upper() or None,
            "stated": f"{str(g.get('published_at'))[:10]}T00:00:00-04:00", "precision": "day",
            "vocab_name": lab.get("setup_name_v0"), "setup_raw": lab.get("setup_name_raw"), "entry": lab.get("entry"),
            "zone": [None, None], "stop": lab.get("stop"), "targets": lab.get("targets") or [], "lab": lab,
            "status": "provisional", "hindsight": lab.get("stance") == "hindsight"}


def load_golden(conn, golden_file: str) -> dict:
    from api.services.wisdom.core import ids

    loaded = {"CALL": 0, "NEGATIVE_CALL": 0, "skipped": 0, "open_entries_withheld": 0, "confirmed": 0,
              "provisional": 0, "minute_precision": 0}
    for line in open(golden_file, encoding="utf-8"):
        if not line.strip():
            continue
        g = json.loads(line)
        if g.get("record_type") not in ("CALL", "NEGATIVE_CALL"):
            loaded["skipped"] += 1
            continue
        f = _golden_fields(g)
        lab = f["lab"]
        sid = ids.sha24("golden", f["external"])
        conn.execute("INSERT OR IGNORE INTO wisdom_sources (source_id, stream, external_ref, raw_sha256, ingest_version, "
                     "ingested_at) VALUES (?, ?, ?, 'fixture', 'golden-fixture', 'fixture')",
                     (sid, f["stream"], f"golden:{f['external']}"))
        seg = ids.sha24(sid, g["gid"])
        conn.execute("INSERT OR IGNORE INTO wisdom_segments (segment_id, source_id, source_version, ordinal, kind, text, "
                     "text_sha256, normalizer_version) VALUES (?, ?, 1, 0, 'section', ?, 'fixture', 'fixture')",
                     (seg, sid, f"locator:{g['gid']}"))
        stance = lab.get("stance")
        entry, (zone_lo, zone_hi) = f["entry"], (list(f["zone"]) + [None, None])[:2]
        if stance in OPEN_STANCES and (entry is not None or zone_lo is not None):
            entry = zone_lo = zone_hi = None
            loaded["open_entries_withheld"] += 1
        setup_raw = f["setup_raw"]
        if isinstance(setup_raw, list):
            setup_raw = setup_raw[0] if setup_raw else None
        vocab_id = "draft:" + _slug(f["vocab_name"]) if f["vocab_name"] else None
        conn.execute(
            "INSERT OR REPLACE INTO wisdom_records (record_id, record_type, segment_id, source_id, source_version, "
            "extractor_version, record_hash, author_id, stated_at_et, stated_at_precision, ticker, direction, stance, "
            "setup_name_raw, vocab_id, entry, entry_zone_lo, entry_zone_hi, stop, targets_json, stated_outcome, "
            "stated_return_pct, hindsight, extraction_confidence, status, created_at) "
            "VALUES (?,?,?,?,1,'golden-fixture',?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'high',?,'fixture')",
            (g["gid"], g["record_type"], seg, sid, ids.sha24(g["gid"]), f["author"], f["stated"], f["precision"],
             f["ticker"], lab.get("direction"), stance, setup_raw, vocab_id, entry, zone_lo, zone_hi, f["stop"],
             json.dumps(f["targets"]), lab.get("stated_outcome"), lab.get("stated_return_pct"),
             1 if f["hindsight"] else 0, f["status"]))
        loaded[g["record_type"]] += 1
        loaded[f["status"]] += 1
        loaded["minute_precision"] += int(f["precision"] == "minute")
    return loaded


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--golden", required=True)
    ap.add_argument("--bars-db", required=True)
    ap.add_argument("--engine-db", required=True)
    ap.add_argument("--out-db", required=True)
    ap.add_argument("--now")
    args = ap.parse_args(argv)
    if os.path.exists(args.out_db):
        raise SystemExit(f"--out-db already exists; the baseline needs a throwaway file: {args.out_db}")
    for label, path in (("--golden", args.golden), ("--bars-db", args.bars_db), ("--engine-db", args.engine_db)):
        evals_common.require_file(path, label)
    evals_common.bootstrap(args.out_db)

    from api.services.wisdom.core import store
    from api.services.wisdom.evals import context, metrics, pipeline, replay
    from api.services.wisdom.evals.bars_asof import BarsAsOf, ReadOnlyFileReader

    store.init_db()
    vocab_file = os.path.join(str(evals_common.REPO), "docs", "wisdom", "vocabulary", "setup-vocabulary-v0.draft.json")
    with store.write() as conn:
        seeded = seed_fixture_vocabulary(conn, vocab_file)
        loaded = load_golden(conn, args.golden)
    ctx = evals_common.job_context("tools_evals_fixture_baseline", dry_run=False, now_iso=args.now)
    bars = BarsAsOf(ReadOnlyFileReader(args.bars_db))
    engine = args.engine_db
    env = context.ContextEnv(bars=bars, now=ctx.now_et, engine_db_path=engine)
    adapters = [replay.LeadershipSnapshots(engine, "morning_wire"), replay.LeadershipSnapshots(engine, "autonomous_brain"),
                replay.SetupTriggers(engine), replay.EpCandidates(engine), replay.WireUniverse(engine)]
    summary = {
        "context": pipeline.run_context(ctx, env=env),
        "outcomes": pipeline.run_outcomes(ctx, bars=bars),
    }
    try:
        summary["replay"] = pipeline.run_replay(ctx, adapters=adapters)
    finally:
        for adapter in adapters:
            adapter.close()
    summary["metrics"] = pipeline.run_metrics(ctx)

    ro = sqlite3.connect("file:" + os.path.abspath(args.engine_db).replace("\\", "/") + "?mode=ro", uri=True)
    engine_through = ro.execute("SELECT MAX(snapshot_date) FROM leadership_snapshots").fetchone()[0]
    ro.close()
    spy = bars.history("SPY", __import__("datetime").date(2100, 1, 1), 1)
    bars_through = str(spy[-1].d) if spy else "none"
    label = (f"PROVISIONAL · FIXTURE-BASED (golden {os.path.basename(args.golden)}: {loaded['CALL']} CALL / "
             f"{loaded['NEGATIVE_CALL']} NEGATIVE_CALL) · STALE-MIRROR-BASED (bars.db through {bars_through}; "
             f"ENGINE through {engine_through})")
    print(label)
    print("fixture vocabulary:", json.dumps(seeded), "· records:", json.dumps(loaded))
    print("steps:", json.dumps(summary, indent=2, default=str))
    with store.read() as conn:
        latest = metrics.latest_metrics(conn)
        checks = conn.execute("SELECT source, verdict, COUNT(*) FROM wisdom_replay_checks GROUP BY source, verdict "
                              "ORDER BY source, verdict").fetchall()
        outcome_status = conn.execute("SELECT COALESCE(unverifiable_reason, 'computed'), COUNT(*), "
                                      "SUM(ret_1 IS NOT NULL), SUM(ret_5 IS NOT NULL) FROM wisdom_outcomes "
                                      "GROUP BY 1").fetchall()
    print("replay checks by source:", json.dumps([tuple(r) for r in checks]))
    print("outcomes (reason, rows, ret_1 known, ret_5 known):", json.dumps([tuple(r) for r in outcome_status]))
    for row in latest:
        if row["slice"] == {"status": "combined"}:
            notes = row["notes"] if isinstance(row["notes"], dict) else {}
            extra = {k: notes[k] for k in ("unproven", "not_replayed", "excluded", "no_matured_outcome",
                                           "unproven_or_not_replayed") if k in notes}
            print(f"  {row['metric']:<28} {row['display']:<34} {json.dumps(extra)}  [{label.split(' · ')[0]}]")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
