"""Dividend back-adjustment factors, for the breadth level computation ONLY.

## Why this exists

The 4:15 PM collector measures breadth from yfinance with `auto_adjust=True`,
which is DIVIDEND-adjusted. `bars.db` is SPLIT-only — the correct basis for a
price chart, and deliberately so. Every long-lookback breadth metric therefore
compared today's price against a level built on a different price basis, and
the error was not noise: across 10 reconciled sessions the sign was 10/10 in
one direction on all seven affected metrics.

    new_52w_highs  -9.9   0+/10-      stage2_count   -57.6  0+/10-
    new_ath       -10.2   0+/10-      stage4_count   +38.1  10+/0-
    new_52w_lows   +5.4   10+/0-      near_52w_high  -52.5  0+/10-
    up_25pct_quarter -17.8 0+/10-

Measured directly: a payer's history sits 4-10% below the collector's basis
over 18 months (MO -9.6%, VZ -9.3%, XOM -4.8%, JNJ -4.0%, KO -3.9%), while
non-payers land at 1.0000 exactly (AMZN +0.00%, NVDA -0.15% on a token
dividend). A name inside that band of its 52-week high is a new high to the
collector and not to us. Hence the systematic undercount of highs and the
matching overcount of lows.

## What it does NOT do

⛔ It does not touch `bars.db`. That store feeds every chart on the platform,
and charts are split-only by design. Adjusting it to satisfy one page would
change every chart in the product. The factors here are applied to a
frame that breadth already loaded, in memory, and nowhere else.

⛔ It does not adjust VOLUME. `auto_adjust` leaves volume on a split-only
basis, so `hvc_52w` and `up_vol_ratio` are already on the right basis — and
they measure fine (hvc_52w is off by 1.1 names on a base of 4.6, 0/10 fails).

## The convention

yfinance back-adjusts, so the NEWEST bar is unadjusted and history is scaled
down:

    adj(d) = close(d) * PROD over ex-dates e > d of (1 - cash_e / close(e-1))

`close(e-1)` is the close on the last session strictly before the ex-date.
A dividend whose ex-date falls at or before the frame's first date multiplies
nothing inside the frame, so only in-window dividends matter and every
`close(e-1)` is available in the frame itself — no extra bars.db round-trips.
"""
from __future__ import annotations

import json
import os
import sqlite3
import time
import urllib.request
from contextlib import closing
from datetime import date, timedelta

import numpy as np

DB_PATH = os.environ.get("BREADTH_DIVIDENDS_DB", "/data/breadth_dividends.db")
_API = "https://api.massive.com/v3/reference/dividends"

# A 52-week lookback needs a year; ATH windows walk further back but a dividend
# older than this contributes a factor to dates older than we ever level on.
DEFAULT_WINDOW_DAYS = 800

# Guards against a bad vendor row poisoning a whole ticker's history. A single
# cash dividend worth >25% of the prior close is a special/liquidating payment
# or a data error; either way, silently rescaling a year of prices off it is
# worse than skipping it and saying so.
MAX_YIELD_PER_EVENT = 0.25

_health: dict = {"refreshed_at": None, "rows": 0, "tickers": 0,
                 "skipped_no_prev_close": 0, "skipped_outsized": 0,
                 "last_error": None}


def _conn() -> sqlite3.Connection:
    d = os.path.dirname(DB_PATH)
    if d:
        os.makedirs(d, exist_ok=True)
    c = sqlite3.connect(DB_PATH, timeout=10)
    c.execute("PRAGMA journal_mode=WAL")
    c.execute("""CREATE TABLE IF NOT EXISTS dividends (
                   ticker TEXT NOT NULL,
                   ex_date INTEGER NOT NULL,      -- YYYYMMDD, matches bars.db
                   cash REAL NOT NULL,
                   PRIMARY KEY (ticker, ex_date)
                 )""")
    c.execute("CREATE INDEX IF NOT EXISTS ix_div_ex ON dividends(ex_date)")
    return c


def _ymd(iso: str) -> int:
    y, m, d = iso.split("-")
    return int(y) * 10000 + int(m) * 100 + int(d)


def refresh(window_days: int = DEFAULT_WINDOW_DAYS, api_key: str | None = None,
            max_pages: int = 600) -> dict:
    """Sweep every dividend in the window by ex-date and upsert.

    One paged range query, not 2,739 per-ticker calls. The vendor also returns
    ex-dates years into the FUTURE (declared-but-unpaid), which must be dropped
    — a future dividend would scale down history for an event that has not
    happened.

    ⚠️ `max_pages` is a runaway guard, NOT a tuning knob — the sweep is supposed
    to end when the vendor stops handing back `next_url`. At 1000 rows/page the
    whole market runs ~225k rows (25k payers x ~9 quarterly events over two
    years), so a cap of 60 silently truncated to the most recent 4 MONTHS and
    left KO with 1 of its 4 in-window events. A truncated sweep does not fail
    loudly: it just under-adjusts. `truncated` in the result is the tell.
    """
    key = api_key or os.environ.get("MASSIVE_API_KEY") or os.environ.get("MASSIVE_SECRET_KEY")
    if not key:
        _health["last_error"] = "no MASSIVE api key"
        return dict(_health)

    today = date.today()
    gte = (today - timedelta(days=window_days)).isoformat()
    url = (f"{_API}?ex_dividend_date.gte={gte}&ex_dividend_date.lte={today.isoformat()}"
           f"&limit=1000&order=desc&sort=ex_dividend_date&apiKey={key}")

    rows: list[tuple[str, int, float]] = []
    pages = 0
    try:
        while url and pages < max_pages:
            req = urllib.request.Request(url, headers={"User-Agent": "uct-breadth/1.0"})
            with urllib.request.urlopen(req, timeout=90) as r:
                js = json.loads(r.read().decode())
            for d in js.get("results") or []:
                tk, ex, cash = d.get("ticker"), d.get("ex_dividend_date"), d.get("cash_amount")
                if not tk or not ex or cash is None:
                    continue
                try:
                    cash = float(cash)
                except (TypeError, ValueError):
                    continue
                if cash <= 0:
                    continue
                rows.append((tk.upper(), _ymd(ex), cash))
            nxt = js.get("next_url")
            url = f"{nxt}&apiKey={key}" if nxt else None
            pages += 1
            if url:
                time.sleep(0.12)      # a courtesy pace; this runs once a day
        # Ran out of PAGES rather than out of DATA: the store now covers only
        # the recent tail and every older level is under-adjusted.
        _health["truncated"] = bool(url)
    except Exception as e:
        _health["last_error"] = f"{type(e).__name__}: {e}"
        if not rows:
            return dict(_health)

    if rows:
        with closing(_conn()) as c:
            c.executemany(
                "INSERT INTO dividends(ticker, ex_date, cash) VALUES (?,?,?) "
                "ON CONFLICT(ticker, ex_date) DO UPDATE SET cash=excluded.cash", rows)
            c.execute("DELETE FROM dividends WHERE ex_date < ?",
                      (_ymd((today - timedelta(days=window_days * 2)).isoformat()),))
            c.commit()
        _health.update(refreshed_at=time.time(), rows=len(rows),
                       tickers=len({t for t, _, _ in rows}))
    return dict(_health)


def _load(tickers: list[str], lo: int, hi: int) -> dict[str, list[tuple[int, float]]]:
    """`{ticker: [(ex_date, cash), ...]}` for in-window ex-dates."""
    out: dict[str, list[tuple[int, float]]] = {}
    if not os.path.exists(DB_PATH):
        return out
    want = {t.upper() for t in tickers}
    try:
        with closing(_conn()) as c:
            for tk, ex, cash in c.execute(
                    "SELECT ticker, ex_date, cash FROM dividends "
                    "WHERE ex_date BETWEEN ? AND ?", (lo, hi)):
                if tk in want:
                    out.setdefault(tk, []).append((int(ex), float(cash)))
    except sqlite3.Error as e:
        _health["last_error"] = f"{type(e).__name__}: {e}"
    return out


def factors(tickers: list[str], dates: list[int], closes: np.ndarray,
            as_of: int | None = None) -> np.ndarray:
    """(n_tickers x n_dates) multipliers to put `closes` on the collector's basis.

    All-ones when there is no dividend data, which makes the whole feature a
    no-op rather than a wrong answer — an unrefreshed store must not silently
    rescale anything.

    ⛔ `as_of` is ACCEPTED AND IGNORED. It used to extend the adjustment to
    dividends going ex on the session being measured, on the reasoning that the
    collector pulls yfinance through that day so its whole series — including
    the frame's last bar — is anchored there. That reasoning is sound and the
    measurement still rejected it: scaling the last bar rescales `prev_close`,
    which is the denominator of every ONE-DAY metric, and ~27 names go ex on a
    typical day. Over 10 reconciled sessions `adv_decline` degraded from 7.2 to
    12.0 with the sign 9+/0- — borderline decliners flipped to advancers.

    The frame's last bar therefore stays RAW, which keeps the one-day metrics
    exactly where they are today while the long-lookback levels get corrected.
    The parameter is kept so callers need not change and so this note has
    somewhere to live.
    """
    n, m = closes.shape
    out = np.ones((n, m), dtype=np.float64)
    if n == 0 or m == 0:
        return out
    divs = _load(tickers, dates[0], dates[-1])      # `as_of` deliberately unused
    if not divs:
        return out

    pos = {ts: j for j, ts in enumerate(dates)}
    skipped_prev = skipped_big = 0

    for r, tk in enumerate(tickers):
        events = divs.get(tk.upper())
        if not events:
            continue
        # ratio placed at the ex-date's own index; factor for date j is the
        # product of every ratio at an index STRICTLY GREATER than j.
        at = np.ones(m, dtype=np.float64)
        for ex, cash in events:
            j = pos.get(ex)
            if j is None:                      # ex-date on a non-session day
                j = next((k for k, ts in enumerate(dates) if ts >= ex), None)
            if j is None:
                continue                       # past the frame; see `as_of` note
            if j == 0:
                continue                       # nothing in-frame is older than it
            prev = closes[r, j - 1]
            k = j - 1
            while k >= 0 and (np.isnan(prev) or prev <= 0):
                prev = closes[r, k]
                k -= 1
            if np.isnan(prev) or prev <= 0:
                skipped_prev += 1
                continue
            ratio = 1.0 - (cash / prev)
            if ratio <= 1.0 - MAX_YIELD_PER_EVENT:
                skipped_big += 1
                continue
            at[j] *= ratio
        # exclusive suffix product: factor[j] = prod(at[j+1:])
        suffix = np.cumprod(at[::-1])[::-1]
        out[r, :-1] = suffix[1:]
        out[r, -1] = 1.0        # the last bar stays RAW — see the `as_of` note

    _health["skipped_no_prev_close"] = skipped_prev
    _health["skipped_outsized"] = skipped_big
    return out


def adjust(tickers: list[str], dates: list[int], closes: np.ndarray,
           as_of: int | None = None) -> np.ndarray:
    """`closes` rebased to the collector's dividend-adjusted basis."""
    return closes * factors(tickers, dates, closes, as_of=as_of)


def health() -> dict:
    h = dict(_health)
    h["db"] = DB_PATH
    h["present"] = os.path.exists(DB_PATH)
    if h["present"]:
        try:
            with closing(_conn()) as c:
                h["stored_rows"] = c.execute("SELECT COUNT(*) FROM dividends").fetchone()[0]
                h["stored_tickers"] = c.execute(
                    "SELECT COUNT(DISTINCT ticker) FROM dividends").fetchone()[0]
        except sqlite3.Error as e:
            h["last_error"] = f"{type(e).__name__}: {e}"
    return h
