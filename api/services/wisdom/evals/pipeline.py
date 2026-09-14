"""The evals step of the Wisdom daily chain: context -> outcomes -> replay -> metrics.

`evals.run_daily(ctx)` is what S-F's wisdom_daily_chain calls (CONTRACTS §5 gives evals no slot of
its own). Each sub-step re-reads its own kill switch unless ctx.force. ctx.dry_run computes
everything and writes nothing (and spends nothing: no step here calls a paid API).

A sub-step that raises does not stop the others; run_daily raises AFTER all of them have run, so
the registry records the run as failed and pages — a partial failure is never swallowed into "ok".
"""
from __future__ import annotations

import json
import logging
from collections import Counter
from datetime import timedelta
from typing import Optional

from api.services.wisdom.core import flags, store, timeutil
from api.services.wisdom.evals import context as context_mod
from api.services.wisdom.evals import metrics as metrics_mod
from api.services.wisdom.evals import outcomes as outcomes_mod
from api.services.wisdom.evals import replay as replay_mod
from api.services.wisdom.evals.bars_asof import BarsAsOf

log = logging.getLogger(__name__)

REPLAY_RETRY_DAYS = 5


class EvalsStepFailed(RuntimeError):
    pass


def _records(conn, types=("CALL", "NEGATIVE_CALL")) -> list[dict]:
    marks = ",".join("?" for _ in types)
    return [dict(r) for r in conn.execute(
        f"SELECT * FROM wisdom_records WHERE record_type IN ({marks}) AND status IN ('provisional','confirmed') "
        "ORDER BY stated_at_et", tuple(types))]


def run_context(ctx, *, db_path: Optional[str] = None, env: Optional[context_mod.ContextEnv] = None,
                bars: Optional[BarsAsOf] = None, limit: int = 1000) -> dict:
    with store.read(db_path) as conn:
        candidates = [dict(r) for r in conn.execute(
            "SELECT r.* FROM wisdom_records r LEFT JOIN wisdom_context_snapshots s ON s.record_id = r.record_id "
            "AND s.snapshot_version = ? WHERE r.record_type = 'CALL' AND r.status IN ('provisional','confirmed') "
            "AND s.record_id IS NULL ORDER BY r.stated_at_et DESC LIMIT ?",
            (context_mod.SNAPSHOT_VERSION, limit))]
    if not candidates:
        return {"candidates": 0, "written": 0}
    env = env or context_mod.default_env(now=ctx.now_et, bars=bars)
    snaps = [context_mod.compute_snapshot(rec, env) for rec in candidates]
    gaps = Counter(f.get("gap", "").split(":")[0] for s in snaps for f in s["fields"].values() if f.get("gap"))
    written = 0
    if not ctx.dry_run:
        with store.write(db_path) as conn:
            for s in snaps:
                if s["as_of_et"] is None:
                    continue
                cur = conn.execute(
                    "INSERT OR IGNORE INTO wisdom_context_snapshots (record_id, snapshot_version, as_of_et, "
                    "fields_json, completeness, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                    (s["record_id"], s["snapshot_version"], s["as_of_et"], json.dumps(s["fields"], sort_keys=True),
                     s["completeness"], s["created_at"]))
                written += cur.rowcount
    mean = round(sum(s["completeness"] for s in snaps) / len(snaps), 4)
    return {"candidates": len(candidates), "written": written, "mean_completeness": mean,
            "top_gaps": dict(gaps.most_common(8)), "reader_notes": env.notes}


def run_outcomes(ctx, *, db_path: Optional[str] = None, bars: Optional[BarsAsOf] = None) -> dict:
    bars = bars or BarsAsOf()
    with store.read(db_path) as conn:
        records = [r for r in _records(conn) if r["record_type"] == "CALL" or r.get("direction")]
        existing = {row["record_id"]: dict(row) for row in conn.execute(
            "SELECT * FROM wisdom_outcomes WHERE methodology_version = ?", (outcomes_mod.METHODOLOGY_VERSION,))}
    tally: Counter = Counter()
    rows = []
    for rec in records:
        if not outcomes_mod.needs_refresh(existing.get(rec["record_id"])):
            tally["final"] += 1
            continue
        result = outcomes_mod.compute(rec, bars, now=ctx.now_et)
        tally[result["status"]] += 1
        if result["row"] is not None:
            rows.append(result["row"])
    if rows and not ctx.dry_run:
        cols = list(rows[0].keys())
        with store.write(db_path) as conn:
            conn.executemany(
                f"INSERT OR REPLACE INTO wisdom_outcomes ({', '.join(cols)}) VALUES ({', '.join(':' + c for c in cols)})",
                rows)
    return {"records": len(records), "written": 0 if ctx.dry_run else len(rows), **dict(tally)}


def run_replay(ctx, *, db_path: Optional[str] = None, adapters: Optional[list] = None,
               vocab: Optional[replay_mod.VocabLookup] = None, retry_days: int = REPLAY_RETRY_DAYS) -> dict:
    now = timeutil.to_et(ctx.now_et)
    owned_adapters = adapters is None
    notes: dict = {}
    if owned_adapters:
        adapters, notes = replay_mod.default_adapters(now=now, archive=context_mod.archive_reader())
    results = []
    try:
        with store.read(db_path) as conn:
            records = _records(conn)
            prior: dict = {}
            for row in conn.execute(
                    "SELECT record_id, verdict, as_of, reason FROM wisdom_replay_checks WHERE method_version=?",
                    (replay_mod.METHOD_VERSION,)):
                prior.setdefault(row["record_id"], []).append(dict(row))
            lookup = vocab or replay_mod.VocabLookup(conn)
            horizon = (now.date() - timedelta(days=retry_days)).isoformat()

            def retry(check: dict) -> bool:
                """Re-ask when a recent session may have filled in, OR when the last answer was
                'we could not read the source' — that one is about US and can be settled later,
                at any age. Keying only on the session date stranded every older record whose
                source happened to be down on the single run that touched it."""
                if check["verdict"] != "unproven":
                    return False
                return check["as_of"] >= horizon or replay_mod.is_source_unavailable(check.get("reason"))

            for rec in records:
                done = prior.get(rec["record_id"])
                if done and not any(retry(c) for c in done):
                    continue
                results.append(replay_mod.replay_record(rec, adapters, lookup))
    finally:
        if owned_adapters:
            for adapter in adapters:
                adapter.close()
    checked_at = timeutil.iso_et(now)
    levels: Counter = Counter()
    for res in results:
        for level, verdict in res["levels"].items():
            levels[f"{level}:{verdict['verdict']}"] += 1
    if not ctx.dry_run:
        with store.write(db_path) as conn:
            for res in results:
                if res["session"] is None:
                    continue
                rid = res["record_id"]
                conn.execute("DELETE FROM wisdom_replay_hits WHERE record_id = ?", (rid,))
                for c in res["checks"]:
                    conn.execute(
                        "INSERT OR REPLACE INTO wisdom_replay_checks (record_id, source, method_version, as_of, "
                        "verdict, rank, top_n, setup_raw, vocab_id, reason, checked_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                        (rid, c["source"], replay_mod.METHOD_VERSION, c["as_of"], c["verdict"], c.get("rank"),
                         c.get("top_n"), c.get("setup_raw"), c.get("vocab_id"), c.get("reason"), checked_at))
                by_source = {c["source"]: c for c in res["checks"]}
                for level, verdict in res["levels"].items():
                    if verdict["verdict"] != "hit":
                        continue
                    for source in verdict["sources"]:
                        c = by_source[source]
                        conn.execute(
                            "INSERT OR REPLACE INTO wisdom_replay_hits (record_id, level, source, as_of, rank, "
                            "setup_raw, vocab_id) VALUES (?,?,?,?,?,?,?)",
                            (rid, level, source, c["as_of"], c.get("rank"), c.get("setup_raw"), c.get("vocab_id")))
    return {"replayed": len(results), "levels": dict(levels), "source_notes": notes,
            "written": not ctx.dry_run}


def run_metrics(ctx, *, db_path: Optional[str] = None, vocab: Optional[replay_mod.VocabLookup] = None) -> dict:
    with store.read(db_path) as conn:
        rows = metrics_mod.compute(conn, vocab=vocab or replay_mod.VocabLookup(conn), now=ctx.now_et)
    if not ctx.dry_run:
        with store.write(db_path) as conn:
            metrics_mod.write(conn, rows)
    overall = {r["metric"]: metrics_mod.render(r) for r in rows if r["slice_json"] == '{"status": "combined"}'}
    return {"rows": len(rows), "written": 0 if ctx.dry_run else len(rows), "overall_combined": overall}


STEPS = (
    ("context", flags.context_snapshot_enabled, run_context, ("db_path", "env", "bars")),
    ("outcomes", flags.outcomes_enabled, run_outcomes, ("db_path", "bars")),
    ("replay", flags.replay_enabled, run_replay, ("db_path", "adapters", "vocab")),
    ("metrics", flags.metrics_enabled, run_metrics, ("db_path", "vocab")),
)


def run_daily(ctx, **overrides) -> dict:
    summary: dict = {"dry_run": bool(ctx.dry_run), "force": bool(ctx.force)}
    failures = []
    for name, gate, fn, accepted in STEPS:
        if not ctx.force and not gate():
            summary[name] = {"skipped": "kill switch off"}
            continue
        kwargs = {k: v for k, v in overrides.items() if k in accepted and v is not None}
        try:
            summary[name] = fn(ctx, **kwargs)
        except Exception as exc:
            log.exception("[wisdom:evals] step %s failed", name)
            summary[name] = {"failed": f"{type(exc).__name__}: {exc}"[:500]}
            failures.append(name)
        if hasattr(ctx, "log"):
            ctx.log(f"evals {name}: {json.dumps(summary[name], default=str)[:400]}")
    if failures:
        raise EvalsStepFailed(f"evals steps failed: {', '.join(failures)} :: "
                              f"{json.dumps(summary, default=str)[:1500]}")
    return summary
