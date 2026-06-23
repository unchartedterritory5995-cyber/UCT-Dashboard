from api.services.journal_two.broker import performance_service as perf


def test_single_snapshot_gets_live_anchor():
    # One real snapshot + a known current total → 2-point renderable series.
    series = [{"date": "2026-06-22", "value": 10000.0, "estimated": False}]
    out = perf._ensure_renderable_series(series, current_total=10250.0, today="2026-06-22")
    assert len(out) >= 2
    assert out[-1]["estimated"] is True
    assert out[-1]["value"] == 10250.0


def test_empty_series_no_total_unchanged():
    out = perf._ensure_renderable_series([], current_total=None, today="2026-06-22")
    assert out == []


def test_two_real_points_not_modified():
    series = [{"date": "2026-06-20", "value": 100.0, "estimated": False},
              {"date": "2026-06-21", "value": 110.0, "estimated": False}]
    out = perf._ensure_renderable_series(series, current_total=120.0, today="2026-06-22")
    assert len(out) == 2  # already renderable; no anchor added
