"""UCT Agent program, agent-qa: F-16 FINAL RULING rails, server half — INDEPENDENT of agent-sc's hidden list.

QA's own prohibited set (#653 review + owner) is written HERE, not imported, so this rail cannot pass because the
implementation's list and its test share a mistake. Every name in it must be enforced (agent-sc's set may be larger:
it adds base_pivot_px and blended_growth). For each name, every way a spec can USE a field is attacked:
filter key · `other` comparison · logic leaf (all/any/not) · arith term · sort · rank criterion · columns.
Plus: a view asked for by name that shows a hidden column; the market-cap default and its receipt note; the member
Screener's own server files untouched; and no UCT weight or formula named in the model's instructions.
"""
from __future__ import annotations

import re

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
#: ⛔ THE SCREENER AS LAST REVIEWED (AUDIT ruling, 2026-11-05). The guard used to diff against `agent/int`, a moving ref long
#: behind master, so any branch that merged master read as an Agent edit. A pin keeps the guard meaningful: the member
#: Screener's server code must match this commit exactly. Moving it is a review decision, made in the commit that changes
#: that code on purpose, and that commit's message says why. This pin is #834's last Screener commit, ab52621501, which holds #827's primitives (920fdcc1bb) and #834's token test,
#: `logic_enabled`, `live_fields` and clock definitions.
#: The commit itself must be the pin, not its merge base: a merge base predates the reviewed change, and the guard would
#: then report that very change.
#: move this pin when a reviewed PR intentionally changes api/services/screener
#: MOVED 2026-11-05 to be5fd05ea2, PR #857 (the Pine landing train): its reviewed W5-T14 (scans) and W5-T15 (backtest)
#: lanes change backtest.py, scan_evaluator.py, scan_run.py and scan_runtime.py on purpose (reviews W5-T14 ab034f0d28,
#: W5-T15 8550ef036b, train review 1eb3ba53e5). The pin is the merge commit that brought that reviewed change to master, and it also holds #834's ab52621501.
#: MOVED 2026-11-06 to 3ca4b0d358, PR #869 (Pine W9 landing): its reviewed W9-T14a lane (review GO-WITH-NOTES, dsk/reviews/W9-T2.md)
#: changes scan_evaluator.py and snapshot_builder.py on purpose (b6115e9b4d: one history window, bars_window.HISTORY_WINDOW_BARS;
#: value still 5000, behaviour identical). The pin is the merge commit that brought it to master; it also holds be5fd05ea2.
# Re-pinned 2026-11-07: the UCT Relative Strength programme (feat/uct-rs-phase2a) is the first
# DELIBERATE Screener change since 3ca4b0d358 (W5-T14): seventeen RS columns, their filters,
# starters and methodology. The pin is now that programme's last Screener commit (VA6), so the
# guard keeps its meaning: the F16 Agent work must not touch the Screener after it.
# Re-pinned again 2026-11-07 (RS go-live): the owner-delegated decisions (PR #913) change
# rs_history.py (split guard, backfill), snapshot_db.py (the bars_rs receipt column) and
# methodology.py on purpose. The pin is that work's last Screener commit; master changed no
# Screener file since the RS branches split from it, so the go-live merge adds nothing here.
# Re-pinned 2026-11-08 (UCT RS Phase 3, integration unit 3-14): the Phase 3 programme changes the
# Screener on purpose, dark behind RS_V3_ENABLED: afc25422d7 (VA3, methodology's evidence sentence),
# df1ffd8472 (3-10, the rrg_quadrant / clenow_score / vars_state collector in rs_columns.py,
# snapshot_builder.py and snapshot_db.py), 30300b263e and fa88a026c5 (3-11, their filters and
# methodology entries). The pin is that work's last Screener commit; master changed no Screener
# file since the Phase 3 branch split from it.
# Re-pinned 2026-11-08 (UCT RS Phase 4, integration unit 4-11): unit 4-01 changes snapshot_db.py on
# purpose, dark behind RS_LISTS_ENABLED: status() gains the read-only `rs_lists` receipt
# (deb8078927, `_rs_lists_last_run`, which reads rs_lists.last_run() and never raises). The pin is
# that work's last Screener commit; no other Screener file changed since the Phase 3 pin.
# Re-pinned 2026-11-08 (RS 9M component rank, landed via PR #961): 9c3f881e2c changes rs_history.py on
# purpose (the 9M component rank in the rating history + a fill-only backfill mode). It is the only
# Screener file changed since deb8078927 (`git diff --name-only deb8078927...origin/master -- <paths>`).
# Re-pinned 2026-11-10 (Pine engine 44, VAR-OFF, PR #1017): e98a7ffa8e changes api/services/screener/scan_evaluator.py
# on purpose (passes varOriginAbsolute so a scan on a `var` that began before the loaded bars is refused by name;
# review GO-WITH-NOTES, dsk/reviews/VAR-OFF.md). The pin is the merge commit that brought it to master.
# Re-pinned 2026-11-10 (Screener speed, batch speed-2): e1a715868b and 966bca5191 change query.py and snapshot_builder.py on
# purpose (the stale-row gate is computed once per snapshot, and a failed read is never kept; results pinned equal; independently
# reviewed). The pin is that work's last Screener commit; no other Screener file changed since d72c0e62f2.
# Re-pinned 2026-11-10 (Anticipation preset, PR #1044): 54dabb6cb4 changes filters.py, saved_screens.py, snapshot_db.py
# and technicals.py on purpose (the Anticipation built-in preset and the new nightly `min_volume_3d_prior` / MINV3.1
# primitive). It is the only Screener commit since 966bca5191 (`git log 966bca5191..origin/master -- <paths>`). It left
# master's deploy gate red; re-pinned by the desktop speed session to unblock every deploy behind it.
# Re-pinned 2026-11-10 (live screener): 1a26d4ea00 changes live_tier.py, technicals.py and snapshot_db.py on
# purpose (five more live columns, and the four live_base_* columns the nightly build now stores for them). It is
# the only Screener commit since 54dabb6cb4; re-pinned in the same PR so master's deploy gate never goes red.
# Re-pinned 2026-11-11 (UCT RS split, PR #1021): the RS work changes filters.py, snapshot_db.py, snapshot_builder.py,
# methodology.py, identities.py and rs_history.py on purpose (Rank 9M column, picker-hidden RS columns, one RS Rating
# everywhere). Every Screener commit since 1a26d4ea00 is that PR; pinned at its merge so master's deploy gate goes green.
# Re-pinned 2026-11-10 (live overlay write): 823eef1ed9 changes snapshot_db.py and live_tier.py on purpose (multi-row
# statements instead of executemany, the GIL convoy, and two timing fields). Re-pinned in the same PR; it contains the RS split above.
# Re-pinned 2026-11-11 (live sweep cadence): 4b6891784e changes live_tier.py on purpose (30 s default cadence and the
# rest that keeps a slow sweep from running back to back). Re-pinned in the same PR.
# Re-pinned 2026-11-13 (RS Exit Warnings in the screener): 5540c75663 changes rs_columns.py, filters.py,
# methodology.py, saved_screens.py, snapshot_db.py and identities.py on purpose (five rs_exit_* columns from the
# chart's rsExit maths, their filters, starters and methodology). Re-pinned in the same PR.
SCREENER_PIN = "5540c7566397669d138ee2854bab0899924f9cf9"
SCREENER_PATHS = ("api/services/screener", "api/routers/screener.py", "api/routers/scan_results.py")
# The F16 change set is immutable: #1029's own PR head (merged as 4dacc81529). The rail compares the pin against THIS commit,
# never HEAD, so a later Screener change by another team (e.g. #1021, the RS split) can no longer turn master's deploy gate
# red. It asks exactly what it claims: did the F16 work touch the member Screener's server code? Full id, never a ref.
# `pin...F16_HEAD` diffs from their merge base (292983f4bc for both 1a26d4ea00 and 7c09a4d303), so re-pinning SCREENER_PIN
# for later Screener PRs is no longer needed and does not change what this rail reads.
F16_HEAD = "523fa4e0122dc614106c14fed9785395c7dd99cc"


def _diff_base(pin=SCREENER_PIN, run=None):
    """The pin, or None when this checkout does not hold it (the master deploy gate fetches depth 2). `^{commit}` is what
    checks the object exists: `rev-parse --verify` accepts any 40 hex digits otherwise, and the skip would never happen."""
    import subprocess
    run = run or subprocess.run
    r = run(["git", "rev-parse", "--verify", "--quiet", pin + "^{commit}"], capture_output=True, text=True)
    return pin if r.returncode == 0 else None


def _screener_diff(base, head=F16_HEAD, run=None):
    import subprocess
    run = run or subprocess.run
    return run(["git", "diff", "--name-only", f"{base}...{head}", "--", *SCREENER_PATHS], capture_output=True, text=True)


def _f16_verdict(base, head=F16_HEAD, run=None):
    """The Screener files the F16 change set touched (empty = untouched). Raises when git itself failed."""
    r = _screener_diff(base, head, run=run)
    assert r.returncode == 0, r.stderr
    return r.stdout.split()


def test_the_diff_base_is_the_pin_when_the_checkout_holds_it():
    import subprocess

    def fake(code):
        return lambda cmd, **kw: subprocess.CompletedProcess(cmd, code, "", "")
    assert _diff_base(run=fake(0)) == SCREENER_PIN
    assert _diff_base(run=fake(128)) is None
    assert re.fullmatch(r"[0-9a-f]{40}", SCREENER_PIN), "a full commit id, never a ref that can move"


def test_a_pin_this_checkout_does_not_hold_is_not_taken_for_a_commit():
    assert _diff_base(pin="0" * 40) is None


def test_the_member_screeners_own_server_code_is_untouched_by_the_F16_work():
    base = _diff_base()
    if base is None:
        # A shallow checkout without the pin (the master deploy gate fetches depth 2) cannot carry this comparison at
        # all; a skip is the honest reading there. agent-ci fetches full history and runs it for real.
        pytest.skip("the pinned commit %s is not in this checkout" % SCREENER_PIN)
    if _diff_base(pin=F16_HEAD) is None:
        pytest.skip("the F16 head %s is not in this checkout" % F16_HEAD)
    assert _f16_verdict(base) == []


def test_the_rail_compares_against_the_fixed_F16_head_never_HEAD():
    import subprocess
    seen = []

    def spy(cmd, **kw):
        seen.append(cmd)
        return subprocess.CompletedProcess(cmd, 0, "", "")
    assert _f16_verdict(SCREENER_PIN, run=spy) == []
    assert seen[0][3] == f"{SCREENER_PIN}...{F16_HEAD}", seen
    assert re.fullmatch(r"[0-9a-f]{40}", F16_HEAD), "a full commit id, never a ref that can move"


def test_CONTROL_the_rail_fails_if_the_F16_head_had_touched_a_screener_file():
    """CONTROL: a fake diff that names a Screener file must turn the rail's verdict non-empty (the assertion would fail)."""
    import subprocess

    def touched(cmd, **kw):
        return subprocess.CompletedProcess(cmd, 0, "api/services/screener/filters.py\n", "")
    verdict = _f16_verdict(SCREENER_PIN, run=touched)
    assert verdict == ["api/services/screener/filters.py"]
    with pytest.raises(AssertionError):
        assert verdict == []

    def broken(cmd, **kw):
        return subprocess.CompletedProcess(cmd, 128, "", "fatal: bad revision")
    with pytest.raises(AssertionError):  # a git failure is never read as "untouched"
        _f16_verdict(SCREENER_PIN, run=broken)


def test_the_guard_can_say_no():
    """CONTROL, on real history: the pinned commit changed the Screener, so the same diff across it must name a file."""
    if _diff_base() is None:
        pytest.skip("the pinned commit %s is not in this checkout" % SCREENER_PIN)
    r = _screener_diff(SCREENER_PIN + "~1", SCREENER_PIN)
    assert r.returncode == 0, r.stderr
    assert "api/services/screener/rs_columns.py" in r.stdout.split()  # a file the pinned commit changed (the RS exit columns)


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
