"""P5 auth-at-proxy: web vouches for the user, the worker trusts it (only when
FLOW_PROXY_TRUST=1). Security-critical: must be inert on web and unforgeable."""
import json
import pytest
from fastapi import HTTPException

from api import flow_admin_auth as A


def _signed(user: dict, secret="s3cret"):
    payload = json.dumps(user, separators=(",", ":"), sort_keys=True)
    import hmac, hashlib
    sig = hmac.new(secret.encode(), payload.encode(), hashlib.sha256).hexdigest()
    return payload, sig


def test_trust_inert_when_flag_off(monkeypatch):
    monkeypatch.setenv("PUSH_SECRET", "s3cret")
    monkeypatch.delenv("FLOW_PROXY_TRUST", raising=False)  # off (web)
    payload, sig = _signed({"id": 1, "role": "admin"})
    # Even with a perfectly valid signature, trust is OFF on web -> None.
    assert A._proxy_trusted_user(payload, sig) is None


def test_trust_accepts_valid_sig_when_flag_on(monkeypatch):
    monkeypatch.setenv("PUSH_SECRET", "s3cret")
    monkeypatch.setenv("FLOW_PROXY_TRUST", "1")  # worker
    payload, sig = _signed({"id": 7, "role": "admin", "email": "a@b.co"})
    u = A._proxy_trusted_user(payload, sig)
    assert u and u["id"] == 7 and u["role"] == "admin"


def test_trust_rejects_forged_sig(monkeypatch):
    monkeypatch.setenv("PUSH_SECRET", "s3cret")
    monkeypatch.setenv("FLOW_PROXY_TRUST", "1")
    payload, _ = _signed({"id": 1, "role": "admin"})
    assert A._proxy_trusted_user(payload, "deadbeef" * 8) is None
    # forged with the WRONG secret must also fail
    _, wrong = _signed({"id": 1, "role": "admin"}, secret="attacker")
    assert A._proxy_trusted_user(payload, wrong) is None


def test_require_admin_accepts_vouched_admin(monkeypatch):
    monkeypatch.setenv("PUSH_SECRET", "s3cret")
    monkeypatch.setenv("FLOW_PROXY_TRUST", "1")
    payload, sig = _signed({"id": 3, "role": "admin"})
    out = A.require_flow_admin(uct_session=None, authorization="",
                              x_uct_proxy_user=payload, x_uct_proxy_sig=sig)
    assert out["role"] == "admin" and out["via"] == "proxy_trusted"


def test_require_admin_rejects_vouched_non_admin(monkeypatch):
    monkeypatch.setenv("PUSH_SECRET", "s3cret")
    monkeypatch.setenv("FLOW_PROXY_TRUST", "1")
    payload, sig = _signed({"id": 4, "role": "user"})  # a real user, but not admin
    with pytest.raises(HTTPException) as ei:
        A.require_flow_admin(uct_session=None, authorization="",
                             x_uct_proxy_user=payload, x_uct_proxy_sig=sig)
    assert ei.value.status_code == 403


def test_require_user_accepts_vouched_user(monkeypatch):
    monkeypatch.setenv("PUSH_SECRET", "s3cret")
    monkeypatch.setenv("FLOW_PROXY_TRUST", "1")
    payload, sig = _signed({"id": 9, "role": "user"})
    out = A.require_flow_user(uct_session=None, authorization="",
                             x_uct_proxy_user=payload, x_uct_proxy_sig=sig)
    assert out["id"] == 9 and out["via"] == "proxy_trusted"


def test_push_secret_still_wins(monkeypatch):
    monkeypatch.setenv("PUSH_SECRET", "s3cret")
    monkeypatch.setenv("FLOW_PROXY_TRUST", "1")
    out = A.require_flow_admin(uct_session=None, authorization="Bearer s3cret",
                              x_uct_proxy_user="", x_uct_proxy_sig="")
    assert out["via"] == "push_secret" and out["role"] == "admin"
