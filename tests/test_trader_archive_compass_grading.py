"""Compass grading with the team archive as a LABELLED SECOND SOURCE (wave 2a, item 3).

SYNTHETIC data only — the repo is public.

Kept outside the `test_wisdom_*` files on purpose: grade_ticker and the brain facade are Compass
code, and the journal-exclusion grep scans every wisdom-scoped test.

WHAT THIS FILE HAS TO BE ABLE TO SAY RED FOR
1. the archive CHANGING a verdict: GO/HOLD/SKIP, entry, stop, size, risk or a hard flag;
2. the archive blended into the engine's win rate (one number from two sources);
3. the key leaking with the flag off (every engine answer must be byte-identical then);
4. an archive failure breaking a verdict;
5. a price level from a team call reaching a Compass answer;
6. the facade not attaching the archive on lookup_playbook / setup_winrate / analogs.
"""
from __future__ import annotations

import pytest

from api.services import brain_service, grade_ticker as gt
from api.services.wisdom.core import store
from tests.test_wisdom_archive_members import SECRET, _seed_kicker


@pytest.fixture
def wisdom_db(tmp_path, monkeypatch):
    monkeypatch.setenv("WISDOM_DB_PATH", str(tmp_path / "wisdom.db"))
    store.init_db()


@pytest.fixture
def on(monkeypatch):
    monkeypatch.setenv("WISDOM_ARCHIVE_ENABLED", "1")
    monkeypatch.setenv("PUSH_SECRET", SECRET)


@pytest.fixture
def downtrend(monkeypatch):
    from api.services.wisdom.archive import setup_map

    monkeypatch.setattr(setup_map, "market_state", lambda: "downtrend")


@pytest.fixture
def no_engine(monkeypatch):
    monkeypatch.setattr(brain_service, "_engine", lambda: None)


def _keys(o):
    if isinstance(o, dict):
        for k, v in o.items():
            yield k
            yield from _keys(v)
    elif isinstance(o, list):
        for v in o:
            yield from _keys(v)


# ── the facade: the archive rides beside the engine, never inside it ─────────

def test_flag_off_leaves_every_engine_answer_byte_identical(no_engine, monkeypatch):
    monkeypatch.delenv("WISDOM_ARCHIVE_ENABLED", raising=False)
    assert brain_service.lookup_playbook("kicker") == {"ok": False, "error": "brain not available"}
    assert brain_service.setup_winrate("kicker") == {"ok": False, "error": "brain not available"}
    assert brain_service.find_historical_analogs("kicker") == {"ok": False, "error": "brain not available"}


def test_the_archive_answers_beside_an_absent_engine_labelled_and_without_levels(wisdom_db, on, downtrend,
                                                                                 no_engine):
    _seed_kicker()
    out = brain_service.lookup_playbook("Kicker Candle")
    assert out["ok"] is False and out["error"] == "brain not available"      # the engine's own answer, kept
    ta = out["team_archive"]
    assert ta["source"] == "team_archive" and "measured after the fact" in ta["label"]
    assert ta["setup_id"] == "kicker" and ta["all_calls"]["n_scored"] == 140
    assert ta["today"]["cut"]["n_scored"] == 40
    assert not {"entry", "stop", "target"} & set(_keys(out))
    assert brain_service.setup_winrate("kicker", "GREEN")["team_archive"]["setup_id"] == "kicker"


def test_the_engine_win_rate_is_never_replaced_or_blended(wisdom_db, on, downtrend, monkeypatch):
    _seed_kicker()
    monkeypatch.setattr(brain_service, "_engine_setup_winrate",
                        lambda setup, regime="ALL": {"ok": True, "setup": "Kicker", "regime": regime,
                                                     "win_rate_pct": 61.5, "total_trades": 26})
    out = brain_service.setup_winrate("kicker")
    assert out["win_rate_pct"] == 61.5 and out["total_trades"] == 26          # the engine's numbers, untouched
    assert out["team_archive"]["all_calls"]["win20"] == 0.55                  # the archive's, under its own key


def test_analogs_put_todays_tape_first(wisdom_db, on, downtrend, no_engine):
    _seed_kicker()
    out = brain_service.find_historical_analogs("uct_kicker", limit=5)       # a detector id resolves too
    ta = out["team_archive"]
    assert ta["today_state"] == "downtrend"
    assert [f["regime"] for f in ta["failures"]] == ["downtrend"]
    assert len(ta["winners"]) == 5 and all(w["trader"] for w in ta["winners"])


# ── grade_ticker: the verdict is fixed before the archive is read ────────────

def _fakes(**over):
    kw = dict(
        regime_fn=lambda: {"regime": "bull_trend", "narration": "Uptrend."},
        quote_fn=lambda s: {"last": 100.5},
        patterns_fn=lambda s: [{"pattern_name": "uct_kicker", "confidence": 85,
                                "levels": {"entry": 100.0, "stop": 95.0, "target_primary": 110.0}}],
        playbook_fn=lambda name: {"ok": True, "name": "Kicker", "winrate": {"win_rate_pct": 61.0}},
        size_fn=lambda *a: {"ok": True, "max_position_pct": 20.0, "account_risk": 1.0, "r1_target": 105.0},
    )
    kw.update(over)
    return kw


VERDICT_KEYS = ("verdict", "regime", "setup", "grade", "entry", "stop", "stop_pct", "size_pct",
                "account_risk_pct", "first_target", "hard_flags")


def test_the_archive_never_changes_a_verdict(wisdom_db, on, downtrend):
    _seed_kicker()
    without = gt.grade_ticker("ZZTA", **_fakes(archive_fn=lambda s, setup: None))
    real = gt.grade_ticker("ZZTA", **_fakes())                                # the default, through the facade
    assert real["verdict"] == "GO"                                            # control: a decisive verdict
    for k in VERDICT_KEYS:
        assert real[k] == without[k], k
    assert "team_archive" not in without
    ta = real["team_archive"]
    assert ta["setup"]["setup_id"] == "kicker" and ta["ticker"]["ticker"] == "ZZTA"
    # the engine's win rate is still its own sentence; the archive is a separate, labelled one
    assert "historically 61% over the firm's book" in real["basis"]
    assert real["basis"].startswith(without["basis"])
    tail = real["basis"][len(without["basis"]):]
    assert "Team archive (measured after the fact, separate from the verdict)" in tail
    assert "140 scored team calls" in tail and "ZZTA: 1 team calls on record" in tail
    assert any("team archive" in s for s in real["sources"])
    assert not {"entry", "stop", "target"} & set(_keys(ta))


def test_a_failing_archive_never_breaks_a_verdict(wisdom_db, on):
    def explode(symbol, setup):
        raise RuntimeError("archive down")

    out = gt.grade_ticker("ZZTA", **_fakes(archive_fn=explode))
    assert out["ok"] and out["verdict"] == "GO" and "team_archive" not in out


def test_the_no_setup_skip_still_tells_the_tickers_team_record(wisdom_db, on, downtrend):
    _seed_kicker()
    out = gt.grade_ticker("ZZTA", **_fakes(patterns_fn=lambda s: []))
    assert out["verdict"] == "SKIP" and out["hard_flags"] == ["no_setup"]
    assert out["entry"] is None and out["size_pct"] is None
    assert "ZZTA: 1 team calls on record" in out["basis"]
    assert out["team_archive"]["setup"] is None and out["team_archive"]["ticker"]["n_calls"] == 1


def test_grade_ticker_carries_no_archive_with_the_flag_off(monkeypatch):
    monkeypatch.delenv("WISDOM_ARCHIVE_ENABLED", raising=False)
    out = gt.grade_ticker("ZZTA", **_fakes())
    assert "team_archive" not in out and "Team archive" not in out["basis"]


# ── the prompt and the registries ────────────────────────────────────────────

def test_the_verdict_protocol_cites_the_archive_after_the_verdict_and_never_blends_it():
    from api.services.journal_two import coach_prompts as cp

    t = cp.MENTOR_TWO_LANE
    i = t.index("§11 — Verdict protocol")
    sec = t[i:t.index("§11b")]
    assert "trader_archive_setup" in sec and "team_archive" in sec
    assert "never" in sec and "GO/HOLD/SKIP" in sec
    assert "never blend" in sec


def test_both_compass_surfaces_reach_the_archive_through_the_one_facade():
    """Chat and voice call brain_service for these three tools, so the archive reaches both
    surfaces from one place and they can never diverge."""
    import inspect

    from api.services import voice_tool_impls as vti
    from api.services.journal_two import coach_chat_tools as cct

    for fn in (cct._exec_lookup_playbook, cct._exec_setup_winrate, cct._exec_find_historical_analogs,
               vti._lookup_playbook, vti._setup_winrate, vti._find_historical_analogs):
        assert "brain_service." in inspect.getsource(fn), fn.__name__
