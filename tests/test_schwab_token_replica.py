"""Rails on Schwab access-token replication web -> flow-worker (2026-11-09).

⛔ WHY THIS FILE IS STRICTER THAN IT LOOKS. It moves a LIVE CREDENTIAL between pods. The
two failure modes are not symmetric and neither throws:

  1. Sending too MUCH — the refresh token on the wire — hands a second pod the ability to
     refresh, and two pods refreshing one grant is how a steady, readable failure becomes a
     flapping one. Whether Schwab rotates the refresh token is still unverified, so the
     design must be safe either way. Hence `test_install_strips_refresh_token` and
     `test_push_body_never_carries_refresh_or_id_token`, which assert on ABSENCE.
  2. Installing a WORSE token — a replay of an older document, or one already dead — looks
     like a successful push and silently costs Schwab coverage until someone reads a log.

Context the tests encode: measured 2026-11-09, minutes after a successful re-auth, web's
token was 0.0 days old and flow-worker's **113.4 days** old, failing `invalid_grant` on
every cycle while the Massive OI fallback quietly covered for it. `/data` survives deploys
— nothing propagated. Separately, `get_valid_token` had no single-flight lock, so 215 of
500 flow-worker log lines (43%) were refresh failures, dozens inside one second.

Every refusal below is tested WITH a positive control, so none can pass by refusing
everything.
"""
from __future__ import annotations

import asyncio
import json
import os
import tempfile
import time
from pathlib import Path

os.environ.setdefault("RAILWAY_VOLUME_MOUNT_PATH", tempfile.mkdtemp(prefix="str_"))

import pytest  # noqa: E402

from api import schwab_token_replica as str_mod  # noqa: E402
from api.services import schwab_token_push as stp  # noqa: E402


# ── helpers ──────────────────────────────────────────────────────────────────

def _doc(access="tok-new", saved_at=None, expires_in=1800, **extra):
    d = {
        "access_token": access,
        "token_type": "Bearer",
        "expires_in": expires_in,
        "scope": "api",
        "saved_at": time.time() if saved_at is None else saved_at,
    }
    d.update(extra)
    return d


@pytest.fixture
def token_file(tmp_path, monkeypatch):
    """Point the replica at a temp file and arm receipt."""
    p = tmp_path / "schwab_token.json"
    monkeypatch.setattr(str_mod, "TOKEN_FILE", p)
    monkeypatch.setenv("SCHWAB_TOKEN_REPLICA_RECEIVE_ENABLED", "1")
    # Each test gets clean telemetry so counters cannot leak between them.
    for k, v in list(str_mod._STATE.items()):
        str_mod._STATE[k] = 0 if isinstance(v, int) else None
    return p


def _read(p):
    return json.loads(p.read_text())


# ── the flag ─────────────────────────────────────────────────────────────────

def test_receive_is_off_by_default(monkeypatch):
    monkeypatch.delenv("SCHWAB_TOKEN_REPLICA_RECEIVE_ENABLED", raising=False)
    assert str_mod.receive_enabled() is False


def test_receive_enabled_only_on_exactly_1(monkeypatch):
    for val, want in (("1", True), ("0", False), ("true", False), ("", False)):
        monkeypatch.setenv("SCHWAB_TOKEN_REPLICA_RECEIVE_ENABLED", val)
        assert str_mod.receive_enabled() is want, val


# ── the happy path, and the stripping rail ───────────────────────────────────

def test_install_accepts_and_writes(token_file):
    out = str_mod.install_pushed_token(_doc(access="tok-abc"))
    assert out["status"] == "accepted"
    assert _read(token_file)["access_token"] == "tok-abc"


def test_install_strips_refresh_token(token_file):
    """⛔⛔ THE SAFETY RAIL. A refresh token must never reach this pod's disk, even when
    the sender puts one in the body, because holding one is what would let flow-worker
    refresh and invalidate web's grant."""
    out = str_mod.install_pushed_token(
        _doc(refresh_token="SHOULD-NEVER-LAND", id_token="jwt.should.not.land"))
    assert out["status"] == "accepted"
    doc = _read(token_file)
    assert "refresh_token" not in doc
    assert "id_token" not in doc
    # Positive control: the thing it IS supposed to keep is kept.
    assert doc["access_token"] == "tok-new"


def test_install_preserves_senders_saved_at(token_file):
    """⛔ The sender's clock owns `saved_at`, NOT ours. Stamping local time here would
    make a token pushed 20 minutes ago look brand new, and every expiry check downstream
    reads `saved_at` + `expires_in`."""
    sent = time.time() - 600
    str_mod.install_pushed_token(_doc(saved_at=sent))
    assert _read(token_file)["saved_at"] == pytest.approx(sent, abs=0.01)
    # Local provenance is recorded separately, not instead.
    assert _read(token_file)["replica_received_at"] >= sent


# ── refusals, each with a positive control ───────────────────────────────────

def test_install_refuses_older_saved_at(token_file):
    now = time.time()
    assert str_mod.install_pushed_token(
        _doc(access="newer", saved_at=now))["status"] == "accepted"
    out = str_mod.install_pushed_token(_doc(access="older", saved_at=now - 60))
    assert out["status"] == "rejected"
    assert "older" in out["reason"]
    # The good token is still installed — a refusal must not clobber.
    assert _read(token_file)["access_token"] == "newer"
    # Positive control: a genuinely newer one still lands.
    assert str_mod.install_pushed_token(
        _doc(access="newest", saved_at=now + 1))["status"] == "accepted"
    assert _read(token_file)["access_token"] == "newest"


def test_install_equal_saved_at_is_already_current_and_does_not_rewrite(token_file):
    now = time.time()
    str_mod.install_pushed_token(_doc(access="same", saved_at=now))
    mtime_before = token_file.stat().st_mtime_ns
    out = str_mod.install_pushed_token(_doc(access="same", saved_at=now))
    assert out["status"] == "already-current"
    assert token_file.stat().st_mtime_ns == mtime_before
    assert str_mod._STATE["skipped_already_current"] == 1


def test_install_refuses_token_already_expired_on_arrival(token_file):
    out = str_mod.install_pushed_token(
        _doc(saved_at=time.time() - 3600, expires_in=1800))
    assert out["status"] == "rejected"
    assert "expired" in out["reason"]
    assert not token_file.exists()
    # Positive control: inside its life it lands.
    assert str_mod.install_pushed_token(
        _doc(saved_at=time.time() - 60, expires_in=1800))["status"] == "accepted"


def test_install_refuses_saved_at_far_in_the_future(token_file):
    out = str_mod.install_pushed_token(_doc(saved_at=time.time() + 4000))
    assert out["status"] == "rejected"
    assert "future" in out["reason"]
    # Positive control: a small skew inside tolerance is accepted, because two NTP-synced
    # containers legitimately disagree by a little and refusing that would be an outage.
    assert str_mod.install_pushed_token(
        _doc(saved_at=time.time() + 30))["status"] == "accepted"


@pytest.mark.parametrize("bad,needle", [
    ({"saved_at": time.time()}, "access_token"),
    (_doc(access=""), "access_token"),
    (_doc(access="   "), "access_token"),
])
def test_install_refuses_missing_or_blank_access_token(token_file, bad, needle):
    out = str_mod.install_pushed_token(bad)
    assert out["status"] == "rejected"
    assert needle in out["reason"]
    assert not token_file.exists()


def test_install_refuses_non_numeric_saved_at(token_file):
    d = _doc()
    d["saved_at"] = "not-a-number"
    assert str_mod.install_pushed_token(d)["status"] == "rejected"
    assert not token_file.exists()


def test_install_refuses_non_positive_expires_in(token_file):
    for bad in (0, -1):
        out = str_mod.install_pushed_token(_doc(expires_in=bad))
        assert out["status"] == "rejected", bad
    # Positive control.
    assert str_mod.install_pushed_token(_doc(expires_in=1800))["status"] == "accepted"


def test_install_never_raises_on_junk_payloads(token_file):
    for junk in (None, [], "a string", 42):
        out = str_mod.install_pushed_token(junk)  # must not raise
        assert out["status"] == "rejected"


def test_install_leaves_no_tmp_file_behind(token_file):
    str_mod.install_pushed_token(_doc())
    leftovers = [p.name for p in token_file.parent.iterdir()
                 if p.name.endswith(".tmp")]
    assert leftovers == []


# ── telemetry: the only thing that catches the next freeze ───────────────────

def test_status_reports_age_and_expiry(token_file):
    str_mod.install_pushed_token(_doc(saved_at=time.time() - 120, expires_in=1800))
    s = str_mod.status()
    assert s["has_token"] is True
    assert s["expired"] is False
    assert 100 <= s["age_seconds"] <= 200

    # A 1s-life token installs (remaining > 0) and is expired a moment later. Note
    # saved_at must be NOW, not the future: age is measured from saved_at, so a
    # future stamp keeps age small and the token reads fresh however long we wait.
    str_mod.install_pushed_token(_doc(saved_at=time.time(), expires_in=1))
    time.sleep(1.2)
    assert str_mod.status()["expired"] is True


def test_status_surfaces_a_stray_refresh_token(token_file):
    """A True here means this pod holds a grant from somewhere other than this module —
    exactly the 113-day state we are ending — so it must be visible, not inferred."""
    token_file.write_text(json.dumps(
        {"access_token": "x", "saved_at": time.time(), "refresh_token": "stray"}))
    assert str_mod.status()["holds_refresh_token"] is True
    # Positive control: a token this module installed never reports True.
    str_mod.install_pushed_token(_doc(saved_at=time.time() + 5))
    assert str_mod.status()["holds_refresh_token"] is False


def test_status_never_returns_the_credential(token_file):
    str_mod.install_pushed_token(_doc(access="super-secret-value"))
    assert "super-secret-value" not in json.dumps(str_mod.status())


# ── the sender ───────────────────────────────────────────────────────────────

class _FakeResp:
    def __init__(self, payload, status=200):
        self._p, self.status_code = payload, status

    def json(self):
        return self._p

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError("http %s" % self.status_code)


class _FakeClient:
    """Records what the sender would put on the wire."""

    def __init__(self, remote_status=None, **_kw):
        self.remote_status = remote_status if remote_status is not None else {}
        _FakeClient.last = self
        self.posts, self.gets = [], []

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def get(self, url, headers=None):
        self.gets.append(url)
        return _FakeResp(self.remote_status)

    def post(self, url, headers=None, json=None):
        self.posts.append((url, json))
        return _FakeResp({"status": "accepted"})


@pytest.fixture
def sender(monkeypatch):
    import httpx
    monkeypatch.setenv("SCHWAB_TOKEN_PUSH_ENABLED", "1")
    monkeypatch.setenv("PUSH_SECRET", "test-secret")
    monkeypatch.setattr(stp, "WORKER_INTERNAL_URL", "http://flow-worker.internal:8080")
    for k, v in list(stp._STATE.items()):
        stp._STATE[k] = 0 if isinstance(v, int) else None
    # ⛔ `_FakeClient.last` is CLASS state. Without this reset a test that asserts "no
    # post was sent" reads the client from a PREVIOUS test and passes or fails on its
    # traffic — which is exactly how test_push_does_not_ship_an_expired_local_token
    # first went red against correct code.
    _FakeClient.last = None

    def _mk(remote_status):
        monkeypatch.setattr(
            httpx, "Client",
            lambda *a, **kw: _FakeClient(remote_status=remote_status))
    return _mk


def _local_tokens(monkeypatch, **over):
    import api.schwab_service as ss
    doc = {"access_token": "tok-web", "refresh_token": "REFRESH-SECRET",
           "id_token": "jwt", "token_type": "Bearer", "expires_in": 1800,
           "scope": "api", "saved_at": time.time()}
    doc.update(over)
    monkeypatch.setattr(ss, "load_tokens", lambda: dict(doc))
    return doc


def test_push_is_off_by_default(monkeypatch):
    monkeypatch.delenv("SCHWAB_TOKEN_PUSH_ENABLED", raising=False)
    assert stp.push_enabled() is False
    assert stp.reconcile()["reason"] == "push disabled"


def test_push_body_never_carries_refresh_or_id_token(monkeypatch, sender):
    """⛔⛔ The whitelist IS the contract. `dict(tokens)` here would ship the grant."""
    _local_tokens(monkeypatch)
    sender({})  # remote has nothing -> must push
    out = stp.reconcile()
    assert out["ok"] is True and out["transferred"] is True
    url, body = _FakeClient.last.posts[-1]
    assert url.endswith("/api/flow/schwab-token/install")
    assert "refresh_token" not in body
    assert "id_token" not in body
    # Positive control: the access token IS sent, or the feature does nothing.
    assert body["access_token"] == "tok-web"


def test_push_skips_when_remote_is_current_and_fresh(monkeypatch, sender):
    doc = _local_tokens(monkeypatch)
    sender({"saved_at": doc["saved_at"], "age_seconds": 30})
    out = stp.reconcile()
    assert out == {"ok": True, "transferred": False}
    assert _FakeClient.last.posts == []
    assert stp._STATE["skipped_already_current"] == 1


def test_push_fires_when_remote_is_stale_even_if_saved_at_matches(monkeypatch, sender):
    """⛔ `saved_at` equality is NOT sufficient. A pod that booted with an old copy can
    report the same stamp while holding a token that is nearly dead."""
    doc = _local_tokens(monkeypatch)
    sender({"saved_at": doc["saved_at"], "age_seconds": 9999})
    assert stp.reconcile()["transferred"] is True


def test_push_fires_when_remote_has_no_token(monkeypatch, sender):
    _local_tokens(monkeypatch)
    sender({"has_token": False, "saved_at": None, "age_seconds": None})
    assert stp.reconcile()["transferred"] is True


def test_push_refuses_without_worker_internal_url(monkeypatch, sender):
    _local_tokens(monkeypatch)
    sender({})
    monkeypatch.setattr(stp, "WORKER_INTERNAL_URL", "")
    out = stp.reconcile()
    assert out["ok"] is False and "WORKER_INTERNAL_URL" in out["reason"]


def test_push_does_not_ship_an_expired_local_token(monkeypatch, sender):
    """Overwriting flow-worker's copy with a dead one is strictly worse than doing
    nothing. web's own refresh will mint a new one and `save_tokens` pushes that."""
    _local_tokens(monkeypatch, saved_at=time.time() - 7200)
    sender({})
    out = stp.reconcile()
    assert out["ok"] is False and "expired" in out["reason"]
    assert _FakeClient.last is None, "it must not even open a client"


def test_push_handles_no_local_token_quietly(monkeypatch, sender):
    import api.schwab_service as ss
    monkeypatch.setattr(ss, "load_tokens", lambda: None)
    sender({})
    out = stp.reconcile()
    assert out["ok"] is False and out["reason"] == "no local token"
    assert stp._STATE["last_error"] is None, "a pre-login pod is not an error state"


def test_push_never_raises_and_records_transport_failure(monkeypatch, sender):
    import httpx
    _local_tokens(monkeypatch)

    class _Boom:
        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def get(self, *a, **kw):
            raise RuntimeError("connect to http://user:pw@host failed")

        def post(self, *a, **kw):
            raise RuntimeError("nope")

    monkeypatch.setattr(httpx, "Client", lambda *a, **kw: _Boom())
    out = stp.reconcile()  # must not raise
    assert out["ok"] is False
    # ⛔ The recorded reason must not echo a transport message that could carry a URL
    # or credential — this repo is public and these logs are read in tickets.
    assert "user:pw" not in out["reason"]
    assert out["reason"] == "push failed: RuntimeError"


def test_push_requires_a_secret(monkeypatch, sender):
    _local_tokens(monkeypatch)
    sender({})
    monkeypatch.delenv("PUSH_SECRET", raising=False)
    out = stp.reconcile()
    assert out["ok"] is False and "PUSH_SECRET" in out["reason"]


def test_sender_status_reports_timing_not_value(monkeypatch):
    _local_tokens(monkeypatch, access_token="do-not-leak")
    s = stp.status()
    assert "do-not-leak" not in json.dumps(s)
    assert s["local_expires_in_sec"] is not None


def test_reconcile_async_is_inert_when_disabled(monkeypatch):
    monkeypatch.delenv("SCHWAB_TOKEN_PUSH_ENABLED", raising=False)
    called = []
    monkeypatch.setattr(stp, "reconcile", lambda *a, **k: called.append(1))
    stp.reconcile_async()
    time.sleep(0.05)
    assert called == []


# ── the single-flight fix on get_valid_token ─────────────────────────────────

async def test_get_valid_token_single_flights_the_refresh(monkeypatch):
    """⚰️ THE STORM. Without the lock, every parallel caller that finds an expired token
    fires its own refresh: 215 of 500 flow-worker log lines on 2026-11-09, dozens inside
    the same second. Mutation proof: drop the lock or the re-read and this reads 12."""
    import api.schwab_service as ss
    state = {"tokens": {"access_token": "old", "refresh_token": "r",
                        "saved_at": 0, "expires_in": 1800},
             "refreshes": 0}
    monkeypatch.setattr(ss, "load_tokens", lambda: dict(state["tokens"]))

    async def _fake_refresh():
        state["refreshes"] += 1
        await asyncio.sleep(0.01)  # a real await, so the window is real
        state["tokens"] = {"access_token": "new", "refresh_token": "r",
                           "saved_at": time.time(), "expires_in": 1800}
        return dict(state["tokens"])

    monkeypatch.setattr(ss, "refresh_access_token", _fake_refresh)
    monkeypatch.setattr(ss, "_TOKEN_REFRESH_LOCK", asyncio.Lock())

    out = await asyncio.gather(*[ss.get_valid_token() for _ in range(12)])
    assert state["refreshes"] == 1
    assert out == ["new"] * 12


async def test_get_valid_token_does_not_refresh_a_fresh_token(monkeypatch):
    """Positive control: the lock must not make every call pay a refresh."""
    import api.schwab_service as ss
    monkeypatch.setattr(ss, "load_tokens", lambda: {
        "access_token": "fresh", "saved_at": time.time(), "expires_in": 1800})

    async def _boom():
        raise AssertionError("must not refresh a fresh token")

    monkeypatch.setattr(ss, "refresh_access_token", _boom)
    assert await ss.get_valid_token() == "fresh"


async def test_get_valid_token_returns_none_without_tokens(monkeypatch):
    import api.schwab_service as ss
    monkeypatch.setattr(ss, "load_tokens", lambda: None)
    assert await ss.get_valid_token() is None


# ── the auto-refresh loop must stay WIRED ────────────────────────────────────

def test_start_auto_refresh_is_actually_called_somewhere():
    """⚰️ IT WASN'T, FOR AS LONG AS IT EXISTED. `start_auto_refresh()` had zero callers
    in the tree while its loop's docstring promised "users never need to
    re-authenticate", so web's token was measured sitting 53.4 minutes old — expired —
    because the only refresh path was an incidental `get_valid_token()` call.

    ⛔ THIS IS A WIRING RAIL, NOT A STYLE CHECK. flow-worker holds no refresh token by
    design, so its Schwab coverage is exactly as fresh as web's last refresh. If this
    goes dead again the replication degrades SILENTLY — a stale pushed token simply
    falls back to Massive, which reads like normal operation.

    An AST walk, not a grep: a mention inside a comment or a docstring is not a call.
    """
    import ast
    from pathlib import Path

    main_py = Path(__file__).resolve().parents[1] / "api" / "main.py"
    tree = ast.parse(main_py.read_text(encoding="utf-8", errors="replace"))
    called = {
        node.func.attr if isinstance(node.func, ast.Attribute) else node.func.id
        for node in ast.walk(tree)
        if isinstance(node, ast.Call)
        and isinstance(node.func, (ast.Attribute, ast.Name))
    }
    assert "start_auto_refresh" in called, (
        "api/main.py no longer calls schwab_service.start_auto_refresh() — the "
        "proactive refresh is dead again and the replicated token will go stale")
