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


@pytest.fixture(autouse=True)
def _meta_offline(monkeypatch):
    """No test in this module may reach the real ticker_meta provider.

    Default: "B" — the fixture's no-consensus name — is a FUND, because every
    test that predates the fund-aware rule (2026-08-24) asserts B is dropped,
    and under that rule "dropped" is exactly what being a fund means.
    `meta_says` overrides it per-test."""
    from api.services import ticker_meta
    monkeypatch.setattr(ticker_meta, "_base_meta",
                        lambda sym: {"industry": "Closed-End Fund" if sym == "B" else "Software",
                                     "sector": ""})


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
    # unknown cap is not a small cap); B has no consensus AND is a fund, so it
    # is dropped — a real COMPANY with no consensus is now kept (see the
    # fund-aware tests below); C already reported.
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
    assert "B" not in previews          # no consensus AND a fund
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
    assert "B" not in briefs, "a fund must not get an earnings preview"
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


# ── 2026-08-24: a fund has no earnings story; a company without a consensus
# still does. Measured that day: 70 board names had no consensus in our feed —
# 47 funds, and 23 REAL operating companies (XPEV, Woodside, EHang, Citi
# Trends) that were being skipped with them.

@pytest.fixture
def meta_says(monkeypatch, _meta_offline):
    """Point the fund-detector at a fixture industry map."""
    from api.services import ticker_meta

    def _apply(mapping):
        monkeypatch.setattr(ticker_meta, "_base_meta",
                            lambda sym: {"industry": mapping.get(sym, ""), "sector": ""})
    return _apply


def test_a_fund_without_a_consensus_is_still_skipped(fake_calendar, meta_says):
    from api.services import earnings_preview_warm as w
    meta_says({"B": "Closed-End Fund - Debt"})
    assert "B" not in {r["sym"] for r in w._rank(1, reported=False, tracked=set())}


def test_a_real_company_without_a_consensus_is_now_warmed(fake_calendar, meta_says):
    """THE REGRESSION: 'B' has no consensus but is an operating company."""
    from api.services import earnings_preview_warm as w
    meta_says({"B": "Auto Manufacturers"})
    ranked = w._rank(1, reported=False, tracked=set())
    syms = [r["sym"] for r in ranked]
    assert "B" in syms, "a real company with no consensus must still get a brief"
    # …but behind every name that HAS one. (Not necessarily last: TINY is under
    # the house floor, and below-floor demotes harder than no-consensus — a
    # sub-$300M name is a weaker click than a real company we simply hold no
    # estimate for.)
    assert syms.index("B") > syms.index("A") and syms.index("B") > syms.index("NOCAP")
    assert next(r for r in ranked if r["sym"] == "B")["_no_consensus"] is True


def test_an_unknown_industry_is_treated_as_a_company_not_a_fund(fake_calendar, meta_says):
    from api.services import earnings_preview_warm as w
    meta_says({})                      # nothing known about B
    assert "B" in {r["sym"] for r in w._rank(1, reported=False, tracked=set())}


def test_a_meta_lookup_that_raises_never_drops_the_name(fake_calendar, monkeypatch):
    from api.services import earnings_preview_warm as w
    from api.services import ticker_meta
    monkeypatch.setattr(ticker_meta, "_base_meta",
                        lambda sym: (_ for _ in ()).throw(RuntimeError("provider down")))
    assert "B" in {r["sym"] for r in w._rank(1, reported=False, tracked=set())}


def test_consensus_names_still_outrank_a_no_consensus_one(fake_calendar, meta_says):
    from api.services import earnings_preview_warm as w
    meta_says({"B": "Auto Manufacturers"})
    ranked = w._rank(1, reported=False, tracked=set())
    idx = {r["sym"]: i for i, r in enumerate(ranked)}
    assert idx["A"] < idx["B"] and idx["NOCAP"] < idx["B"]


@pytest.mark.parametrize("industry, name, is_fund", [
    # `Asset Management` does NOT settle it — it is the industry of closed-end
    # funds AND of real asset managers. The NAME breaks the tie: a fund
    # announces itself there, a company does not.
    ("Asset Management", "Royce Micro-Cap Trust, Inc.", True),
    ("Asset Management", "PIMCO Income Strategy Fund II", True),
    ("Asset Management", "Nuveen Global High Income Fund", True),
    ("Asset Management", "Noah Holdings Limited", False),
    ("Asset Management", "BlackRock, Inc.", False),
    ("Asset Management", "", False),          # unknown name → company
])
def test_an_ambiguous_industry_is_settled_by_the_name(monkeypatch, industry, name, is_fund):
    from api.services import earnings_preview_warm as w
    from api.services import ticker_meta
    monkeypatch.setattr(ticker_meta, "_base_meta",
                        lambda sym: {"industry": industry, "sector": "", "name": name})
    assert w._looks_like_a_fund("X") is is_fund, (industry, name)


@pytest.mark.parametrize("industry, is_fund", [
    # The fund industries that actually occur on the board (2026-08-24 census).
    ("Closed-End Fund", True),
    ("Real Estate Fund", True),
    ("Municipal Bond Fund", True),
    # ⛔ A REIT reports real earnings. These MUST stay companies — "Trust" and
    # "Income" used to be in the pattern, which would have swept them up.
    ("Residential REITs", False),
    ("Diversified REITs", False),
    ("Diversified Real Estate", False),
    ("REIT - Mortgage Trust", False),
    ("Insurance - Diversified Income", False),
    # Ordinary operating industries seen among the 23 real companies.
    ("Auto Manufacturers", False),
    ("Marine Shipping", False),
    ("Wealth Management", False),
    ("Credit Services", False),
    ("", False),                      # unknown is not a fund
])
def test_the_fund_detector_keeps_reits_and_operating_companies(monkeypatch, industry, is_fund):
    from api.services import earnings_preview_warm as w
    from api.services import ticker_meta
    # No name at all → an ambiguous industry must fall to "company".
    monkeypatch.setattr(ticker_meta, "_base_meta",
                        lambda sym: {"industry": industry, "sector": "", "name": ""})
    assert w._looks_like_a_fund("X") is is_fund, industry


# ── the companions walk a longer horizon than the briefs ────────────────────

def test_companions_look_further_ahead_than_the_briefs(monkeypatch, fake_calendar):
    """A Profile is generate-once and date-independent, so it is warmed weeks
    before the print. A PREVIEW is not: three weeks out the report date is a
    provider's guess, and skip-if-stable keys on that date, so every shift
    re-bills it. The two horizons are therefore separate knobs."""
    from api.services import earnings_preview_warm as w
    from api.services import earnings_ai_store
    monkeypatch.setenv("EARNINGS_WARM_ENABLED", "1")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test")
    monkeypatch.setenv("EARNINGS_WARM_COMPANIONS", "1")
    monkeypatch.setenv("EARNINGS_WARM_WEEKS", "2")
    monkeypatch.setenv("EARNINGS_WARM_COMPANION_WEEKS", "5")
    monkeypatch.setattr(w, "_tracked_union", lambda: set())
    monkeypatch.setattr(earnings_ai_store, "age", lambda kind, sym: None)
    monkeypatch.setattr(w, "_needs_companion", lambda sym: False)
    monkeypatch.setattr(w, "_POOL", type("P", (), {"submit": lambda *a, **k: None})())
    seen = []
    real_rank = w._rank
    monkeypatch.setattr(w, "_rank",
                        lambda weeks, **kw: seen.append((weeks, kw.get("reported"))) or real_rank(weeks, **kw))
    w._run("preview", lambda *a, **k: None, reported=False)
    briefs = [wk for wk, rep in seen if rep is False]
    board = [wk for wk, rep in seen if rep is None]
    assert briefs == [2], f"the brief horizon must stay EARNINGS_WARM_WEEKS, got {briefs}"
    assert board == [5], f"the companion horizon must be its own knob, got {board}"


def test_the_companion_horizon_can_never_be_shorter_than_the_brief_one(monkeypatch):
    """A companion window inside the brief window would leave names with a
    preview and no company page — the exact inversion of the point."""
    from api.services import earnings_preview_warm as w
    monkeypatch.setenv("EARNINGS_WARM_WEEKS", "6")
    monkeypatch.setenv("EARNINGS_WARM_COMPANION_WEEKS", "1")
    assert w._companion_weeks() == 6


def test_the_companion_horizon_defaults_ahead_of_the_brief_one(monkeypatch):
    from api.services import earnings_preview_warm as w
    monkeypatch.delenv("EARNINGS_WARM_COMPANION_WEEKS", raising=False)
    monkeypatch.delenv("EARNINGS_WARM_WEEKS", raising=False)
    assert w._companion_weeks() == 4


# ── the census must report what EXISTS, not what the pass queued ────────────
# Both warm passes ran broken for months while logging healthy numbers:
# `submitted=80` is a statement of intent, and the artifact count was zero.

def test_the_census_counts_coverage_from_artifacts_not_from_its_own_queue(monkeypatch, fake_calendar):
    from api.services import earnings_preview_warm as w
    from api.services import earnings_ai_store
    monkeypatch.setenv("EARNINGS_WARM_ENABLED", "1")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test")
    monkeypatch.setenv("EARNINGS_WARM_COMPANIONS", "1")
    monkeypatch.setattr(w, "_tracked_union", lambda: set())
    monkeypatch.setattr(earnings_ai_store, "age", lambda kind, sym: None)
    monkeypatch.setattr(w, "_needs_companion", lambda sym: False)
    monkeypatch.setattr(w, "_POOL", type("P", (), {"submit": lambda *a, **k: None})())
    # THE ORIGINAL BUG'S SIGNATURE: plenty submitted, nothing on disk.
    monkeypatch.setattr(w, "is_covered", lambda sym: False)
    out = w._run("preview", lambda *a, **k: None, reported=False)
    assert out["submitted"] > 0, "the pass believes it is working…"
    assert out["covered"] == 0, "…and the artifacts say otherwise"


def test_a_broken_warm_says_so_at_warning(monkeypatch, fake_calendar, caplog):
    import logging
    from api.services import earnings_preview_warm as w
    from api.services import earnings_ai_store
    monkeypatch.setenv("EARNINGS_WARM_ENABLED", "1")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test")
    monkeypatch.setattr(w, "_tracked_union", lambda: set())
    monkeypatch.setattr(earnings_ai_store, "age", lambda kind, sym: None)
    monkeypatch.setattr(w, "_needs_companion", lambda sym: False)
    monkeypatch.setattr(w, "_POOL", type("P", (), {"submit": lambda *a, **k: None})())
    monkeypatch.setattr(w, "is_covered", lambda sym: False)
    with caplog.at_level(logging.WARNING, logger="api.services.earnings_preview_warm"):
        w._run("preview", lambda *a, **k: None, reported=False)
    assert any("COVERAGE" in r.message for r in caplog.records), \
        "a board opening cold must warn, not just log a healthy-looking count"


def test_a_fully_covered_board_stays_silent(monkeypatch, fake_calendar, caplog):
    """CONTROL: the floor must not cry on a healthy pass."""
    import logging
    from api.services import earnings_preview_warm as w
    from api.services import earnings_ai_store
    monkeypatch.setenv("EARNINGS_WARM_ENABLED", "1")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test")
    monkeypatch.setattr(w, "_tracked_union", lambda: set())
    monkeypatch.setattr(earnings_ai_store, "age", lambda kind, sym: None)
    monkeypatch.setattr(w, "_needs_companion", lambda sym: False)
    monkeypatch.setattr(w, "_POOL", type("P", (), {"submit": lambda *a, **k: None})())
    monkeypatch.setattr(w, "is_covered", lambda sym: True)
    with caplog.at_level(logging.WARNING, logger="api.services.earnings_preview_warm"):
        out = w._run("preview", lambda *a, **k: None, reported=False)
    assert out["covered"] == out["board"]
    assert not any("COVERAGE" in r.message for r in caplog.records)


def test_is_covered_requires_all_three_artifacts(monkeypatch):
    """A name with a brief but no company page is NOT an instant click."""
    from api.services import earnings_preview_warm as w
    from api.services import earnings_ai_store
    from api.services.stock_brief import store as sb_store
    from api.services.news_catalysts import service as nc
    monkeypatch.setattr(earnings_ai_store, "is_fresh", lambda kind, sym: kind == "preview")
    monkeypatch.setattr(sb_store, "has_content", lambda sym, period: True)
    monkeypatch.setattr(nc, "needs_catalysts", lambda sym: False)
    assert w.is_covered("X") is True
    monkeypatch.setattr(sb_store, "has_content", lambda sym, period: False)
    assert w.is_covered("X") is False, "no Profile → not an instant click"
    monkeypatch.setattr(sb_store, "has_content", lambda sym, period: True)
    monkeypatch.setattr(nc, "needs_catalysts", lambda sym: True)
    assert w.is_covered("X") is False, "catalysts still to write → not instant"
    monkeypatch.setattr(nc, "needs_catalysts", lambda sym: False)
    monkeypatch.setattr(earnings_ai_store, "is_fresh", lambda kind, sym: False)
    assert w.is_covered("X") is False, "no brief → not an instant click"
