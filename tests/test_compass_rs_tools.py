"""UCT Relative Strength read tools for Compass, voice AND chat (engineering map
2026-11-08, decision D16, unit 4-07).

One implementation (api/services/rs_read_tools.py); voice registers it with a per-call
gate, chat delegates to the voice registry. No network and no C:\\data: the provider
envelope is stubbed at `registry_defs.serve`.

WHAT THIS FILE HAS TO BE ABLE TO SAY RED FOR
the tools' text drifting from rs_teaching.json; an unknown term answered with anything
but "not a UCT RS term" and the nearest three; either surface showing the tools while
RS_COMPASS_TOOLS_ENABLED is off; the two surfaces exposing different names or schemas;
the reading leaking a raw column or a number the readout did not print; the golden set
losing its three RS questions.
"""
from __future__ import annotations

import json
import re
from pathlib import Path

import pytest

from api.services import rs_read_tools as rt

ROOT = Path(__file__).resolve().parent.parent
TEACHING = json.loads((ROOT / "api" / "data" / "rs_teaching.json").read_text(encoding="utf-8"))
NAMES = ("get_rs_reading", "explain_rs")
GATE = "RS_COMPASS_TOOLS_ENABLED"


@pytest.fixture
def gate_off(monkeypatch):
    monkeypatch.delenv(GATE, raising=False)


@pytest.fixture
def gate_on(monkeypatch):
    monkeypatch.setenv(GATE, "1")


def _all_answers(out: dict) -> list[dict]:
    return [out] + list(out.get("also") or [])


# ── explain_rs: verbatim from the JSON ──────────────────────────────────────

def test_every_card_answers_its_json_text_verbatim():
    for key, card in TEACHING["cards"].items():
        out = rt.explain_term(card["label"])
        hit = next(a for a in _all_answers(out) if a["kind"] == "card" and a["key"] == key)
        assert (hit["label"], hit["what"], hit["origin"], hit["evidence"]) == (
            card["label"], card["what"], card["origin"], card["evidence"]), key
        assert card["what"] in hit["narration"] and card["origin"] in hit["narration"]


def test_every_glossary_term_answers_its_definition_verbatim():
    for g in TEACHING["glossary"]:
        out = rt.explain_term(g["term"])
        hit = next(a for a in _all_answers(out) if a["kind"] == "glossary" and a["key"] == g["key"])
        assert hit["term"] == g["term"] and hit["definition"] == g["definition"], g["key"]
        for alias in g.get("aliases") or []:
            via = rt.explain_term(alias.upper() + "  ")          # case-insensitive, trimmed
            assert any(a["key"] == g["key"] for a in _all_answers(via)), alias


def test_every_misconception_answers_its_myth_and_truth_verbatim():
    for m in TEACHING["misconceptions"]:
        out = rt.explain_term(m["myth"])
        assert out["kind"] == "misconception" and out["key"] == m["key"]
        assert out["myth"] == m["myth"] and out["truth"] == m["truth"]
        assert out["answer"].startswith("No, ")


def test_the_gold_dot_is_the_rs_high_before_price_with_its_lesson():
    out = rt.explain_term("Gold Dot")
    g = next(x for x in TEACHING["glossary"] if x["key"] == "rsNewHighBeforePrice")
    assert out["found"] and out["key"] == "rsNewHighBeforePrice"
    assert out["definition"] == g["definition"]
    assert out["learn"]["path"] == "/desk?section=videos&v=_0ZvKLYznLo&t=1814"


@pytest.mark.parametrize("asked", ["RSI", "rsi", "Is RS the same as RSI?", "RS vs RSI", "RS is RSI."])
def test_rs_versus_rsi_answers_no_they_are_different_things(asked):
    truth = next(m["truth"] for m in TEACHING["misconceptions"] if m["key"] == "rsIsNotRsi")
    out = rt.explain_term(asked)
    assert out["key"] == "rsIsNotRsi" and out["truth"] == truth
    assert out["answer"].startswith("No, they are different things.")
    assert out["answer"][len("No, t"):] == truth[1:]


def test_an_unknown_term_is_not_a_uct_rs_term_and_lists_the_nearest_three():
    out = rt.explain_term("zebra stripes")
    assert out["ok"] and out["found"] is False
    assert "not a UCT RS term" in out["message"] and "not a UCT RS term" in out["narration"]
    assert len(out["nearest"]) == 3
    assert out == rt.explain_term("zebra stripes")               # deterministic
    for n in out["nearest"]:
        assert n["name"] in out["narration"]
    typo = rt.explain_term("RS hgh")
    assert typo["found"] is False and typo["nearest"][0]["key"] == "rsHigh"


def test_a_blank_or_overlong_term_is_refused():
    assert rt.explain_term("   ")["ok"] is False
    assert rt.explain_term("x" * (rt.MAX_TERM + 1))["ok"] is False


# ── the Learn links and the matching vocabulary are pinned to their sources ──

def test_the_lesson_table_matches_the_shared_fixture():
    fx = json.loads((ROOT / "tests" / "fixtures" / "indicators" / "rs_learn_videos.json").read_text(encoding="utf-8"))
    assert rt.LEARN_VIDEOS == fx["videos"]


def test_the_card_lessons_match_the_readout_rows_in_the_native_registry():
    src = (ROOT / "app" / "src" / "components" / "chart" / "engine" / "nativeRegistry.js").read_text(encoding="utf-8")
    pairs = dict(re.findall(r"\{ key: '(\w+)', label:[^{}]*?card: \{[^{}]*?learn: '(\w+)'", src, re.S))
    assert pairs and rt.CARD_LEARN == pairs
    assert set(rt.CARD_LEARN) <= set(TEACHING["cards"])


def test_the_glossary_lessons_and_myth_aliases_name_real_entries():
    assert set(rt.GLOSSARY_LEARN) <= {g["key"] for g in TEACHING["glossary"]}
    assert set(rt.GLOSSARY_LEARN.values()) <= set(rt.LEARN_VIDEOS)
    assert set(rt.MISCONCEPTION_ALIASES) <= {m["key"] for m in TEACHING["misconceptions"]}


def test_the_symbol_rule_is_the_rs_routes_own():
    from api.routers import signature
    assert rt.SYMBOL_PATTERN == signature._SYM_RE.pattern


# ── get_rs_reading over a stubbed envelope ──────────────────────────────────

def _envelope(**over) -> dict:
    payload = {
        "benchmark": {"requested": "SPY", "resolved": "SPY", "label": "S&P 500 (SPY)", "fallback": False,
                      "bars": 1250, "note": None},
        "legend": {"value": 1.234567, "pctFromMa": 6.8123, "above": True, "index": 899,
                   "summary": "above its 21 EMA by 6.8%"},
        "lastRsHigh": {"index": 897, "barsAgo": 2, "beforePrice": True, "redDay": False,
                       "summary": "2 bars ago · before price"},
        "rating": {"ibd": 9917, "fast": 91, "asof": "2026-11-06", "source": "row",
                   "summary": "94 · fast 91", "components": "1M 91 · 3M 97"},
        "sensitivity": {"spy": 0.4123, "rsp": 0.3, "sector": 0.2, "agree": True,
                        "summary": "SPY, RSP and the sector agree"},
        "regime": {"label": "persistence", "pctFrom200": 12.3456, "reason": None},
        "checks": {"passed": 3, "of": 4, "summary": "3 of 4 pass"},
        "state": "ok",
        "evidence": {"asof": "2026-11-06"},
    }
    payload.update(over)
    return {"defId": "rsLine", "sym": "NVDA", "tf": "D", "rev": 3, "inputs": {"benchmark": "SPY"},
            "columns": {"rsLine": [1.1, 1.2, 1.234567]}, "times": [1, 2, 3], "payload": payload}


@pytest.fixture
def served(monkeypatch):
    from api.services.signature import registry_defs
    calls: list = []
    box = {"env": _envelope()}

    def fake(def_id, sym, tf, inputs):
        calls.append((def_id, sym, tf, dict(inputs or {})))
        if isinstance(box["env"], Exception):
            raise box["env"]
        return box["env"]

    monkeypatch.setattr(registry_defs, "serve", fake)
    return calls, box


def test_the_reading_returns_only_the_readout_summaries(served):
    calls, _ = served
    out = rt.rs_reading(" nvda ")
    # rev 5: the tool asks for the RS Rating Reading, so the rating-history block is computed
    assert calls == [("rsLine", "NVDA", "D", {"benchmark": "SPY", "view": "rating"})]
    assert out["ok"] and out["symbol"] == "NVDA"
    assert out["fields"] == {
        "benchmark": "S&P 500 (SPY)", "rating": "94 · fast 91", "rating_asof": "2026-11-06",
        "rs_line": "above its 21 EMA by 6.8%", "last_rs_high": "2 bars ago · before price",
        "sensitivity": "SPY, RSP and the sector agree", "regime": "persistence",
        "checks": "3 of 4 pass"}
    assert out["missing"] == []
    assert all(isinstance(v, str) for v in out["fields"].values())
    text = json.dumps(out, ensure_ascii=False)
    for leak in ("columns", "times", "9917", "1.234567", "6.8123", "12.3456", "0.4123", "components"):
        assert leak not in text, leak
    assert "Rating: 94 · fast 91 (rated as of 2026-11-06)" in out["narration"]
    assert "not RSI" in out["note"]


def test_a_missing_block_says_it_is_missing_and_an_empty_one_uses_the_readout_fallback(served):
    _, box = served
    env = _envelope(rating={"ibd": None, "fast": None, "asof": None, "source": "dark", "summary": None})
    del env["payload"]["checks"]
    box["env"] = env
    out = rt.rs_reading("NVDA")
    assert out["fields"]["checks"] == rt.MISSING and out["missing"] == ["checks"]
    assert out["fields"]["rating"] == "not yet rated" and out["fields"]["rating_asof"] is None


def test_the_phase3_blocks_appear_only_when_the_envelope_carries_them(served):
    _, box = served
    assert not {"rotation", "quality", "vars"} & set(rt.rs_reading("NVDA")["fields"])
    box["env"] = _envelope(rotation={"quadrant": "Leading", "ratio": 101.2, "summary": "Leading, 6 weeks"},
                           quality={"score": 0.8, "summary": None, "reason": "needs 90 bars (has 40)"},
                           vars={"value": 1.5, "summary": "rising, above its average"})
    f = rt.rs_reading("NVDA")["fields"]
    assert f["rotation"] == "Leading, 6 weeks" and f["vars"] == "rising, above its average"
    assert f["quality"] == "not available: needs 90 bars (has 40)"


def test_the_rating_history_is_the_servers_summary_only_when_it_describes_the_reading(served):
    """rsLine rev 5 (Deepvue round 2): `payload.ratingHistory.summary`, verbatim
    (its U+00A0 read as plain spaces), only when the block is there and drew the
    RS Rating Reading. Absent block, empty summary, or the server's "not the chosen
    reading" (a row that does not declare the Reading) leave the field out."""
    _, box = served
    assert "rating_history" not in rt.rs_reading("NVDA")["fields"], "no block, no field"
    box["env"] = _envelope(ratingHistory={"value": 82, "average": 79.43, "change20": 6, "sessions": 187,
                                          "asof": "2026-11-06", "stale": False, "reason": None,
                                          "summary": "82, up\u00a06 in 20\u00a0sessions"})
    out = rt.rs_reading("NVDA")
    assert out["fields"]["rating_history"] == "82, up 6 in 20 sessions"
    assert "RS Rating history: 82, up 6 in 20 sessions" in out["narration"]
    for leak in ("79.43", "187", "change20"):
        assert leak not in json.dumps(out, ensure_ascii=False), leak
    for why in ("not yet rated", "daily charts only"):
        box["env"] = _envelope(ratingHistory={"value": None, "summary": why, "reason": why})
        assert rt.rs_reading("NVDA")["fields"]["rating_history"] == why, why
    box["env"] = _envelope(ratingHistory={"value": None, "summary": "not the chosen reading",
                                          "reason": "not the chosen reading"})
    assert "rating_history" not in rt.rs_reading("NVDA")["fields"]
    box["env"] = _envelope(ratingHistory={"value": None, "summary": None, "reason": None})
    assert "rating_history" not in rt.rs_reading("NVDA")["fields"], "never fabricated"


def test_no_payload_or_a_failing_provider_answers_without_fabricating(served):
    _, box = served
    box["env"] = {"columns": {"rsLine": [1.0]}, "times": [1]}
    out = rt.rs_reading("NVDA")
    assert out["ok"] is False and "missing" in out["error"] and "fields" not in out
    box["env"] = RuntimeError("boom")
    assert rt.rs_reading("NVDA")["ok"] is False


def test_a_bad_ticker_or_benchmark_is_refused_before_any_read(served):
    calls, _ = served
    assert rt.rs_reading("NV DA")["ok"] is False
    assert rt.rs_reading("1234")["ok"] is False
    assert rt.rs_reading("NVDA", "BTC")["ok"] is False
    assert calls == []
    assert rt.rs_reading("NVDA", "qqq")["ok"] and calls[-1][3] == {"benchmark": "QQQ", "view": "rating"}


def test_the_validators_have_the_uct_agent_kind_shape():
    assert rt.validate_reading_params({"symbol": "NVDA"}) is None
    assert isinstance(rt.validate_reading_params({"symbol": ""}), str)
    assert rt.validate_term_params({"term": "gold dot"}) is None
    assert isinstance(rt.validate_term_params({}), str)


# ── registration: the gate, both surfaces, the same names ───────────────────

def test_the_gate_is_off_by_default_on_both_surfaces(gate_off):
    from api.services import voice_tool_impls  # noqa: F401  (registers)
    from api.services import voice_tools as vt
    from api.services.journal_two import coach_chat_tools as cct

    for name in NAMES:
        assert name not in cct.TOOLS and cct.TOOLS.get(name) is None
        assert name not in {s["name"] for s in cct.TOOLS.values()}
        with pytest.raises(KeyError):
            vt.dispatch(name, {"term": "gold dot"} if name == "explain_rs" else {"ticker": "NVDA"})
    voice_names = {t["name"] for t in vt.get_schema_for_context("compass")}
    assert not voice_names & set(NAMES)
    assert "find_patterns_on_ticker" in voice_names and "find_patterns_on_ticker" in cct.TOOLS  # controls


def test_voice_and_chat_expose_the_same_names_and_schemas_when_on(gate_on):
    from api.services import voice_agents, voice_tool_impls  # noqa: F401
    from api.services import voice_tools as vt
    from api.services.journal_two import coach_chat_tools as cct

    voice = {t["name"]: t for t in vt.get_schema_for_context("compass") if t["name"] in NAMES}
    chat = {n: cct.TOOLS[n] for n in NAMES if n in cct.TOOLS}
    assert set(voice) == set(chat) == set(NAMES)
    for name in NAMES:
        assert name in voice_agents._compass_tool_union() and name in voice_agents._COMPASS_CORE_TOOLS
        assert voice[name]["description"] == chat[name]["description"]
        assert voice[name]["parameters"]["properties"] == chat[name]["input_schema"]["properties"]
        assert "_voice_delegate" in chat[name]["executor"].__qualname__
        assert chat[name]["requires_confirm"] is False


def test_chat_reaches_the_voice_implementation(gate_on, served):
    from api.services.journal_two import coach_chat_tools as cct
    from api.services import voice_tools as vt

    via_chat = cct.TOOLS["get_rs_reading"]["executor"](user_id="u", account_id=None, args={"ticker": "nvda"})
    assert via_chat == rt.rs_reading("NVDA")
    assert vt.dispatch("explain_rs", {"term": "gold dot"}) == rt.explain_term("gold dot")
    assert cct.TOOLS["explain_rs"]["executor"](user_id="u", account_id=None,
                                                args={"term": "RSI"})["key"] == "rsIsNotRsi"


def test_the_ledger_declares_the_gate_dark_on_web():
    flags = json.loads((ROOT / "docs" / "feature_flags.json").read_text(encoding="utf-8"))["flags"]
    e = flags[GATE]
    assert e["status"] == "dark" and e["where"] == ["web"] and "report card" in e["note"].lower()


# ── the golden set ──────────────────────────────────────────────────────────

def test_the_golden_set_carries_the_three_rs_questions_and_still_validates():
    from api.services.compass_eval import golden_set as gs
    from api.services.compass_eval import test_golden_set as tgs

    by_q = {q["question"]: q for q in gs.load_golden_set()}
    want = {"What does the gold dot on the RS line mean?": ("explain_rs", 2),
            "Is NVDA leading the market right now?": ("get_rs_reading", 1),
            "Is RS the same as RSI?": ("explain_rs", 2)}
    for question, (tool, rung) in want.items():
        q = by_q[question]
        assert q["rung"] == rung and any(tool in group for group in q["must_call_tools"]), question
        assert set(q["forbidden"]) <= tgs.VALID_FORBIDDEN
    tgs.test_golden_set_loads_and_validates()
    tgs.test_every_rung_represented_and_bars_defined()
