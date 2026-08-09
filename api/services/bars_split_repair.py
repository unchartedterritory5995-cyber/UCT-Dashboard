"""Heal an un-back-adjusted split IN THE STORE — the rows, not each reader.

🔴 THE DEFECT. `bars_sanitize` carries a split self-heal, and by its own
docstring it is a *"READ-ONLY transform of the SERVED bars — never touches the
SQLite store"*, applied on the `/api/bars` path alone. `bars_sqlite.get_bars` is
a bare `SELECT`, and it is what the indicator alert evaluator, the nightly
screener build (`snapshot_builder._read_daily_bars`) and the universe scan
(`scan_evaluator._read_bars`) all read. So a split the chart healed left every
other lane computing across two price scales. Measured on the live store,
2026-08-09:

    DD   (split 2026-06-18 in our data, 1-for-3)
         SMA200  50.1915  vs  133.8873 independent   (−62.5%)
         ATR14    5.6186  vs    4.4766 independent   (+25.5%)  ← feeds sizing
    ABTC (split 2026-07-06, 1-for-15)
         SMA200   2.3352  vs   24.9335 independent   (−90.6%)

⭐ HEAL ON WRITE, NOT A HEALED READ DOOR — AND THE CHOICE IS NOT A TASTE CALL.
The alternative was to make `bars_sqlite.get_bars` sanitize on the way out.
Three things decide it:

  1. **`bars_sanitize`'s split metadata is read from cache ONLY, never fetched**
     — a deliberate invariant (the 524 outage: no unbounded external call on a
     serve path). A read-door heal is therefore only as healed as a cache that
     may be cold, so the number a scan returns would depend on whether some
     other request happened to warm that ticker first. The 05:00 ET sweep on a
     freshly-deployed pod would read 3,742 un-healed series and say nothing.
     *A derived value must not depend on the request.*
  2. **A read door cannot reach a `GROUP BY`.** `bars_sqlite` exposes nine
     aggregate readers that never materialise a bar list — `closes_asof`,
     `close_n_sessions_back`, `avg_daily_volume`, `max_daily_volume_in_range`,
     `avg_dollar_volume_bulk`, `current_listing_starts`, … Those feed breadth
     and RS. Only correcting the ROWS corrects them.
  3. **Idempotence is structural here and nowhere else.** The detector fires on
     an OBSERVED split-sized discontinuity; once the rows are adjusted the
     observed ratio at that boundary is ≈ 1, nothing matches, and a second pass
     rewrites nothing. So repeating the repair cannot compound, and a row that
     was already correct is never touched.

⛔ AND THERE IS STILL EXACTLY ONE IMPLEMENTATION OF THE SPLIT JUDGEMENT.
`bars_sanitize.unadjusted_splits` / `split_factor` / `scale_bar` are imported,
not re-derived. A second detector living here would be a second authority over
one value — the defect this repo has paid for three times — and it would drift
the first time somebody widened a tolerance on one side.

⛔ AND IT WRITES THROUGH `bars_sqlite.put_bars`, the store's single write
chokepoint (write lock, lock retry, corruption recovery, and any write-path
invariant that gets added there). A repair that opened its own connection would
be outside every guard the store has.

Kill switch: `BARS_SPLIT_REPAIR_ENABLED=0` (default on).
"""
from __future__ import annotations

import logging
import os
from datetime import date
from typing import Iterable, Optional, Sequence

from api.services import bars_sanitize as _san

_log = logging.getLogger(__name__)

#: The whole series, because a split factor applies to EVERY bar before the
#: boundary and a truncated read would leave the deep tail on the old scale —
#: a repair that creates a second discontinuity further back.
_MAX_ROWS = 500_000

#: Timeframes the split heal is defined for. Intraday rows are not back-adjusted
#: by this module: the store's intraday history is short and provider-adjusted,
#: and `bars_sanitize` itself passes intraday through untouched.
REPAIR_TFS = ("D", "W", "M")


def enabled() -> bool:
    return os.environ.get("BARS_SPLIT_REPAIR_ENABLED", "1") != "0"


def _read_series(ticker: str, tf: str) -> list[dict]:
    """Every stored bar for (ticker, tf) as sanitize-shaped dicts.

    ⚠️ `t` IS KEPT AS THE STORE'S OWN KEY (a `YYYYMMDD` int) and handed back to
    `put_bars` verbatim. `bars_sanitize._pd` parses `str(t)[:10]`, which reads
    `"20260618"` as an ISO date fine, so the detector needs no re-encoding — and
    not re-encoding is the point: a repair that reformatted the key could write
    a row under a different primary key than the one it read.
    """
    from api.services import bars_sqlite
    rows = bars_sqlite.get_bars(ticker.upper(), tf, _MAX_ROWS) or []
    out: list[dict] = []
    for r in rows:
        out.append({"t": r[0], "o": r[1], "h": r[2], "l": r[3], "c": r[4], "v": r[5]})
    return out


def _splits_for(ticker: str) -> list[tuple[str, float]]:
    """The declared corporate actions, from the SAME cache `bars_sanitize` reads.

    ⛔ CACHE ONLY — no synchronous fetch. This runs on a background worker, but
    it is reached from a serve-path detection, and a repair that could block on
    FMP would put an unbounded external call one thread away from the request
    path. A cold cache means "nothing to do yet"; `bars_sanitize._meta_cached`
    has already scheduled the warm and the next serve will find it.
    """
    meta = _san._meta_cached(ticker.upper()) or {}
    return list(meta.get("splits") or [])


def plan_repair(ticker: str, tf: str,
                bars: Optional[Sequence[dict]] = None,
                splits: Optional[Sequence[tuple[str, float]]] = None,
                ) -> dict:
    """What a repair WOULD write, computed and returned without writing.

    Returns ``{"ticker", "tf", "boundaries": [(iso_date, ratio)], "rows": [bar],
    "scanned": int}`` where ``rows`` are the rescaled bars that differ from what
    is stored. An empty ``boundaries`` means nothing is unadjusted.
    """
    ticker = ticker.upper()
    series = list(bars) if bars is not None else _read_series(ticker, tf)
    declared = list(splits) if splits is not None else _splits_for(ticker)
    result = {"ticker": ticker, "tf": tf, "boundaries": [], "rows": [],
              "scanned": len(series)}
    if not series or not declared:
        return result

    unadjusted = _san.unadjusted_splits(series, declared)
    if not unadjusted:
        return result
    result["boundaries"] = [(b.isoformat(), r) for b, r in unadjusted]

    changed: list[dict] = []
    for b in series:
        bd = _san._pd(b["t"])
        if bd is None:
            continue
        f = _san.split_factor(bd, unadjusted)
        if f == 1.0:
            continue
        scaled = _san.scale_bar(dict(b), f)
        changed.append(scaled)
    result["rows"] = changed
    return result


def repair_ticker(ticker: str, tf: str = "D", *,
                  splits: Optional[Sequence[tuple[str, float]]] = None,
                  apply: bool = False) -> dict:
    """Detect and (when ``apply``) rewrite one (ticker, tf)'s stale pre-split rows.

    ``apply=False`` is a genuine dry run: it reads, computes and reports, and
    touches nothing. The summary is the same shape either way so a sweep can
    report a plan and an application in one format.
    """
    ticker = ticker.upper()
    summary = {"ticker": ticker, "tf": tf, "boundaries": [], "changed": 0,
               "written": 0, "scanned": 0, "applied": False, "skipped": None}
    if not enabled():
        summary["skipped"] = "disabled"
        return summary
    if tf not in REPAIR_TFS:
        summary["skipped"] = "tf-not-repairable"
        return summary

    plan = plan_repair(ticker, tf, splits=splits)
    summary["scanned"] = plan["scanned"]
    summary["boundaries"] = plan["boundaries"]
    summary["changed"] = len(plan["rows"])
    if not plan["rows"] or not apply:
        return summary

    from api.services import bars_sqlite
    # ⛔ `date_tf=False` — `t` is ALREADY the store's `YYYYMMDD` integer key, so
    # `put_bars` must int() it, not strip hyphens from an ISO string. Passing
    # True here would be a no-op on this shape today and a silent key rewrite
    # the day a caller hands ISO dates in.
    written = bars_sqlite.put_bars(ticker, tf, plan["rows"], date_tf=False)
    summary["written"] = int(written or 0)
    summary["applied"] = True
    _log.info("[split-repair] %s tf=%s boundaries=%s rewrote %d/%d rows",
              ticker, tf, plan["boundaries"], summary["written"], plan["scanned"])
    return summary


def repair_all_tfs(ticker: str, *, apply: bool = False,
                   splits: Optional[Sequence[tuple[str, float]]] = None,
                   ) -> list[dict]:
    return [repair_ticker(ticker, tf, splits=splits, apply=apply)
            for tf in REPAIR_TFS]


def sweep(tickers: Iterable[str], *, apply: bool = False,
          tfs: Sequence[str] = REPAIR_TFS) -> list[dict]:
    """Repair a list of tickers, isolating each one's failure.

    ⚠️ ONE TICKER'S EXCEPTION MUST NOT END THE SWEEP — a universe pass that dies
    on ticker 40 of 3,742 repairs 39 and reports success for the run.
    """
    out: list[dict] = []
    for t in tickers:
        for tf in tfs:
            try:
                out.append(repair_ticker(t, tf, apply=apply))
            except Exception as e:  # noqa: BLE001
                _log.warning("[split-repair] %s tf=%s failed: %s", t, tf, e)
                out.append({"ticker": str(t).upper(), "tf": tf, "error": str(e),
                            "boundaries": [], "changed": 0, "written": 0,
                            "scanned": 0, "applied": False})
    return out
