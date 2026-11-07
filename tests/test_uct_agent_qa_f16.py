"""UCT Agent program, agent-qa: F-16 FINAL RULING rails, server half — INDEPENDENT of agent-sc's hidden list.

QA's own prohibited set (#653 review + owner) is written HERE, not imported, so this rail cannot pass because the
implementation's list and its test share a mistake. Every name in it must be enforced (agent-sc's set may be larger:
it adds base_pivot_px and blended_growth). For each name, every way a spec can USE a field is attacked:
filter key · `other` comparison · logic leaf (all/any/not) · arith term · sort · rank criterion · columns.
Plus: a view asked for by name that shows a hidden column; the market-cap default and its receipt note; the member
Screener's own server files untouched; and no UCT weight or formula named in the model's instructions.
"""
from __future__ import annotations

import json
import re
import subprocess
import warnings
from pathlib import Path

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


#: ⛔ THE F-16 COMMIT RULE (AUDIT ruling, 2026-11-06): no single commit may change the member Screener's server code and the
#: Agent together. It replaces SCREENER_PIN, a commit the Screener had to match exactly: every reviewed Screener landing that
#: was not Agent work (the Pine trains) turned master red until someone moved the pin by hand, twice in one day.
#: What this cannot see: one change split across two commits, one Screener, one Agent, passes. This is a tripwire for an
#: Agent change that reaches into the Screener in passing. The behavioural F-16 tests are the real protection.
#:
#: The fixed base: ab52621501, #834's last Screener commit, the last commit where Agent work reached into the Screener under
#: AUDIT's review. Everything after it was walked on 2026-11-06 and nothing mixed was found. It never moves: a new mixed
#: commit goes in the exception list below, it does not move this base.
F16_RULE_BASE = "ab52621501fa7261a8d8583a03dba15cd5568890"
SCREENER_PATHS = ("api/services/screener", "api/routers/screener.py", "api/routers/scan_results.py")
AGENT_PATHS = ("app/src/agent/", "api/services/uct_agent/", "api/routers/uct_agent.py")
#: At or before the base, so the rule never sees them. Named so the control below proves it can say no on real commits.
PRE_RULE_MIXED = {
    "ab52621501fa7261a8d8583a03dba15cd5568890": "#834, reviewed Agent scans: a comparison that mixes two clocks says so",
    "8e55deb714fbaf2ff3836e2d2dbf3dfd0538e504": "#834, reviewed Agent scans: token-list `in`, the server side of Agent composition",
    "ce69cd30eb72d7710c604aadd92193de12af2e0f": "Agent Phase 1, 2026-10-11: list-field screening in screener.py and filters.py",
}
#: The only way past the rule. A code-owned file (.github/CODEOWNERS covers baseline/), so an entry requests the owner's review.
F16_EXCEPTIONS = Path(__file__).resolve().parents[1] / "app/src/agent/qa/capabilityRegression/baseline/f16ScreenerMixExceptions.json"


def _holds_commit(sha, run=None, cwd=None):
    """Does this checkout hold `sha`? False at the master deploy gate, which fetches depth 2. `^{commit}` is what checks the
    object exists: `rev-parse --verify` accepts any 40 hex digits otherwise, and the skip would never happen."""
    run = run or subprocess.run
    return run(["git", "rev-parse", "--verify", "--quiet", sha + "^{commit}"], capture_output=True, text=True, cwd=cwd).returncode == 0


def _is_mixed(files):
    return (any(f == p or f.startswith(p.rstrip("/") + "/") for f in files for p in SCREENER_PATHS)
            and any(f == p or f.startswith(p) for f in files for p in AGENT_PATHS))


def _screener_commits(base, head="HEAD", cwd=None):
    """{non-merge commit in base..head that touches the Screener: every file it touches}. `--full-history`: default history
    simplification drops a side branch's commit behind a merge, which is where a mixed commit would sit. `--full-diff` lists all
    of a commit's files, not only the ones under the paths."""
    r = subprocess.run(["git", "log", "--no-merges", "--full-history", "--full-diff", "--name-only", "--format=%x00%H",
                        f"{base}..{head}", "--", *SCREENER_PATHS], capture_output=True, text=True, cwd=cwd)
    assert r.returncode == 0, r.stderr
    out = {}
    for chunk in r.stdout.split("\0")[1:]:
        sha, *files = chunk.split()
        out[sha] = files
    return out


def _mixed_commits(base, head="HEAD", cwd=None):
    return sorted(sha for sha, files in _screener_commits(base, head, cwd).items() if _is_mixed(files))


def _exceptions():
    return json.loads(F16_EXCEPTIONS.read_text(encoding="utf-8"))["exceptions"]


def test_a_commit_this_checkout_does_not_hold_is_not_taken_for_a_commit():
    def fake(code):
        return lambda cmd, **kw: subprocess.CompletedProcess(cmd, code, "", "")
    assert _holds_commit(F16_RULE_BASE, run=fake(0)) is True
    assert _holds_commit(F16_RULE_BASE, run=fake(128)) is False
    assert _holds_commit("0" * 40) is False
    assert re.fullmatch(r"[0-9a-f]{40}", F16_RULE_BASE), "a full commit id, never a ref that can move"


def test_no_commit_since_the_base_changes_the_screener_and_the_agent_together():
    if not _holds_commit(F16_RULE_BASE):
        # the master deploy gate fetches depth 2: the walk cannot be made there, and a skip is the honest reading.
        pytest.skip("the rule's base %s is not in this checkout" % F16_RULE_BASE)
    walked = _screener_commits(F16_RULE_BASE)
    excused = {e["sha"] for e in _exceptions()}
    mixed = sorted(sha for sha, files in walked.items() if _is_mixed(files))
    # in the log's warnings summary, because `pytest -q` names no test: this line is how a CI log shows the walk really ran
    warnings.warn(f"F-16 commit rule walked {len(walked)} Screener commits since {F16_RULE_BASE[:10]}: {len(mixed)} mixed, {len(excused)} excused")
    assert sorted(set(mixed) - excused) == [], (
        "a commit changes the member Screener and the Agent together. Split it, or add its full SHA with a review reference "
        f"to {F16_EXCEPTIONS.name}, which needs the owner's review")


def test_control_the_rule_says_no_on_real_commits():
    """CONTROL: with the base set before them, the rule must name all three pre-rule commits, and only those."""
    oldest = "ce69cd30eb72d7710c604aadd92193de12af2e0f"
    if not _holds_commit(oldest) or not _holds_commit(F16_RULE_BASE):
        pytest.skip("the pre-rule commits are not in this checkout")
    assert _mixed_commits(oldest + "~1", F16_RULE_BASE) == sorted(PRE_RULE_MIXED)
    # each alone, so one cannot stand in for another
    for sha in PRE_RULE_MIXED:
        assert _mixed_commits(sha + "~1", sha) == [sha], PRE_RULE_MIXED[sha]
    assert all(why.strip() for why in PRE_RULE_MIXED.values())


def test_a_screener_only_commit_like_pine_w9_passes():
    sha = "b6115e9b4d120ef228027dd412ef5820ee75c3a0"
    if not _holds_commit(sha):
        pytest.skip("the Pine W9 commit is not in this checkout")
    assert "api/services/screener/scan_evaluator.py" in _screener_commits(sha + "~1", sha)[sha]   # it IS a Screener commit
    assert _mixed_commits(sha + "~1", sha) == []


def test_a_future_mixed_commit_fails_and_only_the_list_lets_it_through(tmp_path):
    """On a throwaway repo, so the rule is proved on commits that do not exist yet."""
    def git(*a):
        r = subprocess.run(["git", "-c", "user.name=t", "-c", "user.email=t@t", *a], cwd=tmp_path, capture_output=True, text=True)
        assert r.returncode == 0, r.stderr
        return r.stdout.strip()

    def commit(*paths):
        for p in paths:
            f = tmp_path / p
            f.parent.mkdir(parents=True, exist_ok=True)
            f.write_text(f"{p} {len(list(tmp_path.rglob('*')))}\n", encoding="utf-8")
        git("add", "-A")
        git("commit", "-q", "-m", "x")
        return git("rev-parse", "HEAD")
    git("init", "-q")
    base = commit("README.md")
    only_screener = commit("api/services/screener/a.py")
    only_agent = commit("app/src/agent/a.js")
    lookalike = commit("api/services/screener_backtest.py", "app/src/agent/b.js")   # not under the Screener's own path
    mixed = commit("api/routers/screener.py", "api/services/uct_agent/b.py")
    assert _mixed_commits(base, cwd=tmp_path) == [mixed]
    for clean in (only_screener, only_agent, lookalike):
        assert clean not in _mixed_commits(base, cwd=tmp_path)
    # a mixed commit on a side branch, behind a merge that takes the other side's tree, is still found (`--full-history`)
    git("checkout", "-q", "-b", "side", only_screener)
    hidden_side = commit("api/services/screener/c.py", "app/src/agent/c.js")
    git("checkout", "-q", "-")
    git("merge", "-q", "-s", "ours", "--no-edit", "side")
    assert sorted(_mixed_commits(base, cwd=tmp_path)) == sorted([mixed, hidden_side])


def test_every_exception_is_a_full_sha_with_a_review_reference():
    data = json.loads(F16_EXCEPTIONS.read_text(encoding="utf-8"))
    assert "owner" in data["about"].lower()
    for e in data["exceptions"]:
        assert re.fullmatch(r"[0-9a-f]{40}", e["sha"]), e
        assert e["sha"] not in PRE_RULE_MIXED, e
        assert str(e["review"]).strip(), e


def test_the_exception_list_is_code_owned():
    owners = (Path(__file__).resolve().parents[1] / ".github/CODEOWNERS").read_text(encoding="utf-8")
    assert "/app/src/agent/qa/capabilityRegression/baseline/ " in owners


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
