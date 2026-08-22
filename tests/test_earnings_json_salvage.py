"""`_parse_json_block` must not throw the whole brief away for the two
near-misses Sonnet 5 produces live (warm pass, 2026-08-22, 3 of the first 8
generations): an unescaped double quote inside a string, and truncation at
max_tokens mid-string. A thrown-away brief never persists, so the name stays
cold and the next warm pass pays for it again."""
import json

import pytest

from api.services.engine import _parse_json_block, _salvage_json_fields


CLEAN = {"preview": "NVDA reports after the close.", "bullets": ["one", "two"]}


def test_clean_json_and_fenced_json_still_parse_strictly():
    assert _parse_json_block(json.dumps(CLEAN)) == CLEAN
    assert _parse_json_block("```json\n" + json.dumps(CLEAN) + "\n```") == CLEAN
    assert _parse_json_block("Here you go:\n" + json.dumps(CLEAN)) == CLEAN


def test_unescaped_inner_quotes_are_salvaged():
    raw = (
        '{\n'
        '  "preview": "The street calls it a "beat-and-raise machine" and the bar is high.",\n'
        '  "bullets": [\n'
        '    "THE BACKDROP: four straight beats.",\n'
        '    "DRIVERS: the "Blackwell" ramp and margins.",\n'
        '    "BAR: consensus EPS $1.01."\n'
        '  ]\n'
        '}'
    )
    with pytest.raises(Exception):
        json.loads(raw)                                    # the reply really is broken
    out = _parse_json_block(raw)
    assert out["preview"] == 'The street calls it a "beat-and-raise machine" and the bar is high.'
    assert out["bullets"] == [
        "THE BACKDROP: four straight beats.",
        'DRIVERS: the "Blackwell" ramp and margins.',
        "BAR: consensus EPS $1.01.",
    ]


def test_truncation_keeps_the_paragraph_and_the_complete_bullets():
    raw = (
        '{\n'
        '  "preview": "A complete strategist note sentence one. Sentence two is also complete.",\n'
        '  "bullets": [\n'
        '    "THE BACKDROP: complete bullet.",\n'
        '    "DRIVERS: also complete.",\n'
        '    "EXPECTATIONS BAR: this one was cut off mid-sen'
    )
    out = _parse_json_block(raw)
    assert out["preview"].startswith("A complete strategist note")
    assert out["bullets"] == ["THE BACKDROP: complete bullet.", "DRIVERS: also complete."]


def test_truncation_inside_a_long_paragraph_keeps_its_full_sentences():
    body = ("Blackwell demand stayed strong through the quarter and margins held. " * 6).strip()
    raw = '{\n  "preview": "' + body + " And then the reply was cut right he"
    out = _parse_json_block(raw)
    assert out["preview"].endswith("margins held.")
    assert "cut right he" not in out["preview"]


def test_a_short_truncated_paragraph_is_not_worth_keeping():
    assert _salvage_json_fields('{\n  "preview": "Too short to be a note and then cut') == {}


def test_garbage_still_raises():
    with pytest.raises(Exception):
        _parse_json_block("not json at all")


def test_analysis_shape_salvages_headline_and_summary():
    raw = (
        '{\n'
        '  "headline": "Q2 beat by $0.12; stock sold the "good news" inside the implied move.",\n'
        '  "summary": "Revenue grew 30%. Data center led. Guidance was raised.",\n'
        '  "bullets": [\n'
        '    "THE PRINT: EPS $1.05 vs $1.01.",\n'
        '    "REACTION: -2% vs ±6% implied.",\n'
        '  ]\n'
        '}'
    )
    out = _parse_json_block(raw)
    assert out["headline"].startswith("Q2 beat by $0.12")
    assert out["summary"].startswith("Revenue grew 30%")
    assert len(out["bullets"]) == 2
