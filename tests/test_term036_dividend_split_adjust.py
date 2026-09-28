"""TERM-036 follow-up -- chart "D" markers are SPLIT-ADJUSTED.

Massive's `/v3/reference/dividends` returns cash amounts AS DECLARED; yfinance
(the pre-TERM-036 source) returned them split-adjusted (NVDA 2023-12-05:
yfinance 0.004, Massive 0.04 -- NVDA went 10:1 on 2024-06-10). The chart draws
split-ADJUSTED prices, so the marker must be on the same basis: each dividend's
amount is divided by the cumulative ratio of every split executed STRICTLY
AFTER its ex-date.

Boundary: a split whose execution date EQUALS the ex-date does NOT adjust that
dividend. On the execution date the bar already trades on the post-split
basis, and the adjusted price series applies a split's factor only to bars
BEFORE it -- so a dividend going ex that same day is already on the chart's
basis. (It is also yfinance's rule: adjustment by splits dated after the
dividend.)

Failure path: if the split read fails, the dividend section is WITHHELD (empty
+ logged) rather than labelling as-declared amounts as if they were adjusted.

The dividends CALENDAR (forward, gte=today) stays AS-DECLARED and is not
touched here -- its amounts are pinned by tests/test_term036_corp_actions_massive.py
and tests/test_dividends_calendar.py.

Vendor mocked at `massive._get_client()`; no network.
"""
from __future__ import annotations

from datetime import date, timedelta

import pytest

from api.services import massive

_TODAY = date.today()


def _past(days: int) -> str:
    return (_TODAY - timedelta(days=days)).isoformat()


class _Fake:
    """`/v3/reference/{splits,dividends}` from per-ticker fixtures; each
    endpoint can be failed on its own."""

    _api_key = "k"

    def __init__(self, splits=None, dividends=None, fail_splits=False, fail_dividends=False):
        self.splits = splits or {}
        self.dividends = dividends or {}
        self.fail_splits = fail_splits
        self.fail_dividends = fail_dividends
        self.urls: list[str] = []

    def _typed_get(self, url, *, timeout=None):
        self.urls.append(url)
        from urllib.parse import urlparse, parse_qs
        tk = (parse_qs(urlparse(url).query).get("ticker") or [""])[0]
        if "/v3/reference/splits" in url:
            if self.fail_splits:
                raise massive.MassiveTransient("HTTP 503 from Massive", vendor="massive", status=503)
            return {"status": "OK", "results": list(self.splits.get(tk, []))}
        if "/v3/reference/dividends" in url:
            if self.fail_dividends:
                raise massive.MassiveTransient("HTTP 503 from Massive", vendor="massive", status=503)
            return {"status": "OK", "results": list(self.dividends.get(tk, []))}
        raise AssertionError(f"unexpected Massive URL {url}")


def _split(tk, d, f, t):
    return {"ticker": tk, "execution_date": d, "split_from": f, "split_to": t}


def _div(tk, d, amt):
    return {"ticker": tk, "ex_dividend_date": d, "cash_amount": amt}


def _build(monkeypatch, fake, ticker):
    from api.services import earnings_estimates as ee
    monkeypatch.setattr(massive, "_get_client", lambda: fake)
    monkeypatch.setattr(ee, "_fmp_rows", lambda *a, **k: None)
    monkeypatch.setattr(ee, "_fh_get", lambda *a, **k: None)
    return ee._build_chart_markers(ticker)


def _amounts(out):
    return {d["date"]: d["amount"] for d in out["dividends"]}


# NVDA-like history, placed inside the 5-year dividend lookback:
#   4:1 split at D-1500, 10:1 split at D-800.
_S4 = _past(1500)
_S10 = _past(800)


def test_nvda_like_history_is_split_adjusted(monkeypatch):
    fake = _Fake(
        splits={"NVDA": [_split("NVDA", _S10, 1, 10), _split("NVDA", _S4, 1, 4)]},
        dividends={"NVDA": [
            _div("NVDA", _past(1700), 0.16),   # before BOTH splits -> /40
            _div("NVDA", _past(1000), 0.04),   # between (after 4:1, before 10:1) -> /10
            _div("NVDA", _past(30), 0.01),     # after both -> unchanged
        ]},
    )
    out = _build(monkeypatch, fake, "NVDA")
    got = _amounts(out)
    assert got[_past(1700)] == pytest.approx(0.004)
    assert got[_past(1000)] == pytest.approx(0.004)
    assert got[_past(30)] == pytest.approx(0.01)
    assert all(d["source"] == "massive" for d in out["dividends"])
    # the split markers themselves are unchanged
    assert {s["date"]: s["ratio"] for s in out["splits"]} == {_S10: "10:1", _S4: "4:1"}


def test_reverse_split_multiplies_earlier_dividends(monkeypatch):
    rs = _past(500)
    fake = _Fake(
        splits={"GE": [_split("GE", rs, 10, 1)]},         # 1-for-10 reverse
        dividends={"GE": [
            _div("GE", _past(900), 0.01),                # before -> x10
            _div("GE", _past(100), 0.08),                # after  -> unchanged
        ]},
    )
    got = _amounts(_build(monkeypatch, fake, "GE"))
    assert got[_past(900)] == pytest.approx(0.10)
    assert got[_past(100)] == pytest.approx(0.08)


def test_split_on_the_ex_date_does_not_adjust_that_dividend(monkeypatch):
    """Boundary: STRICTLY after. Same-day split leaves the dividend as-is; the
    dividend one day earlier IS adjusted."""
    same = _past(400)
    day_before = _past(401)
    fake = _Fake(
        splits={"XYZ": [_split("XYZ", same, 1, 2)]},
        dividends={"XYZ": [_div("XYZ", same, 0.50), _div("XYZ", day_before, 0.50)]},
    )
    got = _amounts(_build(monkeypatch, fake, "XYZ"))
    assert got[same] == pytest.approx(0.50)
    assert got[day_before] == pytest.approx(0.25)


def test_no_splits_leaves_amounts_as_declared(monkeypatch):
    fake = _Fake(splits={"KO": []},
                 dividends={"KO": [_div("KO", _past(60), 0.51)]})
    assert _amounts(_build(monkeypatch, fake, "KO")) == {_past(60): 0.51}


def test_split_read_failure_withholds_dividends_rather_than_mislabel(monkeypatch, caplog):
    """Splits fail, dividends answer: the dividends are NOT emitted as-declared
    (they would sit on a different basis than the adjusted price scale). The
    section is empty and the reason is logged."""
    fake = _Fake(
        splits={"NVDA": [_split("NVDA", _S10, 1, 10)]},
        dividends={"NVDA": [_div("NVDA", _past(1000), 0.04), _div("NVDA", _past(30), 0.01)]},
        fail_splits=True,
    )
    with caplog.at_level("WARNING"):
        out = _build(monkeypatch, fake, "NVDA")
    assert out["splits"] == []
    assert out["dividends"] == []
    msgs = " ".join(r.getMessage().lower() for r in caplog.records)
    assert "dividend" in msgs and "split" in msgs, msgs


def test_unparseable_split_withholds_the_dividends_it_would_adjust(monkeypatch, caplog):
    """A split row we cannot read a ratio from cannot be applied, so the
    dividends BEFORE it would be mislabelled -- those are withheld; later ones
    (unaffected by it) are kept."""
    bad = _past(600)
    fake = _Fake(
        splits={"ABC": [{"ticker": "ABC", "execution_date": bad, "split_from": None, "split_to": 3}]},
        dividends={"ABC": [_div("ABC", _past(900), 0.30), _div("ABC", _past(100), 0.10)]},
    )
    with caplog.at_level("WARNING"):
        got = _amounts(_build(monkeypatch, fake, "ABC"))
    assert got == {_past(100): 0.10}


def test_dividend_read_failure_still_leaves_split_markers(monkeypatch):
    fake = _Fake(splits={"NVDA": [_split("NVDA", _S10, 1, 10)]},
                 dividends={}, fail_dividends=True)
    out = _build(monkeypatch, fake, "NVDA")
    assert out["dividends"] == []
    assert [s["date"] for s in out["splits"]] == [_S10]


def test_marker_disk_cache_version_was_bumped_past_v4():
    """v4 blobs carry AS-DECLARED Massive amounts; they must not be served."""
    from api.services import earnings_estimates as ee
    assert ee._MARKERS_DISK_VERSION >= 5

