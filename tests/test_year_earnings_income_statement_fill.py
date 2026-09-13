"""FMP's quarterly income statement as the third gap-fill for reported quarters.

`/stable/earnings` is the only earnings endpoint this plan has, and for a slice
of US operating companies it stops returning rows for reports that happened —
MMC's stops at 2026-01-29 with two quarters reported since. Finnhub is empty for
those names and Yahoo's record is shorter still, so the widget showed 2025 Q4 as
MMC's latest quarter.

`/stable/income-statement?period=quarter` — the SAME vendor, the same key, a
different endpoint — carries them. Measured 2026-09-12 against the 15 stale
names, using the pipeline's own fiscal mappers:

    MMC   earnings newest 2025 Q4  ->  income-stmt 2026 Q2   (+2 quarters)
    BK    earnings newest 2026 Q1  ->  income-stmt 2026 Q2   (+1)
    SJW   earnings newest 2025 Q4  ->  income-stmt 2026 Q2   (+2)
    RNP   earnings newest 2025 Q4  ->  income-stmt 2026 Q2   (+2)

Four of fifteen, including the two largest ($90B and $97B). The other eleven are
cases where FMP's whole record stops, not one endpoint, and those still need the
provider escalation.
"""
import importlib


def _mod(monkeypatch):
    import api.services.earnings_estimates as ee
    importlib.reload(ee)
    monkeypatch.setattr(ee.cache, "get", lambda k: None)
    monkeypatch.setattr(ee.cache, "set", lambda k, v, ttl=None, **kw: None)
    # Silence the other legs unless a test wires them.
    monkeypatch.setattr(ee, "_year_earnings_from_fmp", lambda p, y: [])
    monkeypatch.setattr(ee, "_year_earnings_from_stock", lambda p, y: [])
    monkeypatch.setattr(ee, "_year_earnings_from_yf", lambda p, y: [])
    return ee


def _is_row(date, revenue=6.0e9, eps=2.5, **extra):
    row = {"date": date, "revenue": revenue, "eps": eps, "netIncome": 1.0e9}
    row.update(extra)
    return row


def _wire_income(monkeypatch, ee, rows):
    monkeypatch.setattr(ee, "_fmp_get",
                        lambda path, params, timeout=10:
                        list(rows) if "income-statement" in path else None)


# ── it reads the endpoint and produces usable actuals ────────────────────────
def test_the_income_statement_leg_recovers_a_quarter(monkeypatch):
    ee = _mod(monkeypatch)
    # MMC's real shape: the quarter ending 2026-06-30 that /stable/earnings lost.
    _wire_income(monkeypatch, ee, [_is_row("2026-06-30", revenue=7.404e9, eps=2.63)])
    rows = ee._year_earnings_from_fmp_income("MMC", 2026)
    assert len(rows) == 1
    r = rows[0]
    assert (r["quarter"], r["year"]) == (2, 2026)
    assert r["eps_actual"] == 2.63
    assert r["revenue_actual"] == 7.404e9


def test_it_carries_no_estimates_so_surprise_stays_blank(monkeypatch):
    # An income statement is an actual. Inventing an estimate here would
    # manufacture a surprise % the member would read as analyst consensus.
    ee = _mod(monkeypatch)
    _wire_income(monkeypatch, ee, [_is_row("2026-06-30")])
    r = ee._year_earnings_from_fmp_income("MMC", 2026)[0]
    assert r["eps_estimate"] is None
    assert r["revenue_estimate"] is None
    assert r["eps_surprise_pct"] is None
    assert r["revenue_surprise_pct"] is None


def test_it_keeps_only_the_requested_fiscal_year(monkeypatch):
    ee = _mod(monkeypatch)
    _wire_income(monkeypatch, ee, [_is_row("2026-06-30"), _is_row("2025-06-30")])
    rows = ee._year_earnings_from_fmp_income("MMC", 2026)
    assert [(r["quarter"], r["year"]) for r in rows] == [(2, 2026)]


def test_a_row_with_no_revenue_and_no_eps_is_dropped(monkeypatch):
    ee = _mod(monkeypatch)
    _wire_income(monkeypatch, ee, [_is_row("2026-06-30", revenue=None, eps=None)])
    assert ee._year_earnings_from_fmp_income("MMC", 2026) == []


# ── the labelling invariant this pipeline already enforces ────────────────────
def test_the_label_comes_from_the_period_end_not_fmps_own_period_field(monkeypatch):
    """HOLX ends its fiscal Q1 in late December. FMP's own `period`/`fiscalYear`
    say Q1/2026; the shared period-end mapper says 2025 Q4, and that is what the
    rest of this pipeline calls that quarter.

    ⛔ Trusting the provider's fiscal numbering is the exact trap the Finnhub
    gap-fill documents in-file: for an offset-fiscal filer it slots the same
    physical quarter under a different Q, so the gap-fill duplicates one quarter
    and drops another. One numbering, derived from the period end, for every
    source.
    """
    ee = _mod(monkeypatch)
    _wire_income(monkeypatch, ee,
                 [_is_row("2025-12-27", period="Q1", fiscalYear=2026, eps=0.80)])
    rows = ee._year_earnings_from_fmp_income("HOLX", 2025)
    assert [(r["quarter"], r["year"]) for r in rows] == [(4, 2025)]
    assert ee._year_earnings_from_fmp_income("HOLX", 2026) == []


# ── wiring: it fills a hole without overwriting a richer row ──────────────────
def test_get_year_earnings_uses_it_when_the_first_two_legs_are_short(monkeypatch):
    ee = _mod(monkeypatch)
    _wire_income(monkeypatch, ee, [_is_row("2026-06-30", eps=2.63)])
    rows = ee.get_year_earnings("MMC", 2026)
    got = {r["quarter"]: r for r in rows if r.get("eps_actual") is not None}
    assert 2 in got and got[2]["eps_actual"] == 2.63


def test_it_never_overwrites_a_quarter_the_earnings_endpoint_already_had(monkeypatch):
    # /stable/earnings rows carry estimates and a real surprise %; the income
    # statement has neither, so letting it win would DEGRADE a complete quarter.
    ee = _mod(monkeypatch)
    monkeypatch.setattr(ee, "_year_earnings_from_fmp", lambda p, y: [{
        "date": "2026-07-17", "quarter": 2, "year": 2026,
        "eps_actual": 2.63, "eps_estimate": 2.55, "eps_surprise_pct": 3.1,
        "revenue_actual": 7.404e9, "revenue_estimate": 7.3e9, "revenue_surprise_pct": 1.4,
    }])
    _wire_income(monkeypatch, ee, [_is_row("2026-06-30", eps=9.99)])
    rows = ee.get_year_earnings("MMC", 2026)
    q2 = [r for r in rows if r["quarter"] == 2][0]
    assert q2["eps_actual"] == 2.63, "the income-statement row clobbered a richer one"
    assert q2["eps_surprise_pct"] == 3.1


def test_a_complete_year_never_reaches_the_income_statement_endpoint(monkeypatch):
    ee = _mod(monkeypatch)
    calls = []
    monkeypatch.setattr(ee, "_year_earnings_from_fmp", lambda p, y: [
        {"date": f"{y}-0{q}-15", "quarter": q, "year": y, "eps_actual": 1.0,
         "eps_estimate": None, "eps_surprise_pct": None, "revenue_actual": 1.0,
         "revenue_estimate": None, "revenue_surprise_pct": None} for q in (1, 2, 3, 4)])

    def _spy(t, y):
        calls.append((t, y))
        return []

    monkeypatch.setattr(ee, "_year_earnings_from_fmp_income", _spy)
    ee.get_year_earnings("AAPL", 2026)
    assert calls == [], "spent a provider call on an already-complete year"


def test_it_runs_before_yfinance(monkeypatch):
    """Order matters: this is the same vendor and plan as the primary leg and it
    carries revenue, where Yahoo is a third party with a shorter record. If
    yfinance filled the quarter first, the better source would never be asked."""
    ee = _mod(monkeypatch)
    order = []
    monkeypatch.setattr(ee, "_year_earnings_from_fmp_income",
                        lambda t, y: (order.append("income"), [])[1])
    monkeypatch.setattr(ee, "_year_earnings_from_yf",
                        lambda t, y: (order.append("yf"), [])[1])
    ee.get_year_earnings("MMC", 2026)
    assert order == ["income", "yf"], f"leg order is {order}"
