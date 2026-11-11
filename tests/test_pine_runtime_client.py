"""W5-T11 rails: the one door (`api/services/pine_runtime_client.py`).

One rail per row of docs/pine/SERVER-RUNTIME-DESIGN.md 3.7 (names start `test_row<N>_`), plus
the client rules: never stale (a bars change is a cache miss), never partial (a short column is
integrity), the wire vectors against W5-T6's JS, and the batch API. NO NETWORK: every request
goes to `tests/fakes/pine_runtime_fake.PineRuntimeFake`, an in-process transport. Secrets are
fixture strings.
"""
from __future__ import annotations

import base64
import hashlib
import json
import logging
import math

import pytest

from api.services import pine_runtime_client as prc
from api.services import pine_runtime_codec as codec
from tests.fakes.pine_runtime_fake import (FIXTURE_IDENTITY, FIXTURE_SECRET, PineRuntimeFake, b64_column,
                                           bars_fixture)

DOC = {"id": "u_0123456789ab", "compute": {"kind": "runtime", "source": "//@version=6\nindicator('x')\nplot(close)",
                                           "outputs": ["value", "signal"]}, "meta": {}}
T0 = 1_762_200_000


@pytest.fixture(autouse=True)
def _fresh_signing_memory():
    prc._forget_signing_times()
    yield
    prc._forget_signing_times()


class Clock:
    def __init__(self):
        self.mono = 0.0
        self.sleeps = []

    def sleep(self, s):
        self.sleeps.append(s)
        self.mono += s


def client(fake=None, *, clock=None, **kw):
    fake = fake if fake is not None else PineRuntimeFake()
    clock = clock or Clock()
    args = dict(url="http://pine-runtime.test", secret=FIXTURE_SECRET, identity=FIXTURE_IDENTITY)
    args.update(kw)
    return prc.PineRuntimeClient(transport=fake, clock=lambda: T0, monotonic=lambda: clock.mono,
                                 sleep=clock.sleep, **args), fake, clock


def job(name="AAPL|D", n=5, want=("value",), **kw):
    return prc.Job(job=name, ticker=name.split("|")[0], tf="D", bars=kw.pop("bars", None) or bars_fixture(n),
                   want=tuple(want), **kw)


def run(c, jobs, profile="alert", cache=None):
    return c.run(def_id="u_0123456789ab", version=3, doc=DOC, owner_id="user-42", profile=profile,
                 jobs=jobs, cache=cache)


def guard_of(res):
    r = res.run_refusal()
    return r.guard if r else None


def honest(reply, mutate):
    """Apply `mutate(result)` to every result, then give each the digest its NEW columns would
    have: the client must refuse on the column itself, not only on a stale digest."""
    for r in reply["results"]:
        mutate(r)
        cols = {k: codec.decode_column(base64.b64decode(v)) for k, v in r.get("columns", {}).items()}
        r["digest"] = codec.column_digest(FIXTURE_IDENTITY, cols if r.get("status") == "ok" else {}, r["refusals"])
    return reply


# --- the happy path, so every red below is a refusal and not a broken fixture -----------------

def test_ok_run_returns_the_full_verified_column():
    c, fake, _ = client()
    [res] = run(c, [job(want=("value", "signal"))])
    assert res.status == "ok", res
    closes = [b["c"] for b in bars_fixture(5)]
    assert list(res.columns["value"]) == [2 * x for x in closes]
    assert math.isnan(res.columns["signal"][0]) and list(res.columns["signal"][1:]) == closes[1:]
    assert len(fake.calls) == 1 and fake.urls == ["http://pine-runtime.test/v1/run"]


def test_request_is_the_closed_schema_t6_parses():
    c, fake, _ = client()
    run(c, [job()])
    req = fake.calls[0]
    assert set(req) == {"protocol", "profile", "engine", "definition", "owner", "jobs"}
    assert req["engine"] == FIXTURE_IDENTITY and req["profile"] == "alert"
    d = req["definition"]
    assert d["doc"] == json.dumps(DOC, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    assert d["doc_sha256"] == hashlib.sha256(d["doc"].encode()).hexdigest()
    j = req["jobs"][0]
    assert set(j) == {"job", "symbol", "tf", "bars", "ctx", "want"}
    assert set(j["bars"]) == {"n", "t", "o", "h", "l", "c", "v", "sha256"}
    assert j["ctx"] == {"newestBarIsForming": False, "historyFromListing": False, "runtimeInputs": {}}
    assert req["owner"].startswith("hmac:") and "user-42" not in json.dumps(req)


# --- the wire vectors, computed by W5-T6's own JS (auth.mjs signHeader, protocol.mjs barsSha256)

def test_signature_matches_t6_auth_vector():
    secret = "fixture-secret-0123456789abcdef0123456789"
    assert prc.sign(secret, 1762200000, b'{"x":1}') == \
        "t=1762200000,v1=897e39bdd042af02ead6b73aa7fee94d90b5e98541135a9b59f1c5ad1c27c785"


def test_bars_hash_matches_t6_protocol_vector():
    bars = [{"t": 1, "o": 10, "h": 12, "l": 9, "c": 11, "v": 100}, {"t": 2, "o": 11, "h": 13, "l": 8, "c": 12, "v": 200}]
    n, _cols, sha = prc.encode_bars(bars)
    assert n == 2 and sha == "9d4a53acb79f548efc3e562297329e4cd72ae27b298e6b4ea4922b9398e9b292"


# --- 3.7 row 1: PINE_RUNTIME_SERVICE_URL unset -------------------------------------------------

def test_row1_url_unset_withholds_unavailable_and_sends_nothing():
    c, fake, _ = client(url="")
    [res] = run(c, [job()])
    assert guard_of(res) == prc.UNAVAILABLE and not res.columns and fake.urls == []
    assert "the service URL" in res.run_refusal().sentence


def test_row1_no_secret_or_no_identity_is_unavailable_too():
    for kw in ({"secret": ""}, {"identity": None}):
        c, fake, _ = client(**kw)
        [res] = run(c, [job()])
        assert guard_of(res) == prc.UNAVAILABLE and fake.urls == [], kw


def test_row1_client_from_env_reads_t12_names_and_fails_closed_without_them(monkeypatch):
    from api.services import runtime_definitions
    monkeypatch.delattr(runtime_definitions, "SERVICE_URL_ENV", raising=False)
    monkeypatch.delattr(runtime_definitions, "SERVICE_SECRET_ENV", raising=False)
    monkeypatch.setenv("PINE_RUNTIME_SERVICE_URL", "http://pine-runtime.test")
    monkeypatch.setenv("PINE_RUNTIME_SERVICE_SECRET", FIXTURE_SECRET)
    fake = PineRuntimeFake()
    c = prc.client_from_env(transport=fake, identity=FIXTURE_IDENTITY)
    assert c.url is None and c.secret is None
    [res] = run(c, [job()])
    assert guard_of(res) == prc.UNAVAILABLE and fake.urls == []
    # with W5-T12's names present the same environment configures it; the first secret signs
    monkeypatch.setattr(runtime_definitions, "SERVICE_URL_ENV", "PINE_RUNTIME_SERVICE_URL", raising=False)
    monkeypatch.setattr(runtime_definitions, "SERVICE_SECRET_ENV", "PINE_RUNTIME_SERVICE_SECRET", raising=False)
    monkeypatch.setenv("PINE_RUNTIME_SERVICE_SECRET", f" {FIXTURE_SECRET} ,an-older-secret-still-accepted-0123456789")
    c = prc.client_from_env(transport=fake, identity=FIXTURE_IDENTITY)
    assert c.url == "http://pine-runtime.test" and c.secret == FIXTURE_SECRET
    c.clock = lambda: T0
    [res] = run(c, [job()])
    assert res.status == "ok"
    monkeypatch.setenv("PINE_RUNTIME_SERVICE_URL", "  ")
    assert prc.client_from_env(transport=fake, identity=FIXTURE_IDENTITY).url is None


# --- 3.7 row 2: connect error, DNS, timeout, 5xx ----------------------------------------------

@pytest.mark.parametrize("fault", [ConnectionRefusedError("refused"), OSError("getaddrinfo failed"),
                                   TimeoutError("timed out")])
def test_row2_transport_errors_are_unavailable(fault):
    c, fake, _ = client()
    fake.script_next = [fault]
    [res] = run(c, [job()])
    assert guard_of(res) == prc.UNAVAILABLE and not res.columns


@pytest.mark.parametrize("status", [500, 502, 503, 504])
def test_row2_5xx_is_unavailable(status):
    c, fake, _ = client()
    fake.script_next = [(status, b"<html>bad gateway</html>")]
    [res] = run(c, [job()])
    assert guard_of(res) == prc.UNAVAILABLE


def test_row2_t6_not_ready_503_is_unavailable():
    c, fake, _ = client()
    fake.script_next = [(503, json.dumps({"protocol": 1, "error": {"guard": "runtime:server-unavailable",
                                                                  "sentence": "not ready"}}).encode())]
    [res] = run(c, [job()])
    assert guard_of(res) == prc.UNAVAILABLE


def test_row2_transport_gets_the_remaining_deadline():
    c, fake, _ = client()
    run(c, [job()], profile="alert")
    run(c, [job()], profile="sweep")
    assert fake.timeouts == [prc.DEADLINE_S["alert"], prc.DEADLINE_S["sweep"]]


# --- 3.7 row 3: 401 / 403 ---------------------------------------------------------------------

def test_row3_a_wrong_secret_is_auth_and_never_retried():
    c, fake, _ = client(secret="a-different-secret-0123456789abcdef0123")
    [res] = run(c, [job()], profile="alert")
    assert guard_of(res) == prc.AUTH and len(fake.urls) == 1


@pytest.mark.parametrize("status", [401, 403])
def test_row3_401_403_is_auth(status):
    c, fake, _ = client()
    fake.script_next = [(status, b"{}")]
    [res] = run(c, [job()], profile="sweep")
    assert guard_of(res) == prc.AUTH and len(fake.urls) == 1


# --- 3.7 row 4: engine identity differs --------------------------------------------------------

def test_row4_service_409_engine_is_engine_mismatch():
    fake = PineRuntimeFake(identity=dict(FIXTURE_IDENTITY, script_engine=5))
    c, fake, _ = client(fake)
    [res] = run(c, [job()])
    assert guard_of(res) == prc.ENGINE_MISMATCH and fake.calls


def test_row4_a_reply_from_another_engine_is_engine_mismatch():
    c, fake, _ = client()
    fake.tamper = lambda reply: dict(reply, engine=dict(reply["engine"], bundle_sha256="cd" * 32))
    [res] = run(c, [job()])
    assert guard_of(res) == prc.ENGINE_MISMATCH and not res.columns


def test_row4_an_integer_and_its_decimal_string_are_one_identity():
    c, fake, _ = client()
    fake.tamper = lambda reply: dict(reply, engine=dict(reply["engine"], script_engine="4"))
    [res] = run(c, [job()])
    assert res.status == "ok"


# --- 3.7 row 5: doc or bars hash mismatch ------------------------------------------------------

def test_row5_bars_hash_mismatch_is_integrity(monkeypatch):
    c, fake, _ = client()
    monkeypatch.setattr(prc, "bars_sha256", lambda n, cols: "0" * 64)
    [res] = run(c, [job()])
    assert guard_of(res) == prc.INTEGRITY and fake.calls


def test_row5_doc_hash_mismatch_is_integrity():
    c, fake, _ = client()
    fake.script_next = [(422, json.dumps({"protocol": 1, "error": {"guard": "runtime:server-integrity",
                                                                  "sentence": "doc"}}).encode())]
    [res] = run(c, [job()])
    assert guard_of(res) == prc.INTEGRITY


def test_row5_integrity_is_logged_loudly_without_the_owner_or_source(caplog):
    c, fake, _ = client()
    fake.script_next = [(422, b"{}")]
    with caplog.at_level(logging.WARNING, logger=prc.log.name):
        run(c, [job()])
    rec = [r for r in caplog.records if prc.INTEGRITY in r.getMessage()]
    assert rec and rec[0].levelno == logging.ERROR
    text = " ".join(r.getMessage() for r in caplog.records)
    assert "user-42" not in text and "indicator(" not in text


@pytest.mark.parametrize("status,guard", [(400, "runtime:server-schema"),
                                          (409, "runtime:server-doc-unknown")])
def test_row5_a_request_the_service_calls_malformed_is_integrity(status, guard):
    c, fake, _ = client()
    fake.script_next = [(status, json.dumps({"protocol": 1, "error": {"guard": guard, "sentence": "x"}}).encode())]
    [res] = run(c, [job()])
    assert guard_of(res) == prc.INTEGRITY


# --- 3.7 row 6: 429 queue full -----------------------------------------------------------------

def _busy():
    return (429, json.dumps({"protocol": 1, "error": {"guard": "runtime:server-busy", "sentence": "full"}}).encode())


def test_row6_alert_retries_once_then_withholds_busy():
    c, fake, clock = client()
    fake.script_next = [_busy(), _busy(), _busy()]
    [res] = run(c, [job()], profile="alert")
    assert guard_of(res) == prc.BUSY and len(fake.urls) == 2 and clock.sleeps == [prc.BUSY_BACKOFF_S]


def test_row6_alert_busy_then_ok_is_ok():
    c, fake, _ = client()
    fake.script_next = [_busy()]
    [res] = run(c, [job()], profile="alert")
    assert res.status == "ok" and len(fake.urls) == 2


def test_row6_resending_the_same_body_needs_a_later_timestamp():
    c, fake, _ = client()
    real = fake._serve

    def serve_then_busy(body, headers):
        status, payload = real(body, headers)  # admits the signature into the replay set
        return _busy() if len(fake.calls) == 1 else (status, payload)
    fake._serve = serve_then_busy
    [res] = run(c, [job()], profile="alert")
    assert res.status == "ok", res
    assert len(fake.seen) == 2


def test_row6_scan_chunk_retries_three_times_with_backoff():
    c, fake, clock = client()
    fake.script_next = [_busy()] * 5
    [res] = run(c, [job()], profile="sweep")
    assert guard_of(res) == prc.BUSY and len(fake.urls) == 4
    assert clock.sleeps == [prc.BUSY_BACKOFF_S, 2 * prc.BUSY_BACKOFF_S, 4 * prc.BUSY_BACKOFF_S]


def test_row6_backtest_does_not_retry():
    c, fake, clock = client()
    fake.script_next = [_busy()]
    [res] = run(c, [job()], profile="backtest")
    assert guard_of(res) == prc.BUSY and len(fake.urls) == 1 and clock.sleeps == []


def test_row6_no_retry_past_the_deadline():
    clock = Clock()
    c, fake, _ = client(clock=clock)
    fake.script_next = [_busy()] * 5

    def slow(url, body, headers, timeout):
        clock.mono += prc.DEADLINE_S["sweep"] - 0.1
        return fake(url, body, headers, timeout)
    c.transport = slow
    [res] = run(c, [job()], profile="sweep")
    assert guard_of(res) == prc.BUSY and len(fake.urls) == 1


# --- 3.7 row 7: worker OOM / crash / hard kill -------------------------------------------------

@pytest.mark.parametrize("guard", [prc.WORKER_OOM, prc.FAILED, prc.TIME_BUDGET])
def test_row7_worker_stops_keep_their_guard_and_are_never_cached(guard):
    c, fake, _ = client()
    fake.withhold["AAPL|D"] = (guard, "the worker stopped")
    cache = prc.RunCache()
    [res] = run(c, [job()], cache=cache)
    assert guard_of(res) == guard and not res.columns
    assert len(cache) == 0
    run(c, [job()], cache=cache)
    assert len(fake.calls) == 2


def _with_limit(limit):
    def tamper(reply):
        reply["results"][0]["refusals"][0]["limit"] = limit
        return reply
    return tamper


def test_limits_r1_a_vm_wall_time_stop_keeps_time_budget_carries_its_limit_and_is_never_cached():
    """LIMITS r1 (B2-a): the VM's own WALL_TIME stop arrives as runtime:time-budget with
    ``limit: "WALL_TIME"``; the field is kept and the result is never cached."""
    c, fake, _ = client()
    fake.withhold["AAPL|D"] = (prc.TIME_BUDGET, "this script took more than 5000 ms to draw bar by bar")
    fake.tamper = _with_limit("WALL_TIME")
    cache = prc.RunCache()
    [res] = run(c, [job()], cache=cache)
    assert guard_of(res) == prc.TIME_BUDGET and res.run_refusal().limit == "WALL_TIME"
    assert not prc.cacheable(res) and len(cache) == 0


def test_limits_r2_an_old_shaped_refusal_decodes_on_the_new_client():
    """Phase 1: the service emits {key, guard, sentence, bar} only; the new client reads it, limit None."""
    c, fake, _ = client()
    fake.withhold["AAPL|D"] = ("runtime:limit", "this script went past the number of function calls")
    fake.tamper = lambda reply: (reply["results"][0]["refusals"][0].pop("limit", None), reply)[1]
    [res] = run(c, [job()])
    assert guard_of(res) == "runtime:limit" and res.run_refusal().limit is None
    assert res.run_refusal().sentence == "this script went past the number of function calls"


def test_limits_r1_a_limit_stop_names_its_limit_as_a_field():
    c, fake, _ = client()
    fake.withhold["AAPL|D"] = ("runtime:limit", "this script went past the number of function calls")
    fake.tamper = _with_limit("CALL_COUNT")
    [res] = run(c, [job()])
    assert guard_of(res) == "runtime:limit" and res.run_refusal().limit == "CALL_COUNT"


@pytest.mark.parametrize("bad", ["call_count", "", 7, ["CALL_COUNT"], "CALL COUNT"])
def test_limits_r1_a_malformed_limit_is_integrity(bad):
    c, fake, _ = client()
    fake.withhold["AAPL|D"] = ("runtime:limit", "limit")
    fake.tamper = _with_limit(bad)
    [res] = run(c, [job()])
    assert guard_of(res) == prc.INTEGRITY


def test_row7_pool_failure_500_withholds_every_job_as_failed():
    c, fake, _ = client()
    fake.script_next = [(500, json.dumps({"protocol": 1, "error": {"guard": prc.FAILED, "sentence": "pool"}}).encode())]
    res = run(c, [job("AAPL|D"), job("MSFT|D")])
    assert [guard_of(r) for r in res] == [prc.FAILED, prc.FAILED]


# --- 3.7 row 8: a run-wide runtime refusal -----------------------------------------------------

@pytest.mark.parametrize("guard", ["runtime:limit", "runtime:version", "runtime.error"])
def test_row8_run_wide_refusal_is_the_guard_itself_with_its_sentence(guard):
    c, fake, _ = client()
    fake.withhold["AAPL|D"] = (guard, f"stopped by {guard}")
    [res] = run(c, [job()])
    assert res.status == "withheld" and guard_of(res) == guard
    assert res.run_refusal().sentence == f"stopped by {guard}" and res.refusal_for("value").guard == guard


def test_row8_a_deterministic_run_refusal_may_be_cached():
    c, fake, _ = client()
    fake.withhold["AAPL|D"] = ("runtime:limit", "limit")
    cache = prc.RunCache()
    run(c, [job()], cache=cache)
    [res] = run(c, [job()], cache=cache)
    assert guard_of(res) == "runtime:limit" and len(fake.calls) == 1


def test_row8_an_ok_result_carrying_a_run_wide_refusal_is_integrity():
    c, fake, _ = client()
    fake.tamper = lambda reply: honest(reply, lambda r: r["refusals"].append(
        {"key": "*", "guard": "runtime:limit", "sentence": "", "bar": None}))
    [res] = run(c, [job()])
    assert guard_of(res) == prc.INTEGRITY


def test_row8_withheld_with_values_or_without_a_reason_is_integrity():
    for mutate in (lambda r: r.update(columns={"value": b64_column([1.0] * 5)}),
                   lambda r: r.update(refusals=[])):
        c, fake, _ = client()
        fake.withhold["AAPL|D"] = ("runtime:limit", "limit")
        fake.tamper = lambda reply, m=mutate: honest(reply, m)
        [res] = run(c, [job()])
        assert guard_of(res) == prc.INTEGRITY


# --- 3.7 row 9: a per-output refusal -----------------------------------------------------------

def test_row9_per_output_refusal_withholds_that_plot_only():
    c, fake, _ = client()
    fake.refuse_output["signal"] = ("runtime:server-drawings", "not served")
    [res] = run(c, [job(want=("value", "signal"))])
    assert res.status == "ok" and "signal" not in res.columns and len(res.columns["value"]) == 5
    assert res.refusal_for("signal").guard == "runtime:server-drawings" and res.refusal_for("value") is None


def test_row9_a_wanted_key_neither_served_nor_refused_is_integrity():
    c, fake, _ = client()
    fake.tamper = lambda reply: honest(reply, lambda r: r["columns"].pop("signal"))
    [res] = run(c, [job(want=("value", "signal"))])
    assert guard_of(res) == prc.INTEGRITY


def test_row9_a_key_both_served_and_refused_or_unasked_is_integrity():
    for mutate in (lambda r: r["refusals"].append({"key": "value", "guard": "runtime:x", "sentence": "", "bar": None}),
                   lambda r: r["columns"].update(extra=b64_column([0.0] * 5))):
        c, fake, _ = client()
        fake.tamper = lambda reply, m=mutate: honest(reply, m)
        [res] = run(c, [job()])
        assert guard_of(res) == prc.INTEGRITY


# --- 3.7 row 10: column length != bars.n, or a non-finite value (NEVER PARTIAL) -----------------

def test_row10_never_partial_a_short_column_is_integrity():
    c, fake, _ = client()
    fake.tamper = lambda reply: honest(reply, lambda r: r["columns"].update(value=b64_column([1.0] * 4)))
    [res] = run(c, [job()])
    assert guard_of(res) == prc.INTEGRITY and not res.columns


def test_row10_a_long_column_is_integrity():
    c, fake, _ = client()
    fake.tamper = lambda reply: honest(reply, lambda r: r["columns"].update(value=b64_column([1.0] * 6)))
    [res] = run(c, [job()])
    assert guard_of(res) == prc.INTEGRITY


@pytest.mark.parametrize("bad", [math.inf, -math.inf])
def test_row10_an_infinite_value_is_integrity(bad):
    c, fake, _ = client()
    fake.tamper = lambda reply: honest(reply, lambda r: r["columns"].update(value=b64_column([1.0, bad, 1, 1, 1])))
    [res] = run(c, [job()])
    assert guard_of(res) == prc.INTEGRITY


def test_row10_na_is_a_value_not_a_failure():
    c, fake, _ = client()
    fake.tamper = lambda reply: honest(reply, lambda r: r["columns"].update(value=b64_column([math.nan] * 5)))
    [res] = run(c, [job()])
    assert res.status == "ok" and all(math.isnan(x) for x in res.columns["value"])


def test_row10_a_non_canonical_nan_is_integrity():
    raw = bytearray(codec.encode_column([1.0] * 5))
    raw[0:8] = bytes([1, 0, 0, 0, 0, 0, 0xF8, 0x7F])
    text = base64.b64encode(bytes(raw)).decode()
    c, fake, _ = client()

    def m(reply):
        reply["results"][0]["columns"]["value"] = text
        return reply
    fake.tamper = m
    [res] = run(c, [job()])
    assert guard_of(res) == prc.INTEGRITY


def test_row10_a_digest_that_does_not_match_the_columns_is_integrity():
    c, fake, _ = client()
    fake.tamper = lambda reply: (reply["results"][0].update(columns={"value": b64_column([7.0] * 5)}), reply)[1]
    [res] = run(c, [job()])
    assert guard_of(res) == prc.INTEGRITY


def test_row10_an_ok_result_without_a_digest_is_integrity():
    c, fake, _ = client()
    fake.tamper = lambda reply: (reply["results"][0].pop("digest"), reply)[1]
    [res] = run(c, [job()])
    assert guard_of(res) == prc.INTEGRITY


def test_row10_a_digest_over_another_engine_is_integrity():
    c, fake, _ = client()
    other = dict(FIXTURE_IDENTITY, runtime_ir=2)

    def m(reply):
        r = reply["results"][0]
        cols = {k: codec.decode_column(base64.b64decode(v)) for k, v in r["columns"].items()}
        r["digest"] = codec.column_digest(other, cols, r["refusals"])
        return reply
    fake.tamper = m
    [res] = run(c, [job()])
    assert guard_of(res) == prc.INTEGRITY


def test_row10_one_bad_job_withholds_that_job_only():
    c, fake, _ = client()

    def m(reply):
        r = reply["results"][1]
        r["columns"]["value"] = b64_column([1.0] * 4)
        return reply
    fake.tamper = m
    a, b, d = run(c, [job("AAPL|D"), job("MSFT|D"), job("NVDA|D")])
    assert a.status == "ok" and d.status == "ok" and guard_of(b) == prc.INTEGRITY


@pytest.mark.parametrize("mutate", [
    lambda reply: reply["results"].pop(),
    lambda reply: reply["results"].reverse(),
    lambda reply: reply["results"].append(dict(reply["results"][0])),
    lambda reply: reply["results"][0].update(job="TSLA|D"),
])
def test_row10_a_reply_not_answering_every_job_once_in_order_withholds_the_chunk(mutate):
    c, fake, _ = client()
    fake.tamper = lambda reply: (mutate(reply), reply)[1]
    res = run(c, [job("AAPL|D"), job("MSFT|D")])
    assert [guard_of(r) for r in res] == [prc.INTEGRITY, prc.INTEGRITY]


@pytest.mark.parametrize("payload", [b"not json", b"[]", json.dumps({"protocol": 2, "engine": {}, "results": []}).encode(),
                                     json.dumps({"protocol": 1, "results": []}).encode()])
def test_row10_a_reply_that_is_not_protocol_1_is_integrity(payload):
    c, fake, _ = client()
    fake.script_next = [(200, payload)]
    [res] = run(c, [job()])
    assert guard_of(res) == prc.INTEGRITY


def test_row10_an_unknown_result_key_is_integrity():
    c, fake, _ = client()
    fake.tamper = lambda reply: (reply["results"][0].update(stale=True), reply)[1]
    [res] = run(c, [job()])
    assert guard_of(res) == prc.INTEGRITY


# --- never stale --------------------------------------------------------------------------------

def test_never_stale_a_bars_change_is_a_cache_miss():
    c, fake, _ = client()
    cache = prc.RunCache()
    [a] = run(c, [job(bars=bars_fixture(5))], cache=cache)
    [a2] = run(c, [job(bars=bars_fixture(5))], cache=cache)
    assert len(fake.calls) == 1 and a2 is a
    moved = bars_fixture(5)
    moved[-1] = dict(moved[-1], c=moved[-1]["c"] + 1.0)
    [b] = run(c, [job(bars=moved)], cache=cache)
    assert len(fake.calls) == 2
    assert b.columns["value"][-1] == 2 * moved[-1]["c"] != a.columns["value"][-1]


@pytest.mark.parametrize("change", [
    dict(ticker="MSFT"), dict(tf="60"), dict(want=("signal",)), dict(runtime_inputs={"len": 14}),
    dict(history_from_listing=True), dict(exchange="NYSE"),
])
def test_never_stale_every_key_part_misses(change):
    c, fake, _ = client()
    cache = prc.RunCache()
    base = dict(job="AAPL|D", ticker="AAPL", tf="D", bars=bars_fixture(5), want=("value",))
    run(c, [prc.Job(**base)], cache=cache)
    run(c, [prc.Job(**dict(base, **change))], cache=cache)
    assert len(fake.calls) == 2


def test_never_stale_profile_and_document_are_in_the_key():
    c, fake, _ = client()
    cache = prc.RunCache()
    run(c, [job()], profile="alert", cache=cache)
    run(c, [job()], profile="sweep", cache=cache)
    c.run(def_id="u_0123456789ab", version=3, doc=dict(DOC, meta={"x": 1}), owner_id="user-42",
          profile="alert", jobs=[job()], cache=cache)
    assert len(fake.calls) == 3


def test_never_stale_the_engine_identity_is_in_the_key():
    cache = prc.RunCache()
    c, fake, _ = client()
    run(c, [job()], cache=cache)
    other = dict(FIXTURE_IDENTITY, bundle_sha256="cd" * 32)
    c2, fake2, _ = client(PineRuntimeFake(identity=other), identity=other)
    [res] = run(c2, [job()], cache=cache)
    assert res.status == "ok" and len(fake2.calls) == 1


def test_never_stale_a_client_withhold_is_never_cached():
    c, fake, _ = client()
    cache = prc.RunCache()
    fake.script_next = [(503, b"")]
    [a] = run(c, [job()], cache=cache)
    assert guard_of(a) == prc.UNAVAILABLE and len(cache) == 0
    [b] = run(c, [job()], cache=cache)
    assert b.status == "ok"


def test_never_stale_without_a_cache_every_call_runs():
    c, fake, _ = client()
    run(c, [job()])
    run(c, [job()])
    assert len(fake.calls) == 2


# --- the batch API -----------------------------------------------------------------------------

def test_batch_sweep_is_sent_in_chunks_of_50_and_a_failed_chunk_withholds_only_its_jobs():
    c, fake, _ = client()
    jobs = [job(f"S{i:03d}|D", n=3) for i in range(120)]
    fake.script_next = [None, (503, b""), None]
    res = run(c, jobs, profile="sweep")
    assert [len(r["jobs"]) for r in fake.calls] == [50, 20]  # the 503 chunk was never parsed
    assert len(fake.urls) == 3 and len(res) == 120
    assert all(r.status == "ok" for r in res[:50] + res[100:])
    assert all(guard_of(r) == prc.UNAVAILABLE for r in res[50:100])
    assert [r.job for r in res] == [j.job for j in jobs]


def test_batch_on_demand_uses_one_request_up_to_max_jobs():
    c, fake, _ = client()
    run(c, [job(f"S{i:03d}|D", n=2) for i in range(60)], profile="on-demand")
    assert [len(r["jobs"]) for r in fake.calls] == [60]


@pytest.mark.parametrize("hole", [None, math.nan, math.inf, True, "1.0"])
def test_batch_a_bar_that_is_not_a_finite_number_is_refused_before_sending(hole):
    c, fake, _ = client()
    holed = bars_fixture(5)
    holed[2] = dict(holed[2], h=hole)
    [res] = run(c, [job(bars=holed)])
    assert guard_of(res) == prc.INTEGRITY and fake.urls == []


@pytest.mark.parametrize("inputs", [{"x": {"nested": 1}}, {"x": math.nan}, {"": 1}, {"x": "s" * 4097},
                                    {f"k{i}": i for i in range(257)}])
def test_batch_inputs_the_service_refuses_are_refused_before_sending(inputs):
    c, fake, _ = client()
    [res] = run(c, [job(runtime_inputs=inputs)])
    assert guard_of(res) == prc.INTEGRITY and fake.urls == []


@pytest.mark.parametrize("kw", [dict(ticker="BAD TICKER"), dict(ticker=""), dict(exchange="X" * 33), dict(tf="")])
def test_batch_a_symbol_or_timeframe_the_service_refuses_is_refused_before_sending(kw):
    c, fake, _ = client()
    base = dict(job="AAPL|D", ticker="AAPL", tf="D", bars=bars_fixture(5), want=("value",))
    [res] = run(c, [prc.Job(**dict(base, **kw))])
    assert guard_of(res) == prc.INTEGRITY and fake.urls == []


def test_batch_bad_input_is_refused_before_sending_that_job_only():
    c, fake, _ = client()
    holed = bars_fixture(5)
    holed[2] = dict(holed[2], v=None)
    unsorted = bars_fixture(5)
    unsorted[3] = dict(unsorted[3], t=unsorted[1]["t"])
    res = run(c, [job("AAPL|D"), job("MSFT|D", bars=holed), job("NVDA|D", bars=unsorted),
                  job("AAPL|D")])
    assert res[0].status == "ok" and [guard_of(r) for r in res[1:]] == [prc.INTEGRITY] * 3
    assert len(fake.calls) == 1 and [j["job"] for j in fake.calls[0]["jobs"]] == ["AAPL|D"]


def test_batch_bad_definition_withholds_without_sending():
    c, fake, _ = client()
    for kw in (dict(def_id="bad id!"), dict(version=-1), dict(version=True), dict(doc=None),
               dict(doc={"x": float("nan")})):
        args = dict(def_id="u_0123456789ab", version=3, doc=DOC, owner_id="u", profile="alert", jobs=[job()])
        args.update(kw)
        [res] = c.run(**args)
        assert guard_of(res) == prc.INTEGRITY, kw
    assert fake.urls == []


def test_batch_unknown_profile_is_a_programming_error():
    c, _, _ = client()
    with pytest.raises(ValueError):
        run(c, [job()], profile="nightly")


# --- the caller's engine identity ---------------------------------------------------------------

def test_caller_identity_reads_the_declaring_modules(tmp_path):
    bundle = tmp_path / "pine-runtime.mjs"
    bundle.write_bytes(b"export const X = 1\n")
    ident = prc.caller_identity(bundle=str(bundle))
    from api.services import user_definitions
    assert ident == {"script_engine": user_definitions.read_script_engine_version(),
                     "runtime_language": "pine", "runtime_frontend": 1, "runtime_ir": 1,
                     "bundle_sha256": hashlib.sha256(b"export const X = 1\n").hexdigest()}


def test_caller_identity_is_none_without_a_bundle_or_with_an_ambiguous_declaration(tmp_path):
    assert prc.caller_identity(bundle=str(tmp_path / "absent.mjs")) is None
    bundle = tmp_path / "b.mjs"
    bundle.write_bytes(b"x")
    twice = tmp_path / "ir.js"
    twice.write_text("export const RUNTIME_IR_VERSION = 1\nexport const RUNTIME_IR_VERSION = 2\n")
    assert prc.caller_identity(bundle=str(bundle), ir_js=str(twice)) is None


# --- the replay window ----------------------------------------------------------------------------

def test_the_same_body_is_never_signed_twice_with_one_timestamp():
    assert prc.signing_time("a" * 64, T0) == T0
    assert prc.signing_time("a" * 64, T0) == T0 + 1
    assert prc.signing_time("b" * 64, T0) == T0
    assert prc.signing_time("a" * 64, T0 + 5) == T0 + 5


def test_two_identical_runs_in_one_second_are_both_served():
    c, fake, _ = client()
    a = run(c, [job()])
    b = run(c, [job()])
    assert a[0].status == b[0].status == "ok" and len(fake.seen) == 2


# --- r1: the run's warm-up (W5-T7b `warmup: {withheldBars}`) --------------------------------------

def test_r1_an_ok_result_carries_its_warmup():
    c, fake, _ = client()
    fake.withheld_bars = 2
    [res] = run(c, [job()])
    assert res.status == "ok" and res.warmup == {"withheldBars": 2}


@pytest.mark.parametrize("warmup", ["absent", None, [], {}, {"withheldBars": -1}, {"withheldBars": 1.5},
                                    {"withheldBars": True}, {"withheldBars": "3"}, {"withheldBars": 6},
                                    {"withheldBars": 1, "shift": 2}, {"bars": 1}])
def test_r1_a_warmup_that_is_not_exactly_a_bar_count_is_integrity(warmup):
    c, fake, _ = client()

    def m(reply):
        r = reply["results"][0]
        if warmup == "absent":
            r.pop("warmup")
        else:
            r["warmup"] = warmup
        return reply
    fake.tamper = m
    [res] = run(c, [job(n=5)])
    assert guard_of(res) == prc.INTEGRITY and res.warmup is None


def test_r1_warmup_bounds_are_inclusive():
    for k in (0, 5):
        c, fake, _ = client()
        fake.withheld_bars = k
        [res] = run(c, [job(n=5)])
        assert res.warmup == {"withheldBars": k}


def test_r1_a_withheld_result_reporting_a_warmup_is_integrity():
    c, fake, _ = client()
    fake.withhold["AAPL|D"] = ("runtime:limit", "limit")
    fake.tamper = lambda reply: (reply["results"][0].update(warmup={"withheldBars": 0}), reply)[1]
    [res] = run(c, [job()])
    assert guard_of(res) == prc.INTEGRITY


def test_r1_still_closed_an_unknown_key_beside_warmup_is_integrity():
    c, fake, _ = client()
    fake.tamper = lambda reply: (reply["results"][0].update(withheldBars=3), reply)[1]
    [res] = run(c, [job()])
    assert guard_of(res) == prc.INTEGRITY


# --- r1 conformance: a REAL W5-T7b response (captured by docs/pine/evidence/2026-11-04-w5-t11/t7b_capture.py)

def _t7b(name="t7b_response_echo.json"):
    """A real W5-T7b response. `t7b_response_echo.json`: no warm-up (positive). `t7b_response.json`:
    the stand-in bundle's 'warmup:3', which reports 3 withheld bars over FINITE values (negative)."""
    import os
    p = os.path.join(os.path.dirname(__file__), "fixtures", "pine_runtime", name)
    return json.load(open(p, encoding="utf-8"))


def _t7b_run(cap, payload):
    seen = {}

    def tr(url, body, headers, timeout):
        seen["sha"] = hashlib.sha256(body).hexdigest()
        return cap["status"], payload
    c = prc.PineRuntimeClient(url="http://127.0.0.1", secret=FIXTURE_SECRET, identity=cap["identity"], transport=tr,
                              clock=lambda: T0)
    jobs = [prc.Job(job=j["job"], ticker=j["ticker"], exchange=j["exchange"], tf="D", bars=cap["bars"],
                    want=("value",), history_from_listing=True) for j in cap["jobs"]]
    return c.run(def_id="u_0123456789ab", version=1, doc=cap["doc"], owner_id="owner-1", profile="alert",
                 jobs=jobs), seen


def test_r1_conformance_a_real_t7b_response_decodes_and_verifies():
    cap = _t7b()
    res, seen = _t7b_run(cap, cap["response"].encode("utf-8"))
    assert seen["sha"] == cap["request_sha256"], "the capture answers exactly the request this client builds"
    assert [r.status for r in res] == ["ok", "ok"], [r.refusals for r in res]
    closes = [b["c"] for b in cap["bars"]]
    for r in res:
        assert list(r.columns["value"]) == closes and r.warmup == {"withheldBars": 0}
        assert r.digest == json.loads(cap["response"])["results"][0]["digest"]


def test_r2_conformance_a_real_t7b_response_with_finite_warmup_values_is_integrity():
    cap = _t7b("t7b_response.json")
    assert cap["doc"]["compute"]["source"] == "warmup:3"
    res, seen = _t7b_run(cap, cap["response"].encode("utf-8"))
    assert seen["sha"] == cap["request_sha256"]
    assert [guard_of(r) for r in res] == [prc.INTEGRITY, prc.INTEGRITY]


def test_r1_conformance_one_flipped_byte_of_the_real_response_is_integrity():
    cap = _t7b()
    reply = json.loads(cap["response"])
    raw = bytearray(base64.b64decode(reply["results"][1]["columns"]["value"]))
    raw[8] ^= 0x01
    reply["results"][1]["columns"]["value"] = base64.b64encode(bytes(raw)).decode()
    res, _ = _t7b_run(cap, json.dumps(reply).encode())
    assert res[0].status == "ok" and guard_of(res[1]) == prc.INTEGRITY


# --- r2: the engine's warm-up curtain is VERIFIED (never masked here) ----------------------------------

def _finite_at(index):
    def m(reply):
        r = reply["results"][0]
        col = codec.decode_column(base64.b64decode(r["columns"]["value"]))
        col[index] = 7.0
        r["columns"]["value"] = b64_column(col)
        return honest(reply, lambda x: None)
    return m


def test_r2_a_finite_value_inside_the_warmup_is_integrity():
    c, fake, _ = client()
    fake.withheld_bars = 3
    fake.tamper = _finite_at(2)  # the last withheld bar
    [r] = run(c, [job()])
    assert guard_of(r) == prc.INTEGRITY and not r.columns


def test_r2_batch_a_finite_warmup_value_withholds_that_job_only():
    c, fake, _ = client()
    fake.withheld_bars = 3
    fake.tamper = _finite_at(0)
    a, b = run(c, [job("AAPL|D"), job("MSFT|D")])
    assert guard_of(a) == prc.INTEGRITY and b.status == "ok"


def test_r2_any_served_column_is_checked_not_only_the_first():
    c, fake, _ = client()
    fake.withheld_bars = 2

    def m(reply):
        r = reply["results"][0]
        col = codec.decode_column(base64.b64decode(r["columns"]["signal"]))
        col[1] = 1.0
        r["columns"]["signal"] = b64_column(col)
        return honest(reply, lambda x: None)
    fake.tamper = m
    [r] = run(c, [job(want=("value", "signal"))])
    assert guard_of(r) == prc.INTEGRITY


def test_r2_a_nan_warmup_is_accepted_and_finite_from_withheld_bars_on():
    c, fake, _ = client()
    fake.withheld_bars = 3
    [r] = run(c, [job()])
    closes = [b["c"] for b in bars_fixture(5)]
    assert r.status == "ok" and all(math.isnan(v) for v in r.columns["value"][:3])
    assert list(r.columns["value"][3:]) == [2 * x for x in closes[3:]]


def test_r2_withheld_bars_n_all_nan_is_accepted():
    c, fake, _ = client()
    fake.withheld_bars = 5
    [r] = run(c, [job(n=5)])
    assert r.status == "ok" and all(math.isnan(v) for v in r.columns["value"])


def test_r2_withheld_bars_zero_needs_no_nan():
    c, fake, _ = client()
    [r] = run(c, [job(n=5)])
    assert list(r.columns["value"]) == [2 * b["c"] for b in bars_fixture(5)]
