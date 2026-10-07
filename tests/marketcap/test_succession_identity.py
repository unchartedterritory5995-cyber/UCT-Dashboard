"""M3.1 (owner decision 2026-10-06): a current ticker->CIK reassignment never erases proven predecessor history;
distinct CIKs are never stitched; the boundary comes from SEC filings only; an uncertain boundary fails closed LOCALLY.
Cases mirror CBAT (8-K12B), UROY (8-K12B after the successor's Form 3s), CLBK (termination), DTSS (no evidence)."""
from __future__ import annotations

import sqlite3
from datetime import date

from api.services.marketcap import build as Bd


class FakeAuthority:
    def resolve(self, accn, raw, filing_date):
        from datetime import datetime, timezone
        return datetime.fromisoformat(filing_date + "T21:30:00+00:00").astimezone(timezone.utc), "TEST"   # 17:30 ET: next close

    def lookup(self, accn):
        return None


class D:
    def __init__(self, filings):
        self.inp = sqlite3.connect(":memory:")
        self.inp.execute("CREATE TABLE filing(cik INTEGER, accn TEXT, form TEXT, filing_date TEXT, accepted TEXT)")
        self.inp.executemany("INSERT INTO filing VALUES(?,?,?,?,?)", [(c, a, f, d, None) for c, a, f, d in filings])
        self._authority = FakeAuthority()


def _fix(monkeypatch):
    monkeypatch.setattr(Bd, "_authority", lambda D_: D_._authority)


PRED, SUCC = 100, 200
LAST = date(2026, 10, 2)


def test_succession_notice_is_a_certain_boundary(monkeypatch):
    _fix(monkeypatch)
    d = D([(SUCC, "s1", "F-4", "2025-09-24"), (SUCC, "s2", "8-K12B", "2026-06-23"), (PRED, "p1", "15-12G", "2026-06-29")])
    sb = Bd.succession_boundary(d, PRED, SUCC, LAST)
    assert sb["kind"] == "CERTAIN" and sb["cut"] == sb["succ_from"] == date(2026, 6, 24)   # filed after the close


def test_termination_before_successor_activity_is_certain(monkeypatch):
    _fix(monkeypatch)
    d = D([(SUCC, "s1", "S-1", "2026-03-06"), (PRED, "p1", "15-12G", "2026-07-21"), (SUCC, "s2", "4", "2026-08-11")])
    sb = Bd.succession_boundary(d, PRED, SUCC, LAST)
    assert sb["kind"] == "CERTAIN" and sb["cut"] == date(2026, 7, 22)


def test_successor_active_before_termination_is_an_uncertain_window(monkeypatch):
    _fix(monkeypatch)
    d = D([(SUCC, "s1", "3", "2026-07-28"), (PRED, "p1", "15-12G", "2026-07-31")])
    sb = Bd.succession_boundary(d, PRED, SUCC, LAST)
    assert sb["kind"] == "UNCERTAIN" and sb["cut"] == date(2026, 7, 29) and sb["succ_from"] == date(2026, 8, 1)


def test_no_succession_evidence_fails_closed_from_the_successors_first_activity(monkeypatch):
    _fix(monkeypatch)
    d = D([(SUCC, "s1", "F-4", "2026-02-13"), (SUCC, "s2", "EFFECT", "2026-04-10"), (SUCC, "s3", "6-K", "2026-04-15")])
    sb = Bd.succession_boundary(d, PRED, SUCC, LAST)
    assert sb["kind"] == "UNCERTAIN" and sb["cut"] == date(2026, 4, 16) and sb["succ_from"] == date(2026, 10, 3)


def test_true_ticker_reuse_long_after_the_predecessor_leaves_nothing_withheld(monkeypatch):
    _fix(monkeypatch)
    d = D([(SUCC, "s1", "10-Q", "2026-11-14")])                    # the new issuer appears AFTER the last attribution
    sb = Bd.succession_boundary(d, PRED, SUCC, LAST)
    assert sb["kind"] == "SUCCESSOR_AFTER_LAST_ATTRIBUTION" and sb["cut"] == date(2026, 10, 3)   # keeps everything


def test_no_successor_activity_at_all(monkeypatch):
    _fix(monkeypatch)
    sb = Bd.succession_boundary(D([]), PRED, SUCC, LAST)
    assert sb["kind"] == "NO_SUCCESSOR_ACTIVITY" and sb["cut"] == date(2026, 10, 3)
