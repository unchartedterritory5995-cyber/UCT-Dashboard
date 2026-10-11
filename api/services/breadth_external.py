"""Our breadth vs the published references — captured daily, compared weekly, internal only.

⭐ WHY (2026-10-11, owner OK). The audit found nothing that compares our numbers with the
outside world automatically; the split defect in the new-highs ring would have shown here as
a slowly drifting gap. Both references publish only their LATEST session, so the comparison
needs a daily capture:

  WSJ Markets Diary (JSON)        NYSE / Nasdaq advancing, declining, unchanged, new highs,
                                  new lows — ALL issues (common, ETFs, funds, preferreds)
  StockCharts symbol summary      $NYA20R/50R/150R/200R, $NAA20R/50R/150R/200R (% above MA,
                                  close basis), $NYSI, $NASI (ratio-adjusted summation)

⛔ NEVER SHOWN TO MEMBERS, NEVER ON A SERVE PATH: ~15 requests a day from a scheduler job.

WHAT COUNTS AS A PROBLEM — drift, not level. Our populations differ on purpose (stocks only;
intraday NH/NL), so a STEADY gap is the methodology; a gap that MOVES is a bug signal:
  % above MA     the 5-session mean gap moves > DRIFT_PCT points from its own baseline, or
                 (no baseline yet) any |gap| > LEVEL_PCT
  NH / NL        our ALL-ISSUES count / WSJ's, recent median vs its baseline, outside 1.5x
  advancing      our advancing share vs WSJ's differs > 0.10 on 3 of the last 5 sessions
  NYSI / NASI    the daily change agrees in sign on fewer than 3 of the last 5 sessions
  capture        a source has no observation in the last 3 sessions (a scrape failure is
                 not a data problem, and must not be mistaken for one)
"""
from __future__ import annotations

import json
import logging
import os
import sqlite3
import statistics
import time
from contextlib import closing
from datetime import date, datetime, timedelta
from typing import Callable, Optional
from zoneinfo import ZoneInfo

_log = logging.getLogger("breadth_external")
_ET = ZoneInfo("America/New_York")

WSJ_URL = ("https://www.wsj.com/market-data/stocks/marketsdiary?id=%7B%22application%22%3A%22WSJ"
           "%22%2C%22marketsDiaryType%22%3A%22overview%22%7D&type=mdc_marketsdiary")
SC_URL = "https://stockcharts.com/j-sum/sum"
HEADERS = {
    "User-Agent": ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                   "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"),
    "Accept": "application/json, text/plain, */*",
}
#: StockCharts symbol -> what of ours it is compared with
SC_SYMBOLS = {
    "$NYA20R": ("pct", "nyse", "pct_above_20sma"), "$NYA50R": ("pct", "nyse", "pct_above_50sma"),
    "$NYA150R": ("pct", "nyse", "pct_above_150sma"), "$NYA200R": ("pct", "nyse", "pct_above_200sma"),
    "$NAA20R": ("pct", "nasdaq", "pct_above_20sma"), "$NAA50R": ("pct", "nasdaq", "pct_above_50sma"),
    "$NAA150R": ("pct", "nasdaq", "pct_above_150sma"), "$NAA200R": ("pct", "nasdaq", "pct_above_200sma"),
    "$NYSI": ("mi", "NYSE:MCS", None), "$NASI": ("mi", "NASDAQ:MCS", None),
}
WSJ_ROWS = {"Advancing": "adv", "Declining": "dec", "Unchanged": "unch",
            "New Highs": "nh", "New Lows": "nl"}
DRIFT_PCT = 3.0
LEVEL_PCT = 6.0
RATIO_BAND = 1.5
ADV_SHARE_GAP = 0.10


# ── store ────────────────────────────────────────────────────────────────────

def _db_path() -> str:
    return os.environ.get("BREADTH_EXTERNAL_DB") or os.path.join(
        os.environ.get("DATA_DIR", "/data"), "breadth_external.db")


def _conn() -> sqlite3.Connection:
    c = sqlite3.connect(_db_path(), timeout=5)
    c.execute("CREATE TABLE IF NOT EXISTS obs (date TEXT NOT NULL, source TEXT NOT NULL, "
              "key TEXT NOT NULL, value REAL, captured_at REAL NOT NULL, "
              "PRIMARY KEY (date, source, key))")
    return c


def _put(rows: list) -> int:
    if not rows:
        return 0
    now = time.time()
    with closing(_conn()) as c:
        c.executemany("INSERT OR REPLACE INTO obs VALUES (?,?,?,?,?)",
                      [(d, s, k, v, now) for d, s, k, v in rows])
        c.commit()
    return len(rows)


def observations(days: int = 60) -> dict:
    """{source: {key: {date: value}}} for the last `days` calendar days."""
    since = (date.today() - timedelta(days=days)).isoformat()
    out: dict = {}
    try:
        with closing(_conn()) as c:
            for d, s, k, v in c.execute("SELECT date, source, key, value FROM obs WHERE date >= ?",
                                        (since,)):
                out.setdefault(s, {}).setdefault(k, {})[d] = v
    except Exception:
        return {}
    return out


# ── capture ──────────────────────────────────────────────────────────────────

def _num(s) -> Optional[float]:
    try:
        return float(str(s).replace(",", ""))
    except (TypeError, ValueError):
        return None


def parse_wsj(doc: dict) -> list:
    """[(date, 'wsj', 'nyse.adv', value), ...] — dated by the diary's own timestamp."""
    data = (doc or {}).get("data") or {}
    ts = str(data.get("timestamp") or "")
    try:
        day = datetime.strptime(ts.split()[-1], "%m/%d/%y").date().isoformat()
    except Exception:
        return []
    out = []
    for block in data.get("instrumentSets") or []:
        label = ((block.get("headerFields") or [{}])[0] or {}).get("label")
        if label not in ("Issues", "Issues At"):
            continue
        for row in block.get("instruments") or []:
            key = WSJ_ROWS.get(row.get("name"))
            if not key:
                continue
            for ex, uni in (("NYSE", "nyse"), ("NASDAQ", "nasdaq")):
                v = _num(row.get(ex))
                if v is not None:
                    out.append((day, "wsj", f"{uni}.{key}", v))
    return out


def parse_stockcharts(sym: str, doc: dict) -> list:
    v = _num((doc or {}).get("close"))
    try:
        day = datetime.strptime(str(doc.get("latestTrade")), "%d %b %Y").date().isoformat()
    except Exception:
        return []
    return [(day, "stockcharts", sym, v)] if v is not None else []


def capture(get: Optional[Callable] = None) -> dict:
    """Fetch both references once and store what they publish (latest session only)."""
    if get is None:
        import requests
        get = requests.get
    rows, errors = [], {}
    try:
        r = get(WSJ_URL, headers=HEADERS, timeout=20)
        got = parse_wsj(r.json()) if getattr(r, "status_code", 0) == 200 else []
        if not got:
            errors["wsj"] = f"http {getattr(r, 'status_code', '?')} / unparsed"
        rows += got
    except Exception as e:                         # noqa: BLE001
        errors["wsj"] = f"{type(e).__name__}"
    for sym in SC_SYMBOLS:
        try:
            r = get(SC_URL, params={"cmd": "symsum", "symbol": sym}, headers=HEADERS, timeout=20)
            got = parse_stockcharts(sym, r.json()) if getattr(r, "status_code", 0) == 200 else []
            if not got:
                errors[sym] = f"http {getattr(r, 'status_code', '?')} / unparsed"
            rows += got
        except Exception as e:                     # noqa: BLE001
            errors[sym] = f"{type(e).__name__}"
        time.sleep(0.5)
    n = _put(rows)
    _log.info("[breadth-external] captured %s rows, errors %s", n, errors)
    return {"stored": n, "errors": errors}


# ── our side ─────────────────────────────────────────────────────────────────

def ours_pct(universe: str, metric: str) -> dict:
    from api.services import breadth_daily_ohlc as bdo
    try:
        h = bdo.history(metric, universe=universe, limit=90) or {}
    except Exception:
        return {}
    return {d: r.get("c") for d, r in h.items() if r.get("c") is not None}


def ours_mi(series_id: str) -> dict:
    try:
        from api.services.market_indicators import producers
        s = producers.build(series_id)
    except Exception:
        return {}
    if s is None:
        return {}
    return {d: v for d, v in zip(s.dates[-90:], s.values[-90:]) if v is not None}


def ours_counts(universe: str, d: str, ad: Optional[dict] = None) -> dict:
    """Our ALL-ISSUES new highs / lows and our (stocks-only) advancers / decliners.
    `ad` = {"adv": {date: v}, "dec": {date: v}} pre-read by the caller."""
    out = {}
    try:
        from api.services import breadth_nhnl_intraday as nhi
        v = nhi.values(f"{universe}:all", d) or {}
        out["nh"], out["nl"] = v.get("new_52w_highs"), v.get("new_52w_lows")
    except Exception:
        pass
    ad = ad if ad is not None else {"adv": ours_pct(universe, "advancing"),
                                    "dec": ours_pct(universe, "declining")}
    for k in ("adv", "dec"):
        r = (ad.get(k) or {}).get(d)
        if r is not None:
            out[k] = r
    return out


# ── comparison ───────────────────────────────────────────────────────────────

def _drift(gaps: list) -> Optional[str]:
    """`gaps` = [(date, ours - theirs)] oldest first."""
    if len(gaps) < 3:
        return None
    recent = [g for _d, g in gaps[-5:]]
    base = [g for _d, g in gaps[:-5]]
    if len(base) >= 10:
        b = statistics.median(base)
        m = statistics.mean(recent)
        if abs(m - b) > DRIFT_PCT:
            return f"gap moved to {m:+.1f} (baseline {b:+.1f})"
        return None
    worst = max(recent, key=abs)
    if abs(worst) > LEVEL_PCT:
        return f"gap {worst:+.1f} points (no baseline yet)"
    return None


def compare(obs: Optional[dict] = None, today: Optional[date] = None) -> dict:
    obs = observations() if obs is None else obs
    today = today or datetime.now(_ET).date()
    findings, rows = [], []
    sc = obs.get("stockcharts", {})
    for sym, (kind, a, b) in SC_SYMBOLS.items():
        theirs = sc.get(sym, {})
        if not theirs:
            continue
        mine = ours_pct(a, b) if kind == "pct" else ours_mi(a)
        both = sorted(d for d in theirs if d in mine)
        if kind == "pct":
            gaps = [(d, mine[d] - theirs[d]) for d in both]
            if gaps:
                rows.append(f"{sym}: ours {mine[both[-1]]:.1f} vs {theirs[both[-1]]:.1f}")
            why = _drift(gaps)
            if why:
                findings.append(f"{sym} vs {a.upper()} {b}: {why}")
        else:
            ch = [(d, mine[d] - mine[p], theirs[d] - theirs[p]) for p, d in zip(both, both[1:])]
            recent = ch[-5:]
            if len(recent) >= 5 and sum(1 for _d, x, y in recent if (x >= 0) == (y >= 0)) < 3:
                findings.append(f"{sym} vs {a}: daily direction agreed on fewer than 3 of 5 sessions")
    wsj = obs.get("wsj", {})
    for uni in ("nyse", "nasdaq"):
        dates = sorted(wsj.get(f"{uni}.nh", {}))
        ratios = {"nh": [], "nl": []}
        adv_miss = []
        ad = {"adv": ours_pct(uni, "advancing"), "dec": ours_pct(uni, "declining")}
        for d in dates:
            mine = ours_counts(uni, d, ad)
            for k in ("nh", "nl"):
                t = wsj.get(f"{uni}.{k}", {}).get(d)
                if t and t >= 10 and mine.get(k) is not None:
                    ratios[k].append(mine[k] / t)
            ta, td = wsj.get(f"{uni}.adv", {}).get(d), wsj.get(f"{uni}.dec", {}).get(d)
            if ta and td and mine.get("adv") is not None and mine.get("dec"):
                adv_miss.append(abs(mine["adv"] / (mine["adv"] + mine["dec"]) - ta / (ta + td))
                                > ADV_SHARE_GAP)
        for k, rs in ratios.items():
            if len(rs) >= 15:
                b, r = statistics.median(rs[:-5]), statistics.median(rs[-5:])
                if b > 0 and not (1 / RATIO_BAND <= r / b <= RATIO_BAND):
                    findings.append(f"{uni.upper()} new {'highs' if k == 'nh' else 'lows'}: "
                                    f"ours/WSJ moved to {r:.2f} (baseline {b:.2f})")
        if len(adv_miss) >= 5 and sum(adv_miss[-5:]) >= 3:
            findings.append(f"{uni.upper()} advancing share differs from WSJ by > "
                            f"{ADV_SHARE_GAP:.0%} on {sum(adv_miss[-5:])} of the last 5 sessions")
    # capture health: a source silent for 3 sessions is a scrape problem, said as such
    from api.services import session_calendar as sc_cal
    recent_sessions, d = [], today
    while len(recent_sessions) < 3:
        if sc_cal.is_trading_day(d) and d < today:
            recent_sessions.append(d.isoformat())
        d -= timedelta(days=1)
    for src in ("wsj", "stockcharts"):
        seen = {dd for k in obs.get(src, {}).values() for dd in k}
        if not seen & set(recent_sessions):
            findings.append(f"capture: no {src} observation in the last 3 sessions "
                            "(the source changed or is blocking — not a data problem)")
    return {"findings": findings, "latest": rows}


def weekly_report(post=None) -> dict:
    """Saturday: one message — drift findings, or a short all-clear proving the check ran."""
    from api.services import breadth_alerts
    res = compare()
    week = datetime.now(_ET).date().isocalendar()
    key = f"external:{week[0]}-W{week[1]}"
    if res["findings"]:
        sent = breadth_alerts.send(key, "Breadth vs WSJ / StockCharts: drift found",
                                   res["findings"] + ["Latest:"] + res["latest"][:6], post=post)
    else:
        sent = breadth_alerts.send(key, "Breadth vs WSJ / StockCharts: within tolerance this week",
                                   res["latest"][:8] or ["(no overlapping observations yet)"], post=post)
    return {**res, "sent": sent}
