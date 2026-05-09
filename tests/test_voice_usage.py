"""Voice usage tracking — Mode A second counting + monthly cap."""

from datetime import datetime
from api.services.auth_db import init_db
from api.services.auth_service import create_user
from api.services.voice_usage import (
    record_mode_a_seconds,
    get_monthly_usage,
    is_within_mode_a_cap,
    MODE_A_DEFAULT_CAP_SECONDS,
)


def _make_user():
    init_db()
    return create_user(f"vusage_{__import__('uuid').uuid4()}@example.com", "password123")["id"]


def test_first_record_creates_row():
    uid = _make_user()
    record_mode_a_seconds(uid, 30)
    usage = get_monthly_usage(uid)
    assert usage["mode_a_seconds"] == 30
    assert usage["year_month"] == datetime.utcnow().strftime("%Y-%m")


def test_record_accumulates():
    uid = _make_user()
    record_mode_a_seconds(uid, 30)
    record_mode_a_seconds(uid, 45)
    usage = get_monthly_usage(uid)
    assert usage["mode_a_seconds"] == 75


def test_within_cap_default():
    uid = _make_user()
    assert is_within_mode_a_cap(uid) is True
    record_mode_a_seconds(uid, 100)
    assert is_within_mode_a_cap(uid) is True


def test_at_cap_blocks():
    uid = _make_user()
    record_mode_a_seconds(uid, MODE_A_DEFAULT_CAP_SECONDS)
    assert is_within_mode_a_cap(uid) is False


def test_admin_uncapped(monkeypatch):
    uid = _make_user()
    record_mode_a_seconds(uid, MODE_A_DEFAULT_CAP_SECONDS + 1000)
    # Admin override path
    assert is_within_mode_a_cap(uid, is_admin=True) is True


# ── Mode B ──────────────────────────────────────────────────────────────────

def test_record_mode_b_call_increments():
    from api.services.voice_usage import (
        record_mode_b_call, get_monthly_usage, MODE_B_DEFAULT_CAP_CALLS,
    )
    uid = _make_user()
    record_mode_b_call(uid)
    record_mode_b_call(uid)
    u = get_monthly_usage(uid)
    assert u["mode_b_calls"] == 2


def test_within_mode_b_cap():
    from api.services.voice_usage import (
        record_mode_b_call, is_within_mode_b_cap, MODE_B_DEFAULT_CAP_CALLS,
    )
    uid = _make_user()
    assert is_within_mode_b_cap(uid)
    for _ in range(MODE_B_DEFAULT_CAP_CALLS):
        record_mode_b_call(uid)
    assert not is_within_mode_b_cap(uid)
    assert is_within_mode_b_cap(uid, is_admin=True)
