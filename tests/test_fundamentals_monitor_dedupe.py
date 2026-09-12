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


# ── the daily digest for defects that must not page ──────────────────────────
# Shape defects are real and worth seeing; what they are not worth is a page at
# 23:00 that nobody can act on. They accumulate in defect_state and get ONE
# summary per interval.
#
# ⛔ The stamp is on disk for the same reason the defect set is: an in-memory
# "last sent" would reset on every web restart and fire a digest per redeploy,
# which is the exact bug this whole change exists to remove.
_SHAPE_PAYLOAD = _payload(quarterly=[_rep("2025 Q4"), _fwd("2026 Q2", "2026-06-30")])


def _digest_mod(tmp_path, monkeypatch, sent):
    fm = _mod(tmp_path, monkeypatch)
    monkeypatch.setattr(fm, "get_earnings_table", lambda s, now=None: _SHAPE_PAYLOAD)
    monkeypatch.setattr(fm, "_sample_tickers", lambda n: ["GAPPY"])
    monkeypatch.setattr(fm, "_alert", lambda newly: None)
    monkeypatch.setattr(fm, "_send_digest", lambda rows: sent.append([r["sym"] for r in rows]))
    return fm


def test_a_standing_shape_defect_produces_one_digest(tmp_path, monkeypatch):
    sent = []
    fm = _digest_mod(tmp_path, monkeypatch, sent)
    fm.run_cycle(now=1_000_000.0)
    assert sent == [["GAPPY"]], f"no digest for a standing shape defect: {sent}"


def test_the_digest_does_not_repeat_within_the_interval(tmp_path, monkeypatch):
    sent = []
    fm = _digest_mod(tmp_path, monkeypatch, sent)
    fm.run_cycle(now=1_000_000.0)
    fm.run_cycle(now=1_000_000.0 + 3600)      # an hour later — same day
    assert sent == [["GAPPY"]], f"digest repeated inside the interval: {sent}"


def test_the_digest_does_not_repeat_after_a_restart(tmp_path, monkeypatch):
    sent = []
    fm = _digest_mod(tmp_path, monkeypatch, sent)
    fm.run_cycle(now=1_000_000.0)
    assert sent == [["GAPPY"]]

    sent2 = []
    fm2 = _digest_mod(tmp_path, monkeypatch, sent2)   # redeploy: module state gone
    fm2.run_cycle(now=1_000_000.0 + 3600)
    assert sent2 == [], "a redeploy re-sent the digest — the stamp is not durable"


def test_the_digest_fires_again_once_the_interval_has_passed(tmp_path, monkeypatch):
    sent = []
    fm = _digest_mod(tmp_path, monkeypatch, sent)
    fm.run_cycle(now=1_000_000.0)
    fm.run_cycle(now=1_000_000.0 + 86_400 + 1)
    assert sent == [["GAPPY"], ["GAPPY"]], f"digest never came back: {sent}"


def test_no_standing_defects_means_no_digest(tmp_path, monkeypatch):
    sent = []
    fm = _mod(tmp_path, monkeypatch)
    monkeypatch.setattr(fm, "get_earnings_table", lambda s, now=None: _payload(
        quarterly=[_rep("2026 Q2"), _fwd("2026 Q3", "2026-09-30")]))
    monkeypatch.setattr(fm, "_sample_tickers", lambda n: ["FINE"])
    monkeypatch.setattr(fm, "_send_digest", lambda rows: sent.append(rows))
    fm.run_cycle(now=1_000_000.0)
    assert sent == []


def test_a_critical_defect_pages_and_is_not_also_digested(tmp_path, monkeypatch):
    # It already paged individually; repeating it in the digest would teach the
    # reader that the digest is where criticals live.
    sent, paged = [], []
    fm = _mod(tmp_path, monkeypatch)
    monkeypatch.setattr(fm, "get_earnings_table", lambda s, now=None: _CRITICAL_PAYLOAD)
    monkeypatch.setattr(fm, "_sample_tickers", lambda n: ["BAD"])
    monkeypatch.setattr(fm, "_alert", lambda newly: paged.append([f["sym"] for f in newly]))
    monkeypatch.setattr(fm, "_send_digest", lambda rows: sent.append(rows))
    fm.run_cycle(now=1_000_000.0)
    assert paged == [["BAD"]]
    assert sent == [], f"a critical defect was also digested: {sent}"


def test_the_digest_reports_standing_defects_the_cycle_did_not_sample(tmp_path, monkeypatch):
    # THE POINT of reading the digest off defect_state rather than off this
    # cycle's flagged list: one cycle sees ~30 of ~3,700 names, so a digest
    # built from the sample would report a near-random slice of the real set.
    sent = []
    fm = _digest_mod(tmp_path, monkeypatch, sent)
    fm.run_cycle(now=1_000_000.0)                     # GAPPY recorded
    assert sent == [["GAPPY"]]

    monkeypatch.setattr(fm, "_sample_tickers", lambda n: ["OTHER"])
    monkeypatch.setattr(fm, "get_earnings_table", lambda s, now=None: (
        _SHAPE_PAYLOAD if s == "OTHER" else _payload()))
    fm.run_cycle(now=1_000_000.0 + 86_400 + 1)        # GAPPY not sampled this time
    assert sent[-1] == ["GAPPY", "OTHER"], f"digest lost an unsampled standing defect: {sent[-1]}"


def test_an_unwritable_db_does_not_turn_the_digest_into_a_per_cycle_page(tmp_path, monkeypatch):
    """A read-only /data must not turn the digest into a per-cycle page.

    ⚠️ THIS TEST PASSED THE MOMENT IT WAS WRITTEN, and the reason is the point.
    The hypothesis was that `_meta_get` returning None on a store error is
    indistinguishable from "never sent", so a broken DB would fire the digest on
    every cycle — twelve a day, the exact spam this change removes, arriving
    when nobody can read the state to explain why. That hypothesis was WRONG:
    `_standing_shape_defects` swallows the same failure and returns `[]`, and
    `_maybe_digest` returns early on an empty set, so a broken store makes the
    digest go SILENT rather than loud.

    Silent is the correct direction here and the degradation is bounded: the
    durable read falls back to the in-memory mirror, so criticals still page and
    only the once-a-day summary is lost. Kept as a regression guard because the
    two swallowed failures that produce this are in different functions, and a
    later "improvement" to either one — making `_standing_shape_defects` raise,
    or having `_maybe_digest` treat an unreadable stamp as "never sent" — would
    silently invert it. No fix was needed; do not read this as one.
    """
    sent = []
    fm = _digest_mod(tmp_path, monkeypatch, sent)
    fm.run_cycle(now=1_000_000.0)
    assert sent == [["GAPPY"]]

    # Now the store dies completely — reads AND writes.
    def _boom(*a, **kw):
        raise OSError("attempt to write a readonly database")

    monkeypatch.setattr(fm, "_connect", _boom)
    fm.run_cycle(now=1_000_000.0 + 3600)
    fm.run_cycle(now=1_000_000.0 + 7200)
    assert sent == [["GAPPY"]], f"a broken store re-sent the digest every cycle: {sent}"
