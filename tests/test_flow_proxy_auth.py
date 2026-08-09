"""P5 auth-at-proxy: web vouches for the user, the worker trusts it (only when
FLOW_PROXY_TRUST=1). Security-critical: must be inert on web and unforgeable."""
import importlib
import json
import sys

import pytest
from fastapi import HTTPException

# Bind the REAL module, not whichever object got into sys.modules first.
#
# Three sibling test modules — test_flow_classification.py,
# test_liveflow_selfheal_lease.py, test_recent_selfheal.py — install a STUB
# `api.flow_admin_auth` (two lambdas) into sys.modules at IMPORT time so that
# `api.live_massive_router` imports without dragging in the bcrypt auth chain.
# They install it with `sys.modules.setdefault(...)`, so the module imported
# FIRST decides what every later importer binds. In a whole-suite run something
# imports the real module before them and their setdefault no-ops; run in a
# chunk that starts after that importer, the stub wins and all seven tests
# below assert against two lambdas instead of the security code — measured:
# `pytest test_flow_classification.py test_flow_proxy_auth.py` = 7 failed,
# the same two files in the opposite order = 27 passed.
#
# The `assert` is the rail: a security test that silently graded a stub would
# be worse than one that fails, so this file refuses to run against one.
_bound = sys.modules.get("api.flow_admin_auth")
if _bound is not None and not hasattr(_bound, "_proxy_trusted_user"):
    del sys.modules["api.flow_admin_auth"]
A = importlib.import_module("api.flow_admin_auth")
assert hasattr(A, "_proxy_trusted_user"), (
    "bound a stub api.flow_admin_auth, not the real module — these tests would "
    "have graded lambdas"
)


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
