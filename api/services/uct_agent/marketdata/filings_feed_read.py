"""MD-1 kind `filings.feed` (owner: terminal-data, data wave 14) — new SEC filings, for the market or for one stock.

The filings feed as the FEED terminal function shows it: with no `symbol`, the newest filings across the market from
EDGAR's latest-filings feed (8-K with its item codes, 10-Q, 10-K, Form 4, Schedule 13D / 13G, S-1); with a `symbol`, that
company's recent filings of those forms from its EDGAR submissions. Over the answers of `GET /api/research/filings-feed`
and `GET /api/research/filings-feed/{sym}` (`api/services/filings_feed.py`), with the route's own field names. Each row
names its form, its company, its filing day, its acceptance time and its SEC index page.

⛔ ONLY WHAT THE SERVER ALREADY HOLDS, NEVER AN SEC REQUEST (MD-1 §5). The market feed is read from the poll's held copy
(`market_feed` is cache-only). One stock's route QUEUES a read of its EDGAR submissions on a miss; this adapter reads it
through `filings_feed_held.held_ticker`, which never queues. provider_calls is always 0.

THE SWITCH IS THE ROUTES': while `FILINGS_FEED_ENABLED` is off, both routes answer 404 and this read is `unavailable`.
Nothing held is `unavailable` and is never "no filings"; a company the SEC's ticker file does not list is said so; a form
with nothing in the kept rows is said as the route says it.

THE CUT IS STATED: at most `rows` filings, newest first; the rest are cut from the OLD end.

TIME (MD-1 §3): `as_of` is null: each filing carries its own filing day and acceptance time, and the read time (when UCT
polled the feed or read the company's submissions) rides beside them; never the time of the read. freshness `periodic`.

MODEL-ISOLATED (ADR-005; when in doubt, isolate): the licensing register
(docs/terminal-research/09-security-licensing-cost/licensing-register.md) row T-83 lists SEC EDGAR filings as public domain
for all seven uses, so the register itself clears these rows for a model provider; this kind is still isolated as the
builder's default for the Terminal waves, and lifting that is the integrator's decision, not taken here. Shown to the member
only; the capability is local-only.
"""
from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any, Optional

from api.services.uct_agent.marketdata import envelope as env
from api.services.uct_agent.marketdata.short_interest import _day
from api.services.uct_agent.marketdata.stock_stats_read import clean_symbol

KIND = "filings.feed"
SOURCE = "uct-filings-feed"
DEFAULT_ROWS = 15
MAX_ROWS = 60
FORMS = ("8-K", "10-Q", "10-K", "4", "SCHEDULE 13D", "SCHEDULE 13G", "S-1")   # filings_feed.FEED_FORMS, railed equal
_FORM_RE = re.compile(r"^[A-Z0-9 \-/]{1,16}$")

NOTE_WHAT = ("{scope} as UCT holds them from the SEC's EDGAR: each filing's form, company, filing day, acceptance time and "
             "SEC index page (8-K with its item codes). A record of what was filed, not advice")
NOTE_AS_OF = ("`as_of` is null: each filing carries its own filing day and acceptance time; UCT read {what} at {at}, never "
              "the time of the read")
NOTE_CUT = "{total} filings are held and the newest {shown} are returned: the list is cut from the OLD end"
NOTE_STALE = "the feed's last successful poll is older than three of its polls: {reason}"
NOTE_PARTIAL = "the feed is partial: {reason}"
NOTE_NONE = "{reason}. That is not the same as no filings"
NOTE_OFF = ("the filings feed is switched off on this server (FILINGS_FEED_ENABLED is not on), so nothing is read. That is "
            "not the same as no filings")
NOTE_NOT_HELD = ("{scope} are not held on this server yet, and this read never asks the SEC. That is not the same as no "
                 "filings. Open FEED{sym} in UCT, then ask again")
NOTE_NOT_LISTED = "{symbol}'s filings are not stated: {reason}. That is not the same as no filings"
NOTE_FAILED = "the filings feed read failed; nothing is stated. That is not the same as no filings"


def _form(v: Any) -> Optional[str]:
    if v is None:
        return None
    f = v.upper().strip() if isinstance(v, str) else ""
    return f if f and _FORM_RE.match(f) else ""


def validate(params: dict) -> Optional[str]:
    """Pure parameter check, run by the gateway BEFORE admission, so a malformed request spends no read."""
    if not isinstance(params, dict):
        return "the request must be an object"
    if params.get("symbol") is not None and clean_symbol(params.get("symbol")) is None:
        return "`symbol` must be one US stock ticker, or null for the market"
    f = _form(params.get("form"))
    if f == "" or (f and f.split("/")[0] not in FORMS):
        return f"`form` must be one of {', '.join(FORMS)}, or null"
    n = params.get("rows", DEFAULT_ROWS)
    if not isinstance(n, int) or isinstance(n, bool) or not 1 <= n <= MAX_ROWS:
        return f"`rows` must be a whole number from 1 to {MAX_ROWS}"
    return None


def held_answer(sym: Optional[str], form: Optional[str]) -> tuple[Optional[dict], str]:
    """READ ONLY: `(answer, how)`; `how` is `off`, `held` or `not_held`. Never asks the SEC, never queues a read."""
    from api.services import filings_feed, filings_feed_held
    if not filings_feed.is_enabled():
        return None, "off"
    if sym:
        return filings_feed_held.held_ticker(sym, form)
    got = filings_feed_held.held_market(form)
    return (None, "not_held") if got.get("state") == "pending" else (got, "held")


def _stamp(v: Any) -> Optional[str]:
    if isinstance(v, (int, float)) and not isinstance(v, bool) and v > 0:
        return env.utc_iso(datetime.fromtimestamp(float(v), tz=timezone.utc))
    return None


def _row(r: Any) -> Optional[dict]:
    if not isinstance(r, dict) or not isinstance(r.get("accession"), str) or not isinstance(r.get("form"), str):
        return None
    items = [{"code": i.get("code"), "label": i.get("label")} for i in r.get("items") or [] if isinstance(i, dict)]
    return {"form": r["form"], "company": r.get("company") if isinstance(r.get("company"), str) else None,
            "ticker": r.get("ticker") if isinstance(r.get("ticker"), str) else None, "accession": r["accession"],
            "filed": _day(r.get("filed")), "accepted": r.get("accepted") if isinstance(r.get("accepted"), str) else None,
            "url": r.get("url") if isinstance(r.get("url"), str) and r["url"].startswith("https://") else None,
            "items": items if r.get("items") is not None else None,
            "filed_by": r.get("filed_by") if isinstance(r.get("filed_by"), str) else None}


def read_filings(params: dict, ctx: dict) -> dict:  # noqa: ARG001 — no per-user state
    why = validate(params)
    if why:
        return env.unavailable(KIND, params, SOURCE, why)
    sym = clean_symbol(params["symbol"]) if params.get("symbol") is not None else None
    form, limit = _form(params.get("form")), params.get("rows", DEFAULT_ROWS)
    scope = f"{sym}'s recent SEC filings" if sym else "The newest SEC filings across the market"
    try:
        got, how = held_answer(sym, form)
    except Exception:  # noqa: BLE001
        return env.unavailable(KIND, params, SOURCE, NOTE_FAILED)
    if how == "off":
        return env.unavailable(KIND, params, SOURCE, NOTE_OFF)
    if how != "held" or not isinstance(got, dict):
        return env.unavailable(KIND, params, SOURCE, NOTE_NOT_HELD.format(scope=scope, sym=f" for {sym}" if sym else ""))
    state = got.get("state")
    reason = got.get("reason") if isinstance(got.get("reason"), str) else None
    if state in ("not_found", "unavailable"):
        return env.unavailable(KIND, params, SOURCE, NOTE_NOT_LISTED.format(symbol=sym or "the market",
                                                                            reason=reason or "the SEC read failed"))
    if state not in ("ok", "stale", "none_in_scope"):
        return env.unavailable(KIND, params, SOURCE, NOTE_FAILED)
    rows = [x for x in (_row(r) for r in got.get("rows") or []) if x]
    shown = rows[:limit]
    read_at = _stamp(got.get("fetched_at") if sym else got.get("polled_at"))
    notes = [NOTE_WHAT.format(scope=scope),
             NOTE_AS_OF.format(what="the company's submissions" if sym else "the latest-filings feed",
                               at=read_at or "a time it did not record")]
    if state == "none_in_scope":
        notes.append(NOTE_NONE.format(reason=reason or "no filing of that form is in the kept rows"))
    if state == "stale":
        notes.append(NOTE_STALE.format(reason=reason or "it has not polled lately"))
    if isinstance(got.get("partial"), str):
        notes.append(NOTE_PARTIAL.format(reason=got["partial"]))
    if len(rows) > len(shown):
        notes.append(NOTE_CUT.format(total=len(rows), shown=len(shown)))
    data = {"scope": "stock" if sym else "market", "symbol": sym, "company": got.get("company") if sym else None,
            "form": form, "state": state, "rows": shown, "count": len(shown), "total": len(rows),
            "cut": len(rows) > len(shown), "read_at": read_at,
            "merged_from_feed": got.get("merged_from_feed") if sym else None}
    status = "partial" if isinstance(got.get("partial"), str) else "ok"
    return env.make_envelope(KIND, params, status=status, freshness="periodic", as_of=None, source=SOURCE, data=data,
                             stale=state == "stale", notes=notes, provider_calls=0)
