"""A synthetic market for the Leader score test harness, built so the answer is known.

NOT a test file. ``build`` writes two SQLite files shaped like the real ones (the bars
store's ``ohlcv`` table; ``rs_rating_history`` and a ``screener_rows`` that holds ONLY
the four columns the harness may read), from closed-form prices:

* every close is the one before it times ``1 + drift + common(t)``, and the open is the
  close before it, so a return over any window is a product anyone can recompute;
* 40 LEADERS (``L00`` .. ``L39``) with drifts rising from 0.04% to 0.196% a session,
  a 4% daily range and a stored rating of 90: every one passes the gate on every date
  (all rise every session, so each is at its high, above a rising 200-day average, and
  its RS line is above its average);
* 12 QUIET stocks (``Q00`` .. ``Q11``): liquid, a 1% daily range, rating 50. They are
  in the liquid universe and the plain baseline and never qualify;
* a benchmark (``SPY``) and one symbol for each way of being left out.

What differs between scenarios is only the stored RATING SCORE, which is what the
Leader score's Strength part ranks:

* ``ordered``: the score rises with the drift on every session, so the top quintile is
  the eight fastest risers and the bottom the eight slowest (PASS);
* ``noise``: the score is reshuffled every session (FAIL);
* ``holdout_only``: reshuffled on development sessions, ordered on holdout sessions.

1,680 weekday sessions from 2019-06-03: 420 of bars alone, then 1,260 rated sessions
(1,008 development, 252 holdout). The development sessions cover 2021 to 2024, four
calendar years with over 40 formation dates each.
"""
from __future__ import annotations

import datetime as dt
import math
import random
import sqlite3

WARMUP = 420
RATED = 1260
HOLDOUT = 252
DEVELOPMENT = RATED - HOLDOUT
N = WARMUP + RATED
LEADERS = 40
QUIET = 12
BENCH_DRIFT = 0.0002
QUIET_DRIFT = 0.0003
START_PRICE = 20.0


def weekdays(n, start=dt.date(2019, 6, 3)):
    out, d = [], start
    while len(out) < n:
        if d.weekday() < 5:
            out.append(d)
        d += dt.timedelta(days=1)
    return out


DAYS = weekdays(N)
YMD = [d.year * 10000 + d.month * 100 + d.day for d in DAYS]
SESSIONS = [d.isoformat() for d in DAYS[WARMUP:]]          # the rated sessions, oldest first


def common(t: int) -> float:
    """The part of every symbol's daily change that all of them share."""
    return 0.0001 * math.sin(2 * math.pi * t / 97.0)


def leader_drift(i: int) -> float:
    return 0.0004 + 0.00004 * i


def closes(drift: float, start: float = START_PRICE, n: int = N, first: int = 0) -> list:
    out = [start]
    for t in range(first + 1, first + n):
        out.append(out[-1] * (1.0 + drift + common(t)))
    return out


def growth(drift: float, k: int, h: int) -> float:
    """``close[k + h] / close[k]`` for a symbol of that drift (``k`` a bar index)."""
    g = 1.0
    for t in range(k + 1, k + h + 1):
        g *= 1.0 + drift + common(t)
    return g


def bars(series, *, spread=0.02, volume=2_000_000, first=0):
    rows = []
    for n, c in enumerate(series):
        o = series[n - 1] if n else c
        rows.append((YMD[first + n], o, c * (1 + spread), c * (1 - spread), c, volume))
    return rows


def leader(i):
    return f"L{i:02d}"


def quiet(i):
    return f"Q{i:02d}"


def _scores(scenario: str, seed: int) -> dict:
    """``{session: {ticker: score}}`` for the leaders."""
    rng = random.Random(seed)
    ordered = {leader(i): 1.0 + 0.01 * i for i in range(LEADERS)}
    out = {}
    for n, s in enumerate(SESSIONS):
        shuffle = scenario == "noise" or (scenario == "holdout_only" and n < DEVELOPMENT)
        if shuffle:
            vals = list(ordered.values())
            rng.shuffle(vals)
            out[s] = dict(zip(ordered, vals))
        else:
            out[s] = dict(ordered)
    return out


FILLER_DRIFT = 0.0001


def filler(i):
    return f"F{i:03d}"


def build(directory, scenario: str = "ordered", *, seed: int = 11, extras: bool = True,
          weak_sessions=(), fillers: int = 0):
    """Write ``bars.db`` and ``screener.db`` under ``directory``; returns their paths.
    On the rated sessions at the positions in ``weak_sessions`` the faster half of the
    leaders is rated 70, so only 20 stocks qualify there.

    ``fillers`` adds that many slow symbols (``F000`` ..) to the BARS STORE ONLY, with no
    row today: the wider population a real rating is a percentile of. With 240 of them
    every leader's rating COMPUTED from the bars is 80 or more (the 40 leaders are the
    top of about 300 names), which is what the computed-ratings mode needs to form
    quintiles on this market."""
    assert scenario in ("ordered", "noise", "holdout_only"), scenario
    bars_db, screener_db = directory / "bars.db", directory / "screener.db"
    series = {"SPY": bars(closes(BENCH_DRIFT, 300.0), spread=0.005, volume=50_000_000)}
    classes = {"SPY": (1, "Exchange Traded Fund", "Funds")}
    for i in range(LEADERS):
        series[leader(i)] = bars(closes(leader_drift(i)))
        classes[leader(i)] = (0, "Leaders", "Growth")
    for i in range(QUIET):
        series[quiet(i)] = bars(closes(QUIET_DRIFT), spread=0.005)
        classes[quiet(i)] = (0, "Quiet", "Value")
    if extras:
        # each of these looks like the strongest leader and must still be left out
        strong = closes(leader_drift(LEADERS - 1))
        series["ETFX"] = bars(strong)
        classes["ETFX"] = (1, "Leaders", "Growth")              # an ETF
        series["UNKN"] = bars(strong)
        classes["UNKN"] = (None, "Leaders", "Growth")           # type unknown
        series["CHEAP"] = bars(closes(leader_drift(LEADERS - 1), start=0.2))
        classes["CHEAP"] = (0, "Leaders", "Growth")             # under $10 throughout
        series["THIN"] = bars(strong, volume=1_000)
        classes["THIN"] = (0, "Leaders", "Growth")              # under $20M a day
        series["NOLIST"] = bars(strong)                         # bars, but no row today
        classes["NOBARS"] = (0, "Leaders", "Growth")            # a row today, but no bars
    slow = bars(closes(FILLER_DRIFT), spread=0.005) if fillers else None
    for i in range(fillers):
        series[filler(i)] = slow
    with sqlite3.connect(str(bars_db)) as conn:
        conn.execute("CREATE TABLE ohlcv (ticker TEXT NOT NULL, tf TEXT NOT NULL, ts INTEGER NOT NULL, "
                     "o REAL, h REAL, l REAL, c REAL, v INTEGER, PRIMARY KEY (ticker, tf, ts)) WITHOUT ROWID")
        for t, rows in series.items():
            conn.executemany("INSERT INTO ohlcv VALUES (?, 'D', ?, ?, ?, ?, ?, ?)",
                             [(t, *r) for r in rows])
        conn.commit()
    scores = _scores(scenario, seed)
    with sqlite3.connect(str(screener_db)) as conn:
        # ONLY these four columns: a harness that read anything else of today's rows
        # (a price, a rating, a 1-month change) would fail on this table.
        conn.execute("CREATE TABLE screener_rows (ticker TEXT PRIMARY KEY, is_etf INTEGER, "
                     "industry TEXT, sector TEXT)")
        conn.executemany("INSERT INTO screener_rows VALUES (?, ?, ?, ?)",
                         [(t, *c) for t, c in classes.items()])
        conn.execute("CREATE TABLE rs_rating_history (session TEXT NOT NULL, ticker TEXT NOT NULL, "
                     "ibd INTEGER, score REAL, PRIMARY KEY (session, ticker))")
        rows = []
        weak = set(weak_sessions)
        for n, s in enumerate(SESSIONS):
            rows += [(s, t, 70 if (n in weak and int(t[1:]) >= 20) else 90, v)
                     for t, v in scores[s].items()]
            rows += [(s, quiet(i), 50, 0.5) for i in range(QUIET)]
            if extras:
                rows += [(s, t, 99, 9.0) for t in ("ETFX", "UNKN", "CHEAP", "THIN", "NOLIST")]
        conn.executemany("INSERT INTO rs_rating_history VALUES (?, ?, ?, ?)", rows)
        conn.commit()
    return bars_db, screener_db


def expected_spread(k_session: int, h: int = 21) -> float:
    """The ``ordered`` scenario's top minus bottom quintile, in percent, for the rated
    session at position ``k_session``: the eight fastest leaders' mean return minus the
    eight slowest's, from the next open (the formation close) to the close ``h``
    sessions on. The cost is the same on both sides and cancels."""
    return expected_spread_at(WARMUP + k_session, h)


def expected_spread_at(k: int, h: int = 21) -> float:
    """:func:`expected_spread` for the session at BAR position ``k`` (the computed
    mode's calendar is every bar date, not only the rated ones)."""
    top = sum(growth(leader_drift(i), k, h) for i in range(32, 40)) / 8
    bottom = sum(growth(leader_drift(i), k, h) for i in range(0, 8)) / 8
    return (top - bottom) * 100.0
