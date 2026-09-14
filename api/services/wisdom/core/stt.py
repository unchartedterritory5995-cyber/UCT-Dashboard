"""The spoken-price sanity pass and the STT correction log (W1 §4.3; manifest §4.8, R9).

normalize_price(raw, ticker, session_date) decides what a spoken number attached to a
ticker actually was, against that ticker's own daily bars around the session:

  * "1240" said about a ticker trading near $12 -> 12.40 (rescaled, logged)
  * "610" / "604" said about a ticker trading near $600 -> kept as said
  (illustrative numbers, not levels any author stated)
  * two readings both plausible, none plausible, or no bars -> (None, correction): the
    raw stays in the text, the caller lowers confidence, and the attempt is logged

A reading is plausible when it falls inside [0.5 x lowest low, 2 x highest high] of the
last BAND_SESSIONS daily bars up to the session. Readings are the value as said and,
only when it was said without a decimal point, the value divided by 10, 100 and 1000.
Because readings are a factor of ten apart and the band is narrower than 10x for any
ordinary stock, a second plausible reading means genuinely ambiguous, never "pick one".

Every correction goes to wisdom_stt_corrections with raw and normalized values
(normalized NULL when unresolved). Logging is idempotent: a re-run adds no duplicate row.
"""
from __future__ import annotations

import logging
import math
import re
import sqlite3
from datetime import date, datetime
from typing import Callable, Iterable, Optional

log = logging.getLogger(__name__)

RULE_VERSION = "price_sanity_v1"
BAND_SESSIONS = 5
BAND_LOW_FACTOR = 0.5
BAND_HIGH_FACTOR = 2.0
MAX_BAR_STALENESS_DAYS = 7
RESCALE_DIVISORS = (10, 100, 1000)
CORRECTION_KINDS = ("ticker_alias", "price_scale", "word_alias", "speaker_alias")

#: (ticker, session date) -> (lowest low, highest high) of the band window, or None.
BarsReader = Callable[[str, date], Optional[tuple]]

_PRICE_RE = re.compile(r"^\$?\s*(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?$")


def parse_spoken_price(raw) -> tuple[Optional[float], bool]:
    """(value, said_with_a_decimal_point). Booleans, zero, negatives and junk give (None, False)."""
    if isinstance(raw, bool):
        return None, False
    if isinstance(raw, int):
        return (float(raw), False) if raw > 0 else (None, False)
    if isinstance(raw, float):
        if not math.isfinite(raw) or raw <= 0:
            return None, False
        return raw, not raw.is_integer()
    if isinstance(raw, str):
        match = _PRICE_RE.match(raw.strip())
        if not match:
            return None, False
        fraction = match.group(2) or ""
        value = float(match.group(1).replace(",", "") + fraction)
        return (value, bool(fraction)) if value > 0 else (None, False)
    return None, False


def _as_date(value) -> Optional[date]:
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    text = str(value or "").strip()
    try:
        if re.fullmatch(r"\d{8}", text):
            return date(int(text[:4]), int(text[4:6]), int(text[6:]))
        if re.fullmatch(r"\d{4}-\d{2}-\d{2}", text[:10]):
            return date.fromisoformat(text[:10])
    except ValueError:
        return None
    return None


def band_from_rows(rows, session_date: date) -> Optional[tuple]:
    """(lowest low, highest high) from bars_sqlite rows (ts YYYYMMDD, o, h, l, c, v), or None
    when there are none, the newest is after the session, or it is stale."""
    good = []
    for row in rows or ():
        try:
            high, low = float(row[2]), float(row[3])
        except (TypeError, ValueError, IndexError):
            continue
        if high > 0 and low > 0:
            good.append((int(row[0]), high, low))
    if not good:
        return None
    newest = _as_date(good[-1][0])
    if newest is None or newest > session_date or (session_date - newest).days > MAX_BAR_STALENESS_DAYS:
        return None
    return min(g[2] for g in good), max(g[1] for g in good)


def default_bars_reader(ticker: str, session_date: date) -> Optional[tuple]:
    from api.services import bars_sqlite

    rows = bars_sqlite.get_bars_before(ticker.upper(), "D", BAND_SESSIONS, int(session_date.strftime("%Y%m%d")))
    return band_from_rows(rows, session_date)


def _fmt(value: float) -> str:
    return f"{value:.4f}".rstrip("0").rstrip(".")


def normalize_price(raw, ticker: str, session_date, bars_reader: Optional[BarsReader] = None, *,
                    segment_id: Optional[str] = None, record_id: Optional[str] = None,
                    db_path: Optional[str] = None) -> tuple[Optional[float], dict]:
    """(value or None, correction). See the module docstring for the rule."""
    correction = {
        "kind": "price_scale",
        "raw_value": str(raw),
        "normalized_value": None,
        "ticker": (str(ticker or "").upper() or None),
        "bar_date": None,
        "rule": RULE_VERSION,
        "status": "",
        "confidence": "low",
        "band": None,
        "candidates": [],
    }
    value, said_with_decimal = parse_spoken_price(raw)
    if value is None:
        correction["status"] = "unparseable"
        return None, correction
    session = _as_date(session_date)
    if not ticker or session is None:
        correction["status"] = "no_context"
        return None, correction
    correction["bar_date"] = session.isoformat()
    reader = bars_reader or default_bars_reader
    try:
        band = reader(str(ticker).upper(), session)
    except Exception as exc:
        log.warning("[wisdom-stt] bars read failed for %s on %s (%s)", ticker, session, type(exc).__name__)
        band = None
    if band is None:
        correction["status"] = "no_bars"
        correction["rule"] = f"{RULE_VERSION}:no_bars"
        _log_one(segment_id, record_id, correction, db_path)
        return None, correction
    low, high = float(band[0]), float(band[1])
    correction["band"] = [round(low, 4), round(high, 4)]
    readings = [(1, value)] + ([] if said_with_decimal else [(d, value / d) for d in RESCALE_DIVISORS])
    fits = [(d, v) for d, v in readings if low * BAND_LOW_FACTOR <= v <= high * BAND_HIGH_FACTOR]
    correction["candidates"] = [round(v, 4) for _, v in fits]
    if len(fits) == 1:
        divisor, reading = fits[0]
        reading = round(reading, 4)
        if divisor == 1:
            correction.update(status="kept", confidence="high", normalized_value=_fmt(reading))
            return reading, correction
        correction.update(status="rescaled", confidence="medium", normalized_value=_fmt(reading),
                          rule=f"{RULE_VERSION}:/{divisor}")
        _log_one(segment_id, record_id, correction, db_path)
        return reading, correction
    correction["status"] = "ambiguous" if fits else "out_of_range"
    correction["rule"] = f"{RULE_VERSION}:{correction['status']}"
    _log_one(segment_id, record_id, correction, db_path)
    return None, correction


def _log_one(segment_id, record_id, correction, db_path) -> None:
    if segment_id:
        log_corrections(segment_id, [correction], record_id=record_id, db_path=db_path)


def log_corrections(segment_id: str, corrections: Iterable[dict], *, record_id: Optional[str] = None,
                    db_path: Optional[str] = None) -> int:
    """Write corrections to wisdom_stt_corrections; returns rows actually inserted.

    A correction with offsets records them in the rule ("asr:light@123") so two
    occurrences in one segment are two rows, and the same run twice is still one each."""
    from api.services.wisdom.core import store, timeutil

    if not segment_id:
        raise ValueError("segment_id is required to log a correction")
    rows = []
    for correction in corrections:
        kind = correction.get("kind")
        if kind not in CORRECTION_KINDS:
            raise ValueError(f"unknown correction kind {kind!r}")
        rule = str(correction.get("rule") or kind)
        if "start" in correction:
            rule = f"{rule}@{correction['start']}"
        normalized = correction.get("normalized_value")
        rows.append((segment_id, record_id, kind, str(correction.get("raw_value")),
                     None if normalized is None else str(normalized), rule, correction.get("bar_date")))
    if not rows:
        return 0
    now = timeutil.iso_et(timeutil.now_et())
    inserted = 0
    try:
        with store.write(db_path) as conn:
            for seg, rec, kind, raw_value, normalized, rule, bar_date in rows:
                cursor = conn.execute(
                    "INSERT INTO wisdom_stt_corrections(segment_id, record_id, kind, raw_value, normalized_value, "
                    "rule, bar_date, created_at) SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE NOT EXISTS ("
                    "SELECT 1 FROM wisdom_stt_corrections WHERE segment_id = ? AND record_id IS ? AND kind = ? "
                    "AND raw_value = ? AND normalized_value IS ? AND rule = ?)",
                    (seg, rec, kind, raw_value, normalized, rule, bar_date, now,
                     seg, rec, kind, raw_value, normalized, rule),
                )
                inserted += max(cursor.rowcount, 0)
    except sqlite3.Error as exc:
        log.error("[wisdom-stt] could not log %d correction(s) for %s (%s)", len(rows), segment_id,
                  type(exc).__name__)
        return 0
    return inserted
