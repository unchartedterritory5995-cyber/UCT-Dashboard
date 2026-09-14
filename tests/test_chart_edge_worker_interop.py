"""⭐⭐ THE TWO VERIFIERS MUST AGREE, AND ONLY A CROSS-RUNTIME TEST CAN SAY SO.

The token is minted by Python (`api/chart_edge_token.py`) and judged by
JavaScript (`edge/bars-edge-router/worker.js`) inside Cloudflare. Each side has
its own unit tests and both can be perfectly green while disagreeing about a
byte — base64 padding, key encoding, JSON key order, integer types. The day they
disagree, every paying member classifies INVALID and Phase 2 would refuse them
all.

So this file mints in Python and classifies in Node, and it asserts a NEGATIVE
control too: a token signed with the wrong secret must come back INVALID. Without
that, a JS verifier hard-wired to return VALID would satisfy every positive case
here.

⚠️ THIS TEST SKIPS IF NODE IS ABSENT, and a skip is not a pass. Node is present
wherever `app/` is built, which is everywhere this repo is developed.
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from api import chart_edge_token as cet  # noqa: E402

SECRET = "interop-edge-secret"
WORKER_DIR = Path(__file__).resolve().parent.parent / "edge" / "bars-edge-router"
WORKER_JS = WORKER_DIR / "worker.js"

node = shutil.which("node")
pytestmark = pytest.mark.skipif(node is None, reason="node not installed")


@pytest.fixture(autouse=True)
def _secret(monkeypatch):
    monkeypatch.setenv("CHART_EDGE_SECRET", SECRET)
    monkeypatch.delenv("CHART_EDGE_TOKEN_TTL_SECONDS", raising=False)


def _classify_in_node(token: str, secret: str = SECRET, now: int | None = None,
                      ent: str = "bars") -> str:
    """Ask the REAL Worker verifier what it thinks of this token.

    `ent` selects which trust path it is judged against — "bars" for a member
    cookie, "service" for a render capability — mirroring the Python
    `verify(expect=...)` argument.
    """
    # ⚠️ VALUES TRAVEL BY ENVIRONMENT, NOT ARGV, for two reasons. The first is
    # correctness: `node -e` shifts `process.argv`, and the first version of this
    # helper used `slice(2)`, dropped an argument, and classified EVERYTHING
    # INVALID — including the MISSING case, which is what gave it away. The
    # second is hygiene: argv is world-readable in a process list, and a secret
    # does not belong there even in a test.
    script = f"""
    import {{ classifyToken }} from {json.dumps(WORKER_JS.as_uri())};
    const tok = process.env.IT_TOKEN === "__NONE__" ? null : process.env.IT_TOKEN;
    const sec = process.env.IT_SECRET === "__NONE__" ? null : process.env.IT_SECRET;
    const now = process.env.IT_NOW === "__NONE__" ? undefined : Number(process.env.IT_NOW);
    process.stdout.write(await classifyToken(tok, sec, now, process.env.IT_ENT));
    """
    env = dict(os.environ)
    env["IT_TOKEN"] = token if token is not None else "__NONE__"
    env["IT_SECRET"] = secret if secret else "__NONE__"
    env["IT_NOW"] = "__NONE__" if now is None else str(now)
    env["IT_ENT"] = ent
    out = subprocess.run(
        [node, "--input-type=module", "-e", script],
        capture_output=True, text=True, timeout=60, env=env,
    )
    assert out.returncode == 0, f"node failed: {out.stderr}"
    return out.stdout.strip()


# ── the worker's own suite, inside the normal pytest run ────────────────────

def test_the_WORKER_test_suite_passes():
    """⭐ RUN HERE SO IT CANNOT BE FORGOTTEN. A second test command that lives
    only in a README is a suite that stops being run."""
    out = subprocess.run([node, "--test"], cwd=str(WORKER_DIR),
                         capture_output=True, text=True, timeout=300)
    assert out.returncode == 0, (out.stdout or "") + (out.stderr or "")


# ── cross-runtime agreement ─────────────────────────────────────────────────

def test_a_PYTHON_minted_token_is_VALID_in_the_WORKER():
    """⛔⛔ THE ONE THAT MATTERS. If this ever fails, every member's request
    classifies INVALID at the edge."""
    token = cet.mint()
    assert cet.verify(token)[0] == "VALID"          # Python agrees...
    assert _classify_in_node(token) == "EDGE_ENTITLEMENT_VALID"   # ...and so does JS


def test_the_NEGATIVE_CONTROL_a_wrong_secret_is_INVALID_in_the_worker(monkeypatch):
    """⭐ Without this, a verifier that always answered VALID would pass every
    other case in this file."""
    monkeypatch.setenv("CHART_EDGE_SECRET", "a-different-secret")
    token = cet.mint()
    assert _classify_in_node(token, secret=SECRET) == "EDGE_ENTITLEMENT_INVALID"


def test_an_EXPIRED_python_token_reads_EXPIRED_in_the_worker():
    token = cet.mint(now=1_000_000)
    later = 1_000_000 + cet.ttl_seconds() + 5
    assert cet.verify(token, now=later)[0] == "EXPIRED"
    assert _classify_in_node(token, now=later) == "EDGE_ENTITLEMENT_EXPIRED"


def test_a_MISSING_token_reads_MISSING_in_the_worker():
    assert _classify_in_node("__NONE__") == "EDGE_ENTITLEMENT_MISSING"


def test_a_TAMPERED_python_token_reads_INVALID_in_the_worker():
    import base64
    version, _body, sig = cet.mint().split(".")
    forged = base64.urlsafe_b64encode(json.dumps(
        {"v": 1, "iat": 0, "exp": 4102444800, "ent": "bars"},
        separators=(",", ":"), sort_keys=True).encode()).decode().rstrip("=")
    assert _classify_in_node(f"{version}.{forged}.{sig}") == "EDGE_ENTITLEMENT_INVALID"


def test_the_two_implementations_agree_on_the_WHOLE_MATRIX():
    """One table, both runtimes, so a divergence names itself."""
    import base64
    now = 2_000_000
    version, body, sig = cet.mint(now=now).split(".")
    good = f"{version}.{body}.{sig}"
    cases = {
        "VALID": (good, now + 1),
        "EXPIRED": (good, now + cet.ttl_seconds() + 1),
        "INVALID": (f"v9.{body}.{sig}", now + 1),
    }
    for expected, (token, at) in cases.items():
        py = cet.verify(token, now=at)[0]
        js = _classify_in_node(token, now=at)
        assert py == expected, f"python said {py} for {expected}"
        assert js == f"EDGE_ENTITLEMENT_{expected}", f"node said {js} for {expected}"


# ── the MACHINE trust path, across both runtimes ────────────────────────────

def test_a_PYTHON_minted_SERVICE_token_is_VALID_in_the_WORKER():
    """⛔⛔ THE PHASE 1.5 EQUIVALENT OF THE HEADLINE. Python mints the render
    capability; the REAL worker.js verifier judges it. If these ever disagree,
    every chart image silently loses its machine identity."""
    tok = cet.mint_service()
    assert cet.verify(tok, expect=cet.ENTITLEMENT_SERVICE)[0] == "VALID"
    assert _classify_in_node(tok, ent="service") == "EDGE_ENTITLEMENT_VALID"


def test_the_ENTITLEMENTS_DO_NOT_CROSS_in_the_worker_either():
    """⭐ The Python rail `test_the_two_trust_paths_CANNOT_BE_CONFUSED` asserted
    this on one side; this asserts the JS verifier enforces the same separation,
    which is the half that actually runs in production."""
    member, service = cet.mint(), cet.mint_service()
    # a member token judged as a machine → rejected
    assert _classify_in_node(member, ent="service") == "EDGE_ENTITLEMENT_INVALID"
    # a service token judged as a member → rejected
    assert _classify_in_node(service, ent="bars") == "EDGE_ENTITLEMENT_INVALID"


def test_the_NEGATIVE_CONTROL_for_service_tokens(monkeypatch):
    monkeypatch.setenv("CHART_EDGE_SECRET", "a-different-secret")
    tok = cet.mint_service()
    assert _classify_in_node(tok, secret=SECRET, ent="service") == "EDGE_ENTITLEMENT_INVALID"


def test_an_EXPIRED_service_token_reads_EXPIRED_in_the_worker():
    tok = cet.mint_service(now=1_000_000)
    later = 1_000_000 + cet.render_ttl_seconds() + 5
    assert cet.verify(tok, now=later, expect=cet.ENTITLEMENT_SERVICE)[0] == "EXPIRED"
    assert _classify_in_node(tok, now=later, ent="service") == "EDGE_ENTITLEMENT_EXPIRED"


def test_a_TAMPERED_service_token_reads_INVALID_in_the_worker():
    import base64
    version, _body, sig = cet.mint_service().split(".")
    forged = base64.urlsafe_b64encode(json.dumps(
        {"v": 1, "iat": 0, "exp": 4102444800, "ent": "service"},
        separators=(",", ":"), sort_keys=True).encode()).decode().rstrip("=")
    assert _classify_in_node(f"{version}.{forged}.{sig}", ent="service") == "EDGE_ENTITLEMENT_INVALID"
