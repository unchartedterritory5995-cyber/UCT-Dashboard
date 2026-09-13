"""Extractor prompt, schema transport and params rails (stream S-D).

WHAT THIS FILE HAS TO BE ABLE TO SAY RED FOR
1. a transport schema the structured-output grammar rejects (type arrays, $ref,
   maxItems, minItems > 1) — with a control that the contract really has them;
2. an extractor_version that does not move when the prompt, vocabulary or schema moves;
3. a prompt that lost one of R1-R10 or the vocabulary, or that carries a golden quote
   (this repository is public);
4. request params carrying a sampling parameter, a prefill or fallbacks;
5. a displayed transcript turn that is not an exact slice of the segment text.
"""
from __future__ import annotations

import json
import pathlib
import re

import pytest

from api.services.wisdom.extract import prompt, seams, segmenter

DATA = pathlib.Path(r"C:/Users/Patrick/uct-worktrees/wisdom-loop/data/wisdom")


def _walk(node, path=""):
    if isinstance(node, dict):
        yield path, node
        for k, v in node.items():
            yield from _walk(v, f"{path}/{k}")
    elif isinstance(node, list):
        for i, v in enumerate(node):
            yield from _walk(v, f"{path}[{i}]")


def test_the_transport_schema_has_none_of_the_rejected_keywords():
    contract_text = prompt.schema_text()
    # non-vacuity: every construct the transform removes is really in the contract
    for construct in ('"$ref"', '"$defs"', '"maxItems"', '"minItems": 2', '["string", "null"]', '"$schema"'):
        assert construct in contract_text, construct
    api = prompt.api_schema()
    for path, node in _walk(api):
        assert not isinstance(node.get("type"), list), path
        for bad in ("$ref", "$defs", "maxItems", "$schema", "$id", "title"):
            assert bad not in node, (path, bad)
        if isinstance(node.get("minItems"), int):
            assert node["minItems"] in (0, 1), path
        if node.get("type") == "object":
            assert node.get("additionalProperties") is False, path
    # the API's measured union-type limit; control: the contract as written is over it
    assert _unions(prompt.contract_schema()) > prompt.API_MAX_UNION_PARAMS
    assert _unions(api) <= prompt.API_MAX_UNION_PARAMS


def _unions(schema) -> int:
    count = 0
    for _, node in _walk(schema):
        props = node.get("properties")
        if isinstance(props, dict):
            count += sum(1 for p in props.values()
                         if isinstance(p, dict) and ("anyOf" in p or isinstance(p.get("type"), list)))
    return count


def test_nullable_text_travels_as_an_empty_string_and_the_writer_knows_where():
    fields = prompt.nullable_string_fields()
    assert {"speaker_label", "setup_vocab", "trigger", "notes"} <= fields[""]
    assert fields["levels"] == {"price_as_heard"} and fields["principle"] == {"testable_claim"}
    record = prompt.api_schema()["properties"]["records"]["items"]["properties"]
    for name in fields[""]:
        assert record[name]["type"] == "string" and prompt.EMPTY_MEANS_NULL in record[name]["description"], name
    # control: a nullable NUMBER keeps its null
    assert {v["type"] for v in record["entry"]["anyOf"]} == {"number", "null"}


def test_the_transport_schema_keeps_every_contract_field_and_enum():
    api = prompt.api_schema()
    record = api["properties"]["records"]["items"]
    assert record["required"] == list(prompt.record_fields())
    assert set(record["properties"]) == set(prompt.record_fields())
    assert record["properties"]["direction"]["enum"] == ["long", "short", None]
    principle = record["properties"]["principle"]["anyOf"]
    assert {v["type"] for v in principle} == {"object", "null"}
    obj = next(v for v in principle if v["type"] == "object")
    assert obj["additionalProperties"] is False and "statement" in obj["properties"]
    zone = record["properties"]["entry_zone"]["anyOf"]
    assert next(v for v in zone if v["type"] == "array")["items"] == {"type": "number"}


def test_the_version_is_stable_and_moves_with_prompt_vocabulary_and_schema(monkeypatch):
    v = prompt.extractor_version()
    assert re.match(r"^wx-v0-[0-9a-f]{8}$", v)
    assert prompt.extractor_version() == v
    vocab = prompt.vocabulary()
    assert prompt.extractor_version(prompt.system_prompt(vocab[:-1])) != v
    monkeypatch.setattr(prompt, "schema_text", lambda: prompt.SCHEMA_FILE.read_text(encoding="utf-8") + " ")
    assert prompt.extractor_version() != v


def test_the_prompt_states_every_rule_and_the_whole_vocabulary():
    text = prompt.system_prompt()
    for n in range(1, 11):
        assert re.search(rf"^R{n} ", text, re.M), f"R{n} missing"
    names = [v["name"] for v in prompt.vocabulary()]
    draft = json.loads(prompt.VOCAB_DRAFT_FILE.read_text(encoding="utf-8"))
    assert len(names) == len(draft["entries"])
    for name in names:
        assert f"- {name}" in text
    for phrase in ("exactly once", "no_view", "hindsight", "breakeven", "ticker_as_heard"):
        assert phrase in text


def test_the_vocabulary_comes_from_core_vocab_when_it_exists(monkeypatch):
    real = seams.seam
    monkeypatch.setattr(seams, "seam", lambda m, a: (lambda: ["Alpha Setup", {"name": "Beta", "aliases": ["b"]}])
                        if (m, a) == ("api.services.wisdom.core.vocab", "list_for_prompt") else real(m, a))
    assert prompt.vocabulary() == [{"name": "Alpha Setup", "aliases": []}, {"name": "Beta", "aliases": ["b"]}]
    assert prompt.vocabulary_source() == "core.vocab.list_for_prompt"


def test_the_committed_prompt_carries_no_golden_quote():
    base = DATA / "golden"
    files = sorted(base.glob("*.jsonl")) if base.exists() else []
    if not files:
        pytest.skip("golden labels are gitignored and not present here")
    text = prompt.system_prompt().casefold()
    for f in files:
        for line in f.read_text(encoding="utf-8").splitlines():
            if line.strip():
                quote = json.loads(line).get("quote") or ""
                for chunk in re.split(r"[.!?]", quote):
                    if len(chunk.strip()) >= 24:
                        assert chunk.strip().casefold() not in text, f"a golden quote leaked into the prompt: {chunk[:30]}"


def test_params_carry_no_sampling_prefill_or_fallbacks_and_cache_the_system():
    seg = {"segment_id": "s1", "kind": "section", "text": "ZZZT (Daily)\nnote", "path": "INTRO"}
    params = prompt.build_params(seg, {"stream": "sunday_scans"}, model="claude-opus-5", effort="high")
    assert set(params) == {"model", "max_tokens", "system", "messages", "output_config"}
    assert params["messages"][-1]["role"] == "user"
    assert params["system"][0]["cache_control"] == {"type": "ephemeral"}
    assert params["output_config"]["format"]["type"] == "json_schema"
    assert params["output_config"]["effort"] == "high"
    with pytest.raises(ValueError):
        prompt.build_params(seg, {}, model="claude-opus-5", effort="turbo")


def test_displayed_turns_are_exact_slices_of_the_segment_text():
    raw = [{"t": i * 10, "text": ("Host Name: " if i % 3 else "Guest Person: ") + f"line {i} here."}
           for i in range(20)]
    seg = segmenter.segment_transcript(raw, [])[0].to_row("src", 1)
    body = prompt.render_segment_body(seg)
    for line in body.splitlines():
        m = re.match(r"^\[\d{2}:\d{2}:\d{2}\](?: \{([^}]*)\})? (.*)$", line)
        assert m, line
        assert m.group(2) in seg["text"]
    assert "{Guest Person}" in body and "{Host Name}" in body
