"""UCT Agent program, agent-qa: F-16 FINAL RULING rails, server half — INDEPENDENT of agent-sc's hidden list.

QA's own prohibited set (#653 review + owner) is written HERE, not imported, so this rail cannot pass because the
implementation's list and its test share a mistake. Every name in it must be enforced (agent-sc's set may be larger:
it adds base_pivot_px and blended_growth). For each name, every way a spec can USE a field is attacked:
filter key · `other` comparison · logic leaf (all/any/not) · arith term · sort · rank criterion · columns.
Plus: a view asked for by name that shows a hidden column; the market-cap default and its receipt note; the member
Screener's own server files untouched; and no UCT weight or formula named in the model's instructions.
"""
from __future__ import annotations

import pytest

from api.services.uct_agent import turn
from api.services.uct_agent.scan import hidden, spec as scan_spec

QA_PROHIBITED = {
    # the ruling's 24
    "uct_composite", "rating_eps", "rating_growth", "rating_value", "rating_smr", "sponsorship", "accdis", "rs_rank",
    "rs_return", "dp_notional_1d", "dp_prints_1d", "dp_notional_5d", "dp_level_dist_pct", "opt_net_premium_1d",
    "opt_bull_pct_1d", "opt_net_premium_5d", "candle_score", "earnings_setup_grade", "pattern_engine_id",
    "pattern_engine_conf", "pattern_engine_dir", "pattern_engine_vcp", "pattern_engine_flat_base", "in_uct20",
    # QA #653 set B
    "sector_rs_pct", "pattern_entry_dist_pct", "pattern_stop_dist_pct", "pattern_expectancy_r",
    # owner additions
    "archive_calls_n", "base_structure", "base_relation_count", "hvc_52w", "theme",
}
FLOW = {k for k in QA_PROHIBITED if k.startswith(("dp_", "opt_"))}
SENTENCES = {hidden.RATINGS_REFUSAL, hidden.FLOW_REFUSAL}
ALL = sorted(QA_PROHIBITED)


def test_non_vacuity_33_names_and_every_one_is_in_the_screener_catalog():
    from api.services.screener import filters
    keys = {f["key"] for f in filters.field_catalog()}
    assert len(QA_PROHIBITED) == 33
    assert QA_PROHIBITED <= keys, sorted(QA_PROHIBITED - keys)


def test_every_QA_name_is_enforced_by_the_implementation():
    assert QA_PROHIBITED <= set(hidden.hidden_keys()), sorted(QA_PROHIBITED - set(hidden.hidden_keys()))


def _refused(spec: dict) -> str:
    with pytest.raises(scan_spec.SpecError) as e:
        scan_spec.validate(spec)
    return str(e.value)


def _want(k):
    return hidden.FLOW_REFUSAL if k in FLOW else hidden.RATINGS_REFUSAL


@pytest.mark.parametrize("k", ALL)
def test_every_USE_of_a_prohibited_field_is_refused_with_the_clear_sentence(k):
    cases = {
        "filter": {"filters": [{"key": k, "op": "gte", "min": 1}]},
        "other": {"filters": [{"key": "price", "op": "gt", "other": k}]},
        "logic all": {"logic": {"all": [{"key": "price", "op": "gte", "min": 5}, {"key": k, "op": "gte", "min": 1}]}},
        "logic not": {"logic": {"not": {"key": k, "op": "gte", "min": 1}}},
        "arith": {"filters": [{"key": "arith", "op": "gt", "lhs": {"o": "*", "a": {"f": k}, "b": {"n": 1}}, "rhs": {"n": 0}}]},
        "sort": {"sort": {"key": k, "dir": "desc"}},
        "rank": {"rank": {"criteria": [{"key": k, "weight": 1}]}},                  # the screener's own shape
        "rank column": {"rank": {"criteria": [{"column": k, "weight": 1}]}},
        # BYPASS (found by the agent-int review of W1-SEC #704): the screener's ranking reads `key` and ignores a
        # `column` on the request, so a public column beside a hidden key once validated and ranked by the rating
        "rank public column, hidden key": {"rank": {"criteria": [{"column": "price", "key": k, "weight": 1}]}},
        "rank hidden column, public key": {"rank": {"criteria": [{"column": k, "key": "price", "weight": 1}]}},
        "columns": {"columns": ["ticker", k]},
    }
    for how, spec in cases.items():
        assert _refused(spec) == _want(k), (k, how)


def test_CONTROL_public_inputs_still_screen_sort_and_rank():
    """The owner kept these visible (F-16-R): a member's own public-data screen must still validate."""
    ok = scan_spec.validate({"filters": [{"key": "chg_pct_3m", "op": "gte", "min": 10}, {"key": "peg", "op": "lte", "max": 2}],
                             "sort": {"key": "inst_pct", "dir": "desc"}, "columns": ["ticker", "eps_growth", "roe"]})
    assert ok["sort"] == {"key": "inst_pct", "dir": "desc"}
    # a rank by a public field, in the screener's own criterion shape, is accepted and kept (no default sort added)
    ranked = scan_spec.validate({"filters": [], "rank": {"criteria": [{"key": "price", "weight": 1}], "top_n": 5}})
    assert ranked["rank"] == {"criteria": [{"key": "price", "weight": 1}], "top_n": 5} and "sort" not in ranked
    assert "rank criterion names" in _refused({"filters": [], "rank": {"criteria": [{"weight": 1}]}})   # no key


def test_a_view_asked_for_by_name_that_shows_a_prohibited_column_is_refused():
    offenders = [v for v in sorted(scan_spec.view_names()) if set(scan_spec.view_columns(v)) & QA_PROHIBITED]
    assert offenders, "non-vacuity: some view shows a prohibited column"
    for v in offenders:
        assert _refused({"view": v}) in SENTENCES, v


def test_no_order_asked_means_market_cap_desc_never_the_composite():
    out = scan_spec.validate({"filters": [{"key": "price", "op": "gte", "min": 5}]})
    assert out["sort"] == {"key": "market_cap", "dir": "desc"}
    assert "market cap" in scan_spec.DEFAULT_ORDER_NOTE.lower()


#: The base the "member Screener untouched" rail diffs against, first one that resolves in THIS checkout:
#: agent-ci fetches `origin/agent/int`; a master checkout has `origin/master`; a local clone may only carry `master`.
DIFF_BASE_REFS = ("origin/agent/int", "origin/master", "master")


def _diff_base(refs=DIFF_BASE_REFS, run=None):
    """The first ref in `refs` that `git rev-parse --verify` accepts, or None when none does (a shallow checkout
    with no base ref, e.g. the master deploy gate's fetch-depth 2)."""
    import subprocess
    run = run or subprocess.run
    for ref in refs:
        r = run(["git", "rev-parse", "--verify", "--quiet", ref], capture_output=True, text=True)
        if r.returncode == 0:
            return ref
    return None


def test_the_diff_base_is_the_first_ref_the_checkout_resolves(monkeypatch):
    """Pins the fallback order: agent/int (agent-ci) before master (the gate), before a bare local `master`."""
    import subprocess
    calls = []

    def fake(cmd, **kw):
        calls.append(cmd[-1])
        return subprocess.CompletedProcess(cmd, 0 if cmd[-1] in present else 128, "", "fatal: bad revision")

    present = {"origin/agent/int", "origin/master", "master"}
    assert _diff_base(run=fake) == "origin/agent/int" and calls == ["origin/agent/int"]     # stops at the first hit
    calls.clear(); present = {"origin/master", "master"}
    assert _diff_base(run=fake) == "origin/master" and calls == ["origin/agent/int", "origin/master"]
    calls.clear(); present = {"master"}
    assert _diff_base(run=fake) == "master"
    calls.clear(); present = set()
    assert _diff_base(run=fake) is None
    assert calls == ["origin/agent/int", "origin/master", "master"]              # every ref tried, in this order


def test_the_member_screeners_own_server_code_is_untouched_by_the_F16_work():
    import subprocess
    base = _diff_base()
    if base is None:
        # A shallow checkout with no base ref (the master deploy gate fetches depth 2 and no agent/int) cannot carry
        # this comparison at all; a skip is the honest reading there. agent-ci fetches the ref and runs it for real.
        pytest.skip("no base ref in this checkout (none of %s resolves)" % ", ".join(DIFF_BASE_REFS))
    r = subprocess.run(["git", "diff", "--name-only", f"{base}...HEAD", "--", "api/services/screener",
                        "api/routers/screener.py", "api/routers/scan_results.py"], capture_output=True, text=True)
    assert r.returncode == 0, r.stderr
    assert r.stdout.strip() == "", r.stdout


def test_no_UCT_weight_or_formula_is_named_in_the_models_instructions():
    """Owner: the Agent must not deliberately reproduce UCT formulas or expose weights. The RS terms
    (rs_weighted_return.RS_TERMS) and the setup-score point table must not appear in what the model is told."""
    from api.services import rs_weighted_return as rsw
    text = turn.system_prompt([]) + "\n" + turn._glossary_text()
    assert text.strip(), "non-vacuity"
    for name, _days, w in rsw.RS_TERMS:
        assert f"{w:.2f}·{name}" not in text and f"{w} * {name}" not in text
    for marker in ("rs_weighted_return", "RS_TERMS", "setup_score", "weighted RS", "0.40·3m"):
        assert marker not in text, marker
