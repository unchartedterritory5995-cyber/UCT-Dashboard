"""A provider that would not answer must never read as "no splits declared".

🔴 MEASURED, 2026-08-09. `earnings_estimates._fmp_get` catches every error and
returns `None`, so a 429 arrived at `bars_sanitize._fetch_meta` as an empty split
list — indistinguishable from a ticker that genuinely has no corporate actions.
The caller cached that as a SUCCESS (`_META_TTL`, seven days).

Two consequences, both observed on the live store in one evening:

  * 72 requests 429'd across 38 tickers during a universe sweep. Every one of them
    was recorded clean for a week without ever being asked.
  * A targeted re-run on DD and ABTC — two tickers PROVEN minutes earlier to carry
    an unadjusted split — printed
    `[sweep] 0 (ticker, tf) carry an unadjusted split; 0 rows rewritten`.
    A green line over a run that asked nothing and healed nothing.

⭐ This is the `FMP_API_KEY` vacuity guard in `api/main.py`, one level down: that
one catches a MISSING KEY, this one catches a REFUSED CALL, and the symptom is
identical — a sweep structurally incapable of finding anything, logging success.
"""
from __future__ import annotations

import os
import sys

import pytest

_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

from api.services import bars_sanitize as san  # noqa: E402
from api.services import earnings_estimates  # noqa: E402


def _fmp(monkeypatch, answers):
    """Stub `_fmp_get` where `_fetch_meta` imports it — inside the function."""
    def _get(path, params, timeout=10):
        return answers.get(path, None)
    monkeypatch.setattr(earnings_estimates, "_fmp_get", _get)


def test_a_refused_splits_call_raises_instead_of_answering_empty(monkeypatch):
    _fmp(monkeypatch, {"/stable/profile": [{"ipoDate": "2000-01-01"}],
                       "/stable/splits": None})          # the 429 shape
    with pytest.raises(san.MetaUnavailable):
        san._fetch_meta("ZZTEST")


def test_an_honest_empty_answer_is_NOT_a_refusal(monkeypatch):
    """The control. Without it the rail above passes by making every fetch raise,
    and a ticker with no corporate actions would retry forever."""
    _fmp(monkeypatch, {"/stable/profile": [{"ipoDate": "2000-01-01"}],
                       "/stable/splits": []})            # asked; there are none
    meta = san._fetch_meta("ZZTEST")
    assert meta == {"ipo": "2000-01-01", "splits": []}


def test_a_refused_PROFILE_call_is_only_a_soft_degradation(monkeypatch):
    """`ipo` feeds `_apply_listing_cutoff`, which already handles None by falling
    back to its standalone-gap rule. Failing the whole fetch over it would make
    the split heal hostage to an unrelated endpoint."""
    _fmp(monkeypatch, {"/stable/profile": None,
                       "/stable/splits": [{"date": "2026-06-24", "numerator": 1,
                                           "denominator": 3}]})
    meta = san._fetch_meta("ZZTEST")
    assert meta["ipo"] is None
    assert meta["splits"] == [("2026-06-24", 1 / 3)]


def test_the_sweep_tool_counts_a_refusal_separately_and_exits_nonzero(
        monkeypatch, tmp_path, capsys):
    """End to end through the shipped tool: a ticker it could not ask about is
    NAMED, and the process exit code says the sweep was incomplete."""
    sys.path.insert(0, os.path.join(_ROOT, "tools"))
    import importlib
    sweep_tool = importlib.import_module("bars_split_repair_sweep")

    from api.services import bars_split_repair
    from api.services.cache import cache

    for t in ("ZZGOOD", "ZZREFUSED"):
        cache.invalidate(san._META_KEY.format(t))

    def _meta(ticker):
        if ticker == "ZZREFUSED":
            raise san.MetaUnavailable("429")
        return {"ipo": None, "splits": []}

    monkeypatch.setattr(san, "_fetch_meta", _meta)
    monkeypatch.setattr(bars_split_repair, "repair_ticker",
                        lambda t, tf, **k: {"ticker": t, "tf": tf,
                                            "boundaries": [], "changed": 0})
    monkeypatch.setattr(sys, "argv",
                        ["bars_split_repair_sweep.py", "--db", str(tmp_path),
                         "--tickers", "ZZGOOD,ZZREFUSED", "--warm", "--tfs", "D"])
    rc = sweep_tool.main()
    out = capsys.readouterr().out
    assert rc == 2, "an incomplete sweep must not exit 0"
    assert "1/2 tickers were actually ASKED about" in out
    assert "ZZREFUSED" in out
    assert "ZZGOOD" not in out.split("NOT SWEPT")[-1]


def test_the_sweep_tool_warms_and_detects_per_ticker_not_in_two_phases(
        monkeypatch, tmp_path):
    """🔴 THE LRU BUG. Warming every ticker FIRST and detecting afterwards loses
    all but the last ~1,000 to `cache`'s LRU, and `_splits_for` reads CACHE-ONLY —
    so the earlier tickers answer "no splits" without being asked. This asserts
    the ORDER: each ticker's detect happens before the next one's warm.
    """
    sys.path.insert(0, os.path.join(_ROOT, "tools"))
    import importlib
    sweep_tool = importlib.import_module("bars_split_repair_sweep")

    from api.services import bars_split_repair
    from api.services.cache import cache

    syms = ["ZZA", "ZZB", "ZZC"]
    for t in syms:
        cache.invalidate(san._META_KEY.format(t))
    order: list[str] = []

    monkeypatch.setattr(san, "_fetch_meta",
                        lambda t: (order.append(f"warm:{t}"),
                                   {"ipo": None, "splits": []})[1])

    def _repair(t, tf, **k):
        order.append(f"detect:{t}")
        # ⭐ The splits must be HANDED IN, never re-read from a cache that may
        # already have evicted them.
        assert k.get("splits") is not None, (
            "repair_ticker was called without explicit splits — it would fall "
            "back to the cache-only read the LRU evicts")
        return {"ticker": t, "tf": tf, "boundaries": [], "changed": 0}

    monkeypatch.setattr(bars_split_repair, "repair_ticker", _repair)
    monkeypatch.setattr(sys, "argv",
                        ["bars_split_repair_sweep.py", "--db", str(tmp_path),
                         "--tickers", ",".join(syms), "--warm", "--tfs", "D"])
    assert sweep_tool.main() == 0
    assert order == ["warm:ZZA", "detect:ZZA",
                     "warm:ZZB", "detect:ZZB",
                     "warm:ZZC", "detect:ZZC"], order
