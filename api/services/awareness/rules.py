"""Pure watch-rule functions for the Awareness Engine (Milestone 1).

Every rule has the same shape: (scan_ctx, user_ctx) -> list[InsightCandidate].
scan_ctx is the ONE shared market-wide computation for this cycle (live
prices, regime, earnings window) built once by engine.py. user_ctx is that
one user's bulk-loaded positions + watchlist symbols. Rules never touch the
database or the network — engine.py owns all I/O.

The relevance score is deterministic and pure:
    importance = clamp(round(base_signal * personal_multiplier * urgency * 10), 1, 10)

  - base_signal (0.0-1.0): raw strength of the trigger itself (e.g. 1.0 for
    a stop that's been hit, 0.4-0.7 for "nearing" it).
  - personal_multiplier (~0.5-1.6): how much this matters to THIS user
    (owns it vs. just watches it).
  - urgency (~1.0-2.0): how time-sensitive it is (today vs. a few days out).
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date


@dataclass(frozen=True)
class InsightCandidate:
    kind: str
    symbol: str | None
    headline: str
    body: str | None
    base_signal: float
    personal_multiplier: float
    urgency: float
    # Passed as `symbol=` to add_insight() for its per-symbol cooldown scope.
    # May be a composite key (e.g. "NVDA:earnings") so different rule kinds
    # on the same ticker don't share a cooldown window.
    dedup_key: str | None


def compute_relevance_score(
    base_signal: float, personal_multiplier: float = 1.0, urgency: float = 1.0,
) -> int:
    """The deterministic relevance-score formula. Pure; clamped to 1-10 so
    it's always a valid add_insight() importance value."""
    raw = float(base_signal) * float(personal_multiplier) * float(urgency) * 10.0
    return max(1, min(10, round(raw)))


NEAR_STOP_PCT = 0.03  # 3% — R2 "nearing stop" threshold


def _stop_distance_pct(side: str, price: float, stop: float) -> float:
    """Positive = price hasn't reached the stop yet (as a % of price).
    <= 0 means at or through the stop."""
    if side == "Long":
        return (price - stop) / price
    return (stop - price) / price  # Short


def rule_stop_watch(scan_ctx: dict, user_ctx: dict) -> list[InsightCandidate]:
    """R1 (at/through stop) + R2 (nearing stop). Skips broker carried-in
    positions whose stop is a NOT-NULL placeholder (stop_price==entry_price,
    source=='broker') -- see journal_two/broker/balances.py."""
    out: list[InsightCandidate] = []
    live_prices: dict = scan_ctx.get("live_prices") or {}

    for pos in user_ctx.get("positions") or []:
        sym = (pos.get("symbol") or "").upper()
        side = pos.get("side")
        stop = pos.get("stop_price")
        entry = pos.get("entry_price")
        source = pos.get("source")
        if not sym or side not in ("Long", "Short") or stop is None or entry is None:
            continue
        if source == "broker" and abs(float(stop) - float(entry)) < 1e-9:
            continue  # placeholder stop -- nothing real to watch

        price = live_prices.get(sym)
        if not price or price <= 0:
            continue  # no cached price this cycle -- never fetch per-position

        distance_pct = _stop_distance_pct(side, float(price), float(stop))

        if distance_pct <= 0:
            out.append(InsightCandidate(
                kind="stop_hit", symbol=sym,
                headline=f"{sym} is AT or THROUGH its stop",
                body=(f"{side} {sym}: stop {float(stop):.2f}, current price "
                      f"{float(price):.2f}. Review the position now."),
                base_signal=1.0, personal_multiplier=1.3, urgency=2.0,
                # Distinct cooldown namespace from stop_proximity: an earlier
                # "nearing stop" warning must never swallow the THROUGH-the-stop
                # escalation via add_insight's 6h per-symbol cooldown.
                dedup_key=f"{sym}:stop_hit",
            ))
        elif distance_pct <= NEAR_STOP_PCT:
            base_signal = 0.4 + (1.0 - distance_pct / NEAR_STOP_PCT) * 0.3
            out.append(InsightCandidate(
                kind="stop_proximity", symbol=sym,
                headline=f"{sym} is nearing its stop",
                body=(f"{side} {sym}: stop {float(stop):.2f}, current price "
                      f"{float(price):.2f} ({distance_pct * 100:.1f}% away)."),
                base_signal=base_signal, personal_multiplier=1.2, urgency=1.3,
                dedup_key=f"{sym}:stop_near",
            ))
    return out


def rule_regime_flip(scan_ctx: dict, user_ctx: dict) -> list[InsightCandidate]:
    """R4: fires once per (label, cycle) for any user with something at
    stake (an open position or a watched symbol) -- an inactive account
    with neither gets nothing. dedup_key is label-scoped (not per-user),
    so add_insight's 6h per-symbol cooldown naturally suppresses repeat
    firing for the SAME flip across scan cycles while allowing a genuine
    flip-back-and-forth to re-fire (different label string)."""
    regime = scan_ctx.get("regime") or {}
    label = regime.get("label")
    prev_label = regime.get("prev_label")
    # Explicit 0.0 is a legitimate zero-confidence reading -- only a MISSING
    # confidence falls back to the 0.5 default (never `or`, which eats 0.0).
    confidence = regime.get("confidence")
    confidence = 0.5 if confidence is None else float(confidence)
    if not label or not prev_label or label == prev_label:
        return []

    has_positions = bool(user_ctx.get("positions"))
    has_watch = bool(user_ctx.get("watch_syms"))
    if not has_positions and not has_watch:
        return []

    pretty_prev = prev_label.replace("_", " ")
    pretty_new = label.replace("_", " ")
    base_signal = 0.5 + 0.5 * min(1.0, max(0.0, float(confidence)))

    return [InsightCandidate(
        kind="regime_flip", symbol=None,
        headline=f"Market regime flipped: {pretty_prev} → {pretty_new}",
        body=(f"Confidence {float(confidence) * 100:.0f}%. Reassess exposure "
              f"and setup selection for the new regime."),
        base_signal=base_signal,
        personal_multiplier=1.3 if has_positions else 1.0,
        urgency=1.4,
        dedup_key=f"REGIME:{label}",
    )]


EARNINGS_PROXIMITY_DEFAULT_DAYS = 3


def rule_earnings_proximity(scan_ctx: dict, user_ctx: dict) -> list[InsightCandidate]:
    """R5: fires for any owned OR watched symbol reporting within the
    proximity window. dedup_key is composite ("SYM:earnings") so it never
    shares a cooldown with a stop-watch insight on the same symbol.

    The window size comes from scan_ctx["earnings_window_days"] (set by
    engine.py from AWARENESS_EARNINGS_PROXIMITY_DAYS) so the rule's cutoff
    always matches the engine's collection window; falls back to the default."""
    out: list[InsightCandidate] = []
    earnings_by_symbol: dict = scan_ctx.get("earnings_by_symbol") or {}
    if not earnings_by_symbol:
        return out

    window_days = scan_ctx.get("earnings_window_days", EARNINGS_PROXIMITY_DEFAULT_DAYS)
    today = scan_ctx.get("today")
    owned_syms = {(p.get("symbol") or "").upper()
                  for p in (user_ctx.get("positions") or [])}
    watch_syms = {s.upper() for s in (user_ctx.get("watch_syms") or set())}
    mine = owned_syms | watch_syms

    for sym in mine:
        report_date_str = earnings_by_symbol.get(sym)
        if not report_date_str:
            continue
        try:
            report_date = date.fromisoformat(report_date_str)
        except ValueError:
            continue
        days_out = (report_date - today).days
        if days_out < 0 or days_out > window_days:
            continue

        owned = sym in owned_syms
        # base_signal scales inversely with days_out: today=1.0, floors at 0.3.
        base_signal = max(0.3, 1.0 - 0.2 * days_out)
        when = ("today" if days_out == 0 else
                "tomorrow" if days_out == 1 else f"in {days_out} days")

        out.append(InsightCandidate(
            kind="earnings_proximity", symbol=sym,
            headline=f"{sym} reports earnings {when}",
            body=(f"{'You own' if owned else 'On your watchlist'}: {sym} is "
                  f"scheduled to report on {report_date_str}."),
            base_signal=base_signal,
            personal_multiplier=1.4 if owned else 1.0,
            urgency=1.5 if days_out == 0 else 1.0,
            dedup_key=f"{sym}:earnings",
        ))
    return out
