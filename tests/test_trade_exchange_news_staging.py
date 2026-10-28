"""Checkpoint D2 staging: synthetic-only web bundle, its auth stand-in, the bundler."""
from __future__ import annotations

import hashlib
import importlib.util
import os
import pathlib
import subprocess
import sys

import pytest
from fastapi import HTTPException

ROOT = pathlib.Path(__file__).resolve().parents[1]
STAGING = ROOT / "services" / "trade_exchange_news_staging_web"
sys.path.insert(0, str(ROOT / "tools"))
import txn_staging_bundle as bundle  # noqa: E402


def _load(name: str, path: pathlib.Path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


auth = _load("txn_staging_auth", STAGING / "staging_auth.py")
TOKEN = "staging-read-" + "x" * 40


def test_staging_auth_fails_closed_without_a_digest(monkeypatch):
    monkeypatch.delenv("TXN_STAGING_READ_TOKEN_SHA256", raising=False)
    with pytest.raises(HTTPException) as e:
        auth.require_admin(f"Bearer {TOKEN}")
    assert e.value.status_code == 401


@pytest.mark.parametrize("header", ["", TOKEN, f"Basic {TOKEN}", "Bearer wrong", "Bearer "])
def test_staging_auth_refuses_anything_but_the_bearer(monkeypatch, header):
    monkeypatch.setenv("TXN_STAGING_READ_TOKEN_SHA256", hashlib.sha256(TOKEN.encode()).hexdigest())
    with pytest.raises(HTTPException):
        auth.require_admin(header)


def test_staging_auth_accepts_the_bearer_and_a_rotation_pair(monkeypatch):
    other = hashlib.sha256(b"old").hexdigest()
    monkeypatch.setenv("TXN_STAGING_READ_TOKEN_SHA256", f"{other},{hashlib.sha256(TOKEN.encode()).hexdigest()}")
    assert auth.require_admin(f"Bearer {TOKEN}")["role"] == "admin"


def test_staging_web_refuses_to_start_unless_synthetic_only():
    web = _load("txn_staging_web_check", STAGING / "staging_web.py")
    ok = {"TXN_SYNTHETIC_ONLY": "1", "TXN_STAGING_READ_TOKEN_SHA256": "a" * 64}
    assert web.refusal(ok) is None
    assert "TXN_SYNTHETIC_ONLY" in web.refusal({**ok, "TXN_SYNTHETIC_ONLY": ""})
    assert "TXN_STORAGE_PERMISSION_CONFIRMED" in web.refusal({**ok, "TXN_STORAGE_PERMISSION_CONFIRMED": "1"})
    assert "TXN_STAGING_READ_TOKEN_SHA256" in web.refusal({**ok, "TXN_STAGING_READ_TOKEN_SHA256": ""})


def test_web_bundle_is_the_real_news_code_plus_only_the_auth_stand_in():
    files = bundle.plan("web")
    assert files["api/middleware/auth_middleware.py"].endswith("staging_web/staging_auth.py")
    api_files = {d for d in files if d.startswith("api/")}
    assert {d for d in api_files if not d.startswith("api/services/trade_exchange_news/")} == {
        "api/__init__.py", "api/routers/__init__.py", "api/routers/trade_exchange_news.py",
        "api/middleware/__init__.py", "api/middleware/auth_middleware.py", "api/services/__init__.py"}
    assert all(files[d] == d for d in api_files if d != "api/middleware/auth_middleware.py")


def test_bundle_refuses_an_out_dir_inside_the_repo(tmp_path):
    with pytest.raises(SystemExit):
        bundle.build("web", ROOT / "tmp-bundle-should-not-exist")
    (tmp_path / "x").write_text("x")
    with pytest.raises(SystemExit):
        bundle.build("web", tmp_path)


def test_web_bundle_imports_standalone(tmp_path):
    """The bundle needs nothing else from the repo: import it in a clean interpreter."""
    out = tmp_path / "web"
    bundle.build("web", out)
    env = {k: v for k, v in os.environ.items() if k != "PYTHONPATH"}
    env.update(TXN_ENABLED="1", TXN_SYNTHETIC_ONLY="1")
    r = subprocess.run([sys.executable, "-c", "import staging_web; print(staging_web.app.title)"],
                       cwd=out, env=env, capture_output=True, text=True, timeout=60)
    assert r.returncode == 0, r.stderr[-2000:]
