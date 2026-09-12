"""Why the fundamentals monitor paged several times a day for standing defects.

Two independent re-spam vectors, both measured on prod 2026-09-11/12:

1. ROTATING SAMPLE vs ONE-CYCLE MEMORY. `run_cycle` suppressed an alert only
   when the ticker was flagged in the IMMEDIATELY PREVIOUS cycle, but half the
   30 sample slots are a random shuffle of warm-cache entries plus a random cold
   tail. A long-tail name is almost never sampled twice running, so it left the
   suppression set and paged again every time it came back round. The existing
   `test_run_cycle_alerts_only_on_newly_flagged` misses this because it pins
   `_sample_tickers` to the SAME ticker for both cycles.

2. IN-MEMORY STATE + REDEPLOYS. `_prev_flagged_syms` lived in a module dict and
   every master push rebuilds web. Observed live: started_at minutes old,
   cycles_completed 1, `_prev_flagged_syms: []`.

`provider_coverage_monitor` hit vector 2 on 2026-08-09 ("one unchanged pair of
defects announced three times in twenty minutes") and fixed it with a durable
`defect_state` table. This ports that, with the difference that matters here:
this monitor SAMPLES, so a ticker that was not checked this cycle must keep its
recorded state rather than be treated as recovered.
"""
import importlib
import os


def _mod(tmp_path, monkeypatch):
    monkeypatch.setenv("FUNDAMENTALS_MONITOR_DB", os.path.join(str(tmp_path), "fm.db"))
    import api.services.fundamentals_monitor as fm
    importlib.reload(fm)
    monkeypatch.setattr(fm.cache, "invalidate", lambda k: None, raising=False)
    monkeypatch.setattr(fm.cache, "delete_prefix", lambda p: 0)
    monkeypatch.setattr(fm, "_is_fund", lambda s: False)
    return fm


def _payload(quarterly=None, annual=None):
    return {"ticker": "ZZ", "annual": annual or [], "quarterly": quarterly or []}


def _rep(label):
    return {"label": label, "reported": True}


def _fwd(label, period_end=None):
    return {"label": label, "reported": False, "period_end": period_end}


# A payload that fails a CRITICAL invariant (duplicate reported quarter).
_CRITICAL_PAYLOAD = _payload(quarterly=[_rep("2026 Q1"), _rep("2026 Q1")])


# ── vector 1: the sample rotates under the suppression set ────────────────────
def test_standing_defect_does_not_realert_when_the_sample_rotates(tmp_path, monkeypatch):
    fm = _mod(tmp_path, monkeypatch)
    monkeypatch.setattr(fm, "get_earnings_table",
                        lambda s, now=None: _CRITICAL_PAYLOAD if s == "BAD" else _payload(
                            quarterly=[_rep("2026 Q2"), _fwd("2026 Q3", "2026-09-30")]))
    alerts = []
    monkeypatch.setattr(fm, "_alert", lambda newly: alerts.append([f["sym"] for f in newly]))

    samples = iter([["BAD"], ["OTHER"], ["BAD"]])
    monkeypatch.setattr(fm, "_sample_tickers", lambda n: next(samples))

    fm.run_cycle()          # BAD sampled, flagged -> alerts (first detection)
    fm.run_cycle()          # BAD NOT sampled this cycle
    fm.run_cycle()          # BAD sampled again -> must NOT re-alert

    assert alerts == [["BAD"]], f"standing defect re-alerted on re-sample: {alerts}"


# ── vector 2: state survives a redeploy ───────────────────────────────────────
def test_standing_defect_does_not_realert_after_a_restart(tmp_path, monkeypatch):
    fm = _mod(tmp_path, monkeypatch)
    monkeypatch.setattr(fm, "get_earnings_table", lambda s, now=None: _CRITICAL_PAYLOAD)
    monkeypatch.setattr(fm, "_sample_tickers", lambda n: ["BAD"])
    alerts = []
    monkeypatch.setattr(fm, "_alert", lambda newly: alerts.append([f["sym"] for f in newly]))
    fm.run_cycle()
    assert alerts == [["BAD"]]

    fm2 = _mod(tmp_path, monkeypatch)          # redeploy: module state wiped
    monkeypatch.setattr(fm2, "get_earnings_table", lambda s, now=None: _CRITICAL_PAYLOAD)
    monkeypatch.setattr(fm2, "_sample_tickers", lambda n: ["BAD"])
    alerts2 = []
    monkeypatch.setattr(fm2, "_alert", lambda newly: alerts2.append([f["sym"] for f in newly]))
    fm2.run_cycle()

    assert alerts2 == [], "a redeploy rediscovered a standing defect as news"


# ── the other failure direction: a recovery must re-arm the alert ─────────────
def test_a_recovered_ticker_alerts_again_on_its_next_breach(tmp_path, monkeypatch):
    fm = _mod(tmp_path, monkeypatch)
    monkeypatch.setattr(fm, "_sample_tickers", lambda n: ["BAD"])
    state = {"broken": True}
    monkeypatch.setattr(fm, "get_earnings_table",
                        lambda s, now=None: _CRITICAL_PAYLOAD if state["broken"] else _payload(
                            quarterly=[_rep("2026 Q2"), _fwd("2026 Q3", "2026-09-30")]))
    alerts = []
    monkeypatch.setattr(fm, "_alert", lambda newly: alerts.append([f["sym"] for f in newly]))

    fm.run_cycle()                     # breach -> alert
    state["broken"] = False
    fm.run_cycle()                     # recovered -> must LEAVE the defect set
    state["broken"] = True
    fm.run_cycle()                     # breaks again -> must alert again

    assert alerts == [["BAD"], ["BAD"]], f"a recovered ticker went silent: {alerts}"


# ── only OUR-pipeline regressions page; upstream data shape does not ──────────
def test_a_shape_only_defect_does_not_page(tmp_path, monkeypatch):
    fm = _mod(tmp_path, monkeypatch)
    # forward_gap alone: an upstream hole, not a regression in our pipeline.
    monkeypatch.setattr(fm, "get_earnings_table", lambda s, now=None: _payload(
        quarterly=[_rep("2025 Q4"), _fwd("2026 Q2", "2026-06-30")]))
    monkeypatch.setattr(fm, "_sample_tickers", lambda n: ["GAPPY"])
    alerts = []
    monkeypatch.setattr(fm, "_alert", lambda newly: alerts.append(newly))
    out = fm.run_cycle()

    assert alerts == [], "an upstream shape hole paged Discord"
    assert out["flagged"] == 1, "the defect must still be RECORDED, just not paged"
    assert fm.get_state()["flagged_current"][0]["sym"] == "GAPPY"


def test_critical_kinds_are_the_ones_the_checker_actually_emits(tmp_path, monkeypatch):
    fm = _mod(tmp_path, monkeypatch)
    # The constant listed `label_mismatch` while check_ticker emits
    # `label_period_mismatch` — wiring it as written would have silently
    # demoted a real regression signal to a non-paging one.
    assert "label_period_mismatch" in fm._CRITICAL_KINDS
    assert "label_mismatch" not in fm._CRITICAL_KINDS


# ── funds/CEFs have no quarterly earnings to be wrong about ───────────────────
def test_a_closed_end_fund_is_never_flagged(tmp_path, monkeypatch):
    fm = _mod(tmp_path, monkeypatch)
    # 17 of the 24 stale names in a 300-ticker sample were CEFs (Nuveen, PIMCO,
    # Eaton Vance...). They can never have a quarterly EPS strip, so they are a
    # permanent, meaningless defect source.
    monkeypatch.setattr(fm, "_is_fund", lambda s: s == "PCN")
    monkeypatch.setattr(fm, "get_earnings_table", lambda s, now=None: _CRITICAL_PAYLOAD)
    monkeypatch.setattr(fm, "_sample_tickers", lambda n: ["PCN", "REALCO"])
    alerts = []
    monkeypatch.setattr(fm, "_alert", lambda newly: alerts.append([f["sym"] for f in newly]))
    out = fm.run_cycle()

    assert alerts == [["REALCO"]], f"a fund was paged: {alerts}"
    assert [f["sym"] for f in fm.get_state()["flagged_current"]] == ["REALCO"]
    assert out["skipped_funds"] == 1


# ── the staleness invariant reaches the monitor ───────────────────────────────
def test_monitor_flags_the_mmc_staleness_shape(tmp_path, monkeypatch):
    import datetime
    fm = _mod(tmp_path, monkeypatch)
    now = datetime.datetime(2026, 9, 12, tzinfo=datetime.timezone.utc).timestamp()
    monkeypatch.setattr(fm, "get_earnings_table", lambda s, now=None: _payload(
        quarterly=[_rep("2025 Q3"), _rep("2025 Q4"),
                   _fwd("2026 Q2", "2026-06-30"), _fwd("2026 Q3", "2026-09-30")]))
    r = fm.check_ticker("MMC", now=now)
    kinds = [i["kind"] for i in r["issues"]]
    assert "stale_reported" in kinds
    detail = [i["detail"] for i in r["issues"] if i["kind"] == "stale_reported"][0]
    assert "2025 Q4" in detail and "2026 Q2" in detail


def test_monitor_does_not_flag_a_current_strip_as_stale(tmp_path, monkeypatch):
    import datetime
    fm = _mod(tmp_path, monkeypatch)
    now = datetime.datetime(2026, 9, 12, tzinfo=datetime.timezone.utc).timestamp()
    monkeypatch.setattr(fm, "get_earnings_table", lambda s, now=None: _payload(
        quarterly=[_rep("2026 Q1"), _rep("2026 Q2"), _fwd("2026 Q3", "2026-09-30")]))
    r = fm.check_ticker("OK", now=now)
    assert [i["kind"] for i in r["issues"]] == []
