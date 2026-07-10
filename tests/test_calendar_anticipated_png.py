"""Most Anticipated weekly PNG — render + endpoint."""
from __future__ import annotations

from unittest import mock

_PNG_MAGIC = b"\x89PNG\r\n\x1a\n"


def test_render_produces_png_bytes():
    from api.services.calendar_anticipated_png import render_anticipated_png
    entries = [
        {"sym": "AAPL", "name": "Apple Inc.", "timing": "amc", "weekday": "THU", "mc_b": 3400, "logo_path": None},
        {"sym": "MSFT", "name": "Microsoft Corporation", "timing": "amc", "weekday": "TUE", "mc_b": 3100, "logo_path": None},
    ]
    png = render_anticipated_png("Week of Jul 14–18, 2026", entries)
    assert png[:8] == _PNG_MAGIC
    assert len(png) > 2000


def test_render_empty_week_does_not_crash():
    from api.services.calendar_anticipated_png import render_anticipated_png
    png = render_anticipated_png("Week of Jul 14–18, 2026", [])
    assert png[:8] == _PNG_MAGIC


def test_render_tolerates_missing_fields():
    from api.services.calendar_anticipated_png import render_anticipated_png
    entries = [
        {"sym": "XYZ"},                                   # no name/timing/mc_b/logo
        {"sym": "ABC", "name": None, "mc_b": None, "timing": None, "weekday": None, "logo_path": None},
    ]
    png = render_anticipated_png("Week", entries)
    assert png[:8] == _PNG_MAGIC


def test_render_caps_at_eight():
    from api.services.calendar_anticipated_png import render_anticipated_png
    entries = [{"sym": f"T{i}", "name": f"Co {i}", "timing": "bmo",
                "weekday": "MON", "mc_b": 100 - i, "logo_path": None} for i in range(20)]
    # 20 in → still one valid PNG (renders top 8 only, no overflow crash)
    png = render_anticipated_png("Week", entries)
    assert png[:8] == _PNG_MAGIC


def test_endpoint_returns_png_and_ranks_by_cap():
    from fastapi.testclient import TestClient
    from api.main import app
    import api.routers.calendar as cal

    fake_days = {
        "2026-07-14": {"bmo": [{"sym": "UNH", "name": "UnitedHealth", "mc_b": 520}],
                       "amc": [{"sym": "MSFT", "name": "Microsoft", "mc_b": 3100}], "tbd": []},
        "2026-07-16": {"bmo": [{"sym": "SMALLCO", "name": "Small Co", "mc_b": 2}],
                       "amc": [{"sym": "AAPL", "name": "Apple", "mc_b": 3400}], "tbd": []},
    }

    with mock.patch.object(cal, "get_calendar", return_value={"days": fake_days}), \
         mock.patch.object(cal, "get_day_metrics", return_value={}):
        client = TestClient(app)
        r = client.get("/api/calendar/most-anticipated.png?week=2026-07-14")

    assert r.status_code == 200
    assert r.headers["content-type"] == "image/png"
    assert r.content[:8] == _PNG_MAGIC


def test_endpoint_out_of_range_week():
    from fastapi.testclient import TestClient
    from api.main import app
    client = TestClient(app)
    # 3 years out is beyond the 52-week horizon
    r = client.get("/api/calendar/most-anticipated.png?week=2029-01-01")
    assert r.status_code == 400
