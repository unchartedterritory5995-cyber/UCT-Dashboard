"""The extractor view recovers an identity the product view cannot see — and drops nothing.

⭐ WHY THIS RAIL. In the gate's isolated environment the entity master resolves nothing, so every
CALL is demoted to MENTION before it is persisted (`writer.py:504`). Keyed on `record_type`, the
reconciler then reports CALL over an empty population and folds the demoted CALLs into MENTION's
bucket under the same tickers. Both numbers are wrong and NEITHER LOOKS WRONG — "CALL: 0
identities" reads as a quiet corpus, not as a broken instrument
(`lesson_a_saturated_instrument_reports_zero`).

`as_extractor_view` re-keys the same rows onto `pre_entity_type` / `pre_entity_key` and hands them
to the SAME reconciler. This pins the two properties that make that trustworthy:

  * it RECOVERS what the product view cannot see (CALL comes back);
  * it DROPS NOTHING — the population is identical, so the two views are comparable.

The second is the one that would fail silently: a transform that quietly skipped rows would still
"recover CALL" and would understate every other type beside it.
"""
from __future__ import annotations

import importlib.util
import pathlib
import sys

REPO = pathlib.Path(__file__).resolve().parents[1]


def _load(name: str, relpath: str):
    spec = importlib.util.spec_from_file_location(name, REPO / relpath)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


analysis = _load("_three_pass_under_test", "tools/wisdom/three_pass_analysis.py")


def _row(segment, *, pre_type, post_type, ticker, stance="long"):
    """One persisted row, shaped as `gate_records.record_rows` writes it."""
    return {
        "segment_id": segment,
        "record_type": post_type,
        "pre_entity_type": pre_type,
        "record_key": [post_type, ticker, stance, None],
        "pre_entity_key": [pre_type, ticker, stance, None],
        "record_id": f"{segment}-{pre_type}-{ticker}",
    }


def _run(run_id):
    return {
        "run_id": run_id,
        "extractor_version": "wx-v0-testtest",
        "segments": {"seg-1"},
        "rows": [
            # a CALL the entity step demoted — the case this exists for
            _row("seg-1", pre_type="CALL", post_type="MENTION", ticker="NVDA"),
            # a genuine MENTION, so the two cannot be told apart by position alone
            _row("seg-1", pre_type="MENTION", post_type="MENTION", ticker="AMD"),
            # a type that is never demoted, as a control on both views agreeing
            _row("seg-1", pre_type="PRINCIPLE", post_type="PRINCIPLE", ticker=None, stance=None),
        ],
    }


def _types(runs, view):
    from api.services.wisdom.extract import reconcile

    prepared = [analysis.as_extractor_view(r) for r in runs] if view == "extractor" else runs
    result = reconcile.reconcile(prepared)
    return reconcile.histogram(result), result


def test_the_product_view_cannot_see_the_demoted_call():
    hist, _ = _types([_run("a"), _run("b")], "product")
    assert "CALL" not in hist, "a demoted CALL must not appear under record_type"
    assert hist["MENTION"]["total"] == 2, "the demoted CALL is folded into MENTION's bucket"


def test_the_extractor_view_recovers_it():
    hist, _ = _types([_run("a"), _run("b")], "extractor")
    assert "CALL" in hist, "re-keying on pre_entity_type must bring the CALL back"
    assert hist["CALL"]["total"] == 1
    assert hist["MENTION"]["total"] == 1, "and MENTION must shed the one that was never a MENTION"


def test_the_two_views_cover_exactly_the_same_population():
    """⛔ THE CONTROL. A transform that silently dropped rows would still 'recover CALL'."""
    runs = [_run("a"), _run("b")]
    product_hist, product = _types(runs, "product")
    extractor_hist, extractor = _types(runs, "extractor")
    assert sum(s["total"] for s in product_hist.values()) == sum(s["total"] for s in extractor_hist.values())
    assert len(product["scores"]) == len(extractor["scores"]) == 3
    assert product["n"] == extractor["n"] == 2


def test_a_never_demoted_type_is_identical_in_both_views():
    """PRINCIPLE and MARKET_SIGNAL are never demoted, so the views must agree on them exactly."""
    runs = [_run("a"), _run("b")]
    product_hist, _ = _types(runs, "product")
    extractor_hist, _ = _types(runs, "extractor")
    assert product_hist["PRINCIPLE"] == extractor_hist["PRINCIPLE"]


def test_a_row_without_a_pre_entity_key_is_kept_not_dropped():
    runs = [_run("a"), _run("b")]
    for r in runs:
        r["rows"] = [dict(row) for row in r["rows"]]
        r["rows"][1].pop("pre_entity_key")
    _, extractor = _types(runs, "extractor")
    assert len(extractor["scores"]) == 3, "an unkeyable row is left as it is, never discarded"


def test_the_rename_audit_never_reports_key_text():
    """⛔⛔ MARKET_SIGNAL keys are `normalize_quote_key` of model-written names — quote-derived.

    This repo is public and §0.4f keeps quote-bearing text out of git, so the analysis must carry
    counts and drop `examples` entirely. A truncated quote is still a quote.
    """
    src = (REPO / "tools" / "wisdom" / "three_pass_analysis.py").read_text(encoding="utf-8")
    body = src.split("audit_market_signal_renames", 1)[1]
    assert '"examples"' in body, "the drop must name the field it drops, or it stops dropping it"
    assert "k != \"examples\"" in body or "k != 'examples'" in body
