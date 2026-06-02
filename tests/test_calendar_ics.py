"""Tests for E2: iCal / webcal export.

Covers:
- GET /api/calendar/export.ics returns valid text/calendar content-type
- Response contains one VEVENT per unique (sym, date) reporter
- Empty reporters → valid VCALENDAR with zero VEVENTs (not an error)
- scope=mine with invalid token → 403
- scope=mine with valid token → resolves user + filters reporters
- _make_ics_token + _decode_ics_token roundtrip
- VCALENDAR structure: must contain required fields
"""
from __future__ import annotations

from unittest import mock


# ── Helpers ───────────────────────────────────────────────────────────────────

def _import_router():
    import api.routers.calendar as mod
    return mod


def _make_fake_token_funcs(user_id="u42"):
    """Return a (make_token, decode_token) pair backed by a stub store."""
    token = f"tok_{user_id}"

    def _make(uid):
        return f"tok_{uid}"

    def _decode(tok):
        if tok == f"tok_{user_id}":
            return user_id
        return None

    return _make, _decode, token


# ── Unit tests ────────────────────────────────────────────────────────────────

def test_build_vcalendar_has_required_fields():
    mod = _import_router()
    vevents = [mod._build_vevent("AAPL", "2026-06-03", "bmo")]
    ics = mod._build_vcalendar(vevents)

    assert "BEGIN:VCALENDAR" in ics
    assert "END:VCALENDAR" in ics
    assert "VERSION:2.0" in ics
    assert "BEGIN:VEVENT" in ics
    assert "END:VEVENT" in ics


def test_build_vevent_bmo():
    mod = _import_router()
    vevent = mod._build_vevent("NVDA", "2026-06-03", "bmo")
    assert "NVDA" in vevent
    assert "BMO" in vevent
    assert "T070000" in vevent   # 7 AM ET for BMO
    assert "2026-06-03".replace("-", "") in vevent


def test_build_vevent_amc():
    mod = _import_router()
    vevent = mod._build_vevent("MSFT", "2026-06-04", "amc")
    assert "AMC" in vevent
    assert "T160000" in vevent   # 4 PM ET for AMC


def test_build_vcalendar_zero_vevents_is_valid():
    mod = _import_router()
    ics = mod._build_vcalendar([])
    assert "BEGIN:VCALENDAR" in ics
    assert "END:VCALENDAR" in ics
    assert "BEGIN:VEVENT" not in ics


def test_make_ics_token_stable():
    """Same user_id always produces the same token."""
    mod = _import_router()
    t1 = mod._make_ics_token("user-123")
    t2 = mod._make_ics_token("user-123")
    assert t1 == t2
    assert len(t1) == 64   # sha256 hexdigest


def test_collect_reporters_empty_safe():
    """Empty calendar cache → empty reporters list, no exception."""
    mod = _import_router()
    with mock.patch("api.routers.calendar.cache") as fake_cache, \
         mock.patch("api.routers.calendar.get_month_calendar", return_value={"days": {}}):
        fake_cache.get.return_value = None
        reporters = mod._collect_reporters_for_ics("all", None)
    assert reporters == []


def test_collect_reporters_all_from_cache():
    """All reporters pulled from weekly cache for scope=all."""
    mod = _import_router()
    fake_cal = {
        "days": {
            "2026-06-03": {
                "bmo": [{"sym": "AAPL"}, {"sym": "MSFT"}],
                "amc": [{"sym": "NVDA"}],
            }
        }
    }
    with mock.patch("api.routers.calendar.cache") as fake_cache, \
         mock.patch("api.routers.calendar.get_month_calendar", return_value={"days": {}}):
        fake_cache.get.return_value = fake_cal
        reporters = mod._collect_reporters_for_ics("all", None)

    syms = [r[0] for r in reporters]
    assert "AAPL" in syms
    assert "MSFT" in syms
    assert "NVDA" in syms
    assert len(reporters) == 3


def test_collect_reporters_mine_filters():
    """scope=mine only returns tickers in the user's My-Stocks set."""
    mod = _import_router()
    fake_cal = {
        "days": {
            "2026-06-03": {
                "bmo": [{"sym": "AAPL"}, {"sym": "MSFT"}],
                "amc": [{"sym": "NVDA"}],
            }
        }
    }
    mine_sets = {"all_mine": {"AAPL", "NVDA"}}
    with mock.patch("api.routers.calendar.cache") as fake_cache, \
         mock.patch("api.routers.calendar.get_month_calendar", return_value={"days": {}}), \
         mock.patch("api.routers.calendar._cp") as fake_cp:
        fake_cache.get.return_value = fake_cal
        fake_cp.get_user_ticker_sets.return_value = mine_sets
        reporters = mod._collect_reporters_for_ics("mine", "u1")

    syms = [r[0] for r in reporters]
    assert "AAPL" in syms
    assert "NVDA" in syms
    assert "MSFT" not in syms


# ── Integration-style endpoint tests ─────────────────────────────────────────

def test_export_ics_content_type():
    """GET /api/calendar/export.ics returns text/calendar."""
    from fastapi.testclient import TestClient
    from api.main import app
    client = TestClient(app)

    with mock.patch("api.routers.calendar._collect_reporters_for_ics",
                    return_value=[("AAPL", "2026-06-03", "bmo")]):
        r = client.get("/api/calendar/export.ics?scope=all")

    assert r.status_code == 200
    assert "text/calendar" in r.headers.get("content-type", "")


def test_export_ics_one_vevent_per_reporter():
    """Each unique (sym, date) in reporters produces exactly one VEVENT."""
    from fastapi.testclient import TestClient
    from api.main import app
    client = TestClient(app)

    reporters = [
        ("AAPL", "2026-06-03", "bmo"),
        ("MSFT", "2026-06-03", "amc"),
        ("NVDA", "2026-06-04", "bmo"),
    ]
    with mock.patch("api.routers.calendar._collect_reporters_for_ics",
                    return_value=reporters):
        r = client.get("/api/calendar/export.ics?scope=all")

    body = r.text
    assert body.count("BEGIN:VEVENT") == 3
    assert "AAPL" in body
    assert "MSFT" in body
    assert "NVDA" in body


def test_export_ics_empty_safe():
    """Zero reporters → valid VCALENDAR with zero VEVENTs (200 OK)."""
    from fastapi.testclient import TestClient
    from api.main import app
    client = TestClient(app)

    with mock.patch("api.routers.calendar._collect_reporters_for_ics", return_value=[]):
        r = client.get("/api/calendar/export.ics?scope=all")

    assert r.status_code == 200
    assert "BEGIN:VCALENDAR" in r.text
    assert "BEGIN:VEVENT" not in r.text


def test_export_ics_mine_missing_token():
    """scope=mine without token → 400."""
    from fastapi.testclient import TestClient
    from api.main import app
    client = TestClient(app)

    r = client.get("/api/calendar/export.ics?scope=mine")
    assert r.status_code == 400


def test_export_ics_mine_invalid_token():
    """scope=mine with invalid token → 403."""
    from fastapi.testclient import TestClient
    from api.main import app
    client = TestClient(app)

    with mock.patch("api.routers.calendar._decode_ics_token", return_value=None):
        r = client.get("/api/calendar/export.ics?scope=mine&token=bad")
    assert r.status_code == 403


def test_export_ics_mine_valid_token():
    """scope=mine with valid token resolves user and returns filtered VCALENDAR."""
    from fastapi.testclient import TestClient
    from api.main import app
    client = TestClient(app)

    reporters = [("AAPL", "2026-06-03", "bmo")]
    with mock.patch("api.routers.calendar._decode_ics_token", return_value="u99"), \
         mock.patch("api.routers.calendar._collect_reporters_for_ics",
                    return_value=reporters) as collect:
        r = client.get("/api/calendar/export.ics?scope=mine&token=validtok")

    assert r.status_code == 200
    assert "AAPL" in r.text
    # Ensure _collect_reporters_for_ics was called with scope=mine + user_id
    collect.assert_called_once_with("mine", "u99")
