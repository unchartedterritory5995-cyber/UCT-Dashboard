import importlib


def _mod():
    import api.services.fundamentals_monitor as fm
    importlib.reload(fm)
    return fm


def _payload(quarterly=None, annual=None, ticker="ZZ"):
    return {"ticker": ticker, "annual": annual or [], "quarterly": quarterly or []}


def _rep(label):
    return {"label": label, "reported": True}


def _fwd(label, period_end=None):
    return {"label": label, "reported": False, "period_end": period_end}


# ── invariant checks ──────────────────────────────────────────────────────────
def test_check_ticker_clean_contiguous(monkeypatch):
    fm = _mod()
    monkeypatch.setattr(fm, "get_earnings_table", lambda s, now=None: _payload(
        quarterly=[_rep("2025 Q4"), _rep("2026 Q1"),
                   _fwd("2026 Q2", "2026-06-30"), _fwd("2026 Q3", "2026-09-30")],
        annual=[{"year": 2024, "eps": 2.0, "sales": 6e9}],
    ))
    r = fm.check_ticker("ZZ")
    assert r["ok"] is True
    assert r["issues"] == []


def test_forward_gap_detects_dropped_quarter(monkeypatch):
    # The off-by-one regression: last reported 2026 Q1, but forward starts at
    # 2026 Q3 (the just-ended 2026 Q2 was dropped and everything shifted).
    fm = _mod()
    monkeypatch.setattr(fm, "get_earnings_table", lambda s, now=None: _payload(
        quarterly=[_rep("2026 Q1"),
                   _fwd("2026 Q3", "2026-09-30"), _fwd("2026 Q4", "2026-12-31")],
    ))
    r = fm.check_ticker("ZZ")
    assert r["ok"] is False
    assert any(i["kind"] == "forward_gap" for i in r["issues"])


def test_forward_backwards_label_detected(monkeypatch):
    # A forward card labeled EARLIER than an already-reported quarter (the HUBG
    # anomaly: reported 2026 Q2 but a forward '2026 Q1').
    fm = _mod()
    monkeypatch.setattr(fm, "get_earnings_table", lambda s, now=None: _payload(
        quarterly=[_rep("2025 Q4"), _rep("2026 Q2"),
                   _fwd("2026 Q1", "2026-03-30"), _fwd("2026 Q3", "2026-09-30")],
    ))
    r = fm.check_ticker("ZZ")
    assert r["ok"] is False
    assert any(i["kind"] in ("forward_gap", "forward_noncontiguous") for i in r["issues"])


def test_forward_noncontiguous_detected(monkeypatch):
    fm = _mod()
    monkeypatch.setattr(fm, "get_earnings_table", lambda s, now=None: _payload(
        quarterly=[_rep("2025 Q4"),
                   _fwd("2026 Q1", "2026-03-31"), _fwd("2026 Q3", "2026-09-30")],
    ))
    r = fm.check_ticker("ZZ")
    assert any(i["kind"] == "forward_noncontiguous" for i in r["issues"])


def test_reported_forward_overlap_detected(monkeypatch):
    fm = _mod()
    monkeypatch.setattr(fm, "get_earnings_table", lambda s, now=None: _payload(
        quarterly=[_rep("2026 Q2"), _fwd("2026 Q2", "2026-06-30")],
    ))
    r = fm.check_ticker("ZZ")
    assert any(i["kind"] == "reported_forward_overlap" for i in r["issues"])


def test_label_period_end_inconsistent_detected(monkeypatch):
    # A relabeling regression: label says Q2 but period_end is a Q3 end.
    fm = _mod()
    monkeypatch.setattr(fm, "get_earnings_table", lambda s, now=None: _payload(
        quarterly=[_rep("2026 Q1"), _fwd("2026 Q2", "2026-09-30")],
    ))
    r = fm.check_ticker("ZZ")
    assert any(i["kind"] == "label_period_mismatch" for i in r["issues"])


def test_dup_reported_quarter_detected(monkeypatch):
    fm = _mod()
    monkeypatch.setattr(fm, "get_earnings_table", lambda s, now=None: _payload(
        quarterly=[_rep("2025 Q2"), _rep("2025 Q2")],
    ))
    r = fm.check_ticker("ZZ")
    assert any(i["kind"] == "dup_quarter" for i in r["issues"])


def test_forward_only_contiguous_ok(monkeypatch):
    # No reported tail (fresh IPO) — internal forward contiguity still OK.
    fm = _mod()
    monkeypatch.setattr(fm, "get_earnings_table", lambda s, now=None: _payload(
        quarterly=[_fwd("2026 Q2", "2026-06-30"), _fwd("2026 Q3", "2026-09-30")],
    ))
    r = fm.check_ticker("ZZ")
    assert r["ok"] is True


def test_check_ticker_nan(monkeypatch):
    fm = _mod()
    monkeypatch.setattr(fm, "get_earnings_table", lambda s, now=None: _payload(
        annual=[{"year": 2025, "eps": float("nan"), "sales": 1e9}],
    ))
    assert any(i["kind"] == "nan" for i in fm.check_ticker("ZZ")["issues"])


def test_check_ticker_exception(monkeypatch):
    fm = _mod()

    def boom(s, now=None):
        raise RuntimeError("kaboom")

    monkeypatch.setattr(fm, "get_earnings_table", boom)
    r = fm.check_ticker("ZZ")
    assert r["ok"] is False and r["issues"][0]["kind"] == "exception"


def test_blank_sales_not_flagged_but_counted(monkeypatch):
    fm = _mod()
    monkeypatch.setattr(fm, "get_earnings_table", lambda s, now=None: _payload(
        annual=[{"year": 2026, "eps": -0.5, "sales": None}],
    ))
    r = fm.check_ticker("ZZ")
    assert r["ok"] is True and r["blank_sales"] == 1


# ── self-heal ─────────────────────────────────────────────────────────────────
def test_heal_uses_exact_delete_for_earnings_table(monkeypatch):
    # The earnings_table:: key has no trailing separator, so healing 'A' must NOT
    # prefix-wipe AAPL/AMZN — use exact-key invalidate. mb_year_earnings_ IS
    # separator-anchored so delete_prefix is safe there.
    fm = _mod()
    invalidated, prefixed = [], []
    monkeypatch.setattr(fm.cache, "invalidate", lambda k: invalidated.append(k))
    monkeypatch.setattr(fm.cache, "delete_prefix", lambda p: prefixed.append(p) or 0)
    monkeypatch.setattr(fm, "get_earnings_table", lambda s, now=None: _payload())
    r = fm._heal("a")
    assert r["ok"] is True
    assert invalidated == ["earnings_table::A"]           # exact, not prefix
    assert prefixed == ["mb_year_earnings_A_"]            # anchored prefix ok


# ── cycle + alert-on-change ───────────────────────────────────────────────────
def _bad_payload():
    return _payload(quarterly=[_fwd("2026 Q3", "2026-09-30")],
                    annual=[])  # forward with no reported → contiguity ok but…


def test_run_cycle_alerts_only_on_newly_flagged(monkeypatch):
    fm = _mod()
    monkeypatch.setattr(fm, "_sample_tickers", lambda n: ["BAD"])
    # persistent overlap failure
    monkeypatch.setattr(fm, "get_earnings_table", lambda s, now=None: _payload(
        quarterly=[_rep("2026 Q2"), _fwd("2026 Q2", "2026-06-30")]))
    monkeypatch.setattr(fm.cache, "invalidate", lambda k: None)
    monkeypatch.setattr(fm.cache, "delete_prefix", lambda p: 0)
    alerts = []
    monkeypatch.setattr(fm, "_alert", lambda newly: alerts.append([f["sym"] for f in newly]))
    out1 = fm.run_cycle()
    assert out1["flagged"] == 1
    assert alerts == [["BAD"]]                 # first detection alerts
    out2 = fm.run_cycle()
    assert out2["flagged"] == 1
    assert alerts == [["BAD"]]                 # same persistent flag → NO new alert


def test_run_cycle_no_alert_when_heal_clears(monkeypatch):
    fm = _mod()
    monkeypatch.setattr(fm, "_sample_tickers", lambda n: ["TRAN"])
    calls = {"n": 0}

    def flaky(s, now=None):
        calls["n"] += 1
        if calls["n"] == 1:
            return _payload(quarterly=[_rep("2026 Q2"), _fwd("2026 Q2", "2026-06-30")])
        return _payload()

    monkeypatch.setattr(fm, "get_earnings_table", flaky)
    monkeypatch.setattr(fm.cache, "invalidate", lambda k: None)
    monkeypatch.setattr(fm.cache, "delete_prefix", lambda p: 0)
    alerts = []
    monkeypatch.setattr(fm, "_alert", lambda newly: alerts.append(newly))
    out = fm.run_cycle()
    assert out["flagged"] == 0 and out["healed"] == 1
    assert alerts == []


def test_get_state_shape():
    fm = _mod()
    st = fm.get_state()
    for k in ("enabled", "cycles_completed", "checked_total", "healed_total",
              "flagged_current", "blank_sales_last_cycle", "last_cycle_at"):
        assert k in st


# ── warm-biased sampling ──────────────────────────────────────────────────────
def test_sample_prefers_warm_and_bounds_cold_tail(monkeypatch):
    fm = _mod()
    monkeypatch.setattr(fm, "_COLD_TAIL", 2)
    monkeypatch.setattr(fm.cache, "keys_with_prefix",
                        lambda p: ["earnings_table::WARMA", "earnings_table::WARMB", "earnings_table::WARMC"])
    monkeypatch.setattr(fm, "_load_universe", lambda: ["COLD1", "COLD2", "COLD3", "COLD4", "COLD5"])
    out = fm._sample_tickers(12)
    assert len(out) == len(set(out))                       # deduped
    assert all(s == s.upper() for s in out)
    cold = [s for s in out if s.startswith("COLD")]
    assert len(cold) <= 2                                  # cold tail bounded
    warm = [s for s in out if s.startswith("WARM")]
    assert warm                                            # warm cache entries included
