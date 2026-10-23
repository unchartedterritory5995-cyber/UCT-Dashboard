"""
Symmetric encryption helpers for secrets we must store at rest.

Used by the broker-sync feature to keep SnapTrade userSecrets (which let
us pull a user's brokerage data) unreadable on disk, and by the TOTP
service for 2FA secrets. The same util wraps any future per-user secret —
as of the Note Connectors feature, a second **key family** exists for
connector tokens (Roam/Craft/Notion/Dropbox), isolated from the broker
family so a broker key rotation/compromise can never touch note tokens
and vice versa.

Design notes:
  - Each ciphertext is prefixed with a key version (`v1:` etc.) so we can
    rotate the key with dual-decrypt later — decrypt looks up the prefix,
    picks the matching key, and falls through to legacy keys if needed.
  - Loss of the active key is catastrophic (every stored secret becomes
    undecryptable). Treat BROKER_ENCRYPTION_KEY as a permanent, backed-up
    Railway secret on par with a DB credential. Same for NOTE_ENCRYPTION_KEY
    once the note-connectors feature is live.
  - Decrypt failures raise CryptoBoxError. Callers should mark the affected
    connection as 'broken' and prompt the user to reconnect, NOT crash.
  - `CryptoBox` holds one key FAMILY: an active-version env var (e.g.
    `BROKER_ENCRYPTION_KEY`) plus its per-version retired-key overrides
    (`<PREFIX>S_V<n>`). The module-level `encrypt`/`decrypt`/`is_configured`
    functions below are the original broker-sync API, now thin delegates to
    a module-level `CryptoBox(BROKER_ENCRYPTION_KEY)` instance — existing
    callers (broker sync, TOTP) are unaffected byte-for-byte. `NoteBox` is
    the second family, `CryptoBox(NOTE_ENCRYPTION_KEY)`, for note-connector
    callers to use directly (`crypto_box.NoteBox.encrypt(...)`).

Env vars (broker family — the original/default):
  BROKER_ENCRYPTION_KEY      — active key (urlsafe-base64, 32 bytes
                               decoded). Generate with
                               `python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"`.
  BROKER_ENCRYPTION_KEYS_V1  — optional retired key for `v1:` ciphertexts
                               while rotating. Same format. (When you rotate
                               to v2, set v2 as the active key and move the
                               old value into BROKER_ENCRYPTION_KEYS_V1.)

Env vars (note-connector family — same shape, isolated key material):
  NOTE_ENCRYPTION_KEY        — active key for NoteBox.
  NOTE_ENCRYPTION_KEYS_V1    — optional retired key for NoteBox.

Active version, PER FAMILY (added 2026-10-22 for the Railway env-var leak):
  <BASE>_ACTIVE_VERSION      — where <BASE> is the prefix minus its `_KEY`
                               suffix: BROKER_ENCRYPTION_ACTIVE_VERSION,
                               NOTE_ENCRYPTION_ACTIVE_VERSION,
                               WISDOM_PRIVATE_ACTIVE_VERSION. Unset or "" means
                               "v1", which is byte-for-byte the pre-change
                               behaviour (tests/test_crypto_box_rotation.py
                               proves it against a frozen copy of the old
                               module). Read live on every call, like the keys.
                               A malformed value (anything but v<N>, N>=1)
                               fails CLOSED: encrypt raises, is_configured is
                               False -- never a silent fallback to v1.

Rotation of one family (runbook: docs/runbooks/at-rest-key-rotation.md):
  <PREFIX>S_V1 = <old key>, <PREFIX> = <new key>, <BASE>_ACTIVE_VERSION = v2
  => new writes are `v2:` under the new key; `v1:` rows still decrypt via
  <PREFIX>S_V1; `tools/reencrypt_at_rest.py` then rewrites the v1 rows.
  Why the override order matters: while v1 is active, <PREFIX>S_V1 WINS over
  <PREFIX> for encryption too, so swapping <PREFIX> alone changes nothing
  (and swapping it without S_V1 strands every v1 row). Only bumping the
  active version makes <PREFIX> the key new writes use.
"""

from __future__ import annotations

import base64
import hmac
import os
import re
from typing import Final

from cryptography.fernet import Fernet, InvalidToken


# DEFAULT active key version -- what every family uses while its
# <BASE>_ACTIVE_VERSION env var is unset. Rotation is an env change, never an
# edit here (a code bump would rotate every family at once, in one deploy).
DEFAULT_ACTIVE_VERSION: Final[str] = "v1"
# Kept for callers/tests that read the old constant; it is the DEFAULT, not
# necessarily the live active version of a family (see CryptoBox.active_version).
ACTIVE_VERSION: Final[str] = DEFAULT_ACTIVE_VERSION

_VERSION_RE = re.compile(r"^v[1-9][0-9]{0,3}$")

_ACTIVE_ENV = "BROKER_ENCRYPTION_KEY"


class CryptoBoxError(Exception):
    """Raised when encryption/decryption fails (bad key, tampered blob,
    missing key, etc.). Callers should treat as 'credentials lost'."""


class CryptoBox:
    """One key family: an active-version env var (`prefix`) plus per-version
    retired-key overrides (`<prefix>S_V<n>`). Env is read live on every call
    (never cached at construction), so a fresh instance always reflects the
    current environment — matching the original module-level functions'
    behavior under `importlib.reload`-less env changes (e.g. `monkeypatch`).
    """

    def __init__(self, prefix: str, *, active_version: str | None = None):
        self.prefix = prefix
        # A constructor-pinned version (the old API) wins over the env.
        self._pinned_version = active_version

    @property
    def active_version_env(self) -> str:
        base = self.prefix[:-4] if self.prefix.endswith("_KEY") else self.prefix
        return f"{base}_ACTIVE_VERSION"

    @property
    def active_version(self) -> str:
        """The version new writes are stamped with. Raises CryptoBoxError on a
        malformed env value (fail closed, never a silent v1)."""
        if self._pinned_version is not None:
            return self._pinned_version
        raw = (os.environ.get(self.active_version_env) or "").strip()
        if not raw:
            return DEFAULT_ACTIVE_VERSION
        v = raw.lower()
        if not _VERSION_RE.match(v):
            raise CryptoBoxError(
                f"{self.active_version_env} must look like v2 (got a malformed value)"
            )
        return v

    def _active_or_none(self) -> str | None:
        try:
            return self.active_version
        except CryptoBoxError:
            return None

    def _key_for(self, version: str) -> bytes | None:
        """Return raw key bytes for `version`, or None if unconfigured.

        Lookup order, always:
          1. <prefix>S_V<version> — explicit per-version key. Wins over the
             active env so an operator CAN override the active key during a
             rotation (or pin a retired one) without ambiguity.
          2. <prefix> — only consulted when this version is the active one.
             This is the normal-path env most deployments use.
        """
        raw = os.environ.get(f"{self.prefix}S_{version.upper()}")
        if not raw and version == self._active_or_none():
            raw = os.environ.get(self.prefix)
        if not raw:
            return None
        return raw.strip().encode("ascii")

    def _fernet_for(self, version: str) -> Fernet | None:
        key = self._key_for(version)
        if not key:
            return None
        try:
            return Fernet(key)
        except Exception as e:  # pragma: no cover — wrong-shape key
            raise CryptoBoxError(f"invalid key for {version}: {e}") from e

    def is_configured(self) -> bool:
        """True if the active encryption key is set. Useful for boot checks."""
        active = self._active_or_none()
        return active is not None and self._key_for(active) is not None

    def same_key(self, version_a: str, version_b: str) -> bool:
        """True only if BOTH versions resolve to a configured key and the two
        keys are the same 32 bytes. Used by the re-encrypt tool to refuse a
        "rotation" whose new key is the old one. Never exposes the keys."""
        a, b = self._key_for(version_a), self._key_for(version_b)
        if a is None or b is None:
            return False
        try:
            da, db = base64.urlsafe_b64decode(a), base64.urlsafe_b64decode(b)
        except Exception:  # noqa: BLE001 -- a malformed key compares as text
            da, db = a, b
        return hmac.compare_digest(da, db)

    def encrypt(self, plaintext: str) -> str:
        """Encrypt a string with the active key and return a versioned token
        like `v1:gAAAAA...`. Empty string raises (we never store empty secrets).
        """
        if not isinstance(plaintext, str):
            raise CryptoBoxError("plaintext must be str")
        if plaintext == "":
            raise CryptoBoxError("refusing to encrypt empty string")
        version = self.active_version
        f = self._fernet_for(version)
        if f is None:
            raise CryptoBoxError(
                f"{self.prefix} is not set — cannot encrypt at rest"
            )
        token = f.encrypt(plaintext.encode("utf-8")).decode("ascii")
        return f"{version}:{token}"

    def decrypt(self, blob: str) -> str:
        """Decrypt a versioned blob produced by `encrypt`. Raises CryptoBoxError
        on bad version, missing key, or tampered/wrong-key ciphertext.

        Legacy unprefixed blobs (older than v1) are NOT supported — we have
        none in production. If we ever need to ingest one, add a branch here.
        """
        if not isinstance(blob, str) or ":" not in blob:
            raise CryptoBoxError("blob is not a versioned crypto-box token")
        version, ciphertext = blob.split(":", 1)
        f = self._fernet_for(version)
        if f is None:
            raise CryptoBoxError(
                f"key for {version} is not configured "
                f"(set {self.prefix} for active version, "
                f"{self.prefix}S_{version.upper()} for retired versions)"
            )
        try:
            return f.decrypt(ciphertext.encode("ascii")).decode("utf-8")
        except InvalidToken as e:
            raise CryptoBoxError(
                "decrypt failed — wrong key, corrupted blob, or tampered ciphertext"
            ) from e


def version_of(blob: object) -> str | None:
    """The `vN` prefix of a crypto-box token, or None if `blob` is not one.
    Never decrypts."""
    if not isinstance(blob, str) or ":" not in blob:
        return None
    v = blob.split(":", 1)[0]
    return v if _VERSION_RE.match(v) else None


# ── Default family: BROKER_ENCRYPTION_KEY — the original API, unchanged ─────
# Active version comes from BROKER_ENCRYPTION_ACTIVE_VERSION (default v1).
_default_box = CryptoBox(_ACTIVE_ENV)
BrokerBox = _default_box


def is_configured() -> bool:
    """True if the active encryption key is set. Useful for boot checks."""
    return _default_box.is_configured()


def encrypt(plaintext: str) -> str:
    """Encrypt a string with the active key and return a versioned token
    like `v1:gAAAAA...`. Empty string raises (we never store empty secrets).
    """
    return _default_box.encrypt(plaintext)


def decrypt(blob: str) -> str:
    """Decrypt a versioned blob produced by `encrypt`. Raises CryptoBoxError
    on bad version, missing key, or tampered/wrong-key ciphertext.
    """
    return _default_box.decrypt(blob)


# ── Note-connector family: NOTE_ENCRYPTION_KEY — isolated key material ──────
# Active version comes from NOTE_ENCRYPTION_ACTIVE_VERSION (default v1).
NoteBox = CryptoBox("NOTE_ENCRYPTION_KEY")
