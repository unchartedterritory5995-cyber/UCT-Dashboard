"""BATCH 2 -- the server's mirror of the exact-identity formula functions builds the SAME
trees as the browser's authority (``callExpansions.js``), byte for byte, and the converse
door checks a model's ``linreg`` call as the tree the browser stores.
"""
from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

from api.services import call_expansions as ce
from tests.test_p2_truth_server import (  # noqa: F401  (pytest fixtures by import)
    RSI_GT_70, conv, emits, env, model, out, view,
)

ROOT = Path(__file__).resolve().parents[1]
JS = (ROOT / "app/src/components/chart/engine/ast/callExpansions.js").as_uri()

CLOSE = {"type": "series", "name": "close"}
SPY = {"type": "sym", "value": "SPY", "args": [CLOSE]}
HL2 = {"type": "op", "name": "/", "args": [
    {"type": "op", "name": "+", "args": [{"type": "series", "name": "high"}, {"type": "series", "name": "low"}]},
    {"type": "num", "value": 2}]}


def n(v):
    return {"type": "num", "value": v}


CASES = [
    ("roc", [CLOSE, n(10)]), ("roc", [HL2, n(1)]),
    ("mom", [CLOSE, n(10)]),
    ("vwma", [CLOSE, n(20)]), ("vwma", [HL2, n(3)]),
    ("linreg", [CLOSE, n(50)]), ("linreg", [CLOSE, n(50), n(0)]), ("linreg", [CLOSE, n(20), n(3)]),
    ("linreg", [CLOSE, n(2), n(5)]), ("linreg", [CLOSE, n(7), n(1.5)]), ("linreg", [CLOSE, n(200), n(0)]),
    ("correlation", [CLOSE, SPY, n(20)]), ("correlation", [CLOSE, {"type": "series", "name": "volume"}, n(2)]),
    ("kcMiddle", [CLOSE, n(20)]), ("kcUpper", [CLOSE, n(20), n(2)]), ("kcLower", [CLOSE, n(20), n(1.5)]),
    # (2026-11-01) Bollinger Bands, the trees pine.js `ta.bb` builds
    ("bbMiddle", [CLOSE, n(20)]), ("bbUpper", [CLOSE, n(20), n(2)]), ("bbLower", [HL2, n(10), n(1.5)]),
    ("supertrend", [n(3), n(10)]), ("supertrend", [n(2.5), n(7)]), ("supertrend", [n(3.0), n(14)]),
    ("supertrendDirection", [n(3), n(10)]), ("supertrendDirection", [n(1.5), n(20)]),
    # (2026-10-30) Parabolic SAR over accum4, inside its measured domain
    ("sar", [n(0.02), n(0.2)]), ("sar", [n(0.03), n(0.3)]), ("sar", [n(0.02), n(1)]),
    ("sarDirection", [n(0.02), n(0.2)]), ("sarDirection", [n(0.1), n(0.5)]),
    # (2026-11-18) the Fisher Transform over accum2, at the two lengths it was graded at and two more
    ("fisher", [n(9)]), ("fisher", [n(20)]), ("fisher", [n(2)]), ("fisher", [n(10.0)]),
    # (2026-11-18) the Detrended Price Oscillator: an odd and an even length (the bars-back count is
    # floor(n / 2) + 1, so 21 and 20 both read 11 back), the shortest, and a source that is a formula
    ("dpo", [CLOSE, n(21)]), ("dpo", [CLOSE, n(20)]), ("dpo", [CLOSE, n(1)]), ("dpo", [HL2, n(9)]),
    # (2026-11-18) the Laguerre Filter and the Laguerre RSI over accum4: the two graded settings, and one
    # gamma in each of the other restart tiers
    ("laguerre", [HL2, n(0.8)]), ("laguerreRsi", [CLOSE, n(0.5)]),
    ("laguerre", [CLOSE, n(0.6)]), ("laguerre", [CLOSE, n(0.85)]), ("laguerreRsi", [CLOSE, n(0.95)]),
    ("laguerreRsi", [HL2, n(0.2)]),
    # declined (null) in both lanes
    ("dpo", [CLOSE, n(0)]), ("dpo", [CLOSE, n(20.5)]),
    ("fisher", [n(1)]), ("fisher", [n(9.5)]), ("fisher", [{"type": "series", "name": "len"}]),
    # a gamma that is 0, past the largest that settles, or not a number; a source that is itself a running value
    ("laguerre", [CLOSE, n(0)]), ("laguerre", [CLOSE, n(0.96)]), ("laguerreRsi", [CLOSE, n(1)]),
    ("laguerre", [CLOSE, {"type": "series", "name": "g"}]),
    ("laguerreRsi", [{"type": "call", "name": "fisher", "args": [n(9)]}, n(0.5)]),
    ("laguerre", [{"type": "call", "name": "accum", "args": [CLOSE, CLOSE, n(100)]}, n(0.5)]),
    ("linreg", [CLOSE, n(1)]), ("linreg", [CLOSE, {"type": "series", "name": "len"}]),
    ("vwma", [CLOSE, n(2.5)]), ("correlation", [CLOSE, SPY, n(1)]), ("roc", [CLOSE, n(0)]),
    ("bbUpper", [CLOSE, n(20.5), n(2)]),
    ("supertrend", [n(0), n(10)]), ("supertrend", [n(3), {"type": "series", "name": "len"}]),
    ("supertrendDirection", [{"type": "series", "name": "f"}, n(10)]), ("supertrend", [n(3), n(2.5)]),
    # SAR outside the measured domain: a slow step, a low maximum, max < step, max > 1, a computed step
    ("sar", [n(0.01), n(0.2)]), ("sar", [n(0.02), n(0.1)]), ("sar", [n(0.3), n(0.2)]),
    ("sar", [n(0.02), n(1.5)]), ("sarDirection", [{"type": "series", "name": "s"}, n(0.2)]),
]


@pytest.mark.skipif(shutil.which("node") is None, reason="node not on PATH")
def test_the_two_lanes_build_byte_identical_trees():
    script = (f"import {{ expandCall }} from {json.dumps(JS)};"
              f"const C = {json.dumps(CASES)};"
              "process.stdout.write(JSON.stringify(C.map(([name, args]) => expandCall({type: 'call', name, args}))))")
    res = subprocess.run(["node", "--input-type=module", "-e", script], capture_output=True, text=True, timeout=60)
    assert res.returncode == 0, res.stderr
    browser = json.loads(res.stdout)
    server = [ce.expand_call({"type": "call", "name": name, "args": args}) for name, args in CASES]
    assert json.dumps(server, sort_keys=True) == json.dumps(browser, sort_keys=True)
    # 9 -> 14 (2026-10-30): five SAR settings outside the measured domain.
    assert sum(1 for t in server if t is None) == 26    # declined in both: 15, dpo's 2, fisher's 3, the Laguerre pair's 6


@pytest.mark.skipif(shutil.which("node") is None, reason="node not on PATH")
def test_the_two_lanes_name_the_same_functions_and_signatures():
    script = (f"import {{ CALL_EXPANSIONS }} from {json.dumps(JS)};"
              "process.stdout.write(JSON.stringify(Object.entries(CALL_EXPANSIONS).map(([k, v]) => [k, v.min, v.max, v.signature])))")
    res = subprocess.run(["node", "--input-type=module", "-e", script], capture_output=True, text=True, timeout=60)
    assert res.returncode == 0, res.stderr
    assert json.loads(res.stdout) == [[k, v[0], v[1], v[2]] for k, v in ce.CALL_EXPANSIONS.items()]


def test_the_fisher_transform_is_exactly_the_tree_that_was_graded():
    """The grade is the grade of ONE tree (`tests/fixtures/ast/fisher_graded.json` says what it was
    graded against). The server's builder must produce that tree, to the hash, at both graded
    lengths; the window's builder is held to the same file by `callExpansions.test.js`, and to this
    one byte for byte by the parity test above."""
    import io as _io
    from api.services import user_definitions as ud
    doc = json.loads(_io.open(Path(__file__).parent / "fixtures" / "ast" / "fisher_graded.json", encoding="utf-8").read())
    assert set(doc["graded"]) == {"9", "20"}
    for length, graded in doc["graded"].items():
        tree = ce.expand_call({"type": "call", "name": "fisher", "args": [n(int(length))]})
        assert ud.ast_hash(tree) == graded, length
    # CONTROL: the hash sees one number moved anywhere (another length, another window)
    assert ud.ast_hash(ce.expand_call({"type": "call", "name": "fisher", "args": [n(10)]})) not in doc["graded"].values()
    assert ud.ast_hash(ce.fisher_tree(n(9), warmup=299)) != doc["graded"]["9"]
    # what it is: two linked running values restarted FISHER_WARMUP bars back, the second one drawn
    tree = ce.expand_call({"type": "call", "name": "fisher", "args": [n(9)]})
    assert tree["name"] == "accum2" and [a.get("value") for a in tree["args"][:4]] == [2, ce.FISHER_WARMUP, 0, 0]
    assert ce.FISHER_WARMUP == 300


def test_dpo_reads_its_average_half_the_length_plus_one_bars_back():
    """TradingView's default (not centred) form, which the captures show equal on every bar at an odd
    and an even length: the source minus its n-bar simple average as it stood floor(n / 2) + 1 bars
    ago. The count is DERIVED from the length; that is the whole reason this is a function."""
    def dpo(length, source=CLOSE):
        return ce.expand_call({"type": "call", "name": "dpo", "args": [source, n(length)]})
    for length, back in ((21, 11), (20, 11), (14, 8), (15, 8), (2, 2), (1, 1), (200, 101)):
        assert dpo(length) == {"type": "op", "name": "-", "args": [
            CLOSE, {"type": "offset", "value": back, "args": [{"type": "call", "name": "sma", "args": [CLOSE, n(length)]}]}]}, length
    # the average is of the SAME source the function was given
    assert dpo(9, HL2)["args"][1]["args"][0]["args"][0] == HL2 and dpo(9, HL2)["args"][0] == HL2
    # CONTROL: it is not momentum (which reads the SOURCE back), and not the textbook form (the price back)
    mom = ce.expand_call({"type": "call", "name": "mom", "args": [CLOSE, n(11)]})
    assert dpo(21) != mom and dpo(21)["args"][0] == CLOSE and dpo(21)["args"][1]["type"] == "offset"
    assert ce.CALL_EXPANSIONS["dpo"][2] == "dpo(source, length)"


def test_the_laguerre_pair_is_exactly_the_trees_that_were_graded():
    """`tests/fixtures/ast/laguerre_graded.json` says what each was graded against. The server's
    builders must produce those trees, to the hash; the window's are held to the same file by
    `callExpansions.test.js`, and to these byte for byte by the parity test above."""
    import io as _io
    from api.services import user_definitions as ud
    doc = json.loads(_io.open(Path(__file__).parent / "fixtures" / "ast" / "laguerre_graded.json", encoding="utf-8").read())
    assert set(doc["graded"]) == {"laguerre(hl2, 0.8)", "laguerreRsi(close, 0.5)"}
    for name, row in doc["graded"].items():
        assert ud.ast_hash(ce.expand_call(row["call"])) == row["hash"], name
    # CONTROL: another gamma, or another source, is another tree
    hashes = {row["hash"] for row in doc["graded"].values()}
    assert ud.ast_hash(ce.expand_call({"type": "call", "name": "laguerre", "args": [HL2, n(0.79)]})) not in hashes
    assert ud.ast_hash(ce.expand_call({"type": "call", "name": "laguerre", "args": [CLOSE, n(0.8)]})) not in hashes


def test_the_laguerre_restart_window_is_sized_from_gamma_and_always_long_enough():
    """The larger gamma is, the longer the filter remembers. Each tier's window must leave less than
    a billionth of the start at the tier's LARGEST gamma, by the same rule that decides which
    linked running values settle (`api/services/running_values.py`), and the whole reach must fit
    the history a formula may reach."""
    from api.services import running_values as rv
    assert ce.LAGUERRE_WARMUPS == ((0.5, 64), (0.7, 128), (0.8, 192), (0.9, 400), (0.95, 800)) and ce.LAGUERRE_MAX_GAMMA == 0.95
    assert [most for most, _ in ce.LAGUERRE_WARMUPS] == sorted(most for most, _ in ce.LAGUERRE_WARMUPS)
    for most, bars in ce.LAGUERRE_WARMUPS:
        stage = ce.laguerre_stage(CLOSE, n(most), 4)
        assert stage["args"][1] == n(bars) and ce.laguerre_warmup(most) == bars
        got = rv.classify(stage, 1e-9, 960)
        assert got["shape"] == rv.LINEAR and got["needs"] is not None and got["needs"] <= bars, (most, bars, got["needs"])
        assert bars <= 960 - 100                                        # room for a source that reaches back itself
    # the tier boundary: just past one tier's largest gamma takes the next tier's window
    assert ce.laguerre_stage(CLOSE, n(0.5), 1)["args"][1] == n(64) and ce.laguerre_stage(CLOSE, n(0.51), 1)["args"][1] == n(128)
    # CONTROL: the rule can say no. At the smallest window, the largest gamma has NOT settled.
    short = ce.laguerre_stage(CLOSE, n(0.5), 4)
    short["args"][1] = n(40)
    assert rv.classify(short, 1e-9, 960)["needs"] > 40
    # and a gamma the rule cannot settle within reach is not offered
    assert ce.laguerre_warmup(0.951) is None and ce.expand_call({"type": "call", "name": "laguerre", "args": [CLOSE, n(0.97)]}) is None
    assert "above 0 and at most 0.95" in ce.expansion_problem("laguerre", 2)
    assert "does not settle within the bars a chart formula may reach" in ce.expansion_problem("laguerreRsi", 2)
    assert ce.expansion_problem("fisher", 1) == "fisher needs a whole-number length of at least 2 written as a number -- fisher(length)"


def test_supertrend_reads_its_own_past_through_the_manifests_binding():
    """``ACCUM_SELF`` is typed in both builder modules (they must stay importable without
    the interpreter); this is what keeps it the manifest's value."""
    from api.services import ast_table
    assert ce.ACCUM_SELF == ast_table.recurrences()["accum"]["binds"]
    assert ce.SUPERTREND_WARMUP == 200


def test_nested_expansion_and_the_declared_guard():
    tree = {"type": "op", "name": ">", "args": [CLOSE, {"type": "call", "name": "linreg", "args": [CLOSE, n(50), n(0)]}]}
    expanded = ce.expand_calls(tree)
    names = []

    def walk(t):
        if isinstance(t, dict):
            if t.get("type") == "call":
                names.append(t["name"])
            for a in t.get("args") or []:
                walk(a)
    walk(expanded)
    assert "linreg" not in names and {"sum", "wma"} <= set(names)
    assert ce.expand_calls(tree, lambda name: name == "linreg") is tree
    with pytest.raises(ce.ExpansionRefused) as exc:
        ce.expand_calls({"type": "call", "name": "linreg", "args": [CLOSE, n(1)]})
    assert exc.value.guard == "resolve:expansion" and "at least 2" in str(exc.value)


def test_the_converse_door_admits_and_checks_a_linreg_call(conv, model):
    """ASKED: a change whose tree calls linreg. CLAIMED: the schema admits the name, the
    server checks the expansion (budget / lint pass), the change is accepted. DID."""
    tree = {"type": "op", "name": ">", "args": [CLOSE, {"type": "call", "name": "linreg", "args": [CLOSE, n(50), n(0)]}]}
    model([emits(env(1, [{"op": "set_output_tree", "output": "value", "tree": tree}]))])
    r = conv.converse("make it close above its 50-bar linear regression", user_id="u1",
                      view=view(1, [out("value", RSI_GT_70)]))
    assert r["ok"] is True and r["disposition"] == "change", r
    enum = conv.composed_schema()["$defs"]["call"]["properties"]["name"]["enum"]
    assert {"linreg", "correlation", "vwma", "roc", "mom", "kcUpper", "kcLower", "kcMiddle"} <= set(enum)


def test_the_converse_door_refuses_an_unusable_length_by_name(conv, model):
    bad = {"type": "call", "name": "linreg", "args": [CLOSE, n(1)]}
    model([emits(env(1, [{"op": "set_output_tree", "output": "value", "tree": bad}])),
           emits(env(1, [{"op": "set_output_tree", "output": "value", "tree": bad}]))])
    r = conv.converse("use a 1-bar regression", user_id="u1", view=view(1, [out("value", RSI_GT_70)]))
    assert r["ok"] is False and r["gate"] == "resolve:expansion", r


# --------------------------------------------------------------------------- #
# the VALUES agree across the two interpreters (the frozen corpus bars)
# --------------------------------------------------------------------------- #

import sys  # noqa: E402

if str(ROOT / "tools") not in sys.path:
    sys.path.insert(0, str(ROOT / "tools"))
import ast_conformance as ac  # noqa: E402


@pytest.mark.skipif(not ac.js_lane_available(), reason="no JS lane")
def test_browser_and_server_compute_the_same_values_for_every_expansion():
    bars = ac.corpus_bars()
    calls = [
        ("linreg_50", "linreg", [CLOSE, n(50), n(0)]),
        ("linreg_20_3", "linreg", [CLOSE, n(20), n(3)]),
        ("correlation_close_volume_20", "correlation", [CLOSE, {"type": "series", "name": "volume"}, n(20)]),
        ("vwma_20", "vwma", [CLOSE, n(20)]),
        ("roc_10", "roc", [CLOSE, n(10)]),
        ("mom_10", "mom", [CLOSE, n(10)]),
        ("kc_upper", "kcUpper", [CLOSE, n(20), n(2)]),
        ("kc_lower", "kcLower", [CLOSE, n(20), n(1.5)]),
        ("bb_upper", "bbUpper", [CLOSE, n(20), n(2)]),
        ("bb_lower", "bbLower", [CLOSE, n(20), n(2)]),
        ("supertrend_3_10", "supertrend", [n(3), n(10)]),
        ("supertrend_dir_2_7", "supertrendDirection", [n(2), n(7)]),
        ("sar_02_2", "sar", [n(0.02), n(0.2)]),
        ("sar_dir_02_2", "sarDirection", [n(0.02), n(0.2)]),
    ]
    cases = [{"id": cid, "ast": ce.expand_call({"type": "call", "name": name, "args": args})}
             for cid, name, args in calls]
    js = ac.run_js(cases, bars)
    py = ac.run_py(cases, bars)
    verdict = ac.compare_lanes(js, py)
    assert verdict["differences"] == [], verdict["differences"][:5]
    for cid, _, _ in calls:     # non-vacuity: real numbers, in both lanes
        # supertrend withholds its first ~2 x 200 bars (the bounded warm-up), so it is
        # held to a smaller floor than the rolling windows
        floor = 100 if cid.startswith(("supertrend", "sar")) else len(bars) // 2
        assert sum(1 for v in py[cid] if v is not None) > floor, cid


# --------------------------------------------------------------------------- #
# BATCH 2 -- the chart door's planner reads the function words as terms
# --------------------------------------------------------------------------- #

def test_chart_door_keeps_a_momentum_clause_the_shared_vocabulary_refuses():
    from api.services import definition_concierge as dc
    from api.services import definition_conversation as conv
    ask = ("Make a momentum histogram: bright green when positive and rising, dark green "
           "when positive and falling, red when negative and falling, orange when negative and rising")
    got = dc.plan(ask, dc.INDICATOR_KIND, lexicon=conv.CHART_LEXICON)
    assert got["not_understood"] == []
    assert got["understood"] == ask                       # nothing excised, verbatim
    assert "mom" in [t["name"] for t in got["terms"]]
    # the shared planner (screens, /propose) is unchanged: "momentum" is still refused there
    assert [n["phrase"] for n in dc.plan("momentum stocks", dc.INDICATOR_KIND)["not_understood"]] == ["momentum"]


def test_chart_door_function_words_and_refusals_that_stay():
    from api.services import definition_concierge as dc
    from api.services import definition_conversation as conv
    names = lambda m: [t["name"] for t in dc.plan(m, dc.INDICATOR_KIND, lexicon=conv.CHART_LEXICON)["terms"]]  # noqa: E731
    assert "linreg" in names("Plot the 50-bar linear regression of close")
    assert "correlation" in names("show the 20 day correlation with SPY")
    assert "roc" in names("a 12 bar rate of change")
    assert "kcUpper" in names("add keltner channels")
    cheap = dc.plan("color it green when cheap", dc.INDICATOR_KIND, lexicon=conv.CHART_LEXICON)
    assert [n["phrase"] for n in cheap["not_understood"]] == ["cheap"]
    # every phrase is its own unique bucket (a tie would match nothing)
    # (one of them is the LIBRARY'S since 2026-11-18: an entry that declares the engine function it
    # is the indicator of takes that function's phrase; tests/test_library_stochastic.py holds the rule)
    from api.services import named_indicators as ni
    taken = {alias: e["id"] for e in ni.entries() if e.get("names_function") for alias in e["aliases"]}
    for phrase, key in conv.EXPANSION_PHRASES:
        stems, _ = dc._stem_key(dc._form_tokens(phrase))
        assert [r["key"] for r in conv.CHART_LEXICON["index"][stems]] == [taken.get(phrase, key)]


# --------------------------------------------------------------------------- #
# BATCH 2 SECURITY -- the expanded size is bounded, identically in both lanes
# --------------------------------------------------------------------------- #

def _nest(depth):
    t = CLOSE
    for _ in range(depth):
        t = {"type": "call", "name": "correlation", "args": [t, {"type": "series", "name": "open"}, n(5)]}
    return t


def test_nested_expansion_is_refused_past_the_cap_fast():
    import time
    assert ce.expanded_size(ce.expand_calls(_nest(4))) == 801
    t0 = time.time()
    for depth in (6, 12, 20):
        with pytest.raises(ce.ExpansionRefused) as exc:
            ce.expand_calls(_nest(depth))
        assert exc.value.guard == "resolve:expansion"
    assert time.time() - t0 < 0.5
    deep = CLOSE
    for _ in range(ce.MAX_EXPANSION_DEPTH + 5):
        deep = {"type": "op", "name": "u-", "args": [deep]}
    with pytest.raises(ce.ExpansionRefused, match="levels deep"):
        ce.expand_calls({"type": "call", "name": "roc", "args": [deep, n(5)]})
    assert ce.expand_calls(deep) is deep


def test_the_conversation_door_refuses_a_nested_expansion_by_name():
    from api.services import definition_conversation as conv
    with pytest.raises(conv._Refused) as exc:
        conv._check_tree("plot 'v'", _nest(15))
    assert exc.value.gate == "resolve:expansion"


@pytest.mark.skipif(shutil.which("node") is None, reason="node not on PATH")
def test_the_two_lanes_share_the_caps_and_the_refusal_text():
    script = (f"import {{ MAX_EXPANDED_NODES, MAX_EXPANSION_DEPTH, expandCalls }} from {json.dumps(JS)};"
              f"const t = {json.dumps(_nest(8))};"
              "let msg = null; try { expandCalls(t) } catch (e) { msg = e.message }"
              "process.stdout.write(JSON.stringify([MAX_EXPANDED_NODES, MAX_EXPANSION_DEPTH, msg]))")
    res = subprocess.run(["node", "--input-type=module", "-e", script], capture_output=True, text=True, encoding="utf-8", timeout=60)
    assert res.returncode == 0, res.stderr
    cap, depth, msg = json.loads(res.stdout)
    with pytest.raises(ce.ExpansionRefused) as exc:
        ce.expand_calls(_nest(8))
    assert [cap, depth, msg] == [ce.MAX_EXPANDED_NODES, ce.MAX_EXPANSION_DEPTH, str(exc.value)]


def test_every_chart_function_word_names_a_real_expansion_or_declared_function():
    """A word names a call expansion or a function closedTable.json DECLARES (the full
    names, 2026-11-01). A typo'd key would hand the model a name nothing evaluates."""
    from api.services import ast_table, conversation_preflight
    words = conversation_preflight.rules()["chartFunctionWords"]["words"]
    assert words and all(len(w) == 2 for w in words)
    declared = set(ast_table.TABLE["functions"])
    keys = {k for _, k in words}
    assert keys <= set(ce.EXPANSION_NAMES) | declared
    # non-vacuity: both halves are really used
    assert keys & set(ce.EXPANSION_NAMES)
    assert keys & (declared - set(ce.EXPANSION_NAMES))
