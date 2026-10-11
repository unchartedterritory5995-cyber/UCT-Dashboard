"""Our breadth vs WSJ / StockCharts (`api/services/breadth_external.py`). No network: the
payloads below are the real shapes measured 2026-10-11."""
from __future__ import annotations

from datetime import date, timedelta

import pytest

from api.services import breadth_external as bx

WSJ_DOC = {"data": {"instrumentSets": [
    {"headerFields": [{"value": "name", "label": "Issues"}], "instruments": [
        {"name": "Advancing", "NASDAQ": "2,883", "NYSE": "1,543"},
        {"name": "Declining", "NASDAQ": "2,040", "NYSE": "1,186"},
        {"name": "Unchanged", "NASDAQ": "175", "NYSE": "79"},
        {"name": "Total", "NASDAQ": "5,098", "NYSE": "2,808"}]},
    {"headerFields": [{"value": "name", "label": "Issues At"}], "instruments": [
        {"name": "New Highs", "NASDAQ": "72", "NYSE": "41"},
        {"name": "New Lows", "NASDAQ": "272", "NYSE": "123"}]},
    {"headerFields": [{"value": "name", "label": "Share Volume"}], "instruments": [
        {"name": "Total", "NASDAQ": "7,090,067,392", "NYSE": "4,865,646,199"}]}],
    "timestamp": "4:15 PM EDT 10/09/26"}}


def test_parse_wsj_dates_by_the_diary_and_keeps_issue_counts():
    rows = {k: v for _d, _s, k, v in bx.parse_wsj(WSJ_DOC)}
    assert {d for d, *_ in bx.parse_wsj(WSJ_DOC)} == {"2026-10-09"}
    assert rows["nyse.adv"] == 1543 and rows["nasdaq.nl"] == 272 and "nyse.total" not in rows
    assert bx.parse_wsj({"data": {"timestamp": "garbage"}}) == []


def test_parse_stockcharts():
    assert bx.parse_stockcharts("$NYA50R", {"close": "25.73", "latestTrade": "9 Oct 2026"}) == [
        ("2026-10-09", "stockcharts", "$NYA50R", 25.73)]
    assert bx.parse_stockcharts("$NYA50R", {"close": "x", "latestTrade": "9 Oct 2026"}) == []


def test_capture_stores_and_names_failures(tmp_path, monkeypatch):
    monkeypatch.setenv("BREADTH_EXTERNAL_DB", str(tmp_path / "x.db"))
    monkeypatch.setattr(bx.time, "sleep", lambda s: None)

    class R:
        def __init__(self, code, body):
            self.status_code, self._b = code, body

        def json(self):
            return self._b

    def get(url, params=None, **k):
        if "wsj" in url:
            return R(200, WSJ_DOC)
        if params["symbol"] == "$NASI":
            return R(403, {})
        return R(200, {"close": "40", "latestTrade": "9 Oct 2026"})
    out = bx.capture(get=get)
    assert out["stored"] == 10 + 9 and set(out["errors"]) == {"$NASI"}
    obs = bx.observations(days=10000)
    assert obs["wsj"]["nyse.nh"]["2026-10-09"] == 41 and obs["stockcharts"]["$NYA20R"]["2026-10-09"] == 40


def _days(n, end=date(2026, 10, 9)):
    from api.services import session_calendar as sc
    out, d = [], end
    while len(out) < n:
        if sc.is_trading_day(d):
            out.append(d.isoformat())
        d -= timedelta(days=1)
    return sorted(out)


def test_a_steady_offset_is_fine_and_a_moving_one_is_found(monkeypatch):
    days = _days(20)
    theirs = {d: 40.0 for d in days}
    steady = {d: 43.0 for d in days}                       # a structural +3: methodology
    moved = {d: 43.0 if i < 15 else 49.0 for i, d in enumerate(days)}
    obs = {"stockcharts": {"$NYA50R": theirs}, "wsj": {"nyse.nh": {days[-1]: 1}}}
    monkeypatch.setattr(bx, "ours_counts", lambda u, d, ad=None: {})
    monkeypatch.setattr(bx, "ours_pct", lambda u, m: steady if m == "pct_above_50sma" else {})
    res = bx.compare(obs, today=date(2026, 10, 10))
    assert not [f for f in res["findings"] if "$NYA50R" in f]
    monkeypatch.setattr(bx, "ours_pct", lambda u, m: moved if m == "pct_above_50sma" else {})
    res = bx.compare(obs, today=date(2026, 10, 10))
    assert any("$NYA50R" in f and "moved to" in f for f in res["findings"])


def test_new_low_ratio_drift_and_a_silent_source(monkeypatch):
    days = _days(20)
    wsj = {"nasdaq.nh": {d: 50 for d in days}, "nasdaq.nl": {d: 200 for d in days}}
    ours = {d: {"nh": 40, "nl": 160 if i < 15 else 60} for i, d in enumerate(days)}
    monkeypatch.setattr(bx, "ours_pct", lambda u, m: {})
    monkeypatch.setattr(bx, "ours_counts", lambda u, d, ad=None: ours[d] if u == "nasdaq" else {})
    res = bx.compare({"wsj": wsj}, today=date(2026, 10, 10))
    assert any(f.startswith("NASDAQ new lows") for f in res["findings"])
    assert not any(f.startswith("NASDAQ new highs") for f in res["findings"])
    assert any("no stockcharts observation" in f for f in res["findings"])
    assert not any("no wsj observation" in f for f in res["findings"])


def test_the_weekly_report_always_posts_one_message(monkeypatch, tmp_path):
    from api.services import breadth_alerts
    monkeypatch.setenv("BREADTH_ALERTS_STATE", str(tmp_path / "s.json"))
    monkeypatch.setenv("DISCORD_BREADTH_WEBHOOK_URL", "https://discord.test/b")
    monkeypatch.setattr(bx, "compare", lambda: {"findings": [], "latest": ["$NYA50R: ours 27.7 vs 25.7"]})
    posts = []

    class R:
        status_code = 204
    out = bx.weekly_report(post=lambda url, **k: posts.append(k["json"]["content"]) or R())
    assert out["sent"]["sent"] and "within tolerance" in posts[0]
