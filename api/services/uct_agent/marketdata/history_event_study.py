"""MD-1 kind `history.eventStudy` (W2-B2, builder-b / agent-rs) — "how has NVDA behaved after 5%+ gaps?"

A thin adapter over the EXISTING Market Intelligence event study (`api/services/market_intel/event_study.py`,
Slice 2: validate → run → `event_study_answer.answer`), which until now had no caller. Nothing is computed here:
the condition series comes from the study's own technical adapter (`series_adapters._TECH` over the stored daily
closes / opens, the same `indicator_compute` functions the alert evaluator uses), outcome prices from
`price_reads.daily_closes` (the read-only /api/bars-history path), sessions from the shared NYSE calendar.

Scope (owner rulings): condition series of kind `technical` ONLY. A breadth-conditioned study carries UCT-derived
breadth values (ADR-005, model-isolated) and is refused before anything is read — "not available to UCT Agent yet".

⛔ LOCAL ONLY. The result carries licensed price returns and is shown to the MEMBER (the table). The model receives
only what `turn.LOCAL_ONLY_ACTIONS` allows for `history.afterEvent`: the value-free request note
(`event_study.request_note`: symbol, condition, windows, dates) and counts — never a return. `data.summary` is that
value-free part, kept apart from `data.study` (the member's text and table) so a caller cannot confuse them.

Semantics: freshness `historical`; `as_of` = the regular-session close of the last stored price session the study
used; `stale` when that session predates the newest completed session; `provider_calls` 0 (a store read).
Every answer says "descriptive, not predictive".
"""
from __future__ import annotations

import re
from typing import Any, Optional

from api.services.uct_agent.marketdata import envelope as env

KIND = "history.eventStudy"
SOURCE = "uct-market-intel"
#: the study's own technical indicators (series_adapters._TECH); `gap_pct` is the opening gap vs the previous close
from api.services.uct_agent.history_note import ALLOWED_SERIES_KINDS, DEFAULT_HORIZONS, INDICATORS, NO_PERIOD, study_request  # noqa: F401,E501 — shared with turn.py's local-result boundary

OPS = ("above", "below", "cross_above", "cross_below")
EPISODES = ("first", "all")
ENTRIES = ("event_close", "next_close")
MAX_HORIZONS = 4
MAX_SESSIONS = 252
MAX_LAST = 60          # event_study.MAX_LAST: "the last N times"
_SYMBOL_RE = re.compile(r"^[A-Z][A-Z0-9.\-]{0,9}$")
_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")

NOTE_DESCRIPTIVE = "descriptive, not predictive: what happened after past events in UCT's stored daily history; past results do not predict future returns"
NOTE_COMPLETED = "completed sessions only, from UCT's stored daily closes (split-adjusted, not dividend-adjusted)"
NOTE_LOCAL = "shown to the member only; the model receives the request and counts, never a return"
NOTE_GAPS = "opening gaps on ANY session — UCT's data carries no past earnings dates, so earnings days are not separated"
NOTE_SAMPLE = "a small sample of past events: the number of events and the study window are stated with every result"
NOTE_BREADTH = "breadth-conditioned studies are not available to UCT Agent yet (ADR-005)"


def _isnum(v: Any) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def validate(params: dict) -> Optional[str]:
    """Pure pre-admission check (Kind.validate): shape here, then the study's own `validate` with the Agent's
    server-side series scope — a breadth or other series kind is refused before any adapter is consulted."""
    sym = str(params.get("symbol") or "").strip().upper()
    if not _SYMBOL_RE.match(sym):
        return "a valid ticker symbol is required"
    if params.get("indicator") not in INDICATORS:
        return f"indicator must be one of {', '.join(INDICATORS)}"
    if params.get("op") not in OPS:
        return f"op must be one of {', '.join(OPS)}"
    if not _isnum(params.get("threshold")):
        return "a numeric threshold is required"
    p = params.get("period")
    if params["indicator"] in NO_PERIOD:
        if p is not None:
            return f"{params['indicator']} takes no period"
    elif not isinstance(p, int) or isinstance(p, bool) or p < 1:
        return "`period` must be a positive whole number"
    hz = params.get("horizons")
    if hz is not None:
        if not isinstance(hz, list) or not hz or len(hz) > MAX_HORIZONS:
            return f"horizons must list 1 to {MAX_HORIZONS} session counts"
        for n in hz:
            if not isinstance(n, int) or isinstance(n, bool) or not 1 <= n <= MAX_SESSIONS:
                return f"each horizon is a whole number of sessions from 1 to {MAX_SESSIONS}"
    if params.get("episodes") is not None and params["episodes"] not in EPISODES:
        return "episodes is first | all"
    if params.get("entry") is not None and params["entry"] not in ENTRIES:
        return "entry is event_close | next_close"
    last = params.get("last")
    if last is not None and (not isinstance(last, int) or isinstance(last, bool) or not 1 <= last <= MAX_LAST):
        return f"last is a whole number of events from 1 to {MAX_LAST}"
    since = params.get("since")
    if since is not None and (not isinstance(since, str) or not _DATE_RE.match(since)):
        return "`since` must be a date like 2024-01-01"
    from api.services.market_intel import event_study
    ok, err = event_study.validate(study_request(params), allowed_kinds=ALLOWED_SERIES_KINDS)
    if err:
        if err.get("reason") == "kind_not_enabled":
            return NOTE_BREADTH
        return str(err.get("detail") or err.get("reason") or "the study request was not understood")[:300]
    return None


def _ymd(d: str) -> int:
    return int(str(d).replace("-", ""))


def summary_of(res: dict) -> dict:
    """The VALUE-FREE part: counts, dates, labels and pass/fail flags. Never a return, never a price."""
    c = res.get("counts") or {}
    cov = res.get("coverage") or {}
    return {
        "status": "ok", "events_used": int(c.get("events_used") or 0), "events_detected": int(c.get("events_detected") or 0),
        "overlapping_events": int(c.get("overlapping_events") or 0),
        "study_start": cov.get("study_start"), "study_end": cov.get("study_end"), "price_last": cov.get("price_last"),
        "price_first": cov.get("price_first"),
        "horizons": [{"label": h.get("label"), "n": int(h.get("n") or 0), "incomplete": int(h.get("incomplete") or 0)}
                     for h in (res.get("horizons") or [])],
        "small_sample": any(int(h.get("n") or 0) < 10 for h in (res.get("horizons") or [])),
        "series_label": res.get("series_label"),
        **({"last": int((res.get("request") or {}).get("last")), "events_before_last": int(c.get("events_before_last") or 0)}
           if (res.get("request") or {}).get("last") else {}),
    }


def read_event_study(params: dict, ctx: dict) -> dict:  # noqa: ARG001 — no per-user state
    why = validate(params)
    if why:
        return env.unavailable(KIND, params, SOURCE, why)
    from api.services.market_intel import event_study, event_study_answer
    req = study_request(params)
    res = event_study.run(req, allowed_kinds=ALLOWED_SERIES_KINDS)
    ans = event_study_answer.answer(res)
    if not isinstance(res, dict) or res.get("status") != "ok":
        return env.unavailable(KIND, params, SOURCE, str(ans.get("text") or "the study could not be computed")[:300])
    cov = res.get("coverage") or {}
    price_last = cov.get("price_last")
    from api.services.uct_agent.marketdata.bars_daily import _session_close_utc
    from api.services.uct_agent.marketdata.sessions import last_completed_session
    as_of = _session_close_utc(_ymd(price_last)) if price_last else None
    latest = last_completed_session()
    stale = bool(price_last) and _ymd(price_last) < latest
    notes = [NOTE_DESCRIPTIVE, NOTE_SAMPLE, NOTE_COMPLETED, NOTE_LOCAL]
    if params.get("indicator") == "gap_pct":
        notes.append(NOTE_GAPS)
    if stale:
        notes.append(f"the stored closes end {price_last}; the newest completed session is "
                     f"{str(latest)[:4]}-{str(latest)[4:6]}-{str(latest)[6:]}")
    if not as_of:
        notes.append("the study carries no price date")
    data = {
        "symbol": req["symbol"], "request": req,
        "study": {"lead": ans.get("lead"), "text": ans.get("text"), "table": ans.get("table"), "caveats": ans.get("caveats") or []},
        "summary": summary_of(res), "method": res.get("method"), "coverage": cov, "notes": list(res.get("notes") or []),
    }
    return env.make_envelope(KIND, params, status="ok", freshness="historical", as_of=as_of, source=SOURCE, data=data,
                             stale=stale, notes=notes, provider_calls=0)
