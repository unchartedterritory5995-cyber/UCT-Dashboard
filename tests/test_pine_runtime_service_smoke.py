"""W5-T9 rails: tools/pine_runtime_service_smoke.py exit codes 0 / 1 / 2, each produced by a fixture.

No socket is opened: the smoke's `http` seam is a scripted fake service. The fake's `run` answer
carries real canonical column bytes, so the digest the smoke computes goes through the real Python
codec and equals the fixture digest built from the same columns.
"""
from __future__ import annotations

import base64
import copy
import hashlib
import json
import shutil
import subprocess
from pathlib import Path

import pytest

from api.services import pine_runtime_codec as codec
from api.services.user_definitions import read_script_engine_version
from tools import pine_runtime_service_smoke as smoke

ROOT = Path(__file__).resolve().parents[1]
SECRET = "k" * 40
BASE = "http://svc.invalid:8080"
ENGINE = {"script_engine": 5, "runtime_language": "pine", "runtime_frontend": 1, "runtime_ir": 1, "bundle_sha256": "ab" * 32}
SERIES = {"n": 40, "seed": 7, "start": "2015-01-02"}


def _column(values):
    return codec.bytes_to_b64(codec.encode_column(values))


COLUMNS = {"value": _column([1.0, float("nan"), -0.0, 3.5]), "out2": _column([0.5, 0.25, 0.125, 0.0625])}
RESULT_OK = {"job": "SMOKE|D", "status": "ok", "columns": COLUMNS, "refusals": []}
GOOD_DIGEST = smoke.digest_of_result(RESULT_OK, ENGINE)
FIXTURE = {"series": SERIES, "identity": {k: ENGINE[k] for k in smoke.ENGINE_FIELDS}, "digest": GOOD_DIGEST, "columns": sorted(COLUMNS)}


class Svc:
    """A scripted service. Every field is one way it can be right or wrong."""

    def __init__(self, **o):
        self.health = o.get("health", 200)
        self.ready = o.get("ready", 200)
        self.metrics_status = o.get("metrics_status", 200)
        self.engine = o.get("engine", ENGINE)
        self.canary = o.get("canary", {"ok": True, "runs": 2, "reds": 0, "last": {"verdict": "green", "diverged": []}})
        self.run_status = o.get("run_status", 200)
        self.result = o.get("result", RESULT_OK)
        self.unsigned_status = o.get("unsigned_status", 401)
        self.unreachable = o.get("unreachable", False)
        self.calls = []

    def __call__(self, method, url, headers, body, timeout):
        path = url[len(BASE):]
        self.calls.append((method, path, bool(headers.get(smoke.SIGNATURE_HEADER))))
        if self.unreachable:
            raise OSError("no route")
        if path == "/health":
            return self.health, json.dumps({"ok": True})
        if path == "/ready":
            return self.ready, json.dumps({"ready": self.ready == 200})
        if path == "/v1/metrics":
            if not headers.get(smoke.SIGNATURE_HEADER):
                return 401, "{}"
            return self.metrics_status, json.dumps({"engine": self.engine, "boot": {"engine": "5/1/1", "bundle": "ab" * 6}, "canary": self.canary})
        if path == "/v1/run":
            if not headers.get(smoke.SIGNATURE_HEADER):
                return self.unsigned_status, "{}"
            return self.run_status, json.dumps({"protocol": 1, "engine": self.engine, "results": [self.result]})
        return 404, "{}"


def go(svc, fixture=FIXTURE, web=5, lines=None):
    out = [] if lines is None else lines
    code = smoke.run_smoke(BASE, SECRET, copy.deepcopy(fixture), http=svc, web_engine=lambda: web, say=out.append, sleep=lambda s: None)
    return code, "\n".join(out)


# --- exit 0 ------------------------------------------------------------------------------------

def test_pass_is_exit_0_and_all_four_checks_ran():
    svc = Svc()
    code, text = go(svc)
    assert code == 0, text
    assert text.count("PASS:") == 5  # four checks and the summary
    assert ("POST", "/v1/run", False) in svc.calls and ("POST", "/v1/run", True) in svc.calls


# --- exit 1: one fixture per measured break ------------------------------------------------------

@pytest.mark.parametrize("name,svc,kw,needle", [
    ("engine differs from web", Svc(), {"web": 6}, "service runs engine 5 but web ships 6"),
    ("canary diverged", Svc(ready=503, canary={"ok": False, "runs": 3, "reds": 1, "last": {"verdict": "red", "diverged": ["ema_macd@listing"]}}), {}, "DIVERGED on ema_macd@listing"),
    ("not ready though canary green", Svc(ready=503), {}, "the pool is not serving"),
    ("wrong digest", Svc(result={**RESULT_OK, "columns": {**COLUMNS, "value": _column([1.0, 2.0, 3.0, 4.0])}}), {}, "!= committed"),
    ("withheld", Svc(result={"job": "SMOKE|D", "status": "withheld", "refusals": [{"key": "*", "guard": "runtime:limit"}]}), {}, "withheld (runtime:limit)"),
    ("server error", Svc(run_status=500), {}, "HTTP 500"),
    ("unsigned accepted", Svc(unsigned_status=200), {}, "answered 200, not 401"),
    ("health not 200", Svc(health=503), {}, "not alive"),
])
def test_failed_is_exit_1(name, svc, kw, needle):
    code, text = go(svc, **kw)
    assert code == 1, (name, text)
    assert needle in text, (name, text)
    assert "FAILED:" in text


def test_a_measured_failure_beats_an_inconclusive_check():
    code, text = go(Svc(unsigned_status=200, metrics_status=401))
    assert code == 1 and "INCONCLUSIVE:" in text


# --- exit 2: one fixture per case that cannot be measured ----------------------------------------

@pytest.mark.parametrize("name,svc,kw,needle", [
    ("unreachable", Svc(unreachable=True), {}, "unreachable from here"),
    ("our key refused", Svc(metrics_status=401), {}, "key held here may be stale"),
    ("busy", Svc(run_status=429), {}, "busy"),
    ("canary undecided", Svc(ready=503, canary={"ok": None, "runs": 0, "reds": 0, "last": None}), {}, "has not decided yet"),
    ("fixture for another engine", Svc(), {"fixture": {**FIXTURE, "identity": {**FIXTURE["identity"], "script_engine": 4}}}, "another engine"),
    ("web engine unreadable", Svc(), {"web": None}, "unreadable"),
])
def test_inconclusive_is_exit_2(name, svc, kw, needle):
    code, text = go(svc, **kw)
    assert code == 2, (name, text)
    assert needle in text, (name, text)
    assert "FAILED" not in text.replace("FAILED beats", "")


def test_no_url_or_no_secret_is_exit_2_and_prints_no_secret(monkeypatch, capsys):
    monkeypatch.delenv("PINE_RUNTIME_SERVICE_URL", raising=False)
    monkeypatch.setenv("PINE_RUNTIME_SERVICE_SECRET", SECRET)
    assert smoke.main([]) == 2
    monkeypatch.setenv("PINE_RUNTIME_SERVICE_URL", BASE)
    monkeypatch.delenv("PINE_RUNTIME_SERVICE_SECRET")
    assert smoke.main([]) == 2
    assert SECRET not in capsys.readouterr().out


def test_a_replayed_signature_is_retried_once_with_a_new_timestamp():
    seen = []

    class Replay(Svc):
        def __call__(self, method, url, headers, body, timeout):
            if url.endswith("/v1/metrics"):
                seen.append(headers[smoke.SIGNATURE_HEADER])
                if len(seen) == 1:
                    return 401, "{}"
            return super().__call__(method, url, headers, body, timeout)

    code, text = go(Replay())
    assert code == 0, text
    assert len(seen) == 2


# --- the signature and the fixed series ---------------------------------------------------------

def test_the_signature_is_the_services_v1_over_the_body():
    body = b'{"a":1}'
    t = 1_800_000_000
    want = __import__("hmac").new(SECRET.encode(), f"{t}.{hashlib.sha256(body).hexdigest()}".encode(), hashlib.sha256).hexdigest()
    assert smoke.sign(SECRET, body, t) == f"t={t},v1={want}"


def test_the_series_is_deterministic_and_well_formed():
    a, b = smoke.make_series(60), smoke.make_series(60)
    assert a == b
    assert all(a["t"][i] < a["t"][i + 1] for i in range(59))
    assert all(a["l"][i] <= min(a["o"][i], a["c"][i]) and a["h"][i] >= max(a["o"][i], a["c"][i]) for i in range(60))
    assert smoke.make_series(60, seed=8) != a


# --- the committed fixture ----------------------------------------------------------------------

COMMITTED = json.loads((ROOT / "tests" / "fixtures" / "pine_runtime" / "service_smoke.json").read_text(encoding="utf-8"))


def test_committed_fixture_is_whole_and_describes_the_engine_this_tree_ships():
    assert len(COMMITTED["digest"]) == 64 and len(COMMITTED["bars_sha256"]) == 64 and COMMITTED["columns"]
    s = COMMITTED["series"]
    # the generator has not drifted: the committed hash is the hash of what it makes today
    assert smoke.bars_wire(smoke.make_series(s["n"], s["seed"], s["start"]))["sha256"] == COMMITTED["bars_sha256"]
    # and the digest was recorded on THIS tree's engine; an engine bump re-records it (--record)
    assert COMMITTED["identity"]["script_engine"] == read_script_engine_version()


def test_the_bars_hash_equals_the_services_own_protocol_hash():
    """The Python hash and protocol.mjs's barsSha256 are two implementations of one rule."""
    node = shutil.which("node")
    assert node, "node is required to prove the two bars hashes agree"
    wire = smoke.bars_wire(smoke.make_series(25, 3))
    js = (
        "import { barsSha256, BAR_COLUMNS } from './services/pine_runtime/protocol.mjs';"
        "const w = JSON.parse(process.argv[1]); const c = {};"
        "for (const k of BAR_COLUMNS) c[k] = Buffer.from(w[k], 'base64');"
        "console.log(barsSha256(w.n, c));"
    )
    r = subprocess.run([node, "--input-type=module", "-e", js, json.dumps(wire)], cwd=ROOT, capture_output=True, text=True, timeout=60)
    assert r.returncode == 0, r.stderr
    assert r.stdout.strip() == wire["sha256"]


def test_the_smoke_document_is_the_allowlisted_one_and_is_not_copied_into_the_tool():
    doc = json.loads(smoke.smoke_document())
    assert doc["compute"]["kind"] == "runtime" and doc["compute"]["source"]
    text = Path(smoke.__file__).read_text(encoding="utf-8")
    assert doc["compute"]["source"][:80] not in text
