"""Key rotation for api.services.crypto_box (2026-10-21 Railway env-var leak).

Two properties, each proved independently:

  1. BACKWARD COMPAT, byte-for-byte. With none of the new env vars set, the
     new module produces EXACTLY the bytes the frozen pre-change module
     (tests/fixtures/crypto_box_legacy_v1.py) produces, for every family and
     for every combination of the env vars that already existed. Fernet is
     randomised (16-byte IV + timestamp), so both modules run under the same
     pinned `os.urandom` and clock; a differential oracle, not a re-statement.

  2. ROTATION. <PREFIX>S_V1=<old>, <PREFIX>=<new>, <FAMILY>_ACTIVE_VERSION=v2
     => new writes are `v2:` under the NEW key, old `v1:` rows still decrypt
     under the OLD key, and each family rotates without touching the other.
"""

from __future__ import annotations

import importlib.util
import itertools
import pathlib

import pytest
from cryptography.fernet import Fernet

from api.services import crypto_box

_LEGACY_PATH = pathlib.Path(__file__).parent / "fixtures" / "crypto_box_legacy_v1.py"

ALL_ENV = (
    "BROKER_ENCRYPTION_KEY", "BROKER_ENCRYPTION_KEYS_V1", "BROKER_ENCRYPTION_KEYS_V2",
    "BROKER_ENCRYPTION_ACTIVE_VERSION",
    "NOTE_ENCRYPTION_KEY", "NOTE_ENCRYPTION_KEYS_V1", "NOTE_ENCRYPTION_KEYS_V2",
    "NOTE_ENCRYPTION_ACTIVE_VERSION",
    "WISDOM_PRIVATE_KEY", "WISDOM_PRIVATE_KEYS_V1", "WISDOM_PRIVATE_ACTIVE_VERSION",
)


@pytest.fixture(autouse=True)
def _clean_env(monkeypatch):
    for name in ALL_ENV:
        monkeypatch.delenv(name, raising=False)


def _load_legacy():
    spec = importlib.util.spec_from_file_location("crypto_box_legacy_v1", _LEGACY_PATH)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


@pytest.fixture
def pinned_randomness(monkeypatch):
    """Make Fernet deterministic: fixed IV bytes and a fixed clock."""
    import cryptography.fernet as fernet_mod

    monkeypatch.setattr(fernet_mod.os, "urandom", lambda n: b"\x07" * n)
    monkeypatch.setattr(fernet_mod.time, "time", lambda: 1_790_000_000)


def _outcome(fn, *args):
    try:
        return ("ok", fn(*args))
    except Exception as e:  # noqa: BLE001 - the TYPE is the comparison
        return ("raise", type(e).__name__)


# ── 1. backward compatibility ───────────────────────────────────────────────

K_A = Fernet.generate_key().decode()
K_B = Fernet.generate_key().decode()

# Every value the PRE-EXISTING env vars can take for one family: unset, key A,
# key B. (Including active-unset-but-V1-set and V1-differs-from-active, the
# two cases where the old lookup order is load-bearing.)
_CHOICES = (None, K_A, K_B)


@pytest.mark.parametrize("family_prefix", ["BROKER_ENCRYPTION_KEY", "NOTE_ENCRYPTION_KEY"])
@pytest.mark.parametrize("active,v1", list(itertools.product(_CHOICES, _CHOICES)))
def test_no_new_env_is_byte_for_byte_identical_to_legacy(
        monkeypatch, pinned_randomness, family_prefix, active, v1):
    if active is not None:
        monkeypatch.setenv(family_prefix, active)
    if v1 is not None:
        monkeypatch.setenv(family_prefix + "S_V1", v1)
    legacy = _load_legacy()
    if family_prefix == "BROKER_ENCRYPTION_KEY":
        old_enc, old_dec, old_cfg = legacy.encrypt, legacy.decrypt, legacy.is_configured
        new_enc, new_dec, new_cfg = crypto_box.encrypt, crypto_box.decrypt, crypto_box.is_configured
    else:
        old_enc, old_dec, old_cfg = (legacy.NoteBox.encrypt, legacy.NoteBox.decrypt,
                                     legacy.NoteBox.is_configured)
        new_enc, new_dec, new_cfg = (crypto_box.NoteBox.encrypt, crypto_box.NoteBox.decrypt,
                                     crypto_box.NoteBox.is_configured)

    assert new_cfg() == old_cfg()
    for pt in ("hello-snaptrade-secret", "x", "üñí©ødé"):
        old = _outcome(old_enc, pt)
        new = _outcome(new_enc, pt)
        assert new == old, "encrypt output must be byte-identical with no new env var"
    # Decrypt: the same blobs (minted under each key with the legacy code) give
    # the same answer or the same exception type.
    for k in (K_A, K_B):
        blob = "v1:" + Fernet(k.encode()).encrypt(b"probe").decode()
        assert _outcome(new_dec, blob) == _outcome(old_dec, blob)
    for bad in ("", "no-colon", "v2:" + Fernet(K_A.encode()).encrypt(b"p").decode(), "v1:garbage"):
        assert _outcome(new_dec, bad) == _outcome(old_dec, bad)
    assert crypto_box.ACTIVE_VERSION == legacy.ACTIVE_VERSION == "v1"


def test_empty_active_version_env_is_the_same_as_unset(monkeypatch, pinned_randomness):
    """Railway clears a variable with "" (it ignores null) -- "" must mean default."""
    monkeypatch.setenv("BROKER_ENCRYPTION_KEY", K_A)
    legacy = _load_legacy()
    expected = legacy.encrypt("s")
    monkeypatch.setenv("BROKER_ENCRYPTION_ACTIVE_VERSION", "  ")
    assert crypto_box.encrypt("s") == expected


def test_active_version_env_names():
    assert crypto_box.CryptoBox("BROKER_ENCRYPTION_KEY").active_version_env == \
        "BROKER_ENCRYPTION_ACTIVE_VERSION"
    assert crypto_box.NoteBox.active_version_env == "NOTE_ENCRYPTION_ACTIVE_VERSION"
    assert crypto_box.CryptoBox("WISDOM_PRIVATE_KEY").active_version_env == \
        "WISDOM_PRIVATE_ACTIVE_VERSION"


# ── 2. rotation ─────────────────────────────────────────────────────────────

def _rotate(monkeypatch, prefix, active_env, old, new):
    monkeypatch.setenv(prefix + "S_V1", old)
    monkeypatch.setenv(prefix, new)
    monkeypatch.setenv(active_env, "v2")


def test_broker_rotation_old_rows_readable_new_writes_v2(monkeypatch):
    old, new = Fernet.generate_key().decode(), Fernet.generate_key().decode()
    monkeypatch.setenv("BROKER_ENCRYPTION_KEY", old)
    v1_blob = crypto_box.encrypt("pre-rotation-secret")
    assert v1_blob.startswith("v1:")

    _rotate(monkeypatch, "BROKER_ENCRYPTION_KEY", "BROKER_ENCRYPTION_ACTIVE_VERSION", old, new)

    assert crypto_box.decrypt(v1_blob) == "pre-rotation-secret"
    v2_blob = crypto_box.encrypt("post-rotation-secret")
    assert v2_blob.startswith("v2:")
    # ...and it really is under the NEW key, not the old one.
    token = v2_blob.split(":", 1)[1].encode()
    assert Fernet(new.encode()).decrypt(token) == b"post-rotation-secret"
    with pytest.raises(Exception):
        Fernet(old.encode()).decrypt(token)
    assert crypto_box.decrypt(v2_blob) == "post-rotation-secret"
    assert crypto_box.is_configured() is True


def test_rotation_without_v1_key_fails_closed_on_old_rows(monkeypatch):
    """The step the runbook says must not be skipped: no V1 => old rows are
    unreadable (CryptoBoxError), never silently decrypted with the wrong key."""
    old, new = Fernet.generate_key().decode(), Fernet.generate_key().decode()
    monkeypatch.setenv("BROKER_ENCRYPTION_KEY", old)
    v1_blob = crypto_box.encrypt("s")
    monkeypatch.setenv("BROKER_ENCRYPTION_KEY", new)
    monkeypatch.setenv("BROKER_ENCRYPTION_ACTIVE_VERSION", "v2")
    with pytest.raises(crypto_box.CryptoBoxError):
        crypto_box.decrypt(v1_blob)


def test_partial_states_never_lose_data(monkeypatch):
    """Each half-applied env state the owner can land in is SAFE (old rows
    still read, new rows still read after the remaining step)."""
    old, new = Fernet.generate_key().decode(), Fernet.generate_key().decode()
    monkeypatch.setenv("BROKER_ENCRYPTION_KEY", old)
    v1_blob = crypto_box.encrypt("s")

    # Step 1 only: V1=old with v1 active -> identical behaviour.
    monkeypatch.setenv("BROKER_ENCRYPTION_KEYS_V1", old)
    assert crypto_box.decrypt(v1_blob) == "s"
    b1 = crypto_box.encrypt("t")
    assert b1.startswith("v1:") and crypto_box.decrypt(b1) == "t"

    # New key set but ACTIVE_VERSION forgotten: V1 override still wins for v1,
    # so writes keep using the OLD key -- not rotated, but nothing is lost.
    monkeypatch.setenv("BROKER_ENCRYPTION_KEY", new)
    b2 = crypto_box.encrypt("u")
    assert b2.startswith("v1:")
    assert Fernet(old.encode()).decrypt(b2.split(":", 1)[1].encode()) == b"u"

    # Finish the rotation: every earlier blob still reads.
    monkeypatch.setenv("BROKER_ENCRYPTION_ACTIVE_VERSION", "v2")
    for blob, pt in ((v1_blob, "s"), (b1, "t"), (b2, "u")):
        assert crypto_box.decrypt(blob) == pt


def test_env_rollback_needs_the_v2_key_pinned(monkeypatch):
    """Runbook rollback: going back to v1 active after v2 rows exist requires
    <PREFIX>S_V2=<new key>; with it every row (v1 and v2) still reads."""
    old, new = Fernet.generate_key().decode(), Fernet.generate_key().decode()
    monkeypatch.setenv("BROKER_ENCRYPTION_KEY", old)
    v1_blob = crypto_box.encrypt("a")
    _rotate(monkeypatch, "BROKER_ENCRYPTION_KEY", "BROKER_ENCRYPTION_ACTIVE_VERSION", old, new)
    v2_blob = crypto_box.encrypt("b")

    monkeypatch.delenv("BROKER_ENCRYPTION_ACTIVE_VERSION")           # roll back, forgetting S_V2
    with pytest.raises(crypto_box.CryptoBoxError):
        crypto_box.decrypt(v2_blob)
    monkeypatch.setenv("BROKER_ENCRYPTION_KEYS_V2", new)              # the documented step
    assert crypto_box.decrypt(v1_blob) == "a"
    assert crypto_box.decrypt(v2_blob) == "b"


def test_code_rollback_to_legacy_module_reads_v2_rows_with_s_v2(monkeypatch):
    """Reverting THIS code while v2 rows exist: the old module still reads them
    once <PREFIX>S_V2=<new key> is set (it never knew ACTIVE_VERSION)."""
    old, new = Fernet.generate_key().decode(), Fernet.generate_key().decode()
    monkeypatch.setenv("BROKER_ENCRYPTION_KEY", old)
    v1_blob = crypto_box.encrypt("a")
    _rotate(monkeypatch, "BROKER_ENCRYPTION_KEY", "BROKER_ENCRYPTION_ACTIVE_VERSION", old, new)
    v2_blob = crypto_box.encrypt("b")
    monkeypatch.setenv("BROKER_ENCRYPTION_KEYS_V2", new)
    legacy = _load_legacy()
    assert legacy.decrypt(v1_blob) == "a"
    assert legacy.decrypt(v2_blob) == "b"


def test_families_rotate_independently(monkeypatch):
    b_old, n_old, n_new = (Fernet.generate_key().decode() for _ in range(3))
    monkeypatch.setenv("BROKER_ENCRYPTION_KEY", b_old)
    monkeypatch.setenv("NOTE_ENCRYPTION_KEY", n_old)
    broker_blob = crypto_box.encrypt("b")
    note_blob = crypto_box.NoteBox.encrypt("n")

    _rotate(monkeypatch, "NOTE_ENCRYPTION_KEY", "NOTE_ENCRYPTION_ACTIVE_VERSION", n_old, n_new)

    assert crypto_box.NoteBox.encrypt("n2").startswith("v2:")
    assert crypto_box.NoteBox.decrypt(note_blob) == "n"
    # Broker untouched: still v1, still the old broker key.
    assert crypto_box.encrypt("b2").startswith("v1:")
    assert crypto_box.decrypt(broker_blob) == "b"


def test_wisdom_private_box_follows_its_own_env(monkeypatch):
    from api.services.wisdom.core.private import PrivateBox
    old, new = Fernet.generate_key().decode(), Fernet.generate_key().decode()
    monkeypatch.setenv("WISDOM_PRIVATE_KEY", old)
    blob = PrivateBox.encrypt("p")
    _rotate(monkeypatch, "WISDOM_PRIVATE_KEY", "WISDOM_PRIVATE_ACTIVE_VERSION", old, new)
    assert PrivateBox.encrypt("q").startswith("v2:")
    assert PrivateBox.decrypt(blob) == "p"


@pytest.mark.parametrize("raw", ["2", "V2x", "v0", "v", "v1.5", "two", "v-2"])
def test_invalid_active_version_fails_closed(monkeypatch, raw):
    monkeypatch.setenv("BROKER_ENCRYPTION_KEY", K_A)
    monkeypatch.setenv("BROKER_ENCRYPTION_ACTIVE_VERSION", raw)
    with pytest.raises(crypto_box.CryptoBoxError):
        crypto_box.encrypt("s")
    assert crypto_box.is_configured() is False


def test_active_version_is_normalised(monkeypatch):
    old, new = Fernet.generate_key().decode(), Fernet.generate_key().decode()
    _rotate(monkeypatch, "BROKER_ENCRYPTION_KEY", "BROKER_ENCRYPTION_ACTIVE_VERSION", old, new)
    monkeypatch.setenv("BROKER_ENCRYPTION_ACTIVE_VERSION", " V2 ")
    assert crypto_box.encrypt("s").startswith("v2:")


def test_same_key_and_version_of(monkeypatch):
    k = Fernet.generate_key().decode()
    monkeypatch.setenv("BROKER_ENCRYPTION_KEY", k)
    monkeypatch.setenv("BROKER_ENCRYPTION_KEYS_V1", " " + k + "\n")
    monkeypatch.setenv("BROKER_ENCRYPTION_ACTIVE_VERSION", "v2")
    box = crypto_box.BrokerBox
    assert box.same_key("v1", "v2") is True
    monkeypatch.setenv("BROKER_ENCRYPTION_KEY", Fernet.generate_key().decode())
    assert box.same_key("v1", "v2") is False
    monkeypatch.delenv("BROKER_ENCRYPTION_KEYS_V1")
    assert box.same_key("v1", "v2") is False  # missing key is never "the same"
    assert crypto_box.version_of("v1:gAAAA") == "v1"
    assert crypto_box.version_of("v12:x") == "v12"
    assert crypto_box.version_of("nope") is None
    assert crypto_box.version_of(None) is None
    assert crypto_box.version_of("V1:x") is None


def test_pinned_active_version_still_honoured(monkeypatch):
    """A caller that pins active_version in the constructor (the old API) keeps it."""
    monkeypatch.setenv("X_KEY", K_A)
    monkeypatch.setenv("X_ACTIVE_VERSION", "v2")
    assert crypto_box.CryptoBox("X_KEY", active_version="v1").encrypt("s").startswith("v1:")
