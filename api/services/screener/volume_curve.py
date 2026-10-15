"""The market-wide TIME-OF-DAY VOLUME CURVE behind "volume vs usual by now".

Design: ``docs/superpowers/specs/2026-10-15-screener-live-relative-volume-design.md``
(approach A, approved 2026-10-15).

ONE SENTENCE: each night, from the 5-minute bars already stored for the most liquid
names, learn what share of a regular session's volume is typically done by each minute
after the open, so that intraday

    rvol_live = today_vol / (avg_volume_30d * share(minute_now))

reads about 3x for a name trading three times its usual pace at 10:00, at 13:00 and at
the close alike. Today's volume over a full-day average (approach C) reads ~0.8x at
10:00 for that same name, which is the failure this exists to remove.

WHAT THE CURVE IS, PRECISELY
----------------------------
* ``curve[m]`` for ``m = 0..390`` is the median, over (ticker, session) samples, of the
  cumulative share of that session's REGULAR-SESSION volume done by minute ``m`` after
  09:30 ET. Knots are the 5-minute bar boundaries (a bar stamped 09:30 is done by minute
  5); minutes between knots are linear.
* Forced monotonic (a running maximum: medians of cumulative shares can dip by a hair
  across slots) and pinned ``curve[0] = 0.0``, ``curve[390] = 1.0``.
* Built from FULL sessions only. A half-day, a holiday or a session missing any of its
  78 regular-session 5-minute bars contributes nothing; today's developing session is
  never read (the anchor contract, ``live_tier`` module docstring).

⚠️ KNOWN APPROXIMATIONS, stated rather than hidden. The share is of the regular-session
5-minute bars; the denominator ``avg_volume_30d`` is a daily-bar mean, and the live
numerator ``today_vol`` comes from the full-market snapshot. Premarket prints and the
closing cross sit on different sides of that line, so a name with heavy premarket
volume reads a little high early and the last minutes read a little high before the
cross prints. One U-shaped curve for every stock is approach A's stated weakness;
per-stock curves (approach B) are the next step and use the same column.

STORAGE: one small side table in ``screener.db``, created on first write (the
``snapshot_db.record_build_run`` pattern), newest ``KEEP`` rows kept. A night that
cannot assemble ``MIN_SAMPLES`` samples writes NOTHING and the previous curve stands.
"""
from __future__ import annotations

import json
import logging
import time
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

from api.services.screener import snapshot_db

log = logging.getLogger(__name__)

ET = ZoneInfo("America/New_York")

TABLE = "screener_volume_curve"
KEEP = 30

#: A regular session's length in minutes, and the 5-minute bars inside it.
FULL_SESSION_MIN = 390
BAR_MIN = 5
BARS_PER_SESSION = FULL_SESSION_MIN // BAR_MIN          # 78

#: How many completed full sessions the nightly reads back.
SESSIONS = 20
#: How many of the most liquid snapshot names are sampled (those with 5-min history).
TOP_N = 300
#: ⛔ Below this many (ticker, session) samples the night REFUSES and keeps the previous
#: curve. 50 names x 10 sessions: a median over fewer is a number about a handful of days.
MIN_SAMPLES = 500

#: ⭐ The first 15 minutes are suppressed: the curve's share there is a few percent and
#: the ratio swings wildly, so the column reads blank ("too early") rather than 40x.
SUPPRESS_FIRST_MIN = 15

_SQL = f"""
CREATE TABLE IF NOT EXISTS {TABLE} (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    built_at REAL NOT NULL,
    first_session INTEGER, last_session INTEGER,
    sessions INTEGER, tickers INTEGER, samples INTEGER,
    curve TEXT NOT NULL
)"""


# --------------------------------------------------------------------------- #
# pure arithmetic
# --------------------------------------------------------------------------- #

def _median(xs: list) -> float:
    s = sorted(xs)
    n = len(s)
    mid = n // 2
    return s[mid] if n % 2 else (s[mid - 1] + s[mid]) / 2.0


def session_shares(volumes: list) -> list | None:
    """The cumulative share at each 5-minute knot (``0..78``) for ONE full session's 78
    bar volumes, or ``None`` when the session traded nothing (no share to take)."""
    if len(volumes) != BARS_PER_SESSION:
        return None
    total = float(sum(volumes))
    if not total > 0:
        return None
    out, run = [0.0], 0.0
    for v in volumes:
        run += float(v)
        out.append(run / total)
    return out


def build_curve(samples: list) -> list | None:
    """Minute-resolution curve (``391`` floats) from per-session knot lists.

    Median per knot, then a running maximum (monotonic), pinned to 0 at the open and 1
    at the close, then linear between knots. ``None`` for no samples."""
    if not samples:
        return None
    knots = [_median([s[k] for s in samples]) for k in range(BARS_PER_SESSION + 1)]
    mono, hi = [], 0.0
    for v in knots:
        hi = max(hi, min(1.0, max(0.0, v)))
        mono.append(hi)
    mono[0], mono[-1] = 0.0, 1.0
    curve = []
    for m in range(FULL_SESSION_MIN + 1):
        k, r = divmod(m, BAR_MIN)
        if k >= BARS_PER_SESSION:
            curve.append(1.0)
            continue
        a, b = mono[k], mono[k + 1]
        curve.append(round(a + (b - a) * r / BAR_MIN, 6))
    return curve


def share_at(curve, minutes_elapsed: float, session_minutes: int = FULL_SESSION_MIN):
    """The usual share of the day's volume done ``minutes_elapsed`` after the open.

    ⭐ AN EARLY-CLOSE DAY SCALES TO ITS OWN LENGTH: minute ``m`` of a 210-minute session
    reads the curve at ``m * 390 / 210``, so the share still reaches 1.0 at that day's
    close. ``None`` before ``SUPPRESS_FIRST_MIN``, for an unusable curve, or a
    non-positive share — a blank, never a guess."""
    if not curve or len(curve) != FULL_SESSION_MIN + 1 or not session_minutes:
        return None
    if minutes_elapsed is None or minutes_elapsed < SUPPRESS_FIRST_MIN:
        return None
    m = min(float(minutes_elapsed), float(session_minutes))
    x = m * FULL_SESSION_MIN / float(session_minutes)
    i = int(x)
    if i >= FULL_SESSION_MIN:
        v = float(curve[FULL_SESSION_MIN])
    else:
        v = float(curve[i]) + (float(curve[i + 1]) - float(curve[i])) * (x - i)
    return v if v > 0 else None


def rvol(today_vol, avg_volume_30d, share):
    """``today_vol / (avg_volume_30d * share)``, 2 dp, or ``None`` when any input is
    missing or non-positive. ⛔ A zero average is not "infinitely heavy"."""
    try:
        tv, av, sh = float(today_vol), float(avg_volume_30d), float(share)
    except (TypeError, ValueError):
        return None
    if not (tv > 0 and av > 0 and sh > 0):
        return None
    return round(tv / (av * sh), 2)


# --------------------------------------------------------------------------- #
# the session clock — the repo's calendar, never a second one
# --------------------------------------------------------------------------- #

def session_window(d: date):
    """``(open_min, close_min)`` minutes-of-day ET for trading day ``d``, or ``None``.
    Derived from ``session_calendar`` (13:00 on a half-day)."""
    from api.services import session_calendar as sc
    if not sc.is_trading_day(d):
        return None
    cal = sc.calendar()
    close = sc.close_time(d)
    if close is None:
        return None
    return cal.open_min, close.hour * 60 + close.minute


def live_share(now_et: datetime, curve) -> float | None:
    """The share to divide by at instant ``now_et``, or ``None`` (not a session day,
    before 09:45 ET, no curve)."""
    if curve is None or now_et is None:
        return None
    et = now_et.astimezone(ET) if now_et.tzinfo else now_et.replace(tzinfo=ET)
    win = session_window(et.date())
    if win is None:
        return None
    open_min, close_min = win
    elapsed = et.hour * 60 + et.minute + et.second / 60.0 - open_min
    if elapsed < 0:
        return None
    return share_at(curve, elapsed, close_min - open_min)


def full_sessions_before(today: date, n: int = SESSIONS) -> list:
    """The ``n`` most recent FULL trading days strictly before ``today``, oldest first.
    ⛔ Half-days and holidays are skipped, never scaled into the sample."""
    from api.services import session_calendar as sc
    out, d = [], today - timedelta(days=1)
    guard = 0
    while len(out) < n and guard < n * 3 + 30:
        if sc.is_trading_day(d) and not sc.is_half_day(d):
            out.append(d)
        d -= timedelta(days=1)
        guard += 1
    return sorted(out)


def _rth_open_epoch(d: date) -> int:
    return int(datetime(d.year, d.month, d.day, 9, 30, tzinfo=ET).timestamp())


def samples_from_bars(bars, sessions: list) -> list:
    """Per-session knot lists from ONE ticker's 5-minute bars ``(ts, o, h, l, c, v)``.

    ``ts`` is unix seconds at the bar's START (``bars_sqlite`` docstring). A session
    counts only when all 78 regular-session bars are present on the 5-minute grid —
    a partial session (a gap in the store, a halt) is dropped, never padded."""
    if not bars or not sessions:
        return []
    by_ts = {}
    for b in bars:
        try:
            by_ts[int(b[0])] = float(b[5] or 0)
        except (TypeError, ValueError, IndexError):
            continue
    out = []
    for d in sessions:
        t0 = _rth_open_epoch(d)
        vols = []
        for k in range(BARS_PER_SESSION):
            v = by_ts.get(t0 + k * BAR_MIN * 60)
            if v is None:
                break
            vols.append(v)
        shares = session_shares(vols)
        if shares is not None:
            out.append(shares)
    return out


# --------------------------------------------------------------------------- #
# storage
# --------------------------------------------------------------------------- #

def store(curve: list, *, first_session: int, last_session: int, sessions: int,
          tickers: int, samples: int, built_at: float | None = None) -> None:
    with snapshot_db.connect() as conn:
        conn.execute(_SQL)
        conn.execute(
            f"INSERT INTO {TABLE} (built_at, first_session, last_session, sessions, "
            "tickers, samples, curve) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (time.time() if built_at is None else built_at, first_session,
             last_session, sessions, tickers, samples, json.dumps(curve)))
        conn.execute(
            f"DELETE FROM {TABLE} WHERE id NOT IN (SELECT id FROM {TABLE} "
            "ORDER BY id DESC LIMIT ?)", (KEEP,))
        conn.commit()


def latest() -> dict | None:
    """The newest stored curve with its provenance, or ``None``. Never raises.
    Read-only: no table yet (no night has stored one) reads as ``None``."""
    try:
        with snapshot_db.connect() as conn:
            r = conn.execute(
                f"SELECT * FROM {TABLE} ORDER BY id DESC LIMIT 1").fetchone()
    except Exception:                                       # noqa: BLE001
        return None
    if r is None:
        return None
    d = dict(r)
    try:
        curve = json.loads(d.get("curve") or "null")
    except (TypeError, ValueError):
        return None
    if not isinstance(curve, list) or len(curve) != FULL_SESSION_MIN + 1:
        return None
    d["curve"] = [float(x) for x in curve]
    return d


def latest_curve() -> list | None:
    rec = latest()
    return rec["curve"] if rec else None


#: (key, expires_at, payload) of the one cached client payload. Keyed by the DB path
#: and the ET date so a new session's window, or a new night's curve within the TTL
#: of a pod that just rebuilt, is never served for long.
_PAYLOAD_CACHE: list = []
PAYLOAD_TTL_S = 600


def client_payload(now_et: datetime | None = None) -> dict:
    """What the chart header needs to compute the same ``rvol_live`` the screener
    shows: the stored curve (4 dp), its provenance, today's ET session window and the
    suppression constant. One small GET for every chart, never a per-ticker call.

    ``curve`` is ``None`` when no night has stored one, and ``session`` is ``None`` on
    a non-trading day; either makes the header read blank, which is the agreed
    behaviour."""
    now_et = now_et or datetime.now(ET)
    d = now_et.astimezone(ET).date() if now_et.tzinfo else now_et.date()
    key = (snapshot_db.get_db_path(), d.isoformat())
    if _PAYLOAD_CACHE and _PAYLOAD_CACHE[0] == key and _PAYLOAD_CACHE[1] > time.time():
        return _PAYLOAD_CACHE[2]
    rec = latest()
    win = session_window(d)
    out = {
        "curve": [round(x, 4) for x in rec["curve"]] if rec else None,
        "first_session": rec.get("first_session") if rec else None,
        "last_session": rec.get("last_session") if rec else None,
        "samples": rec.get("samples") if rec else None,
        "tickers": rec.get("tickers") if rec else None,
        "built_at": rec.get("built_at") if rec else None,
        "session": ({"date": d.isoformat(), "open_min": win[0], "close_min": win[1]}
                    if win else None),
        "suppress_first_min": SUPPRESS_FIRST_MIN,
        "full_session_min": FULL_SESSION_MIN,
    }
    _PAYLOAD_CACHE[:] = [key, time.time() + PAYLOAD_TTL_S, out]
    return out


# --------------------------------------------------------------------------- #
# the nightly
# --------------------------------------------------------------------------- #

def liquid_tickers(limit: int = TOP_N) -> list:
    """The most liquid non-ETF names in the snapshot, by 30-day dollar volume."""
    with snapshot_db.connect() as conn:
        rows = conn.execute(
            "SELECT ticker FROM screener_rows WHERE dollar_vol_30d > 0 "
            "AND COALESCE(is_etf, 0) = 0 ORDER BY dollar_vol_30d DESC LIMIT ?",
            (int(limit),)).fetchall()
    return [r["ticker"] for r in rows]


def build_nightly(today: date | None = None, tickers: list | None = None,
                  get_bars_since=None) -> dict:
    """Build and store tonight's curve. Returns a receipt; never raises for a data
    condition. ⛔ Too few samples ⇒ ``stored=False`` and the previous curve stands."""
    t0 = time.time()
    today = today or datetime.now(ET).date()
    sessions = full_sessions_before(today, SESSIONS)
    receipt = {"stored": False, "reason": None, "sessions": len(sessions),
               "first_session": None, "last_session": None, "tickers_considered": 0,
               "tickers_sampled": 0, "samples": 0, "duration_ms": 0.0}
    if not sessions:
        receipt["reason"] = "no_sessions"
        return receipt
    receipt["first_session"] = int(sessions[0].strftime("%Y%m%d"))
    receipt["last_session"] = int(sessions[-1].strftime("%Y%m%d"))
    if get_bars_since is None:
        from api.services import bars_sqlite
        get_bars_since = bars_sqlite.get_bars_since
    names = tickers if tickers is not None else liquid_tickers()
    receipt["tickers_considered"] = len(names)
    since = _rth_open_epoch(sessions[0]) - 1
    samples, sampled = [], 0
    for t in names:
        try:
            bars = get_bars_since(t, "5", since) or []
        except Exception:                                   # noqa: BLE001
            continue
        got = samples_from_bars(bars, sessions)
        if got:
            sampled += 1
            samples.extend(got)
    receipt["tickers_sampled"] = sampled
    receipt["samples"] = len(samples)
    if len(samples) < MIN_SAMPLES:
        receipt["reason"] = f"too_few_samples<{MIN_SAMPLES}"
    else:
        curve = build_curve(samples)
        store(curve, first_session=receipt["first_session"],
              last_session=receipt["last_session"], sessions=len(sessions),
              tickers=sampled, samples=len(samples))
        receipt["stored"] = True
        receipt["share_at_10_00"] = curve[30]
        receipt["share_at_12_00"] = curve[150]
        receipt["share_at_15_00"] = curve[330]
    receipt["duration_ms"] = round((time.time() - t0) * 1000, 1)
    return receipt


def nightly_job() -> dict:
    """The scheduled entry point (after the snapshot build). Logs its receipt and never
    raises: a curve that cannot be built must not cost the build it follows."""
    try:
        r = build_nightly()
    except Exception as e:                                  # noqa: BLE001
        log.warning("[screener] volume curve build failed: %s: %s", type(e).__name__, e)
        return {"stored": False, "reason": f"error: {type(e).__name__}: {e}"}
    if r.get("stored"):
        log.info("[screener] volume curve stored: %s", r)
    else:
        log.warning("[screener] volume curve NOT stored (previous curve kept): %s", r)
    return r
