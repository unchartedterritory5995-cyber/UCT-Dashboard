"""Date-drift store: observe → detect a moved report date."""
import importlib
import os
import tempfile


def _fresh_module(tmp_db):
    os.environ["CALENDAR_DATES_DB_PATH"] = tmp_db
    import api.services.calendar_date_integrity as m
    importlib.reload(m)
    return m


def test_first_sighting_has_no_move(tmp_path):
    m = _fresh_module(str(tmp_path / "d.db"))
    m.observe("PEP", "2026-07-16")
    assert m.get_moves(["PEP"]) == {}


def test_same_date_reobserved_is_stable(tmp_path):
    m = _fresh_module(str(tmp_path / "d.db"))
    m.observe("PEP", "2026-07-16")
    m.observe("PEP", "2026-07-16")
    assert m.get_moves(["PEP"]) == {}


def test_date_shift_is_detected(tmp_path):
    m = _fresh_module(str(tmp_path / "d.db"))
    m.observe("PEP", "2026-07-16")
    m.observe("PEP", "2026-07-23")   # provider moved it a week out
    moves = m.get_moves(["PEP"])
    assert moves == {"PEP": {"from": "2026-07-16", "to": "2026-07-23"}}


def test_observe_many_batches(tmp_path):
    m = _fresh_module(str(tmp_path / "d.db"))
    m.observe_many([("AAA", "2026-07-16"), ("BBB", "2026-07-17")])
    m.observe_many([("AAA", "2026-07-20"), ("BBB", "2026-07-17")])   # AAA moves, BBB stable
    moves = m.get_moves(["AAA", "BBB"])
    assert moves == {"AAA": {"from": "2026-07-16", "to": "2026-07-20"}}


def test_get_moves_empty_and_unknown(tmp_path):
    m = _fresh_module(str(tmp_path / "d.db"))
    assert m.get_moves([]) == {}
    assert m.get_moves(["NEVERSEEN"]) == {}


def test_status_counts(tmp_path):
    m = _fresh_module(str(tmp_path / "d.db"))
    m.observe("AAA", "2026-07-16")
    m.observe("AAA", "2026-07-20")   # moved
    m.observe("BBB", "2026-07-16")   # stable
    st = m.status()
    assert st["tracked"] == 2
    assert st["with_moves"] == 1
