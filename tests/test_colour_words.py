"""Colour words in plain-English authoring: one file, read by both halves.

``colourWords.json`` gives the assistant the value to write for a word a member names, and
gives the browser's read-back the word to show for a value. Measured 2026-11-14 with no
shared map: "green" came back ``#26A69A``, which the read-back honestly called teal.
"""
from __future__ import annotations

import json
import re

import pytest

from api.services import definition_conversation as conv


def test_the_file_is_where_the_browser_reads_it():
    assert conv.COLOUR_WORDS_PATH.name == "colourWords.json"
    assert conv.COLOUR_WORDS_PATH.is_file()
    readback = (conv.COLOUR_WORDS_PATH.parent / "readback.js").read_text(encoding="utf-8")
    assert "import COLOUR_WORDS from './colourWords.json'" in readback


def test_every_word_is_written_with_a_value_the_read_back_names_that_word():
    raw = json.loads(conv.COLOUR_WORDS_PATH.read_text(encoding="utf-8"))
    words = conv.colour_words()
    assert len(words) > 8
    for word, value in words.items():
        assert re.fullmatch(r"#[0-9A-F]{6}", value), (word, value)
        assert raw["names"][value] == word


def test_green_is_not_the_value_that_reads_back_as_teal():
    words = conv.colour_words()
    assert words["green"] != "#26A69A"
    assert words["teal"] == "#26A69A"


def test_the_instructions_carry_every_word_with_its_value():
    prompt = conv.system_prompt()
    for word, value in conv.colour_words().items():
        assert f"{word} {value}" in prompt
    assert "green is not teal" in prompt


def test_a_word_whose_value_reads_back_as_something_else_is_refused(tmp_path, monkeypatch):
    """The loader fails closed: a map that would make the read-back contradict the request
    never reaches the prompt."""
    bad = tmp_path / "colourWords.json"
    bad.write_text(json.dumps({"words": {"green": "#26A69A"}, "names": {"#26A69A": "teal"}}),
                   encoding="utf-8")
    monkeypatch.setattr(conv, "COLOUR_WORDS_PATH", bad)
    conv.colour_words.cache_clear()
    try:
        with pytest.raises(ValueError):
            conv.colour_words()
        # control: the same loader accepts a consistent file
        bad.write_text(json.dumps({"words": {"green": "#089981"}, "names": {"#089981": "green"}}),
                       encoding="utf-8")
        conv.colour_words.cache_clear()
        assert conv.colour_words() == {"green": "#089981"}
    finally:
        conv.colour_words.cache_clear()


def test_a_colour_named_in_the_evaluation_cases_is_one_the_map_knows():
    """The evaluation cases already ask for colours by word; each must be a word with a value."""
    from pathlib import Path
    cases = json.loads((Path(__file__).parent / "fixtures" / "authoring" / "converse_eval_cases.json")
                       .read_text(encoding="utf-8"))
    text = json.dumps(cases)
    named = set(re.findall(r'"(?:bgcolor|barcolor|color)":\s*"([a-z]+)"', text))
    assert named, "the probe found no colour words in the cases: it is looking in the wrong place"
    assert named <= set(conv.colour_words()), sorted(named - set(conv.colour_words()))
