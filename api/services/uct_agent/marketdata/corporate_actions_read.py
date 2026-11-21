"""MD-1 kind `stock.corporateActions` (owner: terminal-data, data wave 8) — one stock's splits and cash dividends, as held.

One stock's splits and cash dividends as UCT holds them beside the stock's chart: the Agent half of the CACT terminal
function, over the answer of `GET /api/research/corporate-actions/{ticker}` (`api/services/corporate_actions_held.py`).
Two blocks, each with its own rows, its own window, its own count and its own newest date: splits up to 45 years back
and cash dividends up to 5 years back by ex-date, both newest first.

⛔ ONLY THE RECORD THE SERVER ALREADY HOLDS, NEVER A VENDOR REQUEST (MD-1 §5). The route's service,
`corporate_actions_held.held_actions`, reads the chart markers record kept on this server's disk and nothing else: it
never asks the vendor and never starts a build. This adapter calls that service and nothing more. The chart's own
reader (`earnings_estimates.get_chart_markers`) BUILDS the record when nothing is held, and refreshes it in the
background when it is old; neither is ever called here. provider_calls is always 0. A rail shows the chart's reader
building in the same state.

NOTHING HELD IS SAID, NEVER "NO SPLITS": `not_held` (nobody has opened the stock's chart on this server, so nothing is
held) is `unavailable`. A held record with an empty block is what the record lists: the record does not say whether
every vendor read behind it answered (the chart's build withholds the dividends when its split read fails), so an
empty block is said as "the held record lists none", never as proof that none happened.

WHAT IS STATED: every row is the service's own, passed through. Dividend amounts are SPLIT-ADJUSTED (what the chart
draws), not the amounts as declared, and a note says so. A split whose ratio the record cannot state keeps a null
ratio, never 0. The company's name and ticker record (its former tickers) is a separate read the CACT panel makes
(`GET /api/research/rename-notice/{sym}`, behind its own switch): it is not in this record and is NOT read here;
`data.left_out` names it and a note says so.

THE CUT IS STATED: each block returns at most `rows` rows, newest first; a longer block is cut from the OLD end and
the note says so. Each block's count of everything held rides beside what is shown.

TIME (MD-1 §3): `as_of` = the newest event of either block (the start of that Eastern day); never the time of this
read. When UCT read the record from the vendor rides beside it as `data.read_at`, and each block carries its own
newest date. The read is `stale`, with a note, when the record is older than the chart's own refresh age (the
service's `_MARKERS_REFRESH_SECONDS`, read at call time) or carries no read time: this read never refreshes it. Every
read is `historical`; the kind is DECLARED `periodic`.

MODEL-ISOLATED (ADR-005; when in doubt, isolate): the licensing register
(docs/terminal-research/09-security-licensing-cost/licensing-register.md) row T-07 covers this reference data for
member display and external publication, and the register's 2026-09-19 note scopes its LA reading to member display,
with AI use its own row. That row, row T-14 (AI processing: the vendor's numbers into a model), is class R in its class
column and LA in its Business column, which the register's legend defines as verify the contract. No row clears these
records for a model provider outright, and no other row does. Shown to the member only; the capability is local-only.
"""
from __future__ import annotations

import time
from datetime import datetime
from typing import Any, Optional

from api.services.uct_agent.marketdata import envelope as env
from api.services.uct_agent.marketdata.short_interest import _day, _num, _read_at, _whole, day_as_of

KIND = "stock.corporateActions"
SOURCE = "uct-chart-markers"
DEFAULT_ROWS = 12           # the CACT panel draws twelve rows of each table before "Show all" (CACT_ROWS_SHOWN; a rail pins it)
MAX_ROWS = 60               # the service's own ROW_CAP (a rail pins it)
BLOCKS = ("splits", "dividends")
BASIS = "split_adjusted"
LEFT_OUT = ("names",)
MAX_RATIO_CHARS = 16

NOTE_WHAT = ("{symbol}'s splits and cash dividends as UCT holds them beside the stock's chart, from its market-data "
             "vendor's reference data: splits back {split_years} years and cash dividends back {dividend_years} years by "
             "ex-date, newest first. Dividend amounts are split-adjusted (what the chart draws), not the amounts as "
             "declared. A record, not a forecast and not advice")
NOTE_AS_OF = ("`as_of` is the newest event in the record ({day}); it is never the time of this read. UCT read the record "
              "from its vendor at {at} (UCT's own time), and each block carries its own newest date")
NOTE_NO_EVENT = ("the record UCT holds for {symbol} lists no split and no cash dividend, so `as_of` is null. UCT read the "
                 "record at {at} (UCT's own time). The record does not say whether every vendor read behind it "
                 "answered, so this is what is held, not proof that none happened")
NOTE_EMPTY_BLOCK = ("the record UCT holds for {symbol} lists no {what} in its {years}-year window. The record does not say "
                    "whether every vendor read behind it answered, so this is what is held, not proof that none happened")
NOTE_CUT = ("{total} {what} are held and the newest {shown} are returned, newest first: the list is cut from the OLD "
            "end")
NOTE_NO_RATIO = "{n} of the splits returned have no ratio the record can state; that ratio is null, never 0"
NOTE_LEFT_OUT = ("the company's name and ticker record (its former tickers) is not part of this record and is left out "
                 "of this answer. The Corporate actions panel (CACT) in UCT reads it separately")
NOTE_STALE = ("UCT read this record at {at}, more than {hours} hours ago, so a newer split or dividend may not be in it. "
              "This read never refreshes it: the stock's chart in UCT refreshes it when it is opened")
NOTE_NO_READ_TIME = ("the record carries no time UCT read it, so how old it is cannot be stated and it is marked stale. "
                     "This read never refreshes it")
NOTE_NOT_HELD = ("no splits or dividends are held for {symbol} on this server: they are held once the stock's chart has "
                 "been opened in UCT, and this read never asks the vendor. That is not the same as no splits or "
                 "dividends. Open the stock's chart in UCT, then ask again")
NOTE_FAILED = "the corporate actions read failed; nothing is stated. That is not the same as no splits or dividends"

WHAT_WORDS = {"splits": ("split", "splits"), "dividends": ("cash dividend", "cash dividends")}


def _clean(v: Any) -> Optional[str]:
    """The route's own spelling of a ticker (`ticker_resolver.route_symbol`: BRK.B -> BRK-B), or None."""
    from api.services.ticker_resolver import route_symbol
    return route_symbol(v.strip().lstrip("$")) if isinstance(v, str) and v.strip() else None


def validate(params: dict) -> Optional[str]:
    """Pure parameter check, run by the gateway BEFORE admission, so a malformed request spends no read."""
    if not isinstance(params, dict):
        return "the request must be an object"
    if _clean(params.get("symbol")) is None:
        return "`symbol` must be one US stock ticker"
    n = params.get("rows", DEFAULT_ROWS)
    if not isinstance(n, int) or isinstance(n, bool) or not 1 <= n <= MAX_ROWS:
        return f"`rows` must be a whole number from 1 to {MAX_ROWS}"
    return None


def held_answer(sym: str) -> dict:
    """READ ONLY: the record the route's service holds for `sym` (`corporate_actions_held.held_actions`), which reads
    the chart markers record on this server's disk and never asks the vendor or starts a build."""
    from api.services import corporate_actions_held as svc
    return svc.held_actions(sym)


def refresh_seconds() -> int:
    """The chart's own refresh age for this record (`earnings_estimates._MARKERS_REFRESH_SECONDS`), read at call time."""
    from api.services import earnings_estimates as ee
    return int(ee._MARKERS_REFRESH_SECONDS)


def _split(r: Any) -> Optional[dict]:
    if not isinstance(r, dict) or _day(r.get("date")) is None:
        return None
    ratio = r.get("ratio")
    factor = _num(r.get("to_factor"))
    return {"date": _day(r["date"]),
            "ratio": ratio.strip()[:MAX_RATIO_CHARS] if isinstance(ratio, str) and ratio.strip() else None,
            "to_factor": factor if factor is not None and factor > 0 else None}


def _dividend(r: Any) -> Optional[dict]:
    if not isinstance(r, dict) or _day(r.get("date")) is None:
        return None
    amount = _num(r.get("amount"))
    if amount is None or amount <= 0:                  # the service drops these; a row with no amount is not a dividend
        return None
    return {"date": _day(r["date"]), "amount": amount}


def _block(raw: Any, read_row) -> Optional[dict]:
    if not isinstance(raw, dict) or not isinstance(raw.get("rows"), list):
        return None
    rows = [x for x in (read_row(r) for r in raw["rows"]) if x]
    rows.sort(key=lambda r: r["date"], reverse=True)                       # newest first
    total = _whole(raw.get("total"))
    return {"rows": rows, "total": max(total if total is not None else 0, len(rows)),
            "window_years": _whole(raw.get("window_years"))}


def read_corporate_actions(params: dict, ctx: dict) -> dict:  # noqa: ARG001 — no per-user state
    why = validate(params)
    if why:
        return env.unavailable(KIND, params, SOURCE, why)
    sym, limit = _clean(params["symbol"]), params.get("rows", DEFAULT_ROWS)
    try:
        got = held_answer(sym)                                 # the held record only: never a vendor request
        refresh_s = refresh_seconds()
    except Exception:  # noqa: BLE001 — a failing read is an honest unavailable, never "no splits"
        return env.unavailable(KIND, params, SOURCE, NOTE_FAILED)
    if not isinstance(got, dict):
        return env.unavailable(KIND, params, SOURCE, NOTE_FAILED)
    if got.get("status") == "not_held":
        return env.unavailable(KIND, params, SOURCE, NOTE_NOT_HELD.format(symbol=sym))
    blocks = {"splits": _block(got.get("splits"), _split), "dividends": _block(got.get("dividends"), _dividend)}
    if got.get("status") != "ok" or any(b is None for b in blocks.values()):
        return env.unavailable(KIND, params, SOURCE, NOTE_FAILED)

    read_at = _read_at(got.get("held_at")) if got.get("held_at") else None
    at = read_at or "a time it did not record"
    newest = {k: (b["rows"][0]["date"] if b["rows"] else None) for k, b in blocks.items()}
    days = [d for d in newest.values() if d]
    day = max(days) if days else None
    years = {k: blocks[k]["window_years"] for k in BLOCKS}
    age = None
    if read_at:
        age = time.time() - datetime.fromisoformat(read_at.replace("Z", "+00:00")).timestamp()
    stale = read_at is None or age > refresh_s

    notes = [NOTE_WHAT.format(symbol=sym, split_years=years["splits"] if years["splits"] is not None else "some",
                              dividend_years=years["dividends"] if years["dividends"] is not None else "some")]
    notes.append(NOTE_AS_OF.format(day=day, at=at) if day else NOTE_NO_EVENT.format(symbol=sym, at=at))
    out_blocks = {}
    for k in BLOCKS:
        b = blocks[k]
        shown = b["rows"][:limit]
        if day and not b["rows"]:
            notes.append(NOTE_EMPTY_BLOCK.format(symbol=sym, what=WHAT_WORDS[k][0],
                                                 years=years[k] if years[k] is not None else "held"))
        if b["total"] > len(shown):
            notes.append(NOTE_CUT.format(total=b["total"], what=WHAT_WORDS[k][1], shown=len(shown)))
        out_blocks[k] = {"rows": shown, "count": len(shown), "total": b["total"], "cut": b["total"] > len(shown),
                         "window_years": years[k], "as_of": newest[k]}
    out_blocks["dividends"]["basis"] = BASIS if (got.get("dividends") or {}).get("basis") == BASIS else None
    no_ratio = sum(1 for r in out_blocks["splits"]["rows"] if r["ratio"] is None)
    if no_ratio:
        notes.append(NOTE_NO_RATIO.format(n=no_ratio))
    notes.append(NOTE_LEFT_OUT)
    if read_at is None:
        notes.append(NOTE_NO_READ_TIME)
    elif stale:
        notes.append(NOTE_STALE.format(at=read_at, hours=refresh_s // 3600))

    data = {"symbol": sym, "state": "ok", "splits": out_blocks["splits"], "dividends": out_blocks["dividends"],
            "as_of": day, "read_at": read_at, "left_out": list(LEFT_OUT)}
    total = sum(blocks[k]["total"] for k in BLOCKS)
    shown_n = sum(out_blocks[k]["count"] for k in BLOCKS)
    coverage = {"evaluated": total, "answered": shown_n, "dropped": total - shown_n, "not_computable": no_ratio}
    return env.make_envelope(KIND, params, status="ok", freshness="historical", as_of=day_as_of(day), source=SOURCE,
                             data=data, stale=stale, coverage=coverage, notes=notes, provider_calls=0)
