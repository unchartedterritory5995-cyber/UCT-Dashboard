"""Confirm a staleness flag against the FILINGS before calling it a defect.

⚰️ WHY THIS EXISTS. `reported_staleness` compares our newest reported quarter
against a GENERIC reporting expectation (75 days after period end). That answers
"is what we hold old?" — useful for the member-facing notice — but it cannot
answer "are we MISSING something?", and the monitor was treating the two as the
same thing.

Checked against SEC EDGAR 2026-09-12, every remaining flagged name had filed
nothing newer than what we already served (HOLX's newest 10-Q: period end
2025-12-27, filed 2026-01-29). Control: MMC, BK and AAPL each return a 2026 Q2
10-Q, so the method finds current filings. Those six were not defects — the
companies had not reported — and the monitor would have digested them daily
forever, which is a slower version of the spam this whole change removed.

⭐ The split that fixes it: **display** asks "is what we hold old?" (always worth
telling a member), **the monitor** asks "has the company filed something we do
not have?" (the only version that is actionable).
"""
import importlib

import pytest


@pytest.fixture()
def sec(monkeypatch):
    import api.services.edgar as m
    importlib.reload(m)
    return m


class _Resp:
    def __init__(self, payload=None, text="", status=200):
        self._p, self.text, self.status_code = payload, text, status

    def json(self):
        return self._p

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError(f"HTTP {self.status_code}")


def _wire(monkeypatch, sec, *, cik="0000859737", filings=None, fail=False):
    """Stub the two SEC calls: ticker->CIK via browse-edgar, then submissions."""
    calls = []

    def _get(url, **kw):
        calls.append(url)
        if fail:
            raise RuntimeError("network down")
        if "browse-edgar" in url:
            return _Resp(text=f'<xml>...CIK={cik}...</xml>')
        if "submissions" in url:
            return _Resp(payload={"filings": {"recent": filings or {}}})
        raise AssertionError(f"unexpected url {url}")

    monkeypatch.setattr(sec._requests, "get", _get)
    return calls


def _recent(rows):
    """rows = [(form, filingDate, reportDate)] -> SEC's column-wise shape."""
    return {
        "form": [r[0] for r in rows],
        "filingDate": [r[1] for r in rows],
        "reportDate": [r[2] for r in rows],
    }


# ── the newest quarter the FILINGS show ──────────────────────────────────────
def test_it_reads_the_newest_10q_period_end_as_a_fiscal_label(monkeypatch, sec):
    _wire(monkeypatch, sec, filings=_recent([
        ("10-Q", "2026-01-29", "2025-12-27"),
        ("8-K", "2026-02-02", "2026-02-02"),
        ("10-Q", "2025-07-31", "2025-06-28"),
    ]))
    # HOLX's real shape. 2025-12-27 -> 2025 Q4 under the shared period-end mapper.
    assert sec.newest_reported_quarter("HOLX") == "2025 Q4"


def test_a_10k_counts_as_a_reported_period(monkeypatch, sec):
    # EXAS/ACLX/FOLD/DHIL all stop at a 10-K, not a 10-Q. Ignoring annual reports
    # would make every December-year-end filer look a quarter staler than it is.
    _wire(monkeypatch, sec, filings=_recent([("10-K", "2026-02-13", "2025-12-31")]))
    assert sec.newest_reported_quarter("EXAS") == "2025 Q4"


def test_non_periodic_forms_are_ignored(monkeypatch, sec):
    # An 8-K's reportDate is the EVENT date, not a fiscal period end. Counting it
    # would invent a quarter out of a press release.
    _wire(monkeypatch, sec, filings=_recent([
        ("8-K", "2026-09-01", "2026-09-01"),
        ("10-Q", "2026-07-21", "2026-06-30"),
    ]))
    assert sec.newest_reported_quarter("MMC") == "2026 Q2"


def test_an_unreachable_sec_returns_none_rather_than_a_guess(monkeypatch, sec):
    _wire(monkeypatch, sec, fail=True)
    assert sec.newest_reported_quarter("HOLX") is None


def test_no_periodic_filings_returns_none(monkeypatch, sec):
    _wire(monkeypatch, sec, filings=_recent([("8-K", "2026-09-01", "2026-09-01")]))
    assert sec.newest_reported_quarter("ZZZZ") is None


def test_it_does_not_rely_on_the_partial_company_tickers_file(monkeypatch, sec):
    """⛔ `sec.gov/files/company_tickers.json` is PARTIAL — 10,426 entries,
    missing MMC and BK, both certain filers. A resolver built on it reports
    "not a US filer" for real companies, which is what the first probe did."""
    calls = _wire(monkeypatch, sec, filings=_recent([("10-Q", "2026-07-21", "2026-06-30")]))
    sec.newest_reported_quarter("MMC")
    assert not any("company_tickers.json" in u for u in calls), \
        "resolved the CIK through the partial ticker file"
    assert any("browse-edgar" in u for u in calls)


def test_the_result_is_cached_per_ticker(monkeypatch, sec):
    # Politeness: SEC asks for <10 req/s, and a filing does not change hourly.
    calls = _wire(monkeypatch, sec, filings=_recent([("10-Q", "2026-07-21", "2026-06-30")]))
    sec.newest_reported_quarter("MMC")
    n = len(calls)
    sec.newest_reported_quarter("MMC")
    assert len(calls) == n, "second lookup re-hit SEC"


# ── the monitor must only flag a CONFIRMED gap ───────────────────────────────
def _monitor(tmp_path, monkeypatch):
    import os
    monkeypatch.setenv("FUNDAMENTALS_MONITOR_DB", os.path.join(str(tmp_path), "fm.db"))
    import api.services.fundamentals_monitor as fm
    importlib.reload(fm)
    monkeypatch.setattr(fm, "_is_fund", lambda s: False)
    return fm


def _stale_payload():
    return {"ticker": "X", "annual": [], "quarterly": [
        {"label": "2025 Q3", "reported": True}, {"label": "2025 Q4", "reported": True},
        {"label": "2026 Q2", "reported": False, "period_end": "2026-06-30"},
    ]}


def _now():
    import datetime
    return datetime.datetime(2026, 9, 12, tzinfo=datetime.timezone.utc).timestamp()


def test_no_stale_flag_when_the_company_has_filed_nothing_newer(tmp_path, monkeypatch):
    """The HOLX case — not a defect, and must not be reported as one."""
    fm = _monitor(tmp_path, monkeypatch)
    monkeypatch.setattr(fm, "get_earnings_table", lambda s, now=None: _stale_payload())
    monkeypatch.setattr(fm, "sec_newest_reported_quarter", lambda s: "2025 Q4")
    kinds = [i["kind"] for i in fm.check_ticker("HOLX", now=_now())["issues"]]
    assert "stale_reported" not in kinds, f"flagged a company that has not reported: {kinds}"


def test_stale_flag_when_the_company_HAS_filed_a_quarter_we_lack(tmp_path, monkeypatch):
    """The MMC case as it was — a real, actionable gap."""
    fm = _monitor(tmp_path, monkeypatch)
    monkeypatch.setattr(fm, "get_earnings_table", lambda s, now=None: _stale_payload())
    monkeypatch.setattr(fm, "sec_newest_reported_quarter", lambda s: "2026 Q2")
    issues = fm.check_ticker("MMC", now=_now())["issues"]
    stale = [i for i in issues if i["kind"] == "stale_reported"]
    assert stale, "a genuinely missing filed quarter was not flagged"
    assert "2026 Q2" in stale[0]["detail"] and "2025 Q4" in stale[0]["detail"]


def test_an_unconfirmable_ticker_is_not_flagged(tmp_path, monkeypatch):
    """SEC silent or unreachable -> we cannot distinguish the two cases, so we do
    not manufacture a finding. The failure direction is quiet, consistent with
    shape issues never paging anyway."""
    fm = _monitor(tmp_path, monkeypatch)
    monkeypatch.setattr(fm, "get_earnings_table", lambda s, now=None: _stale_payload())
    monkeypatch.setattr(fm, "sec_newest_reported_quarter", lambda s: None)
    kinds = [i["kind"] for i in fm.check_ticker("FOREIGN", now=_now())["issues"]]
    assert "stale_reported" not in kinds


def test_sec_is_only_consulted_when_the_strip_already_looks_stale(tmp_path, monkeypatch):
    """Cost control: a healthy ticker must not spend an SEC round-trip."""
    fm = _monitor(tmp_path, monkeypatch)
    monkeypatch.setattr(fm, "get_earnings_table", lambda s, now=None: {
        "ticker": "AAPL", "annual": [], "quarterly": [
            {"label": "2026 Q2", "reported": True},
            {"label": "2026 Q3", "reported": False, "period_end": "2026-09-30"}]})
    asked = []
    monkeypatch.setattr(fm, "sec_newest_reported_quarter",
                        lambda s: (asked.append(s), "2026 Q2")[1])
    fm.check_ticker("AAPL", now=_now())
    assert asked == [], "spent an SEC lookup on a current strip"
