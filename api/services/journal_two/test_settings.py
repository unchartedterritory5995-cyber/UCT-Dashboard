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


# ── Phase D — Regime-Aware Sizing ────────────────────────────────────────────

def test_validate_accepts_phase_d_regime_multipliers():
    from api.services.journal_two import settings as svc
    payload = _baseline_payload() | {
        "regimeSizeMultipliers": {"green": 1.0, "amber": 0.75, "orange": 0.5, "red": 0},
    }
    out = svc.validate_settings_payload(payload)
    assert out["regimeSizeMultipliers"] == {"green": 1.0, "amber": 0.75, "orange": 0.5, "red": 0.0}


def test_validate_phase_d_partial_multipliers():
    from api.services.journal_two import settings as svc
    out = svc.validate_settings_payload(_baseline_payload() | {
        "regimeSizeMultipliers": {"orange": 0.5, "red": 0},
    })
    assert out["regimeSizeMultipliers"] == {"orange": 0.5, "red": 0.0}


def test_validate_phase_d_defaults_to_empty_dict():
    from api.services.journal_two import settings as svc
    out = svc.validate_settings_payload(_baseline_payload())
    assert out["regimeSizeMultipliers"] == {}


def test_validate_phase_d_rejects_invalid():
    from api.services.journal_two import settings as svc
    from api.services.journal_two.settings import SettingsValidationError
    base = _baseline_payload()
    invalid = [
        {"regimeSizeMultipliers": "green"},                       # not a dict
        {"regimeSizeMultipliers": {"foo": 1.0}},                  # unknown key
        {"regimeSizeMultipliers": {"green": -0.1}},               # negative
        {"regimeSizeMultipliers": {"green": 5.1}},                # >5x
        {"regimeSizeMultipliers": {"green": "1.0"}},              # string
    ]
    for bad in invalid:
        with pytest.raises(SettingsValidationError):
            svc.validate_settings_payload(base | bad)


# ── Phase E — Mistakes + Emotions taxonomy ───────────────────────────────────

def test_validate_accepts_phase_e_taxonomies():
    from api.services.journal_two import settings as svc
    payload = _baseline_payload() | {
        "mistakeTags": ["fomo", "chasing", "fomo"],   # dupe should be deduped
        "emotionTags": ["greedy", "anxious"],
    }
    out = svc.validate_settings_payload(payload)
    assert out["mistakeTags"] == ["fomo", "chasing"]
    assert out["emotionTags"] == ["greedy", "anxious"]


def test_validate_phase_e_defaults_to_empty_lists():
    from api.services.journal_two import settings as svc
    out = svc.validate_settings_payload(_baseline_payload())
    assert out["mistakeTags"] == []
    assert out["emotionTags"] == []


# ── Phase F — Nudges thresholds ──────────────────────────────────────────────

def test_validate_accepts_phase_f_thresholds():
    from api.services.journal_two import settings as svc
    payload = _baseline_payload() | {
        "lossStreakThreshold": 3,
        "winStreakThreshold": 5,
        "staleHoldDaysThreshold": 30,
    }
    out = svc.validate_settings_payload(payload)
    assert out["lossStreakThreshold"] == 3
    assert out["winStreakThreshold"] == 5
    assert out["staleHoldDaysThreshold"] == 30


def test_validate_phase_f_thresholds_default_to_none():
    from api.services.journal_two import settings as svc
    out = svc.validate_settings_payload(_baseline_payload())
    assert out["lossStreakThreshold"] is None
    assert out["winStreakThreshold"] is None
    assert out["staleHoldDaysThreshold"] is None


# ── Phase 5 (P5-A2) — per-setup rule labels (setupRules) ─────────────────────
#
# setupRules is a parallel structure to `setups`:
#   { [setupName]: [{id: str, label: str}] }
# The checklist template each trade of that setup is graded against later.
# Rules are {id, label} only — NO `checked` (that's per-trade, a later task).


def test_setup_rules_round_trips_through_save_load(db_conn):
    from api.services.journal_two import settings as svc
    p = _make_payload(setups=["Breakout"]) | {
        "setupRules": {
            "Breakout": [
                {"id": "r-1", "label": "Above prior day high"},
                {"id": "r-2", "label": "Volume expansion"},
            ],
        },
    }
    svc.upsert_settings("u", p, conn=db_conn)
    got = svc.get_settings("u", conn=db_conn)
    assert got["setupRules"] == {
        "Breakout": [
            {"id": "r-1", "label": "Above prior day high"},
            {"id": "r-2", "label": "Volume expansion"},
        ],
    }


def test_setup_rules_default_empty_when_unset(db_conn):
    from api.services.journal_two import settings as svc
    got = svc.get_settings("u", conn=db_conn)
    assert got["setupRules"] == {}
    # And validate_settings_payload defaults it too.
    out = svc.validate_settings_payload(_baseline_payload())
    assert out["setupRules"] == {}


def test_validate_setup_rules_drops_rules_for_unknown_setup():
    from api.services.journal_two.settings import _validate_setup_rules
    out = _validate_setup_rules(
        {
            "Breakout": [{"id": "a", "label": "Rule A"}],
            "Ghost": [{"id": "b", "label": "Orphaned"}],
        },
        ["Breakout"],  # valid setups — "Ghost" is not present
    )
    assert out == {"Breakout": [{"id": "a", "label": "Rule A"}]}
    assert "Ghost" not in out


def test_validate_setup_rules_via_payload_drops_orphaned_setup():
    """When a setup is deleted from `setups`, its rules are dropped on save."""
    from api.services.journal_two import settings as svc
    out = svc.validate_settings_payload(
        _baseline_payload() | {
            "setups": ["Breakout"],          # Pullback removed
            "setupRules": {
                "Breakout": [{"id": "a", "label": "Rule A"}],
                "Pullback": [{"id": "b", "label": "Stale rule"}],
            },
        }
    )
    assert out["setupRules"] == {"Breakout": [{"id": "a", "label": "Rule A"}]}


def test_validate_setup_rules_drops_blank_labels_and_trims():
    from api.services.journal_two.settings import _validate_setup_rules
    out = _validate_setup_rules(
        {
            "Breakout": [
                {"id": "a", "label": "  Trim me  "},
                {"id": "b", "label": "   "},   # blank after strip → dropped
                {"id": "c", "label": ""},       # empty → dropped
                {"id": "d", "label": 123},      # non-string → dropped
            ],
        },
        ["Breakout"],
    )
    assert out == {"Breakout": [{"id": "a", "label": "Trim me"}]}


def test_validate_setup_rules_drops_rules_without_id():
    from api.services.journal_two.settings import _validate_setup_rules
    out = _validate_setup_rules(
        {
            "Breakout": [
                {"id": "keep", "label": "Kept"},
                {"label": "No id"},              # missing id → dropped
                {"id": "", "label": "Blank id"}, # blank id → dropped
                {"id": "   ", "label": "WS id"}, # whitespace id → dropped
                {"id": 7, "label": "Int id"},    # non-string id → dropped
            ],
        },
        ["Breakout"],
    )
    assert out == {"Breakout": [{"id": "keep", "label": "Kept"}]}


def test_validate_setup_rules_caps_at_25_per_setup():
    from api.services.journal_two.settings import _validate_setup_rules
    many = [{"id": f"r{i}", "label": f"Rule {i}"} for i in range(30)]
    out = _validate_setup_rules({"Breakout": many}, ["Breakout"])
    assert len(out["Breakout"]) == 25
    # keeps the first 25 in order
    assert out["Breakout"][0] == {"id": "r0", "label": "Rule 0"}
    assert out["Breakout"][-1] == {"id": "r24", "label": "Rule 24"}


def test_validate_setup_rules_empty_setup_key_dropped():
    """A setup whose rules all get dropped yields no key at all."""
    from api.services.journal_two.settings import _validate_setup_rules
    out = _validate_setup_rules(
        {"Breakout": [{"id": "", "label": ""}]}, ["Breakout"]
    )
    assert out == {}


def test_validate_setup_rules_rejects_non_dict():
    from api.services.journal_two.settings import _validate_setup_rules
    from api.services.journal_two.settings import SettingsValidationError
    with pytest.raises(SettingsValidationError):
        _validate_setup_rules(["not", "a", "dict"], [])


def test_validate_setup_rules_none_is_empty():
    from api.services.journal_two.settings import _validate_setup_rules
    assert _validate_setup_rules(None, ["Breakout"]) == {}
    assert _validate_setup_rules("", ["Breakout"]) == {}
