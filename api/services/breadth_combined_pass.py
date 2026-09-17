"""THE COMBINED HISTORICAL PASS — one download, four universes, isolated artifact.

⭐⭐ WHAT THIS IS FOR. The reconstruction math is proven (RTH-only, 1-minute, composites
before OHLC, authoritative close). What was missing was a way to RUN it at scale without
writing into the live breadth database. `sweep_wicks` writes through
`breadth_daily_ohlc.write_bulk` into production; this does not, and cannot.

⛔⛔ THE ARTIFACT PATH IS REQUIRED AND IS NEVER DEFAULTED. There is deliberately no
fallback, no environment variable and no "if omitted, use the usual place". A generator
that can open the production database by forgetting an argument is one typo away from
overwriting nineteen years of history, and BL-025 is this programme's own account of
what a single unintended write costs. `open_artifact` also REFUSES a path that resolves
to the live store.

⭐ ONE DOWNLOAD PER SESSION, WHICH IS THE WHOLE ECONOMIC POINT. The whole-market minute
file is ~28 MB and dominates the job; the universes differ only in WHICH names they
count. So the file is read once, resampled once, and `breadth_wick_recon.session_ohlc`
— the same function `recon_day` calls — is run once per universe over it. Downloading
per universe would quadruple a 131 GB job to buy nothing.

⚠️ A SESSION IS THE UNIT OF WORK. Every universe's rows for date D commit in ONE
transaction with the checkpoint, or none of them do. A pass that can leave UCT written,
US half-written and NASDAQ missing while marking D complete is a pass whose resume is a
guess.
"""
from __future__ import annotations

import json
import logging
import os
import sqlite3
import sys
import time
from typing import Optional

_log = logging.getLogger("breadth_combined_pass")

METHODOLOGY = "rth-1m-composites-v1"

#: Universes this pass can build, and where each one's membership comes from.
#:   uct  — the collector's population, via the production resolver (present-day list,
#:          which is the EXISTING UCT semantic and deliberately unchanged here)
#:   us / nasdaq / nyse — point-in-time: who actually traded that session, classified by
#:          the provider reference map, with NO price or liquidity filter
PIT_UNIVERSES = ("us", "nasdaq", "nyse")
ALL_UNIVERSES = ("uct",) + PIT_UNIVERSES

#: ⛔⛔ METRICS THE UNION-LEVELS OPTIMISATION CANNOT SERVE, and the reason is precise.
#:
#: `build_levels` is per-ticker for almost everything — a name's 50-day average and
#: 52-week extremes do not depend on the cohort — which is what lets one levels build
#: serve four universes. But `mcclellan_osc` is an EMA of a CROSS-SECTIONAL
#: net-advance series computed inside `build_levels` over whatever matrix it was given,
#: and `adv_decline_cum` is a running total of the same shape. Their value therefore
#: depends on the population the levels were built from, not on any one ticker.
#:
#: ⚠️ MEASURED, NOT ASSUMED. Generating the same seven sessions with four separate
#: levels builds and with one union build produced 924 rows that agreed in every cell
#: EXCEPT these: 28 rows, exactly one per universe per session, all `mcclellan_osc`.
#: That is the whole divergence, and it is why the equivalence was verified rather than
#: argued.
#:
#: ⭐ They are excluded rather than special-cased. Both are already
#: `breadth_metrics.PIT_UNPRODUCIBLE`, so US/NASDAQ/NYSE must never carry them anyway
#: (BL-012). UCT's McClellan has an authoritative source of its own — the collector —
#: and this pass has no business restating it from a different population.
NOT_MEMBER_INDEPENDENT = frozenset({"mcclellan_osc", "adv_decline_cum"})


_SCHEMA = """
CREATE TABLE IF NOT EXISTS breadth_daily_ohlc (
    universe TEXT NOT NULL DEFAULT 'uct',
    date    TEXT NOT NULL,
    metric  TEXT NOT NULL,
    o REAL, h REAL, l REAL, c REAL,
    source  TEXT DEFAULT 'live',
    updated_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (universe, date, metric)
);
CREATE TABLE IF NOT EXISTS pass_checkpoint (
    date TEXT PRIMARY KEY,
    status TEXT NOT NULL,            -- done | missing_source | failed
    universes TEXT,
    rows INTEGER DEFAULT 0,
    detail TEXT,
    at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS pass_meta (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS pass_session (
    date TEXT PRIMARY KEY, universe_sizes TEXT, close_basis TEXT,
    buckets INTEGER, early_close INTEGER, calendar TEXT
);
"""


class ArtifactRefused(RuntimeError):
    """The pass did not start. Nothing was opened, nothing was written."""


def _production_paths() -> set:
    out = set()
    try:
        from api.services import breadth_daily_ohlc as store
        out.add(os.path.abspath(store._db_path()))
    except Exception:
        pass
    for p in ("/data/breadth_daily_ohlc.db", r"C:\data\breadth_daily_ohlc.db"):
        out.add(os.path.abspath(p))
    return out


def open_artifact(path: Optional[str]) -> sqlite3.Connection:
    """Open the ISOLATED artifact. ⛔ Refuses an absent path or the production store."""
    if not path or not str(path).strip():
        raise ArtifactRefused(
            "an explicit artifact path is REQUIRED — this generator has no default "
            "destination on purpose, so that forgetting one argument cannot open the "
            "live breadth database")
    ap = os.path.abspath(str(path))
    if ap in _production_paths():
        raise ArtifactRefused(
            f"{ap} is the PRODUCTION breadth store — the combined pass never writes "
            f"there. Generate to an isolated artifact and promote it deliberately.")
    os.makedirs(os.path.dirname(ap) or ".", exist_ok=True)
    c = sqlite3.connect(ap, timeout=30.0)
    c.execute("PRAGMA journal_mode=WAL")
    c.executescript(_SCHEMA)
    c.commit()
    return c


def _meta(c: sqlite3.Connection, **kv) -> None:
    c.executemany("INSERT INTO pass_meta(key, value) VALUES(?,?) "
                  "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                  [(k, json.dumps(v) if not isinstance(v, str) else v)
                   for k, v in kv.items()])


def completed(c: sqlite3.Connection) -> set:
    return {r[0] for r in c.execute(
        "SELECT date FROM pass_checkpoint WHERE status IN ('done','missing_source')")}


def _head() -> str:
    import subprocess
    try:
        return subprocess.run(["git", "rev-parse", "HEAD"], capture_output=True,
                              text=True, timeout=10).stdout.strip()[:12] or "unknown"
    except Exception:
        return "unknown"


def resolve_universes(D: str, per_ticker: dict, uct_tickers: list,
                      ref_map: dict) -> dict:
    """{universe: [tickers]} for session D, from the ALREADY-DOWNLOADED session.

    ⭐ THE PIT UNIVERSES COME FROM WHO ACTUALLY TRADED, classified by the provider's
    reference record as-of D — the same `breadth_pit_frame` machinery the audited US
    artifact used, with the approved difference that NO price or liquidity filter is
    applied. That is the whole universe correction: a $2 floor removed 65% of real new
    lows and is not what "US market breadth" means.

    ⛔ No present-day membership is projected backward: `resolve()` picks the record
    whose listing window contains D, and a name absent from that session's file is
    absent from the universe.
    """
    from api.services import breadth_pit_frame as bpf
    from api.services import breadth_universes as bu

    traded = list(per_ticker.keys())
    out = {"uct": [t for t in uct_tickers if t in per_ticker]}
    by_uni = {u: [] for u in PIT_UNIVERSES}
    for t in traded:
        rec = bpf.resolve(ref_map.get(t), D)
        if rec is None or rec.get("type") not in bpf.COMMON_TYPES:
            continue
        exch = (rec.get("primary_exchange") or "").upper()
        if not exch:
            continue
        for u in PIT_UNIVERSES:
            allowed = bu.venues(u)
            if allowed and exch in allowed:
                by_uni[u].append(t)
    out.update(by_uni)
    return out


def run(artifact: str, from_date: str, to_date: str,
        universes: tuple = ALL_UNIVERSES, bucket_min: int = 1,
        limit: int = 0, progress_every: int = 1) -> dict:
    """Generate the replacement artifact. Chronological, atomic per session, resumable."""
    from datetime import date as _d, timedelta as _td
    from api.services import breadth_history_recon as _recon
    from api.services import breadth_live as bl
    from api.services import breadth_metrics as bm
    from api.services import breadth_pit_frame as bpf
    from api.services import breadth_wick_recon as wr
    from api.services import build_intraday_cache as bic

    c = open_artifact(artifact)
    uct_tickers, uct_date = _recon._resolve_universe()
    if "uct" in universes and not uct_tickers:
        raise ArtifactRefused(
            "the production universe resolver returned nothing — refusing to sweep an "
            "empty population rather than writing a silently empty artifact")
    ref_map = bpf.reference_map()
    client = wr._s3_client()
    if client is None:
        raise ArtifactRefused("no S3 client — the minute source is unreachable here")

    _meta(c, methodology=METHODOLOGY, commit=_head(), resolution=f"{bucket_min}m",
          session="RTH", universes=",".join(universes),
          requested_from=from_date, requested_to=to_date,
          uct_universe_date=str(uct_date), provider="massive-s3-flatfiles",
          started_at=time.strftime("%Y-%m-%dT%H:%M:%S"))
    c.commit()

    done = completed(c)
    d, end = _d.fromisoformat(from_date), _d.fromisoformat(to_date)
    stats = {"attempted": 0, "done": 0, "missing_source": 0, "failed": 0, "rows": 0,
             "skipped_existing": len(done)}
    conn_bars = bl._bars_conn()
    t_start = time.time()

    while d <= end:
        D = d.isoformat()
        d += _td(days=1)
        if D in done or _d.fromisoformat(D).weekday() >= 5:
            continue
        if limit and stats["attempted"] >= limit:
            break
        stats["attempted"] += 1
        try:
            key = wr._S3_KEY.format(y=D[:4], m=D[5:7], d=D)
            res = bic.download_and_resample(client, key, [bucket_min], None)
            per_all = (res or {}).get(bucket_min) or {}
            if not per_all:
                _checkpoint(c, D, "missing_source", detail="no minute flat file")
                stats["missing_source"] += 1
                continue
            unis = resolve_universes(D, per_all, uct_tickers, ref_map)
            rows, sizes, sess_meta = [], {}, None
            # ⭐⭐ ONE LEVELS BUILD FOR ALL FOUR UNIVERSES. `build_levels` is per-ticker —
            # a name's 50-day average and 52-week extremes do not depend on who else is
            # in the frame — so building it once over the UNION and restricting each
            # universe through `members` is identical to four separate builds, and it is
            # the single biggest cost in the session. Measured: ~37 s/session with four
            # builds against a 27 GB bars.db.
            union = sorted({t for u in universes for t in (unis.get(u) or [])})
            if not union:
                _checkpoint(c, D, "failed", detail="no universe resolved any name")
                stats["failed"] += 1
                continue
            levels = wr._levels_for_day(conn_bars, union,
                                        bl._ts_int(_d.fromisoformat(D)))
            if levels is None:
                _checkpoint(c, D, "missing_source", detail="no levels (bars history)")
                stats["missing_source"] += 1
                continue
            for u in universes:
                names = unis.get(u) or []
                sizes[u] = len(names)
                if not names:
                    continue
                member_set = set(names)
                sub = {t: per_all[t] for t in names if t in per_all}
                out = wr.session_ohlc(D, sub, levels, bucket_min, members=member_set)
                if not out:
                    continue
                sess_meta = sess_meta or out.get("_session")
                for metric, r in out.items():
                    if metric.startswith("_") or r.get("source") != "intraday_recon":
                        continue
                    # ⛔ THE CANONICAL GATE, not a local opinion: `applies_to` is what
                    # `library_rows` and the sweep already read, so a metric excluded
                    # here cannot be stored OR offered. Plus the union-levels exclusion.
                    if metric in NOT_MEMBER_INDEPENDENT:
                        continue
                    if not bm.applies_to(metric, u):
                        continue
                    rows.append((u, D, metric, r["o"], r["h"], r["l"], r["c"],
                                 "intraday_recon_1m"))
            if not rows:
                _checkpoint(c, D, "failed", detail="no universe produced rows")
                stats["failed"] += 1
                continue
            # ⚠️ ONE TRANSACTION: every universe's rows for D, the session record and
            # the checkpoint commit together or not at all.
            c.execute("BEGIN IMMEDIATE")
            c.executemany(
                "INSERT INTO breadth_daily_ohlc"
                "(universe,date,metric,o,h,l,c,source,updated_at) "
                "VALUES(?,?,?,?,?,?,?,?,datetime('now')) "
                "ON CONFLICT(universe,date,metric) DO UPDATE SET "
                "o=excluded.o,h=excluded.h,l=excluded.l,c=excluded.c,"
                "source=excluded.source,updated_at=excluded.updated_at", rows)
            if sess_meta:
                c.execute("INSERT INTO pass_session"
                          "(date,universe_sizes,close_basis,buckets,early_close,calendar) "
                          "VALUES(?,?,?,?,?,?) ON CONFLICT(date) DO UPDATE SET "
                          "universe_sizes=excluded.universe_sizes",
                          (D, json.dumps(sizes), sess_meta.get("close_basis"),
                           sess_meta.get("buckets"),
                           1 if sess_meta.get("early_close") else 0,
                           sess_meta.get("calendar")))
            c.execute("INSERT INTO pass_checkpoint(date,status,universes,rows,detail) "
                      "VALUES(?,?,?,?,?) ON CONFLICT(date) DO UPDATE SET "
                      "status=excluded.status,rows=excluded.rows",
                      (D, "done", json.dumps(sizes), len(rows), None))
            c.execute("COMMIT")
            stats["done"] += 1
            stats["rows"] += len(rows)
            if progress_every and stats["attempted"] % progress_every == 0:
                el = time.time() - t_start
                _log.warning("[combined-pass] %s done=%d rows=%d %.1fs/session sizes=%s",
                             D, stats["done"], stats["rows"],
                             el / max(1, stats["done"]), sizes)
        except Exception as e:                            # noqa: BLE001
            try:
                c.execute("ROLLBACK")
            except Exception:
                pass
            _checkpoint(c, D, "failed", detail=f"{type(e).__name__}: {e}")
            stats["failed"] += 1
    _meta(c, completed_at=time.strftime("%Y-%m-%dT%H:%M:%S"), stats=stats)
    c.commit()
    c.close()
    return stats


def _checkpoint(c, D, status, detail=None):
    c.execute("INSERT INTO pass_checkpoint(date,status,detail) VALUES(?,?,?) "
              "ON CONFLICT(date) DO UPDATE SET status=excluded.status,"
              "detail=excluded.detail", (D, status, detail))
    c.commit()


def main(argv=None) -> int:
    """CLI entrypoint so the pass can run as its OWN PROCESS.

    ⚰️ WHY A PROCESS AND NOT A THREAD, MEASURED. The first resilient version ran the
    pass in a daemon thread inside `api.worker_main`. It survived redeploys — and went
    from **13.7 s/session standalone to 180 s/session in-thread**, a 13x collapse that
    turns a ~35-hour job into 224 hours. The worker is busy (host load average 26) and
    the minute-file parse is pure Python, so it holds the GIL against everything else
    that pod is doing.

    ⭐ A subprocess keeps both properties: its own interpreter and its own GIL for full
    speed, spawned from the boot hook so a redeploy still resumes it.
    """
    import argparse
    ap = argparse.ArgumentParser(prog="breadth_combined_pass")
    ap.add_argument("--artifact", required=True)      # ⛔ required, never defaulted
    ap.add_argument("--to", default="2026-09-11")
    args = ap.parse_args(argv)
    logging.basicConfig(level=logging.INFO, stream=sys.stdout,
                        format="%(asctime)s %(message)s")
    legs = [(("uct", "us"), "2008-01-02", "2010-12-31"),
            (ALL_UNIVERSES, "2011-01-03", args.to)]
    t0 = time.time()
    for unis, frm, to in legs:
        print(f"LEG {frm}..{to} {unis}", flush=True)
        res = run(args.artifact, frm, to, universes=unis, progress_every=25)
        print(f"LEG DONE {frm}..{to}: {res}", flush=True)
    print("PASS COMPLETE in %.1f h" % ((time.time() - t0) / 3600), flush=True)
    return 0


if __name__ == "__main__":
    import sys as _s
    _s.exit(main())
