"""Field-level annual merge: a blank EPS/Sales cell in a year FMP DOES cover must be
backfilled from the already-fetched yfinance income statement (the old year-level
merge left a null Sales showing '—' forever)."""
import datetime as dt
import api.services.annual_financials as af


def _now_2026():
    return dt.datetime(2026, 3, 1, tzinfo=af._ET).timestamp()


def test_blank_sales_backfilled_when_fmp_is_thin(monkeypatch):
    # FMP thin (yfinance already consulted for depth) but the year it DOES have is
    # missing Sales — the per-field fill must top it up, not leave it None.
    fmp = {2021: {"eps": 1.0, "sales": 1e9},
           2022: {"eps": 2.0, "sales": 2e9},
           2023: {"eps": 3.0, "sales": None}}
    yf = {2023: {"eps": 3.0, "sales": 3e9}, 2020: {"eps": 0.5, "sales": 5e8}}
    monkeypatch.setattr(af, "_annual_actuals_from_fmp", lambda t: {y: dict(v) for y, v in fmp.items()})
    monkeypatch.setattr(af, "_annual_actuals_from_yf", lambda t: {y: dict(v) for y, v in yf.items()})
    monkeypatch.setattr(af, "_forward_estimates", lambda t, now, lay: [])

    rows = af.get_annual_financials("XYZ", years_back=8, now=_now_2026())
    r2023 = next(r for r in rows if r["year"] == 2023)
    assert r2023["sales"] == 3e9   # backfilled from yfinance
    assert r2023["eps"] == 3.0


def test_blank_cell_gate_consults_yfinance_even_when_fmp_covers(monkeypatch):
    # FMP is deep+recent (fmp_covers=True) so the old code SKIPPED yfinance entirely —
    # but a covered year has a blank cell, so the gate must still consult yfinance.
    fmp = {2024: {"eps": 4.0, "sales": 4e9},
           2025: {"eps": 5.0, "sales": None}}
    yf = {2025: {"eps": 5.0, "sales": 9e9}}
    monkeypatch.setattr(af, "_annual_actuals_from_fmp", lambda t: {y: dict(v) for y, v in fmp.items()})
    monkeypatch.setattr(af, "_annual_actuals_from_yf", lambda t: {y: dict(v) for y, v in yf.items()})
    monkeypatch.setattr(af, "_forward_estimates", lambda t, now, lay: [])

    rows = af.get_annual_financials("XYZ", years_back=2, now=_now_2026())
    r2025 = next(r for r in rows if r["year"] == 2025)
    assert r2025["sales"] == 9e9   # gate fired despite fmp_covers, filled the blank


def test_fmp_value_not_overwritten_by_yfinance(monkeypatch):
    # yfinance must only FILL blanks, never clobber a present FMP number.
    fmp = {2024: {"eps": 4.0, "sales": 4e9},
           2025: {"eps": 5.0, "sales": None}}
    yf = {2024: {"eps": 99.0, "sales": 99e9}, 2025: {"eps": 5.0, "sales": 9e9}}
    monkeypatch.setattr(af, "_annual_actuals_from_fmp", lambda t: {y: dict(v) for y, v in fmp.items()})
    monkeypatch.setattr(af, "_annual_actuals_from_yf", lambda t: {y: dict(v) for y, v in yf.items()})
    monkeypatch.setattr(af, "_forward_estimates", lambda t, now, lay: [])

    rows = af.get_annual_financials("XYZ", years_back=2, now=_now_2026())
    r2024 = next(r for r in rows if r["year"] == 2024)
    assert r2024["eps"] == 4.0 and r2024["sales"] == 4e9   # untouched
