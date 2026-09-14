"""D20 "looks like what TSDR buys" — a daily list scored silently against his STATED calls only.

Scoring is Wisdom-internal and runs every session (flag or no flag) so the owner's two-week
silent window can accumulate; delivery is gated in code (adapters/d20_gates.py) and refused
in W1 for want of an S7 channel.

THE MODEL (version MODEL_VERSION) — deliberately simple and fully explainable:
- Reference set: TSDR's stated, non-hindsight, long CALLs (watching/taking/in_it/added) in the
  last CALL_WINDOW_DAYS, each turned into a bar-derived feature vector AS OF the session he
  stated it (bars read only up to that session: no look-ahead). Stated calls only (W1 §10.4):
  no fills, no journal, nothing a broker knows.
- Candidates for the session: the S-E CALL-REPLAY provider when that stream is integrated
  (`api.services.wisdom.evals.replay.candidates_for_session`, resolved by name at run time),
  plus the desk's own ranked output — catalysts for the session and the current leadership
  list — through their existing read APIs.
- Score = 1 / (1 + mean z-score distance to the K nearest reference calls). A session with
  fewer than MIN_REFERENCE_CALLS usable references scores nothing and says why.
- Silent evaluation: `reconcile` marks a scored name matched when TSDR states a CALL on it
  within MATCH_CALENDAR_DAYS after the session; `silent_precision` reports k/n (0/0 as 0/0).
"""
from __future__ import annotations

import importlib
import importlib.util
import logging
import math
from datetime import date, datetime, time, timedelta
from typing import Optional

from api.services.wisdom.core import flags

log = logging.getLogger(__name__)

SCORER = "lookalike"
FLAG_ENV = "WISDOM_LOOKALIKE_ENABLED"
MODEL_VERSION = "lookalike-knn-w1.0"
OWNER_AUTHOR = "tsdr"
FEATURES = ("ret_20", "ret_60", "dist_high_60", "adr_20", "vol_ratio", "above_ma50")
BARS_NEEDED = 61
K = 5
MIN_REFERENCE_CALLS = 10
CALL_WINDOW_DAYS = 365
MATCH_CALENDAR_DAYS = 14
TOP_N = 25
REPLAY_SEAM = "api.services.wisdom.evals.replay"


def _daily_bars(ticker: str, to_ymd: int, n: int) -> list:
    from api.services import bars_sqlite

    return bars_sqlite.get_bars_before(ticker, "D", n, to_ymd)


def _ymd(d: date) -> int:
    return int(d.strftime("%Y%m%d"))


def features(bars: list) -> Optional[dict]:
    """Bar tuples (ts, o, h, l, c, v), oldest first. None when the history cannot support a vector."""
    if len(bars) < BARS_NEEDED:
        return None
    closes = [float(b[4]) for b in bars]
    highs = [float(b[2]) for b in bars]
    lows = [float(b[3]) for b in bars]
    vols = [float(b[5] or 0) for b in bars]
    last = closes[-1]
    if last <= 0 or closes[-21] <= 0 or closes[-61] <= 0:
        return None
    vol_50 = sum(vols[-50:]) / 50
    high_60 = max(highs[-60:])
    if vol_50 <= 0 or high_60 <= 0:
        return None
    return {
        "ret_20": last / closes[-21] - 1, "ret_60": last / closes[-61] - 1,
        "dist_high_60": last / high_60 - 1,
        "adr_20": sum((h - lo) / c for h, lo, c in zip(highs[-20:], lows[-20:], closes[-20:]) if c > 0) / 20,
        "vol_ratio": (sum(vols[-5:]) / 5) / vol_50,
        "above_ma50": last / (sum(closes[-50:]) / 50) - 1,
    }


def _session(ctx) -> date:
    from api.services.wisdom.core import timeutil

    return timeutil.session_for(getattr(ctx, "now_et", None) or timeutil.now_et())


def candidate_tickers(session: date) -> list[tuple[str, str]]:
    from api.services.wisdom.core import timeutil
    from api.services.wisdom.publish.adapters import common

    found: list[tuple[str, str]] = []
    if importlib.util.find_spec(REPLAY_SEAM) is not None:  # cross-stream seam (S-E); named fallback below
        try:
            provider = getattr(importlib.import_module(REPLAY_SEAM), "candidates_for_session", None)
            if callable(provider):
                found += [(t, "evals.replay") for t in (provider(session.isoformat()) or [])]
        except Exception:
            log.exception("[wisdom] S-E replay candidate provider failed")
    try:
        from api.services.catalyst import store as catalyst_store

        found += [(r.get("ticker"), "catalysts") for r in (catalyst_store.get_for_date(session.isoformat()) or [])]
    except Exception:
        log.exception("[wisdom] catalyst candidates unavailable")
    if session == timeutil.session_for(timeutil.now_et()):
        try:
            from api.services.engine import get_leadership

            found += [((r.get("ticker") or r.get("sym")) if isinstance(r, dict) else None, "leadership")
                      for r in (get_leadership() or [])]
        except Exception:
            log.exception("[wisdom] leadership candidates unavailable")
    out, seen = [], set()
    for ticker, provider in found:
        t = common.normalize_ticker(ticker)
        if t and t not in seen:
            seen.add(t)
            out.append((t, provider))
    return out


def reference_vectors(conn, session: date) -> list[tuple[str, dict]]:
    from api.services.wisdom.core import timeutil
    from api.services.wisdom.publish.adapters import common

    since = timeutil.iso_et(timeutil.to_et(datetime.combine(session - timedelta(days=CALL_WINDOW_DAYS), time(0, 0))))
    calls = common.select_records(
        conn, types=("CALL",), authors=(OWNER_AUTHOR,), since_iso=since, order="r.stated_at_et ASC",
        extra_where="r.hindsight = 0 AND r.direction = 'long' AND r.ticker IS NOT NULL "
                    "AND r.stance IN ('watching', 'taking', 'in_it', 'added')")
    refs = []
    for c in calls:
        stated = timeutil.parse_iso(c["stated_at_et"])
        if stated is None:
            continue
        as_of = timeutil.session_for(stated)
        if as_of > session:
            continue
        try:
            f = features(_daily_bars(common.normalize_ticker(c["ticker"]), _ymd(as_of), BARS_NEEDED))
        except Exception:
            f = None
        if f:
            refs.append((c["record_id"], f))
    return refs


def score(candidate: dict, refs: list[tuple[str, dict]]) -> tuple[float, list[str]]:
    means = {k: sum(f[k] for _, f in refs) / len(refs) for k in FEATURES}
    sds = {}
    for k in FEATURES:
        var = sum((f[k] - means[k]) ** 2 for _, f in refs) / len(refs)
        sds[k] = math.sqrt(var) or 1.0

    def z(f):
        return [(f[k] - means[k]) / sds[k] for k in FEATURES]

    zc = z(candidate)
    dists = sorted((math.dist(zc, z(f)), rid) for rid, f in refs)[:K]
    return 1.0 / (1.0 + sum(d for d, _ in dists) / len(dists)), [rid for _, rid in dists]


def score_silently(ctx) -> dict:
    from api.services.wisdom.core import store
    from api.services.wisdom.publish.adapters import common

    session = _session(ctx)
    with store.read() as conn:
        if not common.table_exists(conn, "wisdom_lookalike_scores"):
            return {"skipped": "publish_adapters_001 is not applied"}
        refs = reference_vectors(conn, session)
    out = {"session": session.isoformat(), "reference_calls": len(refs), "delivered": 0}
    scored: list = []
    candidates: list = []
    if len(refs) >= MIN_REFERENCE_CALLS:
        candidates = candidate_tickers(session)
        for ticker, provider in candidates:
            try:
                bars = _daily_bars(ticker, _ymd(session), BARS_NEEDED)
            except Exception:
                continue
            f = features(bars)
            if not f or int(bars[-1][0]) != _ymd(session):
                continue
            s, nearest = score(f, refs)
            scored.append((ticker, provider, s, f, nearest))
        scored.sort(key=lambda x: (-x[2], x[0]))
        scored = scored[:TOP_N]
        note = f"candidates={len(candidates)}"
    else:
        note = f"insufficient reference calls: {len(refs)} < {MIN_REFERENCE_CALLS}"
    out.update(candidates=len(candidates), scored=len(scored), note=note)
    if getattr(ctx, "dry_run", False):
        return {**out, "dry_run": True}
    at = common.now_iso()
    with store.write() as conn:
        for rank, (ticker, provider, s, f, nearest) in enumerate(scored, start=1):
            conn.execute(
                "INSERT INTO wisdom_lookalike_scores(session_date, ticker, model_version, score, rank, provider, "
                "features_json, nearest_record_ids_json, scored_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) "
                "ON CONFLICT(session_date, ticker, model_version) DO UPDATE SET score = excluded.score, "
                "rank = excluded.rank, provider = excluded.provider, features_json = excluded.features_json, "
                "nearest_record_ids_json = excluded.nearest_record_ids_json, scored_at = excluded.scored_at",
                (session.isoformat(), ticker, MODEL_VERSION, s, rank, provider, common.dumps(f),
                 common.dumps(nearest), at))
        conn.execute(
            "INSERT INTO wisdom_d20_scoring_runs(scorer, session_date, scored_at, n_scored, n_written, note) "
            "VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(scorer, session_date) DO UPDATE SET scored_at = excluded.scored_at, "
            "n_scored = excluded.n_scored, n_written = excluded.n_written, note = excluded.note",
            (SCORER, session.isoformat(), at, len(scored), len(scored), note))
        out["matched_new"] = reconcile(conn)
    return out


def reconcile(conn) -> int:
    """Mark scored names TSDR went on to state a CALL on within MATCH_CALENDAR_DAYS. Returns new matches."""
    from api.services.wisdom.core import timeutil
    from api.services.wisdom.publish.adapters import common

    pending = conn.execute("SELECT session_date, ticker FROM wisdom_lookalike_scores WHERE matched_record_id IS NULL "
                           "AND model_version = ?", (MODEL_VERSION,)).fetchall()
    matched = 0
    for row in pending:
        start = date.fromisoformat(row["session_date"])
        lo = timeutil.iso_et(timeutil.to_et(datetime.combine(start + timedelta(days=1), time(0, 0))))
        hi = timeutil.iso_et(timeutil.to_et(datetime.combine(start + timedelta(days=MATCH_CALENDAR_DAYS + 1), time(0, 0))))
        hit = common.select_records(conn, types=("CALL",), authors=(OWNER_AUTHOR,), ticker=row["ticker"], since_iso=lo,
                                    extra_where="r.stated_at_et < ? AND r.hindsight = 0", extra_params=(hi,),
                                    order="r.stated_at_et ASC", limit=1)
        if hit:
            conn.execute("UPDATE wisdom_lookalike_scores SET matched_record_id = ?, matched_session = ? "
                         "WHERE session_date = ? AND ticker = ? AND model_version = ?",
                         (hit[0]["record_id"], common.record_date(hit[0]), row["session_date"], row["ticker"],
                          MODEL_VERSION))
            matched += 1
    return matched


def silent_precision(conn, *, today: date) -> dict:
    """k/n over scored rows whose match window has closed. 0/0 is reported as 0/0, never a rate."""
    cutoff = (today - timedelta(days=MATCH_CALENDAR_DAYS)).isoformat()
    row = conn.execute("SELECT COUNT(*), SUM(CASE WHEN matched_record_id IS NOT NULL THEN 1 ELSE 0 END) "
                       "FROM wisdom_lookalike_scores WHERE model_version = ? AND session_date <= ?",
                       (MODEL_VERSION, cutoff)).fetchone()
    n, k = int(row[0] or 0), int(row[1] or 0)
    return {"k": k, "n": n, "rate": (k / n) if n else None, "window_closed_before": cutoff}


def delivery_status(today: date) -> dict:
    """Read-only gate report for the admin page (never delivers)."""
    from api.services.wisdom.core import store
    from api.services.wisdom.publish.adapters import d20_gates

    with store.read(for_request=True) as conn:
        gate = d20_gates.delivery_gate(conn, SCORER, flag_env=FLAG_ENV, flag_on=flags.lookalike_enabled(), today=today)
        return {**gate, "silent_precision": silent_precision(conn, today=today)}


def deliver(ctx=None, *, today: Optional[date] = None) -> dict:
    from api.services.wisdom.core import store
    from api.services.wisdom.publish.adapters import d20_gates

    today = today or _session(ctx)
    with store.read() as conn:
        pending = conn.execute("SELECT COUNT(*) FROM wisdom_lookalike_scores WHERE delivered = 0").fetchone()[0]
        return d20_gates.refuse_delivery(conn, SCORER, flag_env=FLAG_ENV, flag_on=flags.lookalike_enabled(),
                                         today=today, pending=pending)
