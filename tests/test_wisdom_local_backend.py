"""R85/R86/R87 — the local extraction backend, and the structural claim that it cannot spend.

⛔⛔ WHAT THIS FILE HAS TO BE ABLE TO SAY RED FOR
1. the DEFAULT drifting to local — a variable nobody set must never move extraction onto a
   different model, because the record would carry a version nobody chose;
2. the local path importing the paid SDK, or reading an API key, at all;
3. a local run sharing an extractor_version with a paid one — which would make
   `reconcile.score_silently` compare two MODELS as if they were repeat passes of one, and call
   the disagreement instability;
4. the paid extractor_version changing — `wx-v0-fc47bc97` is pinned in production's accepted
   golden-gate row, so a change there shuts the extractor;
5. the backend pointing anywhere but loopback, which would make "$0" untrue without touching
   another line.
"""
from __future__ import annotations

import json
import pathlib
import sys

import pytest

REPO = pathlib.Path(__file__).resolve().parents[1]
if str(REPO) not in sys.path:
    sys.path.insert(0, str(REPO))

from api.services.wisdom.extract import batch, config, local_backend, prompt  # noqa: E402

PAID_VERSION = "wx-v0-fc47bc97"


@pytest.fixture
def local(monkeypatch, tmp_path):
    monkeypatch.setenv(config.BACKEND_ENV, "local")
    monkeypatch.setenv(local_backend.MODEL_ENV, "qwen2.5-7b-instruct-q4")
    monkeypatch.setenv(local_backend.JOBS_ENV, str(tmp_path / "jobs"))
    monkeypatch.delenv(local_backend.URL_ENV, raising=False)
    return tmp_path


# ── 1. the default never drifts ──────────────────────────────────────────────

@pytest.mark.parametrize("value", [None, "", "  ", "paid", "PAID", "1", "true", "yes",
                                   "locally", "remote", "anything"])
def test_anything_that_is_not_local_selects_PAID(monkeypatch, value):
    """⛔ An unknown value is not a third mode. It resolves to PAID, which is the default
    nobody has to set.

    ⭐ WHY THIS IS NORMALISED (strip+lower) AND THE SPEND ACCEPTANCE IS NOT. R52's
    acceptance literal is exact and case-sensitive because a switch you can satisfy with `=1` is
    a switch somebody sets while meaning something else - and that one AUTHORISES SPEND. This
    selects a MODE whose non-default is the free one, so the risk is asymmetric the other way:
    a typo that lands on local costs nothing, while the expensive value is the default that
    needs no typing at all. `"Local "` therefore DOES select local, deliberately."""
    if value is None:
        monkeypatch.delenv(config.BACKEND_ENV, raising=False)
    else:
        monkeypatch.setenv(config.BACKEND_ENV, value)
    assert config.backend() == config.BACKEND_PAID
    assert config.is_local() is False


@pytest.mark.parametrize("value", ["local", "Local ", " LOCAL", "  local  "])
def test_local_is_normalised_not_exact(monkeypatch, value):
    monkeypatch.setenv(config.BACKEND_ENV, value)
    assert config.is_local() is True


def test_CONTROL_the_literal_local_does_select_it(monkeypatch):
    """⭐ Without this, every assertion above passes against a function that always says paid."""
    monkeypatch.setenv(config.BACKEND_ENV, "local")
    assert config.is_local() is True


# ── 2. the local path never reaches the paid SDK ─────────────────────────────

def test_the_local_client_is_built_without_importing_the_paid_sdk(local, monkeypatch):
    """⛔⛔ THE LOAD-BEARING ONE. Not 'it did not spend' — it cannot: the branch in make_client
    is above every line that reads a key or imports anthropic."""
    monkeypatch.delitem(sys.modules, "anthropic", raising=False)
    client = batch.make_client()
    assert getattr(client, "is_local_backend", False) is True
    assert "anthropic" not in sys.modules


def test_the_local_client_needs_no_api_key(local, monkeypatch):
    """A local run must work on a machine that has never held a key."""
    for name in getattr(batch, "KEY_VARS", ()):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setattr(batch, "key_from_keyring", lambda *a, **k: None, raising=False)
    assert getattr(batch.make_client(), "is_local_backend", False) is True


def test_the_local_client_reports_zero_cost(local):
    assert batch.make_client().cost_usd == 0.0


# ── 3 and 4. versions cannot collide, and paid cannot move ───────────────────

def test_a_local_run_carries_a_DIFFERENT_extractor_version(local):
    v = prompt.extractor_version()
    assert v.startswith("wx-local-")
    assert v != PAID_VERSION


def test_the_PAID_extractor_version_is_unchanged(monkeypatch):
    """⛔ wx-v0-fc47bc97 is pinned in production's accepted golden-gate row. If this test goes
    red, extraction in production is about to be refused with blocked_by_gate."""
    monkeypatch.delenv(config.BACKEND_ENV, raising=False)
    assert prompt.extractor_version() == PAID_VERSION


def test_two_different_local_models_do_not_share_a_version(local, monkeypatch):
    monkeypatch.setenv(local_backend.MODEL_ENV, "qwen2.5-7b-instruct-q4")
    a = prompt.extractor_version()
    monkeypatch.setenv(local_backend.MODEL_ENV, "llama-3.1-8b-instruct-q4")
    b = prompt.extractor_version()
    assert a != b, "two models sharing a version would reconcile as repeat passes of one"


# ── 5. loopback only ─────────────────────────────────────────────────────────

@pytest.mark.parametrize("url", ["http://10.0.0.5:8080/v1/chat/completions",
                                 "https://api.example.com/v1/chat/completions",
                                 "http://some-host:8080/v1/chat/completions"])
def test_a_non_loopback_url_is_refused(local, monkeypatch, url):
    monkeypatch.setenv(local_backend.URL_ENV, url)
    with pytest.raises(local_backend.NotLoopback):
        local_backend.make_local_client()


@pytest.mark.parametrize("url", ["http://127.0.0.1:8080/v1/chat/completions",
                                 "http://localhost:9090/v1/chat/completions"])
def test_CONTROL_loopback_is_accepted(local, monkeypatch, url):
    monkeypatch.setenv(local_backend.URL_ENV, url)
    assert local_backend.make_local_client() is not None


# ── the batch emulation ──────────────────────────────────────────────────────

def _req(cid, text="hello"):
    return {"custom_id": cid,
            "params": {"model": "m", "system": "S", "max_tokens": 64,
                       "messages": [{"role": "user", "content": text}]}}


def test_a_batch_is_a_directory_and_a_second_create_RESUMES(local, monkeypatch):
    """⭐ The property a corpus run depends on: a kill loses the request in flight and nothing
    else. Without it, hours of completed work die with one OOM."""
    calls = []

    def fake_run_one(params):
        calls.append(params)
        return local_backend._Message(
            content=[local_backend._Block("text", json.dumps({"records": []}))],
            stop_reason="end_turn",
            usage=local_backend._Usage(input_tokens=10, output_tokens=5))

    monkeypatch.setattr(local_backend, "run_one", fake_run_one)
    batches = local_backend.LocalBatches(local / "jobs")
    b = batches.create([_req("a"), _req("b"), _req("c")])
    assert b.processing_status == "ended"
    assert len(calls) == 3
    assert len(list(batches.results(b.id))) == 3

    # re-processing the same batch must call the model for NOTHING already done
    calls.clear()
    batches._process(b.id)
    assert calls == [], "a resumed batch must not re-run completed requests"


def test_a_SECOND_CREATE_with_the_same_requests_resumes_instead_of_restarting(local, monkeypatch):
    """⛔⛔ THE ONE THAT WAS MISSING, AND IT COST A RUN. The test above proved `_process`
    resumes — but the gate never calls `_process`, it calls `create`. With a clock-derived id
    every re-invocation opened a NEW directory, so the resume was real and unreachable.

    ⚰️ Measured 2026-09-17: an OOM killed a golden run at 12 of 83 segments. Twelve correct
    results sat on disk and a fresh run would have re-extracted all 83.
    ⭐ This is `lesson_a_guard_that_tests_the_adjacent_thing`: the old rail asserted resumption
    of the function nobody calls, one layer below the entry point that needed it."""
    calls = []

    def fake_run_one(params):
        calls.append(params)
        return local_backend._Message(
            content=[local_backend._Block("text", json.dumps({"records": []}))],
            stop_reason="end_turn",
            usage=local_backend._Usage(input_tokens=10, output_tokens=5))

    monkeypatch.setattr(local_backend, "run_one", fake_run_one)
    batches = local_backend.LocalBatches(local / "jobs")
    reqs = [_req("a"), _req("b"), _req("c")]

    first = batches.create(reqs)
    assert len(calls) == 3

    calls.clear()
    second = batches.create(list(reqs))
    assert second.id == first.id, "identical requests must land on the same batch directory"
    assert calls == [], "a second create of the same work must re-run nothing"
    assert len(list(batches.results(first.id))) == 3


def test_requests_differing_only_in_KEY_ORDER_share_a_batch(local, monkeypatch):
    """⛔⛔ THE BUG THAT A CONTENT DIFF CANNOT SEE, and it defeated the first version of the
    resume fix within one run.

    ⚰️ Measured 2026-09-17: two invocations built 83 requests that compared EQUAL as parsed
    JSON — 0 of 83 differing — and hashed to two different digests, because `json.dumps`
    preserves dict INSERTION order and the two runs happened to build a dict differently. The
    resume opened a second directory and began re-extracting all 83 with 12 good results
    already on disk.

    ⭐ The id must key on what a request MEANS, not on how a process ordered a dict. That is
    why the digest is canonical (`sort_keys=True`) and why this rail asserts on ORDER rather
    than on content — a content assertion passes against the broken version."""
    monkeypatch.setattr(local_backend, "run_one", lambda params: local_backend._Message(
        content=[local_backend._Block("text", "{}")], stop_reason="end_turn",
        usage=local_backend._Usage(input_tokens=1, output_tokens=1)))
    batches = local_backend.LocalBatches(local / "jobs")

    a = batches.create([{"custom_id": "a",
                         "params": {"model": "m", "system": "S", "max_tokens": 64,
                                    "messages": [{"role": "user", "content": "hi"}]}}])
    b = batches.create([{"custom_id": "a",
                         "params": {"messages": [{"role": "user", "content": "hi"}],
                                    "max_tokens": 64, "system": "S", "model": "m"}}])
    assert a.id == b.id, "the same request with keys in another order must resume, not restart"


def test_DIFFERENT_requests_never_share_a_batch(local, monkeypatch):
    """⛔ The other direction, and the dangerous one: a changed prompt/model/segment must NOT
    inherit a previous extractor's answers. If it did, a run would silently report results it
    never produced."""
    monkeypatch.setattr(local_backend, "run_one", lambda params: local_backend._Message(
        content=[local_backend._Block("text", "{}")], stop_reason="end_turn",
        usage=local_backend._Usage(input_tokens=1, output_tokens=1)))
    batches = local_backend.LocalBatches(local / "jobs")
    a = batches.create([_req("a", text="one")])
    b = batches.create([_req("a", text="two")])
    assert a.id != b.id, "different request bodies must not collide onto one directory"


def test_a_failing_request_is_recorded_not_raised(local, monkeypatch):
    """⛔ One unreachable moment must not lose the batch. It is an errored item, counted."""
    def boom(params):
        raise local_backend.LocalBackendUnavailable("connection refused")

    monkeypatch.setattr(local_backend, "run_one", boom)
    batches = local_backend.LocalBatches(local / "jobs")
    b = batches.create([_req("a")])
    items = list(batches.results(b.id))
    assert len(items) == 1 and items[0].result.type == "errored"


# ── the runaway ceiling ──────────────────────────────────────────────────────

def test_a_runaway_generation_is_capped(local):
    """⚰️ Measured 2026-09-17: three slots sat at n_gen 2055 and climbing at 3.87 tok/s while
    the run made no progress for seven minutes. The extractor asks for 32000 max_tokens, which
    is sane against the paid model; unbounded, a local runaway burns ~12 minutes and THEN fails
    as truncated JSON anyway."""
    chat = local_backend._params_to_chat(
        {"model": "m", "system": "S", "max_tokens": 32000,
         "messages": [{"role": "user", "content": "hi"}]})
    assert chat["max_tokens"] == local_backend.DEFAULT_MAX_OUTPUT


def test_the_cap_only_ever_LOWERS(local):
    """⛔ A caller asking for less than the ceiling is asking for less on purpose. A bare
    assignment would silently RAISE it, which is the opposite of a cap."""
    chat = local_backend._params_to_chat(
        {"model": "m", "system": "S", "max_tokens": 64,
         "messages": [{"role": "user", "content": "hi"}]})
    assert chat["max_tokens"] == 64


def test_the_ceiling_does_not_clip_a_real_extraction(local):
    """⭐ The cap must separate 'runaway' from 'verbose but real'. The largest legitimate
    extraction measured over 13 good segments was 805 output tokens (p50 311, p90 753); a cap
    that clipped those would silently UNDERSTATE the model's quality — the same direction of
    error as the markdown fence, and just as invisible in the per-type table."""
    assert local_backend.DEFAULT_MAX_OUTPUT > 805


@pytest.mark.parametrize("raw, expect", [("2048", 2048), ("", 1536), ("  4096 ", 4096),
                                         ("nonsense", 1536), ("0", 1)])
def test_the_ceiling_is_env_overridable_and_never_absurd(local, monkeypatch, raw, expect):
    monkeypatch.setenv(local_backend.MAX_OUTPUT_ENV, raw)
    assert local_backend.max_output_tokens() == expect


# ── the model's own packaging ────────────────────────────────────────────────

def test_a_fenced_extraction_is_unwrapped():
    """⚰️ Measured on a 6-segment pilot: 1 of 3 completed extractions came back wrapped in a
    ```json fence and was scored `json_decode`, kept=0. It held four valid records — so the
    fence reads in the per-type table as the MODEL failing. This depresses a quality number
    instead of raising an error, which is why it is railed."""
    body = '{"segment_id": "abc", "records": []}'
    for fence in (f"```json\n{body}\n```", f"```JSON\n{body}\n```", f"```\n{body}\n```",
                  f"  ```json\n{body}\n```  "):
        assert json.loads(local_backend._unfence(fence)) == json.loads(body)


@pytest.mark.parametrize("text, why", [
    ('{"records": [], "note": "use ``` to fence"}', "a backtick INSIDE a valid document"),
    ('```json\n{"records": [', "TRUNCATED: no closing fence, must stay broken"),
    ('{"records": []}', "not fenced at all"),
    ('```json {"records": []} ```', "no newline after the opener"),
])
def test_unfence_leaves_everything_else_byte_identical(text, why):
    """⛔ The failure that matters is not 'a fence survived' — it is stripping something that was
    never a fence, which would corrupt a valid extraction or silently REPAIR a truncated one into
    a confident-looking result."""
    assert local_backend._unfence(text) == text, why


def test_CONTROL_unfence_actually_changes_a_fenced_string():
    """⭐ Without this, every 'unchanged' assertion above passes against a function that is the
    identity (`lesson_a_fixture_that_cannot_distinguish_is_not_a_rail`)."""
    fenced = '```json\n{"records": []}\n```'
    assert local_backend._unfence(fenced) != fenced


def test_count_tokens_needs_no_server_and_never_spends(local):
    c = batch.make_client()
    n = c.messages.count_tokens(model="m", system="a" * 300,
                                messages=[{"role": "user", "content": "b" * 300}],
                                output_config={})
    assert n.input_tokens > 0
