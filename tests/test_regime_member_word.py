"""F-O8-SERVER -- the regime whose id is `amber` is called "Yellow" to members, server side too.

The owner ruled (O-8) that the 50-89 exposure tier is shown as "Yellow" everywhere. The client does
it through ONE map (app/src/pages/journal-2-0/lib/blocks/regimeWords.js), railed against the board
property builtin:regime_at_write in note_properties.py. The ids and every stored value stay `amber`.

This file rails the server half:
  * the word map is DERIVED from that same board property (never restated), and covers exactly the
    ids regime.classify_regime answers;
  * a model or member may send either spelling (YELLOW or the stored id) and both resolve to the id;
  * no model-facing prompt string names the tier by its id: the only permitted spelling of the id
    is the code form `amber`, used where the prompt tells the model to SAY Yellow when it reads it.

⛔ The id is built by concatenation below, so a scan of this file can never match itself.
⛔ The prompt rail reads the RUNTIME strings (the module constants, the composed voice prompt, every
   registered tool description, the live-context line), which carry no comments by construction.
"""
from __future__ import annotations

import re

import pytest

AMB = "am" + "ber"          # the stored id; never typed whole in this file
AMB_UP = AMB.upper()

# The id is allowed in a prompt only in its code form, `amber`, and only lowercase.
_ID_CODE_FORM = "`" + AMB + "`"
_ANY_SPELLING = re.compile(r"(?i)(?<![A-Za-z])" + AMB + r"(?![A-Za-z])")


# ── the word map ─────────────────────────────────────────────────────────────

def test_the_word_map_IS_the_board_propertys_labels():
    from api.services.journal_two import note_properties, regime
    prop = next(d for d in note_properties.BUILTIN_PROPERTY_DEFS
                if d["id"] == note_properties.REGIME_AT_WRITE)
    labels = {o["id"]: o["label"] for o in prop["options"]}
    assert regime.regime_words() == labels
    assert regime.regime_words()[AMB] == "Yellow"


def test_the_word_map_covers_exactly_the_classifiers_ids():
    from api.services.journal_two import regime
    ids = {regime.classify_regime(s) for s in range(0, 151)}
    assert set(regime.regime_words()) == ids


@pytest.mark.parametrize("spelling", [
    "YELLOW", "Yellow", "yellow", "  yellow ", AMB_UP, AMB, AMB.title(),
])
def test_both_spellings_resolve_to_the_stored_id(spelling):
    from api.services.journal_two import regime
    assert regime.regime_id_for(spelling) == AMB


@pytest.mark.parametrize("spelling,expected", [
    ("GREEN", "green"), ("orange", "orange"), ("Red", "red"),
])
def test_the_other_tiers_resolve_to_their_ids(spelling, expected):
    from api.services.journal_two import regime
    assert regime.regime_id_for(spelling) == expected


@pytest.mark.parametrize("value", ["PURPLE", "", "   ", None, 7, "bull_trend", "yellowish"])
def test_an_unknown_spelling_resolves_to_nothing(value):
    from api.services.journal_two import regime
    assert regime.regime_id_for(value) is None
    assert regime.regime_word(value) is None


def test_the_word_for_each_spelling():
    from api.services.journal_two import regime
    assert regime.regime_word(AMB) == "Yellow"
    assert regime.regime_word(AMB_UP) == "Yellow"
    assert regime.regime_word("YELLOW") == "Yellow"
    assert regime.regime_word("green") == "Green"


# ── the prompt rail ──────────────────────────────────────────────────────────

def _misnamings(text: str) -> list[str]:
    """Every spelling of the id in `text` that is NOT the permitted code form, with context."""
    bad = []
    for m in _ANY_SPELLING.finditer(text):
        s, e = m.start(), m.end()
        if m.group(0) == AMB and text[s - 1:s] == "`" and text[e:e + 1] == "`":
            continue
        bad.append(text[max(0, s - 40):e + 40].replace("\n", " "))
    return bad


def _prompt_strings(monkeypatch) -> dict[str, str]:
    from api.services.journal_two import coach_chat, coach_chat_tools, coach_prompts
    from api.services.journal_two import regime as regime_service
    from api.services.voice_prompts import compass
    import api.services.voice_tool_impls  # noqa: F401 -- registers the voice tools at import
    from api.services.voice_tools import _REGISTRY

    out: dict[str, str] = {}
    # Every prompt constant coach_prompts exports, DERIVED (a constant added tomorrow is covered).
    for name, value in vars(coach_prompts).items():
        if name.isupper() and isinstance(value, str):
            out[f"coach_prompts.{name}"] = value
    # The composed voice prompt, mentor lane included.
    monkeypatch.setenv("COMPASS_MENTOR_MODE", "1")
    out["voice_prompts.compass.build_compass_voice_prompt()"] = compass.build_compass_voice_prompt()

    def _schema_descriptions(schema, path):
        for key, prop in ((schema or {}).get("properties") or {}).items():
            if isinstance(prop, dict) and isinstance(prop.get("description"), str):
                out[f"{path}.{key}"] = prop["description"]

    # Every chat tool, gated or not: its description and every parameter description.
    for reg_name in ("_TOOLS_UNGATED", "_BRAIN_TOOLS"):
        for name, spec in getattr(coach_chat_tools, reg_name).items():
            out[f"chat.{name}.description"] = spec.get("description") or ""
            _schema_descriptions(spec.get("input_schema"), f"chat.{name}.input")
    # Every voice tool.
    for name, spec in _REGISTRY.items():
        out[f"voice.{name}.description"] = spec.get("description") or ""
        params = spec.get("parameters") or {}
        for key, prop in (params.get("properties", params) if isinstance(params, dict) else {}).items():
            if isinstance(prop, dict) and isinstance(prop.get("description"), str):
                out[f"voice.{name}.param.{key}"] = prop["description"]
    # The live-context line chat appends, on a day the backdrop is the 50-89 tier.
    monkeypatch.setattr(regime_service, "get_current_regime",
                        lambda: {"regime": AMB, "score": 72.0})
    out["coach_chat._current_regime_context()"] = coach_chat._current_regime_context()
    return out


def test_the_checker_can_fire():
    # Non-vacuity control: each wrong spelling is SEEN, and the one permitted form is not.
    assert _misnamings(f"- {AMB_UP} (50-89): selective")
    assert _misnamings(f"Bull Flag in {AMB.title()} is +1.8R")
    assert _misnamings(f"the backdrop is {AMB} today")
    assert _misnamings(f"say Yellow for {_ID_CODE_FORM}.") == []


def test_no_prompt_string_names_the_tier_by_its_id(monkeypatch):
    strings = _prompt_strings(monkeypatch)
    # Non-vacuity: the scan actually read the prompts it exists to guard.
    assert "coach_prompts.COMPASS_SYSTEM_PROMPT" in strings
    assert "chat.list_recent_trades.description" in strings
    assert "voice.analyze_setup_in_period.description" in strings
    assert "Exposure Backdrop" in strings["coach_chat._current_regime_context()"]
    offenders = {k: _misnamings(v) for k, v in strings.items()}
    offenders = {k: v for k, v in offenders.items() if v}
    assert offenders == {}, offenders


def test_the_legend_names_yellow_and_keeps_the_bands():
    from api.services.journal_two import coach_prompts
    p = coach_prompts.COMPASS_SYSTEM_PROMPT
    for band in ("- GREEN (≥90):", "- YELLOW (50–89):", "- ORANGE (15–49):", "- RED (<15):"):
        assert band in p, band
    assert "GREEN /\nYELLOW / ORANGE / RED" in p
    # The model is told to SAY Yellow when the data carries the id.
    legend = p[p.index("### Regime trading"):p.index("### Behavioral patterns")]
    assert _ID_CODE_FORM in legend and "Yellow" in legend


def test_the_live_context_line_says_yellow(monkeypatch):
    from api.services.journal_two import coach_chat
    from api.services.journal_two import regime as regime_service
    monkeypatch.setattr(regime_service, "get_current_regime",
                        lambda: {"regime": AMB, "score": 72.0})
    ctx = coach_chat._current_regime_context()
    assert "Exposure Backdrop is yellow" in ctx
    assert "exposure score 72.0" in ctx


def test_the_live_context_line_passes_an_unknown_value_through(monkeypatch):
    # An id the map does not know is rendered as it was before, never dropped.
    from api.services.journal_two import coach_chat
    from api.services.journal_two import regime as regime_service
    monkeypatch.setattr(regime_service, "get_current_regime",
                        lambda: {"regime": "mystery", "score": 1})
    assert "Exposure Backdrop is mystery" in coach_chat._current_regime_context()
