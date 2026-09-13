"""Tests for api.services.crypto_box — the at-rest secret-encryption util
used by the broker-sync feature. The crypto layer is dull but the bugs
are catastrophic (lost user connections), so test it precisely:

  • round-trip with the active key
  • blob carries the version prefix (so future rotation works)
  • wrong key fails closed (CryptoBoxError, not silent corruption)
  • empty plaintext refused (we never store empty secrets)
  • missing key env var = clear error (not a confusing import-time crash)
  • retired-version blobs decrypt when their key is supplied via
    BROKER_ENCRYPTION_KEYS_V<version>
"""

from __future__ import annotations

import importlib

import pytest
from cryptography.fernet import Fernet

from api.services import crypto_box


@pytest.fixture
def fresh_key(monkeypatch):
    """Set BROKER_ENCRYPTION_KEY to a fresh Fernet key and reload the
    module so any cached state picks it up. Returns the key str."""
    key = Fernet.generate_key().decode("ascii")
    monkeypatch.setenv("BROKER_ENCRYPTION_KEY", key)
    importlib.reload(crypto_box)
    return key


def test_roundtrip_active_key(fresh_key):
    blob = crypto_box.encrypt("hello-snaptrade-secret")
    assert blob.startswith(crypto_box.ACTIVE_VERSION + ":")
    assert crypto_box.decrypt(blob) == "hello-snaptrade-secret"


def test_is_configured_reflects_env(monkeypatch):
    monkeypatch.delenv("BROKER_ENCRYPTION_KEY", raising=False)
    importlib.reload(crypto_box)
    assert crypto_box.is_configured() is False

    monkeypatch.setenv("BROKER_ENCRYPTION_KEY", Fernet.generate_key().decode())
    importlib.reload(crypto_box)
    assert crypto_box.is_configured() is True


def test_encrypt_refuses_empty(fresh_key):
    with pytest.raises(crypto_box.CryptoBoxError):
        crypto_box.encrypt("")


def test_encrypt_without_key_raises(monkeypatch):
    monkeypatch.delenv("BROKER_ENCRYPTION_KEY", raising=False)
    importlib.reload(crypto_box)
    with pytest.raises(crypto_box.CryptoBoxError):
        crypto_box.encrypt("anything")


def test_decrypt_rejects_unprefixed(fresh_key):
    with pytest.raises(crypto_box.CryptoBoxError):
        crypto_box.decrypt("not-a-versioned-blob")


def test_decrypt_with_wrong_key_fails_closed(monkeypatch):
    # Encrypt with key A
    monkeypatch.setenv("BROKER_ENCRYPTION_KEY", Fernet.generate_key().decode())
    importlib.reload(crypto_box)
    blob = crypto_box.encrypt("guarded")

    # Swap to key B without registering A — decrypt must raise, not
    # return garbage or the wrong string.
    monkeypatch.setenv("BROKER_ENCRYPTION_KEY", Fernet.generate_key().decode())
    importlib.reload(crypto_box)
    with pytest.raises(crypto_box.CryptoBoxError):
        crypto_box.decrypt(blob)


def test_retired_version_decrypt_when_old_key_supplied(monkeypatch):
    # Pretend v1 is retired. Save off the v1 key, then rotate to a fresh
    # active key. The retired key is exposed via BROKER_ENCRYPTION_KEYS_V1
    # so old blobs still decrypt during the rotation window.
    old_key = Fernet.generate_key().decode()
    monkeypatch.setenv("BROKER_ENCRYPTION_KEY", old_key)
    importlib.reload(crypto_box)
    blob = crypto_box.encrypt("pre-rotation-secret")

    # Rotate.
    monkeypatch.setenv("BROKER_ENCRYPTION_KEY", Fernet.generate_key().decode())
    monkeypatch.setenv("BROKER_ENCRYPTION_KEYS_V1", old_key)
    importlib.reload(crypto_box)
    assert crypto_box.decrypt(blob) == "pre-rotation-secret"
