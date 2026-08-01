"""UCT Signature: Dark Pool Levels (dpl-v1).

Clusters confirmed dark-pool prints (darkpool_trades ONLY — never the
intraday preview table) into price bins and returns the top-K levels by
aggregate notional. Non-repainting by construction: input data is the
nightly-confirmed ledger of prints.
"""
from __future__ import annotations

import re
import time

from api.services.signature import rules

_MDY_RE = re.compile(r"^(\d{1,2})/(\d{1,2})/(\d{4})$")
_ISO_RE = re.compile(r"^(\d{4})-(\d{1,2})-(\d{1,2})$")


def _normalize_date(p) -> str:
    """Best-effort ISO ``YYYY-MM-DD`` so dates compare CHRONOLOGICALLY.

    ``lastDate`` is a max over these strings, and a lexicographic max over raw
    provider dates is wrong: "9/5" sorts ABOVE "12/31" because "9" > "1". With a
    20-trading-day window (~4 calendar weeks) the window spans a month boundary
    most months, so that misreports routinely, not rarely.

    Prefers ``dateRaw`` (M/D/YYYY, what ``darkpool_db.get_ticker_prints``
    carries) over the short display ``date`` (M/D). A bare M/D has no year, so
    it is returned UNCHANGED rather than guessed at -- assuming the current year
    would silently mis-order prints across a year boundary, trading a visible
    wrong answer for an invisible one. Anything unparseable is likewise returned
    as-is, so comparison degrades to a plain string max. Never raises.
    """
    raw = p.get("dateRaw") or p.get("date") or ""
    s = str(raw).strip()
    if not s:
        return ""
    for rx, order in ((_MDY_RE, "mdy"), (_ISO_RE, "ymd")):
        m = rx.match(s)
        if not m:
            continue
        a, b, c = (int(g) for g in m.groups())
        yy, mm, dd = (c, a, b) if order == "mdy" else (a, b, c)
        if 1 <= mm <= 12 and 1 <= dd <= 31:
            return f"{yy:04d}-{mm:02d}-{dd:02d}"
        return s
    return s


def cluster_levels(prints, *, bin_pct=None, min_notional=None, top_k=None):
    bin_pct = rules.DPL_BIN_PCT if bin_pct is None else bin_pct
    min_notional = rules.DPL_MIN_CLUSTER_NOTIONAL if min_notional is None else min_notional
    top_k = rules.DPL_TOP_K if top_k is None else top_k

    rows = [
        p for p in prints
        if (p.get("price") or 0) > 0 and (p.get("notional") or 0) > 0
    ]
    if not rows:
        return []

    prices = sorted(p["price"] for p in rows)
    median = prices[len(prices) // 2]
    bin_w = median * bin_pct
    if bin_w <= 0:
        return []

    # Adjacency clustering over price-sorted prints -- NOT a fixed grid.
    # A fixed grid (int(price // bin_w)) only guarantees that prints landing in
    # the SAME cell merge; two prints a fraction of a bin apart that straddle a
    # cell edge never merge. That is not a rounding artifact: bin_w is
    # median * bin_pct, so median / bin_w == 1 / bin_pct exactly, which puts a
    # grid edge precisely AT the median price -- the densest part of the
    # distribution, where clusters matter most. Prints straddling it always
    # split, silently halving a real level's notional and dropping it under
    # min_notional.
    #
    # Instead: walk prices ascending and keep extending the current cluster
    # while the print sits within one bin of the cluster's anchor (its lowest
    # price). Anchoring to the low -- rather than to the previous print --
    # caps every cluster at bin_w wide, so a chain of closely-spaced prints
    # can't chain-merge into one arbitrarily wide zone (single-linkage
    # chaining).
    clusters: list[dict] = []
    cur: dict | None = None
    for p in sorted(rows, key=lambda r: r["price"]):
        price = float(p["price"])
        if cur is None or price > cur["anchor"] + bin_w:
            cur = {"anchor": price, "notional": 0.0, "wsum": 0.0, "count": 0, "lastDate": ""}
            clusters.append(cur)
        cur["notional"] += float(p["notional"])
        cur["wsum"] += price * float(p["notional"])
        cur["count"] += 1
        d = _normalize_date(p)
        if d > cur["lastDate"]:
            cur["lastDate"] = d

    levels = []
    for b in clusters:
        if b["notional"] < min_notional:
            continue
        # Notional-weighted centre of the cluster. The reported zone is exactly
        # one bin wide, centred on it, so lo < price < hi always holds.
        price = b["wsum"] / b["notional"]
        levels.append({
            "price": price,
            "notional": b["notional"],
            "printCount": b["count"],
            "lastDate": b["lastDate"],
            "lo": price - bin_w / 2,
            "hi": price + bin_w / 2,
        })
    levels.sort(key=lambda l: l["notional"], reverse=True)
    levels = levels[:top_k]
    for i, l in enumerate(levels):
        l["rank"] = i + 1
    return levels


def fetch_dp_levels(sym: str) -> dict:
    """I/O wrapper: read confirmed prints, cluster, envelope."""
    from api import darkpool_db  # local import: keeps this module pure-testable

    prints = darkpool_db.get_ticker_prints(sym, days=rules.DPL_WINDOW_DAYS, limit=200)
    return {
        "sym": sym.upper(),
        "version": rules.VERSIONS["dpl"],
        "windowDays": rules.DPL_WINDOW_DAYS,
        "levels": cluster_levels(prints),
        "asOf": time.time(),
    }
