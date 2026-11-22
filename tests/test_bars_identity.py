"""api/services/bars_identity.py: another company's bars inside a served D/W/M series (2026-11-17).

Measured on production: daily META served Meta at $351.89 on 2021-06-29, the Roundhill Metaverse ETF at
~$15 from 2021-06-30 to 2022-01-28, then Meta again ($313.26 on 2022-01-31)."""
import datetime as dt

from api.services import bars_identity as BI


def day(d):
    return dt.date.fromisoformat(d)


def series(start, end, price):
    out, d = [], day(start)
    while d <= day(end):
        if d.weekday() < 5:
            out.append({"t": d.isoformat(), "o": price, "h": price, "l": price, "c": price, "v": 1})
        d += dt.timedelta(days=1)
    return out


def meta_served():
    return series("2021-06-01", "2021-06-29", 350.0) + series("2021-06-30", "2022-01-28", 15.0) + series("2022-01-31", "2022-03-31", 310.0)


def fb_store():   # Meta's own bars as FB, then (years later) a ProShares ETF under FB
    return series("2021-05-03", "2022-06-08", 350.0) + series("2025-06-26", "2026-11-17", 44.0)


def test_the_meta_window_is_replaced_by_metas_own_fb_bars():
    out = BI.apply("META", meta_served(), "D", lambda s, tf: fb_store() if s == "FB" else [])
    win = [b for b in out if "2021-06-30" <= b["t"] < "2022-01-31"]
    assert win and all(b["c"] == 350.0 for b in win)                       # Meta, not the ETF
    assert not any(b["t"] >= "2025" for b in out)                           # FB's ETF years never enter
    assert out[0]["t"] == "2021-06-01" and out[-1]["t"] == "2022-03-31"
    assert [b["t"] for b in out] == sorted(b["t"] for b in out) and len({b["t"] for b in out}) == len(out)


def test_a_source_on_another_basis_at_the_edge_is_refused_and_the_window_dropped():
    other = [dict(b, c=b["c"] * 2) for b in fb_store()]                   # a split between the two
    out = BI.apply("META", meta_served(), "D", lambda s, tf: other)
    assert not any("2021-06-30" <= b["t"] < "2022-01-31" for b in out)
    assert any(b["t"] == "2021-06-29" for b in out) and any(b["t"] == "2022-01-31" for b in out)


def test_a_source_that_agrees_only_far_from_the_window_proves_nothing():
    """FB's ProShares years share dates with today's META but are another company: only bars next to
    the window may prove the source."""
    served = meta_served() + series("2025-06-26", "2025-07-31", 44.0)      # a shared far date that agrees
    only_far = series("2021-06-30", "2022-01-28", 350.0) + series("2025-06-26", "2025-07-31", 44.0)
    out = BI.apply("META", served, "D", lambda s, tf: only_far)
    assert not any("2021-06-30" <= b["t"] < "2022-01-31" for b in out)    # no edge proof: dropped


def test_no_source_bars_or_a_failing_read_drops_the_window():
    def boom(s, tf):
        raise RuntimeError("store down")
    for read in (lambda s, tf: [], boom):
        out = BI.apply("META", meta_served(), "D", read)
        assert not any("2021-06-30" <= b["t"] < "2022-01-31" for b in out)
        assert len(out) == len(meta_served()) - len(series("2021-06-30", "2022-01-28", 15.0))


def test_a_prefix_window_drops_everything_before_until():
    served = series("2020-04-20", "2023-04-20", 60.0) + series("2023-04-21", "2023-06-30", 30.0)
    out = BI.apply("MSGE", served, "D", lambda s, tf: [])
    assert out[0]["t"] == "2023-04-21" and all(b["c"] == 30.0 for b in out)


def test_weekly_and_monthly_bars_covering_the_window_are_replaced_too():
    weekly = [{"t": "2021-06-25", "c": 350.0}, {"t": "2021-07-02", "c": 15.0}, {"t": "2022-01-28", "c": 15.0},
              {"t": "2022-02-04", "c": 310.0}]
    fb_w = [{"t": "2021-06-25", "c": 350.0}, {"t": "2021-07-02", "c": 352.0}, {"t": "2022-01-28", "c": 301.0},
            {"t": "2022-02-04", "c": 310.0}, {"t": "2025-07-04", "c": 44.0}]
    out = BI.apply("META", weekly, "W", lambda s, tf: fb_w)
    assert [(b["t"], b["c"]) for b in out] == [("2021-06-25", 350.0), ("2021-07-02", 352.0), ("2022-01-28", 301.0), ("2022-02-04", 310.0)]
    monthly = [{"t": "2021-05-01", "c": 320.0}, {"t": "2021-06-01", "c": 15.0}, {"t": "2021-12-01", "c": 15.0}, {"t": "2022-01-01", "c": 15.0}, {"t": "2022-02-01", "c": 210.0}]
    fb_m = [{"t": "2021-05-01", "c": 320.0}, {"t": "2021-06-01", "c": 347.7}, {"t": "2021-12-01", "c": 336.4}, {"t": "2022-01-01", "c": 313.3}, {"t": "2022-02-01", "c": 211.0}]
    out = BI.apply("META", monthly, "M", lambda s, tf: fb_m)
    assert [b["c"] for b in out] == [320.0, 347.7, 336.4, 313.3, 210.0]   # June..Jan from FB; Feb kept


def test_a_week_that_straddles_the_window_edge_counts_as_inside():
    """MSGE's window ends Friday 2023-04-21: that week's bar (keyed on the Friday) holds the old
    company's Monday-Thursday, so it goes with the window."""
    weekly = [{"t": "2023-04-14", "c": 60.0}, {"t": "2023-04-21", "c": 31.0}, {"t": "2023-04-28", "c": 30.0}]
    assert [b["t"] for b in BI.apply("MSGE", weekly, "W", lambda s, tf: [])] == ["2023-04-28"]


def test_other_symbols_and_intraday_are_untouched():
    bars = series("2021-06-01", "2021-07-30", 10.0)
    assert BI.apply("AAPL", bars, "D", lambda s, tf: []) is bars
    assert BI.apply("META", bars, "5", lambda s, tf: []) is bars


def test_gen_serves_only_its_own_company():
    """2026-11-18, production GEN daily against the company's own series (an independent vendor's
    GEN = Symantec, NortonLifeLock, Gen Digital): GenOn Energy and a $64-82 security 2010-12-06 ..
    2013-04-11, Genesis Healthcare 2015-02-03 .. 2021-03-25; everything else agrees to 2%."""
    t = BI._table()["symbols"]
    assert [(w["from"], w["until"], w["source"]) for w in t["GEN"]] == [
        (day("2010-12-06"), day("2013-04-12"), None), (day("2015-02-03"), day("2021-03-26"), None)]
    served = [{"t": d, "o": c, "h": c, "l": c, "c": c, "v": 1} for d, c in (
        ("2010-12-03", 17.09), ("2010-12-06", 3.72), ("2012-12-17", 63.94), ("2013-04-11", 70.0),
        ("2013-04-12", 22.1), ("2015-02-02", 24.94), ("2015-02-03", 8.76), ("2021-03-25", 0.42),
        ("2021-03-26", 21.61))]
    out = BI.apply("GEN", served, "D", lambda s, tf: [])
    assert [b["t"] for b in out] == ["2010-12-03", "2013-04-12", "2015-02-02", "2021-03-26"]


def test_the_second_vendor_census_windows():
    """2026-11-18, every universe daily series compared day by day with an independent vendor's
    per-company series: four tickers carried another company inside today's lineage with no gap
    (Barnes Group in B, Physicians Realty and others in DOC, Aris Water in ARIS, the Atlas Crest
    SPAC in ACIC). Each window is dropped; the bars on both sides agree with that vendor."""
    t = BI._table()["symbols"]
    assert [(w["from"], w["until"], w["source"]) for w in t["B"]] == [(day("2013-04-03"), day("2025-05-09"), None)]
    assert [(w["from"], w["until"]) for w in t["DOC"]] == [(day("2003-09-10"), day("2024-03-01"))]
    assert [(w["from"], w["until"]) for w in t["ARIS"]] == [(day("2021-10-22"), day("2025-10-15"))]
    assert [(w["from"], w["until"]) for w in t["ACIC"]] == [(day("2020-12-18"), day("2021-09-17"))]
    served = [{"t": d, "o": c, "h": c, "l": c, "c": c, "v": 1} for d, c in (
        ("2013-04-02", 28.08), ("2013-04-03", 27.89), ("2025-01-24", 47.48), ("2025-05-09", 19.46))]
    assert [b["t"] for b in BI.apply("B", served, "D", lambda s, tf: [])] == ["2013-04-02", "2025-05-09"]


def test_history_epoch_moves_only_a_corrected_date_series():
    v = BI._table()["version"]
    assert v >= 1
    assert BI.history_epoch("META", "D") == v * BI.EPOCH_STEP
    assert BI.history_epoch("meta", "M") == v * BI.EPOCH_STEP
    assert BI.history_epoch("META", "5") == 0 and BI.history_epoch("AAPL", "D") == 0


def test_the_table_names_the_measured_windows():
    t = BI._table()["symbols"]
    assert t["META"] == [{"from": day("2021-06-30"), "until": day("2022-01-31"), "source": "FB"}]
    assert t["CALY"][0]["source"] == "MODG"
    # 2026-11-18 census (every universe daily series as production served it): an earlier listing in
    # front of today's, behind the NEWEST listing break, which the chart's cutoff did not cut (it judged
    # only the largest gap). The windows carry the table epoch so a browser's older copy is replaced.
    census = {"ACT", "ADPT", "ALF", "AMR", "BOX", "CAI", "CRC", "FIG", "FRSH", "FSBC", "GIW", "MDA",
              "NINE", "PBA", "RVI", "SE", "SLS", "SOLS", "SUNC", "TLN", "VAL", "VIA"}
    assert {s for s, ws in t.items() if any(w["source"] is None and w["from"] is None for w in ws)} == \
        {"CCC", "MSGE", "STRC"} | census
    assert t["ADPT"] == [{"from": None, "until": day("2019-06-27"), "source": None}]


def test_the_serve_path_applies_it(monkeypatch):
    from api.services import bars_sanitize as S
    if not S._ENABLED:
        return
    monkeypatch.setattr(S, "_meta_cached", lambda t: None)
    monkeypatch.setattr(S, "_identity_source", lambda s, tf: fb_store() if s == "FB" else [])
    out = S.sanitize_daily_bars("META", meta_served(), "D")
    assert not any(b["c"] == 15.0 for b in out)


def test_the_contract_serves_the_epoch(monkeypatch):
    from api.services import bar_contract as C
    out = C.compute("META", "D", None, [], meta={"rev": 7, "history_rev": 5})
    assert out["history_rev"] == 5 + BI.history_epoch("META", "D")
    out = C.compute("AAPL", "D", None, [], meta={"rev": 7, "history_rev": 5})
    assert out["history_rev"] == 5
