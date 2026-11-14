"""A small synthetic market for the RS screens' end-to-end test (unit U6).

About sixty tickers of daily bars, a benchmark that corrects over the last fourteen
sessions, and twenty-one sessions of rating history. Nothing here is a test: this module
only BUILDS the inputs, so `tests/test_rs_screens_u6_e2e.py` can run the real nightly
build, the real rating post-pass and the real scan route over them.

Why the market is shaped this way (each shape puts rows on one of the five screens):

  * SPY is flat for 286 sessions, then falls 2.5% and recovers 0.3% on alternating
    sessions (seven "market down days"), ending about 14% lower. A stock that merely
    held up through that makes RS-line highs while its own price is under its high,
    which is the whole of RS New High Before Price;
  * RISERS keep climbing through it (RS highs today, price at its high);
  * HOLDERS drift down 0.25% to 0.8% a session (RS high on the last down day, price 3%
    to 11% under its high: one in each "Below its high by" bucket);
  * FALLERS drop faster than the market (RS exit warnings, below the 50-day line), and
    SLIPS are leaders that gave back a few sessions at the very end (a fresh warning);
  * UPDAYS fall with the market on its down days and bounce harder on its up days, so
    their RS highs are never on a market down day;
  * LAGGARDS fall all year (under the 200-day average: on no screen);
  * WALKERS are seeded random walks for ordinary variety;
  * and one each of the rows a screen must leave out or mark: a buyout pinned at its
    deal price, a one-day jump, a fund, a thinly traded stock, a stock under $10, a new
    issue with under a year of bars, one with forty bars (ranked on the 1-month board
    before it has a rating), and a listing with fourteen bars.

⛔ DETERMINISTIC ON EVERY PLATFORM. Closes are rounded to cents before any indicator
reads them, and the walks use `random.Random(seed).random()` (exact on every platform),
never `gauss` (which goes through libm). Nothing reads the clock.
"""
from __future__ import annotations

import datetime as dt
import random

N = 300                     # sessions of history for a full-year ticker
CORRECTION = 14             # the benchmark's last sessions
SESSIONS_RATED = 21         # stored rating sessions: "a month ago" needs 21
VOLUME = 1_000_000          # shares a session: $10M+ a day from $10 up
ADR_SPREAD = 0.02           # high and low 2% either side of the close: a 4% daily range
SPY_DOWN, SPY_UP = -0.025, 0.003   # the correction's alternating sessions


def _weekdays(n, start=dt.date(2025, 1, 6)):
    out, d = [], start
    while len(out) < n:
        if d.weekday() < 5:
            out.append(d)
        d += dt.timedelta(days=1)
    return out


DATES = _weekdays(N)
TIMES = [d.year * 10000 + d.month * 100 + d.day for d in DATES]
#: The session the ratings are finally on: the newest bar's date.
SESSION = DATES[-1].isoformat()
RATED_SESSIONS = [d.isoformat() for d in DATES[-SESSIONS_RATED:]]


def bars(closes, volume=VOLUME, times=None):
    times = TIMES[-len(closes):] if times is None else times
    out = []
    for t, c in zip(times, closes):
        c = round(float(c), 2)
        out.append({"t": t, "o": c, "h": round(c * (1 + ADR_SPREAD), 2),
                    "l": round(c * (1 - ADR_SPREAD), 2), "c": c, "v": volume})
    return out


def _compound(start, steps):
    out, c = [], float(start)
    for s in steps:
        c *= 1.0 + s
        out.append(c)
    return out


def spy_closes():
    steps = [0.0] * (N - CORRECTION) + [(SPY_DOWN if k % 2 == 0 else SPY_UP) for k in range(CORRECTION)]
    return _compound(100.0, steps)


def _riser(start, daily):
    return _compound(start, [daily] * N)


def _holder(start, daily, drift_down):
    return _compound(start, [daily] * (N - CORRECTION) + [-drift_down] * CORRECTION)


def _faller(start, daily, drop, last=CORRECTION):
    return _compound(start, [daily] * (N - last) + [-drop] * last)


def _walker(seed, start, drift=0.0006, swing=0.012):
    rnd = random.Random(seed)
    return _compound(start, [drift + (rnd.random() * 2 - 1) * swing for _ in range(N)])


def series() -> dict:
    """``{TICKER: [bar, ...]}`` for the universe, the two benchmarks included."""
    out = {"SPY": bars(spy_closes()), "RSP": bars([100.0] * N)}
    for k, daily in enumerate((0.0010, 0.0015, 0.0020, 0.0025, 0.0030, 0.0040)):
        out[f"RISE{k}"] = bars(_riser(40.0 + 5 * k, daily))
    # two that ran hard into the end: far above their averages
    out["RUN0"] = bars(_compound(60.0, [0.001] * (N - 12) + [0.02] * 12))
    out["RUN1"] = bars(_compound(45.0, [0.0015] * (N - 8) + [0.03] * 8))
    for k, down in enumerate((0.0025, 0.0030, 0.0045, 0.0050, 0.0080, 0.0085)):
        out[f"HOLD{k}"] = bars(_holder(50.0 + 4 * k, 0.0015 + 0.0004 * k, down))
    for k in range(2):
        steps = [0.002 + 0.001 * k] * (N - CORRECTION) + [
            (SPY_DOWN - 0.002 if j % 2 == 0 else 0.016 + 0.002 * k) for j in range(CORRECTION)]
        out[f"UPDAY{k}"] = bars(_compound(35.0 + 10 * k, steps))
    for k, drop in enumerate((0.018, 0.025, 0.030)):
        out[f"FALL{k}"] = bars(_faller(70.0 + 10 * k, 0.0015, drop))
    out["FALL3"] = bars(_faller(90.0, 0.0015, 0.06, last=4))
    out["SLIP0"] = bars(_faller(65.0, 0.0030, 0.05, last=1))
    out["SLIP1"] = bars(_faller(75.0, 0.0030, 0.035, last=2))
    out["SLIP2"] = bars(_faller(85.0, 0.0025, 0.045, last=3))
    out["SLIP3"] = bars(_compound(95.0, [0.0025] * (N - 5) + [-0.07, 0.03, 0.01, 0.01, 0.01]))
    # five sessions at -5%: a Quick Break, then a lower low (the newest warning is a Quicksand)
    out["SLIP4"] = bars(_faller(60.0, 0.0015, 0.05, last=5))
    # two sessions at -8%: a Quick Break today and nothing worse yet
    out["SLIP5"] = bars(_faller(90.0, 0.0015, 0.08, last=2))
    for k in range(4):
        out[f"LAG{k}"] = bars(_compound(80.0 + 5 * k, [-0.0006 - 0.0002 * k] * N))
    for k in range(30):
        out[f"WALK{k:02d}"] = bars(_walker(1000 + k, 30.0 + 3 * k, drift=0.0002 + 0.00008 * k))
    # ── the rows a screen must leave out, or mark ──
    # pinned at a deal price: +30% eight sessions ago, flat since
    out["DEAL"] = bars([100.0] * (N - 8) + [130.0] * 8)
    # the same jump four sessions ago: not a deal yet, a one-day move
    out["ONEDAY"] = bars([100.0] * (N - 4) + [130.0] * 4)
    out["FUND"] = bars(_riser(200.0, 0.0030))                       # an ETF (see TYPES)
    out["THIN"] = bars(_riser(55.0, 0.0030), volume=1_000)          # $55K a day
    out["PENNY"] = bars(_riser(2.0, 0.0030))                        # ends near $5
    out["NEWI"] = bars(_riser(60.0, 0.0030)[-120:])                 # 120 bars: a new issue
    out["BABY"] = bars(_riser(60.0, 0.0030)[-40:])                  # 40 bars: a 1-month place, no rating
    out["TINY"] = bars(_riser(60.0, 0.0030)[-14:])                  # 14 bars: no averages yet
    return out


#: The generator's type map (`screener_universe.types()`): everything a stock but one fund.
def types(tickers) -> dict:
    return {t: ("ETF" if t == "FUND" else "Stock") for t in tickers}


SECTORS = (("Technology", "Semiconductors"), ("Healthcare", "Drug makers"),
           ("Industrials", "Machinery"), ("Energy", "Oil and gas"),
           ("Financials", "Banks"), ("Consumer", "Retail"))


def fundamentals(ticker, universe) -> dict:
    """Company, sector, industry and a market value (the leaders screen needs $300M+).
    Sectors rotate through the list in ticker order; WALK05 is under the $300M line."""
    k = universe.index(ticker)
    sector, industry = SECTORS[k % len(SECTORS)]
    cap = 250_000_000 if ticker == "WALK05" else 1_000_000_000 + 100_000_000 * k
    return {"company": f"{ticker} Corp", "sector": sector, "industry": industry, "market_cap": cap}


def rating_history(all_series: dict) -> dict:
    """``{session: {TICKER: row}}`` for :data:`RATED_SESSIONS`, the shape
    `rs_history.store_rows` takes.

    ⛔ THE RATING JOB'S OWN MATHS, not a stand-in: each session's rows are
    `rs_history.compute_ratings` over the closes up to that session, so the ratings, the
    unrounded score the places are ordered by and the per-period values are computed
    exactly as the 04:15 ET job computes them. A ticker with under a year of bars has a
    rating (the missing terms are dropped) and no 12-month rank, so no overall place; one
    with under 64 bars has no rating at all."""
    from api.services.screener import rs_history
    tickers = [t for t in all_series if t not in ("SPY", "RSP")]
    funds = {t for t, kind in types(tickers).items() if kind == "ETF"}
    out = {}
    for back, session in enumerate(reversed(RATED_SESSIONS)):
        closes = {}
        for t in tickers:
            c = [b["c"] for b in all_series[t]]
            c = c[:len(c) - back]
            if c:
                closes[t] = c
        out[session] = rs_history.compute_ratings(closes, funds)
    return out
