"""Wave 13 lane 13C, phase 1: earnings prep that writes itself (WAVE-13-PLAN.md, A.13C).

Two member-scoped reads, both dark behind `NOTEBOOK_EARNINGS_PREP_ENABLED` (unset = OFF,
read per call through the one Notebook flag parse):

* `reporting_soon(user_id)` lists the member's OWN names that report in the next
  `WINDOW_DAYS` calendar days: watchlists, flagged names and open positions. UCT20 is the
  firm's list, not the member's, so it is left out (`MEMBER_SOURCES`).
* `draft(user_id, symbol)` returns the facts a prep note opens with. Each fact is a CELL
  (`_cell` / `_missing`) carrying its source and its as-of, or the sentence that says
  why it is missing. The client writes those cells into the note as text, so the note
  keeps the values it was drafted with: nothing in a note re-reads a source.

THE RULES (controller rulings for 13C, and decision R5):

* NEVER CREATES A NOTE. This module only reads. The note is created by the member's
  click, through the client's one create door (`lib/earningsPrep.js` ->
  `createNoteViaApi`), so there is no second writer into notes (R-12).
* REUSE, NEVER RE-IMPLEMENT. The window is `calendar_alerts.collect_earnings_window`
  (the walk awareness and the watchlist already share); the member's sets are
  `calendar_personalization.get_user_ticker_sets`; the quarters, beats, forward
  estimates and earnings-day reactions are `earnings_intel.get_earnings` (the one
  earnings model, company-level and shared); the pre-report implied move is
  `implied_store`; the call recap is `call_recap_store` (STORED ONLY); the member's
  notes are `ticker_research.get_ticker_research_summary`; trades and positions are the
  journal's own list functions.
* NO ALPHAVANTAGE, NO MODEL CALL. Its budget is 25 a day in process memory and
  refills on deploy (`alphavantage_client.py`), so this module never reaches
  `av_transcripts`, `call_recap` (whose request path warms on a miss and falls back to
  AlphaVantage transcripts) or the transcript routes. A recap that is not already
  stored is reported missing; nothing is generated. Rails:
  `tests/test_notebook_earnings_prep.py` (the import graph, and a runtime trap).
* MISSING IS SAID, NEVER INVENTED. A source that answers nothing yields a cell with
  `value: None` and a plain sentence; the client renders it as a labelled dash.
* 20 DRAFTS A MEMBER A DAY, durable in `daily_usage_counters` (the router charges it),
  so a deploy does not reset the cap.
"""
from __future__ import annotations

import logging
import os
import re
import sys
from datetime import date, datetime, timedelta, timezone
from typing import Any

from api.services.notebook_flags import flag_on

_log = logging.getLogger(__name__)

FLAG = "NOTEBOOK_EARNINGS_PREP_ENABLED"

#: The list's window, in calendar days after today (today included).
WINDOW_DAYS = 7

#: The member's own sets, in `member_interest.SOURCE_BUCKETS` names. UCT20 is excluded on
#: purpose: it is the firm's list, and the controller ruling names these three.
MEMBER_SOURCES = ("positions", "watchlist", "flagged")

#: The durable daily cap (counted by the router through `daily_counters`).
DAILY_SCOPE = "notebook_earnings_prep"
DAILY_CAP_ENV = "NOTEBOOK_EARNINGS_PREP_DAILY_CAP"
DAILY_CAP_DEFAULT = 20
CAP_SENTENCE = ("You've drafted {cap} earnings prep notes today, the daily limit. "
                "It resets at midnight Eastern.")

#: How many of the member's own notes and trades a prep cites.
NOTES_LIMIT = 5
TRADES_LIMIT = 5
REACTIONS_LIMIT = 4

#: ⛔ LOCAL SANDBOX ONLY: a JSON file standing in for the calendar window, for the
#: real-browser walk (the window otherwise lives in process memory or behind live vendors,
#: which a sandbox has neither of). Read only when `sandbox_calendar_active()`.
SANDBOX_CALENDAR_ENV = "NOTEBOOK_EARNINGS_PREP_SANDBOX_CALENDAR"

# ── member-facing source labels (one place, so the doc and the tests agree) ────────────
SRC_CALENDAR = "UCT earnings calendar"
SRC_EARNINGS = "UCT earnings data (consensus estimates and reported results)"
SRC_IMPLIED = "Options-implied move, captured by UCT before the report"
SRC_CAL_LIVE = "Options-implied move on the UCT earnings calendar"
SRC_REACTIONS = "UCT earnings data, reactions from UCT daily bars"
SRC_RECAP = "UCT call recap (stored)"
SRC_NOTES = "Your Notebook"
SRC_TRADES = "Your trade journal"
SRC_POSITIONS = "Your open positions"

# ── the sentences a missing value is labelled with ─────────────────────────────────────
MISSING_DATE = "No report date on the UCT calendar or in UCT's earnings data."
MISSING_TIMING = "The calendar has not said before or after the bell yet."
MISSING_MOVE = ("Not captured yet. UCT records the options-implied move the evening before "
                "the report, and the calendar shows a live one only once it has computed that day.")
MISSING_ESTIMATES = "No consensus estimate for the coming quarter in UCT's earnings data."
MISSING_YEAR_AGO = "No reported result for the same quarter a year ago in UCT's earnings data."
MISSING_REACTIONS = "No reported quarters with an earnings-day reaction in UCT's earnings data."
MISSING_RECAP = ("No stored call recap for {sym}. A prep note never generates one, so the "
                 "recap appears here only once UCT has written it for the Calendar.")
MISSING_NOTES = "You have no notes on {sym} yet."
MISSING_TRADES = "You have no closed trades in {sym} in your journal."
MISSING_POSITION = "You hold no open position in {sym}."
UNREADABLE = "UCT could not read this source just now."

_SYMBOL_RE = re.compile(r"^[A-Z][A-Z0-9.\-]{0,9}$")


class PrepRequestError(ValueError):
    """A request the member can fix (an unusable symbol)."""


def enabled() -> bool:
    """The gate, read PER CALL through the one Notebook flag parse."""
    return flag_on(FLAG, False)


def daily_cap() -> int:
    """`NOTEBOOK_EARNINGS_PREP_DAILY_CAP`, read per call; a bad value takes the default."""
    try:
        return max(0, int(os.environ.get(DAILY_CAP_ENV, DAILY_CAP_DEFAULT)))
    except (TypeError, ValueError):
        return DAILY_CAP_DEFAULT


def clean_symbol(raw: Any) -> str:
    sym = str(raw or "").strip().upper().lstrip("$")
    if not _SYMBOL_RE.match(sym):
        raise PrepRequestError("Enter a ticker symbol, like NVDA.")
    return sym


# ── cells ──────────────────────────────────────────────────────────────────────────────

def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _iso_from_epoch(v: Any) -> str | None:
    try:
        return datetime.fromtimestamp(float(v), tz=timezone.utc).isoformat(timespec="seconds")
    except (TypeError, ValueError, OverflowError, OSError):
        return None


def _cell(value: Any, source: str, as_of: str | None) -> dict[str, Any]:
    """A value UCT holds, with where it came from and when."""
    return {"value": value, "source": source, "asOf": as_of, "missing": None}


def _missing(source: str, reason: str) -> dict[str, Any]:
    """No value, and the sentence that says why. Never a guess."""
    return {"value": None, "source": source, "asOf": None, "missing": reason}


# ── the calendar window ────────────────────────────────────────────────────────────────

def _today_et() -> date:
    from api.services.journal_two.calendar import et_today
    return date.fromisoformat(et_today())


def sandbox_calendar_active() -> bool:
    """⛔ True ONLY in a local sandbox that asked for the walk's calendar file. Both of the
    last two conditions are false on every production pod:

      * `NOTEBOOK_EARNINGS_PREP_SANDBOX_CALENDAR` names a file;
      * the process is not on Railway (`vendor_socket_guard.on_production`, the app's one
        "am I in production" signal);
      * the repo's `conftest` is imported with its data-root census (`SHARED_DATA_ENV_PINS`):
        only pytest and `scripts/hub_sandbox_boot.py` import it, the web pod never does
        (the same condition `ai_actions.sandbox_stub_active` relies on).
    """
    path = (os.environ.get(SANDBOX_CALENDAR_ENV) or "").strip()
    if not path:
        return False
    from api.services.vendor_socket_guard import on_production
    if on_production():
        return False
    cf = sys.modules.get("conftest")
    return cf is not None and hasattr(cf, "SHARED_DATA_ENV_PINS")


def _sandbox_window() -> tuple[dict[str, str], dict[str, str], bool, str]:
    import json
    path = os.environ.get(SANDBOX_CALENDAR_ENV, "").strip()
    with open(path, encoding="utf-8") as fh:
        data = json.load(fh)
    window, timing = {}, {}
    for sym, row in (data.get("reporters") or {}).items():
        s = str(sym).upper()
        window[s] = str(row.get("date"))[:10]
        if row.get("timing") in ("bmo", "amc"):
            timing[s] = row["timing"]
    return window, timing, bool(data.get("partial")), data.get("asOf") or _now_iso()


def _window(today: date) -> tuple[dict[str, str], dict[str, str], bool, str]:
    """({SYM: report date}, {SYM: 'bmo'|'amc'}, partial, as-of) for today .. today+WINDOW_DAYS.

    The walk is `calendar_alerts.collect_earnings_window` (one lookup per DAY, never per
    ticker: the calendar's weekly cache, then Finnhub, then FMP). Its answer is held in
    the shared app cache for an hour (five minutes when a day could not be read), so a
    member reloading Home does not re-walk the window.
    """
    if sandbox_calendar_active():
        return _sandbox_window()
    from api.services.cache import cache
    ck = f"notebook_earnings_prep_window::{today.isoformat()}::{WINDOW_DAYS}"
    hit = cache.get(ck)
    if isinstance(hit, dict):
        window = dict(hit["window"])
    else:
        from api.services.calendar_alerts import collect_earnings_window
        window, partial = collect_earnings_window(today, WINDOW_DAYS)
        hit = {"window": dict(window), "partial": bool(partial), "asOf": _now_iso()}
        cache.set(ck, hit, ttl=300 if partial else 3600)
    timing = {s: t for s, d in window.items() if (t := _timing_from_calendar_cache(s, d))}
    return window, timing, bool(hit["partial"]), hit["asOf"]


def _timing_from_calendar_cache(sym: str, day: str) -> str | None:
    """'bmo' / 'amc' when the calendar's ALREADY-BUILT week names one for `sym` on `day`.

    Cache reads only: the current week (`calendar_weekly`) and the range week the calendar
    keeps per Monday (`calendar_week_<monday>`). Nothing is built here; an unbuilt week
    answers None, which the note labels as "not said yet".
    """
    from api.services.cache import cache
    try:
        d = date.fromisoformat(day)
    except (TypeError, ValueError):
        return None
    monday = d - timedelta(days=d.weekday())
    for key in ("calendar_weekly", f"calendar_week_{monday.isoformat()}"):
        cal = cache.get(key)
        days = (cal or {}).get("days") if isinstance(cal, dict) else None
        entry_day = (days or {}).get(day) or {}
        for bucket in ("bmo", "amc"):
            for e in entry_day.get(bucket) or []:
                if str((e or {}).get("sym") or "").upper() == sym:
                    return bucket
    return None


# ── the list ───────────────────────────────────────────────────────────────────────────

def _member_sets(user_id: str) -> dict[str, list[str]]:
    """{SYM: [source, ...]} over the member's own sets, in `MEMBER_SOURCES` order."""
    from api.services.calendar_personalization import get_user_ticker_sets
    sets = {k: set(v or ()) for k, v in get_user_ticker_sets(user_id).items()}
    # ⛔ OPEN POSITIONS COME FROM THE JOURNAL'S OWN READER. `member_interest._position_syms`
    # selects `sym` / `status = 'open'` from j2_positions, columns that table does not have
    # (it has `symbol` / `closed_at`), so it raises, is swallowed, and answers an EMPTY set for
    # every member -- found by this lane's walk (wave13-13c run 1: an open NVDA position was not
    # listed). Reported, not fixed here (not this lane's file). The union keeps this right
    # whether or not that reader is fixed later.
    try:
        from api.services.journal_two.positions import list_open_positions
        held = {str(p.get("symbol") or "").upper() for p in list_open_positions(user_id)}
        sets["positions"] = (sets.get("positions") or set()) | {s for s in held if s}
    except Exception as e:  # noqa: BLE001 -- one source failing never blanks the others
        _log.info("earnings prep: open positions read failed: %s", e)
    out: dict[str, list[str]] = {}
    for source in MEMBER_SOURCES:
        for sym in sorted(sets.get(source) or ()):
            out.setdefault(str(sym).upper(), []).append(source)
    return out


def _existing_prep_notes(user_id: str, since: str) -> dict[str, dict[str, Any]]:
    """{SYM: newest earnings-prep note created on or after `since`}, so the list offers
    Open on a name already prepped instead of drafting a duplicate. One query."""
    from api.services.journal_two.notes import list_notes
    out: dict[str, dict[str, Any]] = {}
    for n in list_notes(user_id, tag="earnings-prep", sort="created", limit=200):
        sym = str(n.get("ticker") or "").upper()
        created = str(n.get("createdAt") or "")[:10]
        if sym and created >= since and sym not in out:
            out[sym] = {"id": n["id"], "title": n.get("title") or "", "createdAt": n.get("createdAt")}
    return out


def reporting_soon(user_id: str, *, today: date | None = None) -> dict[str, Any]:
    """The member's own names reporting from today through `WINDOW_DAYS` days out."""
    today = today or _today_et()
    mine = _member_sets(user_id)
    window, timing, partial, as_of = _window(today)
    try:
        existing = _existing_prep_notes(user_id, (today - timedelta(days=21)).isoformat())
    except Exception as e:  # noqa: BLE001 -- the Open link is a convenience, never the list
        _log.info("earnings prep: existing-note read failed: %s", e)
        existing = {}
    items = []
    for sym, sources in mine.items():
        day = window.get(sym)
        if not day:
            continue
        try:
            days_away = (date.fromisoformat(day) - today).days
        except ValueError:
            continue
        items.append({
            "symbol": sym,
            "date": day,
            "daysAway": days_away,
            "timing": timing.get(sym),
            "sources": sources,
            "prepNote": existing.get(sym),
        })
    items.sort(key=lambda r: (r["date"], r["symbol"]))
    return {
        "windowDays": WINDOW_DAYS,
        "today": today.isoformat(),
        "items": items,
        "partial": partial,
        "source": SRC_CALENDAR,
        "asOf": as_of,
        "watched": len(mine),
    }


# ── the draft ──────────────────────────────────────────────────────────────────────────

def _report_cells(sym: str, today: date, intel: dict | None) -> tuple[dict, dict, str | None]:
    """(date cell, timing cell, the date as a string or None)."""
    window, timing, _partial, as_of = _window(today)
    if sym in window:
        day = window[sym]
        date_cell = _cell(day, SRC_CALENDAR, as_of)
    else:
        nrd = ((intel or {}).get("summary") or {}).get("next_report_date") or (intel or {}).get("next_report_date")
        day = str(nrd)[:10] if nrd else None
        date_cell = (_cell(day, SRC_EARNINGS, _iso_from_epoch(((intel or {}).get("meta") or {}).get("retrieved_at")))
                     if day else _missing(SRC_CALENDAR, MISSING_DATE))
    t = timing.get(sym) or (_timing_from_calendar_cache(sym, day) if day else None)
    timing_cell = _cell(t, SRC_CALENDAR, as_of) if t else _missing(SRC_CALENDAR, MISSING_TIMING)
    return date_cell, timing_cell, day


def _implied_rows(sym: str) -> list[dict]:
    from api.services import implied_store
    return implied_store.get_implied_history(sym, limit=12)


def _expected_move_cell(sym: str, day: str | None, implied: list[dict] | None, read_at: str) -> dict:
    """The pre-report capture for THIS report date first (the honest number: it was taken
    before the report), then the calendar's live overlay if the calendar has already
    computed that day. Both are reads of what UCT holds; nothing is computed here."""
    if not day:
        return _missing(SRC_IMPLIED, MISSING_MOVE)
    for row in implied or []:
        if str(row.get("report_date") or "")[:10] == day and row.get("pct") is not None:
            return _cell({"pct": row.get("pct"), "dollar": row.get("dollar")}, SRC_IMPLIED,
                         row.get("captured_at"))
    try:
        from api.services.cache import cache
        enr = cache.get(f"calendar_enrichment_{day}")
        em = ((enr or {}).get(sym) or {}).get("expected_move") if isinstance(enr, dict) else None
        if isinstance(em, dict) and em.get("pct") is not None:
            return _cell({"pct": em.get("pct"), "dollar": em.get("dollar")}, SRC_CAL_LIVE, read_at)
    except Exception as e:  # noqa: BLE001
        _log.info("earnings prep: calendar overlay read failed for %s: %s", sym, e)
    return _missing(SRC_IMPLIED, MISSING_MOVE)


def _street_cells(intel: dict | None, day: str | None) -> dict:
    """The coming quarter's consensus against the same quarter a year ago."""
    as_of = _iso_from_epoch(((intel or {}).get("meta") or {}).get("retrieved_at"))
    estimates = list((intel or {}).get("estimates") or [])
    quarters = list((intel or {}).get("quarters") or [])
    if not estimates:
        return {"quarter": None, "eps": _missing(SRC_EARNINGS, MISSING_ESTIMATES),
                "revenue": _missing(SRC_EARNINGS, MISSING_ESTIMATES),
                "epsYearAgo": _missing(SRC_EARNINGS, MISSING_YEAR_AGO),
                "revenueYearAgo": _missing(SRC_EARNINGS, MISSING_YEAR_AGO)}
    # `estimates` reads furthest-out first; the coming quarter is the one reporting on (or
    # nearest after) the report date, else the nearest one.
    upcoming = sorted(estimates, key=lambda e: (e.get("fiscal_year") or 0, e.get("fiscal_quarter") or 0))
    nxt = next((e for e in upcoming if day and str(e.get("report_date") or "")[:10] >= day), upcoming[0])
    fy, fq = nxt.get("fiscal_year"), nxt.get("fiscal_quarter")
    prior = next((q for q in quarters
                  if q.get("fiscal_year") == (fy - 1 if isinstance(fy, int) else None)
                  and q.get("fiscal_quarter") == fq), None)

    def est(key):
        v = nxt.get(key)
        return _cell(v, SRC_EARNINGS, as_of) if v is not None else _missing(SRC_EARNINGS, MISSING_ESTIMATES)

    def ago(key):
        v = (prior or {}).get(key)
        return _cell(v, SRC_EARNINGS, as_of) if v is not None else _missing(SRC_EARNINGS, MISSING_YEAR_AGO)

    return {
        "quarter": nxt.get("label"),
        "eps": est("eps_estimate"),
        "revenue": est("revenue_estimate"),
        "epsYearAgo": ago("eps_actual"),
        "revenueYearAgo": ago("revenue_actual"),
        "epsGrowthPct": nxt.get("eps_yoy_pct"),
        "revenueGrowthPct": nxt.get("rev_yoy_pct"),
    }


def _reactions_cell(intel: dict | None, implied: list[dict] | None) -> dict:
    """The last four reported quarters: beat or miss, and the earnings-day move, each
    joined to the implied move UCT captured before that report (when it did)."""
    as_of = _iso_from_epoch(((intel or {}).get("meta") or {}).get("retrieved_at"))
    quarters = [q for q in ((intel or {}).get("quarters") or []) if q.get("reported")]
    if not quarters:
        return _missing(SRC_REACTIONS, MISSING_REACTIONS)
    events = {str(e.get("report_date") or "")[:10]: e
              for e in (((intel or {}).get("reaction") or {}).get("events") or [])}
    implied_by_day = {str(r.get("report_date") or "")[:10]: r.get("pct") for r in (implied or [])}
    rows = []
    for q in quarters[:REACTIONS_LIMIT]:
        day = str(q.get("report_date") or "")[:10] or None
        ev = events.get(day or "") or {}
        rows.append({
            "quarter": q.get("label"),
            "reportDate": day,
            "epsBeat": q.get("eps_beat"),
            "epsSurprisePct": q.get("eps_surprise_pct"),
            "revenueBeat": q.get("rev_beat"),
            "revenueSurprisePct": q.get("rev_surprise_pct"),
            "reactionPct": ev.get("reaction_pct"),
            "impliedPct": implied_by_day.get(day or ""),
        })
    return _cell(rows, SRC_REACTIONS, as_of)


def _recap_cell(sym: str) -> dict:
    """⛔ STORED ONLY: `call_recap_store` is a SQLite point-read. `call_recap.get_call_recap`
    is never called -- on a miss it warms in the background, and the warm reaches
    AlphaVantage transcripts and a model."""
    from api.services import call_recap_store
    recap = call_recap_store.get(sym)
    if not recap:
        return _missing(SRC_RECAP, MISSING_RECAP.format(sym=sym))
    meta = call_recap_store.get_meta(sym) or {}
    value = {
        "quarter": meta.get("quarter"),
        "headline": recap.get("headline"),
        "sentiment": recap.get("sentiment"),
        "bullets": [str(b) for b in (recap.get("bullets") or []) if b][:6],
        "guidance": recap.get("guidance") if isinstance(recap.get("guidance"), str) else None,
    }
    return _cell(value, SRC_RECAP, meta.get("created_at"))


def _member_cells(user_id: str, sym: str, read_at: str) -> dict[str, dict]:
    """The member's own notes (cited by id), closed trades and open position on the name,
    across the security's known alias symbols (`ticker_research`'s identity)."""
    from api.services.journal_two.ticker_research import get_ticker_research_summary
    out: dict[str, dict] = {}
    symbols = [sym]
    try:
        summary = get_ticker_research_summary(user_id, sym)
        symbols = list((summary.get("identity") or {}).get("symbols") or [sym])
        notes = [{"id": n["id"], "title": (n.get("title") or "").strip() or "Untitled",
                  "updatedAt": n.get("updatedAt")}
                 for n in (summary.get("notes") or [])[:NOTES_LIMIT]]
        out["myNotes"] = (_cell(notes, SRC_NOTES, read_at) if notes
                          else _missing(SRC_NOTES, MISSING_NOTES.format(sym=sym)))
    except Exception as e:  # noqa: BLE001
        _log.info("earnings prep: notes read failed for %s: %s", sym, e)
        out["myNotes"] = _missing(SRC_NOTES, UNREADABLE)
    wanted = {s.upper() for s in symbols}
    try:
        from api.services.journal_two.filters import FilterSpec
        from api.services.journal_two.trades import list_trades_for_user
        rows, _total = list_trades_for_user(user_id, spec=FilterSpec(symbol=sym, limit=50))
        trades = [{"id": t["id"], "side": t.get("side"), "entryDate": t.get("entryDate"),
                   "exitDate": t.get("exitDate"), "pnlPercent": t.get("pnlPercent"),
                   "rMultiple": t.get("rMultiple"), "result": t.get("result")}
                  for t in rows if str(t.get("symbol") or "").upper() in wanted][:TRADES_LIMIT]
        out["myTrades"] = (_cell(trades, SRC_TRADES, read_at) if trades
                           else _missing(SRC_TRADES, MISSING_TRADES.format(sym=sym)))
    except Exception as e:  # noqa: BLE001
        _log.info("earnings prep: trades read failed for %s: %s", sym, e)
        out["myTrades"] = _missing(SRC_TRADES, UNREADABLE)
    try:
        from api.services.journal_two.positions import list_open_positions
        held = [{"id": p["id"], "symbol": p.get("symbol"), "side": p.get("side"),
                 "shares": p.get("shares"), "entryPrice": p.get("entryPrice"),
                 "stopPrice": p.get("stopPrice"), "entryDate": p.get("entryDate")}
                for p in list_open_positions(user_id) if str(p.get("symbol") or "").upper() in wanted]
        out["myPosition"] = (_cell(held, SRC_POSITIONS, read_at) if held
                             else _missing(SRC_POSITIONS, MISSING_POSITION.format(sym=sym)))
    except Exception as e:  # noqa: BLE001
        _log.info("earnings prep: positions read failed for %s: %s", sym, e)
        out["myPosition"] = _missing(SRC_POSITIONS, UNREADABLE)
    return out


def _safe(fn, *args, fallback=None):
    try:
        return fn(*args)
    except Exception as e:  # noqa: BLE001 -- one source failing must never fail the draft
        _log.info("earnings prep: %s failed: %s", getattr(fn, "__name__", fn), e)
        return fallback


def draft(user_id: str, symbol: str, *, today: date | None = None) -> dict[str, Any]:
    """Every fact a prep note on `symbol` opens with, read NOW and returned as cells.

    Never raises for a source: each one that fails or answers nothing becomes a missing
    cell with its sentence, so a draft always comes back whole."""
    sym = clean_symbol(symbol)
    today = today or _today_et()
    read_at = _now_iso()

    def _intel(s):
        from api.services.earnings_intel import get_earnings
        payload = get_earnings(s)
        return payload if isinstance(payload, dict) and not payload.get("error") else None

    intel = _safe(_intel, sym)
    implied = _safe(_implied_rows, sym, fallback=[])
    date_cell, timing_cell, day = _safe(
        _report_cells, sym, today, intel,
        fallback=(_missing(SRC_CALENDAR, UNREADABLE), _missing(SRC_CALENDAR, UNREADABLE), None))
    street = _safe(_street_cells, intel, day) or {
        "quarter": None, "eps": _missing(SRC_EARNINGS, UNREADABLE), "revenue": _missing(SRC_EARNINGS, UNREADABLE),
        "epsYearAgo": _missing(SRC_EARNINGS, UNREADABLE), "revenueYearAgo": _missing(SRC_EARNINGS, UNREADABLE)}
    out = {
        "symbol": sym,
        "frozenAt": read_at,
        "report": {"date": date_cell, "timing": timing_cell},
        "expectedMove": _safe(_expected_move_cell, sym, day, implied, read_at)
        or _missing(SRC_IMPLIED, UNREADABLE),
        "street": street,
        "reactions": _safe(_reactions_cell, intel, implied) or _missing(SRC_REACTIONS, UNREADABLE),
        "recap": _safe(_recap_cell, sym) or _missing(SRC_RECAP, UNREADABLE),
    }
    out.update(_member_cells(user_id, sym, read_at))
    return out


def cap_sentence() -> str:
    return CAP_SENTENCE.format(cap=daily_cap())
