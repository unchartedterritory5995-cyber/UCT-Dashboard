# api/services/journal_two/followup_prefill.py
"""Tier 2 part B, item 11: what an earnings follow-up note opens with, in the create's ONE insert.

Two things, each optional, none invented (R-T2B-9..11):
  * a link to the member's newest earnings-prep note on the name, created ON OR BEFORE the report date
    (ET), live and not a sample. LINKED, never mined: the prep note's text table is not parsed;
  * the quarter's expected and actual EPS and revenue, earnings_intel's own surprise %, and the
    close-to-close reaction, read from what earnings_intel already HOLDS (get_earnings_held: never a
    build and never a vendor call on this request path), with one source line naming where they came
    from and when. A value UCT does not hold is a labelled dash.
The headings are the style's own outline (journal_styles.FOLLOWUP_HEADINGS); the reminder is its block.
⛔ It never raises for a missing or malformed value (Part A's I4 lesson, 6b3bca53a9): the work is done
on a COPY, so an error leaves the note exactly as the style composed it.
⛔ The held payload is the SHARED cached object (earnings_intel hands back the memory layer's own dict):
this module only READS it, never assigns into it. The retrieved time comes from `meta.retrieved_at`, the
one field both the memory and the snapshot layers carry (never `age_seconds` or `stale`).

SHARED HELPERS (one place, for the follow-up job, Task 7, to import rather than restate): `_day_words`,
`as_number`, `quarter_for`, `event_for`, `valid_symbol` (the server's own ticker shape, notes._validate_ticker),
`_today_et`. Trading-day arithmetic is reminder_block.add_trading_days; there is no copy of it here.
"""
from __future__ import annotations

import copy
import math
from datetime import date, datetime, timezone
from typing import Any

from api.services.journal_two import journal_styles as _js
from api.services.journal_two import sample_marker
from api.services.journal_two.earnings_prep import SRC_EARNINGS
from api.services.journal_two.timeutil import ET

FOLLOWUP_KIND = "earnings_followup"
PREP_TAG = "earnings-prep"
#: Newest prep notes read, at most (earnings_prep._existing_prep_notes reads the same 200).
PREP_SCAN = 200
#: A provider can date one report a day or two apart from the calendar.
MATCH_DAYS = 3
MAX_AGE_DAYS = 120
DASH = "—"
OFF_SENTENCE = "Earnings follow-ups are not on for you yet."
NEEDS_TICKER_SENTENCE = "An earnings follow-up needs a ticker."
DATE_SENTENCE = "Choose a report date from the last 120 days."


def _today_et() -> date:
    """Today's date in ET. The ONE clock this module reads: tests pin it, so a fixed report date never expires."""
    return datetime.now(tz=ET).date()


def valid_symbol(raw: Any) -> bool:
    """True when `raw` is a ticker the SERVER accepts: notes._validate_ticker is the one authority for the
    shape (letters, digits, dot, hyphen), so this never restates its pattern."""
    from api.services.journal_two import notes as notes_service
    try:
        return notes_service._validate_ticker(raw) is not None
    except notes_service.NoteValidationError:
        return False


def as_number(v: Any) -> float | None:
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        return None
    f = float(v)
    return f if math.isfinite(f) else None


def _iso_day(v: Any) -> date | None:
    try:
        return date.fromisoformat(str(v)[:10])
    except (TypeError, ValueError):
        return None


def _list(v: Any) -> list:
    return v if isinstance(v, list) else []


def _nearest(rows: list, report_date: str) -> dict | None:
    rd = _iso_day(report_date)
    if rd is None:
        return None
    best = None
    for r in rows:
        if not isinstance(r, dict):
            continue
        d = _iso_day(r.get("report_date"))
        if d is None:
            continue
        gap = abs((d - rd).days)
        if gap <= MATCH_DAYS and (best is None or gap < best[0]):
            best = (gap, r)
    return best[1] if best else None


def quarter_for(intel: Any, report_date: str) -> dict | None:
    if not isinstance(intel, dict):
        return None
    return _nearest([q for q in _list(intel.get("quarters")) if isinstance(q, dict) and q.get("reported")],
                    report_date)


def event_for(intel: Any, report_date: str) -> dict | None:
    if not isinstance(intel, dict):
        return None
    reaction = intel.get("reaction")
    return _nearest(_list(reaction.get("events")) if isinstance(reaction, dict) else [], report_date)


def clean_request(raw: Any, *, kind_id: Any, ticker: str | None, today: date | None = None) -> str:
    """The `earningsFollowup` payload's report date, or a StyleValidationError with a fixed sentence."""
    from api.services.journal_two import earnings_followup
    if not earnings_followup.enabled():
        raise _js.StyleValidationError(OFF_SENTENCE)
    if kind_id != FOLLOWUP_KIND or not valid_symbol(ticker):
        raise _js.StyleValidationError(NEEDS_TICKER_SENTENCE)
    rd = raw.get("reportDate") if isinstance(raw, dict) else None
    d = _iso_day(rd) if isinstance(rd, str) and len(rd) == 10 else None
    today = today or _today_et()
    if d is None or d > today or (today - d).days > MAX_AGE_DAYS:
        raise _js.StyleValidationError(DATE_SENTENCE)
    return d.isoformat()


def _created_et_day(iso: Any) -> date | None:
    """The ET calendar day of a note's `createdAt` (a UTC ISO string, notes._now_iso). ⛔ Never `[:10]`:
    that is the UTC date, and a note made after 20:00 ET would read as the next day (V5)."""
    try:
        t = datetime.fromisoformat(str(iso).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return _iso_day(iso)
    if t.tzinfo is None:
        t = t.replace(tzinfo=timezone.utc)
    return t.astimezone(ET).date()


def prep_note(user_id: str, symbol: str, report_date: str, conn) -> str | None:
    """The id of the member's newest live, non-sample note tagged earnings-prep on `symbol`, created on
    or before `report_date` in ET, or None. One list read and one check query."""
    from api.services.journal_two import notes as notes_service
    rd, sym = _iso_day(report_date), symbol.upper()
    if rd is None:
        return None
    rows = notes_service.list_notes(user_id, tag=PREP_TAG, sort="created", limit=PREP_SCAN, conn=conn)
    ids = []
    for n in rows:
        created = _created_et_day(n.get("createdAt"))
        if str(n.get("ticker") or "").upper() == sym and created is not None and created <= rd:
            ids.append(n["id"])
    if not ids:
        return None
    marks = ",".join("?" for _ in ids)
    live = {r[0] for r in conn.execute(
        f"SELECT id FROM j2_notes WHERE user_id = ? AND id IN ({marks}) AND deleted_at IS NULL AND "
        + sample_marker.not_sample_sql(), (user_id, *ids))}
    return next((i for i in ids if i in live), None)


def _day_words(d: date) -> str:
    return f"{d.strftime('%b')} {d.day}, {d.year}"


def _eps(v: float) -> str:
    return f"{'−' if v < 0 else ''}${abs(v):,.2f}"


def _rev(v: float) -> str:
    a, sign = abs(v), ("−" if v < 0 else "")
    if a >= 1e9:
        return f"{sign}${a / 1e9:,.1f}B"
    if a >= 1e6:
        return f"{sign}${a / 1e6:,.1f}M"
    return f"{sign}${a:,.0f}"


def _pct(v: float) -> str:
    return f"{'+' if v >= 0 else '−'}{abs(v):.1f}%"


def _retrieved(meta: Any) -> str:
    v = as_number(meta.get("retrieved_at")) if isinstance(meta, dict) else None
    if v is None:
        return "at a time not recorded"
    try:
        t = datetime.fromtimestamp(v, tz=timezone.utc).astimezone(ET)
    except (OverflowError, OSError, ValueError):
        return "at a time not recorded"
    return f"{_day_words(t.date())}, {t.strftime('%I:%M %p').lstrip('0')} ET"


def _metric(name: str, actual: Any, estimate: Any, surprise: Any, fmt, missing: str) -> str:
    a, e, s = as_number(actual), as_number(estimate), as_number(surprise)
    if a is None:
        return f"{name}: {DASH} ({missing})"
    if e is None:
        return f"{name}: {fmt(a)} actual; no consensus estimate in UCT's earnings data."
    tail = f" ({_pct(s)} surprise)" if s is not None else ""
    return f"{name}: {fmt(a)} actual vs {fmt(e)} expected{tail}."


def number_lines(symbol: str, report_date: str, intel: Any) -> list[str]:
    """The lines under "What happened". Prose, never `role: number` (plan_extract must not read them).
    Only READS `intel` (the shared held payload)."""
    when = _day_words(_iso_day(report_date))
    if not isinstance(intel, dict):
        return [f"The numbers: {DASH} UCT holds no earnings data for {symbol} right now."]
    source = f"Source: {SRC_EARNINGS}, retrieved {_retrieved(intel.get('meta'))}."
    q = quarter_for(intel, report_date)
    if q is None:
        return [f"The numbers: {DASH} UCT's earnings data does not have the {when} report yet.", source]
    label = q.get("label") if isinstance(q.get("label"), str) and q.get("label").strip() else "The quarter"
    r = as_number((event_for(intel, report_date) or {}).get("reaction_pct"))
    return [
        f"Quarter: {label}, reported {when}.",
        _metric("EPS", q.get("eps_actual"), q.get("eps_estimate"), q.get("eps_surprise_pct"), _eps,
                "no reported EPS for this quarter in UCT's earnings data yet"),
        _metric("Revenue", q.get("revenue_actual"), q.get("revenue_estimate"), q.get("rev_surprise_pct"), _rev,
                "no reported revenue for this quarter in UCT's earnings data yet"),
        (f"Reaction: {_pct(r)} close to close, on the session that first traded the result." if r is not None
         else f"Reaction: {DASH} (UCT could not measure the price reaction to this report)."),
        source,
    ]


def _para(*inline: dict) -> dict:
    return {"type": "paragraph", "content": [n for n in inline if n]}


def _text(s: str) -> dict:
    return {"type": "text", "text": s}


def _insert_under(content: list, heading: str, nodes: list) -> None:
    for i, n in enumerate(content):
        if isinstance(n, dict) and n.get("type") == "heading" and _js._plain(n).strip() == heading:
            content[i + 1:i + 1] = nodes
            return
    i = _js._after_first_heading(content)
    content[i:i] = nodes


def apply(doc: dict, ctx: dict, conn, report_date: str) -> dict:
    """compose's `after_build` for an earningsFollowup create. Mutates and returns `doc`; never raises."""
    symbol = ctx.get("ticker")
    if not symbol:
        return doc
    try:
        prep = prep_note(ctx["user_id"], symbol, report_date, conn)
    except Exception:  # noqa: BLE001 -- an unreadable notebook is "no prep note", never a failed note
        prep = None
    try:
        from api.services import earnings_intel
        intel = earnings_intel.get_earnings_held(symbol)
    except Exception:  # noqa: BLE001
        intel = None
    try:
        lines = number_lines(symbol, report_date, intel)
    except Exception:  # noqa: BLE001 -- data of a shape nobody planned for
        lines = [f"The numbers: {DASH} UCT could not read its earnings data for {symbol} just now."]
    try:
        trial = copy.deepcopy(doc)
        content = trial.get("content")
        if not isinstance(content, list):
            return doc
        expected, happened, _ = _js.FOLLOWUP_HEADINGS
        if prep:
            _insert_under(content, expected, [_para(_text("Your prep note before the report: "),
                                                    {"type": "noteLink", "attrs": {"noteId": prep}})])
        _insert_under(content, happened, [_para(_text(t)) for t in lines])
    except Exception:  # noqa: BLE001 -- a malformed outline is "nowhere to put it", never a failed note
        return doc
    doc.clear()
    doc.update(trial)
    return doc
