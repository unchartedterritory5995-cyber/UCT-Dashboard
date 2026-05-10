"""Settings service — CRUD, defaults seeding, validation, user isolation."""

import os
import sqlite3
import tempfile

import pytest


@pytest.fixture
def db_conn(monkeypatch):
    """Fresh in-memory-like DB per test. Uses a temp file because the
    auth_db module opens connections by path, not handle."""
    tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    tmp.close()
    monkeypatch.setenv("AUTH_DB_PATH", tmp.name)

    # Force re-resolution of _DB_PATH by reimporting
    import importlib
    from api.services import auth_db
    importlib.reload(auth_db)

    auth_db.init_db()
    conn = sqlite3.connect(tmp.name)
    conn.row_factory = sqlite3.Row
    yield conn
    conn.close()
    os.unlink(tmp.name)


def test_get_settings_seeds_defaults_on_first_read(db_conn):
    from api.services.journal_two import settings as svc
    got = svc.get_settings("user-1", conn=db_conn)
    assert got["userId"] == "user-1"
    assert got["accountSize"] == 100_000
    assert got["defaultStop"] == {"mode": "custom"}
    assert got["positionClosing"] == "FIFO"
    assert got["breakevenRange"] == {"enabled": False, "unit": "$", "value": 0}
    assert got["setups"] == []
    assert got["createdAt"]
    assert got["updatedAt"]


def test_get_settings_idempotent_after_seed(db_conn):
    from api.services.journal_two import settings as svc
    first = svc.get_settings("user-1", conn=db_conn)
    second = svc.get_settings("user-1", conn=db_conn)
    assert first["id"] == second["id"]
    assert first["createdAt"] == second["createdAt"]


def test_user_isolation(db_conn):
    from api.services.journal_two import settings as svc
    svc.upsert_settings("user-A", _make_payload(account_size=50_000), conn=db_conn)
    svc.upsert_settings("user-B", _make_payload(account_size=200_000), conn=db_conn)

    a = svc.get_settings("user-A", conn=db_conn)
    b = svc.get_settings("user-B", conn=db_conn)
    assert a["accountSize"] == 50_000
    assert b["accountSize"] == 200_000
    assert a["id"] != b["id"]


def test_upsert_round_trip_custom_stop(db_conn):
    from api.services.journal_two import settings as svc
    p = _make_payload(default_stop={"mode": "custom"})
    svc.upsert_settings("u", p, conn=db_conn)
    got = svc.get_settings("u", conn=db_conn)
    assert got["defaultStop"] == {"mode": "custom"}


def test_upsert_round_trip_bar_low_high(db_conn):
    from api.services.journal_two import settings as svc
    p = _make_payload(default_stop={"mode": "bar_low_high", "buffer": 0.05, "bufferUnit": "%"})
    svc.upsert_settings("u", p, conn=db_conn)
    got = svc.get_settings("u", conn=db_conn)
    assert got["defaultStop"] == {"mode": "bar_low_high", "buffer": 0.05, "bufferUnit": "%"}


def test_upsert_round_trip_fixed_dollar(db_conn):
    from api.services.journal_two import settings as svc
    p = _make_payload(default_stop={"mode": "fixed_dollar_risk", "amount": 250})
    svc.upsert_settings("u", p, conn=db_conn)
    got = svc.get_settings("u", conn=db_conn)
    assert got["defaultStop"] == {"mode": "fixed_dollar_risk", "amount": 250.0}


def test_upsert_round_trip_fixed_percent(db_conn):
    from api.services.journal_two import settings as svc
    p = _make_payload(default_stop={"mode": "fixed_percent_distance", "percent": 7.5})
    svc.upsert_settings("u", p, conn=db_conn)
    got = svc.get_settings("u", conn=db_conn)
    assert got["defaultStop"] == {"mode": "fixed_percent_distance", "percent": 7.5}


# ── BE-range `enabled` invariant ─────────────────────────────────────────────

def test_breakeven_enabled_invariant_server_computes_from_value(db_conn):
    """Client sends enabled=True but value=0 — server overrides to enabled=False."""
    from api.services.journal_two import settings as svc
    lying_payload = _make_payload(
        breakeven_range={"enabled": True, "unit": "$", "value": 0}
    )
    svc.upsert_settings("u", lying_payload, conn=db_conn)
    got = svc.get_settings("u", conn=db_conn)
    assert got["breakevenRange"]["enabled"] is False
    assert got["breakevenRange"]["value"] == 0.0


def test_breakeven_enabled_true_when_value_nonzero(db_conn):
    from api.services.journal_two import settings as svc
    # Client sends enabled=False but value>0 — server overrides to True
    lying_payload = _make_payload(
        breakeven_range={"enabled": False, "unit": "$", "value": 20}
    )
    svc.upsert_settings("u", lying_payload, conn=db_conn)
    got = svc.get_settings("u", conn=db_conn)
    assert got["breakevenRange"]["enabled"] is True
    assert got["breakevenRange"]["value"] == 20.0


# ── Setups handling ──────────────────────────────────────────────────────────

def test_setups_dedupe_and_strip(db_conn):
    from api.services.journal_two import settings as svc
    p = _make_payload(setups=["Breakout", "  Breakout  ", "Pullback", ""])
    svc.upsert_settings("u", p, conn=db_conn)
    got = svc.get_settings("u", conn=db_conn)
    assert got["setups"] == ["Breakout", "Pullback"]


# ── Validation rejections ────────────────────────────────────────────────────

def test_rejects_missing_account_size(db_conn):
    from api.services.journal_two import settings as svc
    from api.services.journal_two.settings import SettingsValidationError
    p = _make_payload()
    del p["accountSize"]
    with pytest.raises(SettingsValidationError):
        svc.upsert_settings("u", p, conn=db_conn)


def test_rejects_zero_account_size(db_conn):
    from api.services.journal_two import settings as svc
    from api.services.journal_two.settings import SettingsValidationError
    with pytest.raises(SettingsValidationError):
        svc.upsert_settings("u", _make_payload(account_size=0), conn=db_conn)


def test_rejects_invalid_closing_mode(db_conn):
    from api.services.journal_two import settings as svc
    from api.services.journal_two.settings import SettingsValidationError
    p = _make_payload()
    p["positionClosing"] = "FIFA"
    with pytest.raises(SettingsValidationError):
        svc.upsert_settings("u", p, conn=db_conn)


def test_rejects_invalid_stop_mode(db_conn):
    from api.services.journal_two import settings as svc
    from api.services.journal_two.settings import SettingsValidationError
    p = _make_payload(default_stop={"mode": "nonsense"})
    with pytest.raises(SettingsValidationError):
        svc.upsert_settings("u", p, conn=db_conn)


def test_rejects_bar_low_high_missing_buffer(db_conn):
    from api.services.journal_two import settings as svc
    from api.services.journal_two.settings import SettingsValidationError
    p = _make_payload(default_stop={"mode": "bar_low_high", "bufferUnit": "$"})
    with pytest.raises(SettingsValidationError):
        svc.upsert_settings("u", p, conn=db_conn)


def test_rejects_fixed_percent_out_of_range(db_conn):
    from api.services.journal_two import settings as svc
    from api.services.journal_two.settings import SettingsValidationError
    p = _make_payload(default_stop={"mode": "fixed_percent_distance", "percent": 150})
    with pytest.raises(SettingsValidationError):
        svc.upsert_settings("u", p, conn=db_conn)


# ── Helpers ──────────────────────────────────────────────────────────────────

def _make_payload(
    account_size=100_000,
    default_stop=None,
    closing="FIFO",
    breakeven_range=None,
    setups=None,
):
    return {
        "accountSize": account_size,
        "defaultStop": default_stop or {"mode": "custom"},
        "positionClosing": closing,
        "breakevenRange": breakeven_range or {"enabled": False, "unit": "$", "value": 0},
        "setups": setups if setups is not None else [],
    }


# Re-export _make_payload as _baseline_payload for Phase A tests
_baseline_payload = _make_payload


# ── Phase A — Entry Guard settings ───────────────────────────────────────────

def test_validate_accepts_phase_a_guards():
    from api.services.journal_two import settings as svc
    payload = _baseline_payload() | {
        "defaultSizePct": 5,
        "defaultRMultipleTarget": 2,
        "maxRiskPerTradePct": 1,
    }
    out = svc.validate_settings_payload(payload)
    assert out["defaultSizePct"] == 5.0
    assert out["defaultRMultipleTarget"] == 2.0
    assert out["maxRiskPerTradePct"] == 1.0


def test_validate_phase_a_guards_default_to_none():
    from api.services.journal_two import settings as svc
    out = svc.validate_settings_payload(_baseline_payload())
    assert out["defaultSizePct"] is None
    assert out["defaultRMultipleTarget"] is None
    assert out["maxRiskPerTradePct"] is None


def test_validate_phase_a_guards_reject_invalid_ranges():
    from api.services.journal_two import settings as svc
    from api.services.journal_two.settings import SettingsValidationError
    base = _baseline_payload()
    for field, bad_value in [
        ("defaultSizePct", -1),
        ("defaultSizePct", 101),
        ("defaultRMultipleTarget", 0),
        ("maxRiskPerTradePct", -0.5),
        ("maxRiskPerTradePct", 100),
    ]:
        with pytest.raises(SettingsValidationError):
            svc.validate_settings_payload(base | {field: bad_value})


# ── Phase B — Session Discipline settings ────────────────────────────────────

def test_validate_accepts_phase_b_guards():
    from api.services.journal_two import settings as svc
    payload = _baseline_payload() | {
        "dailyLossLimitPct": 2,
        "coolingOffMinutesAfterLoss": 15,
        "noTradeWindowsET": [
            {"start": "11:30", "end": "13:30", "label": "Lunch chop"},
            {"start": "09:30", "end": "09:45"},
        ],
    }
    out = svc.validate_settings_payload(payload)
    assert out["dailyLossLimitPct"] == 2.0
    assert out["coolingOffMinutesAfterLoss"] == 15
    assert out["noTradeWindowsET"] == [
        {"start": "11:30", "end": "13:30", "label": "Lunch chop"},
        {"start": "09:30", "end": "09:45", "label": ""},
    ]


def test_validate_phase_b_guards_default_to_none_or_empty():
    from api.services.journal_two import settings as svc
    out = svc.validate_settings_payload(_baseline_payload())
    assert out["dailyLossLimitPct"] is None
    assert out["coolingOffMinutesAfterLoss"] is None
    assert out["noTradeWindowsET"] == []


def test_validate_phase_b_guards_reject_invalid():
    from api.services.journal_two import settings as svc
    from api.services.journal_two.settings import SettingsValidationError
    base = _baseline_payload()
    invalid = [
        {"dailyLossLimitPct": -1},                                    # negative
        {"dailyLossLimitPct": 100},                                   # >=100 (uses _validate_optional_pct)
        {"coolingOffMinutesAfterLoss": 0},                            # not > 0
        {"coolingOffMinutesAfterLoss": 1.5},                          # not integer
        {"noTradeWindowsET": "11:30-13:30"},                          # not a list
        {"noTradeWindowsET": [{"start": "25:00", "end": "13:00"}]},   # invalid HH:MM (hour 25)
        {"noTradeWindowsET": [{"start": "11:30", "end": "11:30"}]},   # zero-length window
        {"noTradeWindowsET": [{"start": "13:00", "end": "11:00"}]},   # end before start (no overnight in v1)
    ]
    for bad in invalid:
        with pytest.raises(SettingsValidationError):
            svc.validate_settings_payload(base | bad)


# ── Phase C — Setup-Aware Coaching settings ──────────────────────────────────

def test_validate_accepts_phase_c_guards():
    from api.services.journal_two import settings as svc
    payload = _baseline_payload() | {
        "setups": ["Bull Flag", "Pullback", "Breakout"],
        "aPlusSetups": ["Bull Flag", "Pullback"],
        "aPlusRiskMultiplier": 1.5,
    }
    out = svc.validate_settings_payload(payload)
    assert out["aPlusSetups"] == ["Bull Flag", "Pullback"]
    assert out["aPlusRiskMultiplier"] == 1.5


def test_validate_phase_c_guards_default_to_empty_or_none():
    from api.services.journal_two import settings as svc
    out = svc.validate_settings_payload(_baseline_payload())
    assert out["aPlusSetups"] == []
    assert out["aPlusRiskMultiplier"] is None


def test_validate_phase_c_guards_reject_invalid():
    from api.services.journal_two import settings as svc
    from api.services.journal_two.settings import SettingsValidationError
    base = _baseline_payload()
    invalid = [
        {"aPlusSetups": "Bull Flag"},                      # not a list
        {"aPlusSetups": [123, "ok"]},                      # non-string entry
        {"aPlusRiskMultiplier": 0},                        # not > 1
        {"aPlusRiskMultiplier": 1},                        # not > 1 (must elevate)
        {"aPlusRiskMultiplier": -0.5},                     # negative
        {"aPlusRiskMultiplier": 11},                       # cap at 10x
    ]
    for bad in invalid:
        with pytest.raises(SettingsValidationError):
            svc.validate_settings_payload(base | bad)
