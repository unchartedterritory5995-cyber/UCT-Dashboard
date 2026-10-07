"""M3.1 deterministic evidence (owner decision 2026-10-06): the same evidence SET gives the same evidence identity and
the same cited statement whatever the harvest path; an ordinary refresh never silently replaces an ACCEPTED historical
split interpretation. Pinned on JCI (Tyco, CIK 833444) 1999: the accumulated store cites the 2003 10-K (applied
1999-09-30); a fresh harvest also finds the 1999 10-K (applied 1999-08-23)."""
from __future__ import annotations

import sqlite3
from datetime import date

from api.services.marketcap import build as Bd
from api.services.marketcap.refresh import split_reinterpretations
from api.services.marketcap.splitev import DDL, confirm

JCI = 833444
WIN = (date(1999, 7, 22), date(1999, 12, 3))          # the held transition's prev / next share-state as-of dates
ACCEPTED = (JCI, '["1999-09-30", "1999-10-21"]', 2.0, "TEXT", "0001047469-03-041163", "10-K", "two-for-one ... 1999")
FRESH = [(JCI, '["1996-11-06", "1999-10-22", "1999-11-09", "1999-08-23"]', 2.0, "TEXT", "0000912057-99-009052", "10-K", "a"),
         (JCI, '["1997-10-22", "1999-10-21", "1999-04-02", "1998-10-01", "1997-08-29", "1997-08-27"]', 2.0, "TEXT",
          "0000912057-99-009052", "10-K", "b"),
         (JCI, '["1999-03-02", "1999-07-21", "1999-07-20", "1999-08-27", "1999-08-12", "1999-08-18"]', 2.0, "TEXT",
          "0000912057-99-009052", "10-K", "c"),
         (JCI, '["1999-09-30", "1999-10-21", "1999-10-01"]', 2.0, "TEXT", "0000912057-99-009052", "10-K", "d")]


def _store(path, rows):
    c = sqlite3.connect(path)
    c.executescript(DDL)
    c.executemany("INSERT INTO split_evidence VALUES(?,?,?,?,?,?,?)", rows)
    c.commit()
    return c


def _cite(c):
    return confirm(Bd.split_evidence_rows(c, [JCI]), 2.0, "FORWARD", *WIN)


def test_jci_accepted_evidence_set_cites_the_2003_10k(tmp_path):
    hit = _cite(_store(str(tmp_path / "a.db"), [ACCEPTED]))
    assert (hit[0], hit[3]) == (date(1999, 9, 30), "0001047469-03-041163")


def test_jci_citation_is_independent_of_insertion_order(tmp_path):
    rows = [ACCEPTED] + FRESH
    a = _cite(_store(str(tmp_path / "f.db"), rows))
    b = _cite(_store(str(tmp_path / "r.db"), rows[::-1]))
    assert a == b and (a[0], a[3]) == (date(1999, 8, 23), "0000912057-99-009052")


def test_evidence_identity_is_the_row_set_not_the_file(tmp_path):
    rows = [ACCEPTED] + FRESH
    _store(str(tmp_path / "f.db"), rows).close()
    _store(str(tmp_path / "r.db"), rows[::-1]).close()
    _store(str(tmp_path / "m.db"), [ACCEPTED]).close()
    f, r, m = (Bd.evidence_set_sha256(str(tmp_path / n)) for n in ("f.db", "r.db", "m.db"))
    assert f == r and f != m


def _build(path, applied_accn, applied_d):
    c = sqlite3.connect(path)
    c.execute("CREATE TABLE coverage(cik INTEGER, primary_ticker TEXT)")
    c.execute("CREATE TABLE split_gap(cik, d, k, direction, cls, prev_asof, next_asof, status, ex_date, ratio, source, accn, snippet)")
    c.execute("INSERT INTO coverage VALUES(?, 'JCI')", (JCI,))
    c.execute("INSERT INTO split_gap VALUES(?,?,NULL,'APPLIED',NULL,NULL,NULL,'APPLIED',?,2.0,'TEXT',?,'')",
              (JCI, applied_d, applied_d, applied_accn))
    c.commit()
    c.close()


def test_an_ordinary_refresh_cannot_silently_recite_jci(tmp_path):
    old, new = str(tmp_path / "old.db"), str(tmp_path / "new.db")
    _build(old, "0001047469-03-041163", "1999-09-30")
    _build(new, "0000912057-99-009052", "1999-08-23")       # the union store's (deterministic) choice
    kinds = {x["kind"] for x in split_reinterpretations(new, old, "20260929")}
    assert kinds == {"ACCEPTED_REPLACED", "NEW_HISTORICAL_APPLIED"}
    assert split_reinterpretations(old, old, "20260929") == []
