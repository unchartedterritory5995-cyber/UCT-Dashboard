"""MD-1 kind `ownership.funds` (owner: terminal-data, data wave 10) — the registered funds that hold one stock, as held.

Which mutual funds and ETFs hold one stock, from the SEC's quarterly Form N-PORT data sets: how many funds hold it, how
many added, cut, held unchanged, opened a new position or sold out since each fund's previous report, the shares the
funds with both reports held against their previous reports (the net change is the difference of those two figures), the
largest holders by value with each one's change, how much of the data set could be matched to a ticker, and the data
set's quarter. The Agent half of the OWN panel's "Funds (N-PORT)" block, over the `funds_nport` block of
`GET /api/research/ownership/{sym}` (`api/services/fund_holders_nport.py`), with the block's own field names.

⛔ ONLY THE INDEX THE SERVER ALREADY HOLDS, NEVER A DOWNLOAD (MD-1 §5). The data sets are downloaded and the index built
only by the scheduled run (`fund_holders_nport.run_scheduled`, daily at 00:50 New York time; two zip downloads of
hundreds of MB from the SEC when a new quarter is posted). The block's own request path, `fund_holders_nport.answer_for`,
is one read-only SQLite read of the held index that never downloads, never builds and never waits; this adapter reads
through it and nothing else. provider_calls is always 0. A rail shows the scheduled entry starting a run, and the read
starting none.

NOTHING READ IS SAID, NEVER "NO FUND HOLDS IT": an index not built yet is `unavailable`, said as "not read yet"; a stock
no fund holding could be matched to says that, never that no fund holds it; an index that could not be read is
`unavailable`. A fund's change across a stock split that could not be checked is "not comparable", never an add or a
cut.

WHAT IS STATED: every count, share figure and fund row is the block's own, passed through; nothing is recomputed here.
A figure a filing did not carry is null, never 0. No CUSIP is stored or returned.

THE CUT IS STATED: the holders return the top `rows` by value (the index keeps the top 50), cut from the SMALL end, and
the sold-out funds the top `rows`, with each list's whole count beside it.

TIME (MD-1 §3): `as_of` = the end of the newest fund report period in the block (each fund reports for its own period),
as the start of that day in New York; never the time of the read. When UCT built the index rides as
`data.data_set.built_at`. A run that did not finish rides as `check`, with a note. Every read is `periodic`, as the kind
is declared.

MODEL-ISOLATED (ADR-005; when in doubt, isolate): the licensing register
(docs/terminal-research/09-security-licensing-cost/licensing-register.md) clears the N-PORT fund holdings for member
display and storage in the OWN panel only: row T-104 (public domain) says "Nothing else reads it yet (no AI
lane, no export, no external publication)". No row clears this block for a model provider. Shown to the member only;
the capability is local-only.
"""
from __future__ import annotations

from typing import Any, Optional

from api.services.uct_agent.marketdata import envelope as env
from api.services.uct_agent.marketdata.short_interest import _day, _num, _whole, day_as_of
from api.services.uct_agent.marketdata.stock_stats_read import check_params, clean_symbol, tree

KIND = "ownership.funds"
SOURCE = "sec-form-nport"
DEFAULT_ROWS = 10           # holders (and sold-out funds) returned
MAX_ROWS = 50               # fund_holders_nport.DISPLAY_ROWS (a rail pins the two together)
#: the block's own states (fund_holders_nport.answer_for)
STATES = ("ok", "none_now", "not_matched", "not_built", "unavailable")
#: a holder's change, by the index's own words (fund_holders_nport_data.STATES; a rail pins the two together)
CHANGE_STATES = ("added", "cut", "unchanged", "new", "no_prior", "not_comparable")
HOLDER_FIELDS = ("name", "family", "shares", "value", "pct", "period", "prior_shares", "prior_value", "prior_period",
                 "change_shares", "change_pct", "state", "url")
SOLD_FIELDS = ("name", "family", "prior_shares", "prior_value", "prior_period", "period", "url")
SUMMARY_FIELDS = ("funds", "shares", "value", "value_complete", *CHANGE_STATES, "sold_out", "both_now", "both_prior",
                  "period_from", "period_to", "tier", "votes", "splits")
#: a run that did not finish, by its own state (fund_holders_nport.build)
CHECK_WORDS = {"stopped": "the SEC's website refused it, or it ran out of time", "failed": "the read failed",
               "shape": "the data set was not in the layout it reads", "low_disk": "the server had too little disk space"}

NOTE_WHAT = ("the registered funds (mutual funds and ETFs) holding {symbol}, as UCT holds them from the SEC's quarterly "
             "Form N-PORT data sets ({quarter} data set): how many funds hold it, the changes since each fund's previous "
             "report (added, cut, unchanged, new, sold out), the largest holders by value with each one's change, and how "
             "much of the data set was matched to a ticker. A report says what a fund held on its period's last day, not "
             "what it did or when. Filings, not advice")
NOTE_AS_OF = ("`as_of` is the end of the newest fund report period in the block ({day}); it is never the time of the "
              "read. Each fund reports for its own period ({start} to {end}), a fund files within 60 days after its "
              "quarter ends and the SEC posts these data sets once a quarter, so the newest report can be months old. "
              "UCT built the index at {built} (UCT's own time)")
NOTE_NO_PERIOD = ("no fund in the block carries a report period, so `as_of` is null. UCT built the index at {built} "
                  "(UCT's own time)")
NOTE_NOT_MATCHED = ("no fund holding in the newest N-PORT data set ({quarter}) could be matched to {symbol}. That is not "
                    "the same as no fund holding it")
NOTE_NONE_NOW = "no fund's current report holds {symbol}; the funds returned held it at their previous report"
NOTE_NO_PRIOR = "the data set before it could not be read, so no change is stated: that is not a change of 0"
NOTE_NOT_COMPARABLE = ("{n} funds' changes are not comparable (a stock split may fall between their two reports and could "
                       "not be checked): they are counted neither as added nor as cut")
NOTE_CUT_HOLDERS = "{total} funds hold it and the top {shown} by value are returned: the list is cut from the SMALL end"
NOTE_CUT_SOLD = "{total} funds sold out of it and the top {shown} by their previous value are returned: the list is cut from the SMALL end"
NOTE_COVERAGE = ("across the data set, {pct}% of the funds' common-stock holdings by value were matched to a ticker; a "
                 "fund whose holding could not be matched is not counted")
NOTE_CHECK = ("UCT's last attempt to read a newer data set did not finish ({why}): the index held is the last one read, "
              "and this read never downloads")
NOTE_NOT_READ = ("the SEC's Form N-PORT data sets have not been read on this server yet, so the funds holding {symbol} "
                 "are not stated. That is not the same as no fund holding it. This read never downloads them; the "
                 "server reads them on its own schedule")
NOTE_UNREADABLE = "the fund holdings index could not be read; nothing is stated. That is a gap in the read, not a finding"
NOTE_FAILED = "the fund holdings read failed; nothing is stated. That is not the same as no fund holding it"


def validate(params: dict) -> Optional[str]:
    """Pure parameter check, run by the gateway BEFORE admission, so a malformed request spends no read."""
    return check_params(params, MAX_ROWS, DEFAULT_ROWS)


def held_answer(sym: str) -> dict:
    """READ ONLY: the block for `sym` from the held index (`fund_holders_nport.answer_for`: one read-only SQLite read),
    WITHOUT downloading, building or waiting."""
    from api.services import fund_holders_nport as svc
    return svc.answer_for(sym)


def _pick(row: Any, fields: tuple) -> dict:
    return {k: tree(row.get(k)) for k in fields} if isinstance(row, dict) else {}


def read_funds(params: dict, ctx: dict) -> dict:  # noqa: ARG001 — no per-user state
    why = validate(params)
    if why:
        return env.unavailable(KIND, params, SOURCE, why)
    sym, limit = clean_symbol(params["symbol"]), params.get("rows", DEFAULT_ROWS)
    try:
        got = held_answer(sym)                                    # the held index only: never a download
    except Exception:  # noqa: BLE001 — a failing read is an honest unavailable, never "no fund holds it"
        return env.unavailable(KIND, params, SOURCE, NOTE_FAILED)
    state = got.get("state") if isinstance(got, dict) else None
    if state == "not_built":
        return env.unavailable(KIND, params, SOURCE, NOTE_NOT_READ.format(symbol=sym))
    if state == "unavailable":
        return env.unavailable(KIND, params, SOURCE, NOTE_UNREADABLE)
    if state not in ("ok", "none_now", "not_matched") or not isinstance(got.get("data_set"), dict):
        return env.unavailable(KIND, params, SOURCE, NOTE_FAILED)

    ds_raw = got["data_set"]
    data_set = {k: tree(ds_raw.get(k)) for k in ("quarter", "prior_quarter", "built_at", "periods", "prior_missing", "splits")}
    cov_raw = got.get("coverage") if isinstance(got.get("coverage"), dict) else {}
    coverage_block = {k: tree(cov_raw.get(k)) for k in ("matched_value_pct", "matched_rows_pct", "pct_units")}
    summary = _pick(got.get("summary"), SUMMARY_FIELDS) if isinstance(got.get("summary"), dict) else None
    holders = [_pick(h, HOLDER_FIELDS) for h in (got.get("holders") or []) if isinstance(h, dict)]
    sold = [_pick(h, SOLD_FIELDS) for h in (got.get("sold_out") or []) if isinstance(h, dict)]
    holders_total = max(_whole(got.get("holders_total")) or 0, len(holders))
    sold_total = max(_whole(got.get("sold_out_total")) or 0, len(sold))
    check = tree(got.get("check")) if isinstance(got.get("check"), dict) else None
    quarter = data_set["quarter"] if isinstance(data_set["quarter"], str) else "not given"
    built = data_set["built_at"] if isinstance(data_set["built_at"], str) else "a time it did not record"
    periods = data_set["periods"] if isinstance(data_set["periods"], dict) else {}
    day = _day((summary or {}).get("period_to")) or _day(periods.get("to"))
    start = _day((summary or {}).get("period_from")) or _day(periods.get("from")) or day

    notes = [NOTE_WHAT.format(symbol=sym, quarter=quarter),
             NOTE_AS_OF.format(day=day, start=start, end=day, built=built) if day else NOTE_NO_PERIOD.format(built=built)]
    if state == "not_matched":
        notes.append(NOTE_NOT_MATCHED.format(quarter=quarter, symbol=sym))
    elif state == "none_now":
        notes.append(NOTE_NONE_NOW.format(symbol=sym))
    if not data_set["prior_quarter"]:
        notes.append(NOTE_NO_PRIOR)
    apart = _whole((summary or {}).get("not_comparable")) or 0
    if apart:
        notes.append(NOTE_NOT_COMPARABLE.format(n=apart))
    if holders_total > min(len(holders), limit):
        notes.append(NOTE_CUT_HOLDERS.format(total=holders_total, shown=min(len(holders), limit)))
    if sold_total > min(len(sold), limit):
        notes.append(NOTE_CUT_SOLD.format(total=sold_total, shown=min(len(sold), limit)))
    pct = _num(coverage_block["matched_value_pct"])
    if pct is not None:
        notes.append(NOTE_COVERAGE.format(pct=pct))
    if check is not None:
        notes.append(NOTE_CHECK.format(why=CHECK_WORDS.get(check.get("state"), CHECK_WORDS["failed"])))

    # every key below is the block's own name (the OWN panel's N-PORT model reads them)
    data = {"symbol": sym, "state": state, "source": got.get("source") if isinstance(got.get("source"), str) else None,
            "data_set": data_set, "coverage": coverage_block, "summary": summary, "holders": holders[:limit],
            "holders_total": holders_total, "holders_limit": _whole(got.get("holders_limit")), "sold_out": sold[:limit],
            "sold_out_total": sold_total, "check": check}
    coverage = {"evaluated": holders_total, "answered": min(len(holders), limit), "dropped": holders_total - min(len(holders), limit),
                "not_computable": sum(1 for h in holders[:limit] if h.get("state") in ("no_prior", "not_comparable"))}
    return env.make_envelope(KIND, params, status="ok", freshness="periodic", as_of=day_as_of(day) if day else None,
                             source=SOURCE, data=data, stale=check is not None, coverage=coverage, notes=notes,
                             provider_calls=0)
