"""The nightly identity rail — what it withholds, and what it refuses to.

The 2026-08-23 audit's closing line was that the free identities "belong in the
nightly build as refusals, not in an audit". This is that wiring: a row that
contradicts itself has the contradicting columns withheld and counted, and is
still WRITTEN.
"""
import pytest

from api.services.screener import identities as I
from api.services.screener import snapshot_builder as sb


def _clean_row():
    """A row that satisfies every identity it is checkable for."""
    return {"ticker": "T", "gross_margin": 60.0, "op_margin": 20.0}


# ── what it withholds ────────────────────────────────────────────────────────

def test_a_self_contradicting_row_has_both_columns_withheld():
    """PLD published a 29.05% gross margin against its own 38.43% operating
    margin — arithmetically impossible. The identity proves one of the two is
    wrong and cannot say WHICH, so neither is published."""
    row = {"ticker": "PLD", "gross_margin": 29.05, "op_margin": 38.43}
    state = {}
    sb._refuse_contradictions(row, state)
    assert row["gross_margin"] is None
    assert row["op_margin"] is None
    assert state["gross_margin_ge_op_margin"]["withheld"] == 1
    assert state["gross_margin_ge_op_margin"]["rows"] == 1
    assert state["gross_margin_ge_op_margin"]["systemic"] is False


def test_a_clean_row_is_untouched_and_uncounted():
    row, state = _clean_row(), {}
    sb._refuse_contradictions(row, state)
    assert row == _clean_row()
    assert state == {}, "a build with nothing to say should say nothing"


def test_an_advisory_violation_is_never_withheld():
    """⛔ `roe`/`roa` do not share a balance-sheet vintage, so `roe < roa` has a
    measured population of legitimate rows. Refusing on it would blank correct
    values — advisories are for the receipt, proofs are for the gate."""
    assert next(i for i in I.IDENTITIES
                if i.name == "roe_ge_roa_when_both_positive").severity == "advisory"
    row = {"ticker": "X", "roe": 2.0, "roa": 9.0}   # violates, both positive
    state = {}
    sb._refuse_contradictions(row, state)
    assert row["roe"] == 2.0 and row["roa"] == 9.0
    assert state == {}


def test_a_null_side_is_not_a_violation():
    """Not checkable is never a pass AND never a violation — the module's
    loudest rule, asserted where it would do damage."""
    row = {"ticker": "X", "gross_margin": None, "op_margin": 38.43}
    state = {}
    sb._refuse_contradictions(row, state)
    assert row["op_margin"] == 38.43, "a lone value cannot contradict anything"
    assert state == {}


# ── the cap: the whole safety argument ───────────────────────────────────────

def test_past_the_cap_the_identity_stops_withholding_and_says_systemic(monkeypatch):
    """An identity firing on hundreds of rows is a changed upstream, not
    hundreds of bad rows, and blanking a column universe-wide is a far worse
    answer to that than saying so."""
    monkeypatch.setenv("SCREENER_IDENTITY_MAX_ROWS", "3")
    state = {}
    kept = []
    for i in range(6):
        row = {"ticker": f"T{i}", "gross_margin": 29.05, "op_margin": 38.43}
        sb._refuse_contradictions(row, state)
        kept.append(row["gross_margin"])
    c = state["gross_margin_ge_op_margin"]
    assert c["rows"] == 6, "every firing is COUNTED"
    assert c["withheld"] == 3, "only the first cap-many are withheld"
    assert c["systemic"] is True
    assert kept[:3] == [None, None, None]
    assert kept[3:] == [29.05, 29.05, 29.05], "past the cap the value survives"


def test_the_cap_is_read_once_per_build_not_once_per_row(monkeypatch):
    """The cap is latched into the state so a mid-build env change cannot make
    two rows in one receipt play by different rules."""
    monkeypatch.setenv("SCREENER_IDENTITY_MAX_ROWS", "5")
    state = {}
    sb._refuse_contradictions({"ticker": "A", "gross_margin": 1.0,
                               "op_margin": 2.0}, state)
    monkeypatch.setenv("SCREENER_IDENTITY_MAX_ROWS", "999")
    assert state["_cap"] == 5


def test_a_junk_cap_falls_back_rather_than_killing_the_build(monkeypatch):
    monkeypatch.setenv("SCREENER_IDENTITY_MAX_ROWS", "not-a-number")
    assert sb.identity_row_cap() == 200


# ── the rail must never cost a row ───────────────────────────────────────────

def test_a_rail_that_raises_leaves_the_row_intact_and_is_counted(monkeypatch):
    """⛔ A dropped row is not an absence, it is last month's row staying live."""
    def _boom(row, identities=None):
        raise RuntimeError("rail is broken")
    monkeypatch.setattr(I, "proof_violations", _boom)
    row, state = _clean_row(), {}
    sb._refuse_contradictions(row, state)
    assert row == _clean_row()
    assert state["_rail_errors"] == {"RuntimeError": 1}


def test_no_state_means_the_rail_is_inert():
    """`build_row` is called directly all over the test suite and by
    `_read_*` probes; passing no state must change nothing."""
    row = {"ticker": "PLD", "gross_margin": 29.05, "op_margin": 38.43}
    sb._refuse_contradictions(row, None)
    assert row["gross_margin"] == 29.05


# ── the census stays honest ──────────────────────────────────────────────────

def test_a_withheld_column_does_not_count_as_populated():
    """The build counts `populated` AFTER `build_row` returns, so a withheld
    column must read as the absence it now is — otherwise the census would
    report coverage the row does not have."""
    row = {"ticker": "PLD", "gross_margin": 29.05, "op_margin": 38.43}
    sb._refuse_contradictions(row, {})
    populated = {c: 0 for c in ("gross_margin", "op_margin")}
    for col, val in row.items():
        if val is not None and col in populated:
            populated[col] += 1
    assert populated == {"gross_margin": 0, "op_margin": 0}


def test_the_rail_runs_on_the_finished_row_inside_build_row():
    """Integration: the identities are relationships BETWEEN columns, so the
    call has to sit after every writer. Proven by driving `build_row` itself."""
    bars = [{"o": 100, "h": 101, "l": 99, "c": 100, "v": 1000}] * 40
    state = {}
    row = sb.build_row("T", bars, None,
                       {"gross_margin": 29.05, "op_margin": 38.43},
                       identity_state=state)
    assert row["gross_margin"] is None and row["op_margin"] is None
    assert state["gross_margin_ge_op_margin"]["withheld"] == 1
    assert row["ticker"] == "T", "the row is still written"
    assert row["snapshot_date"] is not None
