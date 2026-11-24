"""The Screener's three short-interest columns, `short_float_pct`, `short_ratio` and (2026-11-23)
`short_interest_chg_pct`: ONE writer.

Where each value comes from, per stock and PER COLUMN, in this order:

  1. the FINRA short-interest list the server already holds (`api.services.short_data`: what
     broker-dealers report to FINRA twice a month, read once per report and kept in the web
     process and on its data volume):

       short_ratio      the list's `days_to_cover`: shares short divided by the average daily
                        volume, in DAYS.
       short_float_pct  the list's `short_interest` (shares) divided by TONIGHT'S float (the
                        nightly export's "Shares Float", the same number this build writes to
                        the row's `float_shares`) x 100, a PERCENT (3.45 means 3.45%, never the
                        fraction 0.0345). The arithmetic is `short_data.pct_of_float`, the one
                        the Terminal's short interest screens use.

  2. else the nightly export's own figure (`finviz_universe.read_short_export`), for a stock the
     list does not have, when no list is held, or when the list has the stock and cannot give
     that one column (no float on file for the percent; no days to cover in the report);

  3. else the key is ABSENT, and the row's column stays NULL. A missing number is never a 0:
     a stock with zero shares short has a real 0, a stock nobody reported on has nothing.

WHY THE PERCENT IS WORKED OUT HERE and the list's own `pct_float` is not copied: the list divides
by the float it found on the day the report was first read and keeps that figure until the next
report, about two weeks. The row beside it carries tonight's float. Dividing by tonight's float
keeps the three numbers on one row in agreement (short percent x float = FINRA's shares short) and
keeps ONE float on the row instead of two vintages of it.

THE CHANGE SINCE THE PRIOR REPORT (2026-11-23), `short_interest_chg_pct`: the list row's own `change_pct`, the
percent change in shares short from the report before (the previous settlement date) to the newest one, worked
out once when the list is read (`short_data.change_of`, the figure SHINT shows per stock). From the same one read
of the list as the two columns above, the list first as for `short_float_pct`; the nightly export has no previous
report, so there is no second source: a stock the list does not have, one with no previous report, or one whose
previous report was 0 shares (a change from 0 has no percent) has the key ABSENT. SHINT's up / down ranking also
asks for at least `short_data.FLOOR_SHARES` shares short in the previous report; this column has no floor, so a
small base can give a large percent. The receipt counts it (`short_interest_chg_pct`), and names both dates.

A percent above `PCT_MAX` (100) is not written from the list: the Screener holds this column to
[0, 100] (`identities._SHARE_OF_TOTAL`), and a larger figure means the float and the short
interest do not describe the same share count (an offering or a split since the settlement date).
Such a stock is counted `withheld` and takes the export's figure, as before this module existed.

NOTHING IS BUILT HERE. The list is read through `short_data.held_market_rows`, which returns what
is held and never starts a build, a check or a vendor request. With no list held (a fresh server
before its first build, a refused data plan, a failed build) every stock takes the export's
figure, which is what the Screener showed before this module existed.

AS OF. FINRA publishes twice a month, after the close on the 7th business day after each
settlement date, so a value from the list is as of the list's settlement date, not the snapshot's
date. The receipt and the log line carry that date; the column help text says the cadence.

ONE LOG LINE per call, prefix `[screener-short]`: how many stocks took each source per column and
the median absolute difference between the two sources where both have a figure. Counts only, no
tickers. The same counts are the `receipt` the build stores in its stats.
"""
from __future__ import annotations

import logging
import statistics

from . import finviz_universe

log = logging.getLogger(__name__)

LOG_PREFIX = "[screener-short]"
#: The Screener's own bound on `short_float_pct` (see `identities._SHARE_OF_TOTAL`).
PCT_MAX = 100.0
#: Where a value came from, for the receipt.
FROM_LIST = "list"
FROM_EXPORT = "export"
#: The change in shares short since the prior report: from the list only (2026-11-23).
CHANGE_COLUMN = "short_interest_chg_pct"


def _note(failures, outcome) -> None:
    if failures is None:
        return
    failures.setdefault("short_columns", {})
    failures["short_columns"][outcome] = failures["short_columns"].get(outcome, 0) + 1


def _number(v):
    """A finite number that is not negative, as a float; anything else is None."""
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        return None
    f = float(v)
    if f != f or f in (float("inf"), float("-inf")) or f < 0:
        return None
    return f


def _signed(v):
    """A finite number of either sign, as a float; anything else is None."""
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        return None
    f = float(v)
    return None if f != f or f in (float("inf"), float("-inf")) else f


def _read_held_list(failures):
    """`(rows by symbol | None, state, held answer | None, percent-of-float function | None)` from
    the held list. Read only.

    state: 'held' | 'not_held' (nothing held and nothing said) | 'unavailable' / 'failed' (nothing
    held, and the last build's answer still stands) | 'error' (the read itself raised: counted,
    and every stock takes the export's figure)."""
    try:
        from api.services import short_data
        answer, how = short_data.held_market_rows()
        pct_of_float = short_data.pct_of_float
    except Exception as e:  # noqa: BLE001 -- the export's figures must survive a dead list
        _note(failures, f"list_error:{type(e).__name__}")
        return None, "error", None, None
    if how == "held" and isinstance(answer, dict) and isinstance(answer.get("rows"), dict):
        return answer["rows"], "held", answer, pct_of_float
    status = answer.get("status") if isinstance(answer, dict) else None
    return None, (status if status in ("unavailable", "failed") else "not_held"), None, None


def _tally() -> dict:
    return {FROM_LIST: 0, FROM_EXPORT: 0, "export_in_list": 0, "none": 0, "both": 0,
            "median_abs_diff": None}


def _settle(tally: dict, row: dict, column: str, listed, exported, in_list: bool, diffs: list) -> None:
    """Write `column` on `row` from the list's figure, else the export's, else not at all."""
    if listed is not None and exported is not None:
        tally["both"] += 1
        diffs.append(abs(listed - exported))
    if listed is not None:
        tally[FROM_LIST] += 1
        value = listed
    elif exported is not None:
        tally[FROM_EXPORT] += 1
        tally["export_in_list"] += 1 if in_list else 0
        value = exported
    else:
        tally["none"] += 1
        return
    if column == "short_float_pct":
        row["short_float_pct"] = value
    else:
        row["short_ratio"] = value


def read_short_columns(targets, failures=None, receipt=None) -> dict:
    """{TICKER: {"short_float_pct"?, "short_ratio"?, "short_interest_chg_pct"?}} with PER-COLUMN presence: a
    key is there only when a source gave a number for it. Units: `short_float_pct` PERCENT, `short_ratio`
    DAYS, `short_interest_chg_pct` PERCENT CHANGE in shares short since the prior report (the list only).

    `receipt`, when a dict is passed, is filled with what this call did (counts only):
      list                 'held' | 'not_held' | 'unavailable' | 'failed' | 'error'
      settlement_date      the held report's settlement date (None when no list is held)
      previous_settlement_date  the report's the change is measured from (None when none is held)
      publication_estimate when FINRA's schedule published that report
      list_read_at         when the server read it from the vendor
      targets, in_list     stocks asked for; how many of them the held list has
      withheld             stocks whose list percent was not written (over `PCT_MAX`, or over
                           `short_data.PCT_FLOAT_MAX`): the export's percent was used instead
      short_float_pct /    {list, export, export_in_list, none, both, median_abs_diff}: stocks that
      short_ratio          took the list's figure, the export's, neither; `export_in_list` is the
                           part of `export` where the list HAS the stock and not this column;
                           `both` is how many stocks have a figure from both sources and
                           `median_abs_diff` the median absolute difference across those (percent
                           points; days), None when there are none
      short_interest_chg_pct  {list, none}: stocks that took the list's change, and stocks with none
    """
    names = [str(t).upper() for t in (targets or ())]
    exported = finviz_universe.read_short_export(names, failures)
    listed, state, held, pct_of_float = _read_held_list(failures)

    out: dict = {}
    pct_tally, ratio_tally = _tally(), _tally()
    chg_tally = {FROM_LIST: 0, "none": 0}
    pct_diffs: list = []
    ratio_diffs: list = []
    in_list = withheld = 0
    for name in names:
        ex = exported.get(name) or {}
        li = listed.get(name.replace(".", "-")) if listed is not None else None
        if not isinstance(li, dict):
            li = None
        in_list += 1 if li is not None else 0

        list_pct = list_ratio = list_chg = None
        if li is not None:
            list_chg = _signed(li.get("change_pct"))
            list_ratio = _number(li.get("days_to_cover"))
            if list_ratio is not None:
                list_ratio = round(list_ratio, 2)
            short = _number(li.get("short_interest"))
            list_pct, held_back = pct_of_float(
                int(round(short)) if short is not None else None, _number(ex.get("float_shares")))
            if list_pct is not None and list_pct > PCT_MAX:
                list_pct, held_back = None, True
            withheld += 1 if held_back else 0

        row: dict = {}
        _settle(pct_tally, row, "short_float_pct", list_pct, _number(ex.get("short_float_pct")),
                li is not None, pct_diffs)
        _settle(ratio_tally, row, "short_ratio", list_ratio, _number(ex.get("short_ratio")),
                li is not None, ratio_diffs)
        if list_chg is not None:
            row["short_interest_chg_pct"] = list_chg          # CHANGE_COLUMN, spelled out for the scalar census
        chg_tally[FROM_LIST if list_chg is not None else "none"] += 1
        out[name] = row

    pct_tally["median_abs_diff"] = round(statistics.median(pct_diffs), 3) if pct_diffs else None
    ratio_tally["median_abs_diff"] = round(statistics.median(ratio_diffs), 3) if ratio_diffs else None
    said = {
        "list": state,
        "settlement_date": held.get("settlement_date") if held else None,
        "previous_settlement_date": held.get("previous_settlement_date") if held else None,
        "publication_estimate": held.get("publication_estimate") if held else None,
        "list_read_at": held.get("read_at") if held else None,
        "targets": len(names), "in_list": in_list, "withheld": withheld,
        "short_float_pct": pct_tally, "short_ratio": ratio_tally, CHANGE_COLUMN: chg_tally,
    }
    if receipt is not None:
        receipt.clear()
        receipt.update(said)
    log.info("%s %s", LOG_PREFIX, log_text(said))
    return out


def _part(name: str, tally: dict) -> str:
    return (f"{name} list={tally[FROM_LIST]} export={tally[FROM_EXPORT]} "
            f"export_in_list={tally['export_in_list']} none={tally['none']} both={tally['both']} "
            f"median_abs_diff={tally['median_abs_diff']}")


def log_text(said: dict) -> str:
    """The one comparison line for a receipt. Counts and dates only: never a ticker."""
    return (f"list={said['list']} settlement={said['settlement_date']} targets={said['targets']} "
            f"in_list={said['in_list']} withheld={said['withheld']} | "
            f"{_part('short_float_pct', said['short_float_pct'])} | "
            f"{_part('short_ratio', said['short_ratio'])}")
