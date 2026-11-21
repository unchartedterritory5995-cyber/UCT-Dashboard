"""The corrections ledger builder and publisher (tools/history_lake/corrections_rules.py, daily_corrections.py).

Synthetic series only: shapes of the SPY 2005-10-05 witness, never vendor data."""
import datetime as dt
import io
import json
import types

import pytest

from api.services import bars_corrections as K
from tools.history_lake import corrections_rules as CR
from tools.history_lake import daily_corrections as DC


def _days(n, start="2005-09-01"):
    out, d = [], dt.date.fromisoformat(start)
    while len(out) < n:
        if d.weekday() < 5:
            out.append(d.isoformat())
        d += dt.timedelta(days=1)
    return out


DAYS = _days(40)
BAD = DAYS[20]


def _stored(bad_low=112.09, vol=1000.0):
    rows = [[t, 120.0, 121.0, 119.0, 120.0, vol + i] for i, t in enumerate(DAYS)]
    rows[20] = [BAD, 121.29, 121.31, bad_low, 119.63, vol + 20]
    return rows


def _yahoo():
    y = {t: (120.0, 121.0, 119.0, 120.0, 5.0) for t in DAYS}       # Yahoo's volumes differ: an independent copy
    y[BAD] = (121.29, 121.31, 119.57, 119.63, 5.0)
    return y


def _minutes(low=112.09, low2=119.60, f=1.0):
    """The vendor's minute stats for BAD, in RAW prices (x 1/f)."""
    m = {"n": 390, "rth_low": low / f, "rth_low_at": "15:28", "rth_low_bar": [120.11 / f, 120.16 / f, low / f, 120.05 / f],
         "rth_low2": low2 / f, "rth_high": 121.31 / f, "rth_high_at": "09:33", "rth_high_bar": [121.26 / f, 121.31 / f, 121.25 / f, 121.3 / f],
         "rth_high2": 121.3 / f, "rth_close": 119.63 / f, "rth_close_at": "15:59"}
    m.update({k[4:]: v for k, v in m.items() if k.startswith("rth_") and k != "rth_close" and k != "rth_close_at"})
    return m


RAW = {f"SPY|{BAD}": [121.29, 121.31, 112.09, 119.63, 1000.0]}


def _build(minutes, raw=RAW, store=None, yf=None):
    return CR.build_ticker("SPY", served=False, rec=None, end="2026-11-17",
                           store=store or {"D": _stored(), "W": [], "M": []}, yf=yf or _yahoo(), minutes=minutes, raw=raw)


# ── the rules ────────────────────────────────────────────────────────────────────────────────────────────

def test_d2_a_lone_minute_print_the_next_minute_and_yahoo_agree_on_becomes_yahoos_value():
    rows, entries, S, _ = _build({f"SPY|{BAD}": _minutes()})
    e = [x for x in entries if x["d"] == BAD][0]
    assert e["op"] == "set" and e["f"] == {"l": [112.09, 119.57]} and e["chk"] == {"c": 119.63}
    r = [x for x in rows if x.get("d") == BAD and x["op"] == "set"][0]
    assert "same vendor, different product" in r["evidence"]["l"]["label"]


def test_d2_without_minutes_only_names_the_pair_to_read():
    rows, entries, S, cands = _build(None)
    assert entries == [] and ("SPY", BAD) in cands


def test_d2_several_minutes_at_the_extreme_is_a_real_move():
    rows, entries, *_ = _build({f"SPY|{BAD}": _minutes(low2=112.10)})
    assert not [x for x in entries if x["d"] == BAD]
    assert any(r.get("verdict") == "spread_real_move" for r in rows)


def test_d2_minute_prices_are_raw_and_scaled_by_the_day_factor():
    """A later 2:1 split: the minute file says 224.18 where our adjusted bar says 112.09."""
    raw = {f"SPY|{BAD}": [242.58, 242.62, 224.18, 239.26, 500.0]}
    rows, entries, *_ = _build({f"SPY|{BAD}": _minutes(f=0.5)}, raw=raw)
    assert [x for x in entries if x["d"] == BAD][0]["f"] == {"l": [112.09, 119.57]}


def test_d2b_a_day_value_in_no_minute_whose_minute_extreme_agrees_with_yahoo():
    m = _minutes(low=119.60, low2=119.65)                          # the minutes never went to 112.09
    rows, entries, S, _ = _build({f"SPY|{BAD}": m})
    assert [x for x in entries if x["d"] == BAD][0]["f"] == {"l": [112.09, 119.57]}
    assert S["D2b_set"] == 1


def test_d6_an_isolated_close_the_minute_and_yahoo_agree_on():
    st = _stored(bad_low=119.0)
    st[20] = [BAD, 121.29, 121.31, 119.0, 125.0, 1020.0]           # close 125 vs Yahoo 119.63
    y = _yahoo()
    y[BAD] = (121.29, 121.31, 119.0, 119.63, 5.0)
    m = _minutes(low=119.0, low2=119.1)
    raw = {f"SPY|{BAD}": [121.29, 121.31, 119.0, 125.0, 1000.0]}
    rows, entries, S, _ = _build({f"SPY|{BAD}": m}, raw=raw, store={"D": st}, yf=y)
    e = [x for x in entries if x["d"] == BAD][0]
    assert e["f"] == {"c": [125.0, 119.63]} and e["chk"] == {"o": 121.29}


def test_d6_the_minute_agreeing_with_ours_is_unresolved_and_kept():
    st = _stored(bad_low=119.0)
    st[20] = [BAD, 121.29, 125.5, 119.0, 125.0, 1020.0]
    y = _yahoo()
    y[BAD] = (121.29, 125.5, 119.0, 119.63, 5.0)
    m = dict(_minutes(low=119.0, low2=119.1), rth_close=125.0)
    raw = {f"SPY|{BAD}": [121.29, 125.5, 119.0, 125.0, 1000.0]}
    rows, entries, *_ = _build({f"SPY|{BAD}": m}, raw=raw, store={"D": st}, yf=y)
    assert not [x for x in entries if x["d"] == BAD]
    assert any(r.get("verdict") == "unresolved_kept_minute_agrees_ours" for r in rows)


def test_d6_a_long_run_is_a_series_class_never_a_close_correction():
    st = _stored(bad_low=119.0)
    for i in range(10, 31):                                        # another security for weeks: its own shape
        c = 120.0 * (1.03 if i % 2 else 0.97)
        st[i] = [DAYS[i], c, c * 1.005, c * 0.995, c, 1000.0 + i]
    rows, entries, S, _ = _build({}, store={"D": st})
    assert entries == [] and S["D6_series_run_days"] > 10


def test_d4_drops_fillers_only_in_the_yahoo_sourced_head():
    st = _stored(bad_low=119.0)
    for i in range(0, 8):                                          # head: Yahoo's exact volumes
        st[i][5] = 5.0
    st[3] = [DAYS[3], 120.0, 120.0, 120.0, 120.0, 0.0]             # a filler in the Yahoo head
    st[2][4] = 120.0
    st[30] = [DAYS[30], 120.0, 120.0, 120.0, 120.0, 0.0]            # a zero-volume bar in the vendor era: untouched
    rows, entries, *_ = _build({}, store={"D": st})
    drops = [x for x in entries if x["op"] == "drop"]
    assert [x["d"] for x in drops] == [DAYS[3]] and drops[0]["old"] == [120.0, 120.0, 120.0, 120.0, 0.0]


def test_d5_a_two_decimal_copy_of_yahoo_gets_yahoos_four_decimals():
    st = _stored(bad_low=119.0)
    y = _yahoo()
    for i in range(0, 8):
        st[i][5] = 5.0
    y[DAYS[1]] = (120.0012, 121.0049, 118.9951, 120.0038, 5.0)
    st[4] = [DAYS[4], 120.5, 121.0, 119.0, 120.0, 5.0]               # 2 dp but NOT a rounded copy of Yahoo's bar
    rows, entries, *_ = _build({}, store={"D": st}, yf=y)
    assert not [x for x in entries if x["d"] == DAYS[4]]
    e = [x for x in entries if x["d"] == DAYS[1]][0]
    assert e["f"] == {"o": [120.0, 120.0012], "h": [121.0, 121.0049], "l": [119.0, 118.9951], "c": [120.0, 120.0038]}
    assert e["chk"] == {}


def test_d1_keeps_a_wick_an_independent_yahoo_shows_and_trims_a_copy():
    st = _stored(bad_low=119.0)
    st[20] = [BAD, 121.29, 121.31, 70.0, 119.63, 1020.0]           # a flash-crash low the clamp would trim
    y = _yahoo()
    y[BAD] = (121.29, 121.31, 70.0, 119.63, 5.0)                   # Yahoo shows it, from its own tape
    rows, entries, S, _ = _build({}, store={"D": st}, yf=y)
    assert {"tf": "D", "src": "store", "d": BAD, "op": "keep_wick", "field": "l", "value": 70.0} in entries
    y[BAD] = (121.29, 121.31, 70.0, 119.63, 1020.0)                 # Yahoo's row is OUR row's copy: no confirmation
    rows, entries, S, _ = _build({}, store={"D": st}, yf=y)
    assert not [x for x in entries if x["op"] == "keep_wick"] and S["D1_trim_yahoo_row_is_a_copy"] == 1


def test_sub_five_cent_rows_are_never_corrected():
    st = [[t, 0.00012, 0.000121, 0.000119, 0.00012, 2e10] for t in DAYS]   # Yahoo's shape x 1e-6: corrupt, not real
    st[20] = [BAD, 0.00012, 0.000121, 0.00001, 0.00012, 2e10]       # a 'spike' that would pass every other test
    y = {t: (120.0, 121.0, 119.0, 120.0, 5.0) for t in DAYS}
    rows, entries, S, cands = _build(None, store={"D": st}, yf=y)
    assert cands == []


def test_weekly_and_monthly_are_re_derived_only_where_they_derive_from_the_dailies():
    st = _stored()
    w_ok = [CR.wkey(BAD), 120.0, 121.31, 112.09, 120.0, 0.0]
    m_other = [CR.mkey(BAD), 222.0, 230.0, 200.0, 225.0, 0.0]       # another basis entirely (R2): left alone
    rows, entries, S, _ = _build({f"SPY|{BAD}": _minutes()}, store={"D": st, "W": [w_ok], "M": [m_other]})
    w = [x for x in entries if x["tf"] == "W"]
    assert len(w) == 1 and w[0]["f"]["l"][1] > 118.9 and w[0]["chk"] == {}     # W/M: no chk (a re-fetch moves closes)
    assert not [x for x in entries if x["tf"] == "M"] and S["M_stored_not_derived_from_its_dailies"] == 1


def test_every_entry_round_trips_through_the_applier():
    rows, entries, *_ = _build({f"SPY|{BAD}": _minutes()})
    body = K.encode_payload("SPY", 1, entries)
    assert K.decode_payload(body)["entries"] == entries


# ── publishing ───────────────────────────────────────────────────────────────────────────────────────────

def test_versions_only_rise():
    with pytest.raises(SystemExit):
        DC.plan_manifest({"version": 3, "symbols": ["SPY"]}, 3, ["SPY"], "SPY")


def test_a_revert_retires_what_an_earlier_version_listed():
    m = DC.plan_manifest({"version": 3, "symbols": ["SPY", "AAPL"], "retired": ["QQQ"]}, 4, ["AAPL"], "AAPL")
    assert m["symbols"] == ["AAPL"] and m["retired"] == ["QQQ", "SPY"]


class _S3:
    def __init__(self, manifest=None):
        self.objs, self.puts = ({} if manifest is None else {K.MANIFEST_KEY: json.dumps(manifest).encode()}), []

    def get_object(self, Bucket, Key):
        if Key not in self.objs:
            raise KeyError("NoSuchKey")
        return {"Body": io.BytesIO(self.objs[Key])}

    def put_object(self, Bucket, Key, Body, **kw):
        self.puts.append(Key)
        self.objs[Key] = Body


def test_publish_writes_payloads_first_and_the_manifest_last(tmp_path):
    (tmp_path / "entries").mkdir()
    (tmp_path / "entries" / "SPY.json").write_text(json.dumps([{"tf": "D", "src": "store", "d": BAD, "op": "set",
                                                                  "f": {"l": [112.09, 119.57]}, "chk": {"c": 119.63}}]))
    (tmp_path / "entries" / "AAPL.json").write_text("[]")
    (tmp_path / "RESCALE_FLAG.json").write_text(json.dumps({"exit": 0, "names": []}))
    s3 = _S3({"version": 1, "symbols": [], "retired": []})
    a = types.SimpleNamespace(out=str(tmp_path), stage="SPY", version=2, dry=False)
    m = DC.cmd_publish(a, client=s3, bucket="b")
    assert s3.puts == [f"{K.PREFIX}v2/SPY.json.gz", K.MANIFEST_KEY]       # the stage names SPY only
    assert m["symbols"] == ["SPY"] and json.loads(s3.objs[K.MANIFEST_KEY])["version"] == 2
    assert K.decode_payload(s3.objs[f"{K.PREFIX}v2/SPY.json.gz"])["version"] == 2


def test_verify_names_every_change_the_ledger_does_not_explain():
    before = [{"t": d, "o": 1, "h": 2, "l": 0.5, "c": 1} for d in DAYS[:5]]
    after = [dict(b) for b in before]
    after[1] = dict(after[1], l=0.9)
    after[2] = dict(after[2], c=1.5)
    dif = DC.diff_served(before, after)
    assert set(dif) == {DAYS[1], DAYS[2]}


def test_rows_before_the_newest_listing_break_are_never_corrected():
    """A reused ticker: another company's bars, a 200-day gap, then today's company. The serve path cuts the head."""
    old = [[t, 5.0, 5.0, 5.0, 5.0, 0.0] for t in _days(30, "2004-01-02")]          # fillers of another security
    st = old + _stored()
    rows, entries, S, _ = _build({f"SPY|{BAD}": _minutes()}, store={"D": st})
    assert not [x for x in entries if x["d"] < DAYS[0]]
    assert S["store_rows_before_listing_break"] == 30



# ── F3 (coordinator ruling): flagged names are never published unless cleared ──────────────────────────────
def _pub_dir(tmp_path, flag):
    (tmp_path / "entries").mkdir()
    for s in ("SPY", "CBSH"):
        (tmp_path / "entries" / f"{s}.json").write_text(json.dumps([{"tf": "D", "src": "store", "d": BAD, "op": "set",
                                                                      "f": {"l": [1.0, 2.0]}, "chk": {}}]))
    if flag is not None:
        (tmp_path / "RESCALE_FLAG.json").write_text(json.dumps(flag))


def test_publish_refuses_a_flagged_name_and_leaves_flagged_names_out_of_all(tmp_path):
    _pub_dir(tmp_path, {"exit": 1, "names": ["CBSH"]})
    with pytest.raises(SystemExit):
        DC.cmd_publish(types.SimpleNamespace(out=str(tmp_path), stage="SPY,CBSH", version=2, dry=False, cleared=""), client=_S3(), bucket="b")
    m = DC.cmd_publish(types.SimpleNamespace(out=str(tmp_path), stage="all", version=2, dry=False, cleared=""), client=_S3(), bucket="b")
    assert m["symbols"] == ["SPY"]
    m = DC.cmd_publish(types.SimpleNamespace(out=str(tmp_path), stage="all", version=2, dry=False, cleared="CBSH"), client=_S3(), bucket="b")
    assert m["symbols"] == ["CBSH", "SPY"]


@pytest.mark.parametrize("flag", [None, {"exit": 2, "names": []}])
def test_publish_refuses_without_a_good_f3_check(tmp_path, flag):
    _pub_dir(tmp_path, flag)
    with pytest.raises(SystemExit):
        DC.cmd_publish(types.SimpleNamespace(out=str(tmp_path), stage="SPY", version=2, dry=False, cleared=""), client=_S3(), bucket="b")


def test_the_build_stops_when_the_f3_check_cannot_run(tmp_path, monkeypatch):
    from tools import bars_rescale_check as F3
    monkeypatch.setattr(F3, "main", lambda argv: 2)
    with pytest.raises(SystemExit):
        DC.rescale_check(str(tmp_path / "missing.db"), tmp_path)


def test_verify_counts_ledger_rows_that_did_not_apply(tmp_path):
    (tmp_path / "ledger.jsonl").write_text(chr(10).join(json.dumps(r) for r in [
        {"sym": "SPY", "tf": "D", "d": DAYS[1], "op": "set", "f": {"l": [0.5, 0.9]}},
        {"sym": "SPY", "tf": "D", "d": DAYS[2], "op": "set", "f": {"l": [0.5, 0.8]}}]))
    before = [{"t": d, "o": 1, "h": 2, "l": 0.5, "c": 1} for d in DAYS[:5]]
    after = [dict(b) for b in before]
    after[1] = dict(after[1], l=0.9)                                  # applied; DAYS[2] did not
    for sub, bars in (("b", before), ("a", after)):
        (tmp_path / sub).mkdir()
        for tf in "DWM":
            (tmp_path / sub / f"SPY_{tf}.json").write_text(json.dumps({"bars": bars if tf == "D" else []}))
    rep = DC.cmd_verify(types.SimpleNamespace(out=str(tmp_path), symbols="SPY", before=str(tmp_path / "b"), after=str(tmp_path / "a")))
    assert rep["SPY_D"]["ledger_rows_not_applied"] == 1 and rep["SPY_D"]["missed_sample"] == [DAYS[2]]
