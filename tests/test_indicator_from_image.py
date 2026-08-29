"""THE PICTURE DOOR — what it may hand a member, and what it must refuse.

⛔⛔ THE CLAIM THIS FILE EXISTS TO PROVE. A hallucinated formula that RENDERS is
the worst possible output of this feature: the member sees a plausible curve, a
plausible name and a formula nobody validated. So the flagship case below plants
a model answer whose tree names a function the table does not declare, and
asserts three things at once — the candidate does not come back, the refusal
names the gate that DECIDED it (`schema:name`, the concierge's own, not one of
this module's), and NO FORMULA of any kind rides along with it.

⛔ NO TEST HERE TOUCHES THE REAL API. Every model answer is a stub, and the one
test that exercises the DEFAULT client asserts what it asked the shared factory
for rather than making a call.

⭐ AND THE FIXTURES ARE DERIVED, NEVER TYPED. The valid tree is found by SCANNING
the manifest for the first shape that clears the shipped validator — so this file
keeps working when the table grows, and `test_the_derived_fixture_is_not_vacuous`
fails loudly if the scan ever finds nothing rather than silently testing air.
"""
from __future__ import annotations

import ast as pyast
import copy
import json
import uuid
from pathlib import Path
from typing import Any, Dict, List, Mapping, Optional

import pytest
from fastapi.testclient import TestClient

from api.main import app
from api.routers import indicator_vision as route
from api.services import ast_table, definition_concierge as concierge
from api.services import indicator_from_image as svc
from api.services.auth_db import init_db as auth_init_db
from api.services.auth_service import create_session, create_user
from api.services.catalyst import cost_guard

TABLE = ast_table.TABLE
ENDPOINT = "/api/indicator-vision/candidates"

# A one-pixel PNG. The stub never looks at it; the door's size and type gates do.
PIXEL = (
    b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01"
    b"\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89"
    b"\x00\x00\x00\nIDATx\x9cc\x00\x01\x00\x00\x05\x00\x01"
    b"\r\n\xb4\x00\x00\x00\x00IEND\xaeB`\x82"
)


# ═══ derived fixtures ═══════════════════════════════════════════════════════

def _windowed_trees() -> List[dict]:
    """Every ``fn(<a bar field>, 20)`` the SHIPPED validator accepts, in manifest
    order.

    ⛔ MEASURED, NOT ASSUMED. `barssince` has the same declared ARG SHAPE as `ema`
    and refuses at `resolve:condition`, so a fixture picked by shape alone would
    have been a refusal masquerading as a happy path. Asking the validator is the
    only way to know which is which, and it is the same function the door uses.
    """
    field = sorted(TABLE[ast_table.SERIES_SECTION])[0]
    out = []
    for name in sorted(TABLE[ast_table.FUNCTIONS_SECTION]):
        spec = TABLE[ast_table.FUNCTIONS_SECTION][name]
        if [str(a) for a in (spec.get("args") or ())] != ["series", "int"]:
            continue
        tree = {"type": "call", "name": name, "args": [
            {"type": "series", "name": field}, {"type": "num", "value": 20}]}
        try:
            concierge._validate(tree, [], concierge.INDICATOR_KIND)
        except Exception:            # noqa: BLE001 — this IS the measurement
            continue
        out.append(tree)
    return out


TREES = _windowed_trees()
#: A tree the table cannot resolve. Built from a name the manifest does not
#: declare, so it stays hallucinated however the table grows.
HALLUCINATED = {"type": "call", "name": "zzLuxAlgoSecretSauce", "args": [
    {"type": "series", "name": sorted(TABLE[ast_table.SERIES_SECTION])[0]},
    {"type": "num", "value": 14}]}


def test_the_derived_fixture_is_not_vacuous():
    """⛔ A fixture that found nothing would make every case below pass by
    iterating zero times — `lesson_a_fixture_that_cannot_distinguish`."""
    assert len(TREES) >= 2, (
        "the manifest no longer declares two windowed functions this validator "
        "accepts; every case below is testing nothing")
    assert "zzLuxAlgoSecretSauce" not in TABLE[ast_table.FUNCTIONS_SECTION]


# ═══ the stub model ═════════════════════════════════════════════════════════

class _Block:
    def __init__(self, **kw):
        for k, v in kw.items():
            setattr(self, k, v)


class _Usage:
    def __init__(self, i=1200, o=300):
        self.input_tokens = i
        self.output_tokens = o


class _Msg:
    def __init__(self, content):
        self.content = content
        self.usage = _Usage()


class StubClient:
    """One canned answer, and a record of what it was asked.

    ⭐ IT RECORDS THE SYSTEM PROMPT AND THE TOOL, because two of the claims in
    this file are about what the model was TOLD — that the vocabulary is the
    concierge's own, and that the tool it was handed enumerates the table.
    """

    def __init__(self, payload: Optional[Dict[str, Any]] = None, *,
                 text: Optional[str] = None, raises: Optional[Exception] = None,
                 tool_name: Optional[str] = None):
        self.payload = payload
        self.text = text
        self.raises = raises
        self.tool_name = tool_name or svc.TOOL_NAME
        self.calls: List[dict] = []
        self.messages = self

    def create(self, **kwargs):
        self.calls.append(kwargs)
        if self.raises is not None:
            raise self.raises
        if self.text is not None:
            return _Msg([_Block(type="text", text=self.text)])
        return _Msg([_Block(type="tool_use", name=self.tool_name,
                            input=self.payload)])

    # `_default_client` calls `.with_options(...)` on the shared client; a stub
    # handed in directly is used as-is, so this only matters for the factory test.
    def with_options(self, **kwargs):
        self.options = kwargs
        return self


def answer(*candidates: dict, saw: str = "an oscillator bounded 0-100") -> dict:
    return {"saw": saw, "candidates": list(candidates)}


def candidate(tree: dict, *, confidence: int = 70, label: str = "RSI(14)",
              saw: str = "guide lines at 30 and 70") -> dict:
    return {"ast": tree, "confidence": confidence, "label": label, "saw": saw}


@pytest.fixture(autouse=True)
def ledger(monkeypatch):
    """The cost guard, stubbed but OBSERVABLE.

    ⚠️ NOT SILENCED. Two cases assert the guard was consulted BEFORE the model and
    that the spend was recorded AFTER it, so the recorder is the instrument rather
    than a way to keep the real ledger out of a test database.
    """
    calls = {"checked": [], "recorded": []}
    monkeypatch.setattr(cost_guard, "may_synthesize",
                        lambda d: (calls["checked"].append(d), True)[1])
    monkeypatch.setattr(cost_guard, "record",
                        lambda *a, **k: (calls["recorded"].append((a, k)), 0.0125)[1])
    return calls


# ═══ 1. THE FLAGSHIP: A HALLUCINATION NEVER REACHES A MEMBER ════════════════

def test_a_candidate_the_TABLE_CANNOT_RESOLVE_is_refused_and_carries_NO_FORMULA():
    """⛔⛔ THE WHOLE POINT OF THE FEATURE'S SAFETY. The model 'recognised' a
    proprietary indicator and emitted a tree naming a function that does not
    exist. It must not come back as a formula, and the refusal must name the
    CONCIERGE'S gate — the door that actually decided — not one of this module's.
    """
    client = StubClient(answer(candidate(HALLUCINATED, label="LuxAlgo Trend")))
    out = svc.candidates_from_image(image_bytes=PIXEL, media_type="image/png",
                                    user_id="u1", client=client)

    assert out["ok"] is False
    assert out["gate"] == "vision:no-candidate"
    assert "candidates" not in out, (
        "a refusal carried a candidates list — a formula beside a refusal is a "
        "formula somebody uses")

    assert len(out["refused"]) == 1
    row = out["refused"][0]
    assert row["gate"] == "schema:name", (
        "the refusal must be attributed to the door that decided; a gate of this "
        "module's own would mean the shared validator was bypassed")
    assert row["gate"] not in svc.REFUSALS
    # ⛔ NOTHING FORMULA-SHAPED SURVIVES. Not the tree, not a source string, not a
    # read-back — checked by KEY so a future field cannot smuggle one back.
    assert set(row) == {"label", "saw", "confidence", "gate", "reason"}
    # ⚠️ THE REFUSAL SENTENCE MAY NAME THE OFFENDING WORD — that is the concierge's
    # own English and it is how a member learns what went wrong. What must not
    # survive is anything a caller could RENDER: no tree, no source, no read-back.
    assert not any(isinstance(v, (dict, list)) for v in row.values())
    assert concierge.REFUSALS["schema:name"] in row["reason"]
    # …and what the model saw is still reported, because a member who is told
    # only "no" cannot tell whether the picture or the formula was the problem.
    assert out["saw"] == "an oscillator bounded 0-100"


def test_a_tree_that_is_not_a_tree_at_all_is_refused_by_SHAPE():
    client = StubClient(answer(candidate({"type": "potato"})))
    out = svc.candidates_from_image(image_bytes=PIXEL, media_type="image/png",
                                    user_id="u1", client=client)
    assert out["ok"] is False
    assert out["refused"][0]["gate"] == "schema:node"


def test_a_tree_with_the_WRONG_ARITY_is_refused_by_the_TABLE():
    """⭐ THE SHAPE THE SCHEMA CANNOT EXPRESS. A JSON Schema enum says which names
    exist and cannot say how many arguments each takes, so this one gets through
    the boundary and is refused by the table — under `resolve:arity`, its own
    door. That the gate travels out whole is the property being asserted."""
    short = copy.deepcopy(TREES[0])
    short["args"] = short["args"][:1]
    client = StubClient(answer(candidate(short)))
    out = svc.candidates_from_image(image_bytes=PIXEL, media_type="image/png",
                                    user_id="u1", client=client)
    assert out["refused"][0]["gate"] == "resolve:arity"


def test_ONE_BAD_CANDIDATE_does_not_take_the_good_one_down():
    """⭐ THE RANKED-LIST PROPERTY. A candidate generator that refused the whole
    answer because one guess was wrong would be a one-shot oracle with extra
    steps."""
    client = StubClient(answer(candidate(HALLUCINATED, confidence=90),
                               candidate(TREES[0], confidence=60)))
    out = svc.candidates_from_image(image_bytes=PIXEL, media_type="image/png",
                                    user_id="u1", client=client)
    assert out["ok"] is True
    assert len(out["candidates"]) == 1
    assert len(out["refused"]) == 1
    assert out["candidates"][0]["ast"] == TREES[0]


# ═══ 2. WHAT AN ACCEPTED CANDIDATE CARRIES ═════════════════════════════════

def test_the_source_and_the_READ_BACK_are_the_TREES_never_the_models():
    """⛔ THE MODEL MAY DESCRIBE THE PICTURE AND MAY NOT DESCRIBE THE MATHS. Both
    strings are asserted against the modules that own them, so a version that let
    the model author either one fails here."""
    client = StubClient(answer(candidate(TREES[0])))
    out = svc.candidates_from_image(image_bytes=PIXEL, media_type="image/png",
                                    user_id="u1", client=client)
    assert out["ok"] is True
    row = out["candidates"][0]
    assert row["source"] == concierge.formula_for(TREES[0])
    assert row["sentence"] == concierge.sentence_for(TREES[0])
    assert row["repaint"] == "non-repainting"
    assert row["rank"] == 1
    # the model's own prose survives, labelled as the observation it is
    assert row["label"] == "RSI(14)"
    assert row["saw"] == "guide lines at 30 and 70"
    assert row["confidence"] == 70
    assert out["kind"] == concierge.INDICATOR_KIND


def test_candidates_are_RANKED_by_confidence_and_the_ranks_are_dense():
    client = StubClient(answer(candidate(TREES[0], confidence=20, label="low"),
                               candidate(TREES[1], confidence=95, label="high")))
    out = svc.candidates_from_image(image_bytes=PIXEL, media_type="image/png",
                                    user_id="u1", client=client)
    assert [c["label"] for c in out["candidates"]] == ["high", "low"]
    assert [c["rank"] for c in out["candidates"]] == [1, 2]


def test_an_unreadable_confidence_becomes_ZERO_not_a_flattering_default():
    client = StubClient(answer(candidate(TREES[0], confidence="very sure")))
    out = svc.candidates_from_image(image_bytes=PIXEL, media_type="image/png",
                                    user_id="u1", client=client)
    assert out["candidates"][0]["confidence"] == 0


def test_model_prose_is_BOUNDED():
    client = StubClient(answer(candidate(TREES[0], label="x" * 500,
                                         saw="y" * 5000)))
    out = svc.candidates_from_image(image_bytes=PIXEL, media_type="image/png",
                                    user_id="u1", client=client)
    row = out["candidates"][0]
    assert len(row["label"]) == svc.LABEL_MAX
    assert len(row["saw"]) == svc.SAW_MAX


def test_an_EMPTY_candidate_list_is_a_legitimate_answer_that_still_says_what_it_saw():
    """⭐ 'I looked and I cannot justify a formula' is a real answer to a picture
    of a proprietary study, and a door that demanded a guess would manufacture the
    confident wrong answer this whole feature is shaped to avoid."""
    client = StubClient(answer(saw="a shaded band with no axis and no legend"))
    out = svc.candidates_from_image(image_bytes=PIXEL, media_type="image/png",
                                    user_id="u1", client=client)
    assert out["ok"] is False
    assert out["gate"] == "vision:no-candidate"
    assert out["saw"] == "a shaded band with no axis and no legend"
    assert out["refused"] == []


def test_more_candidates_than_the_ceiling_are_TRUNCATED(monkeypatch):
    monkeypatch.setenv("INDICATOR_VISION_CANDIDATES", "2")
    client = StubClient(answer(*[candidate(TREES[i % len(TREES)], confidence=50 + i)
                                 for i in range(5)]))
    out = svc.candidates_from_image(image_bytes=PIXEL, media_type="image/png",
                                    user_id="u1", client=client)
    assert len(out["candidates"]) == 2
    assert client.calls[0]["tools"][0]["input_schema"]["properties"]["candidates"]["maxItems"] == 2


# ═══ 3. THE IMAGE ITSELF ═══════════════════════════════════════════════════

@pytest.mark.parametrize("kwargs,gate", [
    ({"image_bytes": b"", "media_type": "image/png"}, "vision:no-image"),
    ({"image_bytes": PIXEL, "media_type": "application/pdf"}, "vision:image-type"),
    ({"image_bytes": b"x" * (svc.MAX_IMAGE_BYTES + 1), "media_type": "image/png"},
     "vision:image-too-large"),
])
def test_an_unreadable_upload_is_refused_BEFORE_a_token_is_spent(kwargs, gate, ledger):
    client = StubClient(raises=AssertionError("the model must not be called"))
    out = svc.candidates_from_image(user_id="u1", client=client, **kwargs)
    assert out["ok"] is False and out["gate"] == gate
    assert out["reason"].startswith(svc.REFUSALS[gate])
    assert client.calls == []
    assert ledger["recorded"] == []


# ═══ 4. THE MODEL CALL: BOUNDED, LEDGERED, AND NEVER RAISING ═══════════════

def test_a_transport_failure_is_a_REFUSAL_not_an_exception():
    client = StubClient(raises=RuntimeError("connection reset"))
    out = svc.candidates_from_image(image_bytes=PIXEL, media_type="image/png",
                                    user_id="u1", client=client)
    assert out == {"ok": False, "gate": "vision:transport",
                   "reason": svc.REFUSALS["vision:transport"]}


def test_a_reply_with_no_tool_call_refuses_by_name():
    client = StubClient(text="I think that is a moving average of some kind.")
    out = svc.candidates_from_image(image_bytes=PIXEL, media_type="image/png",
                                    user_id="u1", client=client)
    assert out["gate"] == "vision:no-tool"


def test_a_tool_object_wrapped_in_PROSE_is_still_recovered():
    """⚠️ THE SHIPPED BALANCED-BRACE SCANNER, not a second one. A good answer that
    arrived with a sentence in front of it is a good answer."""
    client = StubClient(text="Sure — here you go:\n"
                             + json.dumps(answer(candidate(TREES[0]))))
    out = svc.candidates_from_image(image_bytes=PIXEL, media_type="image/png",
                                    user_id="u1", client=client)
    assert out["ok"] is True


def test_the_SPEND_CAP_refuses_before_the_model_is_called(monkeypatch):
    monkeypatch.setattr(cost_guard, "may_synthesize", lambda d: False)
    client = StubClient(raises=AssertionError("the model must not be called"))
    out = svc.candidates_from_image(image_bytes=PIXEL, media_type="image/png",
                                    user_id="u1", client=client)
    assert out["gate"] == "vision:spend-cap"
    assert client.calls == []


def test_the_spend_is_RECORDED_even_when_the_answer_is_refused(ledger):
    """⛔ A LEDGER THAT ONLY COUNTS SUCCESSES IS A CAP THAT LEAKS. A refused reply
    is billed exactly like an accepted one."""
    client = StubClient(answer(candidate(HALLUCINATED)))
    out = svc.candidates_from_image(image_bytes=PIXEL, media_type="image/png",
                                    user_id="u42", client=client)
    assert out["ok"] is False
    assert len(ledger["recorded"]) == 1
    args, _ = ledger["recorded"][0]
    assert args[2] == svc.MODEL and args[3] == 1200 and args[4] == 300
    assert "u42" in args[1], "the ledger row must name the caller"


def test_the_default_client_is_the_SHARED_one_with_retries_OFF(monkeypatch):
    """⛔ NOT A PRIVATE `anthropic.Anthropic(...)`. The shared factory is where the
    60 s timeout lives; a private client is the LLM-NO-TIMEOUT class this repo has
    a census for. Retries are zeroed HERE, and this asserts the ask rather than
    trusting the comment."""
    from api.services import engine
    stub = StubClient(answer(candidate(TREES[0])))
    used = []
    monkeypatch.setattr(engine, "_get_anthropic_client",
                        lambda: (used.append(True), stub)[1])
    out = svc.candidates_from_image(image_bytes=PIXEL, media_type="image/png",
                                    user_id="u1")
    assert out["ok"] is True
    assert used == [True]
    assert stub.options == {"max_retries": svc.MAX_HTTP_RETRIES}
    assert svc.MAX_HTTP_RETRIES == 0, (
        "one billed attempt: a timed-out call has already generated tokens and "
        "reports no usage, so an SDK retry is spend the ledger counts as zero")


# ═══ 5. THE VOCABULARY IS THE CONCIERGE'S, DERIVED AND NEVER COPIED ════════

def test_the_prompt_carries_the_CONCIERGES_OWN_vocabulary_text():
    client = StubClient(answer(candidate(TREES[0])))
    svc.candidates_from_image(image_bytes=PIXEL, media_type="image/png",
                              user_id="u1", client=client)
    system = client.calls[0]["system"]
    assert concierge.vocabulary_text() in system, (
        "a second rendering of the vocabulary would drift from the manifest the "
        "day a function landed, silently")
    assert client.calls[0]["tool_choice"] == {"type": "tool", "name": svc.TOOL_NAME}
    assert client.calls[0]["max_tokens"] == svc.MAX_TOKENS


def test_the_PICTURE_survives_the_encoding_it_is_sent_in():
    """⚠️ A MIS-ENCODED IMAGE FAILS INVISIBLY. The API answers 400, this door
    reports `vision:transport`, and the member is told the reader could not be
    reached — a true sentence about the wrong thing. So the round trip is
    asserted: the bytes that go in are the bytes that come out."""
    import base64
    block = svc.user_turn(PIXEL, "image/png")[0]["content"][0]
    assert block["source"]["media_type"] == "image/png"
    assert base64.standard_b64decode(block["source"]["data"]) == PIXEL


def test_a_PLANTED_manifest_entry_reaches_BOTH_the_schema_and_the_prompt():
    """⭐ THE DERIVATION RAIL. A function planted in a synthetic manifest must come
    back by name in the tool the model is handed AND in the English it reads —
    with no edit to this file or to the module. That is what makes a new function
    light this door on the day it is declared."""
    # The shipped table is frozen one level down (`MappingProxyType`), so a plant
    # needs its own dictionaries — and a deep copy of it cannot even be taken.
    planted = {k: (dict(v) if isinstance(v, Mapping) else v) for k, v in TABLE.items()}
    planted[ast_table.FUNCTIONS_SECTION]["zzPlantedFn"] = {
        "args": ["series", "int"], "sentence": "the planted function"}
    schema = svc.tool_schema(planted)
    assert "zzPlantedFn" in schema["input_schema"]["$defs"]["call"]["properties"]["name"]["enum"]
    assert "zzPlantedFn" in svc.system_prompt(planted)
    assert "zzPlantedFn" not in svc.system_prompt()


def test_the_candidate_TREE_slot_is_the_concierges_node_reference():
    mine = svc.tool_schema()["input_schema"]
    theirs = concierge.tool_schema()["input_schema"]
    assert mine["properties"]["candidates"]["items"]["properties"]["ast"] == \
        theirs["properties"]["ast"]
    assert mine["$defs"] == theirs["$defs"]


def test_no_declared_FUNCTION_or_SERIES_name_is_a_string_constant_in_this_module():
    """⛔ THE ANTI-COPY SCAN, BY AST AND NEVER BY GREP — the concierge's rail,
    applied to its neighbour. A reader does not spell the names; a copy must."""
    src = Path(svc.__file__).read_text(encoding="utf-8")
    constants = {n.value for n in pyast.walk(pyast.parse(src))
                 if isinstance(n, pyast.Constant) and isinstance(n.value, str)}
    forbidden = (set(TABLE[ast_table.FUNCTIONS_SECTION])
                 | set(TABLE[ast_table.SERIES_SECTION]))
    assert not (constants & forbidden)

    # The positive control: the same walk over a synthetic hand-copy DOES find
    # them, so a broken scan cannot report a clean file.
    names = sorted(TABLE[ast_table.FUNCTIONS_SECTION])[:3]
    hand = pyast.parse("FUNCTIONS = [%s]" % ", ".join(repr(n) for n in names))
    found = {n.value for n in pyast.walk(hand)
             if isinstance(n, pyast.Constant) and isinstance(n.value, str)}
    assert found & forbidden == set(names)


def test_this_doors_gates_are_DISJOINT_from_every_other_doors():
    """⛔ TWO GATES SHARING A PHRASE let an assertion pass with the safety deleted.
    The concierge's names and this module's must not overlap in either direction.
    """
    assert not (set(svc.REFUSALS) & set(concierge.REFUSALS))
    assert not (set(svc.REFUSALS.values()) & set(concierge.REFUSALS.values()))


# ═══ 6. THE ROUTE ══════════════════════════════════════════════════════════

@pytest.fixture
def client():
    auth_init_db()
    route._calls.clear()
    return TestClient(app)


def _login(client, plan="pro"):
    user = create_user(f"iv_{uuid.uuid4()}@example.com", "password123")
    from api.services.auth_db import get_connection
    conn = get_connection()
    try:
        conn.execute(
            "INSERT INTO subscriptions (id, user_id, plan, status) "
            "VALUES (?, ?, ?, 'active')", (uuid.uuid4().hex, user["id"], plan))
        conn.commit()
    finally:
        conn.close()
    client.cookies.set("uct_session", create_session(user["id"]))
    return user["id"]


def _post(client, **extra):
    return client.post(ENDPOINT, files={"file": ("chart.png", PIXEL, "image/png")},
                       **extra)


def test_the_route_is_MOUNTED_even_though_the_flag_is_off(client, monkeypatch):
    """⛔ THE MOUNT IS UNCONDITIONAL. A flag that gated `include_router` would make
    this 405 — a route that exists in the source and not in the served app, which
    is the hardest possible thing to diagnose from outside."""
    monkeypatch.delenv("INDICATOR_VISION_ENABLED", raising=False)
    paths = {getattr(r, "path", None) for r in app.routes}
    assert ENDPOINT in paths

    _login(client)
    res = _post(client)
    assert res.status_code == 200, "an off flag must not look like a routing bug"
    body = res.json()
    assert body["ok"] is False and body["gate"] == "vision:disabled"
    assert "INDICATOR_VISION_ENABLED" in body["reason"]


def test_the_flag_is_OFF_BY_DEFAULT(monkeypatch):
    monkeypatch.delenv("INDICATOR_VISION_ENABLED", raising=False)
    assert svc.vision_enabled() is False
    monkeypatch.setenv("INDICATOR_VISION_ENABLED", "1")
    assert svc.vision_enabled() is True


def test_the_disabled_door_never_reaches_the_model(client, monkeypatch):
    monkeypatch.delenv("INDICATOR_VISION_ENABLED", raising=False)
    monkeypatch.setattr(svc, "_default_client",
                        lambda: pytest.fail("the model must not be called"))
    _login(client)
    assert _post(client).json()["gate"] == "vision:disabled"


def test_the_route_is_PAID(client, monkeypatch):
    monkeypatch.setenv("INDICATOR_VISION_ENABLED", "1")
    assert _post(client).status_code == 401           # nobody at all
    user = create_user(f"iv_free_{uuid.uuid4()}@example.com", "password123")
    client.cookies.set("uct_session", create_session(user["id"]))
    assert _post(client).status_code == 402           # a free account


def test_the_live_route_returns_RANKED_VALIDATED_candidates(client, monkeypatch):
    monkeypatch.setenv("INDICATOR_VISION_ENABLED", "1")
    stub = StubClient(answer(candidate(TREES[0], confidence=30, label="second"),
                             candidate(HALLUCINATED, confidence=99, label="junk"),
                             candidate(TREES[1], confidence=80, label="first")))
    monkeypatch.setattr(svc, "_default_client", lambda: stub)
    _login(client)

    body = _post(client, data={"note": "an oscillator under the price"}).json()
    assert body["ok"] is True
    assert [c["label"] for c in body["candidates"]] == ["first", "second"]
    assert [c["source"] for c in body["candidates"]] == [
        concierge.formula_for(TREES[1]), concierge.formula_for(TREES[0])]
    assert body["refused"][0]["gate"] == "schema:name"
    # ⛔ THE MEMBER'S NOTE REACHED THE *USER* TURN AND NOT THE SYSTEM PROMPT.
    # Untrusted text in `system` reads as the operator speaking; one turn down it
    # reads as the member, which is what it is.
    sent = stub.calls[0]
    assert "an oscillator under the price" in json.dumps(sent["messages"])
    assert "an oscillator under the price" not in sent["system"]


def test_a_malformed_bars_field_is_the_CALLERS_mistake_and_answers_400(client, monkeypatch):
    monkeypatch.setenv("INDICATOR_VISION_ENABLED", "1")
    monkeypatch.setattr(svc, "_default_client",
                        lambda: pytest.fail("the model must not be called"))
    _login(client)
    assert _post(client, data={"bars": "{not json"}).status_code == 400
    assert _post(client, data={"bars": json.dumps({"a": 1})}).status_code == 400


def test_the_bars_ceiling_is_the_CONCIERGE_ROUTES_own(client, monkeypatch):
    """⛔ ONE ANSWER TO 'how big may one request be'. Both doors feed the same
    compute stage; a second number here would drift the day one moved."""
    from api.routers.user_definitions import MAX_PROPOSE_BARS
    monkeypatch.setenv("INDICATOR_VISION_ENABLED", "1")
    _login(client)
    res = _post(client, data={"bars": json.dumps([{} for _ in range(MAX_PROPOSE_BARS + 1)])})
    assert res.status_code == 400
    assert str(MAX_PROPOSE_BARS) in res.json()["detail"]


def test_the_door_BOUNDS_how_many_pictures_one_member_may_send():
    """🔴 `require_paid` is a one-time yes/no; this call is billed per request and
    carries an image. Without a bound a paid session in a `while true` loop is an
    unmetered bill on the firm's key."""
    route._calls.clear()
    from fastapi import HTTPException
    for _ in range(route.VISION_MAX_PER_HOUR):
        route._charge("member-1")
    with pytest.raises(HTTPException) as exc:
        route._charge("member-1")
    assert exc.value.status_code == 429
    assert "Retry-After" in exc.value.headers
    # …and it is PER MEMBER, not a global throttle that would let one caller lock
    # everybody else out.
    route._charge("member-2")


def test_the_rate_limit_WINDOW_rolls_off():
    route._calls.clear()
    now = 1_000_000.0
    for _ in range(route.VISION_MAX_PER_HOUR):
        route._charge("member-3", now=now)
    route._charge("member-3", now=now + route._WINDOW_SECONDS + 1)
