"""Seam 24 — the empty state says whether anyone LOOKED.

`confirmed=0` verdicts are real, stored, and carry a full Opus rationale, but
only the admin review surface can read them. So a member on an empty Technical
tab could not tell "we evaluated four setups and none qualified" from "nothing
was ever looked at" — and about 80% of judged tickers showed that empty state on
2026-09-10.

This exposes the COUNT only. Rejection rationales stay admin-only; nothing here
tells a member what the judge said about a setup it turned down.

⛔ The load-bearing property is that `count_evaluated` uses the SAME window and
the SAME latest-per-key rule as `get_confirmed`, minus its `confirmed=1` clause.
If they diverged, the tab could say "4 evaluated, none confirmed" while
get_confirmed was serving one — two authorities over one population.
"""
import importlib


def _store(tmp_path, monkeypatch):
    monkeypatch.setenv("PATTERN_VISION_DB_PATH", str(tmp_path / "pv.db"))
    import api.services.pattern_vision.store as s
    importlib.reload(s)
    s.init_db()
    return s


def _v(s, setup, asof, confirmed, conf=80.0):
    s.put_verdict({
        "ticker": "NVDA", "tf": "D", "setup": setup, "asof_date": asof,
        "confirmed": confirmed, "vision_confidence": conf, "rationale": "r",
        "key_level": 1.0, "raw_confidence": 0.5, "model": "claude-opus-4-8",
        "signals_hash": "h" + setup + asof, "judged_at": 1789045200, "checks": "[]",
    })


def test_rejected_setups_are_counted_as_evaluated(tmp_path, monkeypatch):
    s = _store(tmp_path, monkeypatch)
    _v(s, "vcp", "2026-09-10", 0)
    _v(s, "bull_flag", "2026-09-10", 0)
    _v(s, "flat_base", "2026-09-10", 0)

    assert s.get_confirmed("NVDA", today="2026-09-10") == []
    assert s.count_evaluated("NVDA", today="2026-09-10") == 3, (
        "the empty state must be able to say three setups were looked at"
    )


def test_confirmed_and_rejected_are_both_counted(tmp_path, monkeypatch):
    s = _store(tmp_path, monkeypatch)
    _v(s, "vcp", "2026-09-10", 1)
    _v(s, "bull_flag", "2026-09-10", 0)
    assert len(s.get_confirmed("NVDA", today="2026-09-10")) == 1
    assert s.count_evaluated("NVDA", today="2026-09-10") == 2


def test_nothing_evaluated_counts_zero(tmp_path, monkeypatch):
    """The genuinely-never-looked-at case keeps the original copy."""
    s = _store(tmp_path, monkeypatch)
    assert s.count_evaluated("NVDA", today="2026-09-10") == 0


def test_the_count_honours_D1s_recency_window(tmp_path, monkeypatch):
    """THE LOAD-BEARING ONE. Same window as get_confirmed — a verdict older than
    the 7-day floor is not served AND not counted, or the tab would claim to
    have evaluated something it will not show."""
    s = _store(tmp_path, monkeypatch)
    _v(s, "vcp", "2026-09-10", 0)
    _v(s, "old_setup", "2026-08-01", 0)          # far outside the window

    assert s.count_evaluated("NVDA", today="2026-09-10") == 1
    assert s.count_evaluated("NVDA", today="2026-09-20") == 0, (
        "once the window has passed, nothing is claimed as evaluated"
    )


def test_the_count_uses_latest_per_key_like_get_confirmed(tmp_path, monkeypatch):
    """One setup judged on three days is ONE evaluated setup, not three. If this
    counted rows instead of keys, a tab would report 'twelve setups evaluated'
    for four setups re-judged over three sessions."""
    s = _store(tmp_path, monkeypatch)
    for d in ("2026-09-08", "2026-09-09", "2026-09-10"):
        _v(s, "vcp", d, 0)
    assert s.count_evaluated("NVDA", today="2026-09-10") == 1


def test_the_two_queries_cannot_disagree(tmp_path, monkeypatch):
    """Confirmed rows are a SUBSET of evaluated rows, always. A case where
    get_confirmed serves more than count_evaluated counts would mean the two
    windows had drifted apart."""
    s = _store(tmp_path, monkeypatch)
    _v(s, "vcp", "2026-09-10", 1)
    _v(s, "bull_flag", "2026-09-09", 1)
    _v(s, "flat_base", "2026-09-10", 0)
    confirmed = len(s.get_confirmed("NVDA", today="2026-09-10"))
    evaluated = s.count_evaluated("NVDA", today="2026-09-10")
    assert confirmed <= evaluated
    assert (confirmed, evaluated) == (2, 3)
