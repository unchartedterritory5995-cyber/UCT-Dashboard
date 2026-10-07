"""The technical fingerprint of a chart: the ONE authority (wave 13, lane 13I-1).

A chart block in a note names a symbol and a day. Its fingerprint is what the
chart looked like on that day, in the screener's own vocabulary: ADR%, distance
from the 10/20/50/200-day averages, the MA stack, RS rank and the RS-line trend,
the base's length and depth, volume dry-up, tightness (close CV), the prior run
(pole %) and the pattern engine's confirmed detections. 13I-2 (the panel, the
checklist autofill and the visual playbook's filters) and 13J (find more like
this) read it from here and nowhere else.

⛔⛔ REUSED, NEVER RE-DERIVED. Every number below is produced by the function the
nightly screener row is built from (`snapshot_builder.build_row`), called on the
same sanitized bars. This module selects, labels and dates those outputs; it
contains no indicator arithmetic of its own. The one field the screener does not
store, the distance from the 10-day average, is the screener's own two helpers
(`technicals._sma`, `technicals._pct`) at a 10-bar window: the same composition
`compute_technicals` uses for the 20, 50 and 200. The rail
`tests/test_notebook_tech_fingerprint.py` imports the screener functions and
asserts equality, and two of its formulas are mutation-proved.

  field                  source (file:function)
  adr_pct                screener/technicals.py:compute_technicals (`adr_pct`)
  pct_vs_sma10           screener/technicals.py:_sma + _pct (10-bar window)
  pct_vs_sma20/50/200    screener/technicals.py:compute_technicals (`pct_vs_sma*`)
  ma_stack               screener/technicals.py:compute_technicals (`ma_stack`)
  ema_stack_intact       screener/setup_score.py:compute (the scanner's MA-stack-intact)
  rs_rank                screener_rows.rs_rank (written by snapshot_builder.rs_fields
                         from rs_ranking.compute_rs_scores); the LATEST nightly only
  rs_line_trend          screener/technicals.py:rs_line_trend (vs SPY)
  base_length_bars,      screener/base_catalog.py:flat_base_state (`bars`, `depth`)
  base_depth_pct
  pullback_depth_pct     screener/candles.py:multi_candle (`pullback_depth_pct`)
  vol_nweek_low          screener/setup_score.py:compute (`vol_nweek_low`)
  close_cv_pct           screener/candles.py:multi_candle (`close_cv_pct`)
  pole_pct               screener/technicals.py:_pole_pct (via compute_technicals)
  patterns               pattern_vision/store.py:get_confirmed -- the confirmed-only
                         read `GET /api/patterns/{sym}` serves by default

TWO WAYS TO ANSWER, ONE AS-OF FOR EVERY FIELD.

  * ``nightly``: the requested day is covered by the nightly `screener_rows` row
    (its `bars_asof` is the last completed session on or before the day). Every
    column the row holds is READ from it, so the fingerprint says exactly what the
    Screener says; the two fields the row does not hold (`pct_vs_sma10`, the base)
    are computed on the stored bars cut at the row's own `bars_asof`.
  * ``bars``: any other day. Every field is computed by the same functions on the
    stored daily bars up to and including that day, and nothing after it.
    `rs_rank` is a cross-sectional nightly rank and only the latest nightly is
    kept, so a past day reads it as NOT AVAILABLE rather than borrowing today's.

⛔ MISSING IS LABELLED, NEVER INVENTED. Each field is
``{"value": ..., "source": ..., "missing": None | <code>}``; a field with a
``missing`` code has ``value: None``. The codes are `MISSING_REASONS`.

⛔ THE PATTERN ENGINE IS READ-ONLY HERE, AND CONFIRMED-ONLY. The pattern lab is
paused (owner, 2026-09-07); this module never calls a detector, never writes the
pattern stores (it does not even run their `init_db`), and never reads the raw
rule-engine detections. Confirmed verdicts are served for the current window
only (`get_confirmed`'s own seven-day bound), so a day before that window reads
`patterns` as NOT AVAILABLE.

⛔ NO MODEL CALL, NO VENDOR CALL. Bars come from `bars_sqlite` (the local store)
and nothing here can reach a provider.
"""
from __future__ import annotations

import datetime as _dt
import logging
import math
from typing import Any, Callable

from api.services.journal_two.timeutil import ET
from api.services.notebook_flags import flag_on

log = logging.getLogger(__name__)

#: The enablement gate for the fingerprint routes (unset = OFF; plan section 3.6).
FLAG = "NOTEBOOK_TA_FINGERPRINT_ENABLED"


def enabled() -> bool:
    """The gate, read PER CALL through the one Notebook flag parse (default OFF)."""
    return flag_on(FLAG, False)


#: Bumped only if a field's MEANING changes. A frozen fingerprint keeps the
#: version it was computed under, so a reader can tell old meaning from new.
FINGERPRINT_VERSION = 1

#: The screener's working window (`snapshot_builder.build_row`: "the RAW last-400
#: sessions, sanitized ALONE"). The same window here keeps every lookback equal.
BARS_WINDOW = 400

#: SPY closes for the RS line: `snapshot_builder._read_spy_closes` reads 60.
SPY_WINDOW = 60

#: Without bars, how many calendar days a nightly row may lag the requested day
#: and still be "the last completed session" (a weekend plus a holiday).
NIGHTLY_MAX_LAG_DAYS = 4

#: The fields, in display order. `patterns` is a list; every other value is a
#: scalar.
FIELDS = (
    "adr_pct",
    "pct_vs_sma10", "pct_vs_sma20", "pct_vs_sma50", "pct_vs_sma200",
    "ma_stack", "ema_stack_intact",
    "rs_rank", "rs_line_trend",
    "base_length_bars", "base_depth_pct", "pullback_depth_pct",
    "vol_nweek_low", "close_cv_pct", "pole_pct",
    "patterns",
)

#: The `missing` codes. Each is a statement about the DATA, never a default.
MISSING_REASONS = {
    "no_bars": "no stored daily bars on or before the day",
    "not_enough_history": "too few sessions for this window",
    "series_contradicts_itself": "withheld by the screener: the bar series reverses "
                                 "itself inside this window",
    "no_flat_base": "no flat base ends at this day (base_catalog.flat_base_state found none)",
    "no_benchmark": "no SPY bars for the RS line",
    "rank_is_nightly_only": "RS rank is a nightly universe rank and only the latest "
                            "nightly is kept; a past day has none",
    "not_in_screener_row": "the nightly row holds no value for this column",
    "patterns_current_window_only": "confirmed pattern verdicts are kept for the "
                                    "current seven-day window only",
    "patterns_unavailable": "the confirmed-pattern store could not be read",
}

# The screener columns read straight off a nightly row (the rest are computed).
_ROW_COLUMNS = (
    "adr_pct", "pct_vs_sma20", "pct_vs_sma50", "pct_vs_sma200", "ma_stack",
    "ema_stack_intact", "rs_rank", "rs_line_trend", "pullback_depth_pct",
    "vol_nweek_low", "close_cv_pct", "pole_pct",
)

# Fields computed from bars in BOTH modes (the row does not store them).
_BARS_ONLY = ("pct_vs_sma10", "base_length_bars", "base_depth_pct")


class FingerprintRequestError(ValueError):
    """A request the caller must fix (a bad symbol or day)."""


# ── small helpers ─────────────────────────────────────────────────────────────

def _field(value: Any, source: str, missing: str | None = None) -> dict:
    if missing is not None:
        return {"value": None, "source": source, "missing": missing}
    return {"value": value, "source": source, "missing": None}


def _ymd_to_iso(t: Any) -> str | None:
    s = str(t or "").strip()
    if len(s) >= 8 and s[:8].isdigit():
        return f"{s[:4]}-{s[4:6]}-{s[6:8]}"
    try:
        return _dt.date.fromisoformat(s[:10]).isoformat()
    except ValueError:
        return None


def _iso_to_ymd(iso: str) -> int:
    return int(iso.replace("-", ""))


def today_et() -> str:
    return _dt.datetime.now(ET).date().isoformat()


def normalize_symbol(symbol: Any) -> str:
    s = (symbol or "").strip().upper() if isinstance(symbol, str) else ""
    if not s or len(s) > 12 or not all(c.isalnum() or c in ".-" for c in s):
        raise FingerprintRequestError("A chart's symbol is letters, digits, '.' or '-', up to 12.")
    return s


def normalize_as_of(as_of: Any) -> str:
    """'YYYY-MM-DD', or today in ET when absent. A future day is refused."""
    if as_of in (None, ""):
        return today_et()
    try:
        d = _dt.date.fromisoformat(str(as_of).strip()[:10])
    except ValueError:
        raise FingerprintRequestError("The day is a date written YYYY-MM-DD.") from None
    if d.isoformat() > today_et():
        raise FingerprintRequestError("A fingerprint is never computed for a day that has not happened.")
    return d.isoformat()


# ── readers (the only IO; tests replace these) ────────────────────────────────

#: Missing codes that describe a READ FAILURE rather than the data. A fingerprint
#: carrying one is served live but never frozen (`chart_blocks.freeze` retries).
TRANSIENT_MISSING = frozenset({"patterns_unavailable"})


def _absent_if_no_table(fn: Callable[[], Any], absent: Any) -> Any:
    """`fn()`, or `absent` when its store has no such table yet (a pod where the
    store was never built holds no rows). Every other error propagates."""
    import sqlite3
    try:
        return fn()
    except sqlite3.OperationalError as e:
        if "no such table" in str(e).lower():
            return absent
        raise


def has_transient_gap(fp: dict | None) -> bool:
    fields = (fp or {}).get("fields") or {}
    return any((f or {}).get("missing") in TRANSIENT_MISSING for f in fields.values())


def _read_bars(symbol: str, as_of: str) -> list[dict]:
    """Daily bars with date <= as_of, oldest first, as the screener's dicts."""
    from api.services import bars_sqlite
    rows = bars_sqlite.get_bars_before(symbol, "D", BARS_WINDOW, _iso_to_ymd(as_of)) or []
    out = []
    for r in rows:
        try:
            out.append({"t": r[0], "o": r[1], "h": r[2], "l": r[3], "c": r[4], "v": r[5]})
        except (IndexError, TypeError):
            continue
    return out


def _read_spy_closes(as_of: str) -> list[float]:
    from api.services import bars_sqlite
    rows = bars_sqlite.get_bars_before("SPY", "D", SPY_WINDOW, _iso_to_ymd(as_of)) or []
    return [r[4] for r in rows if r[4] is not None]


def _read_row(symbol: str) -> dict | None:
    from api.services.screener import snapshot_db
    return snapshot_db.get_row(symbol)


def _read_confirmed_patterns(symbol: str) -> list[dict]:
    """The confirmed-only read (`GET /api/patterns/{sym}`'s default branch).

    ⛔ NOT `pv_store.init_db()`: that creates tables, and this module never writes
    the pattern stores. A store that does not exist yet raises, and the caller
    labels the field `patterns_unavailable`."""
    from api.services.pattern_vision import store as pv_store
    return pv_store.get_confirmed(symbol, "D")


def _confirmed_window_floor() -> str:
    from api.services.pattern_vision import store as pv_store
    return pv_store.confirmed_window_floor()


# ── the pure core: fields from bars ───────────────────────────────────────────

def fields_from_bars(bars: list[dict], spy_closes: list[float] | None) -> dict[str, dict]:
    """Every bar-computable field, computed by the screener's own functions on
    `bars` (already cut at the as-of). Pure: no IO."""
    from api.services.screener import base_catalog, candles, setup_score, technicals

    src = "bars"
    bars = technicals.usable_bars(list(bars or [])[-BARS_WINDOW:])
    if not bars:
        return {f: _field(None, src, "no_bars") for f in FIELDS if f not in ("rs_rank", "patterns")}

    tech = technicals.compute_technicals(bars)
    multi = candles.multi_candle(bars)
    setup = setup_score.compute(bars, pole_pct=tech.get("pole_pct"))
    base = base_catalog.flat_base_state(bars)
    closes = [b["c"] for b in bars]
    sma10 = technicals._sma(closes, 10)
    pct10 = technicals._pct(closes[-1], sma10) if sma10 else None

    # The screener withholds a window that crosses a self-contradicting seam
    # (`snapshot_builder.build_row` -> `technicals.seam_withheld_columns`); the
    # same rule, applied to the same columns, plus the 10-bar window by the
    # same test `seam_withheld_columns` applies to the others.
    withheld = technicals.seam_withheld_columns(bars)
    interleaved, since = technicals.series_contradicts_itself(bars)
    if interleaved and 10 > since:
        withheld = set(withheld) | {"pct_vs_sma10"}

    def scalar(name: str, value: Any) -> dict:
        if name in withheld:
            return _field(None, src, "series_contradicts_itself")
        if value is None:
            return _field(None, src, "not_enough_history")
        return _field(value, src)

    out = {
        "adr_pct": scalar("adr_pct", tech.get("adr_pct")),
        "pct_vs_sma10": scalar("pct_vs_sma10", pct10),
        "pct_vs_sma20": scalar("pct_vs_sma20", tech.get("pct_vs_sma20")),
        "pct_vs_sma50": scalar("pct_vs_sma50", tech.get("pct_vs_sma50")),
        "pct_vs_sma200": scalar("pct_vs_sma200", tech.get("pct_vs_sma200")),
        "ma_stack": scalar("ma_stack", tech.get("ma_stack")),
        "ema_stack_intact": scalar("ema_stack_intact", setup.get("ema_stack_intact")),
        "pullback_depth_pct": scalar("pullback_depth_pct", multi.get("pullback_depth_pct")),
        "vol_nweek_low": _vol_nweek_low(setup.get("vol_nweek_low"), setup.get("candle_score"), src),
        "close_cv_pct": scalar("close_cv_pct", multi.get("close_cv_pct")),
        "pole_pct": scalar("pole_pct", tech.get("pole_pct")),
    }
    if not spy_closes:
        out["rs_line_trend"] = _field(None, src, "no_benchmark")
    else:
        out["rs_line_trend"] = scalar("rs_line_trend", technicals.rs_line_trend(closes, spy_closes))
    if len(bars) < base_catalog.FLAT_MIN_BARS:
        out["base_length_bars"] = _field(None, src, "not_enough_history")
        out["base_depth_pct"] = _field(None, src, "not_enough_history")
    elif base is None:
        out["base_length_bars"] = _field(None, src, "no_flat_base")
        out["base_depth_pct"] = _field(None, src, "no_flat_base")
    else:
        out["base_length_bars"] = _field(int(base["bars"]), src)
        out["base_depth_pct"] = _field(round(float(base["depth"]) * 100, 2), src)
    return out


def _vol_nweek_low(value: Any, candle_score: Any, source: str) -> dict:
    """`setup_score.compute` writes 20/15/10 (a 4/3/2-week volume low) or None.
    None means two different things there: not computable (then EVERY column it
    writes is None, `candle_score` included) or computed and no low. The second
    is a real answer and is published as 0; the first is missing."""
    if value is not None:
        return _field(int(value), source)
    if candle_score is None:
        return _field(None, source, "not_enough_history")
    return _field(0, source)


# ── the IO wrapper ────────────────────────────────────────────────────────────

def _bars_asof(bars: list[dict]) -> str | None:
    from api.services.screener import technicals
    usable = technicals.usable_bars(list(bars or [])[-BARS_WINDOW:])
    return _ymd_to_iso(usable[-1].get("t")) if usable else None


def _nightly_covers(row_asof: str | None, requested: str, bar_dates: list[str]) -> bool:
    """Is the nightly row the last completed session on or before `requested`?

    True when the row's day is on or before the requested day and no stored
    session falls strictly between the two other than the requested day itself.
    Without bars, the row may lag by at most `NIGHTLY_MAX_LAG_DAYS` calendar days.
    """
    if not row_asof or row_asof > requested:
        return False
    if bar_dates:
        between = [d for d in bar_dates if row_asof < d < requested]
        return not between
    lag = (_dt.date.fromisoformat(requested) - _dt.date.fromisoformat(row_asof)).days
    return lag <= NIGHTLY_MAX_LAG_DAYS


def _row_fields(row: dict) -> dict[str, dict]:
    src = "screener_row"
    out = {}
    for col in _ROW_COLUMNS:
        if col == "vol_nweek_low":
            out[col] = _vol_nweek_low(row.get("vol_nweek_low"), row.get("candle_score"), src)
            continue
        v = row.get(col)
        if v is None:
            out[col] = _field(None, src, "not_in_screener_row")
            continue
        if col == "ema_stack_intact":
            v = bool(v)
        elif col == "rs_rank":
            v = int(v)
        out[col] = _field(v, src)
    return out


def _pattern_field(effective_as_of: str | None, symbol: str,
                   read: Callable[[str], list[dict]] | None = None,
                   floor: str | None = None) -> dict:
    src = "pattern_vision"
    if effective_as_of is None:
        return _field(None, src, "no_bars")
    floor = floor or _confirmed_window_floor()
    if effective_as_of < floor:
        return _field(None, src, "patterns_current_window_only")
    try:
        verdicts = _absent_if_no_table(lambda: (read or _read_confirmed_patterns)(symbol), [])
    except Exception:                                   # noqa: BLE001 -- a store that cannot be read
        # TRANSIENT: labelled honestly for a live read, and never frozen.
        log.warning("[tech_fingerprint] confirmed patterns unreadable for %s", symbol, exc_info=True)
        return _field(None, src, "patterns_unavailable")
    items = []
    for v in verdicts or []:
        day = str(v.get("asof_date") or "")
        if not day or day > effective_as_of:      # judged on a bar after the as-of
            continue
        conf = v.get("vision_confidence")
        level = v.get("key_level")
        items.append({
            "setup": v.get("setup"),
            "asof_date": day,
            "confidence": round(float(conf), 1) if conf is not None else None,
            "key_level": float(level) if level is not None else None,
        })
    return _field(items, src)


def compute(symbol: Any, as_of: Any = None) -> dict:
    """The fingerprint of `symbol` as of `as_of` ('YYYY-MM-DD', default today ET).

    Not frozen: this is the live computation. Freezing is `chart_blocks.freeze`,
    which calls this ONCE and never again for the same block and day.
    """
    sym = normalize_symbol(symbol)
    requested = normalize_as_of(as_of)

    # ⛔ A store that cannot be READ raises out of here (the route answers 503 and
    # `chart_blocks.freeze` writes nothing and retries later). Only a store that
    # does not EXIST yet is an honest absence: no table holds no rows.
    bars = _absent_if_no_table(lambda: _read_bars(sym, requested), [])
    row = _absent_if_no_table(lambda: _read_row(sym), None)
    from api.services.screener import technicals
    usable = technicals.usable_bars(list(bars)[-BARS_WINDOW:])
    bar_dates = [d for d in (_ymd_to_iso(b.get("t")) for b in usable) if d]
    row_asof = _ymd_to_iso(row.get("bars_asof")) if row else None

    if row and _nightly_covers(row_asof, requested, bar_dates):
        mode = "nightly"
        effective = row_asof
        cut = [b for b in bars if (_ymd_to_iso(b.get("t")) or "") <= effective]
        if cut and _bars_asof(cut) == effective:
            # The RS line comes from the row; the extras need no benchmark.
            computed = fields_from_bars(cut, None)
            extras = {f: computed[f] for f in _BARS_ONLY}
        else:
            extras = {f: _field(None, "bars", "no_bars") for f in _BARS_ONLY}
        fields = {**_row_fields(row), **extras}
    else:
        mode = "bars"
        effective = _bars_asof(bars)
        spy = _absent_if_no_table(lambda: _read_spy_closes(requested), []) if bars else []
        fields = fields_from_bars(bars, spy)
        fields["rs_rank"] = _field(None, "screener_row", "rank_is_nightly_only")

    fields["patterns"] = _pattern_field(effective, sym)
    return {
        "v": FINGERPRINT_VERSION,
        "symbol": sym,
        "requested_as_of": requested,
        "as_of": effective,
        "mode": mode,
        "fields": {f: fields[f] for f in FIELDS},
    }


def summary_values(fp: dict | None) -> dict[str, Any]:
    """`{field: value}` (None where missing) -- the flat shape 13I-2's filters
    and 13J's distance read. One projection, so they cannot pick differently."""
    if not isinstance(fp, dict):
        return {}
    fields = fp.get("fields") if isinstance(fp.get("fields"), dict) else {}
    return {f: _value_of(f, fields.get(f)) for f in FIELDS}


def _is_scalar(v: Any) -> bool:
    if isinstance(v, float):
        return math.isfinite(v)
    return v is None or isinstance(v, (str, bool, int))


def _value_of(name: str, field: Any) -> Any:
    """One field's value, or None when the field is not the shape `compute` writes. A
    fingerprint can come out of a member's own note (`chart_blocks.extract_blocks`), so this
    reads it as data: a field that is a string or a list is "no value", never an exception
    (security review M-3)."""
    if not isinstance(field, dict):
        return None
    v = field.get("value")
    if name == "patterns":
        return v if v is None or (isinstance(v, list) and all(isinstance(p, dict) for p in v)) else None
    return v if _is_scalar(v) else None


#: The most pattern verdicts one fingerprint carries (a bound on a note-carried one).
MAX_PATTERN_ITEMS = 50


def well_formed(fp: Any) -> bool:
    """Is `fp` the shape `compute` writes: a dict whose `fields` is a dict of
    `{value, source, missing}` dicts with plain values? `chart_blocks` asks before it trusts a
    fingerprint found in a note; anything else is treated as no fingerprint at all."""
    if not isinstance(fp, dict) or not isinstance(fp.get("fields"), dict):
        return False
    for name, field in fp["fields"].items():
        if not isinstance(name, str) or not isinstance(field, dict):
            return False
        missing = field.get("missing")
        if missing is not None and not isinstance(missing, str):
            return False
        v = field.get("value")
        if name == "patterns":
            if v is not None and not (isinstance(v, list) and len(v) <= MAX_PATTERN_ITEMS
                                      and all(isinstance(p, dict) for p in v)):
                return False
        elif not _is_scalar(v):
            return False
    return True
