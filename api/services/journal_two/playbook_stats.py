"""
Journal 2.0 — all-setups Playbook aggregate (P3 Milestone B, Task B1).

Per-setup performance for the Insights → Playbook cards. Where
`setup_stats.get_setup_stats` returns win-rate/avg-R for ONE setup and
`analytics._attribution_section.bySetup` returns P&L/win-rate/avg-R for ALL
setups, NEITHER computes profit factor, expectancy, or exit efficiency. This
module fills that gap: one record per setup present in the (scoped) closed-equity
trade set, adding profitFactor + expectancy + exitEfficiency, Scope-aware.

Design choices (documented for review):
  * profitFactor = Σ(pnl_dollar > 0) / |Σ(pnl_dollar < 0)| — the SAME
    positive/negative-dollar split `analytics._edge_score` uses (copied into the
    local `_profit_factor` helper; analytics.py is NOT modified). Capped at 5.0
    for display parity with the Edge scorecard (plan B1). None when there is no
    losing denominator (Σ losses == 0).
  * expectancy = mean per-trade `pnl_dollar` over the setup's trades (dollars).
    expectancyR = avgR = mean `r_multiple` over the setup's trades with a
    non-null R (identical by construction; both surfaced so the FE can label the
    "expectancy in R" explicitly).
  * exitEfficiency = mean `j2_trade_excursions.exit_efficiency` joined by the
    stable `trade_ref`, computed EXACTLY as `analytics._exit_quality_section`:
    excludes 'underlying'/'insufficient' excursions from `computed`, and excludes
    a null efficiency (no-favorable-move) from the mean while still counting it as
    computed. Per the B1 default the raw mean is ALWAYS returned (None only when
    there is nothing to average) alongside `exitEffCoverage` {eligible, computed}
    so the frontend (B4 ConfidenceStat) — not the backend — decides when to gray.
  * adherence = mean `j2_trade_adherence.adherence_pct` (P5-A5) joined by the
    SAME stable `trade_ref` as the excursion join, over the setup's closed trades
    that HAVE an adherence record. Expressed as a FRACTION 0..1 (identical unit to
    `winRate`, so the frontend formats it with the same percent formatter). None
    when no trade in the setup has a record. `adherenceCoverage` {eligible,
    computed} mirrors `exitEffCoverage` exactly — `eligible` = the setup's closed
    trades (== tradeCount), `computed` = how many had a record — so the frontend
    coverage-gates it identically. `adherenceVsExpectancy` buckets the recorded
    trades into adhered (adherence_pct >= 0.8) vs notAdhered (< 0.8) and reports
    each bucket's expectancy in the SAME dollars-per-trade unit as the record's
    `expectancy` (mean pnl_dollar); trades without a record are in NEITHER bucket,
    and an empty bucket is {expectancy: None, n: 0} (never a fabricated split).
  * Confidence (n<10) is NOT hard-suppressed here: every computed number is
    returned with `tradeCount`; the frontend owns the n<10 shading (Global
    Constraint "Confidence threshold = 10 everywhere").
  * Blank/untagged-setup trades are EXCLUDED (v1) so every card maps to a real
    named setup (mirrors `_attribution_section`'s `if setup:` guard).

Pure read against j2_trades (+ the j2_trade_excursions join). Parameterized SQL;
Scope applied via `filters.trades_where(spec)` spliced after the base predicate,
mirroring the Milestone A adapters.
"""

from __future__ import annotations

import sqlite3
from typing import Any

from api.services.auth_db import get_connection
from api.services.journal_two import adherence_store, excursions_store
from api.services.journal_two.filters import FilterSpec, trades_where
from api.services.journal_two.trade_refs import trade_ref_for_row


_RESULT_LETTER = {"Win": "W", "Loss": "L", "BE": "B"}

# Excursion coverage mirrors P2: these data_quality tiers are NOT a real equity
# excursion, so they never count toward `computed` nor the efficiency mean.
_NON_COMPUTED_DQ = ("underlying", "insufficient")

# Display cap for profit factor — parity with `_edge_score` / the Edge scorecard.
_PF_DISPLAY_CAP = 5.0

# Adherence bucketing (P5-A5): a trade "adhered" to its setup's rules when it
# followed at least 80% of the checklist. Below that it "broke rules".
_ADHERED_THRESHOLD = 0.8


def _profit_factor(pnls: list[float]) -> float | None:
    """Σ(winning $) / |Σ(losing $)|, capped at 5.0 for display parity.

    Copies `analytics._edge_score`'s positive/negative-dollar split. Returns None
    when there is no losing denominator (the honest "no PF yet" state) — the B1
    contract's "None when no losses" (which deliberately departs from
    `_edge_score`'s no-loss → 5.0 fallback, that only makes sense inside the
    composite score).
    """
    sum_wins = sum(p for p in pnls if p > 0)
    sum_losses = abs(sum(p for p in pnls if p < 0))
    if sum_losses == 0:
        return None
    return round(min(sum_wins / sum_losses, _PF_DISPLAY_CAP), 4)


def get_playbook_stats(
    user_id: str,
    account_id: str | None = None,
    *,
    spec: FilterSpec | None = None,
    conn: sqlite3.Connection | None = None,
) -> list[dict[str, Any]]:
    """All-setups Playbook aggregate, sorted by total P&L (desc).

    `account_id` stays a base predicate (its own ``account_id = ?`` clause,
    mirroring analytics/list_trades_for_user); a passed `spec` splices the full
    FilterSpec WHERE fragment (date spine + symbol/sides/setups/tags via
    ``trades_where``) after it. Blank-setup trades are excluded at the SQL level.
    """
    owned = conn is None
    conn = conn or get_connection()
    try:
        sql = (
            "SELECT setup, result, pnl_dollar, r_multiple, exit_date, "
            "       id, external_id, source "  # for trade_ref → excursion join
            "  FROM j2_trades "
            " WHERE user_id = ? "
            "   AND setup IS NOT NULL AND TRIM(setup) != ''"
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
        sql += " ORDER BY exit_date ASC"  # chronological → lastFive is the tail
        rows = conn.execute(sql, params).fetchall()

        if not rows:
            return []

        # trade_ref → excursion dict (all of the user's persisted excursions;
        # keyed by the stable trade_ref so it survives broker resync). The
        # per-setup exit-efficiency join reads from this map.
        excursions_map = excursions_store.list_excursions_for_user(user_id, conn=conn)

        # trade_ref → adherence dict (P5-A5) — fetched ONCE here (like the
        # excursion map) and threaded into every per-setup record's join.
        adherence_map = adherence_store.list_adherence_for_user(user_id, conn=conn)

        # Group the (already chronological) rows by setup, preserving order.
        by_setup: dict[str, list[sqlite3.Row]] = {}
        for r in rows:
            by_setup.setdefault(r["setup"], []).append(r)

        out = [
            _setup_record(setup, setup_rows, excursions_map, adherence_map)
            for setup, setup_rows in by_setup.items()
        ]
        # Rank most-profitable first (mirrors attribution.bySetup ordering).
        out.sort(key=lambda e: e["totalPnlDollar"], reverse=True)
        return out
    finally:
        if owned:
            conn.close()


def _setup_record(
    setup: str,
    rows: list[sqlite3.Row],
    excursions_map: dict[str, dict],
    adherence_map: dict[str, dict],
) -> dict[str, Any]:
    """Compute one setup's aggregate from its (chronological) trade rows."""
    pnls = [float(r["pnl_dollar"] or 0) for r in rows]
    rs = [float(r["r_multiple"]) for r in rows if r["r_multiple"] is not None]

    wins = sum(1 for r in rows if r["result"] == "Win")
    losses = sum(1 for r in rows if r["result"] == "Loss")
    bes = sum(1 for r in rows if r["result"] == "BE")
    decisive = wins + losses
    win_rate = (wins / decisive) if decisive > 0 else None

    trade_count = len(rows)
    total_pnl = sum(pnls)
    expectancy = round(total_pnl / trade_count, 2) if trade_count else None

    avg_r = round(sum(rs) / len(rs), 4) if rs else None  # == expectancyR
    total_r = round(sum(rs), 4) if rs else 0.0

    # ── Exit efficiency (P2 semantics) ───────────────────────────────────────
    eligible = trade_count
    computed = 0
    effs: list[float] = []
    for r in rows:
        exc = excursions_map.get(trade_ref_for_row(r))
        if exc is None:
            continue
        if exc.get("dataQuality") in _NON_COMPUTED_DQ:
            continue
        computed += 1
        eff = exc.get("exitEfficiency")
        if eff is not None:
            effs.append(float(eff))
    exit_efficiency = round(sum(effs) / len(effs), 4) if effs else None

    # ── Rule adherence (P5-A5) ────────────────────────────────────────────────
    # Same join as exit-efficiency (stable trade_ref → adherence record). The
    # coverage denominator MATCHES exitEffCoverage.eligible (== trade_count).
    # `adherence` is a fraction 0..1 (same unit as win_rate). The adhered-vs-not
    # split's expectancy uses the SAME per-trade mean-pnl_dollar unit as the
    # record's `expectancy`; trades WITHOUT a record are in NEITHER bucket.
    adh_eligible = trade_count
    adh_computed = 0
    adh_pcts: list[float] = []
    adhered_pnls: list[float] = []
    not_adhered_pnls: list[float] = []
    for r in rows:
        rec = adherence_map.get(trade_ref_for_row(r))
        if rec is None:
            continue
        adh_computed += 1
        pct = rec.get("adherencePct")
        pct = 0.0 if pct is None else float(pct)  # store guarantees non-null
        adh_pcts.append(pct)
        pnl = float(r["pnl_dollar"] or 0)
        if pct >= _ADHERED_THRESHOLD:
            adhered_pnls.append(pnl)
        else:
            not_adhered_pnls.append(pnl)
    adherence = round(sum(adh_pcts) / len(adh_pcts), 4) if adh_pcts else None

    def _adh_bucket(bucket_pnls: list[float]) -> dict[str, Any]:
        return {
            "expectancy": (
                round(sum(bucket_pnls) / len(bucket_pnls), 2) if bucket_pnls else None
            ),
            "n": len(bucket_pnls),
        }

    last_five = [_RESULT_LETTER.get(r["result"], "?") for r in rows[-5:]]

    return {
        "setup": setup,
        "tradeCount": trade_count,
        "winCount": wins,
        "lossCount": losses,
        "beCount": bes,
        "winRate": win_rate,
        "profitFactor": _profit_factor(pnls),
        "expectancy": expectancy,       # dollars, mean per-trade pnl_dollar
        "expectancyR": avg_r,           # mean R (identical to avgR)
        "avgR": avg_r,
        "totalR": total_r,
        "totalPnlDollar": round(total_pnl, 2),
        "exitEfficiency": exit_efficiency,
        "exitEffCoverage": {"eligible": eligible, "computed": computed},
        # Rule adherence (P5-A5) — fraction 0..1 (mean adherence_pct); None when
        # no trade in the setup has a record. Coverage-gated like exit-eff.
        "adherence": adherence,
        "adherenceCoverage": {"eligible": adh_eligible, "computed": adh_computed},
        "adherenceVsExpectancy": {
            "adhered": _adh_bucket(adhered_pnls),
            "notAdhered": _adh_bucket(not_adhered_pnls),
        },
        "lastFive": last_five,
    }
