"""D2 CP2 — the DARK dual-compute, and the three properties it exists for.

⛔ APPROVED SCOPE (owner, 2026-09-12, GATE-D2 line 2), verbatim: *"it computes
both the legacy path and the book path, a rail asserts equality on every call in
test and on a sampled fraction in production (log-only, never raise), and it
serves the legacy value."*

Three properties, each with a mutation:

  **it serves the legacy value**   — MUTATION B: return the book path instead
  **it never raises**              — MUTATION E: raise on disagreement
  **it distinguishes its outcomes** — a disagreement, an unresolvable address
                                      and agreement are three facts, not two

⛔⛔ THE DISAGREEMENT IS INJECTED, NEVER WAITED FOR. Today the two paths return
the same integer, so a test that merely called the reader twice would pass
whether or not the legacy value is the one served. Every assertion below that
matters forces the book path to answer differently first — otherwise this file
would be measuring a coincidence.
"""
from __future__ import annotations

import json

import pytest

from api.services import ticker_returns as tr
from api.services.canonical import address_book as book_mod
from api.services.canonical import dual_read as dual


@pytest.fixture(autouse=True)
def _clean_ledger():
    dual.reset()
    yield
    dual.reset()


#: A real bars row in the store's declared shape: (ts, o, h, l, c, v).
#: ⭐ Every value distinct, so an off-by-one cannot pass by returning a
#: neighbour that happens to be equal — the fixture defect that made a whole
#: S10 suite assert vacuously.
ROW = (20260911, 10.0, 11.0, 9.0, 10.5, 1_000_000)
CLOSE = 10.5


# ─────────────────────────────────────────────────────────────────────────────
# NON-VACUITY
# ─────────────────────────────────────────────────────────────────────────────

def test_the_two_paths_actually_point_at_the_close_today():
    """⛔ AN EMPTY OR BROKEN LOOKUP WOULD SATISFY MOST OF THIS FILE."""
    pos = book_mod.row_position(tr.CLOSE_METRIC)
    assert pos is not None, "the book cannot resolve the close — nothing below means anything"
    assert pos == tr.LEGACY_CLOSE_INDEX
    assert ROW[pos] == CLOSE
    assert tr._close(ROW) == CLOSE


# ─────────────────────────────────────────────────────────────────────────────
# IT SERVES THE LEGACY VALUE  (mutation B)
# ─────────────────────────────────────────────────────────────────────────────

def test_it_serves_the_LEGACY_value_when_the_book_disagrees(monkeypatch):
    """⛔⛔ MUTATION B'S SUBJECT. Point the book at the LOW and the reader must
    still hand back the CLOSE.

    A migration that quietly begins serving the new path is the failure this
    whole shape exists to prevent: the value would change under members while
    every "we compared them" line in the log still read fine.
    """
    monkeypatch.setattr(book_mod, "row_position", lambda name: 3)   # the low
    assert ROW[3] != CLOSE, "the injected position is not actually a disagreement"

    served = tr._close(ROW)

    assert served == CLOSE, (
        f"the reader served {served}, which is the BOOK path. It must serve the "
        "legacy value while dark.")
    assert dual.counts()["disagreed"] == 1
    assert dual.counts()["agreed"] == 0


def test_it_serves_the_legacy_value_when_the_book_cannot_answer(monkeypatch):
    monkeypatch.setattr(book_mod, "row_position", lambda name: None)
    assert tr._close(ROW) == CLOSE
    assert dual.counts()["book_unavailable"] == 1


def test_it_serves_the_legacy_value_when_the_book_position_is_out_of_range(monkeypatch):
    """A projection longer than the row is `book_unavailable`, never an
    IndexError and never a silent fall-through to the last element."""
    monkeypatch.setattr(book_mod, "row_position", lambda name: 99)
    assert tr._close(ROW) == CLOSE
    assert dual.counts()["book_unavailable"] == 1


def test_it_serves_the_legacy_value_when_the_comparison_is_not_sampled(monkeypatch):
    monkeypatch.setenv(dual.SAMPLE_ENV, "0")
    assert tr._close(ROW) == CLOSE
    assert dual.counts() == {k: 0 for k in dual.OUTCOMES}, (
        "an unsampled call recorded an outcome — then the ledger counts calls, "
        "not comparisons, and a 5% sample would read as 95% agreement")


# ─────────────────────────────────────────────────────────────────────────────
# IT NEVER RAISES  (mutation E)
# ─────────────────────────────────────────────────────────────────────────────

def test_a_disagreement_LOGS_and_does_not_raise(monkeypatch, caplog):
    """⛔ MUTATION E'S SUBJECT. D2 advises; it must not be able to take a member
    page down over a manifest."""
    monkeypatch.setattr(book_mod, "row_position", lambda name: 1)   # the open
    with caplog.at_level("ERROR"):
        served = tr._close(ROW)
    assert served == CLOSE
    assert any("DISAGREEMENT" in r.message or "DISAGREEMENT" in r.getMessage()
               for r in caplog.records), (
        "a disagreement was recorded and never logged — then a dark week of "
        "divergence is invisible until someone reads the ledger")


def test_it_survives_a_recorder_that_is_itself_broken(monkeypatch):
    """The recorder is the diagnostic; the served value is the product. If this
    file's own bookkeeping throws, the member still gets the right number."""
    def _boom(*a, **k):
        raise RuntimeError("ledger exploded")
    monkeypatch.setattr(dual, "_record", _boom)
    assert dual.observe("ohlcv.c", CLOSE, 9.0) == CLOSE
    assert tr._close(ROW) == CLOSE


def test_observe_returns_legacy_on_every_outcome():
    """One assertion per outcome, so a partial regression names its branch."""
    assert dual.observe("m", 1, 1) == 1
    assert dual.observe("m", 1, 2) == 1
    assert dual.observe("m", 1, dual.UNAVAILABLE) == 1
    assert dual.counts() == {"agreed": 1, "disagreed": 1, "book_unavailable": 1}


# ─────────────────────────────────────────────────────────────────────────────
# THE OUTCOMES ARE NOT COLLAPSED
# ─────────────────────────────────────────────────────────────────────────────

def test_unavailable_is_not_a_disagreement_and_a_None_value_is_not_unavailable():
    """⛔⛔ THE SENTINEL IS AN OBJECT, NOT `None`, AND THAT IS LOAD-BEARING.

    A metric whose legitimate value is `None` and a book that could not resolve
    the address are different facts. One object cannot mean both — and if it
    did, a store returning NULLs would read as a broken address book.
    """
    dual.observe("m", None, None)
    assert dual.counts()["agreed"] == 1, "None == None is AGREEMENT, not absence"
    dual.observe("m", None, dual.UNAVAILABLE)
    assert dual.counts()["book_unavailable"] == 1
    assert dual.counts()["disagreed"] == 0, (
        "an unresolvable address was counted as a wrong answer — a deleted book "
        "would then read as a defect in the store")


def test_the_ledger_reports_named_outcomes_never_a_pass_rate():
    """⭐ F-S7-3's rule, one layer down: four outcomes, never collapsed into a
    percentage. A single number cannot distinguish a quiet path from a dead one."""
    assert set(dual.counts()) == set(dual.OUTCOMES)
    assert len(dual.OUTCOMES) == 3


def test_the_recent_ledger_is_bounded():
    """A diagnostic on a request path that grows without limit is a leak."""
    for i in range(dual._LEDGER_MAX + 50):
        dual.observe("m", i, i)
    assert len(dual.recent()) == dual._LEDGER_MAX
    assert dual.counts()["agreed"] == dual._LEDGER_MAX + 50, (
        "the tally was truncated with the list — the bound is on the diagnostic, "
        "not on the measurement")


# ─────────────────────────────────────────────────────────────────────────────
# THE SAMPLE FRACTION IS READ AT CALL TIME
# ─────────────────────────────────────────────────────────────────────────────

def test_the_sample_fraction_is_read_from_the_environment_AT_CALL_TIME(monkeypatch):
    """⛔ F-S7-5 COST THIS PROGRAMME A WRONG FINDING FOR EXACTLY THIS REASON.

    A mirror answered from a module constant while production ran a different
    value, and the harness manufactured the disagreement it existed to detect.
    """
    monkeypatch.delenv(dual.SAMPLE_ENV, raising=False)
    assert dual.sample_pct() == dual.DEFAULT_SAMPLE_PCT
    monkeypatch.setenv(dual.SAMPLE_ENV, "0")
    assert dual.sample_pct() == 0 and dual.should_compare() is False
    monkeypatch.setenv(dual.SAMPLE_ENV, "100")
    assert dual.sample_pct() == 100 and dual.should_compare() is True


@pytest.mark.parametrize("raw", ["", "  ", "abc", "-1", "101", "1e2"])
def test_a_malformed_sample_fraction_falls_back_rather_than_silently_disabling(
        monkeypatch, raw):
    """⛔ AN OFF-BY-TYPO MUST NOT BE INDISTINGUISHABLE FROM A DELIBERATE ZERO.
    Treating `"abc"` as 0 would turn the comparison off for a dark week and
    every report would say "no disagreements"."""
    monkeypatch.setenv(dual.SAMPLE_ENV, raw)
    assert dual.sample_pct() == dual.DEFAULT_SAMPLE_PCT


def test_the_default_fraction_compares_every_call():
    """⭐ 100 is a WIDENING of the approved "sampled fraction", not a narrowing:
    the book path is a dict lookup against a stat-cached file, so sampling would
    buy nothing and cost coverage. The knob stays, for the day it costs."""
    assert dual.DEFAULT_SAMPLE_PCT == 100


# ─────────────────────────────────────────────────────────────────────────────
# THE READER, END TO END
# ─────────────────────────────────────────────────────────────────────────────

def test_the_returns_payload_is_byte_identical_to_the_pre_migration_arithmetic(monkeypatch):
    """⛔ NOBODY'S NUMBER MOVES. The three `[4]`s this migration replaced are
    reproduced here as a FROZEN ORACLE — the arithmetic as it stood before CP2 —
    and the migrated function must agree with it bar for bar.
    """
    basis = (20260901, 5.0, 6.0, 4.0, 5.0, 10)
    after = [(20260902 + i, 5.0, 6.0, 4.0, 5.0 + i, 10) for i in range(25)]

    def _old_pct(b, c):
        return round((c / b - 1.0) * 100.0, 2)

    expected = {
        "since_pct": _old_pct(float(basis[4]), float(after[-1][4])),
        "d5_pct": _old_pct(float(basis[4]), float(after[4][4])),
        "d21_pct": _old_pct(float(basis[4]), float(after[20][4])),
    }

    monkeypatch.setattr(tr.bars_sqlite, "get_bars_before",
                        lambda t, tf, n, to_key: [basis])
    monkeypatch.setattr(tr.bars_sqlite, "get_bars_since",
                        lambda t, tf, since: after)
    got = tr._returns_for("NVDA", 20260901)
    assert got == expected, f"the migrated reader changed a member-visible number: {got} != {expected}"
    assert dual.counts()["agreed"] == 4, (
        "expected one comparison per close read (basis + three tails); got "
        f"{dual.counts()}")


def test_the_book_reader_is_cached_by_file_identity_not_by_a_clock(tmp_path, monkeypatch):
    """A rebuilt book is picked up without a restart; an unchanged one is not
    re-parsed on every bar. ⛔ Not a TTL — a TTL makes freshness a function of
    the clock rather than of the file."""
    first = book_mod.book()
    assert first is book_mod.book(), "the book is re-parsed on every call"

    fake = tmp_path / "book.json"
    fake.write_text(json.dumps({"metrics": {"x.y": {}}, "stores": {}}), encoding="utf-8")
    monkeypatch.setattr(book_mod, "BOOK_PATH", fake)
    monkeypatch.setattr(book_mod, "_cache", None)
    monkeypatch.setattr(book_mod, "_cache_key", None)
    assert set(book_mod.book()["metrics"]) == {"x.y"}


def test_an_unreadable_book_is_empty_not_an_exception(tmp_path, monkeypatch):
    """⛔ D2 MUST NOT BE ABLE TO 500 A MEMBER PAGE OVER A MANIFEST IT ADVISES ON."""
    missing = tmp_path / "nope.json"
    monkeypatch.setattr(book_mod, "BOOK_PATH", missing)
    monkeypatch.setattr(book_mod, "_cache", None)
    monkeypatch.setattr(book_mod, "_cache_key", None)
    assert book_mod.book() == {}
    assert book_mod.row_position("ohlcv.c") is None
    assert tr._close(ROW) == CLOSE

    broken = tmp_path / "broken.json"
    broken.write_text("{not json", encoding="utf-8")
    monkeypatch.setattr(book_mod, "BOOK_PATH", broken)
    assert book_mod.book() == {}


def test_an_empty_book_is_a_failed_read_not_a_metric_free_codebase(tmp_path, monkeypatch):
    """⛔ AN EMPTY RESULT IS A FAILED INVOCATION UNTIL PROVEN OTHERWISE."""
    empty = tmp_path / "empty.json"
    empty.write_text(json.dumps({"metrics": {}}), encoding="utf-8")
    monkeypatch.setattr(book_mod, "BOOK_PATH", empty)
    monkeypatch.setattr(book_mod, "_cache", None)
    monkeypatch.setattr(book_mod, "_cache_key", None)
    assert book_mod.book() == {}, (
        "a book with zero metrics was accepted as an answer — then a truncated "
        "file and a codebase with no metrics are the same fact")


def test_the_dark_reader_imports_no_store_and_fetches_nothing():
    """⛔ CP2 IS A LOOKUP, NOT A RESOLVER. SPEC-D2 §3's five-status
    `resolve(address)` is CP3 and needs its own line; if this module started
    opening stores, CP2 would have shipped CP3 without an approval."""
    import ast
    import pathlib
    src = pathlib.Path(book_mod.__file__).read_text(encoding="utf-8")
    tree = ast.parse(src)
    for node in ast.walk(tree):
        if isinstance(node, ast.Expr) and isinstance(node.value, ast.Constant) \
                and isinstance(node.value.value, str):
            node.value.value = ""
    code = ast.unparse(tree)
    for forbidden in ("sqlite3", "bars_sqlite", "requests", "httpx", "urllib"):
        assert forbidden not in code, (
            f"the address-book reader reaches for {forbidden!r} — that is a "
            "resolver, and a resolver is CP3")
    assert "json" in code, "the stripper ate the real code — the check above proves nothing"
