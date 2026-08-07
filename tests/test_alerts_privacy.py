"""Phase C — the in-app alert feed is a PER-MEMBER feed, not one global list.

🔴 THE DEFECT UNDER TEST, verified live on production 2026-08-06:

  1. ``GET /api/alerts`` carried NO auth dependency. An unauthenticated request
     from the public internet returned HTTP 200 and 8 alerts.
  2. ``api/services/alerts.py`` stored every alert — system broadcast AND
     per-member — in ONE cache list under the key ``"alerts"``, capped at 100
     and shared by every user and every subsystem. ``mark_read`` /
     ``mark_all_read`` walked that same global list, so one caller could mark
     another member's alerts read.
  3. ``watchlist_alert_service`` (the member delivery path: price alerts,
     indicator alerts, catalyst alerts, calendar alerts, awareness insights)
     writes into it.

Today's live sample was benign only by accident — it happened to hold
broadcast-shaped rows. The leak becomes real member-data exposure the moment a
member's watchlist or indicator alert fires, and `AlertBell.jsx` drives a
browser notification AND a sound off this exact payload.

⚠️ AUTHENTICATION ALONE IS NOT THE FIX. On one global list, adding
``Depends(get_current_user)`` stops the anonymous read and leaves every
logged-in member reading every other member's alerts. Both halves are tested
here, and the mutation harness proves each half has its OWN gate — the
A-cannot-see-B test kills the scoping mutation with the auth dependency fully
intact.

⚠️ EVERY REFUSAL CLAIM IN THIS FILE IS PRECEDED BY THE MEASUREMENT OF THE EXACT
THING IT REFUSES. "Nobody saw it" is a vacuous pass if the fixture produced no
alert, or if the reader that is supposed to see it is broken for an unrelated
reason. So each refusal test first proves (a) the alert exists in the store and
(b) the member who OWNS it is served it over HTTP, and each "B cannot see A's"
claim first proves B's reader works by serving B a broadcast alert on the same
call.
"""
from __future__ import annotations

import ast
import inspect

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.middleware.auth_middleware import get_current_user
from api.routers import alerts as alerts_router
from api.services import alerts as alerts_svc
from api.services import watchlist_alert_service as wls
from api.services.cache import cache


# ─── fixtures ────────────────────────────────────────────────────────────────

@pytest.fixture(autouse=True)
def clean_alert_store():
    """The TTLCache is a process-global singleton — isolate every test."""
    def _purge():
        cache.invalidate("alerts")
        cache.delete_prefix("alerts:")
    _purge()
    yield
    _purge()


@pytest.fixture
def anon_client() -> TestClient:
    """A client with the REAL auth dependency and no session cookie.

    No ``dependency_overrides`` — this exercises the shipped dependency, so a
    tree with the dependency deleted serves this client the feed.
    """
    app = FastAPI()
    app.include_router(alerts_router.router)
    return TestClient(app)


@pytest.fixture
def member_clients():
    """A factory: ``member_clients("u_a")`` → a client authenticated as u_a."""
    def _make(user_id: str, role: str = "member") -> TestClient:
        app = FastAPI()
        app.include_router(alerts_router.router)
        app.dependency_overrides[get_current_user] = (
            lambda: {"id": user_id, "email": f"{user_id}@example.test", "role": role}
        )
        return TestClient(app)
    return _make


@pytest.fixture
def quiet_channels(monkeypatch):
    """Silence email + Discord so the delivery path touches no network.

    ⛔ It does NOT replace ``add_alert`` — that is the in-app bell, the channel
    whose STORE is the subject of this file. Replacing it would replace the
    thing under test.
    """
    monkeypatch.setattr(wls, "send_email", lambda *a, **k: None)
    monkeypatch.setattr(wls, "_get_user_email", lambda uid: None)
    monkeypatch.setattr(alerts_svc, "_fire_discord", lambda payload: None)


def _deliver_to_member(user_id: str, sym: str, title: str) -> None:
    """Fire ONE real member alert through the shipped delivery path.

    `source="catalyst_alert"` is a real caller value that is NOT
    `indicator_alert`, so the Phase-C fire-once claim gate (which needs an
    `indicator_alerts` row) does not swallow the fixture.
    """
    wls.deliver_alert_payload(
        user_id=user_id,
        sym=sym,
        title=title,
        message=f"{sym} did something only {user_id} asked to be told about.",
        source="catalyst_alert",
        extra_data={"ticker": sym},
    )


def _titles(payload) -> list[str]:
    return [a.get("title") for a in payload]


# ─── 1. the anonymous read ───────────────────────────────────────────────────

def test_the_alert_feed_is_not_readable_without_a_session(
    anon_client, member_clients
):
    """The auth half, on a BROADCAST-ONLY fixture.

    Deliberately not a member alert: this claim must fail when — and only when
    — the dependency is missing, never as a side effect of per-member routing
    being broken. A member is served the row first, so "the endpoint works, it
    just refuses YOU" is measured rather than assumed.
    """
    alerts_svc.alert_regime_change("Markup", "Distribution", 45)
    assert (cache.get("alerts") or []), (
        "PRECONDITION UNMET (401 door): the fixture stored no alert, so a 401 "
        "here would refuse nothing"
    )
    served = member_clients("u_a").get("/api/alerts?limit=20")
    assert served.status_code == 200 and "Regime: Distribution" in _titles(served.json()), (
        "PRECONDITION UNMET (401 door): a signed-in member is not served the "
        "feed either — the endpoint is broken, not guarded"
    )

    r = anon_client.get("/api/alerts?limit=20")
    assert r.status_code == 401, (
        "UNAUTHENTICATED READ: GET /api/alerts served a caller with no session "
        f"(status {r.status_code}, {len(r.text)} bytes of feed)"
    )


def test_an_unauthenticated_request_cannot_read_a_members_alert(
    anon_client, member_clients, quiet_channels
):
    """The live defect, end to end.

    THE MEASUREMENT COMES FIRST: the member's alert is delivered, proven to
    exist in the store, and proven to be SERVED to its owner over HTTP. Only
    then is the anonymous request refused — so a green here can never mean
    "the fixture produced nothing".
    """
    _deliver_to_member("u_owner", "INOD", "Alert: INOD is up 30%")

    # (a) the alert exists in the store, and it is the member's, not broadcast.
    owned = cache.get("alerts:u:u_owner") or []
    assert len(owned) == 1, (
        "PRECONDITION UNMET (anon door): the fixture stored no member alert, so "
        "this test would refuse nothing"
    )
    alert_id = owned[0]["id"]
    assert cache.get("alerts") in (None, []), (
        "PRECONDITION UNMET (anon door): a member alert landed in the BROADCAST "
        "list — that is the leak itself, measured at the store"
    )

    # (b) the owner IS served it over HTTP — the reader works.
    mine = member_clients("u_owner").get("/api/alerts?limit=20")
    assert mine.status_code == 200
    assert alert_id in [a["id"] for a in mine.json()], (
        "PRECONDITION UNMET (anon door): the owner's own authenticated read did "
        "not return the alert, so the refusal below proves nothing"
    )

    # (c) …and the public internet is refused.
    r = anon_client.get("/api/alerts?limit=20")
    assert r.status_code == 401, (
        "LEAK: GET /api/alerts served an UNAUTHENTICATED caller "
        f"(status {r.status_code})"
    )
    assert alert_id not in r.text and "INOD" not in r.text, (
        "LEAK: the unauthenticated response body carried the member's alert"
    )


def test_an_unauthenticated_request_cannot_mark_anything_read(
    anon_client, member_clients, quiet_channels
):
    _deliver_to_member("u_owner", "AKAM", "Alert: AKAM crossed 95.00")
    alert_id = (cache.get("alerts:u:u_owner") or [])[0]["id"]

    assert anon_client.post(f"/api/alerts/{alert_id}/read").status_code == 401, (
        "LEAK: an unauthenticated caller could mark a member's alert read"
    )
    assert anon_client.post("/api/alerts/read-all").status_code == 401, (
        "LEAK: an unauthenticated caller could mark the whole feed read"
    )
    assert (cache.get("alerts:u:u_owner") or [])[0]["read"] is False, (
        "LEAK: the member's alert was mutated by an unauthenticated caller"
    )


# ─── 2. member A vs member B ─────────────────────────────────────────────────

def test_member_A_alert_is_invisible_to_member_B(member_clients, quiet_channels):
    """The half that authentication does NOT fix.

    B's reader is proven WORKING on the same call — a broadcast alert is placed
    first and B must see it. Without that, "B's list has no A-alert" would pass
    on a reader that returns an empty list for any reason at all.
    """
    alerts_svc.add_alert(
        "regime_change", "Regime: Distribution",
        "Market regime shifted — everyone sees this.",
    )
    _deliver_to_member("u_a", "PRIV", "Alert: PRIV hit u_a's private target")

    a_payload = member_clients("u_a").get("/api/alerts?limit=20").json()
    b_resp = member_clients("u_b").get("/api/alerts?limit=20")
    assert b_resp.status_code == 200
    b_payload = b_resp.json()

    # (a) A is served their own alert — the thing B must not see EXISTS.
    assert "Alert: PRIV hit u_a's private target" in _titles(a_payload), (
        "PRECONDITION UNMET (cross-member door): member A was not served their "
        "own alert, so B's blindness below proves nothing"
    )

    # (b) B's reader works — B is served the broadcast alert.
    assert "Regime: Distribution" in _titles(b_payload), (
        "PRECONDITION UNMET (cross-member door): member B's feed is empty of "
        "the BROADCAST alert too — B's reader is broken, not scoped"
    )

    # (c) …and B cannot see A's.
    assert "Alert: PRIV hit u_a's private target" not in _titles(b_payload), (
        "CROSS-MEMBER LEAK: member B was served member A's alert"
    )
    assert "PRIV" not in b_resp.text, (
        "CROSS-MEMBER LEAK: member A's symbol appeared in member B's payload"
    )


def test_a_broadcast_alert_reaches_every_member(member_clients):
    """The other direction: scoping must not silence the system broadcasts.

    `regime_change`, `scanner_match`, `exposure_shift`, `catalyst_mustknow` and
    the wire watchdog have NO user — they are broadcast-to-all by design.
    """
    alerts_svc.alert_regime_change("Markup", "Distribution", 45)
    alerts_svc.alert_scanner_match("NVDA", 92, "VCP")

    for uid in ("u_a", "u_b", "u_c"):
        titles = _titles(member_clients(uid).get("/api/alerts?limit=20").json())
        assert "Regime: Distribution" in titles, (
            f"OVER-SCOPED: the broadcast regime alert never reached {uid}"
        )
        assert "Scanner: NVDA (92pts)" in titles, (
            f"OVER-SCOPED: the broadcast scanner alert never reached {uid}"
        )


# ─── 3. read-state is per member ─────────────────────────────────────────────

def test_member_B_cannot_mark_member_A_alert_read(member_clients, quiet_channels):
    _deliver_to_member("u_a", "PRIV", "Alert: PRIV private to u_a")
    alert_id = (cache.get("alerts:u:u_a") or [])[0]["id"]

    a_before = member_clients("u_a").get("/api/alerts?limit=20").json()
    assert [a for a in a_before if a["id"] == alert_id and a["read"] is False], (
        "PRECONDITION UNMET (read door): A's alert is not present-and-unread, "
        "so B failing to change it proves nothing"
    )

    r = member_clients("u_b").post(f"/api/alerts/{alert_id}/read")
    assert r.status_code == 200 and r.json() == {"ok": False}, (
        "READ-STATE LEAK: member B's mark-read on member A's alert reported success"
    )

    a_after = member_clients("u_a").get("/api/alerts?limit=20").json()
    assert [a for a in a_after if a["id"] == alert_id and a["read"] is False], (
        "READ-STATE LEAK: member B marked member A's alert read"
    )


def test_mark_all_read_does_not_reach_another_members_alerts(
    member_clients, quiet_channels
):
    _deliver_to_member("u_a", "PRIV", "Alert: PRIV private to u_a")
    _deliver_to_member("u_b", "OTHR", "Alert: OTHR private to u_b")

    b_marked = member_clients("u_b").post("/api/alerts/read-all")
    assert b_marked.status_code == 200
    assert b_marked.json()["marked"] >= 1, (
        "PRECONDITION UNMET (mark-all door): member B marked nothing read, so "
        "A's alert surviving proves nothing"
    )

    a_payload = member_clients("u_a").get("/api/alerts?limit=20").json()
    assert [a for a in a_payload if a["read"] is False], (
        "READ-STATE LEAK: member B's mark-all-read cleared member A's alerts"
    )


def test_broadcast_read_state_is_per_member(member_clients):
    """A shared broadcast row, but each member's own read mark.

    On the pre-fix global list the `read` flag lived ON the shared dict, so the
    first member to open the bell marked it read for everyone.
    """
    alerts_svc.alert_regime_change("Markup", "Distribution", 45)
    bid = (cache.get("alerts") or [])[0]["id"]

    assert member_clients("u_a").post(f"/api/alerts/{bid}/read").json() == {"ok": True}

    b_payload = member_clients("u_b").get("/api/alerts?limit=20").json()
    row = [a for a in b_payload if a["id"] == bid]
    assert row, (
        "PRECONDITION UNMET (broadcast-read door): member B cannot see the "
        "broadcast alert at all"
    )
    assert row[0]["read"] is False, (
        "READ-STATE BLEED: member A's read mark on a broadcast alert flipped it "
        "read for member B"
    )
    a_row = [a for a in member_clients("u_a").get("/api/alerts?limit=20").json()
             if a["id"] == bid]
    assert a_row and a_row[0]["read"] is True, (
        "READ-STATE LOST: member A's own read mark on a broadcast alert did not stick"
    )


# ─── 4. Discord fires exactly once ───────────────────────────────────────────

@pytest.fixture
def discord_posts(monkeypatch):
    """Count REAL webhook posts, not a proxy.

    ``_fire_discord`` does ``import requests`` at call time, so patching
    ``requests.post`` counts what actually leaves the process — one post per
    webhook fire — and leaves ``_fire_discord`` itself (the thing whose call
    count is in dispute) untouched.
    """
    import requests

    posts: list[dict] = []

    def _post(url, **kw):
        posts.append({"url": url, **kw})

        class _R:
            status_code = 204
        return _R()

    monkeypatch.setattr(requests, "post", _post)
    monkeypatch.setattr(alerts_svc, "_DISCORD_WEBHOOK", "https://discord.test/webhook")
    return posts


def test_CONTROL_the_pre_fix_delivery_path_fired_discord_twice(
    discord_posts, monkeypatch
):
    """The control that proves the counter can count two.

    This is the pre-fix body of ``deliver_alert_payload`` verbatim: ``add_alert``
    at severity 'warning' (which fires the webhook itself) followed by an
    explicit ``_fire_discord``. If this reads 1, the counter is blind and the
    exactly-once assertion below is worthless.
    """
    alert = alerts_svc.add_alert(
        "catalyst_alert", "Catalyst: INOD", "INOD is a top catalyst today.",
        severity="warning", data={"symbol": "INOD"}, user_id="u_a",
    )
    alerts_svc._fire_discord({
        "type": "catalyst_alert", "severity": "warning",
        "title": "Catalyst: INOD", "message": "INOD is a top catalyst today.",
        "timestamp": alert["timestamp"][:16],
    })

    assert len(discord_posts) == 2, (
        "CONTROL BROKEN: the pre-fix double-fire measured "
        f"{len(discord_posts)} webhook post(s), not 2 — the counter cannot see "
        "both fires, so 'exactly once' below would pass vacuously"
    )


def test_delivery_fires_the_discord_webhook_exactly_once(
    discord_posts, monkeypatch
):
    monkeypatch.setattr(wls, "send_email", lambda *a, **k: None)
    monkeypatch.setattr(wls, "_get_user_email", lambda uid: None)

    _deliver_to_member("u_a", "INOD", "Catalyst: INOD")

    assert len(discord_posts) == 1, (
        "DUPLICATE DISCORD: one delivered alert produced "
        f"{len(discord_posts)} webhook post(s), expected exactly 1"
    )
    assert discord_posts[0]["url"] == "https://discord.test/webhook"
    body = discord_posts[0]["json"]["embeds"][0]
    assert "INOD" in body["title"], (
        "DISCORD CONTENT LOST: the surviving post does not carry the alert title"
    )


def test_price_alert_delivery_fires_the_discord_webhook_exactly_once(
    discord_posts, monkeypatch
):
    """The other member path — `_deliver_alert`, the watchlist price alert."""
    monkeypatch.setattr(wls, "send_email", lambda *a, **k: None)
    monkeypatch.setattr(wls, "_get_user_email", lambda uid: None)

    wls._deliver_alert(
        {"id": "a1", "user_id": "u_a", "sym": "AKAM",
         "direction": "above", "target_price": 95.0},
        96.25,
    )

    assert len(discord_posts) == 1, (
        "DUPLICATE DISCORD (price lane): one triggered price alert produced "
        f"{len(discord_posts)} webhook post(s), expected exactly 1"
    )
    assert (cache.get("alerts:u:u_a") or []), (
        "PRICE ALERT UNSCOPED: the triggered price alert did not land in the "
        "owning member's feed"
    )
    assert cache.get("alerts") in (None, []), (
        "PRICE ALERT LEAK: a member's triggered price alert landed in the "
        "BROADCAST list"
    )


# ─── 5. structural: the route declares the dependency ────────────────────────

def test_every_alerts_route_declares_the_auth_dependency():
    """AST, not grep — a comment mentioning Depends must not satisfy this.

    Behavioural coverage is above (the 401s); this is the belt that catches a
    NEW route added to this router without a dependency.
    """
    tree = ast.parse(inspect.getsource(alerts_router))
    routes = [n for n in ast.walk(tree)
              if isinstance(n, ast.FunctionDef)
              and any(isinstance(d, ast.Call)
                      and isinstance(d.func, ast.Attribute)
                      and d.func.value.id == "router"
                      for d in n.decorator_list)]
    assert routes, "AST SCAN READ NOTHING: no router-decorated function found"

    for fn in routes:
        defaults = fn.args.defaults + [d for d in fn.args.kw_defaults if d]
        depends = [d for d in defaults
                   if isinstance(d, ast.Call)
                   and getattr(d.func, "id", None) == "Depends"]
        assert depends, (
            f"UNGUARDED ROUTE: {fn.name} in api/routers/alerts.py has no "
            "Depends(...) parameter — it is reachable unauthenticated"
        )
        assert any(getattr(d.args[0], "id", None) == "get_current_user"
                   for d in depends), (
            f"WRONG GUARD: {fn.name} depends on something other than "
            "get_current_user"
        )
