"""tools/bars_rescale_check.py: the F3 standing check reads a store and NAMES rescale artifacts and declined
heals. Synthetic store only (the repo is public)."""
from __future__ import annotations

import datetime as dt
import hashlib
import json
import sqlite3

import pytest

from tools import bars_rescale_check as T


def _days(n, start="2024-01-02"):
    out, d = [], dt.date.fromisoformat(start)
    while len(out) < n:
        if d.weekday() < 5:
            out.append(int(d.strftime("%Y%m%d")))
        d += dt.timedelta(days=1)
    return out


DAYS = _days(40)


def _store(path, series):
    con = sqlite3.connect(path)
    con.execute("CREATE TABLE ohlcv (ticker TEXT NOT NULL, tf TEXT NOT NULL, ts INTEGER NOT NULL, o REAL, h REAL, "
                "l REAL, c REAL, v INTEGER, PRIMARY KEY (ticker, tf, ts)) WITHOUT ROWID")
    for (ticker, tf), rows in series.items():
        con.executemany("INSERT INTO ohlcv VALUES (?,?,?,?,?,?,?,?)",
                        [(ticker, tf, ts, c, c, c, c, v) for ts, c, v in rows])
    con.commit()
    con.close()


def _sha(p):
    return hashlib.sha256(p.read_bytes()).hexdigest()


@pytest.fixture()
def db(tmp_path):
    p = tmp_path / "bars.db"
    _store(p, {
        ("ZZPIN", "D"): [(t, 0.0001, 5_000_000_000) for t in DAYS[:25]] + [(t, 50.0, 900_000) for t in DAYS[25:]],
        ("ZZPIN", "W"): [(t, 0.0001, 9_000_000_000) for t in DAYS[:5]],         # not daily: not counted
        ("ZZSUB", "D"): [(t, 0.0001, 4_000) for t in DAYS],                    # a real sub-penny listing
        ("ZZOK", "D"): [(t, 20.0, 1_000_000) for t in DAYS],
        # BBD-shaped: a 6.4% down day six sessions before a declared 1.2, nothing else near it
        ("ZZBBD", "D"): [(t, 10.0, 1000) for t in DAYS[:16]] + [(t, round(10.0 / 1.064, 4), 1000) for t in DAYS[16:]],
        # DD-shaped: a real 1-for-3 the store never applied
        ("ZZDD", "D"): [(t, 47.95, 1000) for t in DAYS[:18]] + [(t, 143.13, 1000) for t in DAYS[18:]],
    })
    return p


def _iso(i):
    s = str(DAYS[i])
    return f"{s[:4]}-{s[4:6]}-{s[6:]}"


def test_it_names_the_rescale_artifact_and_not_a_real_sub_penny_listing(db, tmp_path):
    out = tmp_path / "r.json"
    assert T.main(["--db", str(db), "--out", str(out)]) == 1
    rep = json.loads(out.read_text())
    assert [(r["ticker"], r["rows"]) for r in rep["rescale_artifacts"]] == [("ZZPIN", 25)]


def test_it_names_declined_and_pending_heals_with_the_one_detector(db, tmp_path):
    splits = tmp_path / "s.json"
    splits.write_text(json.dumps({"ZZBBD": [[_iso(22), 1.2]], "ZZDD": [[_iso(22), 1 / 3]], "ZZOK": [[_iso(20), 2.0]]}))
    out = tmp_path / "r.json"
    assert T.main(["--db", str(db), "--splits", str(splits), "--out", str(out)]) == 1
    rep = json.loads(out.read_text())
    assert [(r["ticker"], r["at"]) for r in rep["declined"]] == [("ZZBBD", _iso(16))]
    assert [(r["ticker"], r["boundary"]) for r in rep["pending"]] == [("ZZDD", _iso(18))]


def test_a_clean_store_exits_zero(tmp_path):
    p = tmp_path / "clean.db"
    _store(p, {("ZZOK", "D"): [(t, 20.0, 1_000_000) for t in DAYS]})
    assert T.main(["--db", str(p)]) == 0


def test_a_missing_store_is_could_not_run_not_clean(tmp_path):
    assert T.main(["--db", str(tmp_path / "nope.db")]) == 2


def test_it_writes_nothing_to_the_store(db, tmp_path):
    before = _sha(db)
    T.main(["--db", str(db)])
    assert _sha(db) == before
    with pytest.raises(sqlite3.OperationalError):              # the tool's own connection cannot write
        T._connect(str(db)).execute("DELETE FROM ohlcv")
