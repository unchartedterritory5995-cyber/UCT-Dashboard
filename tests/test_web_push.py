"""BRK-04 (RM-L04) — Web Push as an alert channel. `api/services/web_push.py`.

What is pinned here, each against the thing that would break it:
  • the encryption is RFC 8291 — byte-identical to the RFC's own Appendix A
    vector, and a fresh-key round trip decrypts;
  • the VAPID JWT verifies under the public key and names the push origin;
  • DARK: off ⇒ /api/push/* 404 before identity, `dispatch` returns before the
    database and no executor thread exists;
  • INERT without keys, with one log line;
  • 404/410 prunes, 2xx stamps, 5xx keeps;
  • the SSRF allow-list;
  • owner scope (one member cannot remove another's device);
  • the alert path calls the channel AFTER the others and a raising channel
    changes nothing about the report.
"""
from __future__ import annotations

import base64
import json
import logging
import struct
import threading

import pytest
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.utils import encode_dss_signature
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from api.services import auth_db
from api.services import web_push as wp

FCM = "https://fcm.googleapis.com/fcm/send/abc123"


@pytest.fixture(autouse=True)
def _isolated(tmp_path, monkeypatch):
    monkeypatch.setattr(auth_db, "_DB_PATH", str(tmp_path / "auth.db"))
    monkeypatch.setattr(wp, "_ensured", set())
    monkeypatch.setattr(wp, "_inert_logged", False)
    for k in (wp.ENABLED_ENV, wp.PUBLIC_KEY_ENV, wp.PRIVATE_KEY_ENV, wp.SUBJECT_ENV):
        monkeypatch.delenv(k, raising=False)
    yield


def _keypair():
    k = ec.generate_private_key(ec.SECP256R1())
    priv = wp.b64u_encode(k.private_numbers().private_value.to_bytes(32, "big"))
    return k, wp.b64u_encode(wp._public_raw(k)), priv


def _arm(monkeypatch, *, enabled=True):
    _k, pub, priv = _keypair()
    if enabled:
        monkeypatch.setenv(wp.ENABLED_ENV, "1")
    monkeypatch.setenv(wp.PUBLIC_KEY_ENV, pub)
    monkeypatch.setenv(wp.PRIVATE_KEY_ENV, priv)
    monkeypatch.setenv(wp.SUBJECT_ENV, "mailto:ops@example.com")
    return pub


def _ua():
    """A browser's subscription: (private key, p256dh b64, auth b64)."""
    k = ec.generate_private_key(ec.SECP256R1())
    import os
    return k, wp.b64u_encode(wp._public_raw(k)), wp.b64u_encode(os.urandom(16))


def _decrypt(body: bytes, ua_private, auth_b64: str) -> bytes:
    """The receiving side of RFC 8291, written independently of the sender."""
    import hashlib
    import hmac
    salt, rs, idlen = body[:16], struct.unpack("!I", body[16:20])[0], body[20]
    as_public = body[21:21 + idlen]
    ct = body[21 + idlen:]
    assert rs == 4096
    ua_public = wp._public_raw(ua_private)
    secret = ua_private.exchange(ec.ECDH(), ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), as_public))
    ext = lambda s, i: hmac.new(s, i, hashlib.sha256).digest()
    exp = lambda p, info, n: hmac.new(p, info + b"\x01", hashlib.sha256).digest()[:n]
    ikm = exp(ext(wp.b64u_decode(auth_b64), secret), b"WebPush: info\x00" + ua_public + as_public, 32)
    prk = ext(salt, ikm)
    pt = AESGCM(exp(prk, b"Content-Encoding: aes128gcm\x00", 16)).decrypt(
        exp(prk, b"Content-Encoding: nonce\x00", 12), ct, None)
    assert pt.endswith(b"\x02")
    return pt[:-1]


# ── crypto ───────────────────────────────────────────────────────────────────

class TestCrypto:
    def test_rfc8291_appendix_a_vector_byte_for_byte(self):
        as_private = wp._private_key_from_b64("yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw")
        out = wp.encrypt(
            b"When I grow up, I want to be a watermelon",
            "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
            "BTBZMqHH6r4Tts7J_aSIgg",
            _as_private=as_private, _salt=wp.b64u_decode("DGv6ra1nlYgDCS1FRnbzlw"))
        assert wp.b64u_encode(out) == (
            "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_"
            "yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN")

    def test_fresh_keys_round_trip(self):
        ua_priv, p256dh, auth = _ua()
        payload = wp.build_payload("AAPL crossed $200", "now $201.10", "/research/AAPL", "t1")
        assert json.loads(_decrypt(wp.encrypt(payload, p256dh, auth), ua_priv, auth)) == {
            "title": "AAPL crossed $200", "body": "now $201.10", "url": "/research/AAPL", "tag": "t1"}

    def test_two_encryptions_never_share_salt_or_key(self):
        _p, p256dh, auth = _ua()
        a, b = wp.encrypt(b"x", p256dh, auth), wp.encrypt(b"x", p256dh, auth)
        assert a[:16] != b[:16] and a[21:86] != b[21:86]

    def test_vapid_jwt_verifies_and_names_the_origin(self):
        key, pub, _priv = _keypair()
        tok = wp.vapid_jwt(FCM, key, "mailto:ops@example.com", now=1_000)
        h, c, s = tok.split(".")
        claims = json.loads(wp.b64u_decode(c))
        assert claims == {"aud": "https://fcm.googleapis.com", "exp": 1_000 + 12 * 3600,
                          "sub": "mailto:ops@example.com"}
        assert json.loads(wp.b64u_decode(h)) == {"typ": "JWT", "alg": "ES256"}
        raw = wp.b64u_decode(s)
        der = encode_dss_signature(int.from_bytes(raw[:32], "big"), int.from_bytes(raw[32:], "big"))
        ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), wp.b64u_decode(pub)).verify(
            der, f"{h}.{c}".encode(), ec.ECDSA(hashes.SHA256()))

    def test_payload_url_is_same_origin_only(self):
        for bad in ("https://evil.example/x", "//evil.example/x", "javascript:alert(1)", None):
            assert json.loads(wp.build_payload("t", "b", bad))["url"] == "/"

    def test_oversized_payload_is_truncated_not_refused(self):
        raw = wp.build_payload("t" * 999, "b" * 99_999, "/x")
        assert len(raw) <= wp.MAX_PAYLOAD_BYTES


# ── config / gate ────────────────────────────────────────────────────────────

class TestGate:
    def test_default_off(self):
        assert wp.is_enabled() is False

    def test_off_dispatch_touches_nothing_and_starts_no_thread(self, monkeypatch):
        _arm(monkeypatch, enabled=False)
        monkeypatch.setattr(wp, "_executor", None)
        monkeypatch.setattr(wp, "_conn", lambda: pytest.fail("flag off reached the database"))
        before = {t.name for t in threading.enumerate()}
        assert wp.dispatch("u1", "t", "b") is False
        assert wp._executor is None
        assert not [t for t in threading.enumerate() if t.name.startswith("web-push") and t.name not in before]

    def test_on_without_keys_is_inert_with_one_log_line(self, monkeypatch, caplog):
        monkeypatch.setenv(wp.ENABLED_ENV, "1")
        monkeypatch.setattr(wp, "_executor", None)
        with caplog.at_level(logging.WARNING, logger=wp.__name__):
            assert wp.dispatch("u1", "t", "b") is False
            assert wp.dispatch("u1", "t", "b") is False
        assert sum("INERT" in r.getMessage() for r in caplog.records) == 1
        assert wp._executor is None

    def test_mismatched_public_key_is_inert(self, monkeypatch):
        _arm(monkeypatch)
        _k, other_pub, _p = _keypair()
        monkeypatch.setenv(wp.PUBLIC_KEY_ENV, other_pub)
        assert wp.vapid_config() is None

    def test_on_with_keys_queues_and_returns(self, monkeypatch):
        _arm(monkeypatch)
        jobs = []

        class _Ex:
            def submit(self, fn, *a):
                jobs.append((fn, a))
        monkeypatch.setattr(wp, "_get_executor", lambda: _Ex())
        assert wp.dispatch("u1", "AAPL", "crossed", url="/research/AAPL") is True
        assert len(jobs) == 1 and jobs[0][1][0] == "u1"

    def test_dispatch_never_raises(self, monkeypatch):
        _arm(monkeypatch)

        def boom():
            raise RuntimeError("executor gone")
        monkeypatch.setattr(wp, "_get_executor", boom)
        assert wp.dispatch("u1", "t", "b") is False


# ── subscriptions ────────────────────────────────────────────────────────────

class TestSubscriptions:
    def test_ssrf_allow_list(self):
        for ok in (FCM, "https://updates.push.services.mozilla.com/wpush/v2/x",
                   "https://web.push.apple.com/QA", "https://wns2-by3p.notify.windows.com/w/?token=x"):
            assert wp.endpoint_allowed(ok), ok
        for bad in ("http://fcm.googleapis.com/x", "https://localhost/x", "https://169.254.169.254/x",
                    "https://fcm.googleapis.com.evil.com/x", "https://evilfcm.googleapis.com.attacker/x",
                    "https://user:pw@fcm.googleapis.com/x", "https://fcm.googleapis.com:8443/x",
                    "https://notfcm.googleapis.co/x", "", "ftp://fcm.googleapis.com/x"):
            assert not wp.endpoint_allowed(bad), bad

    def test_subscribe_rejects_a_foreign_endpoint(self):
        _p, p256dh, auth = _ua()
        with pytest.raises(ValueError):
            wp.subscribe("u1", "https://attacker.example/collect", p256dh, auth)

    def test_owner_scope(self):
        _p, p256dh, auth = _ua()
        wp.subscribe("u1", FCM, p256dh, auth)
        assert wp.unsubscribe("u2", FCM) is False
        assert len(wp.list_subscriptions("u1")) == 1
        assert wp.unsubscribe("u1", FCM) is True
        assert wp.list_subscriptions("u1") == []

    def test_a_device_moves_to_whoever_subscribed_it_last(self):
        _p, p256dh, auth = _ua()
        wp.subscribe("u1", FCM, p256dh, auth)
        wp.subscribe("u2", FCM, p256dh, auth)
        assert wp.list_subscriptions("u1") == []
        assert [s["endpoint"] for s in wp.list_subscriptions("u2")] == [FCM]

    def test_device_cap(self):
        _p, p256dh, auth = _ua()
        for i in range(wp.MAX_SUBSCRIPTIONS_PER_USER + 3):
            wp.subscribe("u1", f"{FCM}{i}", p256dh, auth)
        subs = wp.list_subscriptions("u1")
        assert len(subs) == wp.MAX_SUBSCRIPTIONS_PER_USER
        assert f"{FCM}{wp.MAX_SUBSCRIPTIONS_PER_USER + 2}" in {s["endpoint"] for s in subs}

    def test_table_has_no_name_column(self):
        """No owner+name pair ⇒ not a saved-object candidate for address_space."""
        from api.services import address_space
        assert "web_push_subscriptions" not in address_space.saved_object_tables()


# ── delivery ─────────────────────────────────────────────────────────────────

class TestSend:
    def _sub(self, ep):
        ua_priv, p256dh, auth = _ua()
        wp.subscribe("u1", ep, p256dh, auth)
        return ua_priv, auth

    def test_prunes_404_and_410_stamps_2xx_keeps_5xx(self, monkeypatch):
        pub = _arm(monkeypatch)
        eps = {f"{FCM}/a": 201, f"{FCM}/b": 404, f"{FCM}/c": 410, f"{FCM}/d": 500}
        keys = {ep: self._sub(ep) for ep in eps}
        seen = {}

        def post(ep, body, headers):
            seen[ep] = (body, headers)
            return eps[ep]
        monkeypatch.setattr(wp, "_post", post)
        out = wp.send_to_user("u1", wp.build_payload("T", "B", "/x"), wp.vapid_config())
        assert out == {"sent": 1, "pruned": 2, "failed": 1}
        assert sorted(s["endpoint"] for s in wp.list_subscriptions("u1")) == [f"{FCM}/a", f"{FCM}/d"]
        body, headers = seen[f"{FCM}/a"]
        assert headers["Content-Encoding"] == "aes128gcm"
        assert headers["Authorization"].startswith("vapid t=") and headers["Authorization"].endswith(f"k={pub}")
        ua_priv, auth = keys[f"{FCM}/a"]
        assert json.loads(_decrypt(body, ua_priv, auth))["title"] == "T"

    def test_a_raising_post_is_counted_never_raised(self, monkeypatch):
        _arm(monkeypatch)
        self._sub(f"{FCM}/a")

        def post(ep, body, headers):
            raise OSError("network down")
        monkeypatch.setattr(wp, "_post", post)
        assert wp.send_to_user("u1", b"{}", wp.vapid_config()) == {"sent": 0, "pruned": 0, "failed": 1}
        assert len(wp.list_subscriptions("u1")) == 1


# ── the alert path ───────────────────────────────────────────────────────────

class TestAlertPath:
    @pytest.fixture
    def wls(self, monkeypatch):
        from api.services import watchlist_alert_service as wls
        order = []
        monkeypatch.setattr(wls, "add_alert", lambda *a, **k: order.append("in_app"))
        monkeypatch.setattr(wls, "_get_user_email", lambda uid: "m@example.com")
        monkeypatch.setattr(wls, "send_email", lambda *a, **k: order.append("email") or True)
        wls._order = order
        return wls

    def test_payload_path_pushes_after_the_other_channels(self, wls, monkeypatch):
        calls = []
        monkeypatch.setattr(wp, "dispatch", lambda uid, t, b, url=None, tag=None:
                            wls._order.append("push") or calls.append((uid, t, url)) or True)
        rep = wls.deliver_alert_payload("u1", "AAPL", "Title", "Msg", source="calendar_alert")
        assert wls._order == ["in_app", "email", "push"]
        assert calls == [("u1", "Title", "/research/AAPL")]
        assert "push" not in rep["channels"]

    def test_price_path_pushes_after_the_other_channels(self, wls, monkeypatch):
        calls = []
        monkeypatch.setattr(wp, "dispatch", lambda uid, t, b, url=None, tag=None:
                            wls._order.append("push") or calls.append((uid, url)) or True)
        wls._deliver_alert({"id": "a1", "user_id": "u9", "sym": "nvda", "direction": "above",
                            "target_price": 100.0}, 101.0)
        assert wls._order == ["in_app", "email", "push"]
        assert calls == [("u9", "/research/NVDA")]

    def test_a_raising_push_changes_nothing_about_the_report(self, wls, monkeypatch):
        def boom(*a, **k):
            raise RuntimeError("push exploded")
        monkeypatch.setattr(wp, "dispatch", boom)
        rep = wls.deliver_alert_payload("u1", "AAPL", "Title", "Msg", source="calendar_alert")
        assert rep["claimed"] is True and rep["channels_failed"] == 0
        assert set(rep["channels"]) == {"in_app", "discord", "email"}

    def test_flag_off_alert_path_never_reaches_the_db(self, wls, monkeypatch):
        monkeypatch.setattr(wp, "_conn", lambda: pytest.fail("flag off reached the database"))
        wls.deliver_alert_payload("u1", "AAPL", "Title", "Msg", source="calendar_alert")


# ── routes ───────────────────────────────────────────────────────────────────

class TestRoutes:
    PAID = {"id": "u1", "email": "p@x.dev", "role": "admin", "plan": "pro"}

    @pytest.fixture()
    def client(self):
        from fastapi.testclient import TestClient
        from api.main import app
        from api.middleware.auth_middleware import get_current_user_with_plan
        app.dependency_overrides[get_current_user_with_plan] = lambda: dict(self.PAID)
        try:
            yield TestClient(app)
        finally:
            app.dependency_overrides.pop(get_current_user_with_plan, None)

    def _body(self):
        _p, p256dh, auth = _ua()
        return {"endpoint": FCM, "keys": {"p256dh": p256dh, "auth": auth}, "expirationTime": None}

    def test_off_is_404_before_identity(self):
        from fastapi.testclient import TestClient
        from api.main import app
        c = TestClient(app)
        assert c.get("/api/push/config").status_code == 404
        assert c.post("/api/push/subscribe", json=self._body()).status_code == 404
        assert c.post("/api/push/unsubscribe", json={"endpoint": FCM}).status_code == 404
        assert c.post("/api/push/test").status_code == 404

    def test_free_member_is_402(self, monkeypatch):
        from fastapi.testclient import TestClient
        from api.main import app
        from api.middleware.auth_middleware import get_current_user_with_plan
        _arm(monkeypatch)
        app.dependency_overrides[get_current_user_with_plan] = lambda: {"id": "u2", "role": "user", "plan": "free"}
        try:
            assert TestClient(app).get("/api/push/config").status_code == 402
        finally:
            app.dependency_overrides.pop(get_current_user_with_plan, None)

    def test_on_without_keys_config_says_unconfigured_and_subscribe_503(self, client, monkeypatch):
        monkeypatch.setenv(wp.ENABLED_ENV, "1")
        assert client.get("/api/push/config").json() == {"configured": False, "public_key": None}
        assert client.post("/api/push/subscribe", json=self._body()).status_code == 503

    def test_subscribe_is_owner_scoped_to_the_session(self, client, monkeypatch):
        pub = _arm(monkeypatch)
        assert client.get("/api/push/config").json() == {"configured": True, "public_key": pub}
        body = self._body()
        body["user_id"] = "someone-else"
        assert client.post("/api/push/subscribe", json=body).status_code == 200
        assert [s["endpoint"] for s in wp.list_subscriptions("u1")] == [FCM]
        assert wp.list_subscriptions("someone-else") == []
        assert client.post("/api/push/unsubscribe", json={"endpoint": FCM}).json() == {"removed": True}

    def test_foreign_endpoint_is_400(self, client, monkeypatch):
        _arm(monkeypatch)
        body = self._body()
        body["endpoint"] = "https://169.254.169.254/latest/meta-data"
        assert client.post("/api/push/subscribe", json=body).status_code == 400
