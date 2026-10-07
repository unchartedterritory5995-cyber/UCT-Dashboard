from api.services.marketcap import reasons as R
from api.services.marketcap.classecon import ClassEcon, extract
from api.services.marketcap.structure import class_key, resolve


def test_class_key_normalization():
    assert class_key("us-gaap_CommonClassAMember", "Class A") == "A"
    assert class_key("goog_CapitalClassCMember", "Class C Capital Stock") == "C"
    assert class_key("col:Class B Common Stock", "Class B Common Stock") == "B"
    assert class_key(None, None) == "COMMON"
    assert class_key("us-gaap_CommonStockMember", None) == "COMMON"


def test_meta_unlisted_b_converts_one_to_one():
    e = extract("Shares of our Class B common stock are convertible into an equivalent number of shares of our Class A common stock.")
    r = resolve({"A": 2.19e9, "B": 3.4e8}, {"A": "META"}, e, "acc")
    assert r.structure.kind == "LISTED_PLUS_CONVERTIBLE"
    comps = {c.class_key: (c.price_ticker, c.multiplier(None)) for c in r.structure.components}
    assert comps == {"A": ("META", 1.0), "B": ("META", 1.0)}


def test_google_equal_rights_three_classes_two_listed():
    e = extract("Shares of Class B common stock may be converted at any time at the option of the stockholder and automatically "
                "convert upon sale or transfer to Class A common stock. In accordance with our certificate of incorporation, the "
                "rights, including the liquidation and dividend rights, of the holders of our Class A, Class B, and Class C stock "
                "are identical, except with respect to voting.")
    r = resolve({"A": 5.8e9, "B": 8.6e8, "C": 5.6e9}, {"A": "GOOGL", "C": "GOOG"}, e, "acc")
    comps = {c.class_key: (c.price_ticker, c.multiplier(None)) for c in r.structure.components}
    assert r.structure.kind == "MULTI_LISTED" and comps == {"A": ("GOOGL", 1.0), "B": ("GOOGL", 1.0), "C": ("GOOG", 1.0)}


def test_voting_only_excluded_and_complex_quarantined():
    e = ClassEcon(voting_only={"B": "Class B common stock has no economic rights"})
    r = resolve({"A": 1e8, "B": 5e7}, {"A": "XYZ"}, e)
    assert [c.class_key for c in r.structure.components] == ["A"]
    up = extract("Holders of LLC Units may exchange their LLC Units for shares of Class A common stock on a one-for-one basis. "
                 "Class B common stock has no economic rights.")
    assert resolve({"A": 1e8, "B": 5e7}, {"A": "XYZ"}, up).structure.reason == R.COMPLEX


def test_unlisted_class_without_authoritative_ratio_is_unresolved():
    r = resolve({"A": 1e8, "B": 5e7}, {"A": "XYZ"}, ClassEcon())
    assert r.structure.kind == "UNRESOLVED" and r.structure.reason == R.MULTI_CLASS


def test_convertible_notes_do_not_flag_variable_conversion():
    e = extract("The conversion rate for the 2026 Notes is subject to adjustment upon certain events. "
                "Each share of Class B common stock is convertible at any time at the option of the holder into one share of Class A common stock.")
    assert not e.complex and e.conversions["B"][:2] == ("A", 1.0)
