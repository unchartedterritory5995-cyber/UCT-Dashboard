"""UCT Agent — W2-A3 schema-constrained args: the golden corpus (tests/fixtures/agent_args_corpus.json) scored
against api/services/uct_agent/args.normalize_args, plus the normalizer's invariants and the catalog example.

Every row is a shape a model wrote (seeded from the Phase 1 live failures, LT-3, and the catalog hints) → either
the exact args UCT accepts (which must ALSO pass turn.args_match, the strict gate that stays in place) or an
explicit refusal whose reason names the problem. The score must be 100 %: a row that drifts is a behaviour
change, not a statistic. No model call, no network, no market values.
"""
from __future__ import annotations

import json
import pathlib

import pytest

from api.services.uct_agent import args as A, turn

ROOT = pathlib.Path(__file__).resolve().parents[1]
CORPUS = ROOT / "tests" / "fixtures" / "agent_args_corpus.json"
GOLDEN = ROOT / "app" / "src" / "agent" / "contract" / "manifest.golden.json"

corpus = json.loads(CORPUS.read_text(encoding="utf-8"))
CAPS = {c["name"]: c for c in json.loads(GOLDEN.read_text(encoding="utf-8"))["capabilities"]}
ROWS = corpus["rows"]


def _score(row):
    cap = CAPS[row["action"]]
    try:
        got, changes = A.normalize_args(cap["args"], row["input"])
        return {"args": got, "changes": changes}
    except A.ArgsRefused as e:
        return {"refused": e.reason}


def test_the_corpus_is_well_formed_and_large_enough():
    assert len(ROWS) >= 80
    ids = [r["id"] for r in ROWS]
    assert len(set(ids)) == len(ids)
    for r in ROWS:
        assert r["action"] in CAPS, r["id"]
        assert ("args" in r["expect"]) != ("refused" in r["expect"]), r["id"]
        assert r["source"] in corpus["sources"], r["id"]
    live = [r for r in ROWS if r["source"] == "live-LT-3-2026-11-03"]
    assert {r["action"] for r in live} >= {"chart.setSetting", "chart.replay", "screener.run", "widget.addCharts"}
    assert len(live) >= 20


@pytest.mark.parametrize("row", ROWS, ids=[f"{r['id']}-{r['action']}" for r in ROWS])
def test_each_row_scores_as_expected(row):
    res = _score(row)
    exp = row["expect"]
    if "args" in exp:
        assert "args" in res, f"{row['id']}: refused ({res.get('refused')}) but expected {exp['args']}"
        assert res["args"] == exp["args"], row["id"]
        # the strict gate still passes what the normalizer produced
        assert turn.args_match(CAPS[row["action"]]["args"], res["args"]), row["id"]
    else:
        assert "refused" in res, f"{row['id']}: accepted {res.get('args')} but expected a refusal"
        assert exp["refused"] in res["refused"], f"{row['id']}: {res['refused']!r} does not name {exp['refused']!r}"


def test_the_score_is_100_percent_and_printed():
    hits = sum(1 for r in ROWS if (("args" in _score(r)) == ("args" in r["expect"])) and (
        _score(r).get("args") == r["expect"].get("args") if "args" in r["expect"] else r["expect"]["refused"] in _score(r)["refused"]))
    by_source = {}
    for r in ROWS:
        by_source[r["source"]] = by_source.get(r["source"], 0) + 1
    print(f"\nargs corpus: {hits}/{len(ROWS)} rows match ({100.0 * hits / len(ROWS):.1f} %); by source: {by_source}")
    assert hits == len(ROWS)


# ── invariants ────────────────────────────────────────────────────────────────────────────────
@pytest.mark.parametrize("name", sorted(CAPS))
def test_args_already_exactly_as_declared_pass_unchanged_with_no_notes(name):
    schema = CAPS[name]["args"]
    ex = A.example_args(schema)
    assert turn.args_match(schema, ex), f"{name}: example_args is not valid for its own schema: {ex}"
    got, changes = A.normalize_args(schema, ex)
    assert got == ex and changes == [], name


def test_the_normalizer_never_invents_a_required_value():
    schema = CAPS["alert.create"]["args"]
    with pytest.raises(A.ArgsRefused) as e:
        A.normalize_args(schema, {"symbol": "NVDA"})
    assert "missing" in e.value.reason
    assert "price" in e.value.reason or "direction" in e.value.reason


def test_a_refusal_reason_is_short_and_value_free_enough_for_the_model():
    schema = CAPS["chart.setSetting"]["args"]
    with pytest.raises(A.ArgsRefused) as e:
        A.normalize_args(schema, {"setting": "x" * 500, "value": True})
    assert len(e.value.reason) < 320


def test_changes_are_bounded_and_mention_the_argument_not_the_value():
    schema = CAPS["screener.run"]["args"]
    got, changes = A.normalize_args(schema, {"filters": [{"field": "price", "op": "GTE", "value": "10"}], "mode": "NEW", "show": "5"})
    assert len(changes) <= A.MAX_CHANGES
    assert any(c.startswith("filters[0].value") for c in changes) and any(c.startswith("mode") for c in changes)
    assert "10" not in " ".join(changes) and "GTE" not in " ".join(changes)


def test_the_normalizer_is_pure_and_does_not_mutate_its_input():
    schema = CAPS["widget.addCharts"]["args"]
    given = {"symbols": "NVDA", "timeframe": "d"}
    before = json.dumps(given)
    A.normalize_args(schema, given)
    assert json.dumps(given) == before


# ── the catalog example (part 3) ──────────────────────────────────────────────────────────────
def test_example_args_show_the_exact_shape_enums_first_option_nullables_null():
    ex = A.example_args(CAPS["widget.addCharts"]["args"])
    assert ex == {"symbols": ["NVDA", "AMD"], "timeframe": "1", "chart_type": "candles", "exact": None}
    assert A.example_args(CAPS["chart.replay"]["args"]) == {"date": "2026-10-15"}
    assert A.example_args(CAPS["chart.resetDefaults"]["args"]) == {}
    tl = A.example_args(CAPS["drawing.addTrendline"]["args"])
    assert tl["from"] == {"date": "2026-10-15", "price": 150} and tl["style"] == "solid" and tl["color"] == "#2962ff"
    sr = A.example_args(CAPS["screener.run"]["args"])
    assert sr["filters"][0] == {"field": "price", "op": "gt", "value": 1, "max": None, "values": None}
    assert sr["mode"] == "new" and sr["as"] is None and sr["show"] == 10 and sr["sort_dir"] == "asc"


def test_the_catalog_line_carries_the_example_so_the_model_sees_the_shape():
    caps = turn.validate_manifest([CAPS["widget.addCharts"], CAPS["chart.setTimeframe"]])
    lines = turn._catalog_lines(caps)
    assert any('e.g. args {"symbols":["NVDA","AMD"],"timeframe":"1","chart_type":"candles","exact":null}' in ln for ln in lines)
    assert any('e.g. args {"timeframe":"1"}' in ln for ln in lines)
    # the lean (NL-1 eval) variant keeps its lines as they were
    assert not any("e.g. args" in ln for ln in turn._catalog_lines(caps, lean=True))
