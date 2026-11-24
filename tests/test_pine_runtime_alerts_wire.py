"""TRACK 6, AL2: the run's alert() record on the wire, through the Python client's ONE door.

The service (`services/pine_runtime/job.mjs`, `protocol.mjs`) answers a job under profile `alert` that names
`want: ["#alerts"]` with the run's record (AL1: `{fromBar: 0, events: [{bar, message, freq}], dropped}`) as JSON
text plus `alerts_sha256`. The fixture is the JS seal's own output (`services/pine_runtime/test/alerts.test.mjs`
holds the committed file equal to it), so this file decodes what the service really sends.

Mutation proof (run before calling these done):
    1. the client never decodes the record (alerts stays None)  -> test_the_served_record_decodes... RED
    2. the hash is not checked                                  -> test_a_record_that_does_not_verify... RED
    3. a record not asked for is accepted                       -> test_a_record_not_asked_for... RED
    4. the caller cache key drops the want                      -> test_the_caller_cache_key_names_the_want RED
"""
from __future__ import annotations

import json
import pathlib
import re

import pytest

from api.services import pine_runtime_client as prc
from api.services import pine_runtime_codec as codec

ROOT = pathlib.Path(__file__).resolve().parents[1]
FIXTURE = ROOT / "tests" / "fixtures" / "pine_runtime" / "al2_alerts_result.json"
PROTOCOL = ROOT / "services" / "pine_runtime" / "protocol.mjs"


def _js_const(name: str) -> str:
    found = re.findall(r"^export const " + name + r" = (?:'([^']+)'|(\d+))$", PROTOCOL.read_text(encoding="utf-8"), re.M)
    assert len(found) == 1, (name, found)
    return found[0][0] or found[0][1]


def test_the_codec_mirrors_the_service_declarations_exactly():
    assert codec.ALERTS_WANT == _js_const("ALERTS_WANT")
    assert codec.ALERTS_PROFILE == _js_const("ALERTS_PROFILE")
    assert codec.ALERTS_MAX_EVENTS == int(_js_const("ALERTS_MAX_EVENTS"))
    assert codec.ALERTS_MAX_MESSAGE == int(_js_const("ALERTS_MAX_MESSAGE"))
    assert codec.ALERTS_MAX_FREQ == int(_js_const("ALERTS_MAX_FREQ"))


def _fixture():
    return json.loads(FIXTURE.read_text(encoding="utf-8"))


def _decode(result, want=(codec.ALERTS_WANT,), n=None):
    fx = _fixture()
    client = prc.PineRuntimeClient(url="http://x", secret="s", identity=fx["identity"])
    job = prc.Job(job=fx["job"]["job"], ticker="SPY", tf="D", bars=[], want=tuple(want))
    try:
        return client._result(result, job, n or fx["job"]["n"])
    except prc._Refuse as e:
        return e


def test_the_served_record_decodes_and_verifies_through_the_one_door():
    fx = _fixture()
    res = _decode(dict(fx["result"]))
    assert isinstance(res, prc.JobResult), getattr(res, "sentence", res)
    assert res.status == "ok" and res.columns == {}
    assert res.alerts == json.loads(fx["result"]["alerts"])
    assert [(e["bar"], e["message"]) for e in res.alerts["events"]] == [(3, "hit"), (7, None)]
    assert res.refusal_for(codec.ALERTS_WANT) is None
    assert res.strategy is None
    assert codec.alerts_record_sha256(fx["result"]["alerts"]) == fx["result"]["alerts_sha256"]


def _resealed(r, text):
    r.update(alerts=text, alerts_sha256=codec.alerts_record_sha256(text))


@pytest.mark.parametrize("mutate,why", [
    (lambda r: r.update(alerts=r["alerts"].replace('"hit"', '"hut"')), "does not verify"),
    (lambda r: r.update(alerts_sha256="0" * 64), "does not verify"),
    (lambda r: r.pop("alerts_sha256"), "does not verify"),
    (lambda r: r.pop("alerts"), "does not verify"),
    (lambda r: _resealed(r, r["alerts"].replace('"bar":7', '"bar":12')), "names no bar"),
    (lambda r: _resealed(r, r["alerts"].replace('"fromBar":0', '"fromBar":1')), "does not start at bar 0"),
    (lambda r: _resealed(r, r["alerts"].replace('"dropped":0', '"dropped":-1')), "dropped is not a count"),
    (lambda r: _resealed(r, r["alerts"].replace('"hit"', '"' + "x" * 513 + '"')), "message is not null or a string"),
    (lambda r: _resealed(r, "[]"), "not {fromBar, events, dropped}"),
])
def test_a_record_that_does_not_verify_withholds_the_job_as_integrity(mutate, why):
    r = dict(_fixture()["result"])
    mutate(r)
    res = _decode(r)
    assert isinstance(res, prc._Refuse) and res.guard == prc.INTEGRITY, res
    assert why in res.sentence, res.sentence


def test_a_record_not_asked_for_and_a_record_both_served_and_refused_are_integrity():
    fx = _fixture()
    assert "not asked for" in _decode(dict(fx["result"]), want=()).sentence
    both = dict(fx["result"], refusals=[{"key": codec.ALERTS_WANT, "guard": "x", "sentence": "s", "bar": None}])
    assert isinstance(_decode(both), prc._Refuse)
    held = {"job": "SPY", "status": "withheld", "refusals": [{"key": "*", "guard": "g", "sentence": "s", "bar": None}],
            "alerts": fx["result"]["alerts"]}
    assert "alert record" in _decode(held).sentence
    # asked for and neither served nor refused
    bare = {k: v for k, v in fx["result"].items() if k not in ("alerts", "alerts_sha256")}
    assert isinstance(_decode(bare), prc._Refuse)


def test_a_refused_record_is_read_by_name():
    fx = _fixture()
    refused = {k: v for k, v in fx["result"].items() if k not in ("alerts", "alerts_sha256")}
    refused["refusals"] = [{"key": codec.ALERTS_WANT, "guard": "runtime:server-output-absent", "sentence": "none", "bar": None}]
    # the digest covers the refusals: recompute it the client's own way for this variant
    client = prc.PineRuntimeClient(url="http://x", secret="s", identity=fx["identity"])
    refused["digest"] = client._digest({}, [{"key": codec.ALERTS_WANT, "guard": "runtime:server-output-absent", "bar": None}])
    res = _decode(refused)
    assert isinstance(res, prc.JobResult), getattr(res, "sentence", res)
    assert res.alerts is None
    assert res.refusal_for(codec.ALERTS_WANT).guard == "runtime:server-output-absent"


def test_the_caller_cache_key_names_the_want():
    ident = _fixture()["identity"]
    job = prc.Job(job="SPY", ticker="SPY", tf="D", bars=[], want=("value",))
    asks = prc.Job(job="SPY", ticker="SPY", tf="D", bars=[], want=("value", codec.ALERTS_WANT))
    a = prc.result_key(ident, "d" * 64, job, {}, "b" * 64, "alert")
    b = prc.result_key(ident, "d" * 64, asks, {}, "b" * 64, "alert")
    assert a != b
