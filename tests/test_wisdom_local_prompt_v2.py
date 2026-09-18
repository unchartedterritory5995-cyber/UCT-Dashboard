"""R93, session 23 — the local-only v2 prompt variant.

⛔⛔ WHAT THIS FILE HAS TO BE ABLE TO SAY RED FOR
1. the PAID extractor_version changing because this module exists (it must not import a byte
   of this module's content into anything prompt.py's callers see);
2. a v2 run sharing a version with the v1 local run or the paid run;
3. the quote-first reorder running on the WRONG schema level and silently doing nothing (the
   session-23 bug: it reordered the top-level segment wrapper, which has no `quote` key at
   all, and reported success by having nothing to fail);
4. the reorder losing or duplicating a field;
5. this module being importable/usable while the backend resolves to paid.
"""
from __future__ import annotations

import json
import pathlib
import sys

import pytest

REPO = pathlib.Path(__file__).resolve().parents[1]
if str(REPO) not in sys.path:
    sys.path.insert(0, str(REPO))

from api.services.wisdom.extract import config, local_prompt_v2, prompt  # noqa: E402

PAID_VERSION = "wx-v0-fc47bc97"


@pytest.fixture
def local(monkeypatch, tmp_path):
    monkeypatch.setenv(config.BACKEND_ENV, "local")
    monkeypatch.setenv("WISDOM_EXTRACT_LOCAL_MODEL", "qwen2.5-7b-instruct-q4")
    monkeypatch.setenv("WISDOM_LOCAL_JOBS_DIR", str(tmp_path / "jobs"))
    return tmp_path


# ── the paid path is untouched ────────────────────────────────────────────────

def test_the_PAID_extractor_version_is_unchanged_by_this_module_existing(monkeypatch):
    monkeypatch.delenv(config.BACKEND_ENV, raising=False)
    assert prompt.extractor_version() == PAID_VERSION


def test_v2_refuses_to_version_under_a_paid_backend(monkeypatch):
    monkeypatch.delenv(config.BACKEND_ENV, raising=False)
    with pytest.raises(RuntimeError, match="LOCAL-ONLY"):
        local_prompt_v2.extractor_version_v2()


# ── versions never collide ────────────────────────────────────────────────────

def test_v2_version_differs_from_paid_and_from_v1_local(local):
    v1 = prompt.extractor_version()
    v2 = local_prompt_v2.extractor_version_v2()
    assert v1 != PAID_VERSION  # sanity: we really are on the local branch
    assert v2 != v1
    assert v2 != PAID_VERSION
    assert v2.startswith("wx-local-v2-")


def test_v2_version_changes_if_the_fewshot_file_changes(local, monkeypatch, tmp_path):
    fake = tmp_path / "fewshot.json"
    fake.write_text(json.dumps([{"segment_id": "x", "segment_text": "a", "source": {},
                                "target": {"record_type": "CALL", "ticker": "NVDA", "quote": "a"}}]),
                    encoding="utf-8")
    monkeypatch.setattr(local_prompt_v2, "FEWSHOT_FILE", fake)
    v_a = local_prompt_v2.extractor_version_v2()
    fake.write_text(json.dumps([{"segment_id": "x", "segment_text": "b", "source": {},
                                "target": {"record_type": "CALL", "ticker": "NVDA", "quote": "b"}}]),
                    encoding="utf-8")
    v_b = local_prompt_v2.extractor_version_v2()
    assert v_a != v_b, "a different few-shot set must not silently share a version"


def test_v2_version_changes_if_the_fewshot_file_is_missing(local, monkeypatch, tmp_path):
    monkeypatch.setattr(local_prompt_v2, "FEWSHOT_FILE", tmp_path / "does-not-exist.json")
    v_missing = local_prompt_v2.extractor_version_v2()
    real = tmp_path / "fewshot.json"
    real.write_text(json.dumps([{"segment_id": "x", "segment_text": "a", "source": {},
                                "target": {"record_type": "CALL", "ticker": "NVDA", "quote": "a"}}]),
                    encoding="utf-8")
    monkeypatch.setattr(local_prompt_v2, "FEWSHOT_FILE", real)
    v_present = local_prompt_v2.extractor_version_v2()
    assert v_missing != v_present


# ── the reorder operates at the RIGHT schema level ────────────────────────────

def test_reorder_puts_quote_first_at_the_RECORD_level_not_the_wrapper(local):
    """⛔⛔ THE ONE THAT SHIPPED BROKEN. `quote` lives at
    properties.records.items.properties.quote, not at the schema's top level (which only has
    segment_id/records). A version of this reorder that checked the top level found nothing
    and silently did nothing."""
    schema = prompt.api_schema()
    top_level_has_quote = "quote" in schema.get("properties", {})
    assert not top_level_has_quote, "if this ever becomes true the reorder needs to change too"

    reordered = local_prompt_v2._reorder_quote_first(schema)
    items = reordered["properties"]["records"]["items"]
    assert next(iter(items["properties"])) == "quote"
    assert items["required"][0] == "quote"


def test_reorder_loses_no_field_and_duplicates_none(local):
    schema = prompt.api_schema()
    before = schema["properties"]["records"]["items"]["properties"]
    reordered = local_prompt_v2._reorder_quote_first(schema)
    after = reordered["properties"]["records"]["items"]["properties"]
    assert set(before.keys()) == set(after.keys())
    assert len(after) == len(set(after.keys()))  # no duplicate key collapsed a field
    before_req = schema["properties"]["records"]["items"]["required"]
    after_req = reordered["properties"]["records"]["items"]["required"]
    assert sorted(before_req) == sorted(after_req)


def test_reorder_never_mutates_the_original(local):
    schema = prompt.api_schema()
    original_first_key = next(iter(schema["properties"]["records"]["items"]["properties"]))
    local_prompt_v2._reorder_quote_first(schema)
    # api_schema() may be cached; re-fetch and confirm the SOURCE object was never touched
    assert next(iter(schema["properties"]["records"]["items"]["properties"])) == original_first_key
    assert original_first_key == "record_type"


def test_CONTROL_the_unreordered_schema_does_NOT_have_quote_first(local):
    """⭐ Without this, the reorder tests above would pass even if _reorder_quote_first were
    the identity function — the control proves the input was genuinely not already quote-first."""
    schema = prompt.api_schema()
    items = schema["properties"]["records"]["items"]
    assert next(iter(items["properties"])) != "quote"


# ── system prompt is additive, never a rewrite ────────────────────────────────

def test_v2_system_prompt_contains_the_full_shared_prompt_verbatim(local):
    """The v2 addendum must never REPLACE prompt.py's own rules — only append to them."""
    shared = prompt.system_prompt()
    v2 = local_prompt_v2.system_prompt_v2()
    assert v2.startswith(shared)
    assert len(v2) > len(shared)


def test_v2_instruction_mentions_verbatim_and_omit(local):
    assert "verbatim" in local_prompt_v2.VERBATIM_INSTRUCTION.lower() or \
           "exactly" in local_prompt_v2.VERBATIM_INSTRUCTION.lower()
    assert "omit" in local_prompt_v2.VERBATIM_INSTRUCTION.lower()


# ── few-shot loading ───────────────────────────────────────────────────────────

def test_fewshot_file_is_gitignored():
    import subprocess
    result = subprocess.run(["git", "-C", str(REPO), "check-ignore", "-q",
                             str(local_prompt_v2.FEWSHOT_FILE)], capture_output=True)
    assert result.returncode == 0, "the few-shot file carries real quote text and must never be trackable"


def test_fewshot_messages_are_user_assistant_pairs(local, monkeypatch, tmp_path):
    fake = tmp_path / "fewshot.json"
    fake.write_text(json.dumps([
        {"segment_id": "ex1", "segment_text": "some segment text here", "source": {},
         "target": {"record_type": "CALL", "ticker": "NVDA", "quote": "some segment"}},
    ]), encoding="utf-8")
    monkeypatch.setattr(local_prompt_v2, "FEWSHOT_FILE", fake)
    msgs = local_prompt_v2._fewshot_messages()
    assert len(msgs) == 2
    assert msgs[0]["role"] == "user"
    assert msgs[1]["role"] == "assistant"
    parsed = json.loads(msgs[1]["content"])
    assert parsed["records"][0]["quote"] == "some segment"


def test_no_fewshot_file_means_no_fewshot_messages_not_a_crash(local, monkeypatch, tmp_path):
    monkeypatch.setattr(local_prompt_v2, "FEWSHOT_FILE", tmp_path / "missing.json")
    assert local_prompt_v2._fewshot_messages() == []
