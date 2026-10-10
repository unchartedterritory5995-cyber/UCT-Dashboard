"""AAII read on the server (`api/services/breadth_aaii.py`) and stored rows corrected.

The fixture is the real table shape measured 2026-10-10 (AAII's `sent_results`).
"""
from __future__ import annotations

from datetime import date

import pytest

from api.services import breadth_aaii as aaii

ROW = ('<tr align="center" bgcolor="ffffff"> <td align="left" class="tableTxt">{d}</td> '
       '<td align="right" class="tableTxt">{b}% </td> <td align="right" class="tableTxt">{n}%</td> '
       '<td align="right" class="tableTxt">{br}% </td> </tr>')
TABLE = "<table>" + "".join(ROW.format(d=d, b=b, n=n, br=br) for d, b, n, br in (
    ("Oct 7", 40.3, 20.8, 39.0), ("Sep 30", 34.6, 18.9, 46.5), ("Sep 23", 32.7, 19.2, 48.1),
    ("Sep 16", 41.0, 25.0, 34.0), ("Jan 7", 38.0, 30.0, 32.0), ("Dec 31", 37.0, 31.0, 32.0),
)) + "</table>"


def test_parse_reads_the_table_and_infers_the_year_across_new_year():
    rows = aaii.parse(TABLE, today=date(2026, 10, 10))
    assert rows[0] == {"reported": "2026-10-07", "bulls": 40.3, "neutral": 20.8, "bears": 39.0}
    assert [r["reported"] for r in rows][-2:] == ["2026-01-07", "2025-12-31"]
    assert aaii.sane(rows)


def test_a_changed_shape_is_not_sane():
    assert not aaii.sane(aaii.parse("<p>new layout</p>"))
    bad = aaii.parse(TABLE.replace("39.0%", "79.0%"), today=date(2026, 10, 10))
    assert not aaii.sane(bad)                            # components no longer sum to 100


def test_the_survey_in_effect_is_the_newest_released_by_thursday():
    rows = aaii.parse(TABLE, today=date(2026, 10, 10))
    wed = aaii.survey_for("2026-10-07", rows)            # Oct 7 closes Wed, not yet out
    assert wed["aaii_survey_date"] == "2026-10-01" and wed["aaii_bulls"] == 34.6
    thu = aaii.survey_for("2026-10-08", rows)
    assert thu == {"aaii_bulls": 40.3, "aaii_neutral": 20.8, "aaii_bears": 39.0,
                   "aaii_spread": 1.3, "aaii_survey_date": "2026-10-08"}


class _Resp:
    def __init__(self, code, text):
        self.status_code, self.text = code, text


def test_fetch_refuses_an_unrecognised_page():
    assert aaii.fetch(get=lambda *a, **k: _Resp(200, "<html>Incapsula</html>")) == []
    assert aaii.fetch(get=lambda *a, **k: _Resp(403, TABLE)) == []
    assert len(aaii.fetch(get=lambda *a, **k: _Resp(200, TABLE))) == 6


def test_fill_corrects_the_stale_weeks_and_leaves_correct_rows(monkeypatch):
    from api.services import breadth_monitor as bm
    stale = {"aaii_bulls": 32.7, "aaii_neutral": 19.2, "aaii_bears": 48.1, "aaii_spread": -15.4}
    stored = [
        {"date": "2026-09-24", **stale, "aaii_survey_date": "2026-09-24"},       # correct
        {"date": "2026-10-01", **stale, "aaii_survey_date": "2026-10-01"},       # stale
        {"date": "2026-10-08", **stale, "aaii_survey_date": "2026-10-08"},       # stale
        {"date": "2026-10-09", "aaii_survey_date": None},                       # missing
    ]
    patched = {}
    monkeypatch.setattr(bm, "get_history", lambda n: stored)
    monkeypatch.setattr(bm, "patch_fields", lambda d, f: patched.setdefault(d, f) is not None)
    out = aaii.fill(rows=aaii.parse(TABLE, today=date(2026, 10, 10)))
    assert out["fixed"] == ["2026-10-01", "2026-10-08", "2026-10-09"] and out["current"] == 1
    assert patched["2026-10-01"]["aaii_bulls"] == 34.6
    assert patched["2026-10-08"]["aaii_spread"] == 1.3
    assert patched["2026-10-09"]["aaii_survey_date"] == "2026-10-08"


def test_fill_writes_nothing_without_a_table(monkeypatch):
    from api.services import breadth_monitor as bm
    monkeypatch.setattr(bm, "patch_fields", lambda *a: pytest.fail("must not write"))
    monkeypatch.setattr(aaii, "fetch", lambda get=None: [])
    assert aaii.fill()["ok"] is False
