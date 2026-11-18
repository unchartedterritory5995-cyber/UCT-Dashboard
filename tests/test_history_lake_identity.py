"""tools/history_lake/identity.py: reused tickers are cut, renamed companies stitched (2026-11-17).

The fixtures are the vendor's real records for the cases the audit named (META / FB / Roundhill's
METV), plus Agilent's noisy record, which must change nothing."""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools" / "history_lake"))
import identity as I  # noqa: E402

META = {"ticker": "META", "status": "ok", "cik": "0001326801", "composite_figi": "BBG000MM2P62",
        "events": [{"date": "2022-06-09", "ticker": "META"}, {"date": "2012-05-18", "ticker": "FB"}]}
FB = {"ticker": "FB", "status": "ok", "cik": "0001174610", "composite_figi": "BBG01VRMNFB1",
      "events": [{"date": "2025-06-26", "ticker": "FB"}]}
METV = {"ticker": "METV", "status": "ok", "cik": "0001776878", "composite_figi": "BBG011J1MN62",
        "events": [{"date": "2022-01-31", "ticker": "METV"}, {"date": "2021-06-30", "ticker": "META"}]}
AGILENT = {"ticker": "A", "status": "ok", "cik": "0001090872", "composite_figi": "BBG000C2V3D6",
           "events": [{"date": "2005-11-23", "ticker": "AWD"}, {"date": "2003-09-10", "ticker": "A"}]}
RECORDS = [META, FB, METV, AGILENT]
DAY = 86400


def e(first_day, last_day, bars=10, crc=1, off=0):
    return {"bars": bars, "bytes": 100, "crc": crc, "first": I.et_midnight(first_day) + 9 * 3600,
            "last": I.et_midnight(last_day) + 16 * 3600, "off": off}


def lake():
    return {
        "META": {"v": 1, "symbol": "META", "splits": [["2021-09-01", 0.5]], "series": {
            "60": {"2021": e("2021-06-30", "2021-12-31"), "2022": e("2022-01-03", "2022-12-30"),
                   "2023": e("2023-01-03", "2023-12-29")}}},
        "FB": {"v": 1, "symbol": "FB", "splits": [["2015-01-05", 0.5], ["2025-09-02", 2.0]], "series": {
            "60": {"2012": e("2012-05-18", "2012-12-31", crc=12), "2022": e("2022-01-03", "2022-06-08", crc=22),
                   "2025": e("2025-06-26", "2025-12-31", crc=25)}}},
        "METV": {"v": 1, "symbol": "METV", "series": {"60": {"2022": e("2022-01-31", "2022-12-30")}}},
        "A": {"v": 1, "symbol": "A", "series": {"60": {"2004": e("2004-01-02", "2004-12-31")}}},
    }


def test_the_plan_cuts_reused_tickers_and_stitches_renamed_companies():
    p = I.plan(RECORDS, have=lake().keys())
    assert p["META"] == {"since": "2022-06-09", "cut": True,
                         "segments": [{"sym": "FB", "from": "2012-05-18", "until": "2022-06-09"}]}
    assert p["FB"] == {"since": "2025-06-26", "cut": True, "segments": []}
    # Roundhill's ETF gets its own META-era bars back, and is not cut (nobody held METV before it)
    assert p["METV"] == {"since": "2022-01-31", "cut": False,
                         "segments": [{"sym": "META", "from": "2021-06-30", "until": "2022-01-31"}]}
    assert "A" not in p                                  # noisy record (newest event names AWD): untouched
    # the harm that check prevents: a record whose newest event names a THIRD symbol would otherwise
    # stitch its earlier symbol's bars into a ticker the events never tie to it
    noisy = {"ticker": "NZ", "status": "ok", "cik": "1", "composite_figi": "F1",
             "events": [{"date": "2004-01-02", "ticker": "OLDN"}, {"date": "2006-01-02", "ticker": "WRONG"}]}
    assert "NZ" not in I.plan([noisy], have={"NZ", "OLDN"})


def test_no_cut_without_another_company_and_no_stitch_of_a_contested_window():
    alone = I.plan([FB], have={"FB"})
    assert alone == {}                                   # nobody else ever held FB: nothing to cut
    # an unknown company's event on FB inside Meta's FB window: META is cut but not stitched
    noisy = {"ticker": "ZZZ", "status": "ok", "cik": None, "composite_figi": None,
             "events": [{"date": "2019-01-02", "ticker": "FB"}, {"date": "2020-01-02", "ticker": "ZZZ"}]}
    p = I.plan([META, METV, noisy], have={"META", "FB", "ZZZ"})
    assert p["META"]["cut"] is True and p["META"]["segments"] == []
    # a symbol outside the lake is never planned, and never stitched from
    assert "META" not in I.plan(RECORDS, have={"FB"})
    assert I.plan(RECORDS, have={"META"})["META"]["segments"] == []


def test_apply_cuts_stitches_and_moves_the_split_tables_with_the_windows():
    idx = lake()
    st = I.apply(idx, I.plan(RECORDS, have=idx.keys()))
    vf = I.et_midnight("2022-06-09")
    meta = idx["META"]["series"]["60"]
    assert "2021" not in meta                                            # wholly Roundhill: dropped
    assert meta["2022"]["from"] == vf and "from" not in meta["2023"]     # straddles the day: cut there
    assert meta["2012~FB"] == {**lake()["FB"]["series"]["60"]["2012"], "period": "2012", "sym": "FB"}
    assert meta["2022~FB"]["crc"] == 22 and "until" not in meta["2022~FB"]   # it ends 06-08: inside the window
    assert "2025~FB" not in meta                                         # FB's ETF years never reach META
    # Meta's 2015 split (made as FB) applies to its stitched bars; Roundhill's 2021 split and the
    # ETF's 2025 split never do
    assert idx["META"]["splits"] == [["2015-01-05", 0.5]]
    assert idx["META"]["identity"]["stitched"] == [{"sym": "FB", "from": "2012-05-18", "until": "2022-06-09"}]
    # FB, cut from the ETF's first day, keeps only the ETF (Meta's FB years are META's now)
    assert list(idx["FB"]["series"]["60"]) == ["2025"] and idx["FB"]["splits"] == [["2025-09-02", 2.0]]
    # METV stitched from META's ORIGINAL entries, though META itself was cut in the same pass
    assert idx["METV"]["series"]["60"]["2021~META"]["sym"] == "META"
    assert idx["METV"]["series"]["60"]["2022~META"]["until"] == I.et_midnight("2022-01-31")
    assert idx["A"] == lake()["A"]                                       # untouched
    assert st["cut"] == 2 and st["stitched"] == 2


def test_windows_never_overlap_so_the_client_join_holds(tmp_path):
    idx = lake()
    I.apply(idx, I.plan(RECORDS, have=idx.keys()))
    spans = []
    for key, x in idx["META"]["series"]["60"].items():
        lo = max(x["first"], x.get("from", x["first"]))
        hi = min(x["last"], x.get("until", x["last"] + 1) - 1)
        spans.append((lo, hi, key))
    spans.sort()
    assert all(a[1] < b[0] for a, b in zip(spans, spans[1:])), spans


def test_publish_applies_it_after_the_splits(tmp_path, monkeypatch):
    import publish as P
    events = tmp_path / "ticker_events.jsonl"
    events.write_text("\n".join(json.dumps(r) for r in RECORDS) + "\n", encoding="utf-8")
    idx = lake()
    monkeypatch.setattr(P, "collect_packs", lambda roots: {("60", "2022"): Path("x")})
    monkeypatch.setattr(P, "build_indexes", lambda packs, **k: idx)
    seen = {}
    monkeypatch.setattr(P, "write_indexes", lambda indexes, out: seen.update(indexes) or len(indexes))
    assert P.main(["--from", str(tmp_path), "--out", str(tmp_path / "o"), "--ticker-events", str(events)]) == 0
    assert seen["META"]["identity"]["since"] == "2022-06-09" and "2012~FB" in seen["META"]["series"]["60"]
