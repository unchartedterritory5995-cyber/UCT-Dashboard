"""THE CORRECTED-SPECIFICATION PASS (V2c2) — identity, membership, price basis, session
boundaries and EMA fixed; everything else is the validated V2c pipeline, unchanged.

What changed against `breadth_combined_pass.run` (V2c, frozen `ad8c157f…`), and why — each
is a finding of the 2026-09-23 final validation:

  TICKERS    one canonical spelling (`breadth_ticker.canon`) — dual-class names were cut
             off from levels, factor and close.
  VINTAGE    grouped inputs from ONE fetch window with a manifest (`BREADTH_GROUPED_DIR`).
  GUARD      `breadth_adjusted_guard`: a name whose frame straddles a non-REAL adjusted-basis
             boundary is withheld from level-dependent metrics (fail closed).
  F1         factors read from the same vintage as the levels (`gh.session_factors`); the
             inert grouped-vs-grouped coherence check is removed.
  SESSION    calendar window (`breadth_calendar`), identical for every universe.
  EMA        `breadth_live._ewm_last` = pandas adjust=False.
  RATIOS     `ratio_5day` / `ratio_10day`, from the artifact's own prior session closes.
  UCT        TWO populations that can never be confused:
               uct           CANONICAL: the collector's point-in-time `universe_list`, only
                             from the first live snapshot date (no fabricated history)
               uct_backtest  RESEARCH: today's pinned list, identity-safe
                             (`breadth_identity`), survivorship semantics disclosed; not in
                             the production universe registry, never published.
"""
from __future__ import annotations

import hashlib
import json
import os
import time

from api.services.breadth_combined_pass import (ArtifactRefused, BODY_SOURCE, PATH_SOURCE,
                                                 NOT_MEMBER_INDEPENDENT, _checkpoint, _meta,
                                                 completed, open_artifact)

METHODOLOGY = "rth-1m-composites-v2c2"
UNIVERSES = ("uct", "uct_backtest", "us", "nasdaq", "nyse")
PIT_UNIVERSES = ("us", "nasdaq", "nyse")
#: Research universes: stored in an artifact, NEVER in `breadth_universes.UNIVERSES` (which
#: feeds the catalogue and `BREADTH_LIBRARY_UNIVERSES=*`), so they cannot be published by a flag.
RESEARCH_UNIVERSES = {"uct_backtest": {"label": "Today's UCT List — Back-tested (research)",
                                       "floor": "2008-01-02"}}
FLOORS = {"uct_backtest": "2008-01-02", "us": "2008-01-02",
          "nasdaq": "2011-01-03", "nyse": "2011-01-03"}

_SESSION_EXTRA = """
CREATE TABLE IF NOT EXISTS pass_session_v2c2 (
    date TEXT PRIMARY KEY, universe_sizes TEXT, universe_buckets TEXT, withheld TEXT,
    dual_class_members TEXT, last_bar_min INTEGER, expected_buckets INTEGER, early_close INTEGER
);
"""


def _sha(path):
    with open(path, "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()


def _code_digests():
    here = os.path.dirname(os.path.abspath(__file__))
    out = {}
    for fn in sorted(os.listdir(here)):
        if fn.startswith("breadth_") and fn.endswith(".py"):
            with open(os.path.join(here, fn), "rb") as f:
                out[fn] = hashlib.md5(f.read().replace(b"\r\n", b"\n")).hexdigest()
    return out


def applies(metric: str, universe: str) -> bool:
    from api.services import breadth_metrics as bm
    if metric in NOT_MEMBER_INDEPENDENT:
        return False
    if universe in RESEARCH_UNIVERSES:
        return bm.is_portable(metric) and metric not in bm.PIT_UNPRODUCIBLE
    return bm.applies_to(metric, universe)


class Inputs:
    """Every external input, loaded once, fingerprinted into pass_meta."""

    def __init__(self, inputs_dir: str):
        from api.services import breadth_adjusted_guard as bag
        from api.services import breadth_grouped_history as gh
        from api.services import breadth_identity as bi
        from api.services import breadth_ticker as bt
        self.dir = inputs_dir
        self.paths = {k: os.path.join(inputs_dir, v) for k, v in {
            "vintage_manifest": "grouped_vintage_manifest.json",
            "splits": "splits_ledger.json",
            "pit_uct": "pit_uct_ledger.json",
            "identity": "uct_identity_table_v3.json"}.items()}
        for k, p in self.paths.items():
            if not os.path.exists(p):
                raise ArtifactRefused(f"missing input {k}: {p}")
        man = json.load(open(self.paths["vintage_manifest"]))
        if os.path.abspath(man["dir"]) != os.path.abspath(gh.grouped_dir()):
            raise ArtifactRefused("BREADTH_GROUPED_DIR is not the manifest's vintage directory")
        self.vintage_window = man["fetch_window"]
        self.pit = json.load(open(self.paths["pit_uct"]))
        self.pit_from = self.pit["live_from"]
        self.identity = bi.load(self.paths["identity"])
        self.pinned = [bt.canon(t) for t in self.identity.rows]
        self.guard, gt = bag.load_or_build(
            gh.grouped_dir(), self.paths["vintage_manifest"], self.paths["splits"],
            gh.session_calendar(), bt.canon, os.path.join(inputs_dir, "adjusted_guard_table.json"))
        self.guard_key = gt["input_key"]
        self.fingerprints = {k: _sha(p) for k, p in self.paths.items()}

    def pit_members(self, D: str):
        if D < self.pit_from:
            return None
        e = (self.pit.get("dates") or {}).get(D)
        return None if e is None else e["tickers"]


def resolve_universes(D, traded: set, inp: Inputs, ref_map: dict, universes) -> dict:
    from api.services import breadth_pit_frame as bpf
    from api.services import breadth_ticker as bt
    from api.services import breadth_universes as bu
    out = {}
    if "uct" in universes:
        pm = inp.pit_members(D)
        if pm is not None:
            out["uct"] = sorted({bt.canon(t) for t in pm} & traded)
    if "uct_backtest" in universes and D >= FLOORS["uct_backtest"]:
        out["uct_backtest"] = sorted(t for t in inp.pinned if t in traded and inp.identity.allowed(t, D))
    for u in PIT_UNIVERSES:
        if u in universes and D >= FLOORS[u]:
            out[u] = []
    for t in traded:
        rec = bpf.resolve(ref_map.get(t), D)
        if rec is None or rec.get("type") not in bpf.COMMON_TYPES:
            continue
        ex = (rec.get("primary_exchange") or "").upper()
        for u in PIT_UNIVERSES:
            if u in out and ex and ex in bu.venues(u):
                out[u].append(t)
    return out


def _prior_sums(c, u: str, D: str, cal: list) -> dict:
    """{N: (Σup, Σdn)} over the N-1 sessions before D, only if ALL of them are in the artifact."""
    import bisect
    i = bisect.bisect_left(cal, D)
    prev = cal[max(0, i - 9):i]
    rows = dict(((d, m), v) for d, m, v in c.execute(
        "SELECT date, metric, c FROM breadth_daily_ohlc WHERE universe=? AND date>=? AND date<? "
        "AND metric IN ('up_4pct_today','down_4pct_today')", (u, prev[0] if prev else D, D)))
    out = {}
    for n in (5, 10):
        w = prev[-(n - 1):] if len(prev) >= n - 1 else None
        if not w or any((d, "up_4pct_today") not in rows or (d, "down_4pct_today") not in rows for d in w):
            continue
        out[n] = (sum(rows[(d, "up_4pct_today")] for d in w), sum(rows[(d, "down_4pct_today")] for d in w))
    return out


def run(artifact: str, dates: list, universes: tuple = UNIVERSES, inputs_dir: str = None,
        progress_every: int = 1) -> dict:
    import logging
    from api.services import breadth_calendar as bcal
    from api.services import breadth_grouped_history as gh
    from api.services import breadth_live as bl
    from api.services import breadth_pit_frame as bpf
    from api.services import breadth_wick_recon as wr
    from api.services import build_intraday_cache as bic
    log = logging.getLogger("breadth_corrected_pass")
    gh.assert_frame_width()
    inp = Inputs(inputs_dir or os.environ["BREADTH_V2C2_INPUTS"])
    c = open_artifact(artifact)
    c.executescript(_SESSION_EXTRA)
    ref_map = bpf.reference_map()
    client = wr._s3_client()
    if client is None:
        raise ArtifactRefused("no S3 client")
    cal = gh.session_calendar()
    leg = sum(1 for _ in c.execute("SELECT key FROM pass_meta WHERE key LIKE 'leg%_started_at'"))
    _meta(c, methodology=METHODOLOGY, provider="massive-s3-flatfiles", resolution="1m",
          session="RTH calendar window (breadth_calendar)",
          levels_source="grouped_adjusted_daily (one vintage)",
          close_source="provider grouped-adjusted daily close (canonical daily close)",
          path_rule=wr.PATH_RULE_VERSION, path_rule_params=json.dumps(wr.PATH_RULE),
          body_source=BODY_SOURCE, path_source=PATH_SOURCE,
          ticker_seam="breadth_ticker.canon (provider spelling; '-'→'.')",
          ema="pandas ewm(alpha=2/21, adjust=False, ignore_na=False)",
          guard_version=inp.guard.version, guard_input_key=inp.guard_key,
          identity_rule=inp.identity.rule, pit_uct_live_from=inp.pit_from,
          grouped_dir=gh.grouped_dir(), grouped_vintage_window=json.dumps(inp.vintage_window),
          grouped_calendar=json.dumps(gh.cache_identity()),
          input_fingerprints=json.dumps(inp.fingerprints),
          code_md5_lf=json.dumps(_code_digests()),
          code_commit=os.environ.get("BREADTH_CODE_COMMIT", "unrecorded"),
          research_universes=json.dumps(RESEARCH_UNIVERSES))
    _meta(c, **{f"leg{leg}_started_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
                f"leg{leg}_universes": ",".join(universes),
                f"leg{leg}_dates": "%d sessions %s..%s" % (len(dates), min(dates), max(dates))})
    c.commit()
    done = completed(c)
    stats = {"attempted": 0, "done": 0, "missing_source": 0, "failed": 0, "rows": 0,
             "skipped_existing": 0}
    t0 = time.time()
    for D in sorted(dates):
        if D in done:
            stats["skipped_existing"] += 1
            continue
        stats["attempted"] += 1
        try:
            if not bcal.is_trading_day(D):
                _checkpoint(c, D, "missing_source", detail="calendar: not a trading day")
                stats["missing_source"] += 1
                continue
            key = wr._S3_KEY.format(y=D[:4], m=D[5:7], d=D)
            per_all = ((bic.download_and_resample(client, key, [1], None) or {}).get(1)) or {}
            if not per_all:
                _checkpoint(c, D, "failed", detail="TRADING DAY WITHOUT a minute flat file")
                stats["failed"] += 1
                continue
            unis = resolve_universes(D, set(per_all), inp, ref_map, universes)
            union = sorted({t for v in unis.values() for t in v})
            frame = gh.frame_dates(D)
            withhold = frozenset(inp.guard.withheld_set(union, frame[0], D)) if frame else frozenset()
            levels = gh.levels_for_day(union, D, withhold=withhold)
            if levels is None:
                _checkpoint(c, D, "missing_source", detail="no levels (grouped history shorter than the frame)")
                stats["missing_source"] += 1
                continue
            factors = {t: f for t, f in gh.session_factors(D, union).items() if t not in withhold}
            if not factors:
                _checkpoint(c, D, "failed", detail="no corporate-action factors for a trading day")
                stats["failed"] += 1
                continue
            eod_px = gh.official_closes(D, union)
            rows, body, sizes, buckets, wh, dual = [], [], {}, {}, {}, {}
            sess = None
            for u in universes:
                names = unis.get(u)
                if not names:
                    continue
                sizes[u] = len(names)
                wh[u] = len(withhold & set(names))
                dual[u] = sum(1 for t in names if "." in t)
                sub = {t: per_all[t] for t in names if t in per_all}
                out = wr.session_ohlc(D, sub, levels, 1, members=set(names), basis=factors,
                                      eod_prices=eod_px, path_rule=wr.PATH_RULE,
                                      calendar_window=True, rolling_prior=_prior_sums(c, u, D, cal))
                if not out:
                    continue
                s = out.get("_session") or {}
                sess = sess or s
                buckets[u] = s.get("buckets")
                for metric, r in out.items():
                    if metric.startswith("_") or not applies(metric, u):
                        continue
                    if r.get("source") == "intraday_recon":
                        rows.append((u, D, metric, r["o"], r["h"], r["l"], r["c"], PATH_SOURCE))
                    elif r.get("flagged") and r.get("c") is not None:
                        cc = r["c"]
                        body.append((u, D, metric, cc, cc, cc, cc, BODY_SOURCE))
            if not rows and not body:
                _checkpoint(c, D, "failed", detail="no universe produced rows")
                stats["failed"] += 1
                continue
            allr = rows + body
            c.execute("BEGIN IMMEDIATE")
            c.executemany("INSERT INTO breadth_daily_ohlc(universe,date,metric,o,h,l,c,source,updated_at) "
                          "VALUES(?,?,?,?,?,?,?,?,datetime('now')) ON CONFLICT(universe,date,metric) DO UPDATE SET "
                          "o=excluded.o,h=excluded.h,l=excluded.l,c=excluded.c,source=excluded.source,"
                          "updated_at=excluded.updated_at", allr)
            c.execute("INSERT OR REPLACE INTO pass_session(date,universe_sizes,close_basis,buckets,early_close,calendar) "
                      "VALUES(?,?,?,?,?,?)", (D, json.dumps(sizes), "canonical grouped-adjusted daily close",
                                               (sess or {}).get("buckets"), 1 if (sess or {}).get("early_close") else 0,
                                               "breadth_calendar"))
            c.execute("INSERT OR REPLACE INTO pass_session_v2c2 VALUES(?,?,?,?,?,?,?,?)",
                      (D, json.dumps(sizes), json.dumps(buckets), json.dumps(wh), json.dumps(dual),
                       (sess or {}).get("last_bar_min"), (sess or {}).get("expected_buckets"),
                       1 if (sess or {}).get("early_close") else 0))
            c.execute("INSERT INTO pass_checkpoint(date,status,universes,rows,detail) VALUES(?,?,?,?,?) "
                      "ON CONFLICT(date) DO UPDATE SET status=excluded.status,rows=excluded.rows,"
                      "universes=excluded.universes", (D, "done", json.dumps(sizes), len(allr), None))
            c.execute("COMMIT")
            stats["done"] += 1
            stats["rows"] += len(allr)
            if progress_every and stats["attempted"] % progress_every == 0:
                log.warning("[v2c2] %s done=%d rows=%d %.1fs/session sizes=%s withheld=%s",
                            D, stats["done"], stats["rows"], (time.time() - t0) / max(1, stats["done"]), sizes, wh)
        except Exception as e:                                   # noqa: BLE001
            try:
                c.execute("ROLLBACK")
            except Exception:
                pass
            _checkpoint(c, D, "failed", detail=f"{type(e).__name__}: {e}")
            stats["failed"] += 1
    _meta(c, **{f"leg{leg}_stats": json.dumps(stats), f"leg{leg}_finished_at": time.strftime("%Y-%m-%dT%H:%M:%S")})
    c.commit()
    c.close()
    return stats
