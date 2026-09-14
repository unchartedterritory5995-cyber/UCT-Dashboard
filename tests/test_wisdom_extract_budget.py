"""Extraction budget rails (stream S-D).

WHAT THIS FILE HAS TO BE ABLE TO SAY RED FOR
1. a price table or discount that under-states a request (batch 0.5x, cache read 0.1x,
   cache writes 1.25x / 2x, an unknown model priced below Opus);
2. a cap a typo can switch off;
3. a selection that lets the request that CROSSES the cap through;
4. spend or pending estimates from another extractor version leaking into this one.
"""
from __future__ import annotations

import json

import pytest

from api.services.wisdom.core import store
from api.services.wisdom.extract import budget


@pytest.fixture
def wisdom_db(tmp_path, monkeypatch):
    monkeypatch.setenv("WISDOM_DB_PATH", str(tmp_path / "wisdom.db"))
    store.init_db()
    return tmp_path / "wisdom.db"


M = 1_000_000


def test_opus_prices_batch_discount_and_cache_multipliers():
    assert budget.cost_from_usage("claude-opus-5", {"input_tokens": M}, batch=False) == pytest.approx(5.0)
    assert budget.cost_from_usage("claude-opus-5", {"output_tokens": M}, batch=False) == pytest.approx(25.0)
    assert budget.cost_from_usage("claude-opus-5", {"input_tokens": M, "output_tokens": M}, batch=True) == pytest.approx(15.0)
    assert budget.cost_from_usage("claude-opus-5", {"cache_read_input_tokens": M}, batch=False) == pytest.approx(0.5)
    assert budget.cost_from_usage("claude-opus-5", {"cache_creation_input_tokens": M}, batch=False) == pytest.approx(6.25)
    one_hour = {"cache_creation_input_tokens": M, "cache_creation": {"ephemeral_1h_input_tokens": M}}
    assert budget.cost_from_usage("claude-opus-5", one_hour, batch=False) == pytest.approx(10.0)
    assert budget.cost_from_usage("claude-sonnet-5", {"input_tokens": M, "output_tokens": M}, batch=False) == pytest.approx(12.0)


def test_usage_objects_and_dicts_price_the_same():
    class U:
        input_tokens, output_tokens, cache_read_input_tokens, cache_creation_input_tokens = 1000, 2000, 300, 40
        cache_creation = None

    as_dict = {"input_tokens": 1000, "output_tokens": 2000, "cache_read_input_tokens": 300,
               "cache_creation_input_tokens": 40}
    assert budget.cost_from_usage("claude-opus-5", U(), batch=True) == budget.cost_from_usage(
        "claude-opus-5", as_dict, batch=True)


def test_an_unknown_model_is_never_priced_below_the_most_expensive_known_rate():
    known_max = max(budget.PRICES_PER_MTOK.values())
    assert budget.price_for("claude-mystery-9") >= known_max


def test_estimates_can_price_a_cached_share_but_default_to_none():
    full = budget.estimate_cost("claude-opus-5", 10_000, 2_000)
    cached = budget.estimate_cost("claude-opus-5", 10_000, 2_000, cached_input_tokens=8_000)
    assert cached < full
    assert full == pytest.approx((10_000 * 5 + 2_000 * 25) / M * 0.5)


@pytest.mark.parametrize("raw,expected", [(None, 120.0), ("", 120.0), ("50", 50.0), ("0", 120.0), ("-3", 120.0),
                                          ("abc", 120.0), (" 7.5 ", 7.5)])
def test_a_typo_can_never_turn_the_cap_off(monkeypatch, raw, expected):
    if raw is None:
        monkeypatch.delenv("WISDOM_EXTRACT_BUDGET_USD", raising=False)
    else:
        monkeypatch.setenv("WISDOM_EXTRACT_BUDGET_USD", raw)
    assert budget.budget_cap_usd() == expected


def _seed(conn, version, actual, pending):
    conn.execute("INSERT INTO wisdom_batches (batch_id, kind, extractor_version, model, submitted_at, status, "
                 "request_count, cost_usd_actual, budget_cap_usd) VALUES (?, 'extract', ?, 'm', 't', 'reaped', 1, ?, 120)",
                 (f"b-{version}", version, actual))
    conn.execute("INSERT INTO wisdom_extract_requests (custom_id, source_id, source_version, segment_ids_json, "
                 "extractor_version, status, est_cost_usd, created_at, updated_at) "
                 "VALUES (?, 's', 1, '[]', ?, 'submitted', ?, 't', 't')", (f"wx_{version}", version, pending))


def test_the_request_that_crosses_the_cap_is_the_first_one_refused(wisdom_db):
    with store.write() as conn:
        _seed(conn, "wx-v0-aaaaaaaa", 100.0, 10.0)
    with store.read() as conn:
        decision = budget.select_within_budget(conn, "wx-v0-aaaaaaaa", [4.0, 4.0, 4.0, 0.5], cap=120.0)
    assert decision.actual_usd == 100.0 and decision.pending_estimate_usd == 10.0
    assert decision.allowed_count == 2 and decision.stopped and "cap $120.00" in decision.reason
    assert decision.remaining_usd == pytest.approx(2.0)
    with store.read() as conn:
        exact = budget.select_within_budget(conn, "wx-v0-aaaaaaaa", [10.0], cap=120.0)
    assert exact.allowed_count == 1 and not exact.stopped  # equal to the cap is allowed; over is not


def test_a_new_extractor_version_does_not_re_arm_the_cap(wisdom_db):
    """⛔ REVIEWER FIX 2026-09-14, and it reverses this stream's earlier per-version-only
    rule. `extractor_version` is sha256(system prompt || schema || transport)[:8] and the
    SYSTEM PROMPT CARRIES THE SETUP VOCABULARY, which core.vocab serves from a live,
    actively-edited table. So approving one vocabulary name minted a version whose spend
    was $0 and handed the run the WHOLE cap again, with nobody deciding anything.
    CONTRACTS §6.4 says `actual_to_date`, not "for this version"."""
    with store.write() as conn:
        _seed(conn, "wx-v0-aaaaaaaa", 14.9, 0.0)
    with store.read() as conn:
        fresh = budget.select_within_budget(conn, "wx-v0-bbbbbbbb", [5.0] * 3, cap=15.0)
    assert fresh.actual_usd == 0.0, "the per-version view still reports the new version's own spend"
    assert fresh.program_actual_usd == pytest.approx(14.9)
    assert fresh.allowed_count == 0 and fresh.stopped
    assert "all extractor versions" in fresh.reason and "cap $15.00" in fresh.reason
    assert fresh.remaining_usd == pytest.approx(0.1)
    # CONTROL: under a cap the PROGRAM total fits, the new version still runs — the
    # ceiling stops spending, not every new version.
    with store.read() as conn:
        roomy = budget.select_within_budget(conn, "wx-v0-bbbbbbbb", [5.0] * 3, cap=120.0)
    assert roomy.allowed_count == 3 and not roomy.stopped


def test_the_cap_is_the_PROGRAM_total_and_the_per_version_figures_bind_nothing(wisdom_db):
    """⛔ OWNER RULING D-R2, 2026-09-14: "The cap is ONE program-level total carried in the
    ledger across all extractor versions, models and runs; per-version and per-run spend are
    reported as sub-lines, never as separate budgets."

    ⚰️ THIS REPLACES `test_the_per_version_ceiling_still_binds_when_the_program_total_has_room`,
    which asserted the opposite and PASSED ANYWAY — because it seeded exactly ONE version, and
    with one version the per-version sums EQUAL the program sums, so the two ceilings are
    indistinguishable and the assertion was about a difference the fixture could not create
    (`lesson_a_fixture_that_cannot_distinguish_is_not_a_rail`).

    ⭐ Two versions is what makes the claim testable, and it shows the per-version ceiling was
    never reachable: per-version rows are a SUBSET of the program rows (same tables, one extra
    WHERE), so actual_v <= actual_p and pending_v <= pending_p, and the per-version sum cannot
    cross the cap strictly before the program sum does. Removing that check was
    behaviour-preserving; this rail is why we can say so rather than hope so.
    """
    with store.write() as conn:
        _seed(conn, "wx-v0-aaaaaaaa", 60.0, 5.0)
        _seed(conn, "wx-v0-bbbbbbbb", 40.0, 5.0)      # program: 100 actual + 10 pending
    with store.read() as conn:
        d = budget.select_within_budget(conn, "wx-v0-aaaaaaaa", [4.0] * 6, cap=120.0)

    # the sub-lines report THIS version and are visibly smaller than the budget...
    assert (d.actual_usd, d.pending_estimate_usd) == (60.0, 5.0)
    assert (d.program_actual_usd, d.program_pending_estimate_usd) == (100.0, 10.0)
    # ...and the stop is the program total, which is what leaves room for exactly two.
    assert d.allowed_count == 2 and d.stopped
    assert "all extractor versions" in d.reason
    assert "this version: actual $60.00" in d.reason, "the sub-line must stay visible in the stop"
    # remaining is the PROGRAM remainder, never the roomier per-version view
    assert d.remaining_usd == pytest.approx(120.0 - 100.0 - 10.0 - 8.0)


def test_a_version_whose_own_spend_is_tiny_still_stops_on_the_program_total(wisdom_db):
    """THE FAILING-DIRECTION CONTROL for the ruling: the danger is not a version that has
    spent a lot, it is a FRESH one that has spent nothing while the program is at its cap.
    That is exactly the vocabulary-edit hole — mint a version, spend $0, and a per-version
    budget would hand it the whole cap again."""
    with store.write() as conn:
        _seed(conn, "wx-v0-aaaaaaaa", 119.0, 0.0)
    with store.read() as conn:
        d = budget.select_within_budget(conn, "wx-v0-ffffffff", [4.0], cap=120.0)
    assert d.actual_usd == 0.0, "the new version's own spend is genuinely zero"
    assert d.allowed_count == 0 and d.stopped
    assert d.remaining_usd < 4.0


def test_the_snapshot_reports_both_ceilings(wisdom_db):
    with store.write() as conn:
        _seed(conn, "wx-v0-aaaaaaaa", 10.0, 1.0)
        _seed(conn, "wx-v0-bbbbbbbb", 20.0, 2.0)
    with store.read() as conn:
        snap = budget.snapshot(conn, "wx-v0-aaaaaaaa")
    assert snap["actual_usd"] == 10.0 and snap["pending_estimate_usd"] == 1.0
    assert snap["program_actual_usd"] == 30.0 and snap["program_pending_estimate_usd"] == 3.0
    assert snap["remaining_usd"] == pytest.approx(snap["cap_usd"] - 33.0)


def test_a_retry_already_counted_as_pending_is_not_counted_twice(wisdom_db):
    with store.write() as conn:
        _seed(conn, "wx-v0-aaaaaaaa", 100.0, 10.0)
    with store.read() as conn:
        d = budget.select_within_budget(conn, "wx-v0-aaaaaaaa", [10.0, 10.0], cap=120.0, exclude_pending_usd=10.0)
    assert d.allowed_count == 2


def test_calibrated_p90_output_tokens_replace_the_default(wisdom_db):
    with store.read() as conn:
        assert budget.output_token_estimate(conn, "claude-opus-5", "high") == budget.DEFAULT_OUTPUT_TOKENS
    with store.write() as conn:
        conn.execute("INSERT INTO wisdom_eval_runs (run_id, kind, extractor_version, method_version, n, metrics_json, "
                     "created_at) VALUES ('r', 'extractor_calibration', 'v', 'm', 3, ?, 't')",
                     (json.dumps({"model": "claude-opus-5", "effort": "high", "output_tokens_p90": 4321}),))
    with store.read() as conn:
        assert budget.output_token_estimate(conn, "claude-opus-5", "high") == 4321
        assert budget.output_token_estimate(conn, "claude-opus-5", "low") == budget.DEFAULT_OUTPUT_TOKENS
