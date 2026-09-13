"""
Symmetric encryption helpers for secrets we must store at rest.

Used by the broker-sync feature to keep SnapTrade userSecrets (which let
us pull a user's brokerage data) unreadable on disk. The same util can
wrap any future per-user secret.

Design notes:
  - Each ciphertext is prefixed with a key version (`v1:` etc.) so we can
    rotate the key with dual-decrypt later — decrypt looks up the prefix,
    picks the matching key, and falls through to legacy keys if needed.
  - Loss of the active key is catastrophic (every stored secret becomes
    undecryptable). Treat BROKER_ENCRYPTION_KEY as a permanent, backed-up
    Railway secret on par with a DB credential.
  - Decrypt failures raise CryptoBoxError. Callers should mark the affected
    connection as 'broken' and prompt the user to reconnect, NOT crash.

Env vars:
  BROKER_ENCRYPTION_KEY      — active key (urlsafe-base64, 32 bytes
                               decoded). Generate with
                               `python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"`.
  BROKER_ENCRYPTION_KEYS_V1  — optional retired key for `v1:` ciphertexts
                               while rotating. Same format. (When you rotate
                               to v2, set v2 as the active key and move the
                               old value into BROKER_ENCRYPTION_KEYS_V1.)
"""

from __future__ import annotations

import os
from typing import Final

from cryptography.fernet import Fernet, InvalidToken


# Active key version. Bump when rotating; old version material goes into
# BROKER_ENCRYPTION_KEYS_V<old>.
ACTIVE_VERSION: Final[str] = "v1"

_ACTIVE_ENV = "BROKER_ENCRYPTION_KEY"


class CryptoBoxError(Exception):
    """Raised when encryption/decryption fails (bad key, tampered blob,
    missing key, etc.). Callers should treat as 'credentials lost'."""


def _key_for(version: str) -> bytes | None:
    """Return raw key bytes for `version`, or None if unconfigured.

    Lookup order, always:
      1. BROKER_ENCRYPTION_KEYS_V<version> — explicit per-version key.
         Wins over the active env so an operator CAN override the active
         key during a rotation (or pin a retired one) without ambiguity.
      2. BROKER_ENCRYPTION_KEY — only consulted when this version is the
         active one. This is the normal-path env most deployments use.
    """
    raw = os.environ.get(f"BROKER_ENCRYPTION_KEYS_{version.upper()}")
    if not raw and version == ACTIVE_VERSION:
        raw = os.environ.get(_ACTIVE_ENV)
    if not raw:
        return None
    return raw.strip().encode("ascii")


def _fernet_for(version: str) -> Fernet | None:
    key = _key_for(version)
    if not key:
        return None
    try:
        return Fernet(key)
    except Exception as e:  # pragma: no cover — wrong-shape key
        raise CryptoBoxError(f"invalid key for {version}: {e}") from e


def is_configured() -> bool:
    """True if the active encryption key is set. Useful for boot checks."""
    return _key_for(ACTIVE_VERSION) is not None


def encrypt(plaintext: str) -> str:
    """Encrypt a string with the active key and return a versioned token
    like `v1:gAAAAA...`. Empty string raises (we never store empty secrets).
    """
    if not isinstance(plaintext, str):
        raise CryptoBoxError("plaintext must be str")
    if plaintext == "":
        raise CryptoBoxError("refusing to encrypt empty string")
    f = _fernet_for(ACTIVE_VERSION)
    if f is None:
        raise CryptoBoxError(
            f"{_ACTIVE_ENV} is not set — cannot encrypt at rest"
        )
    token = f.encrypt(plaintext.encode("utf-8")).decode("ascii")
    return f"{ACTIVE_VERSION}:{token}"


def decrypt(blob: str) -> str:
    """Decrypt a versioned blob produced by `encrypt`. Raises CryptoBoxError
    on bad version, missing key, or tampered/wrong-key ciphertext.

    Legacy unprefixed blobs (older than v1) are NOT supported — we have
    none in production. If we ever need to ingest one, add a branch here.
    """
    if not isinstance(blob, str) or ":" not in blob:
        raise CryptoBoxError("blob is not a versioned crypto-box token")
    version, ciphertext = blob.split(":", 1)
    f = _fernet_for(version)
    if f is None:
        raise CryptoBoxError(
            f"key for {version} is not configured "
            f"(set BROKER_ENCRYPTION_KEY for active version, "
            f"BROKER_ENCRYPTION_KEYS_{version.upper()} for retired versions)"
        )
    try:
        return f.decrypt(ciphertext.encode("ascii")).decode("utf-8")
    except InvalidToken as e:
        raise CryptoBoxError(
            "decrypt failed — wrong key, corrupted blob, or tampered ciphertext"
        ) from e
