"""P4a Task 3 -- the server half of the `journal_page_layout` preference.

A member's page layout (which panels the Journal's Today page and the trade page show, and in what
order) is one JSON blob under one preference key. The client model is
`app/src/pages/journal-2-0/lib/pageLayouts.js`.

R-P4-7: the server checks the blob's SHAPE, never its panel ids. Panel ids are a client fact; a
server copy of the registry would be a second authority over one value, and an id a newer client
writes must survive an older server. So the bounds under test are the ones the client itself
exports, read from the JS source rather than retyped, and an unknown id is carried.

    * a JSON object, `version == 1`, at most 16 KB;
    * every list (`today.<phase>` and `trade`) holds at most 40 entries;
    * every entry is `{id: str of 1..40 characters, shown: bool}`.

Every refusal is a 400 with the same plain sentence, whatever the cause.
"""
import json
import os
import re

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.routers import auth as auth_router
from tests.authclients import PAID_MEMBER, authorize

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LAYOUTS_JS = os.path.join(REPO, "app", "src", "pages", "journal-2-0", "lib", "pageLayouts.js")
KEY = "journal_page_layout"
SENTENCE = "That page layout could not be saved. Reset it and try again."


def _js_const(name):
    with open(LAYOUTS_JS, encoding="utf-8") as fh:
        src = fh.read()
    m = re.search(r"export const " + name + r"\s*=\s*(\d+)\b", src)
    assert m, f"{name} not found in pageLayouts.js -- the read is broken"
    return int(m.group(1))


@pytest.fixture(scope="module")
def client():
    from api.services import auth_db

    auth_db.init_db()
    app = FastAPI()
    app.include_router(auth_router.router)
    authorize(app, PAID_MEMBER)
    return TestClient(app)


def _post(client, value):
    return client.post("/api/auth/preferences", json={"key": KEY, "value": value})


def _entry(i=0, shown=True):
    return {"id": f"panel{i}", "shown": shown}


def _layout(**over):
    base = {
        "version": 1,
        "today": {
            "premarket": [_entry(1), _entry(2, False)],
            "market": [_entry(1), _entry(2), _entry(3, False)],
            "postclose": [_entry(1)],
        },
        "trade": [_entry(1), _entry(2, False)],
    }
    base.update(over)
    return base


def test_the_key_is_a_named_schema_not_opaque():
    assert auth_router._PREFERENCE_KEYS[KEY] == KEY
    assert auth_router._PREFERENCE_KEYS[KEY] != auth_router._PREF_OPAQUE


def test_the_server_bounds_ARE_the_clients_bounds():
    """One number on each side, pinned equal: a layout the client writes is never a 400, and a value
    the client cannot produce is refused."""
    assert auth_router._PAGE_LAYOUT_VERSION == _js_const("LAYOUT_VERSION")
    assert auth_router._PAGE_LAYOUT_MAX_ENTRIES == _js_const("LAYOUT_MAX_ENTRIES")
    assert auth_router._PAGE_LAYOUT_ID_MAX == _js_const("LAYOUT_MAX_ID_LENGTH")
    assert auth_router._PAGE_LAYOUT_MAX_BYTES == _js_const("LAYOUT_MAX_BYTES")
    assert _js_const("LAYOUT_MAX_BYTES") == 16 * 1024


def test_a_valid_blob_is_stored_and_round_trips(client):
    value = json.dumps(_layout())
    resp = _post(client, value)
    assert resp.status_code == 200, resp.text
    assert client.get("/api/auth/preferences").json().get(KEY) == value


def test_the_smallest_valid_blob_and_the_cleared_write_are_accepted(client):
    assert _post(client, json.dumps({"version": 1})).status_code == 200
    assert _post(client, "").status_code == 200  # the client's "cleared" write


def test_a_full_list_of_forty_is_accepted(client):
    full = [_entry(i) for i in range(auth_router._PAGE_LAYOUT_MAX_ENTRIES)]
    assert _post(client, json.dumps(_layout(trade=full))).status_code == 200
    assert _post(client, json.dumps(_layout(today={"market": full}))).status_code == 200


def test_an_id_the_server_has_never_heard_of_is_carried(client):
    """R-P4-7: ids are a client fact. A panel a newer build adds must survive an older server."""
    value = json.dumps(_layout(trade=[{"id": "aPanelFromTheFuture", "shown": True}, _entry(1)]))
    assert _post(client, value).status_code == 200
    assert client.get("/api/auth/preferences").json().get(KEY) == value


def test_an_unknown_phase_and_an_unknown_top_level_field_are_carried(client):
    value = json.dumps(_layout(futureField={"x": 1}, today={"market": [_entry(1)], "overnight": [_entry(2)]}))
    assert _post(client, value).status_code == 200


@pytest.mark.parametrize("value,why", [pytest.param(v, w, id=w) for v, w in [
    ("[]", "an array, not an object"),
    ('"x"', "a string"),
    ("not json", "not JSON"),
    ('{"version": 2}', "the wrong version"),
    ('{"version": "1"}', "version is a string"),
    ("{}", "no version"),
    (json.dumps(_layout(today="x")), "today is not an object"),
    (json.dumps(_layout(today=[])), "today is an array"),
    (json.dumps(_layout(trade="x")), "trade is not a list"),
    (json.dumps(_layout(today={"market": {"id": "x", "shown": True}})), "a phase that is not a list"),
    (json.dumps(_layout(trade=["x"])), "an entry that is not an object"),
    (json.dumps(_layout(trade=[{"shown": True}])), "an entry with no id"),
    (json.dumps(_layout(trade=[{"id": "", "shown": True}])), "an empty id"),
    (json.dumps(_layout(trade=[{"id": 7, "shown": True}])), "a numeric id"),
    (json.dumps(_layout(trade=[{"id": "x" * 41, "shown": True}])), "an id over 40 characters"),
    (json.dumps(_layout(trade=[{"id": "x"}])), "an entry with no shown"),
    (json.dumps(_layout(trade=[{"id": "x", "shown": 1}])), "shown is a number"),
    (json.dumps({"version": 1, "today": {"market": [{"id": "x", "shown": "yes"}]}}), "shown is a string"),
    ('{"version": true}', "version is a boolean that equals 1 in Python"),
]])
def test_a_malformed_blob_is_refused_with_a_plain_sentence(client, value, why):
    resp = _post(client, value)
    assert resp.status_code == 400, why
    assert resp.json()["detail"] == SENTENCE, why


def test_a_blob_over_the_size_cap_is_refused(client):
    """An otherwise VALID blob padded past 16 KB through a field the server carries -- so only the
    size cap can be what refuses it."""
    ok = json.dumps(_layout(pad="x" * 1000))
    assert _post(client, ok).status_code == 200
    big = json.dumps(_layout(pad="x" * (17 * 1024)))
    assert len(big.encode("utf-8")) > 17 * 1024
    resp = _post(client, big)
    assert resp.status_code == 400
    assert resp.json()["detail"] == SENTENCE


def test_the_size_cap_is_measured_in_bytes_not_characters(client):
    """16 KB of multi-byte characters is more than 16 KB of storage."""
    pad = "é" * (auth_router._PAGE_LAYOUT_MAX_BYTES // 2)  # 2 bytes each => the pad alone fills the cap
    value = json.dumps(_layout(pad=pad), ensure_ascii=False)
    assert len(value) < auth_router._PAGE_LAYOUT_MAX_BYTES  # under in characters...
    assert len(value.encode("utf-8")) > auth_router._PAGE_LAYOUT_MAX_BYTES  # ...over in bytes
    assert _post(client, value).status_code == 400


def test_a_list_of_forty_one_entries_is_refused_wherever_it_sits(client):
    over = [_entry(i) for i in range(auth_router._PAGE_LAYOUT_MAX_ENTRIES + 1)]
    for blob in (_layout(trade=over), _layout(today={"market": over}), _layout(today={"overnight": over})):
        resp = _post(client, json.dumps(blob))
        assert resp.status_code == 400
        assert resp.json()["detail"] == SENTENCE


def test_a_refused_write_leaves_the_stored_layout_alone(client):
    good = json.dumps(_layout())
    assert _post(client, good).status_code == 200
    assert _post(client, '{"version": 2}').status_code == 400
    assert client.get("/api/auth/preferences").json().get(KEY) == good


# -- hostile input: every refusal is the one 400, never a 500 -------------------------------------

def _post_raw(client, value_json):
    """Post a hand-built body so `value_json` (JSON text) reaches the server exactly as written.
    A lone surrogate arrives as the JSON escape backslash-u-d800, which Python decodes to a str that cannot
    be encoded as UTF-8 -- the shape a normal client library never sends."""
    body = '{"key": "%s", "value": %s}' % (KEY, value_json)
    return client.post(
        "/api/auth/preferences", content=body.encode("ascii"), headers={"Content-Type": "application/json"}
    )


@pytest.mark.parametrize("value_json", [
    pytest.param('"\\ud800"', id="a lone high surrogate as the whole value"),
    pytest.param('"\\udfff"', id="a lone low surrogate as the whole value"),
    pytest.param('"{\\"version\\":1,\\"x\\":\\"\\ud800\\"}"', id="a lone surrogate inside a carried field"),
])
def test_a_lone_surrogate_is_a_400_not_a_500(client, value_json):
    resp = _post_raw(client, value_json)
    assert resp.status_code == 400, resp.text
    assert resp.json()["detail"] == SENTENCE


@pytest.mark.parametrize("raw", ["\ud800", '{"version":1,"x":"\ud800"}'])
def test_the_validator_itself_answers_a_surrogate_with_the_400(raw):
    from fastapi import HTTPException

    with pytest.raises(HTTPException) as exc:
        auth_router._validate_page_layout(raw)
    assert exc.value.status_code == 400 and exc.value.detail == SENTENCE


def _nested_array(depth):
    return "[" * depth + "]" * depth


def test_deep_nesting_is_a_400_on_every_python_version(client):
    deep_array = _nested_array(8000)  # 16,000 bytes: under the size cap, so only depth can refuse it
    assert len(deep_array) < auth_router._PAGE_LAYOUT_MAX_BYTES
    for value in (deep_array, '{"version": 1, "x": ' + _nested_array(7000) + "}"):
        resp = _post(client, value)
        assert resp.status_code == 400, resp.text
        assert resp.json()["detail"] == SENTENCE


def _nested_object(extra_levels):
    v = 1
    for _ in range(extra_levels):
        v = {"a": v}
    return {"version": 1, "x": v}  # the top object is level 1


def test_nesting_deeper_than_eight_levels_is_refused_and_eight_is_accepted(client):
    assert auth_router._PAGE_LAYOUT_MAX_DEPTH == 8
    assert _post(client, json.dumps(_nested_object(7))).status_code == 200  # 8 levels
    resp = _post(client, json.dumps(_nested_object(8)))  # 9 levels
    assert resp.status_code == 400
    assert resp.json()["detail"] == SENTENCE


def test_a_real_layout_is_well_inside_the_depth_limit(client):
    assert _post(client, json.dumps(_layout())).status_code == 200  # object > today > list > entry
    assert _post(client, json.dumps({"version": 1, "trade": [{"id": "a", "shown": True}]})).status_code == 200


def test_a_recursion_error_from_the_parser_is_a_400(monkeypatch):
    """On Python 3.12 the C scanner raises RecursionError at ~1,000 levels, while 3.14 parses 8,000.
    Simulate the 3.12 behaviour directly: the validator must turn it into the one 400."""
    from fastapi import HTTPException

    def boom(*a, **k):
        raise RecursionError("maximum recursion depth exceeded")

    monkeypatch.setattr(auth_router.json, "loads", boom)
    with pytest.raises(HTTPException) as exc:
        auth_router._validate_page_layout('{"version": 1}')
    assert exc.value.status_code == 400 and exc.value.detail == SENTENCE


@pytest.mark.parametrize("constant", ["NaN", "Infinity", "-Infinity"])
def test_a_non_finite_number_is_refused(client, constant):
    resp = _post(client, '{"version": 1, "x": %s}' % constant)
    assert resp.status_code == 400
    assert resp.json()["detail"] == SENTENCE
