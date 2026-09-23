"""Canonical `uct` begins 2026-03-23: before it there is NO canonical data — no rows, no
fallback substitution, whatever the PIT ledger claims."""
import types

from api.services import breadth_corrected_pass as cp

TICKERS = ["AAPL", "MSFT", "BRK.B"]


def _inp(live_from):
    dates = {d: {"tickers": TICKERS} for d in ("2026-01-02", "2026-03-19", "2026-03-20", "2026-03-23", "2026-03-24")}
    ns = types.SimpleNamespace(pit_from=live_from, pit={"live_from": live_from, "dates": dates},
                               pinned=TICKERS, identity=types.SimpleNamespace(allowed=lambda t, d: True))
    ns.pit_members = lambda D: cp.Inputs.pit_members(ns, D)
    return ns


def test_canonical_start_constant():
    assert cp.CANONICAL_UCT_START == "2026-03-23"


def test_2026_03_20_has_no_canonical_uct():
    inp = _inp("2026-03-23")
    assert cp.Inputs.pit_members(inp, "2026-03-20") is None
    assert cp.Inputs.pit_members(inp, "2026-03-19") is None
    assert cp.Inputs.pit_members(inp, "2026-01-02") is None


def test_2026_03_23_is_the_first_session():
    inp = _inp("2026-03-23")
    assert cp.Inputs.pit_members(inp, "2026-03-23") == TICKERS
    assert cp.Inputs.pit_members(inp, "2026-03-24") == TICKERS


def test_a_ledger_claiming_earlier_live_from_is_still_floored():
    # the backfilled 2026-01-02..03-20 snapshots can never become canonical through the ledger
    inp = _inp("2026-01-02")
    assert cp.Inputs.pit_members(inp, "2026-03-20") is None
    assert cp.Inputs.pit_members(inp, "2026-01-02") is None
    assert cp.Inputs.pit_members(inp, "2026-03-23") == TICKERS


def test_no_fallback_substitution_before_start(monkeypatch):
    # before the start `uct` is ABSENT from the resolved universes; uct_backtest is never
    # renamed or substituted into its place
    from api.services import breadth_pit_frame as bpf
    monkeypatch.setattr(bpf, "resolve", lambda rec, d: None)
    inp = _inp("2026-03-23")
    out = cp.resolve_universes("2026-03-20", set(TICKERS), inp, {}, ("uct", "uct_backtest"))
    assert "uct" not in out
    assert out["uct_backtest"] == sorted(TICKERS)
    out = cp.resolve_universes("2026-03-23", set(TICKERS), inp, {}, ("uct",))
    assert out["uct"] == sorted(TICKERS)
