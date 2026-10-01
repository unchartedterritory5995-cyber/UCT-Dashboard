"""C29 -- the Python twin serves the syminfo listing fields exactly as bind.js.

The witnesses are the 2026-09-30 syminfo-roster captures; this rail reads them
(never a typed copy) and checks the Python fold's answer against each row.
"""
import json
import pathlib

from api.services import ast_bind as B

H = pathlib.Path(__file__).resolve().parents[1] / "tests" / "fixtures" / "vendor" / "harness"


def _capture(pro):
    for p in sorted(H.glob("syminfo-roster-*-2026-09-30.json")):
        cap = json.loads(p.read_text(encoding="utf-8"))
        if cap["symbol"]["pro_name"] == pro:
            return cap
    raise AssertionError("no capture of " + pro)


def _last(cap, title):
    ids = {p["id"]: p["title"] for p in cap["study"]["plots"]}
    fields = cap["plotValues"]["fields"]
    for i, f in enumerate(fields):
        if ids.get(f) == title:
            col = [r[i] for r in cap["plotValues"]["rows"]]
            assert len(set(col)) == 1, title
            return col[0]
    raise AssertionError(title)


def test_every_row_folds_to_what_its_witnesses_printed():
    rows = {k: v for k, v in B._SYMBOL_SCOPE["listing_fields"].items() if not k.startswith("_")}
    assert set(rows) == set(B.SYMBOL_LISTING_FIELDS) and rows
    checked = 0
    for exchange, row in rows.items():
        for pro in row["witnesses"]:
            cap = _capture(pro)
            ticker = pro.split(":")[-1]
            c = B.binding_constants(symbol={"ticker": ticker, "exchange": exchange})
            txt = lambda f: B.fold_text({"type": "symtext", "name": f}, c)
            assert (txt("basecurrency") == "") == (_last(cap, "S2_base_eq_EMPTY") == 1)
            assert len(txt("basecurrency")) == _last(cap, "S3_len_base")
            assert (txt("currency") == "USD") == (_last(cap, "S4_curr_eq_USD") == 1)
            assert (txt("timezone") == "America/New_York") == (_last(cap, "S9_tz_eq_NY") == 1)
            assert len(txt("timezone")) == _last(cap, "S12_len_tz")
            assert (txt("root") == ticker) == (_last(cap, "S13_root_eq_ticker") == 1)
            assert (txt("session") == "regular") == (_last(cap, "S15_sess_eq_regular") == 1)
            assert float(txt("pointvalue")) == _last(cap, "S18_pointvalue")
            checked += 1
    assert checked == 4


def test_an_unwitnessed_exchange_settles_none_of_them():
    c = B.binding_constants(symbol={"ticker": "LVMUY", "exchange": "OTC"})
    for f in B.LISTING_FIELD_NAMES:
        assert "syminfo." + f not in c
        try:
            B.fold_text({"type": "symtext", "name": f}, c)
        except B.NotFoldable as e:
            assert ("syminfo." + f) in e.what
        else:
            raise AssertionError(f + " folded on an unwitnessed exchange")
