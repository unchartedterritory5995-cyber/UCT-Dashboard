"""The extraction budget: prices, estimates, and the hard stop (W1 §4.6, CONTRACTS §6.4).

THE RULE, in one line: a request is submitted only while
    actual_to_date + estimate(pending) + estimate(next) <= WISDOM_EXTRACT_BUDGET_USD
and the first request that would cross the line stops the run and reports. It
never submits "just this one more".

  * actual_to_date — wisdom_batches.cost_usd_actual for this extractor_version
    (kinds extract + audit), accumulated at reap from each result's usage.
  * pending — requests written but not yet reaped (submitting / submitted / retry),
    at their stored estimate.
  * estimates are CONSERVATIVE: input tokens from messages.count_tokens priced
    with no cache discount, output tokens at the calibrated p90 for the model and
    effort (or DEFAULT_OUTPUT_TOKENS before a calibration exists).

The cap is per extractor_version: a new prompt/schema revision is a new run, with
its own budget. WISDOM_EXTRACT_BUDGET_USD defaults to 120 ($80 catalog estimate
× 1.5); a blank, non-numeric or non-positive value falls back to that default —
a typo can never turn the cap off. The kill switch is WISDOM_EXTRACT_ENABLED.

Prices (verified against the Claude API reference, 2026-09-13): per million
tokens, Opus 5 $5 in / $25 out, Sonnet 5 $2 / $10. Batch is 0.5× on everything
and stacks with cache pricing: cache read 0.1× input, 5-minute cache write 1.25×,
1-hour write 2×. An unknown model is priced at the most expensive current rate so
an estimate can over-state but never under-state.
"""
from __future__ import annotations

import json
import os
from dataclasses import asdict, dataclass
from typing import Any, Optional

BATCH_DISCOUNT = 0.5
CACHE_READ_MULT = 0.1
CACHE_WRITE_5M_MULT = 1.25
CACHE_WRITE_1H_MULT = 2.0
PRICES_PER_MTOK: dict[str, tuple[float, float]] = {
    "claude-opus-5": (5.0, 25.0),
    "claude-sonnet-5": (2.0, 10.0),
}
FALLBACK_PRICE_PER_MTOK = (10.0, 50.0)
DEFAULT_BUDGET_USD = 120.0
DEFAULT_OUTPUT_TOKENS = 6000
BUDGET_KINDS = ("extract", "audit")
PENDING_STATUSES = ("submitting", "submitted", "retry")


def budget_cap_usd() -> float:
    raw = os.environ.get("WISDOM_EXTRACT_BUDGET_USD")
    if raw is None or not str(raw).strip():
        return DEFAULT_BUDGET_USD
    try:
        value = float(raw)
    except (TypeError, ValueError):
        return DEFAULT_BUDGET_USD
    return value if value > 0 else DEFAULT_BUDGET_USD


def price_for(model: str) -> tuple[float, float]:
    return PRICES_PER_MTOK.get(str(model or ""), FALLBACK_PRICE_PER_MTOK)


def _get(usage: Any, name: str) -> int:
    if usage is None:
        return 0
    value = usage.get(name) if isinstance(usage, dict) else getattr(usage, name, None)
    try:
        return int(value or 0)
    except (TypeError, ValueError):
        return 0


def usage_dict(usage: Any) -> dict:
    out = {k: _get(usage, k) for k in ("input_tokens", "output_tokens", "cache_read_input_tokens",
                                        "cache_creation_input_tokens")}
    creation = usage.get("cache_creation") if isinstance(usage, dict) else getattr(usage, "cache_creation", None)
    out["ephemeral_1h_input_tokens"] = _get(creation, "ephemeral_1h_input_tokens")
    out["ephemeral_5m_input_tokens"] = _get(creation, "ephemeral_5m_input_tokens")
    return out


def cost_from_usage(model: str, usage: Any, *, batch: bool) -> float:
    """USD for one response. input_tokens excludes cached tokens (API semantics)."""
    u = usage_dict(usage)
    price_in, price_out = price_for(model)
    write_1h = u["ephemeral_1h_input_tokens"]
    write_5m = max(0, u["cache_creation_input_tokens"] - write_1h)
    usd = (
        u["input_tokens"] * price_in
        + u["cache_read_input_tokens"] * price_in * CACHE_READ_MULT
        + write_5m * price_in * CACHE_WRITE_5M_MULT
        + write_1h * price_in * CACHE_WRITE_1H_MULT
        + u["output_tokens"] * price_out
    ) / 1_000_000
    return usd * (BATCH_DISCOUNT if batch else 1.0)


def estimate_cost(model: str, input_tokens: int, output_tokens: int, *, batch: bool = True,
                  cached_input_tokens: int = 0) -> float:
    """cached_input_tokens > 0 prices that share as cache reads (the 'expected' view);
    the budget check always passes 0 (the conservative view)."""
    price_in, price_out = price_for(model)
    cached = max(0, min(int(cached_input_tokens), int(input_tokens)))
    usd = ((int(input_tokens) - cached) * price_in + cached * price_in * CACHE_READ_MULT
           + int(output_tokens) * price_out) / 1_000_000
    return usd * (BATCH_DISCOUNT if batch else 1.0)


def output_token_estimate(conn, model: str, effort: str) -> int:
    """p90 output tokens per request from the latest calibration for (model, effort)."""
    if conn is not None:
        try:
            rows = conn.execute(
                "SELECT metrics_json FROM wisdom_eval_runs WHERE kind = 'extractor_calibration' "
                "ORDER BY created_at DESC LIMIT 50").fetchall()
        except Exception:
            rows = []
        for row in rows:
            try:
                m = json.loads(row[0])
            except (TypeError, ValueError):
                continue
            if m.get("model") == model and m.get("effort") == effort and m.get("output_tokens_p90"):
                return int(m["output_tokens_p90"])
    return DEFAULT_OUTPUT_TOKENS


@dataclass
class BudgetDecision:
    cap_usd: float
    actual_usd: float
    pending_estimate_usd: float
    selected_estimate_usd: float
    allowed_count: int
    requested_count: int
    stopped: bool
    reason: Optional[str]

    @property
    def remaining_usd(self) -> float:
        return round(self.cap_usd - self.actual_usd - self.pending_estimate_usd - self.selected_estimate_usd, 6)

    def as_dict(self) -> dict:
        out = asdict(self)
        out["remaining_usd"] = self.remaining_usd
        return out


def spent_and_pending(conn, extractor_version: str) -> tuple[float, float]:
    marks = ",".join("?" for _ in BUDGET_KINDS)
    actual = conn.execute(
        f"SELECT COALESCE(SUM(cost_usd_actual), 0) FROM wisdom_batches WHERE extractor_version = ? "
        f"AND kind IN ({marks})", (extractor_version, *BUDGET_KINDS)).fetchone()[0]
    pmarks = ",".join("?" for _ in PENDING_STATUSES)
    pending = conn.execute(
        f"SELECT COALESCE(SUM(est_cost_usd), 0) FROM wisdom_extract_requests WHERE extractor_version = ? "
        f"AND status IN ({pmarks})", (extractor_version, *PENDING_STATUSES)).fetchone()[0]
    return float(actual or 0.0), float(pending or 0.0)


def select_within_budget(conn, extractor_version: str, estimates: list[float], *,
                         cap: Optional[float] = None, exclude_pending_usd: float = 0.0) -> BudgetDecision:
    """How many of `estimates` (in order) fit. exclude_pending_usd removes rows that
    are themselves among `estimates` (retries already counted as pending)."""
    cap = budget_cap_usd() if cap is None else float(cap)
    actual, pending = spent_and_pending(conn, extractor_version)
    pending = max(0.0, pending - exclude_pending_usd)
    running, allowed = 0.0, 0
    reason = None
    for est in estimates:
        if actual + pending + running + float(est) > cap:
            reason = (f"budget stop: actual ${actual:.2f} + pending ${pending:.2f} + selected ${running:.2f} "
                      f"+ next ${float(est):.4f} > cap ${cap:.2f}")
            break
        running += float(est)
        allowed += 1
    return BudgetDecision(cap_usd=cap, actual_usd=round(actual, 6), pending_estimate_usd=round(pending, 6),
                          selected_estimate_usd=round(running, 6), allowed_count=allowed,
                          requested_count=len(estimates), stopped=allowed < len(estimates), reason=reason)


def snapshot(conn, extractor_version: str) -> dict:
    actual, pending = spent_and_pending(conn, extractor_version)
    cap = budget_cap_usd()
    return {"extractor_version": extractor_version, "cap_usd": cap, "actual_usd": round(actual, 6),
            "pending_estimate_usd": round(pending, 6), "remaining_usd": round(cap - actual - pending, 6),
            "batch_discount": BATCH_DISCOUNT, "prices_per_mtok": PRICES_PER_MTOK}
