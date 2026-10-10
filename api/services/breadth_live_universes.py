"""Live breadth for the point-in-time library universes — US, NYSE and Nasdaq.

`breadth_live` makes the UCT universe live: a per-minute full-market snapshot compared
against prior-close levels, anchored to the stored daily row. The US / NYSE / Nasdaq
library rows had no such path — they are produced by the canonical V2 / Exchange
producers, which can only finalise session D on the evening of D+1 (the minute flat file
lands overnight and the PIT hindsight gate needs D+1's collector row). So at noon a member
saw a chart ending TWO sessions ago, and no developing bar at all.

⭐ THIS MODULE FILLS EXACTLY THAT GAP, AND NOTHING ELSE:

    canonical history (untouched) │ provisional completed sessions │ today, live
    ──────────────────────────────┼────────────────────────────────┼───────────────
    V2 / Exchange authority        │ bars.db closes, this method     │ snapshot, this method

Every number it publishes is ANCHORED to the newest canonical session S, exactly as the UCT
live row is anchored to the collector's row:

    value(X) = canonical(S) + [ method(X) − method(S) ]

so a provisional value is a continuation of the canonical series, not a second opinion
about it, and it is REPLACED by the canonical value as soon as that lands (the serve paths
only append dates after the last canonical bar).

⭐ MEMBERSHIP. For a live or just-completed session the provider's CURRENT listing data is
point-in-time by definition, so the canonical rule applies directly: common stock + ADRs
(`breadth_pit_frame.COMMON_TYPES`) whose primary exchange is in the universe's venue set
(`breadth_universes.venues`). The historical PIT problem that forced the canonical design
does not exist for today.

⛔ NOTHING HERE WRITES A CANONICAL STORE. `breadth_daily_ohlc` for us/nyse/nasdaq is answered
by the authorities; this module keeps its rows in memory (recomputable from bars.db + the
snapshot after any restart) and the serve paths append them at read time.

⛔ A UNIVERSE WHOSE ANCHOR SESSION DOES NOT RECONCILE IS WITHHELD. If this method's
population at S differs from the canonical count by more than `MAX_POPULATION_DRIFT`, the
numbers would carry a headcount difference rather than a price-basis offset, so that
universe publishes nothing (`degraded`), never a wrong value.

Kill switch: `BREADTH_LIVE_UNIVERSES=0` withholds every appended row (default ON since 2026-10-08,
after the production reconcile). `breadth_live.enabled()` (BREADTH_LIVE_ENABLED) also gates it.
"""
from __future__ import annotations

import logging
import json
import math
import os
import threading
import time
from datetime import date, timedelta
from typing import Optional

import numpy as np

_log = logging.getLogger("breadth_live_universes")

UNIVERSES = ("us", "nyse", "nasdaq")

#: How long a computed payload is served before the next read kicks a refresh.
REFRESH_SECONDS = 55
#: Off-session the payload only changes when a canonical session lands (~20:15Z) or the
#: day rolls, so a slower cadence is enough.
IDLE_REFRESH_SECONDS = 600
#: A snapshot `breadth_live` fetched this recently is reused rather than fetched twice.
SNAPSHOT_MAX_AGE = 90
#: |method count / canonical count − 1| at the anchor session above which a universe is withheld.
MAX_POPULATION_DRIFT = 0.05
#: Canonical sessions read for the anchor and the rolling 5/10-day ratios.
_CANON_LOOKBACK = 15

#: Metrics anchored straight from the method (each to its own canonical value).
_DERIVED_AFTER_ANCHOR = ("adv_decline", "net_new_high_low", "ratio_5day", "ratio_10day")
#: Present in the method's raw output but never a published library metric here.
_NEVER_PUBLISH = ("mcclellan_osc", "new_ath", "_measured", "_zero_prev_close",
                  "up_from_open", "down_from_open")


def serving() -> bool:
    """Will the chart paths append live/provisional bars for these universes?"""
    from api.services import breadth_live as bl
    # ⭐ ON by default since 2026-10-08 (production reconcile over 8 sessions: % above MAs within
    # 0.9 pt worst case, counts within a few names). `BREADTH_LIVE_UNIVERSES=0` withholds it.
    return os.environ.get("BREADTH_LIVE_UNIVERSES", "1").strip() != "0" and bl.enabled()


# ── membership ───────────────────────────────────────────────────────────────

_members_cache: dict = {}


#: Active listings only: a live / just-completed session needs today's listings, and the
#: active enumeration is ~13 pages where the full active+delisted map is up to 600.
_ACTIVE_REF_TTL = 20 * 3600


def _active_reference() -> dict:
    """`{SYMBOL: [record]}` of ACTIVE listings (type, primary_exchange), cached on the volume."""
    import json
    path = os.path.join(os.environ.get("DATA_DIR", "/data"), "breadth_live_active_reference.json")
    try:
        if time.time() - os.stat(path).st_mtime < _ACTIVE_REF_TTL:
            with open(path) as fh:
                return json.load(fh)
    except Exception:
        pass
    from api.services import massive
    out: dict = {}
    for r in massive.list_reference_tickers(active=True, max_pages=60) or []:
        sym = str(r.get("ticker") or "").upper()
        if sym:
            out.setdefault(sym, []).append({"type": r.get("type"),
                                            "primary_exchange": (r.get("primary_exchange") or "").upper()})
    if len(out) > 1000:
        try:
            tmp = path + ".tmp"
            with open(tmp, "w") as fh:
                json.dump(out, fh, separators=(",", ":"))
            os.replace(tmp, path)
        except Exception:
            pass
    return out


def members(on_iso: str, ref_map: Optional[dict] = None) -> dict:
    """`{universe: [ticker, …]}` for a session, from the provider's listing data."""
    hit = _members_cache.get("key")
    if ref_map is None and hit == on_iso:
        return _members_cache["value"]
    from api.services import breadth_pit_frame as pf
    from api.services import breadth_universes as bu
    ref = ref_map if ref_map is not None else _active_reference()
    venues = {u: bu.venues(u) for u in UNIVERSES}
    out: dict = {u: [] for u in UNIVERSES}
    for sym, recs in (ref or {}).items():
        rec = pf.resolve(recs, on_iso)
        if not rec or rec.get("type") not in pf.COMMON_TYPES:
            continue
        ex = (rec.get("primary_exchange") or "").upper()
        for u in UNIVERSES:
            if ex in venues[u]:
                out[u].append(str(sym).upper())
    out = {u: sorted(v) for u, v in out.items()}
    if ref_map is None:
        _members_cache.update(key=on_iso, value=out)
    return out


def official_members(session: Optional[str] = None) -> Optional[dict]:
    """`{"session", "us", "nyse", "nasdaq"}` — the exchange authority's OWN member lists for its
    newest published live session (or `session`), read from the installed replica's `membership`
    table. None when the authority is not installed / has no membership rows."""
    try:
        from api.services import breadth_exchange_authority as ea
        v = ea._view()
        if not v:
            return None
        c = ea._ro(v["paths"]["live"])
        try:
            d = session or (c.execute("SELECT MAX(date) FROM membership").fetchone() or [None])[0]
            if not d:
                return None
            rows = c.execute("SELECT ticker, status FROM membership WHERE date=?", (d,)).fetchall()
        finally:
            c.close()
    except Exception as e:
        _log.warning("[breadth_live_universes] official membership unreadable: %s", e)
        return None
    canon = lambda t: str(t or "").upper().replace("-", ".")
    return {"session": d, "us": sorted({canon(t) for t, _ in rows}),
            "nyse": sorted({canon(t) for t, st in rows if st == "NYSE"}),
            "nasdaq": sorted({canon(t) for t, st in rows if st == "NASDAQ"})}


def membership_diff(sample: int = 40) -> dict:
    """READ-ONLY: the live engine's members vs the authority's for the authority's newest session —
    sizes, and the tickers only one side has, each with what the provider reference says of it."""
    off = official_members()
    if not off:
        return {"ok": False, "reason": "no official membership available"}
    from api.services import breadth_pit_frame as pf
    d = off["session"]
    ref = _active_reference() or {}
    live = members(d)
    canon = lambda t: str(t or "").upper().replace("-", ".")
    out = {"ok": True, "session": d, "universes": {}}
    for u in UNIVERSES:
        L = {canon(t) for t in live.get(u) or []}
        O = set(off.get(u) or [])
        def why(t):
            rec = pf.resolve(ref.get(t) or ref.get(t.replace(".", "-")), d) or {}
            return "%s %s/%s" % (t, rec.get("type"), rec.get("primary_exchange"))
        only_l, only_o = sorted(L - O), sorted(O - L)
        out["universes"][u] = {"live": len(L), "official": len(O), "both": len(L & O),
                               "only_live": len(only_l), "only_official": len(only_o),
                               "only_live_sample": [why(t) for t in only_l[:sample]],
                               "only_official_sample": [why(t) for t in only_o[:sample]]}
    return out


# ── the method ───────────────────────────────────────────────────────────────

def _subset_levels(lv: dict, ix: np.ndarray, tickers: list) -> dict:
    """`build_levels` output restricted to the rows `ix` (one universe of the union frame)."""
    n = len(lv["tickers"])

    def cut(v):
        if isinstance(v, np.ndarray) and v.ndim == 1 and len(v) == n:
            return v[ix]
        return v

    out = {}
    for k, v in lv.items():
        if k == "tickers":
            out[k] = list(tickers)
        elif isinstance(v, dict):
            out[k] = {kk: cut(vv) for kk, vv in v.items()}
        else:
            out[k] = cut(v)
    # The McClellan state in `build_levels` is an aggregate over the WHOLE frame; the
    # universes' McClellan comes from the canonical series (market_indicators), not here.
    out["mcc_ema19"] = out["mcc_ema39"] = None
    return out


def method_row(levels: dict, prices: dict, vols: Optional[dict] = None,
               opens: Optional[dict] = None) -> dict:
    """One universe, one instant: `breadth_live.compute_metrics` + the library's derived fields."""
    from api.services import breadth_live as bl
    m = bl.compute_metrics(levels, prices, vols, opens=opens)
    tickers = levels["tickers"]
    prev = levels["prev_close"]
    px = np.array([prices.get(t) or np.nan for t in tickers], dtype=float)
    with np.errstate(invalid="ignore"):
        ok = ~np.isnan(px) & ~np.isnan(prev) & (prev > 0) & (px > 0)
        m["unchanged"] = int((ok & (px == prev)).sum())
    uni = m.get("universe_count")
    for src, dst in (("new_52w_highs", "hi_ratio"), ("new_52w_lows", "lo_ratio")):
        n = m.get(src)
        m[dst] = round(n / uni * 100, 2) if n is not None and uni else None
    if m.get("new_52w_highs") is not None and m.get("new_52w_lows") is not None:
        m["net_new_high_low"] = m["new_52w_highs"] - m["new_52w_lows"]
    for k in _NEVER_PUBLISH:
        m.pop(k, None)
    return m


def _round(key: str, v: float):
    if key.startswith("pct_above_") or key in ("hi_ratio", "lo_ratio"):
        return round(v, 2 if key.endswith("_ratio") else 1)
    if key in ("up_vol_ratio", "ratio_5day", "ratio_10day"):
        return round(v, 2)
    return int(round(v))


def anchor(raw: dict, raw_s: dict, canon_s: dict) -> dict:
    """`canonical(S) + [raw − raw(S)]` per metric the canonical session carries."""
    out = {}
    for k, v in raw.items():
        if v is None or k in _DERIVED_AFTER_ANCHOR:
            continue
        rs, cs = raw_s.get(k), canon_s.get(k)
        if rs is None or cs is None:
            continue
        try:
            out[k] = _round(k, float(cs) + float(v) - float(rs))
        except (TypeError, ValueError):
            continue
    return out


def finish_row(row: dict, window: list) -> dict:
    """Fields defined over the anchored counts: A−D, net highs−lows, 5/10-day up/down ratios.
    `window` = the preceding sessions' rows (canonical or provisional), oldest first."""
    if row.get("advancing") is not None and row.get("declining") is not None:
        row["adv_decline"] = row["advancing"] - row["declining"]
    if row.get("new_52w_highs") is not None and row.get("new_52w_lows") is not None:
        row["net_new_high_low"] = row["new_52w_highs"] - row["new_52w_lows"]
    for key, n in (("ratio_5day", 5), ("ratio_10day", 10)):
        seq = (window[-(n - 1):] if n > 1 else []) + [row]
        ups = [r.get("up_4pct_today") for r in seq if r.get("up_4pct_today") is not None]
        dns = [r.get("down_4pct_today") for r in seq if r.get("down_4pct_today") is not None]
        row[key] = round(sum(ups) / sum(dns), 2) if ups and dns and sum(dns) else None
    return row


# ── canonical reads ──────────────────────────────────────────────────────────

def canonical(universe: str, metrics) -> dict:
    """`{date: {metric: value}}` for the newest canonical sessions of one universe."""
    from api.services import breadth_daily_ohlc as store
    out: dict = {}
    for k in metrics:
        try:
            h = store.history(k, limit=_CANON_LOOKBACK, universe=universe) or {}
        except Exception:
            h = {}
        for d, r in h.items():
            v = (r or {}).get("c")
            if v is not None:
                out.setdefault(d, {})[k] = v
    return out


def _published_metrics(universe: str) -> list:
    from api.services import breadth_metrics as bm
    keys = [k for k in bm.metrics_for(universe) if bm.is_published_metric(k, universe)]
    for extra in ("advancing", "declining", "adv_decline", "new_52w_highs", "new_52w_lows",
                  "universe_count", "up_4pct_today", "down_4pct_today", "unchanged"):
        if extra not in keys and bm.applies_to(extra, universe):
            keys.append(extra)
    # ⭐ (2026-10-09) `unchanged` is not a library metric of any universe (`applies_to` is False),
    # but the exchange universes' canonical store carries it and NYSE:UNCH / NASDAQ:UNCH are built
    # from it. Without it here the provisional sessions and today's row never carried it, and both
    # series sat at the last canonical session all day. A universe whose canonical lacks it simply
    # anchors nothing for it.
    if "unchanged" not in keys:
        keys.append("unchanged")
    return keys


# ── state + payload ──────────────────────────────────────────────────────────

_lock = threading.Lock()
_state: dict = {}        # the per-L heavy state (frame, levels, provisional rows)
_payload: dict = {}      # the served payload
_refreshing = threading.Event()


def _iso(ts: int) -> str:
    from api.services import breadth_live as bl
    return bl._iso(ts)


def _load_frame_by_key(conn, tickers: list, dates: list):
    """`breadth_live._load_frame`'s output, read ONE TICKER AT A TIME.

    ⛔ `ohlcv`'s primary key is (ticker, tf, ts). `ticker IN (…800 names…) AND ts BETWEEN` let the
    planner drive from the 26 GB table — measured on production 2026-10-08: the ~6,000-name frame
    was still loading after minutes (the same trap `breadth-v2-durable-runner` measured at 59-60 s
    per IN-list query). A per-key range probe uses the index prefix exactly; it is the only
    formulation that does (see that note), so it is used here.
    """
    pos = {ts: i for i, ts in enumerate(dates)}
    n, m = len(tickers), len(dates)
    closes = np.full((n, m), np.nan, dtype=np.float64)
    volumes = np.full((n, m), np.nan, dtype=np.float64)
    lo, hi = dates[0], dates[-1]
    q = "SELECT ts, c, v FROM ohlcv WHERE ticker=? AND tf='D' AND ts BETWEEN ? AND ?"
    for r, tk in enumerate(tickers):
        for ts, cl, vol in conn.execute(q, (tk, lo, hi)):
            j = pos.get(int(ts))
            if j is None:
                continue
            if cl is not None:
                closes[r, j] = cl
            if vol is not None:
                volumes[r, j] = vol
    return closes, volumes


def _load_frame_from_pack(tickers: list, L_iso: str):
    """`(dates_int, closes, volumes)` from the published Universe Bars Pack, or None.

    ⭐ THE PACK IS THE FRAME, ALREADY BUILT. The worker publishes it every evening
    (`barspack`, R2 `barspack/latest.json` + 40 gzip shards, `PACK_DEPTH` daily bars per
    ticker, sanitized exactly as charts serve them). Measured 2026-10-08: reading the same
    ~6,000-name frame from the web pod's 26 GB bars.db took 20+ minutes (cold, scattered
    rows); the pack is ~40 sequential downloads.

    ⛔⛔ STREAMED, ONE SHARD AT A TIME, STRAIGHT INTO NUMPY. The first version kept every
    wanted ticker's columnar JSON lists alive until the end (~5,700 x 300 bars x 6 Python lists)
    and the web pods that built it stalled near 3 GB RSS (10-08 incident, live breadth switched
    off at 17:37 CT). Now the calendar comes from SPY's own shard first, the arrays are
    preallocated, and each shard's parsed document is dropped before the next is fetched — peak
    extra memory is one shard, not the universe.

    ⛔ Used only when the pack CONTAINS the last completed session `L_iso` (a newer pack is cut
    at L); an older pack would silently measure yesterday's levels as today's, so the caller
    falls back to bars.db instead.
    """
    import gzip as _gz
    import json as _json
    from api.services import data_sync
    from api.services import barspack as _bp
    raw = data_sync.get_bytes("barspack/latest.json")
    if not raw:
        return None
    man = _json.loads(raw)
    shards = man.get("shards") or []
    if not shards:
        return None
    nshards = int(man.get("num_shards") or len(shards))

    def fetch(name):
        body = data_sync.get_bytes(name)
        return None if not body else _json.loads(_gz.decompress(body))

    by_idx = {int(sh.get("idx", i)): sh["name"] for i, sh in enumerate(shards)}
    spy_name = by_idx.get(_bp._shard_of("SPY", nshards))
    spy_doc = fetch(spy_name) if spy_name else None
    spy = (((spy_doc or {}).get("tickers") or {}).get("SPY") or {}).get("D")
    del spy_doc
    if not spy or not spy.get("t") or L_iso not in spy["t"]:
        return None
    # ⭐ A pack built after today's close already holds today; the frame ends at the last
    # COMPLETED session L, so the newer columns are simply not read (cut, never shifted).
    iso_dates = list(spy["t"][:spy["t"].index(L_iso) + 1])
    pos = {t: i for i, t in enumerate(iso_dates)}
    row = {t: r for r, t in enumerate(tickers)}
    n, m = len(tickers), len(iso_dates)
    closes = np.full((n, m), np.nan, dtype=np.float64)
    volumes = np.full((n, m), np.nan, dtype=np.float64)
    for sh in shards:
        doc = fetch(sh["name"])
        if doc is None:
            return None
        for sym, entry in (doc.get("tickers") or {}).items():
            r = row.get(sym)
            if r is None:
                continue
            d = entry.get("D")
            if not d:
                continue
            for t, c, v in zip(d["t"], d["c"], d["v"]):
                j = pos.get(t)
                if j is None:
                    continue
                if c is not None:
                    closes[r, j] = c
                if v is not None:
                    volumes[r, j] = v
        del doc
    dates = [int(t.replace("-", "")) for t in iso_dates]
    return dates, closes, volumes


def _rss_mb() -> Optional[float]:
    """Current resident memory of this process in MB (Linux), else None."""
    try:
        with open("/proc/self/statm") as fh:
            pages = int(fh.read().split()[1])
        return round(pages * os.sysconf("SC_PAGE_SIZE") / 1e6, 1)
    except Exception:
        return None


def _process_uptime() -> float:
    """Seconds since this process started (Linux), else a large number."""
    try:
        with open("/proc/self/stat") as fh:
            start_ticks = int(fh.read().rsplit(")", 1)[1].split()[19])
        with open("/proc/uptime") as fh:
            up = float(fh.read().split()[0])
        return up - start_ticks / os.sysconf("SC_CLK_TCK")
    except Exception:
        return 1e9


#: ⛔ No state build in a freshly started web process. Every 10-08 stall sat in the first 1-3
#: minutes of a pod's life, while the boot warms run; a ~100 s build there piles onto them.
BOOT_GRACE_SECONDS = int(os.environ.get("BREADTH_LIVE_UNIVERSES_BOOT_GRACE", "600"))


#: How long the dividend-basis read may take before the frame is used unadjusted.
DIVIDEND_BUDGET_SECONDS = 60


def _dividend_basis_with_budget(tickers, dates, closes, today_ts):
    """`(closes, state)` — dividend-adjusted when the store answers in time, else unadjusted.

    ⛔ Measured on production 2026-10-08: the dividend range read sat for 11+ minutes on a cold
    volume (one SELECT, nothing else touching the store). The live method must not hang on it.
    Unadjusted is SAFE here: every value is ANCHORED to the canonical series at S, and the basis
    offset only moves on ex-dividend dates, so it cancels in `method(X) − method(S)` — and S and
    X always share one basis because both come from this one frame.
    """
    import concurrent.futures as cf
    from api.services import breadth_live as bl
    if not bl.dividend_basis_enabled():
        return closes, "off"
    ex = cf.ThreadPoolExecutor(max_workers=1, thread_name_prefix="blu-div")
    fut = ex.submit(bl._apply_dividend_basis, tickers, dates, closes, today_ts)
    try:
        out = fut.result(timeout=DIVIDEND_BUDGET_SECONDS)
        return out, "applied"
    except cf.TimeoutError:
        _log.warning("[breadth_live_universes] dividend basis exceeded %ss — frame unadjusted",
                     DIVIDEND_BUDGET_SECONDS)
        return closes, "timeout"
    except Exception as e:
        return closes, f"error: {type(e).__name__}"
    finally:
        ex.shutdown(wait=False)


def _build_state(L: int) -> Optional[dict]:
    """The once-per-session heavy half: members, the union frame and its levels."""
    from api.services import breadth_live as bl
    conn = bl._bars_conn()
    today_ts = bl._ts_int(bl._now_et().date())
    rss0 = _rss_mb()
    t0 = time.time()
    _stage("members")
    mem = members(_iso(L))
    t_mem = time.time() - t0
    union = sorted(set().union(*[set(v) for v in mem.values()]))
    if len(union) < 500:
        return None
    _stage("frame")
    t1 = time.time()
    source = "barspack"
    try:
        packed = _load_frame_from_pack(union, _iso(L))
    except Exception as e:
        _log.warning("[breadth_live_universes] pack frame failed: %s", e)
        packed = None
    if packed is not None and len(packed[0]) >= 240:
        dates, closes, vols = packed
    else:
        source = "bars.db"
        start = bl._ts_int(date.fromisoformat(_iso(L)) - timedelta(days=bl._LOAD_CALENDAR_DAYS + 30))
        dates = bl._session_dates(conn, L, start, limit=bl._FRAME_SESSIONS + 15)
        if len(dates) < 240:
            return None
        closes, vols = _load_frame_by_key(conn, union, dates)
    t_frame = time.time() - t1
    _stage("dividend_basis")
    t2 = time.time()
    closes, div_state = _dividend_basis_with_budget(union, dates, closes, today_ts)
    t_div = time.time() - t2
    pos = {t: i for i, t in enumerate(union)}
    idx = {u: np.array([pos[t] for t in mem[u]], dtype=int) for u in UNIVERSES}
    _stage("levels")
    t3 = time.time()
    levels_today = bl.build_levels(union, closes, vols, L)
    timings = {"members_s": round(t_mem, 2), "frame_s": round(t_frame, 2),
               "dividend_basis_s": round(t_div, 2), "dividend_basis": div_state,
               "levels_s": round(time.time() - t3, 2),
               "frame_source": source, "names": len(union), "sessions": len(dates),
               "rss_before_mb": rss0, "rss_after_mb": _rss_mb(),
               "priced_last": int((~np.isnan(closes[:, -1])).sum())}
    _log.info("[breadth_live_universes] state built: %s", timings)
    return {"L": L, "dates": dates, "union": union, "members": mem, "idx": idx,
            "closes": closes, "vols": vols, "built_at": time.time(),
            "levels_today": levels_today, "timings": timings}


_progress: dict = {}


def _stage(name: str) -> None:
    """Where a long build currently is — read by the diagnostic job route."""
    _progress.update(stage=name, at=time.time())


def _close_rows(st: dict, k: int) -> dict:
    """The method at the CLOSE of `st['dates'][k]`, per universe (levels from the prior k sessions)."""
    from api.services import breadth_live as bl
    _stage(f"close_rows:{k}")
    union, closes, vols = st["union"], st["closes"], st["vols"]
    lv = bl.build_levels(union, closes[:, :k], vols[:, :k], st["dates"][k - 1])
    prices = {t: float(closes[i, k]) for i, t in enumerate(union)
              if not math.isnan(closes[i, k]) and closes[i, k] > 0}
    vv = {t: float(vols[i, k]) for i, t in enumerate(union)
          if not math.isnan(vols[i, k]) and vols[i, k] > 0}
    return {u: method_row(_subset_levels(lv, st["idx"][u], st["members"][u]), prices, vv)
            for u in UNIVERSES}


def _snapshot():
    """(prices, vols, opens, highs, lows) — `breadth_live`'s own snapshot when fresh, else one
    fetch. `highs`/`lows` are the session's running RTH high/low (intraday new highs/lows)."""
    from api.services import breadth_live as bl
    with bl._live_lock:
        at = bl._live_cache.get("at", 0)
        p, v = bl._live_cache.get("prices"), bl._live_cache.get("vols")
        hi, lo = bl._live_cache.get("highs"), bl._live_cache.get("lows")
    if p and hi is not None and time.time() - at <= SNAPSHOT_MAX_AGE:
        return p, v or {}, None, hi, lo or {}
    from api.services.massive import _get_client
    snap = _get_client().get_full_market_snapshot() or {}
    return ({t: d["last_price"] for t, d in snap.items() if d.get("last_price")},
            {t: d["today_vol"] for t, d in snap.items() if d.get("today_vol")},
            {t: d["day_open"] for t, d in snap.items() if d.get("day_open")},
            {t: d["day_high"] for t, d in snap.items() if d.get("day_high")},
            {t: d["day_low"] for t, d in snap.items() if d.get("day_low")})


#: Fields the intraday new-highs/lows series owns when it is served (breadth_nhnl_intraday).
def _apply_nhnl(universe: str, rows: list, highs: dict, lows: dict, members: list,
                today_iso: str) -> None:
    """Replace each row's new-high/low family with the INTRADAY basis: the series' value for a
    settled session, the snapshot-measured count for today's row. A provisional session the
    series has not reached yet carries NO new-high/low value — never a closing-basis count
    beside intraday history."""
    try:
        from api.services import breadth_nhnl_intraday as nhi
        if not nhi.active():
            return
        for row in rows:
            d, m = row["date"], row["metrics"]
            v = nhi.values(universe, d)
            if v is None and d == today_iso:
                v = nhi.live_counts(universe, highs or {}, lows or {}, members, d)
            for k in nhi.SERVED:
                m[k] = (v or {}).get(k)
    except Exception as e:
        _log.warning("[breadth_live_universes] nhnl overlay skipped: %s", e)


def compute(force: bool = False) -> dict:
    """Build the payload: provisional completed sessions + today's live row, per universe."""
    from api.services import breadth_live as bl
    conn = bl._bars_conn()
    L = bl.last_completed_session(conn)
    if not L:
        return {"ok": False, "reason": "no completed session in bars.db"}
    st = _state.get("value")
    if force or not st or st["L"] != L:
        if not force and _process_uptime() < BOOT_GRACE_SECONDS:
            return {"ok": False, "reason": "boot grace: no state build in the first %ss of a process"
                    % BOOT_GRACE_SECONDS}
        st = _build_state(L)
        if st is None:
            return {"ok": False, "reason": "frame unavailable (members or bars.db too thin)"}
        _state["value"] = st
        _state["close_rows"] = {}
    dates = st["dates"]
    iso_dates = [_iso(d) for d in dates]

    now_et = bl._now_et()
    today_iso = now_et.date().isoformat()
    live_today = None
    highs, lows = {}, {}
    if bl._session_started() and today_iso > iso_dates[-1]:
        try:
            prices, vols, opens, highs, lows = _snapshot()
        except Exception as e:
            prices, vols, opens = {}, {}, None
            _log.warning("[breadth_live_universes] snapshot failed: %s", e)
        us = st["members"]["us"]
        traded = sum(1 for t in us if (vols or {}).get(t))
        if us and traded / len(us) >= bl.MIN_TRADED_SHARE:
            lv = st["levels_today"]
            live_today = {u: method_row(_subset_levels(lv, st["idx"][u], st["members"][u]),
                                        prices, vols, opens) for u in UNIVERSES}

    out = {"ok": True, "as_of": now_et.isoformat(timespec="seconds"), "L": iso_dates[-1],
           "universes": {}}
    close_rows = _state.setdefault("close_rows", {})
    for u in UNIVERSES:
        keys = _published_metrics(u)
        canon = canonical(u, keys)
        cdates = sorted(d for d in canon if d <= iso_dates[-1] and canon[d].get("advancing") is not None)
        if not cdates:
            out["universes"][u] = {"ok": False, "reason": "no canonical session"}
            continue
        S = cdates[-1]
        if S not in iso_dates or iso_dates.index(S) < 230:
            out["universes"][u] = {"ok": False, "reason": f"anchor session {S} outside the frame"}
            continue
        kS = iso_dates.index(S)
        if kS not in close_rows:
            close_rows[kS] = _close_rows(st, kS)
        raw_s = close_rows[kS][u]
        c_s = canon[S]
        cu, ru = c_s.get("universe_count"), raw_s.get("universe_count")
        drift = (ru / cu - 1.0) if cu and ru else None
        if drift is None or abs(drift) > MAX_POPULATION_DRIFT:
            out["universes"][u] = {"ok": False, "degraded": True, "anchor": S,
                                   "population_drift": None if drift is None else round(drift, 4),
                                   "reason": "method population does not reconcile with canonical"}
            continue
        window = [canon[d] for d in sorted(canon) if d <= S]
        rows = []
        for k in range(kS + 1, len(dates)):          # provisional completed sessions
            if k not in close_rows:
                close_rows[k] = _close_rows(st, k)
            r = finish_row(anchor(close_rows[k][u], raw_s, c_s), window)
            rows.append({"date": iso_dates[k], "final": True, "metrics": r})
            window = window + [r]
        if live_today:
            r = finish_row(anchor(live_today[u], raw_s, c_s), window)
            rows.append({"date": today_iso, "final": False, "metrics": r})
        _apply_nhnl(u, rows, highs, lows, st["members"][u], today_iso)
        out["universes"][u] = {"ok": True, "anchor": S, "population_drift": round(drift, 4),
                               "members": len(st["members"][u]), "rows": rows}
    return out


#: ⭐ THE LAST GOOD PAYLOAD SURVIVES A RESTART. Every web deploy starts a process that may not
#: build for BOOT_GRACE_SECONDS (+ the build itself); on 2026-10-09 other sessions redeployed ~8
#: times in a morning and every chart lost the provisional session and today's bar each time.
#: A payload that was good, saved this ET session day and is younger than CARRY_MAX_SECONDS is
#: served (marked `carried`) until the new process builds its own.
LAST_GOOD_PATH = os.path.join(os.environ.get("DATA_DIR", "/data"), "breadth_live_universes_last.json")
CARRY_MAX_SECONDS = 3 * 3600


def _good(p: dict) -> bool:
    return bool(p and p.get("ok") and any((u or {}).get("ok") for u in (p.get("universes") or {}).values()))


def _save_last_good(p: dict) -> None:
    try:
        tmp = LAST_GOOD_PATH + ".tmp"
        with open(tmp, "w") as fh:
            json.dump({"saved_at": time.time(), "payload": p}, fh, separators=(",", ":"))
        os.replace(tmp, LAST_GOOD_PATH)
    except Exception as e:
        _log.warning("[breadth_live_universes] last-good save failed: %s", e)


def _carried(now: float) -> Optional[dict]:
    """The last good payload (memory, else disk) if it is from this ET day and recent enough."""
    from api.services import breadth_live as bl
    rec = _last_good.get("rec")
    if rec is None:
        try:
            with open(LAST_GOOD_PATH) as fh:
                rec = json.load(fh)
        except Exception:
            return None
        _last_good["rec"] = rec
    p, at = rec.get("payload") or {}, float(rec.get("saved_at") or 0)
    if now - at > CARRY_MAX_SECONDS or not _good(p):
        return None
    if str(p.get("as_of") or "")[:10] != bl._now_et().date().isoformat():
        return None
    return dict(p, carried=True, carried_from=p.get("as_of"))


_last_good: dict = {}


def refresh(force: bool = False) -> dict:
    with _lock:
        try:
            p = compute(force=force)
        except Exception as e:      # never break a serve path
            _log.warning("[breadth_live_universes] compute failed: %s", e)
            p = {"ok": False, "reason": f"compute failed: {e}"}
        now = time.time()
        if _good(p):
            _last_good["rec"] = {"saved_at": now, "payload": p}
            _save_last_good(p)
            _record_intraday(p)
        else:
            c = _carried(now)
            if c is not None:
                c["carried_reason"] = p.get("reason")
                p = c
        _payload.update(value=p, at=now)
        return p


def _stale() -> bool:
    from api.services import breadth_live as bl
    age = time.time() - (_payload.get("at") or 0)
    return age > (REFRESH_SECONDS if bl._session_started() and bl._market_open() else IDLE_REFRESH_SECONDS)


def _kick() -> None:
    if _refreshing.is_set():
        return
    _refreshing.set()

    def run():
        try:
            refresh()
        finally:
            _refreshing.clear()

    threading.Thread(target=run, name="breadth-live-universes", daemon=True).start()


def payload(cached_only: bool = True) -> dict:
    """The served payload; never computes inline when `cached_only` (kicks a background build)."""
    if _stale():
        if cached_only:
            _kick()
        else:
            return refresh()
    return _payload.get("value") or {"ok": False, "reason": "warming"}


def rows_for(universe: str) -> list:
    """`[{date, final, metrics}]` after the last canonical session, oldest first; [] when off."""
    if not serving():
        return []
    p = payload(cached_only=True)
    u = (p.get("universes") or {}).get(universe) or {}
    return list(u.get("rows") or []) if u.get("ok") else []


def _finite(v) -> Optional[float]:
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if math.isfinite(f) else None


def append_library_bars(body: list, universe: str, metric: str) -> list:
    """`body` (sealed canonical bars) + provisional/live bars for one metric.

    ⭐ (2026-10-10) A session the live engine RECORDED (`_record_intraday`) is drawn with its real
    intraday path — open = the first live reading of the session, high/low = the extremes seen,
    close = the row's value — and marked observed (`ohlc: 1`), like the canonical history beside it.
    A session it did not record (a restart gap, an off-hours deploy) is a close-to-close body."""
    if not body:
        return body
    out = list(body)
    for row in rows_for(universe):
        v = _finite((row.get("metrics") or {}).get(metric))
        if v is None or row["date"] <= out[-1]["t"]:
            continue
        path = _intraday_path(row["date"], universe, metric)
        if path is not None:
            o, h, l = path
            out.append({"t": row["date"], "o": round(o, 4), "h": round(max(h, o, v), 4),
                        "l": round(min(l, o, v), 4), "c": round(v, 4), "v": 0, "ohlc": 1})
            continue
        o = out[-1]["c"]
        out.append({"t": row["date"], "o": round(o, 4), "h": round(max(o, v), 4),
                    "l": round(min(o, v), 4), "c": round(v, 4), "v": 0})
    return out


# ── the recorded intraday path (real candles for the live / provisional sessions) ─────────────
#: Where the per-session path is kept, so a restart mid-session does not lose the morning.
INTRADAY_PATH = os.path.join(os.environ.get("DATA_DIR", "/data"), "breadth_live_universes_intraday.json")
_INTRADAY_DEFAULT = INTRADAY_PATH
#: A path needs this many readings before it is drawn as an observed candle (a single reading
#: after a restart is not a session's range).
INTRADAY_MIN_SAMPLES = 5
_intra: dict = {}          # {date: {universe: {metric: [o, h, l, c, n]}}}
_intra_loaded: dict = {"done": False}
_intra_lock = threading.Lock()


def _intra_load() -> None:
    if _intra_loaded["done"]:
        return
    _intra_loaded["done"] = True
    try:
        with open(INTRADAY_PATH) as fh:
            d = json.load(fh)
        if isinstance(d, dict):
            _intra.update(d)
    except Exception:
        pass


def _record_intraday(p: dict) -> None:
    """Fold today's live readings into the session's path. Regular hours only; never raises."""
    try:
        from api.services import breadth_live as bl
        if not (bl._session_started() and bl._market_open()):
            return
        today = bl._now_et().date().isoformat()
        with _intra_lock:
            _intra_load()
            day = _intra.setdefault(today, {})
            for u, uv in (p.get("universes") or {}).items():
                if not (uv or {}).get("ok"):
                    continue
                for row in uv.get("rows") or []:
                    if row.get("date") != today:
                        continue
                    um = day.setdefault(u, {})
                    for k, val in (row.get("metrics") or {}).items():
                        x = _finite(val)
                        if x is None:
                            continue
                        cur = um.get(k)
                        if cur is None:
                            um[k] = [x, x, x, x, 1]
                        else:
                            cur[1] = max(cur[1], x)
                            cur[2] = min(cur[2], x)
                            cur[3] = x
                            cur[4] += 1
            for d in sorted(_intra)[:-4]:      # keep the last four sessions
                _intra.pop(d, None)
            snap = json.dumps(_intra, separators=(",", ":"))
        if "PYTEST_CURRENT_TEST" in os.environ and INTRADAY_PATH == _INTRADAY_DEFAULT:
            return                               # never write the real volume from a test run
        tmp = INTRADAY_PATH + ".tmp"
        with open(tmp, "w") as fh:
            fh.write(snap)
        os.replace(tmp, INTRADAY_PATH)
    except Exception as e:
        _log.warning("[breadth_live_universes] intraday record failed: %s", e)


def _intraday_path(date_iso: str, universe: str, metric: str):
    """(open, high, low) of a recorded session, or None when it was not (well) recorded."""
    with _intra_lock:
        _intra_load()
        cur = ((_intra.get(date_iso) or {}).get(universe) or {}).get(metric)
    if not cur or cur[4] < INTRADAY_MIN_SAMPLES:
        return None
    return cur[0], cur[1], cur[2]


#: The breadth inputs the market-indicator producers read (`load_pair` / `load_metric_closes`).
INDICATOR_INPUTS = ("advancing", "declining", "adv_decline", "new_52w_highs", "new_52w_lows",
                    "unchanged")


def indicator_overlay(universe: str) -> dict:
    """`{metric: {date: value}}` for the producers' overlay, or {} when there is nothing to add."""
    rows = rows_for(universe)
    ov: dict = {}
    for row in rows:
        for k in INDICATOR_INPUTS:
            v = (row.get("metrics") or {}).get(k)
            if v is not None:
                ov.setdefault(k, {})[row["date"]] = v
    return ov


# ── the proof ────────────────────────────────────────────────────────────────

def reconcile(sessions: int = 10) -> dict:
    """Replay the newest canonical sessions with THIS method and grade it.

    For each session X with a canonical predecessor P:  predicted(X) = canonical(P) +
    method(X) − method(P), i.e. exactly what a member would have seen as the provisional
    value of X before the canonical producer finalised it. Reported per universe and metric:
    mean / max absolute error against canonical(X), plus the population drift at each anchor.
    Read-only; serves nothing.
    """
    from api.services import breadth_live as bl
    conn = bl._bars_conn()
    L = bl.last_completed_session(conn)
    st = _state.get("value")
    if not st or st["L"] != L:
        st = _build_state(L)
        if st is None:
            return {"ok": False, "reason": "frame unavailable"}
        _state["value"] = st
        _state["close_rows"] = {}
    iso_dates = [_iso(d) for d in st["dates"]]
    close_rows = _state.setdefault("close_rows", {})
    report: dict = {"ok": True, "L": iso_dates[-1], "universes": {}}
    from api.services import breadth_daily_ohlc as store
    for u in UNIVERSES:
        keys = _published_metrics(u)
        canon: dict = {}
        for k in keys:
            for d, r in (store.history(k, limit=sessions + 12, universe=u) or {}).items():
                if (r or {}).get("c") is not None:
                    canon.setdefault(d, {})[k] = r["c"]
        cds = sorted(d for d in canon if d in iso_dates and canon[d].get("advancing") is not None)
        pairs = [(cds[i - 1], cds[i]) for i in range(1, len(cds))][-sessions:]
        errs: dict = {}
        drifts = []
        for p_iso, x_iso in pairs:
            kp, kx = iso_dates.index(p_iso), iso_dates.index(x_iso)
            for kk in (kp, kx):
                if kk not in close_rows:
                    close_rows[kk] = _close_rows(st, kk)
            raw_p, raw_x = close_rows[kp][u], close_rows[kx][u]
            cu, ru = canon[p_iso].get("universe_count"), raw_p.get("universe_count")
            if cu and ru:
                drifts.append(round(ru / cu - 1.0, 4))
            window = [canon[d] for d in sorted(canon) if d <= p_iso]
            pred = finish_row(anchor(raw_x, raw_p, canon[p_iso]), window)
            for k, v in pred.items():
                c = canon[x_iso].get(k)
                if v is None or c is None:
                    continue
                errs.setdefault(k, []).append(abs(float(v) - float(c)))
        report["universes"][u] = {
            "pairs": len(pairs), "population_drift": drifts,
            "metrics": {k: {"mean_abs": round(sum(e) / len(e), 3), "max_abs": round(max(e), 3),
                            "n": len(e)} for k, e in sorted(errs.items())},
        }
    return report


# ── market indicators (McClellan, A/D, ratios, HLI, Zweig) ───────────────────

_ind_cache: dict = {}
#: Running totals continue from the SERVED last value (a recomputation over the authority's
#: inputs could differ from the served level by a constant); everything else is a function
#: of the inputs and is taken as computed.
_CUMULATIVE_KINDS = ("AD", "MCS")


def indicator_points(series_id: str, universe: str, canon_points: list) -> list:
    """`[{t, v}]` after the canonical series' last point: provisional sessions + today."""
    if universe not in UNIVERSES or not canon_points or not serving():
        return []
    ov = indicator_overlay(universe)
    if not ov:
        return []
    key = (series_id, _payload.get("at"), canon_points[-1]["t"])
    hit = _ind_cache.get(series_id)
    if hit and hit[0] == key:
        return hit[1]
    from api.services.market_indicators import producers
    ds = producers.build_with_overlay(series_id, {universe: ov})
    if ds is None:
        return []
    re = {d: v for d, v in zip(ds.dates, ds.values)}
    last_t, last_v = canon_points[-1]["t"], canon_points[-1]["v"]
    kind = series_id.split(":", 1)[1] if ":" in series_id else series_id
    out = []
    r0 = re.get(last_t)
    for d in sorted(x for x in re if x > last_t):
        v = _finite(re[d])
        if v is None:
            continue
        if kind in _CUMULATIVE_KINDS:
            if r0 is None:
                return []
            v = float(last_v) + v - float(r0)
        out.append({"t": d, "v": round(v, 4)})
    _ind_cache[series_id] = (key, out)
    return out


# ── background jobs for the diagnostic routes ────────────────────────────────
#
# ⛔ The reconcile replay and a cold `compute` cost tens of seconds (a ~5,500-name frame and one
# level build per replayed session). A request thread must never hold that: the edge times out
# at 100 s (measured: HTTP 524 on the first production call) and the web pod is ONE process. The
# routes start a job and return; a later call reads the result.

_jobs: dict = {}
_jobs_lock = threading.Lock()


def start_job(name: str, fn, *args) -> dict:
    with _jobs_lock:
        cur = _jobs.get(name)
        if cur and cur.get("state") == "running":
            return {"state": "running", "started_at": cur["started_at"]}
        _jobs[name] = {"state": "running", "started_at": time.time()}

    def run():
        try:
            res = fn(*args)
            with _jobs_lock:
                _jobs[name] = {"state": "done", "finished_at": time.time(), "result": res}
        except Exception as e:
            with _jobs_lock:
                _jobs[name] = {"state": "failed", "finished_at": time.time(), "error": repr(e)}

    threading.Thread(target=run, name=f"blu-{name}", daemon=True).start()
    return {"state": "running", "started_at": _jobs[name]["started_at"]}


def job(name: str) -> dict:
    with _jobs_lock:
        out = dict(_jobs.get(name) or {"state": "none"})
    out["progress"] = dict(_progress)
    st = _state.get("value")
    if st:
        out["state_timings"] = st.get("timings")
    return out
