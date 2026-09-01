import os
import tempfile

import pytest

from api.services.catalyst import cost_guard, store


@pytest.fixture
def s(monkeypatch):
    with tempfile.TemporaryDirectory() as d:
        monkeypatch.setattr(store, "_DB_PATH", os.path.join(d, "catalysts.db"))
        store._init_db()
        # Reset module-level state
        cost_guard._HARD_CAP_TRIPPED = False
        cost_guard._SOFT_CAP_LOGGED_FOR_DATE = None
        yield


def test_under_soft_cap_allows(s):
    assert cost_guard.may_synthesize("2026-05-26") is True


def test_estimate_call_cost():
    """Opus 4.8 pricing: $5/M input, $25/M output (2026)."""
    cost = cost_guard.estimate_cost("claude-opus-4-8",
                                    input_tokens=1000, output_tokens=250)
    # 1000 * 5/1M + 250 * 25/1M = 0.005 + 0.00625 = 0.01125
    assert cost == pytest.approx(0.01125, rel=1e-3)


def test_unknown_model_falls_back_to_priciest_rate():
    """An unknown model must NOT cost $0 (that would disable the caps)."""
    cost = cost_guard.estimate_cost("claude-made-up-9", 1_000_000, 1_000_000)
    assert cost == pytest.approx(30.0, rel=1e-3)  # $5 + $25 (priciest known)


def test_haiku_pricing_is_cheaper():
    opus = cost_guard.estimate_cost("claude-opus-4-7", 1000, 250)
    haiku = cost_guard.estimate_cost("claude-haiku-4-5", 1000, 250)
    assert haiku < opus


def test_hard_cap_blocks_further_synthesis(s, monkeypatch):
    monkeypatch.setenv("CATALYST_COST_HARD_CAP", "0.10")
    store.log_cost(market_date="2026-05-26", ticker="X",
                   model="claude-opus-4-7", input_tokens=10000,
                   output_tokens=1000, cost_usd=0.50,
                   was_cached=False)
    assert cost_guard.may_synthesize("2026-05-26") is False


def test_soft_cap_logs_warning_but_allows(s, monkeypatch, caplog):
    monkeypatch.setenv("CATALYST_COST_CAP_DAILY", "0.10")
    monkeypatch.setenv("CATALYST_COST_HARD_CAP", "999.99")
    store.log_cost(market_date="2026-05-26", ticker="X",
                   model="claude-opus-4-7", input_tokens=10000,
                   output_tokens=1000, cost_usd=0.50,
                   was_cached=False)
    import logging
    with caplog.at_level(logging.WARNING):
        assert cost_guard.may_synthesize("2026-05-26") is True
    assert any("soft cap" in r.message.lower() for r in caplog.records)


def test_sonnet_5_pricing_known():
    from api.services.catalyst import cost_guard
    assert cost_guard.estimate_cost("claude-sonnet-5", 1_000_000, 0) == 3.0
    assert cost_guard.estimate_cost("claude-sonnet-5", 0, 1_000_000) == 15.0


def test_opus_5_is_priced_BY_NAME_not_by_the_fallback(caplog):
    """⛔ THE FALLBACK RATE IS ALSO $5/$25 (the priciest known is Opus-class), so a
    price-only assertion is green with or WITHOUT the entry and measures nothing.
    Worse, the usual "a bogus id must not price the same as the real one" probe is
    VACUOUS here for the same reason: both come back $30.00. Two things do
    distinguish the paths — the table itself, and the guard's own warning."""
    import logging
    from api.services.catalyst import cost_guard

    # (1) structural: the id is a KEY of the table, asked OF the table.
    assert "claude-opus-5" in cost_guard._PRICING, (
        "claude-opus-5 has no _PRICING entry — the caps would run on the fallback")

    # (2) behavioural: the guard took the named path, and it says so.
    with caplog.at_level(logging.WARNING, logger="api.services.catalyst.cost_guard"):
        cost = cost_guard.estimate_cost("claude-opus-5", 1_000_000, 1_000_000)
    assert cost == pytest.approx(30.0, rel=1e-3)          # $5 in + $25 out
    assert not [r for r in caplog.records if "unknown model pricing" in r.getMessage()], (
        "claude-opus-5 was priced by the FALLBACK — add it to _PRICING")

    # (3) the control: the probe CAN fail. A bogus id prices to the same $30.00
    #     and is still distinguishable, which is the whole point of using the log.
    caplog.clear()
    with caplog.at_level(logging.WARNING, logger="api.services.catalyst.cost_guard"):
        bogus = cost_guard.estimate_cost("claude-made-up-9", 1_000_000, 1_000_000)
    assert bogus == pytest.approx(30.0, rel=1e-3), "the fallback rate moved — reread this test"
    assert [r for r in caplog.records if "unknown model pricing" in r.getMessage()]


def test_record_adds_web_search_fees(monkeypatch):
    from api.services.catalyst import cost_guard, store
    logged = {}
    monkeypatch.setattr(store, "log_cost", lambda **kw: logged.update(kw))
    cost = cost_guard.record("2026-07-02", "__hunter__", "claude-opus-4-8",
                             0, 0, search_requests=100)
    assert cost == 1.0  # 100 searches x $0.01
    assert logged["cost_usd"] == 1.0


def test_cache_tokens_are_priced_not_ignored():
    """hunter.py runs prompt-CACHED: its prefix bills under
    cache_read_input_tokens (0.1x) / cache_creation_input_tokens (1.25x)
    instead of input_tokens. Pricing only input_tokens under-counted the
    cached lane and silently loosened the $8/$15 daily caps (2026-08-28)."""
    from api.services.catalyst import cost_guard
    # sonnet-5 input = $3/MTok in this module's table
    assert cost_guard.estimate_cost("claude-sonnet-5", 0, 0,
                                    cache_read_tokens=1_000_000) == 0.3
    assert cost_guard.estimate_cost("claude-sonnet-5", 0, 0,
                                    cache_creation_tokens=1_000_000) == 3.75
    # and the old positional contract is unchanged
    assert cost_guard.estimate_cost("claude-sonnet-5", 1_000_000, 0) == 3.0


def test_hunter_reports_cache_tokens_to_the_guard():
    """Mutation guard: the accumulator must actually reach cost_guard.record —
    a cached call whose cache fields are dropped bills as if it were free."""
    import inspect
    from api.services.catalyst import hunter
    src = inspect.getsource(hunter.run_hunt)
    assert "cache_read_input_tokens" in src
    assert "cache_read_tokens=cr_tok" in src
    assert "cache_creation_tokens=cc_tok" in src


# ─── 🔴 A POPULATION OF MEMBERS MUST NOT STARVE THE SCHEDULED LANES ──────────

def _spend(date, who, usd):
    """Record `usd` of spend under `who`, priced through the real estimator."""
    cost_guard.record(date, who, "claude-opus-5",
                      int(usd * 1_000_000 / 5.0), 0)


def test_member_lanes_cannot_spend_the_scheduled_lanes_out_of_budget(s):
    """⛔⛔ MEASURED BEFORE THE FIX: 20 members using the concierge's OWN per-user
    allowance ($0.75/day) took shared spend from $0 to the $15 hard cap, and
    `may_synthesize` — the gate the SCHEDULED catalyst lanes ask — then returned
    False for the rest of the day. The morning catalyst table silently does not
    get built, for a reason with nothing to do with catalysts.

    ⭐ A PER-USER CAP DOES NOT BOUND A POPULATION. The concierge caps ONE member;
    nothing capped N members together. The fix expresses the missing bound as a
    FLOOR for the scheduled lanes, because that is the property actually wanted.
    """
    date = "2026-09-01"
    per_user = 0.75          # CONCIERGE_USER_CAP_DAILY's default

    fired = 0
    while cost_guard.may_member_spend(date) and fired < 200:
        fired += 1
        _spend(date, f"concierge:user{fired}", per_user)

    assert fired < 200, "the member gate never closed — it is not a bound at all"
    # ⭐ THE ASSERTION THAT MATTERS: the scheduled lanes are still open.
    assert cost_guard.may_synthesize(date) is True, (
        "member-triggered lanes spent the scheduled lanes out of budget — this is "
        "exactly the starve this reserve exists to prevent")

    spent = store.cost_stats_for_date(date)["total_cost_usd"]
    hard = 15.00
    assert hard - spent >= cost_guard.scheduled_reserve_usd() - 0.01, (
        f"only ${hard - spent:.2f} left for the scheduled lanes against a "
        f"${cost_guard.scheduled_reserve_usd():.2f} reserve")


def test_the_reserve_is_a_FLOOR_whatever_order_the_spending_arrives_in(s):
    """⛔ THE GUARANTEE IS ORDER-INDEPENDENT, and that is why the gate counts
    TOTAL spend rather than member spend. If it counted only member spend, a
    heavy scheduled day plus a full member allowance could still cross the cap
    together — each lane inside its own budget, the sum outside both."""
    date = "2026-09-02"
    _spend(date, "AAPL", 4.00)            # a heavy scheduled day, first
    fired = 0
    while cost_guard.may_member_spend(date) and fired < 200:
        fired += 1
        _spend(date, f"concierge:user{fired}", 0.75)

    assert cost_guard.may_synthesize(date) is True
    left = 15.00 - store.cost_stats_for_date(date)["total_cost_usd"]
    # ⚠️ THE FLOOR IS `reserve` MINUS ONE IN-FLIGHT CALL, and this case is what
    # established that. The gate is asked BEFORE a call and the call then spends,
    # so the last admitted member crosses the line by their own cost — measured
    # here, $5.75 against a $6 reserve. The docstring said "by construction" until
    # this failed. The overshoot is bounded by ONE call, which is the reason the
    # reserve is set well above any single call rather than trimmed to the
    # catalyst engine's expected spend.
    one_call = 0.75
    assert left >= cost_guard.scheduled_reserve_usd() - one_call - 0.01, (
        f"${left:.2f} left is more than one call below the "
        f"${cost_guard.scheduled_reserve_usd():.2f} reserve")


def test_the_scheduled_lanes_keep_the_WHOLE_cap_for_themselves(s):
    """⛔ THE RESERVE IS NOT A SECOND CAP ON THE SCHEDULED LANES. They may still
    use the full $15 — the reserve only says member lanes stop earlier. A fix
    that tightened both would quietly cut the catalyst engine's own budget."""
    date = "2026-09-03"
    _spend(date, "MSFT", 10.00)           # scheduled spend, past the member line
    assert cost_guard.may_member_spend(date) is False, (
        "member lanes should already be paused at $10 of $15 with a $6 reserve")
    assert cost_guard.may_synthesize(date) is True, (
        "the scheduled lanes were cut off at the member line — they own the cap")


def test_the_member_gate_is_STRICTLY_tighter_and_not_a_copy(s):
    """⛔ NON-VACUITY. If `may_member_spend` were `may_synthesize` under another
    name, every case above would still pass and nothing would be reserved."""
    date = "2026-09-04"
    _spend(date, "NVDA", 9.50)
    assert cost_guard.may_member_spend(date) is False
    assert cost_guard.may_synthesize(date) is True
    assert cost_guard.scheduled_reserve_usd() > 0
