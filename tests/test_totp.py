"""
TOTP 2FA service tests — enrollment, replay guard, backup codes, challenge
tokens, and at-rest encryption. Deterministic: codes are computed with pyotp
at a fixed timestamp that is also passed into the verifier.
"""

import pytest
import pyotp
from cryptography.fernet import Fernet

from api.services import auth_db, totp_service
from api.services.auth_service import create_user

T0 = 1_800_000_000  # fixed epoch anchor for deterministic steps


@pytest.fixture()
def db(tmp_path, monkeypatch):
    monkeypatch.setattr(auth_db, "_DB_PATH", str(tmp_path / "auth_test.db"))
    monkeypatch.setattr(totp_service, "_schema_ready", False)
    monkeypatch.setenv("BROKER_ENCRYPTION_KEY", Fernet.generate_key().decode())
    auth_db.init_db()
    return create_user("totp@example.com", "pw12345678")


def _enroll(user):
    setup = totp_service.begin_setup(user["id"], user["email"])
    code = pyotp.TOTP(setup["secret"]).at(T0)
    codes = totp_service.confirm_setup(user["id"], code, now=T0)
    return setup["secret"], codes


def test_setup_and_confirm_flow(db):
    user = db
    assert totp_service.status(user["id"])["enabled"] is False
    setup = totp_service.begin_setup(user["id"], user["email"])
    assert setup["otpauth_url"].startswith("otpauth://totp/")
    assert "UCT%20Intelligence" in setup["otpauth_url"]
    assert setup["qr_svg"].lstrip().startswith("<svg")
    # not enabled until confirmed
    assert totp_service.is_enabled(user["id"]) is False
    codes = totp_service.confirm_setup(user["id"], pyotp.TOTP(setup["secret"]).at(T0), now=T0)
    assert len(codes) == 10
    assert all(len(c) == 9 and c[4] == "-" for c in codes)
    st = totp_service.status(user["id"])
    assert st["enabled"] is True and st["backup_codes_remaining"] == 10


def test_confirm_rejects_wrong_code(db):
    user = db
    totp_service.begin_setup(user["id"], user["email"])
    with pytest.raises(ValueError):
        totp_service.confirm_setup(user["id"], "000000")
    assert totp_service.is_enabled(user["id"]) is False


def test_begin_setup_reissues_while_pending_but_not_when_enabled(db):
    user = db
    a = totp_service.begin_setup(user["id"], user["email"])
    b = totp_service.begin_setup(user["id"], user["email"])
    assert a["secret"] != b["secret"]  # fresh secret each restart
    totp_service.confirm_setup(user["id"], pyotp.TOTP(b["secret"]).at(T0), now=T0)
    with pytest.raises(ValueError):
        totp_service.begin_setup(user["id"], user["email"])


def test_secret_is_encrypted_at_rest(db):
    user = db
    setup = totp_service.begin_setup(user["id"], user["email"])
    row = totp_service._load(user["id"])
    assert setup["secret"] not in row["secret_encrypted"]
    assert row["secret_encrypted"].startswith("v1:")


def test_login_code_verifies_with_clock_skew_and_replay_guard(db):
    user = db
    secret, _ = _enroll(user)
    totp = pyotp.TOTP(secret)
    later = T0 + 300  # well past the enrollment step
    # previous-step code still accepted (±1 window)
    assert totp_service.verify_login_code(user["id"], totp.at(later - 30), now=later) is True
    # replaying the SAME step fails; the current step (a later step) works
    assert totp_service.verify_login_code(user["id"], totp.at(later - 30), now=later) is False
    assert totp_service.verify_login_code(user["id"], totp.at(later), now=later) is True
    # and a code far outside the window never matches
    assert totp_service.verify_login_code(user["id"], totp.at(later + 300), now=later) is False


def test_enrollment_code_cannot_be_replayed_at_login(db):
    user = db
    setup = totp_service.begin_setup(user["id"], user["email"])
    code = pyotp.TOTP(setup["secret"]).at(T0)
    totp_service.confirm_setup(user["id"], code, now=T0)
    assert totp_service.verify_login_code(user["id"], code, now=T0) is False


def test_backup_codes_single_use(db):
    user = db
    _, codes = _enroll(user)
    assert totp_service.verify_login_code(user["id"], codes[0]) is True
    assert totp_service.verify_login_code(user["id"], codes[0]) is False  # consumed
    assert totp_service.backup_codes_remaining(user["id"]) == 9
    # sloppy formatting still accepted
    assert totp_service.verify_login_code(user["id"], codes[1].lower().replace("-", " ")) is True


def test_regenerate_invalidates_old_codes(db):
    user = db
    _, old = _enroll(user)
    new = totp_service.regenerate_backup_codes(user["id"])
    assert len(new) == 10 and set(new).isdisjoint(set(old))
    assert totp_service.verify_login_code(user["id"], old[0]) is False
    assert totp_service.verify_login_code(user["id"], new[0]) is True


def test_disable_clears_everything(db):
    user = db
    secret, codes = _enroll(user)
    totp_service.disable(user["id"])
    assert totp_service.is_enabled(user["id"]) is False
    assert totp_service.status(user["id"])["backup_codes_remaining"] == 0
    assert totp_service.verify_login_code(user["id"], pyotp.TOTP(secret).at(T0 + 600)) is False
    assert totp_service.verify_login_code(user["id"], codes[2]) is False


def test_verify_rejects_garbage_without_raising(db):
    user = db
    _enroll(user)
    for bad in ("", "abc", "12345", "1234567", None, "ZZZZ-ZZZZ", "!!!!!!"):
        assert totp_service.verify_login_code(user["id"], bad) is False


def test_challenge_token_roundtrip_expiry_and_tamper(db):
    user = db
    tok = totp_service.mint_challenge(user["id"], now=T0)
    assert totp_service.read_challenge(tok, now=T0 + 10) == user["id"]
    assert totp_service.read_challenge(tok, now=T0 + 301) is None  # expired
    payload, sig = tok.split(".", 1)
    assert totp_service.read_challenge(f"{payload}x.{sig}", now=T0) is None  # tampered
    assert totp_service.read_challenge("garbage", now=T0) is None
    assert totp_service.read_challenge("", now=T0) is None


def test_setup_unavailable_without_encryption_key(db, monkeypatch):
    user = db
    monkeypatch.delenv("BROKER_ENCRYPTION_KEY", raising=False)
    assert totp_service.is_available() is False
    with pytest.raises(RuntimeError):
        totp_service.begin_setup(user["id"], user["email"])
