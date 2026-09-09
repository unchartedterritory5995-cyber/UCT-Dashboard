"""HTTP-level tests for the Obsidian device push transport's two endpoints:
`POST /api/j2/notes/connectors/obsidian/redeem` (Task 5b -- exchanges a
connect code for a device token + creates the vault's `j2_note_sources`
row) and `POST .../obsidian/ingest` (Task 3 -- the plugin's push transport).

Spins up a minimal FastAPI app with just the note_sync router (mirrors
`tests/test_note_sync_router.py`'s pattern) against a temp auth.db, and
drives auth through the REAL device-token path (`obsidian_link.mint_
connect_code` / `redeem_connect_code` / `authenticate_device`) rather than a
dependency override -- there is no session cookie to override here, so the
token IS the credential under test.
"""

from __future__ import annotations

import json

import pytest
from cryptography.fernet import Fernet
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.middleware import auth_middleware as authmw
from api.routers import note_sync as note_sync_router
from api.services import auth_db
from api.services.journal_two.db import ensure_schema
from api.services.journal_two.note_connectors import connections, obsidian_link, obsidian_staging
from api.services.journal_two.note_connectors.providers.obsidian import ObsidianProvider

_URL = "/api/j2/notes/connectors/obsidian/ingest"
_REDEEM_URL = "/api/j2/notes/connectors/obsidian/redeem"


def _seed_user(conn, user_id: str, *, plan: str | None = "pro", status: str = "active") -> None:
    conn.execute(
        "INSERT INTO users (id, email, password_hash, display_name) VALUES (?, ?, 'pw', ?)",
        (user_id, f"{user_id}@example.test", user_id),
    )
    if plan is not None:
        conn.execute(
            "INSERT INTO subscriptions (id, user_id, plan, status) VALUES (?, ?, ?, ?)",
            (f"sub-{user_id}", user_id, plan, status),
        )
    conn.commit()


@pytest.fixture
def client(tmp_path, monkeypatch):
    dbfile = tmp_path / "auth.db"
    monkeypatch.setattr(auth_db, "_DB_PATH", str(dbfile))
    auth_db.init_db()  # base schema (users/subscriptions) -- ensure_schema owns only j2_* tables
    conn = auth_db.get_connection()
    ensure_schema(conn)
    _seed_user(conn, "user-a", plan="pro")
    _seed_user(conn, "user-b", plan="pro")
    _seed_user(conn, "user-free", plan=None)
    conn.close()

    monkeypatch.setenv("PUSH_SECRET", "test-push-secret")
    monkeypatch.setenv("NOTE_ENCRYPTION_KEY", Fernet.generate_key().decode())
    # The redeem endpoint gates on the SAME registry `configured()` check
    # `/obsidian/connect` uses to decide whether to mint a code at all -- a
    # code that could never be minted with this flag off shouldn't be able
    # to redeem with it off either. Ingest ALSO gates on it now (I2, 2026-09-
    # 02 review -- it previously didn't, so an already-redeemed device kept
    # pushing forever with the flag off; see `test_ingest_not_configured_
    # returns_503_not_a_500` below), so every test in this file that expects
    # a live ingest call to succeed needs this set -- which it is, here.
    monkeypatch.setenv("NOTE_SYNC_OBSIDIAN_ENABLED", "1")

    app = FastAPI()
    app.include_router(note_sync_router.router)
    return TestClient(app)


def _device_token(user_id: str, vault_id: str = "vault-1", label: str | None = "My Vault") -> str:
    code = obsidian_link.mint_connect_code(user_id)
    _, token = obsidian_link.redeem_connect_code(code, vault_id, label)
    return token


def _staging_rows(user_id: str, vault_id: str) -> list[dict]:
    conn = auth_db.get_connection()
    try:
        rows = conn.execute(
            "SELECT * FROM j2_obsidian_staging WHERE user_id = ? AND vault_id = ?",
            (user_id, vault_id),
        ).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def _manifest_paths(user_id: str, vault_id: str) -> set[str]:
    conn = auth_db.get_connection()
    try:
        rows = conn.execute(
            "SELECT vault_path FROM j2_obsidian_manifest WHERE user_id = ? AND vault_id = ?",
            (user_id, vault_id),
        ).fetchall()
        return {r["vault_path"] for r in rows}
    finally:
        conn.close()


def _login_as(client, user_id: str, *, plan: str = "pro") -> None:
    """`DELETE /{provider}` (disconnect) is session-cookie gated
    (`Depends(_paid)` -> `get_current_user_with_plan` -> `get_current_user`)
    -- unlike redeem/ingest, which authenticate off the device token alone.
    This fixture's `client` has no login flow, so disconnect tests override
    the two cookie-reading dependencies directly (mirrors
    `tests/test_note_sync_router.py`'s `_free_user` helper), pointed at a
    user already seeded (by `_seed_user`) in THIS test's real `users`/
    `subscriptions` tables -- the device-auth path's own `_require_paid_
    device_user` reads those tables directly and is untouched by this
    override, so the two auth paths stay independently exercised."""
    client.app.dependency_overrides[authmw.get_current_user] = \
        lambda: {"id": user_id, "role": "member"}
    client.app.dependency_overrides[authmw.get_current_user_with_plan] = \
        lambda: {"id": user_id, "plan": plan, "role": "member"}


def _redeem_via_http(client, user_id: str, vault_id: str = "vault-1", label: str | None = "My Vault") -> str:
    """Like `_device_token`, but through the REAL `/obsidian/redeem` HTTP
    endpoint rather than calling `obsidian_link.redeem_connect_code`
    directly -- the disconnect tests below need the `j2_note_connectors`
    row `obsidian_redeem` also writes (Task 5b's own `_upsert_connector_
    or_503` call), since `connections.delete_connector` 404s with nothing
    to disconnect otherwise. `_device_token`'s bare `redeem_connect_code`
    call is fine for ingest-only tests, which never touch that row."""
    code = obsidian_link.mint_connect_code(user_id)
    r = client.post(_REDEEM_URL, json={"code": code, "vaultId": vault_id, "label": label})
    assert r.status_code == 200, r.text
    return r.json()["token"]


def _note(vault_path: str, content_hash: str, body_md: str = "# body") -> dict:
    return {
        "vault_path": vault_path,
        "content_hash": content_hash,
        "body_md": body_md,
        "updated_at": "2026-09-02T00:00:00Z",
    }



@pytest.fixture(autouse=True)
def _no_auto_drain(monkeypatch):
    """Neutralise the post-`final` auto-drain for this module by default.

    A `final` ingest now kicks off the source's sync immediately, so that
    connecting a vault means "bring this vault into UCT" rather than "stage
    it and wait for the :23 tick". Every test BELOW drives staging -> sync
    step by step and asserts on ITS OWN sync's counts; with the drain live,
    those counts read 0 because the automatic pass already imported the
    notes (the notes still land -- only which pass imported them changes).
    Disabling it here keeps each of those tests measuring the thing it was
    written to measure. The drain has its own dedicated rail, which opts
    back in: test_a_final_batch_drains_the_vault_it_belongs_to.
    """
    import api.routers.note_sync as ns
    monkeypatch.setattr(ns, "_start_initial_sync", lambda *_a, **_k: None)


# ── auth ──────────────────────────────────────────────────────────────────

def test_an_authenticated_batch_lands_in_staging(client):
    token = _device_token("user-a")
    r = client.post(
        _URL,
        headers={"Authorization": f"Bearer {token}"},
        json={"consent": True, "notes": [_note("Notes/idea.md", "h1", "# Idea")]},
    )
    assert r.status_code == 200, r.text
    rows = _staging_rows("user-a", "vault-1")
    assert len(rows) == 1
    assert rows[0]["vault_path"] == "Notes/idea.md"
    assert rows[0]["content_hash"] == "h1"
    assert rows[0]["body_md"] == "# Idea"


def test_a_final_batch_drains_the_vault_it_belongs_to(client, monkeypatch):
    """⛔ Pushing a vault is the member's *import my vault* action.

    Before this wiring the plugin pushed the whole vault, the server staged
    every note, and the staged rows SAT there until the hourly `:23` tick
    swept them -- a member who had just connected saw an empty Notebook for
    up to an hour, with nothing running and nothing saying so.

    `final` is the plugin declaring "that was the whole vault", and it is the
    only safe moment to sweep: draining an INTERMEDIATE batch would import a
    partially-pushed vault and run delete detection against a manifest that
    does not exist yet.

    Goes through the REAL redeem so a `j2_note_sources` row exists exactly as
    it does in production, then drives the real ingest route.
    """
    import api.routers.note_sync as ns

    started: list[str] = []
    monkeypatch.setattr(ns, "_start_initial_sync", started.append)  # overrides _no_auto_drain

    code = obsidian_link.mint_connect_code("user-a")
    r = client.post(_REDEEM_URL, json={"code": code, "vaultId": "vault-drain", "label": "Drain"})
    assert r.status_code == 200, r.text
    token = r.json()["token"]
    source_id = r.json()["source"]["id"]
    hdr = {"Authorization": f"Bearer {token}"}

    r = client.post(_URL, headers=hdr,
                    json={"consent": True, "notes": [_note("a.md", "h1", "# A")]})
    assert r.status_code == 200, r.text
    assert started == [], "an intermediate batch drained a partially-pushed vault"

    r = client.post(_URL, headers=hdr, json={
        "consent": True,
        "notes": [_note("b.md", "h2", "# B")],
        "manifest": ["a.md", "b.md"],
        "final": True,
    })
    assert r.status_code == 200, r.text
    # ⛔ exactly once, and for THIS vault's source -- never another vault's.
    assert started == [source_id], f"final ingest drained the wrong source(s): {started}"


def test_an_unauthenticated_batch_is_refused(client):
    r = client.post(_URL, json={"consent": True, "notes": [_note("a.md", "h1")]})
    assert r.status_code == 401
    assert _staging_rows("user-a", "vault-1") == []

    r2 = client.post(
        _URL, headers={"Authorization": "Bearer garbage"},
        json={"consent": True, "notes": [_note("a.md", "h1")]},
    )
    assert r2.status_code == 401


def test_a_batch_cannot_write_under_another_user_even_if_the_body_claims_one(client):
    """The one that matters most: the request BODY names a different
    user_id, but the write must land only under the DEVICE's own user."""
    token_a = _device_token("user-a", vault_id="vault-1")
    r = client.post(
        _URL,
        headers={"Authorization": f"Bearer {token_a}"},
        json={
            "consent": True,
            "user_id": "user-b",
            "userId": "user-b",
            "notes": [_note("Notes/x.md", "h1", "mine")],
        },
    )
    assert r.status_code == 200, r.text
    assert len(_staging_rows("user-a", "vault-1")) == 1
    assert _staging_rows("user-b", "vault-1") == []
    # user-b's OWN vault-1 row (a different device/vault_id pair) must also
    # stay untouched -- confirms nothing about the write targeted user-b.
    assert _staging_rows("user-b", "vault-2") == []


def test_a_free_plan_device_is_paid_gated(client):
    token = _device_token("user-free", vault_id="vault-free")
    r = client.post(
        _URL, headers={"Authorization": f"Bearer {token}"},
        json={"consent": True, "notes": [_note("a.md", "h1")]},
    )
    assert r.status_code == 403
    assert _staging_rows("user-free", "vault-free") == []


def test_consent_is_required(client):
    token = _device_token("user-a")
    r = client.post(
        _URL, headers={"Authorization": f"Bearer {token}"},
        json={"consent": False, "notes": [_note("a.md", "h1")]},
    )
    assert r.status_code == 400
    assert _staging_rows("user-a", "vault-1") == []


# ── feature flag is a genuine kill switch (I2) ──────────────────────────────

def test_ingest_not_configured_returns_503_not_a_500(client, monkeypatch):
    """I2 (2026-09-02 review): `NOTE_SYNC_OBSIDIAN_ENABLED` is documented as
    the rollback lever -- flipping it off must stop ingestion from an
    ALREADY-connected device, not just refuse new mints/redemptions. The
    device below redeems its token WHILE the flag is on (mirroring a real
    member who connected before an incident), then the flag is turned off
    -- exactly the "we need to turn this off without a deploy" scenario the
    flag exists for."""
    token = _device_token("user-a")
    monkeypatch.delenv("NOTE_SYNC_OBSIDIAN_ENABLED", raising=False)
    r = client.post(
        _URL, headers={"Authorization": f"Bearer {token}"},
        json={"consent": True, "notes": [_note("a.md", "h1")]},
    )
    assert r.status_code == 503, r.text
    assert _staging_rows("user-a", "vault-1") == []


def test_ingest_not_configured_is_refused_before_authenticating_the_device(client, monkeypatch):
    """The kill switch must not depend on the device token being valid --
    it is checked first, so even a garbage/unauthenticated request is
    refused with the SAME 503 (not a 401), proving the check runs before
    `_authenticate_obsidian_device`."""
    monkeypatch.delenv("NOTE_SYNC_OBSIDIAN_ENABLED", raising=False)
    r = client.post(
        _URL, headers={"Authorization": "Bearer garbage"},
        json={"consent": True, "notes": [_note("a.md", "h1")]},
    )
    assert r.status_code == 503, r.text


# ── no-op on unchanged content_hash ──────────────────────────────────────────

def test_an_unchanged_content_hash_is_a_no_op(client):
    token = _device_token("user-a")
    body = {"consent": True, "notes": [_note("Notes/idea.md", "h1", "# Idea")]}

    r1 = client.post(_URL, headers={"Authorization": f"Bearer {token}"}, json=body)
    assert r1.status_code == 200
    assert r1.json()["written"] == 1
    first = _staging_rows("user-a", "vault-1")[0]

    r2 = client.post(_URL, headers={"Authorization": f"Bearer {token}"}, json=body)
    assert r2.status_code == 200
    assert r2.json()["written"] == 0
    assert r2.json()["skipped"] == 1
    second = _staging_rows("user-a", "vault-1")[0]
    assert second["received_at"] == first["received_at"], \
        "an unchanged content_hash must not rewrite the row or bump received_at"

    # A genuinely changed hash DOES write.
    changed = {"consent": True, "notes": [_note("Notes/idea.md", "h2", "# Idea v2")]}
    r3 = client.post(_URL, headers={"Authorization": f"Bearer {token}"}, json=changed)
    assert r3.status_code == 200
    assert r3.json()["written"] == 1
    third = _staging_rows("user-a", "vault-1")[0]
    assert third["content_hash"] == "h2"
    assert third["body_md"] == "# Idea v2"


# ── manifest replacement ──────────────────────────────────────────────────

def test_a_manifest_replaces_the_prior_one_atomically_and_a_non_final_push_leaves_it(client):
    # I3 (2026-09-02 review): a manifest may only name paths this vault has
    # actually staged body content for at some point (see `obsidian_staging.
    # ingest_batch`'s own docstring) -- "a.md"/"b.md" are pushed as real
    # notes here, in the SAME call as the manifest that first names them,
    # exactly like an honest plugin's first full sync would.
    token = _device_token("user-a")

    r1 = client.post(
        _URL, headers={"Authorization": f"Bearer {token}"},
        json={
            "consent": True,
            "notes": [_note("a.md", "h1"), _note("b.md", "h2")],
            "manifest": ["a.md", "b.md"],
            "final": True,
        },
    )
    assert r1.status_code == 200
    assert r1.json()["manifestReplaced"] is True
    assert _manifest_paths("user-a", "vault-1") == {"a.md", "b.md"}

    # A NON-final push, even with a different (smaller) manifest, must not
    # touch the stored manifest at all -- a partial push must never look
    # like mass deletion.
    r2 = client.post(
        _URL, headers={"Authorization": f"Bearer {token}"},
        json={"consent": True, "notes": [], "manifest": ["a.md"], "final": False},
    )
    assert r2.status_code == 200
    assert r2.json()["manifestReplaced"] is False
    assert _manifest_paths("user-a", "vault-1") == {"a.md", "b.md"}

    # A final push with no manifest field at all is also a no-touch.
    r3 = client.post(
        _URL, headers={"Authorization": f"Bearer {token}"},
        json={"consent": True, "notes": [], "final": True},
    )
    assert r3.status_code == 200
    assert r3.json()["manifestReplaced"] is False
    assert _manifest_paths("user-a", "vault-1") == {"a.md", "b.md"}

    # A final push with a genuinely new complete set replaces it atomically
    # -- old entries not in the new set are gone, new ones are present.
    # "c.md" is staged in this SAME call before the manifest names it (I3).
    r4 = client.post(
        _URL, headers={"Authorization": f"Bearer {token}"},
        json={"consent": True, "notes": [_note("c.md", "h3")], "manifest": ["c.md"], "final": True},
    )
    assert r4.status_code == 200
    assert r4.json()["manifestReplaced"] is True
    assert _manifest_paths("user-a", "vault-1") == {"c.md"}


# ── body size cap ────────────────────────────────────────────────────────────

def test_an_oversized_batch_is_refused_with_a_clean_4xx(client):
    token = _device_token("user-a")
    huge_body_md = "x" * (note_sync_router._MAX_OBSIDIAN_INGEST_BYTES + 1000)
    r = client.post(
        _URL, headers={"Authorization": f"Bearer {token}"},
        json={"consent": True, "notes": [_note("Notes/huge.md", "h1", huge_body_md)]},
    )
    assert 400 <= r.status_code < 500, r.text
    assert _staging_rows("user-a", "vault-1") == []


def test_one_oversized_note_is_isolated_at_ingest_not_the_whole_push(client):
    """⛔⛔ session-audit.md A1: before this fix, `_MAX_BODY_MD_LEN` was its
    OWN, independently-set number (1.5MB) checked BEFORE any write -- one
    note over it raised for the WHOLE call, so every OTHER honest note in
    the same push was silently discarded too (the exact failure shape this
    whole audit is about, just one layer earlier than `import_confirm`).
    A note over the (now storage-derived) limit is isolated instead: named
    in `tooLarge`, not staged, and every sibling note still stages."""
    token = _device_token("user-a")
    huge_body_md = "x" * (obsidian_staging._MAX_BODY_MD_LEN + 1000)
    good_notes = [_note(f"Notes/n{i}.md", f"h{i}") for i in range(12)]
    r = client.post(
        _URL, headers={"Authorization": f"Bearer {token}"},
        json={
            "consent": True,
            "notes": good_notes + [_note("Notes/huge.md", "hHuge", huge_body_md)],
        },
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["written"] == 12
    assert body["tooLarge"] == ["Notes/huge.md"]
    staged_paths = {row["vault_path"] for row in _staging_rows("user-a", "vault-1")}
    assert staged_paths == {n["vault_path"] for n in good_notes}
    assert "Notes/huge.md" not in staged_paths


# ── `updated_at` is client input -- validated, and the cursor is immune (C1) ─

def test_a_malformed_updated_at_is_clamped_not_stored_raw(client):
    """`updated_at` is a plugin-read filesystem mtime -- client input, never
    to be trusted as-is. A non-ISO-8601 garbage string must never land in
    `j2_obsidian_staging.updated_at` verbatim, where `list_changed`'s cursor
    comparison (a bare SQL string compare) would see it (2026-09-02 review,
    C1 defense-in-depth). It is CLAMPED (the note still syncs) rather than
    dropped or stored raw."""
    from datetime import datetime

    token = _device_token("user-a")
    bad = {**_note("Notes/bad.md", "h1", "# Bad"), "updated_at": "not-a-timestamp"}
    r = client.post(
        _URL, headers={"Authorization": f"Bearer {token}"},
        json={"consent": True, "notes": [bad]},
    )
    assert r.status_code == 200, r.text
    row = _staging_rows("user-a", "vault-1")[0]
    assert row["updated_at"] != "not-a-timestamp"
    datetime.fromisoformat(row["updated_at"])  # must parse cleanly -- not stored raw


def test_an_implausibly_future_updated_at_is_clamped_to_received_at(client):
    token = _device_token("user-a")
    far_future = {**_note("Notes/future.md", "h1", "# Future"), "updated_at": "9999-12-31T23:59:59Z"}
    r = client.post(
        _URL, headers={"Authorization": f"Bearer {token}"},
        json={"consent": True, "notes": [far_future]},
    )
    assert r.status_code == 200, r.text
    row = _staging_rows("user-a", "vault-1")[0]
    assert row["updated_at"] == row["received_at"], \
        "an implausible future updated_at must be clamped to this call's own received_at"
    assert row["updated_at"] != "9999-12-31T23:59:59Z"


async def test_an_absurd_future_updated_at_does_not_hide_subsequent_notes(client):
    """C1 -- THE regression test. Reproduces the security review's exact
    scenario end to end through the REAL router + staging + provider +
    sync engine (none stubbed): one note pushed with `updated_at=
    "9999-12-31T23:59:59Z"`, synced once, then a second, perfectly ordinary
    note pushed afterward. Before the fix, `engine.py`'s cursor-advance
    derived `max(ref.updated_at for ref in refs)` from the poisoned value,
    which no real timestamp could ever exceed -- the second note would
    never come back from `list_changed` on the next sync, forever, with
    `status: ok` and no error. This must go RED against the pre-fix code."""
    code = obsidian_link.mint_connect_code("user-a")
    r = client.post(_REDEEM_URL, json={"code": code, "vaultId": "vault-poison", "label": "Poison"})
    assert r.status_code == 200, r.text
    redeemed = r.json()
    token = redeemed["token"]
    source_id = redeemed["source"]["id"]

    poisoned = {**_note("Ideas/poison.md", "h1", "# Poison"), "updated_at": "9999-12-31T23:59:59Z"}
    ir1 = client.post(_URL, headers={"Authorization": f"Bearer {token}"},
                       json={"consent": True, "notes": [poisoned]})
    assert ir1.status_code == 200, ir1.text
    # The absurd value must not even have reached storage verbatim.
    assert _staging_rows("user-a", "vault-poison")[0]["updated_at"] != "9999-12-31T23:59:59Z"

    from api.services.journal_two import notes as notes_svc
    from api.services.journal_two.note_connectors import engine as sync_engine

    first = await sync_engine.sync_source(source_id, full=True, manual=True)
    assert first["status"] == "ok", first
    assert first["created"] == 1

    later = _note("Ideas/later.md", "h2", "# Later")  # an ordinary, present-day timestamp
    ir2 = client.post(_URL, headers={"Authorization": f"Bearer {token}"},
                       json={"consent": True, "notes": [later]})
    assert ir2.status_code == 200, ir2.text

    second = await sync_engine.sync_source(source_id, full=False, manual=True)
    assert second["status"] == "ok", second
    assert second["created"] == 1, (
        "the poisoned note's absurd updated_at must not have made this "
        "genuinely later note invisible to the sync cursor"
    )
    titles = {n["title"] for n in notes_svc.list_notes("user-a")}
    assert "Later" in titles


# ── POST /obsidian/redeem (Task 5b) ─────────────────────────────────────────

def test_redeem_with_a_valid_code_returns_a_token_and_creates_exactly_one_source(client):
    code = obsidian_link.mint_connect_code("user-a")
    r = client.post(
        _REDEEM_URL, json={"code": code, "vaultId": "vault-1", "label": "My Vault"},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["deviceId"]
    assert body["token"]
    assert body["vaultId"] == "vault-1"
    assert body["source"]["provider"] == "obsidian"
    assert body["source"]["remoteId"] == "vault-1"

    # The handed-back token actually authenticates as the redeeming user.
    device = obsidian_link.authenticate_device(body["token"])
    assert device is not None
    assert device["user_id"] == "user-a"
    assert device["vault_id"] == "vault-1"

    sources = [s for s in connections.list_sources("user-a") if s["provider"] == "obsidian"]
    assert len(sources) == 1
    assert sources[0]["remoteId"] == "vault-1"


def test_redeem_does_not_require_a_session_cookie(client):
    """This router mounts with no session middleware/dependency override at
    all in this fixture, so if `obsidian_redeem` accidentally depended on
    `get_current_user` this call would fail (missing session), not succeed.
    The plugin has no browser to hold a cookie in -- the connect code IS the
    credential."""
    code = obsidian_link.mint_connect_code("user-a")
    r = client.post(_REDEEM_URL, json={"code": code, "vaultId": "vault-1"}, cookies={})
    assert r.status_code == 200, r.text


def test_redeem_with_a_garbage_code_fails_cleanly_not_a_500(client):
    r = client.post(_REDEEM_URL, json={"code": "not-a-real-code", "vaultId": "vault-1"})
    assert r.status_code == 400, r.text
    assert connections.list_sources("user-a") == []


def test_redeem_with_an_expired_code_fails_cleanly(client):
    import base64
    import hashlib
    import hmac
    import time as _time

    ts = str(int(_time.time()) - obsidian_link._CONNECT_CODE_TTL_SECONDS - 60)
    nonce = "expired-test-nonce"
    payload = f"user-a:{ts}:{nonce}"
    sig = hmac.new(
        obsidian_link._signing_secret(), payload.encode("utf-8"), hashlib.sha256
    ).hexdigest()
    code = base64.urlsafe_b64encode(f"{payload}:{sig}".encode("utf-8")).decode("utf-8")
    r = client.post(_REDEEM_URL, json={"code": code, "vaultId": "vault-1"})
    assert r.status_code == 400, r.text
    assert connections.list_sources("user-a") == []


def test_redeem_with_an_already_used_code_fails_cleanly(client):
    code = obsidian_link.mint_connect_code("user-a")
    r1 = client.post(_REDEEM_URL, json={"code": code, "vaultId": "vault-1"})
    assert r1.status_code == 200, r1.text
    r2 = client.post(_REDEEM_URL, json={"code": code, "vaultId": "vault-1"})
    assert r2.status_code == 400, r2.text
    # The rejected replay created nothing beyond the first, legitimate source.
    assert len(connections.list_sources("user-a")) == 1


def test_redeem_missing_code_or_vault_id_400(client):
    r1 = client.post(_REDEEM_URL, json={"code": "", "vaultId": "vault-1"})
    assert r1.status_code == 400
    code = obsidian_link.mint_connect_code("user-a")
    r2 = client.post(_REDEEM_URL, json={"code": code, "vaultId": "   "})
    assert r2.status_code == 400
    assert connections.list_sources("user-a") == []


def test_redeem_not_configured_returns_503_not_a_500(client, monkeypatch):
    monkeypatch.delenv("NOTE_SYNC_OBSIDIAN_ENABLED", raising=False)
    code = obsidian_link.mint_connect_code("user-a")
    r = client.post(_REDEEM_URL, json={"code": code, "vaultId": "vault-1"})
    assert r.status_code == 503, r.text


def test_redeem_free_plan_user_is_paid_gated(client):
    code = obsidian_link.mint_connect_code("user-free")
    r = client.post(_REDEEM_URL, json={"code": code, "vaultId": "vault-free"})
    assert r.status_code == 403, r.text
    assert connections.list_sources("user-free") == []


def test_reredeeming_the_same_vault_does_not_duplicate_the_source_row(client):
    code1 = obsidian_link.mint_connect_code("user-a")
    r1 = client.post(
        _REDEEM_URL, json={"code": code1, "vaultId": "vault-1", "label": "My Vault"},
    )
    assert r1.status_code == 200, r1.text
    device_id1, token1 = r1.json()["deviceId"], r1.json()["token"]

    # A reinstall/reconnect for the SAME vault -- redeem_connect_code
    # ROTATES the existing device row rather than refusing (Task 2's own
    # contract); the source row must likewise stay singular, never duplicate.
    code2 = obsidian_link.mint_connect_code("user-a")
    r2 = client.post(_REDEEM_URL, json={"code": code2, "vaultId": "vault-1"})
    assert r2.status_code == 200, r2.text
    device_id2, token2 = r2.json()["deviceId"], r2.json()["token"]
    assert device_id2 == device_id1

    sources = [s for s in connections.list_sources("user-a")
               if s["provider"] == "obsidian" and s["remoteId"] == "vault-1"]
    assert len(sources) == 1

    # The OLD token from the first redemption no longer authenticates --
    # rotation, not an additional live credential.
    assert obsidian_link.authenticate_device(token1) is None
    assert obsidian_link.authenticate_device(token2) is not None


# ── end-to-end: mint -> redeem -> ingest -> visible through the provider ────

async def test_mint_redeem_ingest_chain_is_visible_through_the_provider_for_that_user_only(client):
    """The test that proves the chain is actually connected, in one function:
    mint a code, redeem it over HTTP, push a small final batch with a
    manifest over HTTP, then read it back through `providers/obsidian.py`'s
    OWN `list_changed`/`list_present_refs` -- the SAME hooks
    `engine.sync_source` calls -- for the redeeming user, confirm a
    different user sees nothing, and (the strongest proof available) run
    the REAL sync engine over the created source end to end."""
    code = obsidian_link.mint_connect_code("user-a")
    r = client.post(
        _REDEEM_URL, json={"code": code, "vaultId": "vault-e2e", "label": "E2E Vault"},
    )
    assert r.status_code == 200, r.text
    redeemed = r.json()
    token = redeemed["token"]

    ingest_body = {
        "consent": True,
        "notes": [
            _note("Ideas/one.md", "h1", "# One"),
            {**_note("Ideas/two.md", "h2", "# Two"), "updated_at": "2026-09-02T00:00:01Z"},
        ],
        "manifest": ["Ideas/one.md", "Ideas/two.md"],
        "final": True,
    }
    ir = client.post(_URL, headers={"Authorization": f"Bearer {token}"}, json=ingest_body)
    assert ir.status_code == 200, ir.text
    assert ir.json()["written"] == 2

    provider = ObsidianProvider(user_id="user-a", vault_id="vault-e2e")
    changed = await provider.list_changed({}, cursor=None)
    assert {ref.remote_id for ref in changed} == {"Ideas/one.md", "Ideas/two.md"}
    present = await provider.list_present_refs({})
    assert {ref.remote_id for ref in present} == {"Ideas/one.md", "Ideas/two.md"}

    # A different user's provider over the SAME vault_id sees nothing --
    # nothing about the mint -> redeem -> ingest chain leaked cross-tenant.
    other = ObsidianProvider(user_id="user-b", vault_id="vault-e2e")
    assert await other.list_changed({}, cursor=None) == []
    assert await other.list_present_refs({}) == []

    # Strongest proof of all: the REAL sync engine, over the REAL source
    # `redeem` created, actually completes -- this is exactly the path that
    # was unreachable before `obsidian_redeem` also wrote a `j2_note_
    # connectors` row (without one, `engine._resolve_credentials` returns
    # None and `_do_sync` raises before `list_changed` is ever called).
    from api.services.journal_two import notes as notes_svc
    from api.services.journal_two.note_connectors import engine as sync_engine

    source_id = redeemed["source"]["id"]
    result = await sync_engine.sync_source(source_id, full=True, manual=True)
    assert result["status"] == "ok", result
    assert result["created"] == 2
    titles = {n["title"] for n in notes_svc.list_notes("user-a")}
    assert titles == {"One", "Two"}


async def test_delete_detection_still_fires_through_the_real_sync_engine(client):
    """Not a C1/I2 regression -- existing behaviour the fix must leave
    alone. A vault_path dropped from a subsequent FINAL manifest still gets
    tagged `source-deleted` after the ordinary 2-strike miss-streak
    (`engine._run_delete_detection`, driven by `list_present_refs`, which
    this change never touched -- only `list_changed`'s cursor column moved)."""
    code = obsidian_link.mint_connect_code("user-a")
    r = client.post(_REDEEM_URL, json={"code": code, "vaultId": "vault-del", "label": "Del"})
    assert r.status_code == 200, r.text
    redeemed = r.json()
    token = redeemed["token"]
    source_id = redeemed["source"]["id"]

    ir = client.post(
        _URL, headers={"Authorization": f"Bearer {token}"},
        json={
            "consent": True,
            "notes": [_note("a.md", "h1", "# A"), _note("b.md", "h2", "# B")],
            "manifest": ["a.md", "b.md"],
            "final": True,
        },
    )
    assert ir.status_code == 200, ir.text

    from api.services.journal_two import notes as notes_svc
    from api.services.journal_two.note_connectors import engine as sync_engine

    def _tags_for(title: str) -> list:
        note = next(n for n in notes_svc.list_notes("user-a") if n["title"] == title)
        return note["tags"]

    first = await sync_engine.sync_source(source_id, full=True, manual=True)
    assert first["status"] == "ok", first
    assert first["created"] == 2
    assert "source-deleted" not in _tags_for("B")

    # "b.md" is removed from the vault -- the next FINAL manifest no longer
    # lists it (ingest_batch's atomic DELETE+INSERT replaces the whole set).
    ir2 = client.post(
        _URL, headers={"Authorization": f"Bearer {token}"},
        json={"consent": True, "notes": [], "manifest": ["a.md"], "final": True},
    )
    assert ir2.status_code == 200, ir2.text

    second = await sync_engine.sync_source(source_id, full=True, manual=True)
    assert second["status"] == "ok", second
    assert second["sourceDeleted"] == 0  # first miss -- streak 1, not severed yet
    assert "source-deleted" not in _tags_for("B")

    third = await sync_engine.sync_source(source_id, full=True, manual=True)
    assert third["status"] == "ok", third
    assert third["sourceDeleted"] == 1  # second consecutive miss -- severed
    assert "source-deleted" in _tags_for("B")


# ── ⛔⛔ session-audit.md A1 — THE defect this fix exists for ─────────────────
#
# Proven end to end through the real `engine.sync_source`, mirroring the
# audit's own reproduction: 13 notes staged, twelve trivial, one whose
# markdown clears the (now storage-derived) ingest boundary but whose
# converted TipTap JSON still exceeds `notes.MAX_BODY_JSON_BYTES` -- the
# "worst-case blowup estimate is not a guarantee" case
# (`test_obsidian_provider.py`'s own proof), which is exactly why
# `import_confirm`'s per-note isolation is the real backstop, not the
# ingest-side estimate alone. Before this fix: "notes in the member's
# notebook: 0 of 13", `status: ok`, cursor advanced anyway, and a plain
# re-sync could never recover any of them.

def _headed_short_markdown(n_sections: int) -> str:
    """Many short headings, each followed by a one-line note -- the shape
    `test_obsidian_provider.py::test_the_worst_case_blowup_estimate_is_not_
    a_guarantee` measures at ~9x blowup, far past the 4.7x the ingest-side
    estimate assumes. Sized (by the caller) to clear ingest but still blow
    past 1MB of JSON after conversion."""
    return "\n".join(f"## {i}\nnote {i}" for i in range(n_sections))


async def test_one_oversized_note_no_longer_destroys_the_whole_batch_and_a_resync_recovers_nothing_more_is_needed(
    client,
):
    # `_redeem_via_http` (not the bare `_device_token`) so the redeem
    # response hands back a real `j2_note_sources` row id -- `engine.
    # sync_source` needs one, exactly like the mint->redeem->ingest chain
    # test above.
    code = obsidian_link.mint_connect_code("user-a")
    redeem = client.post(_REDEEM_URL, json={"code": code, "vaultId": "vault-1", "label": "V"})
    assert redeem.status_code == 200, redeem.text
    token = redeem.json()["token"]
    source_id = redeem.json()["source"]["id"]

    good_notes = [_note(f"Notes/n{i}.md", f"h{i}") for i in range(12)]
    # 6,137 headed-short sections -> ~108KB of markdown (well under the
    # ~212KB ingest boundary) but ~1.02MB of converted JSON (over the 1MB
    # storage cap) -- clears the door this fix widened correctly derives,
    # and still needs `import_confirm`'s per-note isolation to survive.
    bad_md = _headed_short_markdown(6137)
    assert len(bad_md) < obsidian_staging._MAX_BODY_MD_LEN
    bad_note = _note("Notes/huge.md", "hHuge", bad_md)

    ingest = client.post(
        _URL, headers={"Authorization": f"Bearer {token}"},
        json={
            "consent": True,
            "notes": good_notes + [bad_note],
            "manifest": [n["vault_path"] for n in good_notes] + ["Notes/huge.md"],
            "final": True,
        },
    )
    assert ingest.status_code == 200, ingest.text
    assert ingest.json()["written"] == 13  # ingest accepts it -- clears the boundary
    assert ingest.json()["tooLarge"] == []

    from api.services.journal_two import notes as notes_svc
    from api.services.journal_two.note_connectors import connections, engine as sync_engine

    first = await sync_engine.sync_source(source_id, full=True, manual=True)
    # PARTIAL loss, honestly reported -- NOT "0 of 13", and NOT "ok" masking
    # a total loss (that condition is tested separately below).
    assert first["created"] == 12
    assert first["status"] == "ok"
    assert any("Notes/huge.md" in f or "could not be stored" in f for f in first["failures"])

    notes_now = notes_svc.list_notes("user-a")
    assert len(notes_now) == 12  # the twelve healthy siblings actually landed

    # A1: the cursor must NOT have advanced past the still-unstored note --
    # a plain re-sync (no plugin action, no re-push) must still see it.
    provider = ObsidianProvider(user_id="user-a", vault_id="vault-1")
    stored_cursor = connections.get_source_by_id(source_id)["cursor"]
    changed = await provider.list_changed({}, cursor=stored_cursor)
    assert "Notes/huge.md" in {ref.remote_id for ref in changed}, \
        "the cursor advanced past a note that was never stored -- it can never be recovered"

    # The re-sync (no edit, no re-push -- exactly what a scheduled nightly
    # sync would do on its own) keeps reporting the same honest failure and
    # does not re-lose or duplicate any of the twelve already-stored notes.
    second = await sync_engine.sync_source(source_id, full=True, manual=True)
    assert second["created"] == 0 and second["updated"] == 0  # all 12 already stored -> skipped
    assert any("Notes/huge.md" in f or "could not be stored" in f for f in second["failures"])
    assert len(notes_svc.list_notes("user-a")) == 12  # unchanged -- nothing lost, nothing duplicated


# ── the missing "live gate" case: a realistic large note that SUCCEEDS ──────
#
# Task 6's own live-gate report (`.superpowers/sdd/2026-09-02-obsidian-
# ingest-server/task-6-report.md`) says in its own "Concerns" section that it
# "does not attempt ... the 2MB ingest size cap" -- and it was never
# committed (session scratchpad only, per this repo's live-gate convention).
# `docs/feature_flags.json`'s NOTE_SYNC_OBSIDIAN_ENABLED entry names this
# exact gap as arming condition (3): "a live gate has synced a note of
# REALISTIC size ... nothing anywhere (unit, parity, or live gate) has ever
# imported or synced a note larger than a few KB." Every test above this one
# in the file either uses tiny fixtures or exercises the FAILURE side of the
# size cap (an oversized note correctly isolated). None of them proves the
# POSITIVE case through the real HTTP surface: mint/redeem/ingest/sync ALL
# over actual routes (unlike every other test in this file, which calls
# `sync_engine.sync_source` directly rather than the real
# `POST /sources/{id}/sync` route) with a note sized like a real member's
# long daily-notes/meeting-log file.

def _meeting_log_markdown(n: int) -> str:
    """Headings + bullets + checkboxes mixed -- a real Obsidian daily-notes/
    meeting-log shape, not a single giant paragraph. Measured blowup for
    this exact generator is ~3.55x (`convert.mddoc.md_to_tiptap`), squarely
    inside the audit's measured 3.4-4.7x range for ordinary notes."""
    lines = ["# Daily Notes"]
    for i in range(n):
        if i % 5 == 0:
            lines.append(f"## Session {i // 5}")
        if i % 3 == 0:
            lines.append(f"- [{'x' if i % 2 else ' '}] Follow up on action item {i} before next session")
        else:
            lines.append(f"- Discussed item {i} with the team about the trade plan")
    return "\n".join(lines)


def test_a_realistically_large_note_syncs_end_to_end_through_the_real_http_sync_route(client):
    """mint (direct, like every other test here -- `/connect` needs a login
    session this file's `client` fixture doesn't set up) -> redeem (HTTP) ->
    ingest (HTTP) -> sync via the REAL `POST /sources/{id}/sync` route (not
    `sync_engine.sync_source` called directly). The note is 3,550 sections
    of the shape above: measured 210,609 characters of markdown (just under
    the derived `_MAX_BODY_MD_LEN` ingest boundary of 212,765) and 740,540
    bytes of converted TipTap JSON (comfortably under the 1MB storage cap) --
    a genuinely large, realistically-shaped note near the boundary, not an
    arbitrary round number and not uniform filler."""
    from api.services.journal_two import notes as notes_svc

    code = obsidian_link.mint_connect_code("user-a")
    redeem = client.post(_REDEEM_URL, json={"code": code, "vaultId": "vault-1", "label": "V"})
    assert redeem.status_code == 200, redeem.text
    token = redeem.json()["token"]
    source_id = redeem.json()["source"]["id"]

    body_md = _meeting_log_markdown(3550)
    assert len(body_md) <= obsidian_staging._MAX_BODY_MD_LEN

    ingest = client.post(
        _URL, headers={"Authorization": f"Bearer {token}"},
        json={
            "consent": True,
            "notes": [_note("Daily/2026-09-02.md", "hBig", body_md)],
            "manifest": ["Daily/2026-09-02.md"],
            "final": True,
        },
    )
    assert ingest.status_code == 200, ingest.text
    assert ingest.json()["written"] == 1
    assert ingest.json()["tooLarge"] == []

    _login_as(client, "user-a")
    sync = client.post(f"/api/j2/notes/connectors/sources/{source_id}/sync", params={"full": True})
    assert sync.status_code == 200, sync.text
    body = sync.json()
    assert body["created"] == 1
    assert body["failures"] == []
    assert body["status"] == "ok"

    notes_now = notes_svc.list_notes("user-a")
    assert len(notes_now) == 1
    full_note = notes_svc.get_note("user-a", notes_now[0]["id"])
    body_json_bytes = len(json.dumps(full_note["bodyJson"]).encode("utf-8"))
    assert 100_000 < body_json_bytes < notes_svc.MAX_BODY_JSON_BYTES, (
        "fixture is no longer genuinely large -- this rail would pass vacuously")


# ── DELETE /{provider} (disconnect) revokes the device token ────────────────
#
# Reported by the implementer who built the redeem flow: disconnecting
# Obsidian via the standard `DELETE /{provider}` didn't clean up the
# `j2_obsidian_devices` row -- so `authenticate_device` (which reads that
# table alone, independent of the `j2_note_connectors` row disconnect
# removes) kept authenticating the plugin's OLD token after a member
# disconnected in the UI. Reproduced (pre-fix) with exactly the sequence
# below: redeem -> disconnect -> ingest with the old token succeeded (200)
# instead of being refused.

def test_disconnect_revokes_the_device_token_so_a_post_disconnect_ingest_is_refused(client):
    token = _redeem_via_http(client, "user-a", vault_id="vault-1")
    # Prove the token is live BEFORE disconnecting -- otherwise a 401 below
    # would prove nothing.
    pre = client.post(_URL, headers={"Authorization": f"Bearer {token}"},
                       json={"consent": True, "notes": [_note("a.md", "h1")]})
    assert pre.status_code == 200, pre.text

    _login_as(client, "user-a")
    r = client.delete("/api/j2/notes/connectors/obsidian")
    assert r.status_code == 200, r.text
    assert r.json()["disconnected"] is True

    # The device row is gone -- authenticate_device (the ingest endpoint's
    # ONLY auth check) must now return None for this exact token.
    assert obsidian_link.authenticate_device(token) is None

    post = client.post(
        _URL, headers={"Authorization": f"Bearer {token}"},
        json={"consent": True, "notes": [_note("b.md", "h2")]},
    )
    assert post.status_code == 401, post.text


def test_disconnect_does_not_revoke_a_different_members_device(client):
    token_a = _redeem_via_http(client, "user-a", vault_id="vault-1")
    token_b = _redeem_via_http(client, "user-b", vault_id="vault-1")  # different user, same vault_id

    _login_as(client, "user-a")
    r = client.delete("/api/j2/notes/connectors/obsidian")
    assert r.status_code == 200, r.text

    assert obsidian_link.authenticate_device(token_a) is None
    # user-b's device is a disjoint row (user_id is part of the primary
    # lookup) -- disconnecting user-a must never touch it.
    device_b = obsidian_link.authenticate_device(token_b)
    assert device_b is not None
    assert device_b["user_id"] == "user-b"

    post_b = client.post(
        _URL, headers={"Authorization": f"Bearer {token_b}"},
        json={"consent": True, "notes": [_note("still-mine.md", "h1")]},
    )
    assert post_b.status_code == 200, post_b.text


def test_reconnecting_after_disconnect_issues_a_new_token_not_the_revoked_one(client):
    old_token = _redeem_via_http(client, "user-a", vault_id="vault-1", label="My Vault")

    _login_as(client, "user-a")
    r = client.delete("/api/j2/notes/connectors/obsidian")
    assert r.status_code == 200, r.text
    assert obsidian_link.authenticate_device(old_token) is None

    # Reconnect: mint + redeem a fresh code for the same user/vault.
    code = obsidian_link.mint_connect_code("user-a")
    rr = client.post(_REDEEM_URL, json={"code": code, "vaultId": "vault-1", "label": "My Vault"})
    assert rr.status_code == 200, rr.text
    new_token = rr.json()["token"]

    assert new_token != old_token
    # The OLD token must stay dead -- a reconnect must never resurrect it.
    assert obsidian_link.authenticate_device(old_token) is None
    new_device = obsidian_link.authenticate_device(new_token)
    assert new_device is not None
    assert new_device["user_id"] == "user-a"
    assert new_device["vault_id"] == "vault-1"

    post = client.post(
        _URL, headers={"Authorization": f"Bearer {new_token}"},
        json={"consent": True, "notes": [_note("after-reconnect.md", "h1")]},
    )
    assert post.status_code == 200, post.text


# ── I3: a padded manifest defeats delete detection (2026-09-02 review) ──────
#
# Reviewer, verbatim: "engine.py:~636 guards on cardinality (len(seen_ids) <
# prev_count*0.5), not overlap. Measured: 200 fake paths vs 100 notes -> all
# 100 tagged over two passes." `engine.py` is shared by five other providers
# and off limits -- the fix is at the ingest boundary: a manifest may only
# name paths this vault has actually staged body content for.

async def test_a_manifest_padded_with_fabricated_paths_is_refused_not_silently_stored(client):
    """Reproduces the reviewer's measurement end to end through the REAL
    router + staging + sync engine (nothing stubbed): 100 real notes synced
    once, then a `final` manifest padded with 200 paths this vault never
    staged -- exactly the reviewer's scratchpad probe. Must go RED against
    current code: pre-fix, `ingest_batch` accepts the padded manifest
    (`manifestReplaced: True`), `list_present_refs` hands it to the engine as
    the complete remote set, and two full sync passes tag every one of the
    100 real notes `source-deleted` (the engine's own <50% cardinality guard
    never fires -- 200 seen ids is not fewer than 50, half of 100)."""
    code = obsidian_link.mint_connect_code("user-a")
    r = client.post(_REDEEM_URL, json={"code": code, "vaultId": "vault-i3", "label": "I3"})
    assert r.status_code == 200, r.text
    redeemed = r.json()
    token = redeemed["token"]
    source_id = redeemed["source"]["id"]

    real_notes = [_note(f"real-{i}.md", f"h{i}") for i in range(100)]
    real_paths = [n["vault_path"] for n in real_notes]
    r1 = client.post(
        _URL, headers={"Authorization": f"Bearer {token}"},
        json={"consent": True, "notes": real_notes, "manifest": real_paths, "final": True},
    )
    assert r1.status_code == 200, r1.text
    assert r1.json()["manifestReplaced"] is True
    assert _manifest_paths("user-a", "vault-i3") == set(real_paths)

    from api.services.journal_two import notes as notes_svc
    from api.services.journal_two.note_connectors import engine as sync_engine

    first = await sync_engine.sync_source(source_id, full=True, manual=True)
    assert first["status"] == "ok", first
    assert first["created"] == 100

    # The attack: 200 fabricated paths, none of which were ever pushed to
    # staging for this vault, replacing the honest 100-path manifest.
    fake_paths = [f"fake-{i}.md" for i in range(200)]
    r2 = client.post(
        _URL, headers={"Authorization": f"Bearer {token}"},
        json={"consent": True, "notes": [], "manifest": fake_paths, "final": True},
    )
    assert 400 <= r2.status_code < 500, (
        f"expected the padded manifest to be refused with a clean 4xx, got "
        f"{r2.status_code}: {r2.text}"
    )
    # The honest manifest must survive UNTOUCHED -- not replaced, not merged.
    assert _manifest_paths("user-a", "vault-i3") == set(real_paths)

    # Proof the exploit chain is actually closed, not just that the endpoint
    # complained: run the real engine twice (the miss-streak needs two
    # consecutive full passes) and confirm not one of the 100 real notes was
    # ever tagged `source-deleted`.
    for _ in range(2):
        result = await sync_engine.sync_source(source_id, full=True, manual=True)
        assert result["status"] == "ok", result
        assert result.get("sourceDeleted", 0) == 0, result
    tagged = [n for n in notes_svc.list_notes("user-a") if "source-deleted" in n["tags"]]
    assert tagged == [], f"{len(tagged)} real notes were mass-tagged by the padded manifest"


def test_a_manifest_may_name_a_path_staged_in_an_earlier_batch_not_just_this_one(client):
    """The legitimate case I3's guard must NOT break: a vault file that
    exists and was staged by an EARLIER batch (unchanged since, so this
    batch doesn't re-push its body) must still be nameable in a later
    batch's `final` manifest."""
    token = _device_token("user-a")
    r1 = client.post(
        _URL, headers={"Authorization": f"Bearer {token}"},
        json={"consent": True, "notes": [_note("old.md", "h1")], "final": False},
    )
    assert r1.status_code == 200, r1.text

    # A LATER, separate batch's manifest names "old.md" (staged earlier, not
    # in THIS batch's notes) alongside a genuinely new file pushed here.
    r2 = client.post(
        _URL, headers={"Authorization": f"Bearer {token}"},
        json={
            "consent": True,
            "notes": [_note("new.md", "h2")],
            "manifest": ["old.md", "new.md"],
            "final": True,
        },
    )
    assert r2.status_code == 200, r2.text
    assert r2.json()["manifestReplaced"] is True
    assert _manifest_paths("user-a", "vault-1") == {"old.md", "new.md"}


# ── I4: an empty final manifest is refused (2026-09-02 review) ─────────────

def test_an_empty_final_manifest_is_refused_not_silently_applied(client):
    """`manifest: [], final: true` used to sail through (`[] is not None`)
    and wipe `j2_obsidian_manifest` (measured: `manifestReplaced: True`,
    `list_present_refs` then returns 0 refs) -- the only thing that stopped
    it mass-deleting downstream was the engine's OWN inherited <50% guard,
    not anything this module did. An empty manifest is the plugin asserting
    "this vault has zero files," which is refused outright here rather than
    relying on that downstream guard a second time (I3 already showed relying
    on it is how the padded case slipped through)."""
    token = _device_token("user-a")
    r1 = client.post(
        _URL, headers={"Authorization": f"Bearer {token}"},
        json={"consent": True, "notes": [_note("a.md", "h1")], "manifest": ["a.md"], "final": True},
    )
    assert r1.status_code == 200, r1.text
    assert _manifest_paths("user-a", "vault-1") == {"a.md"}

    r2 = client.post(
        _URL, headers={"Authorization": f"Bearer {token}"},
        json={"consent": True, "notes": [], "manifest": [], "final": True},
    )
    assert 400 <= r2.status_code < 500, (
        f"expected an empty final manifest to be refused, got {r2.status_code}: {r2.text}"
    )
    assert _manifest_paths("user-a", "vault-1") == {"a.md"}, \
        "the honest manifest must survive an empty-manifest push untouched"


# ── I5: disconnect purges staged bodies + the manifest (2026-09-02 review) ──

async def test_disconnect_purges_staged_bodies_and_the_manifest_and_reconnect_does_not_resurrect_them(client):
    """Verbatim finding: "no `DELETE FROM j2_obsidian_staging` exists
    anywhere; disconnect leaves every pushed body forever, and reconnect
    resurrects it." Extends `revoke_devices` -- the SAME call site
    `disconnect` already uses for the device-token gap -- rather than a
    parallel cleanup path. Must go RED against current code: pre-fix,
    `j2_obsidian_staging`/`j2_obsidian_manifest` rows survive disconnect
    untouched, and a reconnect on the same vault_id sees them again."""
    token = _redeem_via_http(client, "user-a", vault_id="vault-i5")
    r = client.post(
        _URL, headers={"Authorization": f"Bearer {token}"},
        json={
            "consent": True,
            "notes": [_note("secret.md", "h1", "# stale secret content")],
            "manifest": ["secret.md"],
            "final": True,
        },
    )
    assert r.status_code == 200, r.text
    assert _staging_rows("user-a", "vault-i5") != []
    assert _manifest_paths("user-a", "vault-i5") == {"secret.md"}

    _login_as(client, "user-a")
    dr = client.delete("/api/j2/notes/connectors/obsidian")
    assert dr.status_code == 200, dr.text

    assert _staging_rows("user-a", "vault-i5") == [], \
        "disconnect must purge staged note bodies, not just the device token"
    assert _manifest_paths("user-a", "vault-i5") == set(), \
        "disconnect must purge the manifest too"

    # Reconnect the SAME vault_id -- a member who disconnected (possibly to
    # sever a leaked token) expects a fresh, empty vault-side view, not a
    # resurrection of whatever they pushed before.
    code = obsidian_link.mint_connect_code("user-a")
    rr = client.post(_REDEEM_URL, json={"code": code, "vaultId": "vault-i5", "label": "Reconnected"})
    assert rr.status_code == 200, rr.text

    provider = ObsidianProvider(user_id="user-a", vault_id="vault-i5")
    changed = await provider.list_changed({}, cursor=None)
    present = await provider.list_present_refs({})
    assert changed == [], "a reconnect must not resurrect the pre-disconnect note body"
    assert present == [], "a reconnect must not resurrect the pre-disconnect manifest"


# ── I6: disconnect invalidates outstanding connect codes (2026-09-02 review) ─

def test_a_connect_code_minted_before_disconnect_does_not_redeem_after_it(client):
    """Verbatim finding: "a pre-disconnect code redeems afterward into a
    full reconnection (device + connector + source). The redeem/revoke race
    is real." A member who disconnects expects it to be over -- a code
    minted minutes earlier must not silently re-establish everything. Must
    go RED against current code: pre-fix, `disconnect` revokes only ISSUED
    device rows and never touches an outstanding, not-yet-redeemed code."""
    _redeem_via_http(client, "user-a", vault_id="vault-i6")
    pre_code = obsidian_link.mint_connect_code("user-a")  # minted BEFORE disconnect

    _login_as(client, "user-a")
    dr = client.delete("/api/j2/notes/connectors/obsidian")
    assert dr.status_code == 200, dr.text

    r = client.post(_REDEEM_URL, json={"code": pre_code, "vaultId": "vault-i6-reconnect"})
    assert r.status_code == 400, (
        f"a connect code minted before disconnect must not redeem after it, got "
        f"{r.status_code}: {r.text}"
    )
    # No reconnection artifact of any kind (device row or note source) was
    # created by the stale code.
    assert connections.list_sources("user-a") == []
    conn = auth_db.get_connection()
    try:
        rows = conn.execute(
            "SELECT * FROM j2_obsidian_devices WHERE user_id = ? AND vault_id = ?",
            ("user-a", "vault-i6-reconnect"),
        ).fetchall()
    finally:
        conn.close()
    assert rows == []

    # A genuinely NEW code, minted AFTER the disconnect, must still work --
    # the fix must not lock the member out of a real reconnect.
    post_code = obsidian_link.mint_connect_code("user-a")
    r2 = client.post(_REDEEM_URL, json={"code": post_code, "vaultId": "vault-i6-reconnect"})
    assert r2.status_code == 200, r2.text


# ── I7: the body-size guard is bypassable (2026-09-02 review) ───────────────

async def test_the_bounded_body_reader_aborts_without_draining_an_unbounded_stream(client):
    """Verbatim finding: "the 2MB guard is bypassable via chunked/absent
    Content-Length before `await request.body()`." The old code called
    `await request.body()`, which reads the ENTIRE ASGI body stream into
    memory regardless of size before any length check ever runs -- a
    chunked/Content-Length-less request sails past the declared-header
    check and gets fully buffered before the post-read check can reject it.
    Drives `note_sync_router._read_bounded_body` directly against a stream
    that would yield several gigabytes if ever fully drained, and proves it
    aborts after pulling only a small, bounded number of chunks -- never
    the whole thing. Must go RED against current code: the function does
    not exist pre-fix (`AttributeError`)."""
    chunk = b"x" * 65536  # 64KB -- a realistic single ASGI receive() chunk
    pulled = 0

    async def huge_stream():
        nonlocal pulled
        for _ in range(100_000):  # ~6.4GB if ever fully drained
            pulled += 1
            yield chunk

    class FakeRequest:
        def stream(self):
            return huge_stream()

    from fastapi import HTTPException

    with pytest.raises(HTTPException) as exc_info:
        await note_sync_router._read_bounded_body(FakeRequest(), 2_000_000)
    assert exc_info.value.status_code == 400
    # The generator must have been abandoned almost immediately -- nowhere
    # near its full 100,000-chunk length -- proving the reader never buffers
    # anywhere close to the attacker's full claimed body.
    assert pulled < 100, f"stream was drained far past the limit: {pulled} chunks pulled"


def test_a_vault_that_would_exceed_the_staging_row_cap_is_refused(client, monkeypatch):
    """I7's second half: "no staging/manifest caps" -- a leaked token cannot
    reach another member's data, but can grow ONE vault's staging table
    without bound on a single-replica pod whose volume is shared by 20+
    SQLite databases. Monkeypatches the cap down to a small number so the
    test is fast and deterministic rather than pushing tens of thousands of
    rows. Must go RED against current code: no such cap exists pre-fix, so
    this batch would simply succeed."""
    monkeypatch.setattr(obsidian_staging, "_MAX_STAGING_ROWS_PER_VAULT", 2)
    token = _device_token("user-a")
    r1 = client.post(
        _URL, headers={"Authorization": f"Bearer {token}"},
        json={"consent": True, "notes": [_note("a.md", "h1"), _note("b.md", "h2")]},
    )
    assert r1.status_code == 200, r1.text
    assert len(_staging_rows("user-a", "vault-1")) == 2

    r2 = client.post(
        _URL, headers={"Authorization": f"Bearer {token}"},
        json={"consent": True, "notes": [_note("c.md", "h3")]},
    )
    assert 400 <= r2.status_code < 500, r2.text
    # The over-cap batch must not have partially landed.
    assert len(_staging_rows("user-a", "vault-1")) == 2
    assert {r["vault_path"] for r in _staging_rows("user-a", "vault-1")} == {"a.md", "b.md"}
