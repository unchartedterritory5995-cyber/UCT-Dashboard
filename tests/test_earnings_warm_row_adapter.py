"""The warm passes hand the generators CALENDAR rows; the generators read ENGINE
spelling. This is the contract that was silently broken for both passes until
2026-08-21 (every preview pass logged `candidates=0`; every analysis pass ran
the provider fan-out and persisted nothing because the row had no `verdict`).

Mutation-checked: restoring `if e.get("eps_estimate") is None: continue` in
`_rank` makes `test_rank_finds_pending_reporters_in_calendar_spelling` return
an empty list; dropping `engine_row` makes the analysis rows lose `verdict`.
"""
import datetime as dt

import pytest


def test_engine_row_derives_verdict_and_engine_keys_from_a_calendar_entry():
    from api.services.earnings_preview_warm import engine_row
    e = {"sym": "nvda", "eps_est": 1.01, "eps_act": 1.05, "rev_est": 45000.0,
         "rev_act": 46000.0, "mc_b": 4000.0, "name": "NVIDIA", "time_et": "16:20"}
    row = engine_row(e, "2026-08-27", "amc")
    assert row["sym"] == "NVDA"
    assert row["eps_estimate"] == 1.01 and row["reported_eps"] == 1.05
    assert row["rev_estimate"] == 45000.0 and row["rev_actual"] == 46000.0
    assert row["verdict"] == "Beat"                 # DERIVED by the engine, not restated
    assert row["surprise_pct"]                       # the engine's own formatter ran
    assert row["date"] == "2026-08-27" and row["session"] == "AMC"
    assert row["mc_b"] == 4000.0 and row["name"] == "NVIDIA"


def test_engine_row_is_pending_when_there_is_no_actual():
    from api.services.earnings_preview_warm import engine_row
    row = engine_row({"sym": "CRM", "eps_est": 2.5, "eps_act": None}, "2026-08-26", "amc")
    assert row["verdict"] == "Pending"
    assert row["reported_eps"] is None and row["eps_estimate"] == 2.5


def test_engine_row_still_reads_engine_spelling():
    from api.services.earnings_preview_warm import engine_row
    row = engine_row({"sym": "X", "eps_estimate": 1.0, "reported_eps": 1.2,
                      "earnings_date": "2026-08-25", "session": "bmo"})
    assert row["eps_estimate"] == 1.0 and row["reported_eps"] == 1.2
    assert row["date"] == "2026-08-25" and row["session"] == "BMO"


@pytest.fixture
def fake_calendar(monkeypatch):
    from api.routers import calendar as cal
    days = {
        "2026-08-24": {
            "bmo": [
                {"sym": "A", "eps_est": 1.0, "eps_act": None, "mc_b": 10.0},
                {"sym": "TINY", "eps_est": 0.1, "eps_act": None, "mc_b": 0.05},
            ],
            "amc": [
                {"sym": "B", "eps_est": None, "eps_act": None, "mc_b": 50.0},   # no consensus
                {"sym": "C", "eps_est": 2.0, "eps_act": 2.2, "mc_b": 5.0},      # reported
                {"sym": "NOCAP", "eps_est": 0.4, "eps_act": None},              # cap unknown
            ],
            "tbd": [],
        },
    }
    monkeypatch.setattr(cal, "get_calendar", lambda week=None, **k: {"days": days})
    monkeypatch.setattr(cal, "get_day_metrics", lambda date_str=None, **k: {})
    monkeypatch.setattr(cal, "_week_dates", lambda: [dt.date(2026, 8, 24)])
    return days


def test_rank_finds_pending_reporters_in_calendar_spelling(fake_calendar):
    from api.services import earnings_preview_warm as w
    pending = w._rank(1, reported=False, tracked=set())
    syms = [r["sym"] for r in pending]
    # A has consensus + cap; NOCAP has consensus and an UNKNOWN cap (kept — an
    # unknown cap is not a small cap); B has no consensus; C already reported.
    #
    # TINY is under the $300M floor. It used to be DROPPED here; since
    # 2026-08-23 it is DEMOTED instead — owner call, "every reporter you can
    # see": a sub-floor name still has a tile on the calendar board, and a tile
    # that opens to a 30s spinner is the complaint the change answers. `top_n`
    # bounds the spend now; the floor only decides who is warmed LAST.
    # Ordering + the restorable hard-drop are pinned in
    # tests/test_earnings_warm_priority_order.py.
    assert syms == ["A", "NOCAP", "TINY"]
    assert pending[-1]["sym"] == "TINY", "a sub-floor name must rank LAST, not vanish"
    assert pending[0]["verdict"] == "Pending" and pending[0]["eps_estimate"] == 1.0
    assert pending[0]["date"] == "2026-08-24" and pending[0]["session"] == "BMO"


def test_rank_reported_rows_carry_a_real_verdict_for_the_ai_gate(fake_calendar):
    from api.services import earnings_preview_warm as w
    reported = w._rank(1, reported=True, tracked=set())
    assert [r["sym"] for r in reported] == ["C"]
    # engine._generate_earnings_analysis skips the AI step when verdict is
    # ""/"pending" — this is the field that turned the warm pass into a no-op.
    assert reported[0]["verdict"] not in ("", "Pending")
    assert reported[0]["reported_eps"] == 2.2


def test_rank_keeps_a_small_cap_that_someone_tracks(fake_calendar):
    from api.services import earnings_preview_warm as w
    pending = w._rank(1, reported=False, tracked={"TINY"})
    assert [r["sym"] for r in pending][0] == "TINY"      # tracked ranks first
    assert pending[0]["_is_tracked"] is True


def test_run_submits_stale_names_and_reports_what_topn_dropped(monkeypatch):
    from api.services import earnings_preview_warm as w
    from api.services import earnings_ai_store
    monkeypatch.setenv("EARNINGS_WARM_ENABLED", "1")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test")
    monkeypatch.setenv("EARNINGS_WARM_TOPN", "2")
    monkeypatch.setenv("EARNINGS_WARM_COMPANIONS", "0")
    rows = [{"sym": s, "verdict": "Pending"} for s in ("A", "B", "C")]
    monkeypatch.setattr(w, "_rank", lambda *a, **k: rows)
    monkeypatch.setattr(w, "_tracked_union", lambda: set())
    monkeypatch.setattr(earnings_ai_store, "age", lambda kind, sym: 10 if sym == "A" else None)
    submitted = []

    class _Pool:
        def submit(self, fn, *a, **k):
            submitted.append(a)
    monkeypatch.setattr(w, "_POOL", _Pool())
    out = w._run("preview", lambda *a, **k: None, reported=False)
    assert out["submitted"] == 1 and out["recent"] == 1      # A fresh, B submitted
    assert out["dropped_by_topn"] == 1                        # C, beyond TOPN — said out loud
    assert submitted[0][1] == "B"


# ── 2026-08-24: companions cover the BOARD, not the brief-eligible subset ────
# Measured on prod that day: 61 of 252 names on the board had no Profile and 68
# had no Catalysts — every one of them a name the preview's consensus filter had
# dropped. Whether we can price tonight's print is not a fact about whether we
# can say what the company does.

def test_board_mode_returns_every_name_consensus_or_not(fake_calendar):
    from api.services import earnings_preview_warm as w
    board = {r["sym"] for r in w._rank(1, reported=None, tracked=set())}
    # A: pending w/ consensus · B: pending, NO consensus · C: already reported
    # NOCAP: consensus, unknown cap · TINY: below the house floor
    assert board == {"A", "B", "C", "NOCAP", "TINY"}


def test_board_mode_is_a_superset_of_both_budgets(fake_calendar):
    from api.services import earnings_preview_warm as w
    board = {r["sym"] for r in w._rank(1, reported=None, tracked=set())}
    previews = {r["sym"] for r in w._rank(1, reported=False, tracked=set())}
    analyses = {r["sym"] for r in w._rank(1, reported=True, tracked=set())}
    assert previews < board and analyses < board
    # and the two budgets keep their own rules — board mode must not leak into them
    assert "B" not in previews          # no consensus
    assert "C" not in previews          # already reported
    assert analyses == {"C"}


def test_companions_are_submitted_for_a_name_the_preview_filter_drops(monkeypatch, fake_calendar):
    """The regression this whole change exists for: 'B' has no consensus, so it
    gets no brief — but it MUST still get a Profile and Catalysts."""
    from api.services import earnings_preview_warm as w
    from api.services import earnings_ai_store
    monkeypatch.setenv("EARNINGS_WARM_ENABLED", "1")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test")
    monkeypatch.setenv("EARNINGS_WARM_COMPANIONS", "1")
    monkeypatch.setattr(w, "_tracked_union", lambda: set())
    monkeypatch.setattr(earnings_ai_store, "age", lambda kind, sym: None)
    monkeypatch.setattr(w, "_needs_companion", lambda sym: True)
    briefs, comps = [], []

    class _Pool:
        def submit(self, fn, *a, **k):
            (comps if fn is w._safe_companions else briefs).append(a[0] if fn is w._safe_companions else a[1])
    monkeypatch.setattr(w, "_POOL", _Pool())

    out = w._run("preview", lambda *a, **k: None, reported=False)
    assert "B" not in briefs, "a no-consensus name must not get a preview"
    assert "B" in comps, "but it MUST get its Profile + Catalysts"
    assert "C" in comps, "a name that already reported still has a company page"
    assert set(comps) == {"A", "B", "C", "NOCAP", "TINY"}
    assert out["board"] == 5 and out["companions"] == 5


def test_companions_off_leaves_the_brief_budget_exactly_as_it_was(monkeypatch, fake_calendar):
    """Kill-switch control: EARNINGS_WARM_COMPANIONS=0 must not widen the walk."""
    from api.services import earnings_preview_warm as w
    from api.services import earnings_ai_store
    monkeypatch.setenv("EARNINGS_WARM_ENABLED", "1")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test")
    monkeypatch.setenv("EARNINGS_WARM_COMPANIONS", "0")
    monkeypatch.setattr(w, "_tracked_union", lambda: set())
    monkeypatch.setattr(earnings_ai_store, "age", lambda kind, sym: None)
    seen = []

    class _Pool:
        def submit(self, fn, *a, **k): seen.append(a[1])
    monkeypatch.setattr(w, "_POOL", _Pool())

    out = w._run("preview", lambda *a, **k: None, reported=False)
    # The preview budget, unchanged: pending + consensus. TINY is under the
    # house $300M floor and is DEMOTED, not dropped (owner 2026-08-23, "every
    # reporter you can see") — so it is in the set, and it is ranked LAST.
    assert set(seen) == {"A", "NOCAP", "TINY"}
    assert seen[-1] == "TINY"
    assert "B" not in seen and "C" not in seen
    assert out["companions"] == 0


def test_a_brief_still_rides_its_own_row_not_a_board_row(monkeypatch, fake_calendar):
    """The row handed to the generator must be the BRIEF row (engine spelling,
    verdict derived) — walking the board must not swap in a different object."""
    from api.services import earnings_preview_warm as w
    from api.services import earnings_ai_store
    monkeypatch.setenv("EARNINGS_WARM_ENABLED", "1")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test")
    monkeypatch.setenv("EARNINGS_WARM_COMPANIONS", "1")
    monkeypatch.setattr(w, "_tracked_union", lambda: set())
    monkeypatch.setattr(earnings_ai_store, "age", lambda kind, sym: None)
    monkeypatch.setattr(w, "_needs_companion", lambda sym: False)
    rows = []

    class _Pool:
        def submit(self, fn, *a, **k): rows.append(a[2])
    monkeypatch.setattr(w, "_POOL", _Pool())

    w._run("preview", lambda *a, **k: None, reported=False)
    assert rows and all(r.get("verdict") == "Pending" for r in rows)
    assert all("eps_estimate" in r for r in rows)
