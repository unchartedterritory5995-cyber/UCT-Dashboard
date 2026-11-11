"""W5-T7b -- END TO END: a real T7 job, through the real T6 supervisor and T7 pool on the real
server bundle, read by the W5-T11 client's own decoder and digest check.

``docs/pine/SERVER-RUNTIME-DESIGN.md`` 2.3 and 3.2: every result carries ``digest`` (the T3
``column_digest`` over the service identity, the columns and the refusals), and T11 requires it
on an ``ok`` answer. Before W5-T7b the service sent none, so T11 withheld every ``ok`` answer as
``runtime:server-integrity``. This rail drives the service the way the web pod will:

  * T11's ``PineRuntimeClient`` builds, signs and sends the request (loopback only, to a service
    this test starts and stops), decodes the reply and recomputes the digest over what it RECEIVED;
  * the ok answer passes, with full-length columns;
  * one flipped column byte (re-encoded as valid base64, so only the digest can catch it) is
    still refused as integrity;
  * the reply carries the run's warm-up, ``warmup.withheldBars``, and those bars are na.

WHERE THE CLIENT COMES FROM. T11 is not merged into this lane's base, and its files are not this
lane's to edit. The client module is loaded READ-ONLY from ``$PINE_RUNTIME_T11_CLIENT`` (a path to
``pine_runtime_client.py``, e.g. ``git show origin/feat/pine-w5-t11-client:...`` into a temp dir)
or, once T11 is merged, from ``api/services/pine_runtime_client.py``. With neither, the rail SKIPS
by name (the evidence records it run with the client, 0 skipped).

THE ONE KNOWN MISMATCH (reported to the coordinator, W5-T7b EVIDENCE): T11's closed result-key set
(``_RESULT_KEYS``) does not name ``warmup`` yet, so the unmodified reply is refused by T11 as "not
a job result". The rail pins exactly that: when T11's set lacks ``warmup``, the reply is refused
for that reason alone and the same bytes minus ``warmup`` pass; when T11's set names it, the
unmodified reply must pass.
"""
from __future__ import annotations

import base64
import http.client
import importlib.util
import json
import math
import os
import secrets
import socket
import subprocess
import sys
import tempfile
import time
from datetime import date, datetime, timedelta
from urllib.parse import urlparse
from zoneinfo import ZoneInfo

import pytest

from api.services.indicator_compute import bar_open_instant

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SERVER_MJS = os.path.join(REPO, "services", "pine_runtime", "server.mjs")
BUILD_MJS = os.path.join(REPO, "app", "scripts", "build-pine-runtime.mjs")
N = 300

LAUNCHER = r"""
import { pathToFileURL } from 'node:url'
const [serverMjs, buildMjs, outfile, port] = process.argv.slice(2)
const { buildPineRuntime } = await import(pathToFileURL(buildMjs).href)
await buildPineRuntime({ outfile, logLevel: 'silent', env: {} })
const { main } = await import(pathToFileURL(serverMjs).href)
const server = await main({ env: { PORT: port, PINE_RUNTIME_SERVICE_SECRET: process.env.T7B_SECRET }, bundle: outfile,
  pool: { workers: 1 }, log: () => {} })
process.stdout.write(`READY ${server.address().port}\n`)
process.stdin.resume()
process.stdin.on('end', () => { server.close(() => setTimeout(() => process.exit(0), 200)) })
"""


def _client_module():
    path = os.environ.get("PINE_RUNTIME_T11_CLIENT") or os.path.join(REPO, "api", "services", "pine_runtime_client.py")
    if not os.path.isfile(path):
        pytest.skip("the W5-T11 client is not on this tree and PINE_RUNTIME_T11_CLIENT is unset")
    spec = importlib.util.spec_from_file_location("t11_pine_runtime_client_under_test", path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = mod
    spec.loader.exec_module(mod)
    return mod


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.fixture(scope="module")
def service():
    """The real service on the real bundle (1 worker), on loopback. Stopped and proven gone after."""
    client = _client_module()
    tmp = tempfile.mkdtemp(prefix="pine-rt-t7b-e2e-")
    launcher = os.path.join(tmp, "launch.mjs")
    with open(launcher, "w", encoding="utf-8") as fh:
        fh.write(LAUNCHER)
    bundle = os.path.join(tmp, "pine-runtime.mjs")
    secret = secrets.token_hex(32)
    env = {**os.environ, "T7B_SECRET": secret}
    proc = subprocess.Popen(["node", launcher, SERVER_MJS, BUILD_MJS, bundle, str(_free_port())],
                            cwd=os.path.join(REPO, "app"), env=env, stdin=subprocess.PIPE,
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    try:
        line = proc.stdout.readline()
        if not line.startswith("READY "):
            proc.kill()
            raise AssertionError(f"the service did not start: {line!r} {proc.stderr.read()[-2000:]}")
        port = int(line.split()[1])
        engine_dir = os.path.join(REPO, "app", "src", "components", "chart", "engine")
        identity = client.caller_identity(frontend_js=os.path.join(engine_dir, "ast", "pineRuntimeFrontend.js"),
                                          ir_js=os.path.join(engine_dir, "runtime", "ir.js"), bundle=bundle)
        assert identity is not None, "T11 could not read this build's engine identity"
        yield {"client": client, "url": f"http://127.0.0.1:{port}", "secret": secret, "identity": identity}
    finally:
        try:
            proc.stdin.close()
            proc.wait(timeout=30)
        except Exception:  # noqa: BLE001 -- a service that will not stop is killed
            proc.kill()
            proc.wait(timeout=30)
        assert proc.poll() is not None, "the service process is gone"
        for name in os.listdir(tmp):
            os.remove(os.path.join(tmp, name))
        os.rmdir(tmp)


def _loopback(url, body, headers, timeout):
    u = urlparse(url)
    assert u.hostname == "127.0.0.1", "loopback only"
    conn = http.client.HTTPConnection(u.hostname, u.port, timeout=timeout)
    try:
        conn.request("POST", u.path, body=body, headers=dict(headers))
        resp = conn.getresponse()
        return resp.status, resp.read()
    finally:
        conn.close()


def _session_days(n, start=date(2020, 1, 2)):
    """`n` consecutive weekdays from `start` (a plain calendar: the fixture needs no holiday list)."""
    out, d = [], start
    while len(out) < n:
        if d.weekday() < 5:
            out.append(d)
        d += timedelta(days=1)
    return out


def _bars():
    """W5-INT: daily bars stamped by THE ONE RULE (W5-T7b EVIDENCE, "Daily bar time"): `t` is the UNIX
    SECONDS of the 09:30 America/New_York open of the session date, from the Python authority
    `indicator_compute.bar_open_instant` (the twin of indicators.js::barOpenInstant). The fixture used
    to send milliseconds, the very spelling that rule says is read as far-future seconds."""
    times = [bar_open_instant(d.isoformat(), "D") for d in _session_days(N)]
    return [{"t": times[i], "o": 100 + math.sin(i / 7), "h": 101 + math.sin(i / 7),
             "l": 99 + math.sin(i / 7), "c": 100.5 + math.sin(i / 5), "v": 1000 + i} for i in range(N)]


def test_the_fixture_bars_follow_the_one_daily_time_rule():
    """Every bar time is seconds (not ms) at 09:30 New York on its own date, DST included."""
    ny = ZoneInfo("America/New_York")
    bars = _bars()
    assert len(bars) == N
    for b, d in zip(bars, _session_days(N)):
        assert isinstance(b["t"], float) and b["t"] == int(b["t"])
        wall = datetime.fromtimestamp(b["t"], tz=ny)
        assert (wall.date(), wall.hour, wall.minute) == (d, 9, 30), (b["t"], wall)
        assert 631_152_000 <= b["t"] < 4_102_444_800, "seconds, never milliseconds"
    # both offsets are exercised (EST and EDT), so a fixed-offset shortcut would be caught
    assert {datetime.fromtimestamp(b["t"], tz=ny).utcoffset().total_seconds() for b in bars} == {-5 * 3600, -4 * 3600}


def _doc(history):
    return {"id": "u_0123456789ab", "meta": ({"runtimeHistory": history} if history else {}),
            "compute": {"kind": "runtime", "fn": "runtime:t7b", "outputs": {"value": 0},
                        "source": '//@version=5\nindicator("t7b")\nplot(ta.ema(close, 10))'}}


def _run(svc, transform=None, *, history=None, listing=True):
    """One job through T11's client and the real service. Returns (JobResult, raw reply dict)."""
    seen = {}

    def transport(url, body, headers, timeout):
        status, payload = _loopback(url, body, headers, timeout)
        seen["raw"] = json.loads(payload) if status == 200 else None
        if status == 200 and transform is not None:
            payload = json.dumps(transform(json.loads(payload))).encode("utf-8")
        return status, payload

    c = svc["client"]
    client = c.PineRuntimeClient(url=svc["url"], secret=svc["secret"], identity=svc["identity"], transport=transport)
    job = c.Job(job="AAPL|D", ticker="AAPL", exchange="NASDAQ", tf="D", bars=_bars(), want=("value",),
                history_from_listing=listing)
    [res] = client.run(def_id="u_0123456789ab", version=1, doc=_doc(history), owner_id=42, profile="alert", jobs=[job])
    assert seen.get("raw") is not None, f"the service answered no 200: {res}"
    return res, seen["raw"]


def _knows_warmup(svc) -> bool:
    return "warmup" in svc["client"]._RESULT_KEYS


def _strip_warmup(reply):
    for r in reply["results"]:
        r.pop("warmup", None)
    return reply


def _for_this_client(svc):
    """The bytes as T11 reads them today: unmodified once T11 names `warmup`, else minus it."""
    return None if _knows_warmup(svc) else _strip_warmup


def test_the_ok_answer_passes_t11s_decoder_and_digest_check(service):
    res, raw = _run(service, _for_this_client(service))
    assert res.status == "ok", res.refusals
    assert res.refusal_for("value") is None
    col = res.columns["value"]
    assert len(col) == N
    assert sum(1 for x in col if not math.isnan(x)) > N // 2
    [r] = raw["results"]
    assert res.digest == r["digest"]
    assert len(r["digest"]) == 64
    # T11 recomputed it over what it received, with its OWN identity, and they agreed
    assert res.digest == service["client"].codec.column_digest(service["identity"], {"value": list(col)}, [])


def _flip(reply):
    r = reply["results"][0]
    b = bytearray(base64.b64decode(r["columns"]["value"]))
    b[8 * 200] ^= 0x01  # one low mantissa bit of row 200: still a finite canonical value
    r["columns"]["value"] = base64.b64encode(bytes(b)).decode("ascii")
    return reply


def test_a_flipped_column_byte_is_still_refused_as_integrity(service):
    strip = _for_this_client(service) or (lambda x: x)
    res, _ = _run(service, lambda reply: _flip(strip(reply)))
    assert res.status == "withheld"
    run = res.run_refusal()
    assert run.guard == service["client"].INTEGRITY
    assert "does not match its digest" in run.sentence


def test_a_digest_dropped_from_an_ok_answer_is_refused(service):
    strip = _for_this_client(service) or (lambda x: x)

    def drop(reply):
        reply = strip(reply)
        del reply["results"][0]["digest"]
        return reply
    res, _ = _run(service, drop)
    assert res.status == "withheld"
    assert res.run_refusal().guard == service["client"].INTEGRITY


def test_the_reply_carries_the_runs_warm_up_and_those_bars_are_na(service):
    res, raw = _run(service, _for_this_client(service), history="listing", listing=False)
    assert res.status == "ok", res.refusals
    [r] = raw["results"]
    n = r["warmup"]["withheldBars"]
    assert set(r["warmup"]) == {"withheldBars"}
    assert isinstance(n, int) and 0 < n < N
    col = res.columns["value"]
    assert all(math.isnan(x) for x in col[:n])
    assert not math.isnan(col[n])
    # from the listing the run withholds none, and says so
    _, raw2 = _run(service, _for_this_client(service), history=None, listing=True)
    assert raw2["results"][0]["warmup"] == {"withheldBars": 0}


def test_the_t11_result_key_mismatch_is_exactly_warmup(service):
    """Pins the one schema mismatch: T11 refuses the unmodified reply ONLY because `warmup` is
    outside its closed set. Once T11 names it, the unmodified reply must pass."""
    res, _ = _run(service, None)
    if _knows_warmup(service):
        assert res.status == "ok", res.refusals
    else:
        assert res.status == "withheld"
        assert res.run_refusal().guard == service["client"].INTEGRITY
        assert "is not a job result" in res.run_refusal().sentence
        assert _run(service, _strip_warmup)[0].status == "ok"
