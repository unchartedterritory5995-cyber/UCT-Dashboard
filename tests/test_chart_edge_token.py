"""The CHART EDGE ENTITLEMENT token — format, verification, entitlement rule.

WHAT THIS FILE EXISTS TO MAKE IMPOSSIBLE
----------------------------------------
Production routes member `/api/bars/{ticker}` through a Cloudflare Worker to the
bars-api tier; the web pod never sees those requests. This token is the only way
the edge can ever answer "is this request entitled?". Everything about it is
security-load-bearing: who may receive one, how long it lives, what it says, and
— above all — that a forged or stale one cannot be made to say VALID.

⛔ AND IT MUST NOT SAY WHO. The token answers an entitlement question, not an
identity question, so a rail below pins the payload's exact key set. A future
`user_id` needs a concrete security requirement and a deliberate edit, not a
convenient afternoon.
"""
from __future__ import annotations

import base64
import json
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from api import chart_edge_token as cet  # noqa: E402

SECRET = "unit-test-edge-secret"


@pytest.fixture(autouse=True)
def _secret(monkeypatch):
    monkeypatch.setenv("CHART_EDGE_SECRET", SECRET)
    monkeypatch.delenv("CHART_EDGE_TOKEN_TTL_SECONDS", raising=False)


def _payload_of(token: str) -> dict:
    body = token.split(".")[1]
    return json.loads(base64.urlsafe_b64decode(body + "=" * (-len(body) % 4)))


# ── the happy path ──────────────────────────────────────────────────────────

def test_a_minted_token_verifies():
    assert cet.verify(cet.mint())[0] == "VALID"


def test_the_token_carries_ONLY_what_verification_needs():
    """⛔⛔ NO IDENTITY IN THE TOKEN, PINNED AS AN EXACT SET.

    A superset assertion would let `user_id`/`email` be added silently. The edge
    asks "may this request read bars?" — bars are not user-scoped, so an
    identifier here would be data the edge cannot use and could leak, and it
    would be one short step from there into a cache key.
    """
    assert set(_payload_of(cet.mint())) == {"v", "iat", "exp", "ent"}


def test_the_token_is_opaque_to_a_reader_and_carries_no_email():
    token = cet.mint()
    assert "@" not in token
    assert "paid" not in token.lower()


# ── forgery ─────────────────────────────────────────────────────────────────

def test_a_TAMPERED_PAYLOAD_is_invalid():
    """⭐ The forged payload is a LONGER-LIVED one — the attack that matters is
    extending your own expiry, not corrupting bytes at random."""
    version, _body, sig = cet.mint().split(".")
    forged = base64.urlsafe_b64encode(json.dumps(
        {"v": 1, "iat": 0, "exp": 4102444800, "ent": "bars"},
        separators=(",", ":"), sort_keys=True).encode()).decode().rstrip("=")
    assert cet.verify(f"{version}.{forged}.{sig}")[0] == "INVALID"


def test_a_TAMPERED_SIGNATURE_is_invalid():
    version, body, _sig = cet.mint().split(".")
    assert cet.verify(f"{version}.{body}.YWJjZGVm")[0] == "INVALID"


def test_a_token_signed_with_ANOTHER_SECRET_is_invalid(monkeypatch):
    token = cet.mint()
    monkeypatch.setenv("CHART_EDGE_SECRET", "a-different-secret")
    assert cet.verify(token)[0] == "INVALID"


@pytest.mark.parametrize("bad", ["", "x", "a.b", "a.b.c.d", "v1..", "v1.%%%.%%%",
                                 "v1.!!!!.!!!!"])
def test_malformed_tokens_are_invalid_never_a_crash(bad):
    cls, _ = cet.verify(bad or None)
    assert cls in {"INVALID", "MISSING"}


def test_an_UNKNOWN_VERSION_is_invalid():
    _v, body, sig = cet.mint().split(".")
    assert cet.verify(f"v9.{body}.{sig}")[0] == "INVALID"


def test_a_WRONG_ENTITLEMENT_CLASS_is_invalid():
    assert cet.verify(cet.mint(entitlement="something-else"))[0] == "INVALID"


# ── time ────────────────────────────────────────────────────────────────────

def test_an_EXPIRED_token_is_EXPIRED_not_INVALID():
    """⛔ THEY ARE DIFFERENT FACTS AND THE SHADOW LOGS MUST TELL THEM APART.
    EXPIRED at volume means the TTL is too short or refresh is broken — a
    product bug. INVALID at volume means forgery or a secret mismatch — a
    security event. Collapsing them would hide whichever is rarer."""
    token = cet.mint(now=1_000_000)
    assert cet.verify(token, now=1_000_000 + cet.ttl_seconds() + 1)[0] == "EXPIRED"


def test_expiry_is_exactly_the_configured_TTL(monkeypatch):
    monkeypatch.setenv("CHART_EDGE_TOKEN_TTL_SECONDS", "120")
    p = _payload_of(cet.mint(now=5_000))
    assert p["exp"] - p["iat"] == 120


def test_a_token_is_still_valid_one_second_before_expiry():
    token = cet.mint(now=1_000_000)
    assert cet.verify(token, now=1_000_000 + cet.ttl_seconds() - 1)[0] == "VALID"


def test_a_FUTURE_token_beyond_skew_is_invalid():
    assert cet.verify(cet.mint(now=2_000_000), now=1_000_000)[0] == "INVALID"


def test_a_token_inside_the_SKEW_WINDOW_is_valid():
    """⭐ Two clouds, two clocks. A web pod thirty seconds ahead of Cloudflare
    must not lock out every member it serves."""
    now = 1_000_000
    assert cet.verify(cet.mint(now=now + 30), now=now)[0] == "VALID"


@pytest.mark.parametrize("raw", ["", "0", "-5", "abc", "  "])
def test_a_NONSENSE_TTL_falls_back_to_the_default(monkeypatch, raw):
    """⚠️ `CHART_EDGE_TOKEN_TTL_SECONDS=0` would mint pre-expired tokens for
    every member at once. A bad value must read as 'unset', not as an outage."""
    monkeypatch.setenv("CHART_EDGE_TOKEN_TTL_SECONDS", raw)
    assert cet.ttl_seconds() == cet.DEFAULT_TTL_SECONDS


# ── configuration failure ───────────────────────────────────────────────────

def test_NO_SECRET_mints_nothing_and_raises_nothing(monkeypatch):
    """⛔ FAILS SAFE IN BOTH DIRECTIONS. No secret must mean 'no token' — never
    an exception, because this runs inside `/api/auth/me` and an exception there
    is a login outage; and never a token, because an unsigned artifact would be
    a forgeable one."""
    monkeypatch.delenv("CHART_EDGE_SECRET", raising=False)
    assert cet.mint() is None


def test_NO_SECRET_admits_nobody(monkeypatch):
    token = cet.mint()
    monkeypatch.delenv("CHART_EDGE_SECRET", raising=False)
    assert cet.verify(token)[0] == "INVALID"


def test_a_MISSING_token_is_MISSING():
    assert cet.verify(None)[0] == "MISSING"
    assert cet.verify("")[0] == "MISSING"


# ── the entitlement rule ────────────────────────────────────────────────────

@pytest.mark.parametrize("user,plan,expected", [
    ({"id": "u", "role": "user"}, "pro", True),
    ({"id": "u", "role": "user"}, "premium", True),
    ({"id": "u", "role": "user"}, "lifetime", True),
    ({"id": "u", "role": "admin"}, "free", True),
    ({"id": "u", "role": "user"}, "comped", True),
    ({"id": "u", "role": "user"}, "free", False),
    ({"id": "u", "role": "user"}, None, False),
])
def test_the_entitlement_rule_is_the_CANONICAL_one(user, plan, expected):
    """⛔⛔ `comped` IS THE CASE THAT CATCHES A SECOND OPINION.

    `_access_payload`'s `paid_equiv` — the obvious thing to reuse — is admin OR
    paid plan OR active trial, and does NOT include `comped`. `meets_plan_gate`,
    which `require_bars_access` enforces at the origin, DOES. Minting from
    `paid_equiv` would hand the edge a stricter rule than the origin's and
    produce precisely the split the brief forbids: a comped member the origin
    admits and the edge would later refuse.
    """
    assert cet.is_entitled(user, plan) is expected


def test_an_ACTIVE_TRIAL_is_entitled(monkeypatch):
    import api.middleware.auth_middleware as am
    monkeypatch.setattr(am, "is_account_in_trial", lambda _u: True)
    assert cet.is_entitled({"id": "u", "role": "user"}, "free") is True


def test_the_COOKIE_PATH_does_not_reach_the_historical_cache_surfaces():
    """⭐⭐ PATH SCOPE, ASSERTED AS THE RFC DEFINES IT.

    RFC 6265 sends a `Path=/api/bars` cookie to `/api/bars` and to
    `/api/bars/<x>` (the remainder begins with `/`), but NOT to
    `/api/bars-history/...` or `/api/bars-today-pack` (the remainder begins with
    `-`). That is exactly the Worker Route's scope. It also means Phase 1 cannot
    put a per-member value anywhere near the shared historical edge cache this
    phase is forbidden to touch — the token is never sent there at all.
    """
    def rfc6265_sends(cookie_path: str, request_path: str) -> bool:
        if request_path == cookie_path:
            return True
        if not request_path.startswith(cookie_path):
            return False
        return cookie_path.endswith("/") or request_path[len(cookie_path)] == "/"

    p = cet.COOKIE_PATH
    assert rfc6265_sends(p, "/api/bars/AAPL")
    assert rfc6265_sends(p, "/api/bars")
    assert not rfc6265_sends(p, "/api/bars-history/AAPL")
    assert not rfc6265_sends(p, "/api/bars-today-pack")
    assert not rfc6265_sends(p, "/api/barspack/manifest")
    assert not rfc6265_sends(p, "/api/coverage")
    # ⛔ and so it never reaches the history lake route — which is why a second path exists:
    assert not rfc6265_sends(p, "/api/hist/v1/index/s-AAPL.json")

    # The history lake's cookie path reaches the lake's route and nothing else.
    h = cet.HIST_COOKIE_PATH
    assert rfc6265_sends(h, "/api/hist/v1/index/s-AAPL.json")
    assert rfc6265_sends(h, "/api/hist/packs/AAPL/1/2026-11.pack")
    for other in ("/api/history/AAPL", "/api/histogram", "/api/bars/AAPL", "/api/bars-history/AAPL",
                  "/api/bars-today-pack", "/api/coverage", "/api/auth/me"):
        assert not rfc6265_sends(h, other), other
    # The live chart stream's cookie path reaches that one stream and nothing else.
    st = cet.STREAM_COOKIE_PATH
    assert rfc6265_sends(st, "/api/stream/bars")
    for other in ("/api/stream/prices", "/api/stream/bars-v3", "/api/stream", "/api/stream/status",
                  "/api/bars/AAPL", "/api/auth/me"):
        assert not rfc6265_sends(st, other), other
    # The first-frame seed's cookie path reaches the seed route and nothing else.
    sd = cet.SEED_COOKIE_PATH
    assert rfc6265_sends(sd, "/api/seed/v1/latest.json")
    assert rfc6265_sends(sd, "/api/seed/v1/20261120T1430Z/60.ffs")
    for other in ("/api/seed-other", "/api/seeds", "/api/bars/AAPL", "/api/hist/v1/index/AAPL.json",
                  "/api/auth/me", "/api/bars-today-pack"):
        assert not rfc6265_sends(sd, other), other
    # The pushed list prices' cookie path reaches that one stream and nothing else (api/routers/quote_stream.py).
    qt = cet.QUOTES_COOKIE_PATH
    assert rfc6265_sends(qt, "/api/stream/quotes")
    for other in ("/api/stream/prices", "/api/stream/bars", "/api/stream/quotes-v2", "/api/stream", "/api/stream/status",
                  "/api/bars/AAPL", "/api/auth/me", "/api/live-prices"):
        assert not rfc6265_sends(qt, other), other
    assert cet.COOKIE_PATHS == (cet.COOKIE_PATH, cet.HIST_COOKIE_PATH, cet.STREAM_COOKIE_PATH, cet.SEED_COOKIE_PATH,
                                cet.QUOTES_COOKIE_PATH)


def test_the_HISTORY_cookie_path_IS_the_worker_route_prefix():
    """⛔ ONE FACT IN TWO FILES, READ FROM BOTH. The Worker answers `/api/hist/...` (history.js
    `HIST_PREFIX`); the cookie must be scoped to exactly that prefix, or members get 401 there
    (the 2026-11-17 production finding) or the token travels wider than the route."""
    import pathlib
    import re
    src = (pathlib.Path(__file__).resolve().parents[1] / "edge" / "bars-edge-router" / "history.js").read_text(encoding="utf-8")
    m = re.search(r'export const HIST_PREFIX = "([^"]+)";', src)
    assert m, "HIST_PREFIX not found in history.js"
    assert m.group(1) == cet.HIST_COOKIE_PATH + "/", (m.group(1), cet.HIST_COOKIE_PATH)



def test_the_QUOTES_cookie_path_IS_the_worker_quotes_stream_path():
    """ONE FACT IN TWO FILES, READ FROM BOTH: the Worker routes `/api/stream/quotes` to stream-edge
    (stream.js `STREAM_QUOTES_PATH`), and stream-edge admits by this cookie alone."""
    import pathlib
    import re
    src = (pathlib.Path(__file__).resolve().parents[1] / "edge" / "bars-edge-router" / "stream.js").read_text(encoding="utf-8")
    m = re.search(r'export const STREAM_QUOTES_PATH = "([^"]+)";', src)
    assert m, "STREAM_QUOTES_PATH not found in stream.js"
    assert m.group(1) == cet.QUOTES_COOKIE_PATH

# ── the MACHINE trust path (Phase 1.5) ──────────────────────────────────────

def test_a_service_token_carries_the_SERVICE_entitlement():
    assert _payload_of(cet.mint_service())["ent"] == cet.ENTITLEMENT_SERVICE


def test_a_service_token_verifies_as_a_SERVICE_token():
    assert cet.verify(cet.mint_service(), expect=cet.ENTITLEMENT_SERVICE)[0] == "VALID"


def test_the_two_trust_paths_CANNOT_BE_CONFUSED():
    """⛔⛔ THE HEADLINE OF PHASE 1.5.

    A render capability replayed in the member cookie must be INVALID, and a
    member's session token presented as a machine credential must be INVALID
    too. Without this the short-lived machine token and the long-lived member
    token become interchangeable, and the weaker transport sets the bar for both.
    """
    member = cet.mint()
    service = cet.mint_service()
    # the service token is not a member
    assert cet.verify(service, expect=cet.ENTITLEMENT_BARS)[0] == "INVALID"
    # the member token is not a machine
    assert cet.verify(member, expect=cet.ENTITLEMENT_SERVICE)[0] == "INVALID"
    # …and each is still valid in its own lane
    assert cet.verify(member)[0] == "VALID"
    assert cet.verify(service, expect=cet.ENTITLEMENT_SERVICE)[0] == "VALID"


def test_the_service_token_carries_NO_identity_either():
    assert set(_payload_of(cet.mint_service())) == {"v", "iat", "exp", "ent"}


def test_the_render_TTL_is_much_SHORTER_than_the_member_TTL():
    """⭐ A capability for ONE render, not a session. Measured against real
    renders (~1.7-2.2 s warm, 28 s worst observed) with room to spare, while
    keeping the replay window far below the member token's."""
    p = _payload_of(cet.mint_service(now=5_000))
    assert p["exp"] - p["iat"] == cet.DEFAULT_RENDER_TTL_SECONDS
    assert cet.DEFAULT_RENDER_TTL_SECONDS < cet.DEFAULT_TTL_SECONDS


def test_the_render_TTL_is_configurable(monkeypatch):
    monkeypatch.setenv("CHART_EDGE_RENDER_TOKEN_TTL_SECONDS", "45")
    assert cet.render_ttl_seconds() == 45
    p = _payload_of(cet.mint_service(now=5_000))
    assert p["exp"] - p["iat"] == 45


@pytest.mark.parametrize("raw", ["", "0", "-9", "abc"])
def test_a_NONSENSE_render_TTL_falls_back(monkeypatch, raw):
    monkeypatch.setenv("CHART_EDGE_RENDER_TOKEN_TTL_SECONDS", raw)
    assert cet.render_ttl_seconds() == cet.DEFAULT_RENDER_TTL_SECONDS


def test_an_EXPIRED_service_token_is_EXPIRED():
    tok = cet.mint_service(now=1_000_000)
    later = 1_000_000 + cet.render_ttl_seconds() + 1
    assert cet.verify(tok, now=later, expect=cet.ENTITLEMENT_SERVICE)[0] == "EXPIRED"


def test_NO_SECRET_mints_no_service_token(monkeypatch):
    monkeypatch.delenv("CHART_EDGE_SECRET", raising=False)
    assert cet.mint_service() is None


def test_the_SEED_cookie_path_IS_the_worker_route_prefix():
    """⛔ ONE FACT IN TWO FILES, READ FROM BOTH (the history lake's rule, for the seed route). The Worker
    answers `/api/seed/...` (seed.js `SEED_PREFIX_PATH`); the cookie must be scoped to exactly that prefix,
    or members get 401 there (the 2026-11-20 production finding) or the token travels wider than the route."""
    import pathlib
    import re
    src = (pathlib.Path(__file__).resolve().parents[1] / "edge" / "bars-edge-router" / "seed.js").read_text(encoding="utf-8")
    m = re.search(r'export const SEED_PREFIX_PATH = "([^"]+)";', src)
    assert m, "SEED_PREFIX_PATH not found in seed.js"
    assert m.group(1) == cet.SEED_COOKIE_PATH + "/", (m.group(1), cet.SEED_COOKIE_PATH)
