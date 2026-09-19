"""The extraction budget: prices, estimates, and the hard stop (W1 §4.6, CONTRACTS §6.4).

THE RULE, in one line: a request is submitted only while
    actual_to_date + estimate(pending) + estimate(next) <= WISDOM_EXTRACT_BUDGET_USD
and the first request that would cross the line stops the run and reports. It
never submits "just this one more".

  * actual_to_date — wisdom_batches.cost_usd_actual across EVERY extractor_version
    (kinds extract + audit), accumulated at reap from each result's usage.
  * pending — requests written but not yet reaped (submitting / submitted / retry),
    at their stored estimate.
  * estimates are CONSERVATIVE: input tokens from messages.count_tokens priced
    with no cache discount, output tokens at the calibrated p90 for the model and
    effort (or DEFAULT_OUTPUT_TOKENS before a calibration exists).

ONE CAP — THE PROGRAM TOTAL. Owner ruling, 2026-09-14 (D-R2, confirming the
reviewer against this stream's earlier rule):

    "The cap is ONE program-level total carried in the ledger across all extractor
     versions, models and runs; per-version and per-run spend are reported as
     sub-lines, never as separate budgets."

So `actual_usd` / `pending_estimate_usd` (this version) and the per-run figures are
REPORTING. `program_actual_usd` / `program_pending_estimate_usd` are the budget.

⛔ WHY THE PER-VERSION BUDGET DIED (reviewer finding, 2026-09-14; measured).
`extractor_version` is sha256(system prompt || schema || transport)[:8], and the
system prompt CARRIES THE SETUP VOCABULARY, which core.vocab serves from a live,
actively-edited table. So approving one vocabulary name silently minted a version
whose spend was $0 and re-armed the whole cap, with nobody deciding anything: with
$14.90 of a $15 cap spent, adding one name let three more $5 requests through. A
ceiling a data edit can reset is not a hard stop
(`lesson_a_flag_closes_one_door_a_capability_closes_all`). Raising the cap is now
the only way to buy more, and that is an explicit, audited human act.

⚰️ AND THE PER-VERSION CEILING WAS ALREADY DEAD CODE — it could never fire.
Per-version rows are a SUBSET of the program rows (identical tables, one extra
WHERE), so actual_v <= actual_p and pending_v <= pending_p, and the per-version sum
can never cross the cap strictly before the program sum does. It was carried as a
second "ceiling" for a day, and the rail that pinned it
(`test_the_per_version_ceiling_still_binds_when_the_program_total_has_room`) only
passed because it seeded ONE version, which makes the two sums EQUAL — a fixture
that cannot distinguish the thing it is named after
(`lesson_a_fixture_that_cannot_distinguish_is_not_a_rail`). Driven with two
versions (60+5 and 40+5 against a $120 cap) the program ceiling is what stops it,
every time. Removing the check is therefore behaviour-preserving, and the rail
below now proves the domination rather than asserting it.

WISDOM_EXTRACT_BUDGET_USD defaults to 120 ($80 catalog estimate
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
    # R96/R97, session 23-24: $1/$5, cited from api/services/catalyst/cost_guard.py's own
    # PRICING table (that module's docstring: "verified against the Claude API reference"),
    # never invented here. This module carried no Haiku row before a Haiku golden run needed
    # one for R80's per-model extractor_version and this session's real pricing table.
    "claude-haiku-4-5": (1.0, 5.0),
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


#: ⛔⛔ R53 (owner ruling, 2026-09-15): the PER-NIGHT extract budget. **A VALUE, NOT A SWITCH.**
#:
#: ⭐ THE DISTINCTION IS THE WHOLE DESIGN. Every `WISDOM_*_ENABLED` in this programme is a gate
#: that defaults OFF, because an unset gate must mean "not released". This is the opposite kind of
#: variable: it is a QUANTITY, and an unset quantity must not mean "spend nothing" (which would be
#: an invisible outage) OR "spend anything" (which would be an invisible bill). It defaults to a
#: ruled number, and a value that is present but nonsensical REFUSES rather than falling back —
#: because a typo'd budget silently reverting to 25.0 is how somebody ships a 10x night.
#:
#: ⚠️ This is NOT the ledger cap and not `WISDOM_EXTRACT_BUDGET_USD`. Three different ceilings:
#:   * this          — one night's extraction spend
#:   * BUDGET_USD    — the programme total the chain enforces from the DB (default 120.0)
#:   * the ledger's `cap_usd` — the PC-side gate tool's own persisted total, owner-set
#: The tightest one binds; none of them replaces another.
#:
#: Arithmetic behind the default, measured: $0.058671/segment-pass, a 400-REQUEST nightly ceiling,
#: N=3 → 133 segments × 3 = 399 requests = $23.41 at the mean and $24.49 at p90. Rounded up to the
#: next dollar. ⭐ The nightly bill is fixed by REQUESTS, not by N — N changes coverage per night
#: and therefore total nights, not what a night costs.
DAILY_BUDGET_ENV = "WISDOM_EXTRACT_DAILY_BUDGET_USD"
DEFAULT_DAILY_BUDGET_USD = 25.0


class DailyBudgetUnusable(ValueError):
    """A per-night budget that is set but unusable. Refused, never silently defaulted."""


def daily_budget_usd() -> float:
    """One night's extraction ceiling. Raises rather than guessing when the value is unusable."""
    raw = os.environ.get(DAILY_BUDGET_ENV)
    if raw is None or not str(raw).strip():
        return DEFAULT_DAILY_BUDGET_USD
    try:
        value = float(raw)
    except (TypeError, ValueError):
        raise DailyBudgetUnusable(
            f"{DAILY_BUDGET_ENV}={str(raw)[:40]!r} is not a number. Refusing rather than falling "
            f"back to ${DEFAULT_DAILY_BUDGET_USD} — a typo must not quietly become a budget.")
    if value <= 0:
        raise DailyBudgetUnusable(
            f"{DAILY_BUDGET_ENV}={value} is not positive. Unset it to use the default "
            f"(${DEFAULT_DAILY_BUDGET_USD}); zero is not a way to pause extraction — "
            "WISDOM_EXTRACT_ENABLED is.")
    return value


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
    """USD for one response. input_tokens excludes cached tokens (API semantics).

    ⛔⛔ BUG FOUND 2026-09-19 (adversarial review, session 28 part 3): the local ($0) backend's
    real token usage used to be priced here as if it were the paid model, and the resulting
    dollar figure was written into the SAME `wisdom_batches.cost_usd_actual` ledger real paid
    extraction is rationed against — so dev/testing work on the free local backend could silently
    eat into (or exhaust) the real programme budget. `LocalClient.cost_usd = 0.0` /
    `is_local_backend = True` existed as a claim about this but were never actually read by the
    pricing path. `config.is_local()` reads the SAME programme-wide backend switch every request
    in a run shares, so gating here — the one place token counts become dollars — is correct for
    every caller, present and future, without each one needing to remember to check."""
    from api.services.wisdom.extract import config

    if config.is_local():
        return 0.0
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
    the budget check always passes 0 (the conservative view).

    ⛔ Local-backend gate: see `cost_from_usage`'s docstring — the same reasoning applies to the
    pre-flight estimate. Zeroing it here too keeps `select_within_budget`'s admitted-count honest
    for a local run instead of spuriously rationing $0-real-cost requests against a paid cap."""
    from api.services.wisdom.extract import config

    if config.is_local():
        return 0.0
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
    #: THE BUDGET — every extractor_version, model and run together (D-R2).
    #: `actual_usd` / `pending_estimate_usd` above are this version's REPORTED sub-lines.
    program_actual_usd: float = 0.0
    program_pending_estimate_usd: float = 0.0

    @property
    def remaining_usd(self) -> float:
        """What the PROGRAM has left. Never the per-version view: that is a sub-line,
        and reporting a larger per-version remainder would read as money available."""
        return round(self.cap_usd - self.program_actual_usd - self.program_pending_estimate_usd
                     - self.selected_estimate_usd, 6)

    def as_dict(self) -> dict:
        out = asdict(self)
        out["remaining_usd"] = self.remaining_usd
        return out


def spent_and_pending(conn, extractor_version: Optional[str]) -> tuple[float, float]:
    """(actual, pending) in USD. extractor_version None = every version — the program
    total the second ceiling is measured against."""
    marks = ",".join("?" for _ in BUDGET_KINDS)
    pmarks = ",".join("?" for _ in PENDING_STATUSES)
    scope = "" if extractor_version is None else "extractor_version = ? AND "
    vargs: tuple = () if extractor_version is None else (extractor_version,)
    actual = conn.execute(
        f"SELECT COALESCE(SUM(cost_usd_actual), 0) FROM wisdom_batches WHERE {scope}"
        f"kind IN ({marks})", (*vargs, *BUDGET_KINDS)).fetchone()[0]
    pending = conn.execute(
        f"SELECT COALESCE(SUM(est_cost_usd), 0) FROM wisdom_extract_requests WHERE {scope}"
        f"status IN ({pmarks})", (*vargs, *PENDING_STATUSES)).fetchone()[0]
    return float(actual or 0.0), float(pending or 0.0)


def night_spent_and_pending(conn, et_date: str) -> tuple[float, float]:
    """(actual, pending) in USD for ONE ET calendar night — R65.

    ⛔⛔ THE DEFECT THIS EXISTS FOR. The per-night ceiling used to be handed to
    `select_within_budget` as THE cap, where it was compared against CUMULATIVE PROGRAMME
    spend. So a night line did not ration a night — it clamped the whole programme to that
    number. Measured by executing this module: $75 of night-1 actuals against a combined cap
    of 75.0 allowed 0 of 10 on night 2, while $45 of programme headroom sat unused. A night
    budget that stops the SECOND night is not a night budget.

    ⭐ `submitted_at` and `created_at` are written by `timeutil.iso_et`, so they are ET-local
    ISO strings and their first ten characters ARE the ET date. No timezone maths here.
    ⚠️ Attribution is by SUBMISSION, not by reap: a batch submitted Friday and reaped Saturday
    belongs to Friday, which is the night whose budget authorised it.
    """
    marks = ",".join("?" for _ in BUDGET_KINDS)
    pmarks = ",".join("?" for _ in PENDING_STATUSES)
    actual = conn.execute(
        f"SELECT COALESCE(SUM(cost_usd_actual), 0) FROM wisdom_batches "
        f"WHERE kind IN ({marks}) AND substr(submitted_at, 1, 10) = ?",
        (*BUDGET_KINDS, et_date)).fetchone()[0]
    pending = conn.execute(
        f"SELECT COALESCE(SUM(est_cost_usd), 0) FROM wisdom_extract_requests "
        f"WHERE status IN ({pmarks}) AND substr(created_at, 1, 10) = ?",
        (*PENDING_STATUSES, et_date)).fetchone()[0]
    return float(actual or 0.0), float(pending or 0.0)


def program_spent_and_pending(conn) -> tuple[float, float]:
    """Every extractor_version's spend together (CONTRACTS §6.4 `actual_to_date`)."""
    return spent_and_pending(conn, None)


def select_within_budget(conn, extractor_version: str, estimates: list[float], *,
                         cap: Optional[float] = None, exclude_pending_usd: float = 0.0,
                         exclude_night_pending_usd: Optional[float] = None,
                         night_cap: Optional[float] = None,
                         night_date: Optional[str] = None) -> BudgetDecision:
    """How many of `estimates` (in order) fit. exclude_pending_usd removes rows that
    are themselves among `estimates` (retries already counted as pending) from the
    per-version and programme-wide pools, which carry no date filter.

    ⛔⛔ BUG FOUND 2026-09-19 (adversarial review, session 28 part 3): `exclude_pending_usd` used
    to be subtracted from the NIGHT-scoped pool too, but `night_spent_and_pending` filters
    strictly by `created_at`'s date, and a retry's `created_at` is never refreshed on
    resubmission -- `same_night.py` calls cross-night retry carry-forward NORMAL ("a retry rides
    pass 1 of a later night under its ORIGINAL run id"). So a retry from an EARLIER calendar night
    had its prior estimate subtracted from TONIGHT's `n_pending` even though it was never counted
    there in the first place (its `created_at` doesn't match tonight's date) -- silently loosening
    (never tightening) the per-night cap. `exclude_night_pending_usd` is the CORRECTLY
    night-scoped exclusion -- a caller that knows which of its retries actually fall on
    `night_date` passes it explicitly. It defaults to 0, never to `exclude_pending_usd`, so a
    caller that does not pass it gets the conservative (never over-excluding, never admits more
    than it should) answer instead of silently inheriting the bug's direction."""
    cap = budget_cap_usd() if cap is None else float(cap)
    actual, pending = spent_and_pending(conn, extractor_version)
    pending = max(0.0, pending - exclude_pending_usd)
    p_actual, p_pending = program_spent_and_pending(conn)
    p_pending = max(0.0, p_pending - exclude_pending_usd)
    # ⛔ R65: the night is its OWN ceiling over its OWN scope. Two independent
    # comparisons, never a min() of the two caps against one cumulative total.
    n_on = night_cap is not None and bool(night_date)
    n_actual, n_pending = (night_spent_and_pending(conn, night_date) if n_on else (0.0, 0.0))
    n_exclude = 0.0 if exclude_night_pending_usd is None else float(exclude_night_pending_usd)
    n_pending = max(0.0, n_pending - n_exclude)
    running, allowed = 0.0, 0
    reason = None
    for est in estimates:
        # ⛔ ONE CAP, and it is the PROGRAM total across every extractor_version, model and
        # run (D-R2). A prompt or vocabulary change must not hand the run a fresh budget.
        # The per-version figures travel on the decision for reporting and bind nothing.
        if n_on and n_actual + n_pending + running + float(est) > float(night_cap):
            reason = (f"night budget stop ({night_date}): actual ${n_actual:.2f} + pending "
                      f"${n_pending:.2f} + selected ${running:.2f} + next ${float(est):.4f} > "
                      f"night ${float(night_cap):.2f}")
            break
        if p_actual + p_pending + running + float(est) > cap:
            reason = (f"programme budget stop (all extractor versions): actual ${p_actual:.2f} + pending ${p_pending:.2f} "
                      f"+ selected ${running:.2f} + next ${float(est):.4f} > cap ${cap:.2f} "
                      f"[this version: actual ${actual:.2f} + pending ${pending:.2f}]")
            break
        running += float(est)
        allowed += 1
    return BudgetDecision(cap_usd=cap, actual_usd=round(actual, 6), pending_estimate_usd=round(pending, 6),
                          selected_estimate_usd=round(running, 6), allowed_count=allowed,
                          requested_count=len(estimates), stopped=allowed < len(estimates), reason=reason,
                          program_actual_usd=round(p_actual, 6),
                          program_pending_estimate_usd=round(p_pending, 6))


#: R100/session-26 Step A3 (owner ruling, 2026-09-18) — the arithmetic behind "will tonight fit",
#: as CODE rather than a number typed into a report. `select_within_budget`'s per-request loop
#: already enforces "a night can spend no more than min(its own remaining line, the programme's
#: remaining headroom)" as an EMERGENT property of checking both ceilings on every request; these
#: two functions make that property a first-class, independently testable quantity instead of
#: something provable only by re-deriving it from the loop.
def night_reservation_ceiling_usd(conn, *, night_cap: float, night_date: str,
                                  programme_cap: Optional[float] = None) -> float:
    """The most a night can actually spend right now: whichever of the night's own remaining
    line or the programme's remaining headroom is tighter. Never negative — a night or a
    programme already over its line has zero room left, not a negative one."""
    cap = budget_cap_usd() if programme_cap is None else float(programme_cap)
    p_actual, p_pending = program_spent_and_pending(conn)
    programme_headroom = max(0.0, cap - p_actual - p_pending)
    n_actual, n_pending = night_spent_and_pending(conn, night_date)
    night_headroom = max(0.0, float(night_cap) - n_actual - n_pending)
    return min(night_headroom, programme_headroom)


def projected_night_cost_usd(measured_usd_per_request: float, segments_per_night: int, passes: int) -> float:
    """A night's projected bill from a MEASURED historical per-request rate — the same arithmetic
    Step C's own plan states in prose (`segments x N x $/request`), pinned here so it can be
    replayed against a real measured rate in a test rather than re-typed by hand each time the
    plan changes. This is a PRE-ARMING SANITY CHECK, never a cap: the actual, enforced ceiling is
    `night_reservation_ceiling_usd` above, checked per-request against real running totals by
    `select_within_budget` — this function only answers "does the plan look sane before anything
    is armed."""
    return float(measured_usd_per_request) * int(segments_per_night) * int(passes)


def snapshot(conn, extractor_version: str) -> dict:
    actual, pending = spent_and_pending(conn, extractor_version)
    p_actual, p_pending = program_spent_and_pending(conn)
    cap = budget_cap_usd()
    return {"extractor_version": extractor_version, "cap_usd": cap, "actual_usd": round(actual, 6),
            "pending_estimate_usd": round(pending, 6),
            "program_actual_usd": round(p_actual, 6), "program_pending_estimate_usd": round(p_pending, 6),
            # ⛔ the PROGRAM remainder — the per-version numbers above are sub-lines (D-R2).
            "remaining_usd": round(cap - p_actual - p_pending, 6),
            "batch_discount": BATCH_DISCOUNT, "prices_per_mtok": PRICES_PER_MTOK}
