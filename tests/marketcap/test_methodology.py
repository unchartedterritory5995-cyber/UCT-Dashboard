"""Methodology rails required by the owner brief (validation section)."""
from datetime import date, datetime, timedelta, timezone

from api.services.fundamentals_pit.splits import Ledger, Split
from api.services.marketcap import cover, reasons as R, textcover as T
from api.services.marketcap.adr import RatioStatement, parse_ratio, ratio_at
from api.services.marketcap.state import Obs, timeline, validate


def pub(d, hh=14):
    return datetime(d.year, d.month, d.day, hh, 0, tzinfo=timezone.utc)


def ob(as_of, filed, v, src=R.COVER_XBRL, form="10-Q", accn=None):
    return Obs(as_of, pub(filed), v, src, accn or f"{as_of}-{src}-{filed}", form)


def test_no_lookahead_value_invisible_until_public():
    ch = validate([ob(date(2020, 3, 31), date(2020, 5, 1), 100e6), ob(date(2020, 6, 30), date(2020, 8, 1), 120e6)], Ledger())
    tl = timeline(ch, [date(2020, 7, 31), date(2020, 8, 3)])
    assert tl[0].value == 100e6 and tl[1].value == 120e6


def test_annual_filer_carries_to_the_owner_approved_ceiling_then_stale_until_superseded():
    # 20-F issuer filing 110 days after year end: the year-end count is 475 days old when the next 20-F lands.
    # The owner-approved 456-day ceiling (unchanged) therefore leaves a STALE window; bound_study measures it.
    obs = [ob(date(2019, 12, 31), date(2020, 4, 20), 1e9, form="20-F"), ob(date(2020, 12, 31), date(2021, 4, 20), 1.01e9, form="20-F")]
    tl = timeline(validate(obs, Ledger()), [date(2020, 11, 2), date(2021, 3, 31), date(2021, 4, 19), date(2021, 4, 20)])
    assert [t.value for t in tl] == [1e9, 1e9, None, 1.01e9]
    assert tl[2].reason == R.STALE


def test_annual_filer_stale_only_past_bound():
    obs = [ob(date(2019, 12, 31), date(2020, 4, 20), 1e9, form="20-F")]
    tl = timeline(validate(obs, Ledger()), [date(2021, 3, 31), date(2021, 4, 1)])
    assert tl[0].value == 1e9 and tl[1].reason == R.STALE          # 456 vs 457 days


def test_reverse_split_normalized_no_discontinuity():
    led = Ledger([Split(date(2021, 8, 2), 1 / 8)])                  # GE 1-for-8
    obs = [ob(date(2021, 7, 20), date(2021, 7, 27), 8.78e9), ob(date(2021, 10, 20), date(2021, 10, 26), 1.098e9)]
    tl = timeline(validate(obs, led), [date(2021, 7, 30), date(2021, 8, 2), date(2021, 10, 27)])
    assert abs(tl[0].value - 8.78e9 / 8) < 1 and tl[0].value == tl[1].value
    assert abs(tl[2].value / tl[1].value - 1) < 0.01


def test_issuance_and_buyback_accepted_and_flagged_when_large():
    obs = [ob(date(2020, 1, 1), date(2020, 1, 10), 100e6), ob(date(2020, 4, 1), date(2020, 4, 10), 400e6),   # 4x issuance
           ob(date(2020, 7, 1), date(2020, 7, 10), 410e6), ob(date(2020, 10, 1), date(2020, 10, 10), 380e6)]  # buyback
    ch = {c.obs.as_of: c for c in validate(obs, Ledger())}
    assert ch[date(2020, 4, 1)].usable and R.FLAG_LARGE_CHANGE in ch[date(2020, 4, 1)].flags
    assert ch[date(2020, 10, 1)].usable and not ch[date(2020, 10, 1)].flags


def test_isolated_bad_value_quarantined_not_used():
    obs = [ob(date(2020, 1, 1), date(2020, 1, 10), 100e6), ob(date(2020, 4, 1), date(2020, 4, 10), 1000e6),
           ob(date(2020, 7, 1), date(2020, 7, 10), 101e6)]
    ch = validate(obs, Ledger())
    tl = timeline(ch, [date(2020, 4, 13)])
    assert tl[0].value == 100e6


def test_issued_not_outstanding_refused_by_text_parser():
    t = ("Common stock, par value $0.01; 750,000,000 shares authorized; shares issued: 401,456,171 on March 27, 2005. "
         "Indicate the number of shares outstanding of the registrant's common stock, as of May 2, 2005: 394,944,096.")
    r = T.parse(T.normalize(t), date(2005, 5, 6), "10-Q")
    assert r.status == "OK" and r.hits[0].count == 394944096


def test_20f_close_of_period_statement_uses_report_date():
    t = ("Indicate the number of outstanding shares of each of the issuer's classes of capital or common stock as of the "
         "close of the period covered by the annual report: 25,932,070,992 common shares.")
    r = T.parse(T.normalize(t), date(2024, 4, 16), "20-F", report_date=date(2023, 12, 31))
    assert r.status == "OK" and r.hits[0].as_of == date(2023, 12, 31)


def test_40f_and_20f_rendered_cover_parse():
    html = ('<table class="report"><tr><th class="tl" rowspan="2"><div><strong>Cover - shares</strong></div></th>'
            '<th class="th">12 Months Ended</th></tr><tr><th class="th"><div>Dec. 31, 2023</div><div>shares</div></th></tr>'
            '<tr class="ro"><td class="pl"><a onclick="Show.showAR( this, \'defref_dei_DocumentType\', window );">Document Type</a></td>'
            '<td class="text">40-F</td></tr>'
            '<tr class="ro"><td class="pl"><a onclick="Show.showAR( this, \'defref_dei_EntityCommonStockSharesOutstanding\', window );">x</a></td>'
            '<td class="nump">1,287,000,000</td></tr></table>')
    c = cover.parse(html)
    rows = cover.classes(c)
    assert rows[0].shares == [(date(2023, 12, 31), 1.287e9)]


def test_ads_ratio_parse_and_time_awareness():
    assert parse_ratio("American Depositary Shares, each representing 5 common shares")[:2] == (5.0, "OK")
    assert parse_ratio("ADSs, each representing one-fifth of one ordinary share")[:2] == (0.2, "OK")
    led = Ledger([Split(date(2020, 6, 1), 0.5)])                     # a ratio change (1 ADS = 2 -> 4 ords) on 2020-06-01
    s1 = RatioStatement(date(2019, 4, 1), 2.0, "a1", "")
    s2 = RatioStatement(date(2021, 4, 1), 4.0, "a2", "")
    assert ratio_at(date(2019, 12, 31), [s1, s2], led).ords_per_ads == 2.0
    assert ratio_at(date(2020, 12, 31), [s1, s2], led).ords_per_ads == 4.0
    assert ratio_at(date(2019, 12, 31), [s2], led) is None          # no statement valid across the change -> refuse


def test_ads_equivalent_units_consistent_across_ratio_change():
    # N ordinaries at as-of a, ADS ratio R(a); ADS ledger factor F(a); market cap = N*F/R * adjusted close
    N, R1, R2 = 1000.0, 2.0, 4.0
    s = R1 / R2                                                     # ADS split ratio when 1 ADS goes 2 -> 4 ords
    led = Ledger([Split(date(2020, 6, 1), s)])
    px_before_actual, px_after_actual = 20.0, 40.0                  # ADS price doubles mechanically
    adj = lambda d, p: p / led.factor_after(d)                      # bars: adjusted to today's ADS basis
    cap = lambda d, R, p: N * led.factor_after(date(2019, 12, 31)) / R * adj(d, p)
    assert abs(cap(date(2020, 5, 29), R1, px_before_actual) - N / R1 * px_before_actual) < 1e-9
    assert abs(cap(date(2020, 6, 1), R1, px_after_actual) - N / R2 * px_after_actual) < 1e-9
