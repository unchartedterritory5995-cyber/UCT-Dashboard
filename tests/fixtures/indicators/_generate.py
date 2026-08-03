"""One-shot generator for the shared indicator golden fixtures.

Read ``_schema.md`` first. The short version:

* Bar series are deterministic — ``random.Random(seed)`` plus explicit
  hand-shaped ramps/plateaus — so this file reproduces its own output byte for
  byte on any machine.
* ``expected`` columns come from the PRECISE Python core
  (``indicator_compute.compute_case`` → the ``compute_*_raw`` functions), never
  from the rounding delivery wrappers.
* The two VWAP cases emit bars + a ``session`` block and **no** ``expected`` —
  they pin a session-boundary bug class, not a value.
* ``intraday5m_sessions`` owns no bars at all. It carries ``barsFrom`` — a
  repo-relative path to ``app/src/pages/parityBars/intraday5m.json``, the bar
  fixture the chart parity gate RENDERS — so the shared oracle and the picture
  are provably one series rather than two copies that can drift. Regenerating
  the parity fixture therefore turns this case red in BOTH lanes, which is the
  point: every parity number measured against those bars would have expired.

⛔ **This ran once and its output is committed.** Do not re-run it to "fix" a
failing fixture test: a regenerated fixture cannot fail, so re-running converts
a real regression into a green build. See ``_schema.md`` → "Regeneration is
banned".

Usage (only ever needed when ADDING a case, as a reviewed commit):
    python tests/fixtures/indicators/_generate.py
"""

from __future__ import annotations

import json
import os
import random
import sys
from datetime import datetime, timedelta, timezone

_OUT_DIR = os.path.dirname(os.path.abspath(__file__))
_REPO_ROOT = os.path.abspath(os.path.join(_OUT_DIR, "..", "..", ".."))
if _REPO_ROOT not in sys.path:
    sys.path.insert(0, _REPO_ROOT)

from api.services import indicator_compute as ic  # noqa: E402

REL_TOL = 1e-9

# 2026-06-01 00:00 UTC — an arbitrary but fixed anchor for the daily cases.
_DAILY_T0 = int(datetime(2026, 6, 1, tzinfo=timezone.utc).timestamp())
_DAY = 86400

# The bar fixture the CHART PARITY GATE renders (tools/chart_parity.py →
# `?fixedbars=intraday5m`). Repo-relative, POSIX separators: it is written into
# the fixture JSON and resolved by both lanes.
_PARITY_INTRADAY = "app/src/pages/parityBars/intraday5m.json"


# ─── bar builders ────────────────────────────────────────────────────────────

def _bar(t: int, close: float, rng: random.Random, spread: float, vol_base: int) -> dict:
    """One OHLCV bar around ``close``. Values are rounded to 4dp / int volume so
    the JSON round-trips to the identical IEEE-754 double in both lanes."""
    o = round(close - rng.uniform(-spread, spread), 4)
    h = round(max(o, close) + abs(rng.uniform(0, spread)), 4)
    l = round(min(o, close) - abs(rng.uniform(0, spread)), 4)
    return {
        "t": t,
        "o": o,
        "h": h,
        "l": l,
        "c": round(close, 4),
        "v": int(vol_base * rng.uniform(0.6, 1.6)),
    }


def build_mixed_series(seed: int = 20260801, n_lead: int = 40) -> list[dict]:
    """A 140-bar series shaped to exercise the interesting branches:

    quiet random walk → strong trend up (volatility expansion) → a 5-bar
    plateau of IDENTICAL typical prices (MFI's "neither PMF nor NMF" branch,
    and a zero-variance stretch for BB/CCI) → a sharp drop → recovery chop.
    """
    rng = random.Random(seed)
    bars: list[dict] = []
    t = _DAILY_T0
    price = 100.0

    for _ in range(n_lead):                      # quiet walk
        price += rng.uniform(-0.6, 0.6)
        bars.append(_bar(t, price, rng, 0.35, 1_200_000))
        t += _DAY

    for _ in range(30):                          # trend up, widening range
        price += 0.9 + rng.uniform(-0.35, 0.75)
        bars.append(_bar(t, price, rng, 0.9, 1_800_000))
        t += _DAY

    plateau = round(price, 4)                    # 5 identical bars
    for _ in range(5):
        bars.append({"t": t, "o": plateau, "h": plateau + 0.5,
                     "l": plateau - 0.5, "c": plateau, "v": 900_000})
        t += _DAY

    for _ in range(20):                          # sharp drop
        price -= 1.4 + rng.uniform(-0.5, 0.9)
        bars.append(_bar(t, price, rng, 1.1, 2_400_000))
        t += _DAY

    for _ in range(45):                          # recovery chop
        price += rng.uniform(-1.0, 1.25)
        bars.append(_bar(t, price, rng, 0.7, 1_400_000))
        t += _DAY

    return bars


def build_rsi_ramp(seed: int = 611) -> list[dict]:
    """Hand-shaped for RSI: a strictly monotonic 20-bar rise (every diff a gain,
    so ``avg_loss == 0`` and RSI pins at exactly 100 — the branch), then a
    strictly monotonic fall, then chop back through the middle.
    """
    rng = random.Random(seed)
    bars: list[dict] = []
    t = _DAILY_T0
    price = 50.0

    for _ in range(20):                          # every bar a gain → RSI == 100
        price += 0.75
        bars.append(_bar(t, price, rng, 0.2, 500_000))
        t += _DAY

    for _ in range(18):                          # every bar a loss
        price -= 0.9
        bars.append(_bar(t, price, rng, 0.25, 700_000))
        t += _DAY

    for i in range(32):                          # chop
        price += (0.8 if i % 3 else -1.1) + rng.uniform(-0.3, 0.3)
        bars.append(_bar(t, price, rng, 0.3, 600_000))
        t += _DAY

    return bars


# ─── VWAP session cases ──────────────────────────────────────────────────────
# Offsets are written literally rather than pulled from a tz database: the point
# of these cases is that the UTC/ET relationship CHANGES across the DST
# boundary, so hard-coding both offsets makes the trap visible in this file.

def _session_bars(et_date: str, utc_offset_h: int, et_hours: list[int],
                  prices: list[float], vols: list[int]) -> list[dict]:
    """Bars for one ET session day. ``utc_offset_h`` is ET's offset from UTC
    (-4 during EDT, -5 during EST)."""
    y, m, d = (int(x) for x in et_date.split("-"))
    out = []
    for et_h, px, vol in zip(et_hours, prices, vols):
        utc_dt = datetime(y, m, d, tzinfo=timezone.utc) + timedelta(hours=et_h - utc_offset_h)
        out.append({
            "t": int(utc_dt.timestamp()),
            "o": round(px, 4), "h": round(px + 0.20, 4),
            "l": round(px - 0.20, 4), "c": round(px, 4), "v": vol,
            # carried for the session block below, stripped before writing
            "_etDate": et_date, "_etHour": et_h,
        })
    return out


def _session_block(bars: list[dict]) -> dict:
    """Derive the session metadata + the ET-correct VWAP the fixture ships."""
    et_date = [b["_etDate"] for b in bars]
    et_hour = [b["_etHour"] for b in bars]
    utc_date = [datetime.fromtimestamp(b["t"], timezone.utc).strftime("%Y-%m-%d")
                for b in bars]

    def _resets(keys: list[str]) -> list[int]:
        out, prev = [], None
        for i, k in enumerate(keys):
            if k != prev:
                out.append(i)
                prev = k
        return out

    def _vwap(keys: list[str]) -> list[float]:
        out, cum_pv, cum_v, prev = [], 0.0, 0.0, None
        for b, k in zip(bars, keys):
            if k != prev:
                cum_pv, cum_v, prev = 0.0, 0.0, k
            tp = (b["h"] + b["l"] + b["c"]) / 3.0
            cum_pv += tp * b["v"]
            cum_v += b["v"]
            out.append(cum_pv / cum_v)
        return out

    return {
        "etDate": et_date,
        "etHour": et_hour,
        "utcDate": utc_date,
        "utcResetIndices": _resets(utc_date),
        "etResetIndices": _resets(et_date),
        "etSessionVwap": _vwap(et_date),
    }


def build_vwap_utc_midnight() -> list[dict]:
    """One EDT extended-hours session, 04:00 → 20:00 ET, hourly.

    EDT is UTC-4, so 20:00 ET == 00:00 UTC the NEXT day: the final bar of a
    single continuous session lands in a different UTC calendar day.
    """
    et_hours = list(range(4, 21))                        # 04:00 .. 20:00 ET
    # Pre-market drifts up into the cash session, then fades after the close;
    # the 20:00 ET print is deliberately far from the day's VWAP so a mid-session
    # reset is unmistakable in the numbers.
    prices = [180.0, 180.6, 181.2, 182.4, 184.0, 185.5, 186.2, 186.9, 187.4,
              188.1, 188.6, 189.0, 189.4, 189.9, 190.4, 191.0, 205.0]
    vols = [20_000, 25_000, 40_000, 90_000, 1_400_000, 900_000, 700_000,
            600_000, 550_000, 500_000, 520_000, 610_000, 780_000, 1_500_000,
            120_000, 60_000, 45_000]
    return _session_bars("2026-06-10", -4, et_hours, prices, vols)


def load_parity_intraday_bars() -> list[dict]:
    """The chart parity gate's INTRADAY bar fixture, read straight off disk.

    Not rebuilt here. ``tools/gen_intraday_fixture.py`` owns those bars; this
    case exists so the two compute lanes assert against *the exact series the
    chart draws*, and rebuilding them would defeat that in the most quietly
    convincing way possible.
    """
    path = os.path.join(_REPO_ROOT, *_PARITY_INTRADAY.split("/"))
    if not os.path.exists(path):
        raise SystemExit(
            f"{_PARITY_INTRADAY} is missing — run `python tools/gen_intraday_fixture.py` "
            f"first. This case has no bars of its own by design."
        )
    with open(path, encoding="utf-8") as f:
        bars = json.load(f)["bars"]
    assert bars, f"{_PARITY_INTRADAY} has no bars"
    assert all(isinstance(b["t"], int) for b in bars), (
        f"{_PARITY_INTRADAY} has a non-numeric `t`; VWAP's session bucketing needs real instants"
    )
    return bars


def _annotate_et(bars: list[dict]) -> list[dict]:
    """Attach ``_etDate``/``_etHour`` so ``_session_block`` can derive the ET
    bucketing. Unlike ``_session_bars`` (which BUILDS bars from a declared UTC
    offset) these timestamps already exist, so the tz database is the only
    authority available — and a missing one must be fatal, never a silent
    fallback that writes a fixture pinning the wrong boundary."""
    try:
        import zoneinfo
        et = zoneinfo.ZoneInfo("America/New_York")
    except Exception as e:  # noqa: BLE001
        raise SystemExit(
            "no tz database available (pip install tzdata). Deriving the ET session "
            "bucketing without one would write a fixture that pins the wrong boundary."
        ) from e
    out = []
    for b in bars:
        d = datetime.fromtimestamp(b["t"], et)
        out.append({**b, "_etDate": d.strftime("%Y-%m-%d"), "_etHour": d.hour})
    return out


def build_vwap_dst_transition() -> list[dict]:
    """Two extended-hours sessions with the SAME wall-clock shape, straddling
    the end of US DST (Sun 2026-11-01).

    Fri 2026-10-30 is EDT (UTC-4) → UTC midnight falls at 20:00 ET.
    Mon 2026-11-02 is EST (UTC-5) → UTC midnight falls at 19:00 ET.

    Same session, same hours, different split point. That difference is the
    whole assertion: the boundary today's code uses is a function of the
    timezone offset, not of the trading session.
    """
    et_hours = [16, 17, 18, 19, 20]
    friday = _session_bars(
        "2026-10-30", -4, et_hours,
        [412.0, 413.5, 414.2, 415.0, 428.0],
        [2_000_000, 300_000, 180_000, 120_000, 90_000],
    )
    monday = _session_bars(
        "2026-11-02", -5, et_hours,
        [421.0, 422.4, 423.1, 424.0, 437.5],
        [2_100_000, 310_000, 190_000, 125_000, 95_000],
    )
    return friday + monday


# ─── writer ──────────────────────────────────────────────────────────────────

def _write(payload: dict, n_bars: int | None = None) -> None:
    path = os.path.join(_OUT_DIR, f"{payload['case']}.json")
    with open(path, "w", encoding="utf-8") as f:
        # allow_nan=False: a NaN/inf leaking into a column must FAIL generation,
        # not be written as JSON that no strict parser will read back.
        json.dump(payload, f, indent=2, allow_nan=False)
        f.write("\n")
    n_cols = len(payload.get("expected") or {})
    n = len(payload["bars"]) if "bars" in payload else n_bars
    where = "" if "bars" in payload else f" from {payload['barsFrom']}"
    print(f"wrote {path}  ({n} bars{where}, {n_cols} expected columns)")


def _write_computed(case: str, kind: str, note: str, bars: list[dict], params: dict) -> None:
    expected = ic.compute_case(kind, bars, params)
    cols = ic.case_columns(kind)
    assert set(expected) == set(cols), f"{case}: column mismatch {set(expected)} != {set(cols)}"
    for col, series in expected.items():
        assert len(series) == len(bars), f"{case}.{col} not aligned to bars"
        assert any(v is not None for v in series), (
            f"{case}.{col} is entirely null — the series is too short to compute "
            f"anything, so this fixture would assert nothing"
        )
    _write({
        "case": case, "kind": kind, "note": note, "params": params,
        "relTol": REL_TOL, "bars": bars,
        "expected": {c: expected[c] for c in cols},
    })


def _write_vwap(case: str, note: str, bars: list[dict]) -> None:
    session = _session_block(bars)
    clean = [{k: v for k, v in b.items() if not k.startswith("_")} for b in bars]
    assert len(session["utcResetIndices"]) > len(session["etResetIndices"]), (
        f"{case}: UTC bucketing must split the tape MORE often than ET bucketing "
        f"or the case pins nothing"
    )
    _write({
        "case": case, "kind": "vwap", "note": note, "params": {},
        "relTol": REL_TOL, "bars": clean, "expected": None, "session": session,
    })


def _write_referenced(case: str, kind: str, note: str, bars_from: str,
                      bars: list[dict], params: dict) -> None:
    """A case that OWNS NO BARS: ``barsFrom`` names the file that does.

    Written for ``intraday5m_sessions``, whose bars are the chart parity gate's
    own intraday fixture. Two things fall out of the indirection and both are
    the reason for it:

      * the oracle and the rendered picture cannot drift apart, because there is
        only one copy of the series;
      * regenerating the parity fixture turns the ``expected`` columns red in
        BOTH lanes — which is exactly what should happen, because every parity
        number ever measured against those bars has just expired.

    It carries an ``expected`` block (so the 1e-9 rel-tol rule applies to it like
    any other case) AND a ``session`` block (so the UTC-vs-ET bucketing structure
    of those same bars is pinned in both lanes, not just in the vitest-only
    fixture test that sits next to the parity JSON).
    """
    expected = ic.compute_case(kind, bars, params)
    cols = ic.case_columns(kind)
    assert set(expected) == set(cols), f"{case}: column mismatch {set(expected)} != {set(cols)}"
    for col, series in expected.items():
        assert len(series) == len(bars), f"{case}.{col} not aligned to bars"
        assert any(v is not None for v in series), f"{case}.{col} is entirely null"
    session = _session_block(_annotate_et(bars))
    # The whole reason this case is on INTRADAY EXTENDED-HOURS bars. A series
    # where the two bucketings agree pins nothing, and would let B3 Task 8's
    # VWAP gate report the same number whether the bug survived or not.
    assert len(session["utcResetIndices"]) > len(session["etResetIndices"]), (
        f"{case}: UTC bucketing must split the tape MORE often than ET bucketing"
    )
    carried = [i for i in session["etResetIndices"] if i not in session["utcResetIndices"]]
    assert carried, (
        f"{case}: no ET session opens INSIDE a UTC day, so the carry-over — a whole "
        f"session computed on top of the previous evening's post-market volume — is "
        f"absent, and this case is just a second copy of vwap_dst_transition"
    )
    _write({
        "case": case, "kind": kind, "note": note, "params": params,
        "relTol": REL_TOL, "barsFrom": bars_from,
        "expected": {c: expected[c] for c in cols},
        "session": session,
    }, n_bars=len(bars))


def main() -> None:
    mixed = build_mixed_series()

    _write_computed(
        "rsi_ramp_14", "rsi",
        "Monotonic rise (every diff a gain → avg_loss == 0 → RSI pins at exactly "
        "100, the branch), then a monotonic fall, then chop back through 50.",
        build_rsi_ramp(), {"period": 14},
    )
    _write_computed(
        "macd_default", "macd",
        "Default 12/26/9 over a trend-then-reversal series, so the histogram "
        "crosses zero in both directions — the sign flip is where a rounding "
        "difference between the lanes would show up first.",
        mixed, {"fast": 12, "slow": 26, "signal": 9},
    )
    _write_computed(
        "bb_20_2", "bb",
        "20/2 over a volatility expansion, a 5-bar zero-variance plateau and a "
        "sharp drop — population std-dev (divide by N), which is what both "
        "lanes implement and standard textbook BB does not.",
        mixed, {"period": 20, "stddev": 2.0},
    )
    _write_computed(
        "stoch_14_3", "stoch",
        "14/3 fast %K + %D. Pins the alignment the JS lane used to get wrong: "
        "%K and %D came back as DIFFERENT lengths, so nothing downstream could "
        "index them together.",
        mixed, {"k_period": 14, "d_period": 3},
    )
    _write_computed(
        "williams_r_14", "williams_r",
        "14-period %R over the same series; bounded [-100, 0] and touches the "
        "top of the range on the plateau.",
        mixed, {"period": 14},
    )
    _write_computed(
        "cci_20", "cci",
        "20-period CCI. Crosses zero repeatedly, which is why the tolerance "
        "rule needs its absolute floor as well as the relative term.",
        mixed, {"period": 20},
    )
    _write_computed(
        "mfi_14", "mfi",
        "14-period MFI with real volume variation and a 5-bar plateau of "
        "IDENTICAL typical prices — the 'neither PMF nor NMF' branch that a "
        "smooth synthetic series never reaches.",
        mixed, {"period": 14},
    )

    _write_vwap(
        "vwap_extended_hours_utc_midnight",
        "One EDT extended-hours session 04:00-20:00 ET. 20:00 ET is 00:00 UTC "
        "the next day, so UTC-day bucketing restarts the cumulative VWAP on the "
        "last bar of a session that never ended.",
        build_vwap_utc_midnight(),
    )
    _write_vwap(
        "vwap_dst_transition",
        "Two identically-shaped 16:00-20:00 ET sessions either side of the end "
        "of US DST. EDT splits at 20:00 ET, EST splits at 19:00 ET — the "
        "boundary tracks the UTC offset, not the trading session.",
        build_vwap_dst_transition(),
    )

    _write_referenced(
        "intraday5m_sessions", "mfi",
        "The CHART PARITY GATE's intraday bar fixture, asserted by both lanes. Its bars "
        "live in app/src/pages/parityBars/intraday5m.json (this case carries `barsFrom`, "
        "not a copy) — 579 five-minute extended-hours bars over Fri 2025-10-31 (EDT), "
        "Mon 2025-11-03 and Tue 2025-11-04 (EST). The `expected` column is MFI(14), "
        "chosen because MFI is the only indicator BOTH lanes implement that is built "
        "from typical price TIMES VOLUME — the same arithmetic VWAP is, so agreement at "
        "1e-9 here is agreement about the sums VWAP will be measured on. The `session` "
        "block pins what makes these bars worth rendering: UTC-day bucketing splits the "
        "EDT session at 20:00 ET and the EST sessions at 19:00 ET, which also means "
        "Tue 04:00 ET is NOT a UTC-day boundary and its whole session accumulates on top "
        "of Monday evening's post-market volume.",
        _PARITY_INTRADAY, load_parity_intraday_bars(), {"period": 14},
    )

    print("\nDone — 10 fixtures written. Do NOT re-run this to fix a red test.")


if __name__ == "__main__":
    main()
