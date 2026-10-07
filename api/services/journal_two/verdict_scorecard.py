"""
Journal 2.0 — P6 Task P6-2: verdict-vs-outcome scorecard.

Scores Compass's GO/HOLD/SKIP pre-trade verdicts against actual closed-trade
outcomes — "did obeying the verdict help?". Sibling of `playbook_stats`: an
account-scoped read-only aggregate over closed `j2_trades`, Scope-aware via the
same FilterSpec WHERE splice, using the app-wide `winRate = wins/(wins+losses)`
convention (breakevens EXCLUDED from the decisive denominator).

The join (shipped in P1b, real + LIVE): a closed trade carries the verdict it was
entered against in its `context_at_entry` JSON TEXT column —
`{compass_verdict_id, compass_verdict_label}` — or `{}` when there was none.
Verdicts themselves live in `j2_verdicts`; there is NO trade FK (the link is
stored trade-side). Trades entered before the 🧭 verdict feature, broker-imported,
or CSV-imported carry `context_at_entry == '{}'` → they are EXCLUDED from the
scored buckets but COUNTED in the coverage denominator.

Output shape::

    { byVerdict: [
        {label:'GO',   taken:{n, winRate, avgR, netPnl}},
        {label:'HOLD', taken:{n, winRate, avgR, netPnl}},
        {label:'SKIP', overridden:{n, winRate, avgR, netPnl}, obeyed:<int>} ],
      coverage: {tradesWithVerdict, tradesTotal},
      skipOverrideHeadline: {n, lossRate, losses, decisive, netPnl} | null }

Bucketing (per closed trade, defensively parsed):
  * `context_at_entry` is `json.loads`'d in a try/except; a malformed body, a
    non-dict, or a missing/blank `compass_verdict_id` all → "no verdict" (never
    crashes). A trade WITH a `compass_verdict_id` is bucketed by its
    `compass_verdict_label`: GO/HOLD → the `taken` bucket, SKIP → the
    `overridden` bucket ("took it anyway"). A verdict-id trade whose label is
    none of GO/HOLD/SKIP still counts toward coverage but lands in no bucket.

Per-bucket metrics:
  * `n`      — trade count in the bucket.
  * `winRate = wins/(wins+losses)`, None when there are 0 decisive trades
    (breakevens excluded from the denominator — the app-wide convention).
  * `avgR`   — mean of the non-null `r_multiple`s (None when none present).
  * `netPnl  = Σ(pnl_dollar − fees)` — NET of fees, matching `_row_to_trade`'s
    `pnlDollarNet` (pnl_dollar is stored GROSS). Empty bucket → 0.0.

`SKIP.obeyed` is an ANTI-JOIN: the count of `j2_verdicts` rows (user + account_id
if given) with `label='SKIP'` whose `id` is NOT among the `compass_verdict_id`s
referenced across the user's `j2_trades.context_at_entry` — i.e. SKIP calls the
user actually respected (no trade taken). When the Scope carries date_from /
date_to, the verdict `created_at` is bounded to it (date-only compare).

`skipOverrideHeadline` is the hero stat ("you took a SKIP anyway → lost X"):
the overridden bucket's `n` (TOTAL overridden, breakevens included) + `netPnl`,
plus the DECISIVE-only `losses` and `decisive` (= wins+losses, breakevens
excluded) and `lossRate = losses/decisive`. Carrying `losses`/`decisive` lets the
FE render an honest integer count ("lost {losses} of {decisive}") instead of an
ambiguous "{round(lossRate)}% of {n}" where the % applies to a different (decisive)
denominator than the count. It is null when nothing was overridden
(`overridden.n == 0`).

Pure read against j2_trades + j2_verdicts (SELECT only). Parameterized SQL; Scope
applied via `filters.trades_where(spec)` spliced after the base account predicate,
mirroring `playbook_stats`.
"""

from __future__ import annotations

import json
import sqlite3
from typing import Any

from api.services.auth_db import get_connection
from api.services.journal_two.filters import FilterSpec, trades_where


def _verdict_from_context(raw: Any) -> tuple[str | None, str | None]:
    """Defensively pull `(compass_verdict_id, normalized_label)` from a stored
    `context_at_entry` TEXT value. Malformed JSON, a non-dict payload, or a
    missing/blank verdict id all return `(None, None)` — never raises.
    """
    try:
        ctx = json.loads(raw) if raw else {}
    except (TypeError, ValueError):
        return None, None
    if not isinstance(ctx, dict):
        return None, None
    vid = ctx.get("compass_verdict_id")
    if not vid:
        return None, None
    label = ctx.get("compass_verdict_label")
    label = str(label).strip().upper() if label is not None else None
    return vid, label


def _bucket_stats(rows: list[sqlite3.Row]) -> dict[str, Any]:
    """Public per-bucket metrics from a bucket's closed-trade rows."""
    n = len(rows)
    wins = sum(1 for r in rows if r["result"] == "Win")
    losses = sum(1 for r in rows if r["result"] == "Loss")
    decisive = wins + losses
    win_rate = (wins / decisive) if decisive > 0 else None

    rs = [float(r["r_multiple"]) for r in rows if r["r_multiple"] is not None]
    avg_r = round(sum(rs) / len(rs), 4) if rs else None

    net = round(
        sum(float(r["pnl_dollar"] or 0) - float(r["fees"] or 0) for r in rows), 2
    )
    return {"n": n, "winRate": win_rate, "avgR": avg_r, "netPnl": net}


def _count_skip_obeyed(
    conn: sqlite3.Connection,
    user_id: str,
    account_id: str | None,
    spec: FilterSpec | None,
) -> int:
    """ANTI-JOIN: j2_verdicts SKIP rows (user + account_id if given, Scope's date
    window if any) whose id was NOT referenced by ANY of the user's trades =
    SKIPs the user obeyed (never traded).
    """
    # Every compass_verdict_id the user's trades ever referenced (superset —
    # user-scoped, NOT date/account-narrowed — so a SKIP taken by any trade of
    # the user is never mis-counted as obeyed).
    taken: set[str] = set()
    for row in conn.execute(
        "SELECT context_at_entry FROM j2_trades WHERE user_id = ?", (user_id,)
    ):
        vid, _label = _verdict_from_context(row[0])
        if vid is not None:
            taken.add(vid)

    vsql = "SELECT id FROM j2_verdicts WHERE user_id = ? AND label = 'SKIP'"
    vparams: list[Any] = [user_id]
    if account_id:
        vsql += " AND account_id = ?"
        vparams.append(account_id)
    if spec is not None:
        if spec.date_from:
            vsql += " AND substr(created_at, 1, 10) >= ?"
            vparams.append(spec.date_from)
        if spec.date_to:
            vsql += " AND substr(created_at, 1, 10) <= ?"
            vparams.append(spec.date_to)

    obeyed = 0
    for row in conn.execute(vsql, vparams):
        if row[0] not in taken:
            obeyed += 1
    return obeyed


def get_verdict_scorecard(
    user_id: str,
    account_id: str | None = None,
    *,
    spec: FilterSpec | None = None,
    conn: sqlite3.Connection | None = None,
) -> dict[str, Any]:
    """Verdict-vs-outcome scorecard for the (scoped) closed-trade set.

    `account_id` stays a base predicate (its own ``account_id = ?`` clause,
    mirroring playbook_stats/analytics); a passed `spec` splices the full
    FilterSpec WHERE fragment after it. Null-safe: no trades → empty buckets +
    null headline.
    """
    owned = conn is None
    conn = conn or get_connection()
    try:
        sql = (
            "SELECT result, r_multiple, pnl_dollar, fees, context_at_entry "
            "  FROM j2_trades "
            " WHERE user_id = ?"
        )
        params: list[Any] = [user_id]
        if account_id:
            sql += " AND account_id = ?"
            params.append(account_id)
        if spec is not None:
            frag, filter_params = trades_where(spec)
            if frag:
                sql += " " + frag
                params.extend(filter_params)
        rows = conn.execute(sql, params).fetchall()

        go_rows: list[sqlite3.Row] = []
        hold_rows: list[sqlite3.Row] = []
        skip_rows: list[sqlite3.Row] = []
        trades_with_verdict = 0
        for r in rows:
            vid, label = _verdict_from_context(r["context_at_entry"])
            if vid is None:
                continue  # no verdict → out of the scored set (still in total)
            trades_with_verdict += 1
            if label == "GO":
                go_rows.append(r)
            elif label == "HOLD":
                hold_rows.append(r)
            elif label == "SKIP":
                skip_rows.append(r)
            # else: has a verdict id but an unrecognized label → coverage only.

        skip_stats = _bucket_stats(skip_rows)
        skip_wins = sum(1 for r in skip_rows if r["result"] == "Win")
        skip_losses = sum(1 for r in skip_rows if r["result"] == "Loss")
        skip_decisive = skip_wins + skip_losses
        headline = (
            {
                "n": skip_stats["n"],
                "lossRate": (skip_losses / skip_decisive) if skip_decisive else None,
                "losses": skip_losses,
                "decisive": skip_decisive,
                "netPnl": skip_stats["netPnl"],
            }
            if skip_rows
            else None
        )

        return {
            "byVerdict": [
                {"label": "GO", "taken": _bucket_stats(go_rows)},
                {"label": "HOLD", "taken": _bucket_stats(hold_rows)},
                {
                    "label": "SKIP",
                    "overridden": skip_stats,
                    "obeyed": _count_skip_obeyed(conn, user_id, account_id, spec),
                },
            ],
            "coverage": {
                "tradesWithVerdict": trades_with_verdict,
                "tradesTotal": len(rows),
            },
            "skipOverrideHeadline": headline,
        }
    finally:
        if owned:
            conn.close()
