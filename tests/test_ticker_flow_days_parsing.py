"""`_compute_ticker_flow`'s `days` parsing — the function `/flow` and its
`/ticker-flow` HTTP route both feed with a free-form `str` (the route's own
`Query(default="1")` carries no format restriction at all).

⛔ Found by a 2026-09-19 reliability audit: no test called `_compute_ticker_flow`
directly. Discord's own callers (`parse_flow_command` on the pre-V2 path,
its V2 equivalent) validate `days` before ever reaching this function, so in
practice it never sees garbage from Discord — but `GET /ticker-flow`'s
`days: str` query param has no such gate, and a second, independent parser
here silently falls back to `lookback=1` on anything it can't read, rather
than raising the way the command-side parser does. That is intentional
(a report endpoint should degrade to a sane default, not 500), but it had
never actually been exercised by a test — this locks in the CURRENT,
never-crashes behavior rather than changing it, since three other call
sites depend on today's shape and the full blast radius of tightening it
was not established in the time available.
"""
from __future__ import annotations

import api.live_massive_router as lmr


def _flow(monkeypatch, days, *, contracts=None):
    monkeypatch.setattr(lmr, "_build_by_contract", lambda *a, **k: {"contracts": contracts or []})
    return lmr._compute_ticker_flow("NVDA", days)


def test_garbage_days_never_crashes_and_falls_back_to_one(monkeypatch):
    for bad in ("banana", "", "  ", "1.2.3", "none", "N/A"):
        out = _flow(monkeypatch, bad)
        assert out["ok"] is True, f"days={bad!r} must degrade, never crash"
        assert out["window"]["days_requested"] == "1", f"days={bad!r} should fall back to 1, got {out['window']}"


def test_a_negative_number_clamps_to_one(monkeypatch):
    for bad in ("-5", "-1.0"):
        out = _flow(monkeypatch, bad)
        assert out["window"]["days_requested"] == "1", f"days={bad!r} must clamp to 1, not go negative"


def test_the_literal_zero_means_all_not_clamped_to_one(monkeypatch):
    """`"0"` is deliberately special-cased into the `"all"` branch alongside
    `"all"`/`"max"` -- it does NOT fall through to the numeric clamp. Documented
    here because it reads, on a first pass, exactly like the kind of value the
    numeric branch should be clamping."""
    out = _flow(monkeypatch, "0")
    assert out["window"]["days_requested"] == "all"


def test_all_and_max_both_mean_the_full_400_day_window(monkeypatch):
    for word in ("all", "ALL", "max", "Max"):
        out = _flow(monkeypatch, word)
        assert out["window"]["days_requested"] == "all"


def test_a_genuine_number_passes_through_unchanged(monkeypatch):
    out = _flow(monkeypatch, "30")
    assert out["window"]["days_requested"] == "30"
    out = _flow(monkeypatch, "  63  ")   # incidental whitespace tolerance
    assert out["window"]["days_requested"] == "63"


def test_a_decimal_string_truncates_rather_than_erroring(monkeypatch):
    """`int(float(d))` accepts "7.9" -- documenting the actual behavior
    (truncates toward zero) rather than leaving it undiscovered."""
    out = _flow(monkeypatch, "7.9")
    assert out["window"]["days_requested"] == "7"
