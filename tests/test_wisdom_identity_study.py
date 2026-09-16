"""R39 — the alternative identities may raise stability, but only for the right reason.

⛔⛔ WHAT MAKES THIS DANGEROUS, and why the rails are shaped the way they are. Merging two keys
can only ever RAISE a stability score, and a raised score PUBLISHES where the floor would have
blocked. So a clustering bug here does not produce a wrong number in a report — it produces a
record on a member's screen that the programme believed three runs agreed on. Every test below
exists to stop one specific way of manufacturing that agreement:

  * two keys that appeared in the SAME run are two records, never one renamed record;
  * the guard must hold at COMPONENT level, or A~B and B~C quietly seat two co-occurring keys
    together through a third;
  * a run whose records carry no names must produce ZERO merges, never an exception and never a
    merge-by-empty-similarity;
  * the KEY identity is the control and must reproduce the ruled numbers exactly;
  * nothing an identity emits into a report field may carry extracted text.

Every fixture here is synthetic. The one check that reads the real persisted runs skips, loudly,
when they are absent rather than passing vacuously.
"""
from __future__ import annotations

import importlib.util
import pathlib
import sys

import pytest

REPO = pathlib.Path(__file__).resolve().parents[1]


def _load(name: str, relpath: str):
    spec = importlib.util.spec_from_file_location(name, REPO / relpath)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


study = _load("_identity_study_under_test", "tools/wisdom/identity_study.py")

VERSION = "wx-v0-testtest"


def _ms_row(segment, name, *, direction="bullish", ticker=None):
    key = ["MARKET_SIGNAL", name.lower().replace(" ", "-")]
    return {
        "segment_id": segment,
        "record_type": "MARKET_SIGNAL",
        "pre_entity_type": "MARKET_SIGNAL",
        "record_key": list(key),
        "market_signal_key": list(key),
        "pre_entity_key": list(key),
        "record_id": f"{segment}-{key[1]}",
        "ticker": ticker,
        "fields": {"market_signal": {"name": name, "direction": direction}},
    }


def _pr_row(segment, statement):
    """A PRINCIPLE row: record_key carries the normalised statement, principle_key is a hash."""
    norm = statement.lower().replace(" ", "-")
    return {
        "segment_id": segment,
        "record_type": "PRINCIPLE",
        "pre_entity_type": "PRINCIPLE",
        "record_key": ["PRINCIPLE", norm],
        "pre_entity_key": ["PRINCIPLE", norm],
        "principle_key": f"p_{abs(hash(norm)) % (10 ** 12):012d}",
        "record_id": f"{segment}-{norm}",
        "fields": {"principle": {"statement": statement}},
    }


def _run(run_id, rows, *, segments=("seg-1",)):
    return {"run_id": run_id, "extractor_version": VERSION, "segments": set(segments), "rows": rows}


def _ms(runs):
    return study.score(runs)["per_type"].get("MARKET_SIGNAL", {})


# ── the invariant ────────────────────────────────────────────────────────────

def test_two_keys_in_the_same_run_are_never_merged():
    """⛔ THE LOAD-BEARING ONE. Same run = two signals, however alike the names are."""
    rows = [_ms_row("seg-1", "breadth thrust alpha"), _ms_row("seg-1", "breadth thrust beta")]
    runs = [_run("a", rows), _run("b", list(rows)), _run("c", list(rows))]
    rewritten, stats = study.identity_merged_ms(runs, threshold=0.5)
    assert stats["merges"] == 0, "co-occurring keys were merged"
    assert _ms(rewritten)["total"] == 2, "two co-occurring signals must stay two identities"


def test_the_guard_holds_at_component_level_not_just_pair_level():
    """A~B and B~C must not seat A and C together when A and C co-occurred.

    ⛔ A pair-level guard passes this by accident: A and C are never themselves a candidate pair,
    so only a guard on the merged COMPONENT's run-set can refuse the second union.
    """
    a = _ms_row("seg-1", "alpha beta gamma")          # run 1 and run 3
    c = _ms_row("seg-1", "alpha beta delta")          # run 1 and run 3  -> co-occurs with a
    b = _ms_row("seg-1", "alpha beta epsilon")        # run 2 only, similar to both
    runs = [_run("r1", [a, c]), _run("r2", [b]), _run("r3", [a, c])]
    rewritten, stats = study.identity_merged_ms(runs, threshold=0.4)
    assert stats["refused_unions"] >= 1, "the component-level guard never fired"
    scores = _ms(rewritten)
    assert scores["total"] >= 2, "a and c were seated together through b"


def test_clustering_is_a_partition_so_transitivity_holds():
    """A~B~C across three distinct runs collapses to ONE identity at 3/3."""
    runs = [_run("r1", [_ms_row("seg-1", "alpha beta gamma")]),
            _run("r2", [_ms_row("seg-1", "alpha beta delta")]),
            _run("r3", [_ms_row("seg-1", "alpha beta epsilon")])]
    rewritten, stats = study.identity_merged_ms(runs, threshold=0.4)
    scores = _ms(rewritten)
    assert scores["total"] == 1, "the three names did not collapse to one identity"
    assert scores["publish"] == 1 and scores["stability_mean"] == 1.0


def test_the_result_does_not_depend_on_key_order():
    """Symmetry: shuffling the rows must not change the partition."""
    names = ["alpha beta gamma", "alpha beta delta", "zulu yankee xray"]
    forward = [_run(f"r{i}", [_ms_row("seg-1", n)]) for i, n in enumerate(names)]
    backward = [_run(f"r{i}", [_ms_row("seg-1", n)]) for i, n in reversed(list(enumerate(names)))]
    a = _ms(study.identity_merged_ms(forward, threshold=0.4)[0])
    b = _ms(study.identity_merged_ms(backward, threshold=0.4)[0])
    assert a["total"] == b["total"]


def test_records_without_names_degrade_to_zero_merges_and_never_raise():
    """⭐ A run persisted without names must produce NO merges — not an exception, and not a
    merge by empty-set similarity, which is the trap: Jaccard of two empty sets is 0/0."""
    rows = [_ms_row("seg-1", ""), _ms_row("seg-1", "")]
    rows[0]["market_signal_key"] = ["MARKET_SIGNAL", "k1"]
    rows[1]["market_signal_key"] = ["MARKET_SIGNAL", "k2"]
    rows[0]["fields"] = {"market_signal": {"direction": "bullish"}}
    rows[1]["fields"] = {"market_signal": {"direction": "bullish"}}
    runs = [_run("r1", [rows[0]]), _run("r2", [rows[1]])]
    rewritten, stats = study.identity_merged_ms(runs, threshold=0.5)
    assert stats["merges"] == 0
    assert _ms(rewritten)["total"] == 2


def test_merging_can_only_raise_stability_never_lower_it():
    """The direction of the error is the whole safety argument — state it as a test."""
    runs = [_run("r1", [_ms_row("seg-1", "alpha beta gamma")]),
            _run("r2", [_ms_row("seg-1", "alpha beta delta")]),
            _run("r3", [_ms_row("seg-1", "zulu yankee xray")])]
    key_mean = _ms(study.identity_key(runs)[0])["stability_mean"]
    merged_mean = _ms(study.identity_merged_ms(runs, threshold=0.4)[0])["stability_mean"]
    assert merged_mean >= key_mean


def test_a_higher_threshold_never_merges_more():
    """Monotonicity — otherwise the sensitivity sweep is not a sweep."""
    runs = [_run("r1", [_ms_row("seg-1", "alpha beta gamma")]),
            _run("r2", [_ms_row("seg-1", "alpha beta delta")]),
            _run("r3", [_ms_row("seg-1", "alpha zulu yankee")])]
    counts = [study.identity_merged_ms(runs, threshold=t)[1]["merges"] for t in (0.3, 0.5, 0.9)]
    assert counts == sorted(counts, reverse=True), counts


def test_no_identity_emits_extracted_text_into_its_report_fields():
    """⛔ §0.4f. The cluster id must be a segment plus an index — never a name."""
    runs = [_run("r1", [_ms_row("seg-1", "alpha beta gamma")]),
            _run("r2", [_ms_row("seg-1", "alpha beta delta")])]
    rewritten, stats = study.identity_merged_ms(runs, threshold=0.4)
    for run in rewritten:
        for row in run["rows"]:
            ident = "".join(str(p) for p in row["market_signal_key"])
            assert "alpha" not in ident and "beta" not in ident, ident
    # the stats a report may quote carry no text either
    for field in ("keys", "clusters", "merges", "refused_unions"):
        assert isinstance(stats[field], int)


def test_the_structured_identity_refuses_to_merge_co_occurring_tuples():
    """Two signals sharing (ticker, direction) inside ONE run are two signals."""
    rows = [_ms_row("seg-1", "one", direction="bullish", ticker="NVDA"),
            _ms_row("seg-1", "two", direction="bullish", ticker="NVDA")]
    runs = [_run("r1", rows), _run("r2", list(rows))]
    rewritten, _ = study.identity_structured_ms(runs)
    assert _ms(rewritten)["total"] == 2


def test_the_key_identity_is_a_pass_through_control():
    runs = [_run("r1", [_ms_row("seg-1", "alpha")]), _run("r2", [_ms_row("seg-1", "beta")])]
    passed, meta = study.identity_key(runs)
    assert meta["identity"] == "key"
    assert [len(r["rows"]) for r in passed] == [1, 1]
    assert _ms(passed)["total"] == 2, "the control must not merge anything"


def test_a_rewrite_that_reports_merges_but_changes_nothing_is_caught():
    """⛔⛔ THE SILENT NO-OP. Both bugs found building this were this shape: the assignment map
    keyed on a field the reconciler does not use for that type, so every lookup missed and every
    row passed through — while the cluster stats happily reported 60 merges.

    It is invisible to a "the other types are unchanged" control, because the type under test is
    unchanged too. Only the stats-versus-total disagreement shows it.
    """
    before = {"PRINCIPLE": {"total": 182}}
    after = {"PRINCIPLE": {"total": 182}}
    with pytest.raises(AssertionError, match="did not fall"):
        study.assert_merges_landed(before, after, "PRINCIPLE", {"merges": 60, "identity": "lens"})
    # and it stays quiet when the merge really landed, or when nothing was merged
    study.assert_merges_landed(before, {"PRINCIPLE": {"total": 122}}, "PRINCIPLE",
                               {"merges": 60, "identity": "lens"})
    study.assert_merges_landed(before, after, "PRINCIPLE", {"merges": 0, "identity": "key"})


def test_the_principle_rewrite_writes_a_scalar_key_not_a_list():
    """⚠️ `principle_key` is a SCALAR the reconciler wraps itself (reconcile.py:97); the list
    shape raises 'unhashable type' deep inside the reconciler instead of here."""
    runs = [_run("r1", [_pr_row("seg-1", "alpha beta gamma delta")]),
            _run("r2", [_pr_row("seg-1", "alpha beta gamma epsilon")])]
    rewritten, meta = study.identity_lens_principle(runs, lens=lambda a, b: True)
    for run in rewritten:
        for row in run["rows"]:
            assert isinstance(row["principle_key"], str), row["principle_key"]
    study.score(rewritten)          # must not raise


def test_the_lens_refuses_a_polarity_flip():
    """golden's own guard: never/always and long/short are not paraphrases of each other."""
    name, lens = study.paraphrase_lens()
    assert name and lens
    assert lens("always add to a winner", "always add to a winner")
    assert not lens("always add to a winner", "never add to a winner")


# ── the one check that reads the real runs ───────────────────────────────────

def test_the_key_identity_reproduces_the_session_9_numbers():
    """⛔ The control against the paid measurement. Skips LOUDLY when the runs are absent —
    they are gitignored, so a fresh clone cannot have them, and a silent pass here would make
    every bound above unanchored."""
    from api.services.wisdom.extract import reconcile

    root = REPO / "data" / "wisdom" / "gate-runs"
    ids = reconcile.discover(root) if root.exists() else []
    if len(ids) < 3:
        pytest.skip(f"needs the 3 persisted gate runs (gitignored); found {len(ids)} under {root}")
    runs = [reconcile.load_run(root, r) for r in ids]
    per_type = study.score(study.identity_key(runs)[0])["per_type"]
    assert per_type["MARKET_SIGNAL"]["total"] == 236
    assert per_type["MARKET_SIGNAL"]["publish"] == 21
    assert per_type["MARKET_SIGNAL"]["block"] == 215
    assert per_type["PRINCIPLE"]["total"] == 182
    assert per_type["PRINCIPLE"]["publish"] == 31
    assert per_type["PRINCIPLE"]["block"] == 151
    assert per_type["MENTION"]["total"] == 778
