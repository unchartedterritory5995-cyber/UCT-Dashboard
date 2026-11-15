"""W5-T9 -- the pine-runtime SERVICE's post-deploy smoke, read-only
(docs/pine/SERVER-RUNTIME-DESIGN.md 3.8).

It asks a DEPLOYED service four questions and changes nothing (the service holds no state; a run
is a pure computation):

  1. ENGINE   the service's engine number equals web's (`scriptEngineVersion.js`, read through
              `user_definitions.read_script_engine_version`, the one authority). Taken from the
              signed `GET /v1/metrics` boot block, the same numbers the boot fingerprint prints.
  2. CANARY   `GET /ready` is 200 and the canary the metrics report is green.
  3. RUN      a signed `POST /v1/run` of the allowlisted `adx-and-di-for-v4` over a fixed series
              returns the COMMITTED digest (`tests/fixtures/pine_runtime/service_smoke.json`),
              digested by the Python codec (`api/services/pine_runtime_codec.py`) from the
              service's own bytes.
  4. AUTH     an UNSIGNED `POST /v1/run` gets 401.

EXIT CODES (`runtime_pane_smoke.py` / `hub_nav_smoke.py` convention):
    0  PASS          all four measured and good.
    1  FAILED        a break was MEASURED: roll back first.
    2  INCONCLUSIVE  something could not be measured; NEVER a rollback trigger. Cases: no URL or
                     secret configured; the service is unreachable from here (a machine outside
                     Railway's private network cannot reach it); a signed request refused 401 (the
                     key this runner holds may be stale: that is not proof about the service);
                     429 busy; the canary has not run yet; the committed digest was recorded for
                     another engine (regenerate it with --record at the engine bump).
    FAILED beats INCONCLUSIVE: one measured break is a FAILED even if another check could not run.

  python tools/pine_runtime_service_smoke.py --base http://pine-runtime.railway.internal:8080
  python tools/pine_runtime_service_smoke.py --record      # rewrite the committed digest from a live service

Secrets: PINE_RUNTIME_SERVICE_SECRET (the first entry of the list signs), PINE_RUNTIME_SERVICE_URL,
both from the environment, never an argument, never printed.
"""
from __future__ import annotations

import argparse
import datetime
import hashlib
import hmac
import json
import os
import struct
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
import conftest  # noqa: E402,F401 -- the shared-data-root census + tripwire (tests/test_tools_pin_the_root.py); inert on a Railway service

DOCUMENTS = ROOT / "tests" / "fixtures" / "runtime_documents" / "documents.json"
FIXTURE = ROOT / "tests" / "fixtures" / "pine_runtime" / "service_smoke.json"
SMOKE_SLUG = "adx-and-di-for-v4"
SIGNATURE_HEADER = "X-Pine-Runtime-Signature"
#: The digest is artifact-neutral (T4 decision 1): the bundle's own sha is not in the preimage.
NEUTRAL_SHA = "0" * 64
BARS_TAG = "pine-runtime-bars/1"
BAR_COLUMNS = ("t", "o", "h", "l", "c", "v")
ENGINE_FIELDS = ("script_engine", "runtime_language", "runtime_frontend", "runtime_ir")
SMOKE_OWNER = "hmac:" + hashlib.sha256(b"pine-runtime-service-smoke").hexdigest()[:16]
PASS, FAIL, INCONCLUSIVE = "PASS", "FAILED", "INCONCLUSIVE"

#: (method, url, headers, body, timeout) -> (status, text); raises OSError when nothing answered.
Http = Callable[[str, str, Dict[str, str], Optional[bytes], float], Tuple[int, str]]


def urllib_http(method: str, url: str, headers: Dict[str, str], body: Optional[bytes], timeout: float) -> Tuple[int, str]:
    req = urllib.request.Request(url, data=body, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace")
    except (urllib.error.URLError, TimeoutError, ConnectionError) as e:  # nothing answered
        raise OSError(str(e)) from None


# --- the fixed series --------------------------------------------------------------------------

def make_series(n: int = 1500, seed: int = 424242, start: str = "2015-01-02") -> Dict[str, List[float]]:
    """A deterministic daily series in INTEGER arithmetic (a 32-bit LCG), so it is the same on
    every machine. Prices are whole cents / 100; weekdays only; t is midnight UTC in ms."""
    state = seed & 0xFFFFFFFF

    def rnd() -> float:
        nonlocal state
        state = (state * 1664525 + 1013904223) & 0xFFFFFFFF
        return state / 4294967296.0

    day = datetime.date.fromisoformat(start)
    cols: Dict[str, List[float]] = {k: [] for k in BAR_COLUMNS}
    close = 4000
    while len(cols["t"]) < n:
        if day.weekday() < 5:
            o = max(100, close + int((rnd() - 0.5) * 36))
            close = max(100, o + int((rnd() - 0.5) * 180))
            h = max(o, close) + int(rnd() * 54)
            lo = max(50, min(o, close) - int(rnd() * 54))
            cols["t"].append(float(int(datetime.datetime(day.year, day.month, day.day, tzinfo=datetime.timezone.utc).timestamp()) * 1000))
            cols["o"].append(o / 100)
            cols["h"].append(h / 100)
            cols["l"].append(lo / 100)
            cols["c"].append(close / 100)
            cols["v"].append(float(1000 + int(rnd() * 5_000_000)))
        day += datetime.timedelta(days=1)
    return cols


def _lp(text: str) -> bytes:
    b = text.encode("utf-8")
    return struct.pack("<I", len(b)) + b


def bars_wire(cols: Dict[str, List[float]]) -> Dict[str, Any]:
    """The wire form of the bars, with their hash (protocol.mjs barsSha256)."""
    import base64
    n = len(cols["t"])
    raw = {k: struct.pack("<%dd" % n, *cols[k]) for k in BAR_COLUMNS}
    h = hashlib.sha256(_lp(BARS_TAG) + struct.pack("<I", n))
    for k in BAR_COLUMNS:
        h.update(raw[k])
    wire: Dict[str, Any] = {"n": n}
    for k in BAR_COLUMNS:
        wire[k] = base64.b64encode(raw[k]).decode("ascii")
    wire["sha256"] = h.hexdigest()
    return wire


def smoke_document() -> str:
    """The allowlisted document's JSON text, built from the committed documents fixture (the same
    one `runtime_pane_smoke.py` runs). Nothing of the script is copied into this tool."""
    docs = json.loads(DOCUMENTS.read_text(encoding="utf-8"))["documents"]
    d = next(x for x in docs if x["slug"] == SMOKE_SLUG)["definition"]
    plain = {"id": d["id"], "compute": d["compute"], "meta": {"runtimeHistory": d["meta"].get("runtimeHistory")}}
    return json.dumps(plain, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def build_request(engine: Dict[str, Any], cols: Dict[str, List[float]], doc_text: str) -> bytes:
    request = {
        "protocol": 1, "profile": "sweep", "owner": SMOKE_OWNER,
        "engine": {k: engine[k] for k in (*ENGINE_FIELDS, "bundle_sha256")},
        "definition": {"def_id": "smoke:" + SMOKE_SLUG, "version": 1,
                       "doc_sha256": hashlib.sha256(doc_text.encode("utf-8")).hexdigest(), "doc": doc_text},
        "jobs": [{"job": "SMOKE|D", "symbol": {"ticker": "SMOKE", "exchange": "NASDAQ"}, "tf": "D",
                  "bars": bars_wire(cols),
                  "ctx": {"newestBarIsForming": False, "historyFromListing": True, "runtimeInputs": {}}, "want": []}],
    }
    return json.dumps(request, separators=(",", ":")).encode("utf-8")


def sign(secret: str, body: bytes, t: Optional[int] = None) -> str:
    t = int(time.time()) if t is None else t
    v1 = hmac.new(secret.encode("utf-8"), f"{t}.{hashlib.sha256(body).hexdigest()}".encode("utf-8"), hashlib.sha256).hexdigest()
    return f"t={t},v1={v1}"


def digest_of_result(result: Dict[str, Any], engine: Dict[str, Any]) -> str:
    """The committed digest's definition: the codec over the service's own column bytes on the
    artifact-neutral identity, no refusals (as T4's host-parity records do)."""
    from api.services import pine_runtime_codec as codec
    columns = {k: codec.decode_column(codec.b64_to_bytes(v)) for k, v in (result.get("columns") or {}).items()}
    ident = {k: engine[k] for k in ENGINE_FIELDS}
    ident["bundle_sha256"] = NEUTRAL_SHA
    return codec.column_digest(ident, columns, [])


# --- the four checks ---------------------------------------------------------------------------

def _web_engine() -> Optional[int]:
    from api.services.user_definitions import read_script_engine_version
    return read_script_engine_version()


def run_smoke(base: str, secret: str, fixture: Dict[str, Any], http: Http = urllib_http,
              web_engine: Callable[[], Optional[int]] = _web_engine, timeout: float = 30.0,
              say: Callable[[str], None] = print, record: bool = False,
              sleep: Callable[[float], None] = time.sleep) -> int:
    results: List[Tuple[str, str]] = []

    def done(state: str, text: str) -> None:
        results.append((state, text))
        say(f"[{len(results)}] {state}: {text}")

    base = base.rstrip("/")

    def signed_http(method: str, path: str, body: Optional[bytes]) -> Tuple[int, str]:
        """One signed call. A 401 is retried ONCE with a fresh timestamp: the service refuses a replayed
        signature, and two calls with the same body in the same second share one."""
        payload = body or b""
        headers = {SIGNATURE_HEADER: sign(secret, payload)}
        if body is not None:
            headers["Content-Type"] = "application/json"
        status, text = http(method, base + path, headers, body, timeout)
        if status == 401:
            sleep(1.1)
            headers[SIGNATURE_HEADER] = sign(secret, payload)
            status, text = http(method, base + path, headers, body, timeout)
        return status, text

    def get(path: str, signed: bool) -> Tuple[int, Any]:
        if signed:
            status, text = signed_http("GET", path, None)
        else:
            status, text = http("GET", base + path, {}, None, timeout)
        try:
            return status, json.loads(text)
        except ValueError:
            return status, None

    try:
        status, _ = get("/health", False)
    except OSError as e:
        say(f"INCONCLUSIVE: the service at the configured URL is unreachable from here ({type(e).__name__}); nothing was measured")
        return 2
    if status != 200:
        say(f"FAILED: GET /health answered {status}; the service is not alive")
        return 1

    # the engine's own numbers, from the signed metrics (the boot fingerprint's source)
    metrics = None
    metrics_state = None
    try:
        status, metrics = get("/v1/metrics", True)
        if status == 401:
            metrics_state = "the service refused this runner's key (401): the key held here may be stale, which proves nothing about the service"
        elif status != 200 or not isinstance(metrics, dict):
            metrics_state = f"GET /v1/metrics answered {status}"
    except OSError as e:
        metrics_state = f"GET /v1/metrics did not answer ({type(e).__name__})"

    # 1. ENGINE
    if metrics_state:
        done(INCONCLUSIVE, f"engine: {metrics_state}")
    else:
        engine = metrics.get("engine") or {}
        want = web_engine()
        if want is None:
            done(INCONCLUSIVE, "engine: web's engine number is unreadable here")
        elif str(engine.get("script_engine")) != str(want):
            done(FAIL, f"engine: the service runs engine {engine.get('script_engine')} but web ships {want}")
        else:
            done(PASS, f"engine: service and web are both engine {want} (boot {metrics.get('boot', {}).get('engine')} bundle {metrics.get('boot', {}).get('bundle')})")

    # 2. CANARY
    try:
        rstatus, _ = get("/ready", False)
    except OSError:
        rstatus = None
    canary = (metrics or {}).get("canary") if not metrics_state else None
    if rstatus == 200 and (canary is None or canary.get("ok") is True):
        done(PASS, "canary: /ready is 200" + (f", {canary.get('runs')} canary run(s), last {canary['last']['verdict']}" if canary and canary.get("last") else ""))
    elif canary is not None and canary.get("ok") is False:
        done(FAIL, f"canary: DIVERGED on {', '.join((canary.get('last') or {}).get('diverged', [])) or 'a case'}; /ready is {rstatus}")
    elif canary is not None and canary.get("ok") is None:
        done(INCONCLUSIVE, f"canary: it has not decided yet (/ready {rstatus}); the service may still be booting")
    elif rstatus is None:
        done(INCONCLUSIVE, "canary: /ready did not answer")
    else:
        done(FAIL, f"canary: /ready answered {rstatus} though the canary is green or unreported; the pool is not serving")

    # 3. RUN
    if metrics_state:
        done(INCONCLUSIVE, f"run: no engine identity to build the request ({metrics_state})")
    else:
        engine = metrics["engine"]
        body = build_request(engine, make_series(fixture["series"]["n"], fixture["series"]["seed"], fixture["series"]["start"]), smoke_document())
        try:
            status, text = signed_http("POST", "/v1/run", body)
        except OSError as e:
            status, text = None, str(e)
        reply: Any = None
        try:
            reply = json.loads(text)
        except (ValueError, TypeError):
            pass
        if status is None:
            done(INCONCLUSIVE, "run: the signed request got no answer")
        elif status == 401:
            done(INCONCLUSIVE, "run: the service refused this runner's signature (401); the key held here may be stale")
        elif status == 429:
            done(INCONCLUSIVE, "run: the service is busy (429 runtime:server-busy)")
        elif status != 200 or not isinstance(reply, dict) or not reply.get("results"):
            guard = ((reply or {}).get("error") or {}).get("guard") if isinstance(reply, dict) else None
            done(FAIL, f"run: HTTP {status} {guard or ''}".rstrip())
        else:
            r = reply["results"][0]
            if r.get("status") != "ok":
                guard = (r.get("refusals") or [{}])[0].get("guard")
                done(FAIL, f"run: {SMOKE_SLUG} was withheld ({guard}); it must compute")
            else:
                got = digest_of_result(r, engine)
                if record:
                    fixture["identity"] = {k: engine[k] for k in ENGINE_FIELDS}
                    fixture["digest"] = got
                    fixture["columns"] = sorted(r["columns"])
                    fixture["bars_sha256"] = bars_wire(make_series(fixture["series"]["n"], fixture["series"]["seed"], fixture["series"]["start"]))["sha256"]
                    done(PASS, f"run: recorded digest {got[:12]} over {len(r['columns'])} column(s)")
                elif {k: str(fixture["identity"].get(k)) for k in ENGINE_FIELDS} != {k: str(engine.get(k)) for k in ENGINE_FIELDS}:
                    done(INCONCLUSIVE, "run: the committed digest was recorded for another engine; regenerate it with --record at the engine bump")
                elif got != fixture["digest"]:
                    done(FAIL, f"run: {SMOKE_SLUG} digest {got[:12]} != committed {fixture['digest'][:12]}")
                else:
                    done(PASS, f"run: {SMOKE_SLUG} over {fixture['series']['n']} D bars equals the committed digest {got[:12]}")

    # 4. AUTH (an unsigned request needs no key, so it runs whatever happened above)
    try:
        status, _ = http("POST", base + "/v1/run", {"Content-Type": "application/json"}, b"{}", timeout)
        if status == 401:
            done(PASS, "auth: an unsigned POST /v1/run got 401")
        else:
            done(FAIL, f"auth: an unsigned POST /v1/run answered {status}, not 401")
    except OSError:
        done(INCONCLUSIVE, "auth: the unsigned request got no answer")

    states = [s for s, _ in results]
    if FAIL in states:
        say("FAILED: a break was measured. Roll back first.")
        return 1
    if INCONCLUSIVE in states:
        say("INCONCLUSIVE: not a pass and not a failure; never a rollback trigger.")
        return 2
    say("PASS: engine, canary, run and auth all measured and good.")
    return 0


def main(argv: Optional[List[str]] = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--base", default=os.environ.get("PINE_RUNTIME_SERVICE_URL", ""))
    ap.add_argument("--fixture", default=str(FIXTURE))
    ap.add_argument("--record", action="store_true", help="rewrite the committed digest from this live service")
    ap.add_argument("--timeout", type=float, default=30.0)
    args = ap.parse_args(argv)
    secret = (os.environ.get("PINE_RUNTIME_SERVICE_SECRET") or "").split(",")[0].strip()
    if not args.base or not secret:
        print("INCONCLUSIVE: PINE_RUNTIME_SERVICE_URL (or --base) and PINE_RUNTIME_SERVICE_SECRET must be set; nothing was measured")
        return 2
    path = Path(args.fixture)
    fixture = json.loads(path.read_text(encoding="utf-8"))
    code = run_smoke(args.base, secret, fixture, timeout=args.timeout, record=args.record)
    if args.record and code == 0:
        tmp = path.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(fixture, indent=1, sort_keys=True) + "\n", encoding="utf-8")
        os.replace(tmp, path)
        print(f"wrote {path}")
    return code


if __name__ == "__main__":
    sys.exit(main())
