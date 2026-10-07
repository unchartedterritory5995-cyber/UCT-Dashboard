"""2026-10-02 final adjudication pass: the systemic rules that resolved the split-multiple and historical >= 10x cohorts.
Every rule is general (no symbol is named in code); the cases in the docstrings are the measured motivating examples."""
import sqlite3
from datetime import date, datetime, timedelta, timezone
from types import SimpleNamespace

from api.services.fundamentals_pit.splits import Ledger, Split
from api.services.marketcap import reasons as R
from api.services.marketcap.build import (ads_after_form_switch, clean_factor, issuer_states_split, ledger_split_verdict,
                                          merge_evidence_splits, price_only_verdict, price_splice_before,
                                          unapplied_post_state_splits)
from api.services.marketcap.state import Obs, validate


def pub(d, hh=14):
    return datetime(d.year, d.month, d.day, hh, 0, tzinfo=timezone.utc)


def ob(as_of, filed, v, src=R.COVER_XBRL, form="10-Q", accn=None):
    return Obs(as_of, pub(filed), v, src, accn or f"{as_of}-{src}-{filed}", form, "dei:EntityCommonStockSharesOutstanding")


def by_asof(ch):
    return {c.obs.as_of: c for c in ch}


# ── split basis of a single count ───────────────────────────────────────────────────────────────────────
def test_anticipatory_post_split_count_dated_before_the_split_is_not_transformed_again():
    """FFIN 2011 3-for-2 (ex 06-01): the 10-Q cover dated 04-29 already says 31.44M = 20.96M x 1.500."""
    led = Ledger([Split(date(2011, 6, 1), 1.5)])
    ch = by_asof(validate([ob(date(2011, 2, 15), date(2011, 2, 25), 20_960_000),
                           ob(date(2011, 4, 29), date(2011, 5, 5), 31_440_000)], led))
    a = ch[date(2011, 4, 29)]
    assert a.basis == "POST_SPLIT" and a.status == R.ACCEPTED_RESTATED_BASIS
    assert abs(a.normalized - 31_440_000) < 1                       # NOT 47.16M
    assert abs(ch[date(2011, 2, 15)].normalized - 31_440_000) < 1   # the true pre-split count, transformed


def test_anticipatory_rule_also_covers_reverse_splits_and_ignores_ordinary_moves():
    led = Ledger([Split(date(2026, 4, 30), 1 / 35)])
    ch = by_asof(validate([ob(date(2026, 1, 15), date(2026, 2, 1), 140_000_000),
                           ob(date(2026, 4, 20), date(2026, 4, 24), 4_000_000)], led))
    assert ch[date(2026, 4, 20)].basis == "POST_SPLIT" and abs(ch[date(2026, 4, 20)].normalized - 4_000_000) < 1
    # an ordinary 10% issuance next to the same split is NOT reinterpreted
    ch2 = by_asof(validate([ob(date(2026, 1, 15), date(2026, 2, 1), 140_000_000),
                            ob(date(2026, 4, 20), date(2026, 4, 24), 154_000_000)], led))
    assert ch2[date(2026, 4, 20)].basis == "AS_OF"


def test_stale_pre_split_count_after_a_forward_split_is_refused_without_blocking():
    """SHOO 2011: after the 3-for-2 the 06-30 balance sheet says 42.81M; the 08-04 cover repeats the pre-split 27.67M."""
    led = Ledger([Split(date(2011, 6, 1), 1.5)])
    ch = by_asof(validate([ob(date(2011, 5, 3), date(2011, 5, 9), 28_210_771),
                           ob(date(2011, 6, 30), date(2011, 8, 9), 42_814_000, src=R.BALANCE_SHEET_XBRL, accn="q2"),
                           ob(date(2011, 8, 4), date(2011, 8, 9), 27_673_699, accn="q2")], led))
    st = ch[date(2011, 8, 4)]
    assert st.status == R.REJ_STALE_SPLIT_BASIS and st.block is None
    assert ch[date(2011, 6, 30)].usable


def test_price_only_factor_never_triggers_a_basis_shift():
    """EQT 2018 Equitrans distribution (ledger x1.837): the count is unchanged; it is not 'stale'."""
    led = Ledger([Split(date(2018, 11, 13), 1.837)])
    ch = by_asof(validate([ob(date(2018, 9, 30), date(2018, 10, 25), 254_426_000),
                           ob(date(2019, 1, 31), date(2019, 2, 14), 254_762_000)], led))
    assert ch[date(2019, 1, 31)].usable and ch[date(2019, 1, 31)].basis == "AS_OF"


def test_clean_factor():
    assert all(clean_factor(r) for r in (2, 0.5, 1.5, 2.5, 2.25, 1 / 35, 25, 0.0125))
    assert not any(clean_factor(r) for r in (2.376, 2.798, 1.837, 2.044, 0.3775, 0.32))


# ── does a ledger split apply? ─────────────────────────────────────────────────────────────────────────
def S(d, r):
    return Split(d, r)


def raw(as_of, v, filed=None):
    return ob(as_of, filed or as_of + timedelta(days=10), v)


def test_ledger_split_confirmed_by_a_pre_split_basis_count():
    """INTC 1999 2-for-1: 1,667M (1998-09) ... 3,324.7M anticipatory (1999-02) ... 3,318M after."""
    s = S(date(1999, 4, 12), 2.0)
    obs = [raw(date(1998, 9, 26), 1_667e6), raw(date(1999, 2, 26), 3_324.7e6), raw(date(1999, 6, 26), 3_318e6)]
    assert ledger_split_verdict(s, obs) == "CONFIRMED"


def test_ledger_split_confirmed_by_a_post_split_basis_count_after_a_stale_repeat():
    """CGNX 2017 2-for-1: 86.6M before, a stale 85.9M repeated after, then 172M."""
    s = S(date(2017, 12, 4), 2.0)
    obs = [raw(date(2017, 10, 27), 86.6e6), raw(date(2017, 12, 31), 85.94e6), raw(date(2018, 4, 27), 172.3e6)]
    assert ledger_split_verdict(s, obs) == "CONFIRMED"


def test_ledger_split_contradicted_only_by_contemporaneous_counts():
    """INVA 2013: 99.45M (04-25) -> 100.77M (06-30) against a 1:100 ledger entry: contradicted."""
    s = S(date(2013, 6, 17), 0.01)
    assert ledger_split_verdict(s, [raw(date(2013, 4, 25), 99.45e6), raw(date(2013, 6, 30), 100.77e6)]) == "CONTRADICTED"


def test_ledger_split_unresolved_when_the_counts_are_far_apart():
    """JAGX 2026 1-for-35: 3.71M 211 days before, 4.91M 71 days after -- hyper-dilution may offset a reverse split."""
    s = S(date(2026, 4, 30), 1 / 35)
    assert ledger_split_verdict(s, [raw(date(2025, 10, 1), 3_707_121), raw(date(2026, 7, 10), 4_910_402)]) == "UNRESOLVED"


def test_identical_counts_on_both_sides_contradict_a_split():
    """CBAT 2014: 12,619,597 unchanged for a year across a 1:100 ledger entry."""
    s = S(date(2014, 12, 19), 0.01)
    obs = [raw(date(2013, 12, 31), 12_619_597), raw(date(2014, 12, 31), 12_619_597), raw(date(2015, 6, 30), 12_619_597)]
    assert ledger_split_verdict(s, obs) == "CONTRADICTED"


def test_issuer_statement_confirms_a_split_up_to_a_quarter_after_the_ex_date():
    db = sqlite3.connect(":memory:")
    db.execute("CREATE TABLE split_evidence(cik INTEGER, ex_date TEXT, ratio REAL, source TEXT, accn TEXT, snippet TEXT)")
    db.execute("INSERT INTO split_evidence VALUES(1, '2026-06-30', 0.0285, 'XBRL:StockholdersEquityNoteStockSplitConversionRatio1', 'a', '')")
    D = SimpleNamespace(splitev=db)
    assert issuer_states_split(D, 1, S(date(2026, 4, 30), 1 / 35))
    assert not issuer_states_split(D, 1, S(date(2026, 1, 30), 1 / 35))      # 151 days: another event
    assert not issuer_states_split(D, 1, S(date(2026, 4, 30), 1 / 25))      # another ratio


def test_price_only_factor_applies_when_the_bars_carry_it():
    days = [date(2015, 7, 16), date(2015, 7, 17), date(2015, 7, 20), date(2015, 7, 21)]
    carried = {days[0]: 26.7, days[1]: 27.9, days[2]: 28.57, days[3]: 28.6}       # EBAY 2015 x2.376: continuous
    not_carried = {days[0]: 66.0, days[1]: 66.3, days[2]: 28.57, days[3]: 28.6}    # the raw drop is visible
    s = S(date(2015, 7, 20), 2.376)
    assert price_only_verdict(s, days, carried) == "CONFIRMED"
    assert price_only_verdict(s, days, not_carried) == "CONTRADICTED"


def test_price_only_factor_is_not_carried_past_a_bar_splice():
    """WY: the bars step 61.84 -> 24.08 on 2003-09-10 with no corporate action; the 2010 x2.443 factor is carried
    only back to it."""
    days = [date(2003, 9, 9), date(2003, 9, 10), date(2008, 1, 2), date(2010, 7, 19), date(2010, 7, 20)]
    closes = {days[0]: 61.84, days[1]: 24.08, days[2]: 30.0, days[3]: 16.6, days[4]: 15.9}
    assert price_splice_before(S(date(2010, 7, 20), 2.4434), days, closes) == date(2003, 9, 10)


# ── evidence splits, ADS status, post-state statements ───────────────────────────────────────────────────
def test_evidence_split_replaces_the_same_ledger_split_instead_of_adding_it():
    """OTEX 2014 2-for-1: issuer XBRL 2014-01-23, ledger 2014-02-19 -- one event, applied once, at the evidence date."""
    out = merge_evidence_splits([S(date(2014, 2, 19), 2.0), S(date(2006, 10, 10), 2.0)], [S(date(2014, 1, 23), 2.0)])
    assert sorted(s.ex_date for s in out) == [date(2006, 10, 10), date(2014, 1, 23)]
    assert Ledger(out).factor_after(date(2013, 1, 1)) == 2.0


def test_ads_title_before_a_foreign_to_domestic_form_switch_does_not_speak_after_it():
    """RCEL: ADS of 20 ordinary shares (2019 20-F title); 10-K/10-Q from 2020-08; a 2026 title says common stock."""
    forms = [(date(2019, 11, 19), "20-F"), (date(2020, 8, 28), "10-K"), (date(2020, 11, 11), "10-Q")]
    titled = {date(2019, 11, 19): True, date(2026, 8, 7): False}
    t2, unresolved = ads_after_form_switch(forms, titled, True)
    assert unresolved is None and t2[date(2020, 8, 28)] is False
    t3, unresolved = ads_after_form_switch(forms, {date(2019, 11, 19): True}, True)
    assert unresolved == date(2020, 8, 28)                      # nothing after the switch: withheld from it
    t4, unresolved = ads_after_form_switch(forms, {date(2019, 11, 19): True, date(2023, 3, 1): True}, True)
    assert unresolved is None and t4[date(2020, 8, 28)] is True  # still an ADS after the switch (MREO-type)


def test_issuer_split_after_the_last_state_withholds_earlier_days_unless_it_is_a_known_split():
    known = [S(date(2023, 5, 23), 1 / 30), S(date(2026, 4, 30), 1 / 35)]
    rows = [("2026-01-20", 0.0167), ("2026-08-21", 0.2), ("2025-06-30", 0.028), ("2026-06-30", 0.0285), ("2026-05-01", 1.1)]
    out = unapplied_post_state_splits(rows, "2024-12-31", known, date(2026, 9, 29))
    assert out == [(date(2026, 1, 20), 0.0167), (date(2026, 8, 21), 0.2)]
    assert unapplied_post_state_splits(rows, "2026-09-01", known, date(2026, 9, 29)) == []


def test_count_is_not_carried_across_a_trading_break():
    """LEA: delisted 2009-07-01 in Chapter 11; the reorganized common began trading 2009-11-20. The cancelled
    pre-petition count may not value it; the first count dated after the break releases it."""
    from api.services.marketcap.state import timeline
    led = Ledger([])
    ev = [(date(2009, 11, 20), R.RELISTING_RECOUNT)]
    ch = validate([ob(date(2008, 11, 30), date(2008, 12, 24), 77_356_120)], led)
    tl = timeline(ch, [date(2009, 6, 30), date(2009, 11, 20), date(2010, 3, 1)], events=ev)
    assert tl[0].value == 77_356_120 and tl[1].reason == tl[2].reason == R.RELISTING_RECOUNT
    ch2 = ch + validate([ob(date(2010, 2, 1), date(2010, 2, 20), 34_500_000)], led)
    tl2 = timeline(ch2, [date(2010, 3, 1)], events=ev)
    assert tl2[0].value == 34_500_000


# ── ticker history ───────────────────────────────────────────────────────────────────────────────────────
def _days(*ranges):
    out = []
    for a, b in ranges:
        d = a
        while d <= b:
            if d.weekday() < 5:
                out.append(d)
            d += timedelta(days=1)
    return out


def test_bars_of_a_symbol_the_issuer_did_not_hold_are_another_issuers():
    """Cencora: ABC from 2003 to 2023-08-30, COR after; the COR bars before (CoreSite to 2021-12) are not Cencora's."""
    from api.services.marketcap.identity import Ref, decide, foreign_ticker_end
    days = _days((date(2010, 9, 23), date(2021, 12, 28)), (date(2023, 8, 30), date(2026, 9, 29)))
    ev = [(date(2003, 9, 10), "ticker_change", "ABC"), (date(2023, 8, 30), "ticker_change", "COR")]
    assert foreign_ticker_end("COR", days, ev) == date(2023, 8, 30)
    dec = decide("COR", 1140859, days, Ref("COR", 1140859, date(1995, 4, 4), events=ev), date(1995, 1, 1))
    assert dec.listing.start == date(2023, 8, 30) and dec.pre_reason == R.TICKER_REUSE


def test_a_renamed_security_with_a_stitched_history_keeps_it():
    """META: FB until 2022-06-09; the META bars run through the change -- the provider's stitched history is Meta's."""
    from api.services.marketcap.identity import foreign_ticker_end
    days = _days((date(2012, 5, 18), date(2026, 9, 29)))
    ev = [(date(2012, 5, 18), "ticker_change", "FB"), (date(2022, 6, 9), "ticker_change", "META")]
    assert foreign_ticker_end("META", days, ev) is None


def test_a_return_to_the_original_symbol_keeps_the_issuers_own_early_bars():
    """Fiserv: FISV from 2003, FI from 2023-06-07, FISV again (the return is missing from the history)."""
    from api.services.marketcap.identity import foreign_ticker_end
    days = _days((date(2003, 9, 10), date(2023, 6, 6)), (date(2025, 11, 11), date(2026, 9, 29)))
    ev = [(date(2003, 9, 10), "ticker_change", "FISV"), (date(2023, 6, 7), "ticker_change", "FI")]
    assert foreign_ticker_end("FISV", days, ev) is None
