"""Registry rails: the committed series.json is valid, and EVERY rail fires.

Each negative control builds a registry that is valid except for ONE defect and
asserts the rail names it. `test_baseline_minimal_registry_is_valid` is the
control for the controls: without it, a rail that fires on everything would
look like a rail that works.
"""
from __future__ import annotations

import copy
import csv
import json
from collections import Counter
from pathlib import Path

import pytest

from api.services.econ import registry as R
from api.services.econ.model import parse_canonical

CATALOG = Path(r"C:\Users\blake\uct-econ-phase0\econ_catalog.csv")

COHORT_41 = {
    "USCPI", "USCPINSA", "USCORECPI", "USCPIYOY", "USCPIMOM", "USCORECPIYOY", "USPPIFD", "USECI",
    "USUNRATE", "USNFP", "USNFPCHG", "USJOLTSO", "USICSA", "USRGDP", "USRGDPQA", "USPCEPI",
    "USCOREPCE", "USPCEPIYOY", "USRETAIL", "USHOUST", "USDURGOODS", "USTRADEBAL", "UST2Y", "UST10Y",
    "UST10Y2Y", "USFEDBAL", "USM2", "USINDPRO", "USEFFR", "USFEDFUNDSU", "USFEDFUNDSL", "USSOFR",
    "USRRP", "USEMPIRE", "USDEBT", "USTGA", "USMTSDEF", "USDEBTGDP", "USCRUDEINV", "USGASPRICE",
    "USFHFAHPI",
}


# ------------------------------------------------------------------ the committed file

def test_committed_registry_is_valid():
    errs = R.validate_registry()
    assert errs == [], "\n".join(errs)


def test_all_237_catalog_rows_imported():
    entries = R.all()
    assert len(entries) == 237
    assert len({e["symbol"] for e in entries}) == 237
    if CATALOG.exists():
        with open(CATALOG, encoding="utf-8", newline="") as fh:
            syms = [r["uct_symbol"] for r in csv.DictReader(fh)]
        assert [e["symbol"] for e in entries] == syms


def test_status_and_cohort_counts():
    c = Counter(e["status"] for e in R.all())
    # 2026-09-29 rulings: USICSA+USEMPIRE enabled (adapter-verified), USRETAIL failed closed (basis conflict)
    # 2026-09-30 readiness (Gate 3, registry-corrections/readiness.json): 94 launch series enabled
    assert c == {"enabled": 136, "disabled": 48, "unverified": 36, "excluded": 17}
    cohort = {e["symbol"] for e in R.cohort()}
    assert cohort == COHORT_41 | {"USCORECPINSA", "USGDP"}
    enabled = {e["symbol"] for e in R.enabled()}
    assert cohort - enabled == {"USRETAIL"}
    assert R.get("USRETAIL")["status"] == "unverified" and R.get("USRETAIL")["source"]["verified"] is False
    assert "FAIL CLOSED" in " ".join(R.get("USRETAIL")["notes"])
    assert R.get("USICSA")["status"] == "enabled" and R.get("USEMPIRE")["status"] == "enabled"


def test_readiness_enables_only_launch_candidates_and_keeps_retail_closed():
    """Every enabled non-cohort series is one of the 151 launch candidates, and the
    retail family stays failed closed until the owner resolves the basis conflict."""
    launch = {r["symbol"] for r in csv.DictReader(open(Path(__file__).resolve().parents[2] / "docs" / "economic-data"
                                                       / "expansion_151.csv", encoding="utf-8"))}
    cohort = {e["symbol"] for e in R.cohort()}
    extra = {e["symbol"] for e in R.enabled()} - cohort
    assert len(extra) == 94 and extra <= launch
    for sym in ("USRETAIL", "USRETAILXA", "USRETAILCTRL", "USRETAILMOM", "USRETCTRLMOM"):
        assert R.get(sym)["status"] != "enabled", sym
    for e in R.all():
        if e["licensing"]["class"] in ("YELLOW", "RED"):
            assert e["status"] != "enabled", e["symbol"]


def test_every_red_row_is_excluded_and_every_excluded_row_is_red():
    for e in R.all():
        assert (e["licensing"]["class"] == "RED") == (e["status"] == "excluded"), e["symbol"]


def test_enabled_entries_are_green_cleared_verified():
    for e in R.enabled():
        assert e["licensing"]["class"] == "GREEN", e["symbol"]
        assert e["licensing"]["clearance"] == "cleared", e["symbol"]
        assert e["source"]["verified"] is True, e["symbol"]


def test_nyfed_rows_green_with_notice():
    for sym in ("USEFFR", "USSOFR", "USRRP", "USFEDFUNDSU"):
        lic = R.get(sym)["licensing"]
        assert (lic["class"], lic["notice_required"], lic["attribution_key"]) == ("GREEN", True, "nyfed")


def test_yellow_rows_are_permission_pending_and_never_enabled():
    ys = [e for e in R.all() if e["licensing"]["class"] == "YELLOW"]
    assert ys
    for e in ys:
        assert e["licensing"]["clearance"] == "permission_pending"
        assert e["status"] != "enabled"


def test_pit_class_u_only_when_unrevised():
    for e in R.all():
        assert (e["pit"]["backfill_class"] == "U") == (e["revision"]["type"] == "none"), e["symbol"]


def test_derivations_are_structured():
    d = R.get("USDEBTGDP")["derivation"]
    assert d["op"] == "ratio_pct" and d["inputs"] == ["USDEBT", "USGDP"]
    assert d["params"]["transforms"] == {"USDEBT": "eop_q"}
    assert d["params"]["scale"] == pytest.approx(1e-4)  # BEA NIPA levels are $M (UNIT_MULT 6)
    assert R.get("UST10Y2Y")["derivation"] == {"op": "spread", "inputs": ["UST10Y", "UST2Y"], "params": {}, "version": 1}
    assert R.get("USCPIYOY")["derivation"]["inputs"] == ["USCPINSA"]   # BLS YoY from NSA
    assert R.get("USCPIMOM")["derivation"]["inputs"] == ["USCPI"]      # BLS MoM from SA
    assert R.get("USNFPCHG")["derivation"]["op"] == "diff"
    # align_w() is not computable -> the row is unverified with a note
    netliq = R.get("USNETLIQ")
    assert netliq["status"] == "unverified" and any("align_w" in n for n in netliq["notes"])


def test_release_times_never_invented():
    for e in R.all():
        raw = e["catalog_row"]["typical_release_time_et"]
        if "?" in raw or "~" in raw or not raw.strip():
            assert e["release"]["typical_time_et"] is None, e["symbol"]


def test_frequency_anchors():
    assert (R.get("USICSA")["frequency"], R.get("USICSA")["week_anchor"]) == ("W", "SAT")
    assert R.get("USFEDBAL")["week_anchor"] == "WED"
    assert R.get("USCRUDEINV")["week_anchor"] == "FRI"
    assert R.get("USGASPRICE")["week_anchor"] == "MON"
    assert R.get("UST10Y")["frequency"] == "D"


def test_units_mapping():
    assert R.get("USRETAIL")["units"]["fmt"] == "usd_compact" and R.get("USRETAIL")["units"]["scale"] == 1e6
    assert R.get("USM2")["units"]["scale"] == 1e9
    assert R.get("USDEBT")["units"]["scale"] == 1
    assert R.get("USNFP")["units"]["fmt"] == "k_persons"
    assert R.get("USCRUDEINV")["units"]["fmt"] == "mbbl"
    assert R.get("UST10Y2Y")["units"]["fmt"] == "pp2"
    assert R.get("UST10Y")["units"]["fmt"] == "pct2"
    assert R.get("USCPIYOY")["units"]["fmt"] == "pct1"


def test_lookup_api():
    assert R.get("USCPI") is R.get("ECON:USCPI") is R.get("econ:uscpi")
    assert R.canonical("USCPI") == "ECON:USCPI"
    assert R.canonical("NOPE") is None and R.get("AAPL") is None
    assert R.get("ECON:US:BREADTH") is None
    for e in R.all():
        assert parse_canonical(R.canonical(e["symbol"])) == e["symbol"]


def test_search_view_is_enabled_members_without_internals():
    rows = R.search_view()
    assert {r["symbol"] for r in rows} == {e["symbol"] for e in R.members_for_search()}
    assert all(r["id"] == "ECON:" + r["symbol"] for r in rows)
    blob = json.dumps(rows)
    for leak in ("licensing", "params", "approval_ref", "adapter", "api_key"):
        assert leak not in blob


def test_equity_collisions_against_committed_universe():
    eq = R.equity_symbols()
    assert len(eq) > 1000, "cap universe not found -- the collision rail could not run"
    assert R.equity_collisions() == []
    # control: a registry symbol that IS a ticker is reported
    assert R.equity_collisions([{"symbol": "USB", "status": "disabled"}]) == [("USB", "disabled")]


def test_aliases_globally_unique_on_committed_file():
    seen = Counter(a for e in R.all() for a in e["aliases"])
    assert [a for a, n in seen.items() if n > 1] == []


# ------------------------------------------------------------------ negative controls

ATTR = {"bls": {"text": "x"}, "fiscaldata": {"text": "y"}}


def _entry(sym, **over):
    e = {
        "symbol": sym, "name": sym, "short_name": sym, "description": sym, "category": "c",
        "subcategory": "s", "country": "US", "role": "member", "status": "enabled", "cohort": True,
        "source": {"agency": "U.S. Bureau of Labor Statistics", "dataset": "CPI", "provider_series_id": sym + "ID",
                   "adapter": "bls", "params": {"series_id": sym + "ID"}, "official_url": "",
                   "verified": True, "verified_evidence": "test"},
        "frequency": "M", "week_anchor": "",
        "units": {"raw": "Index", "display": "index", "fmt": "num1", "scale": 1},
        "seasonal_adjustment": "SA", "history_start": "2000-01",
        "release": {"calendar_key": "bls:cpi", "cadence": "M", "typical_time_et": "08:30",
                    "typical_time_note": "", "precision_hint": "exact",
                    "lag_rule": {"kind": "period_end_plus_days", "days": 25, "time_et": "08:30", "basis": "t"}},
        "revision": {"type": "none"}, "pit": {"backfill_class": "U"}, "derivation": None,
        "licensing": {"class": "GREEN", "clearance": "cleared", "attribution_key": "bls",
                      "notice_required": True, "approval_ref": None},
        "aliases": [sym.lower()], "synonyms": [], "presentation": {"style": "line"}, "catalog_row": {},
    }
    for k, v in over.items():
        if isinstance(v, dict) and isinstance(e.get(k), dict):
            e[k] = {**e[k], **v}
        else:
            e[k] = v
    return e


def _derived(sym, inputs, op="spread", **over):
    base = _entry(sym, source={"agency": "UCT", "dataset": "derived", "provider_series_id": "", "adapter": "derived",
                               "params": {}, "verified": True, "verified_evidence": "inputs"},
                  derivation={"op": op, "inputs": inputs, "params": {}, "version": 1},
                  release={"lag_rule": {"kind": "derived", "days": None, "time_et": None, "basis": "d"}},
                  aliases=[sym.lower()])
    for k, v in over.items():
        base[k] = {**base[k], **v} if isinstance(v, dict) and isinstance(base.get(k), dict) else v
    return base


def _base():
    return [_entry("USAAA"), _entry("USBBB"), _derived("USCCC", ["USAAA", "USBBB"])]


def _errs(entries):
    return R.validate_registry(entries, attributions=ATTR, equity=set())


def test_baseline_minimal_registry_is_valid():
    assert _errs(_base()) == []


def _assert_fires(entries, needle):
    errs = _errs(entries)
    assert any(needle in e for e in errs), f"rail {needle!r} did not fire; got {errs}"


def test_red_entry_enabled_is_an_error():
    ents = _base()
    ents[0]["licensing"] = {**ents[0]["licensing"], "class": "RED"}
    _assert_fires(ents, "RED series must be status excluded")
    _assert_fires(ents, "not production-eligible")


def test_yellow_enabled_without_approval_ref_is_an_error():
    ents = _base()
    ents[0]["licensing"] = {**ents[0]["licensing"], "class": "YELLOW", "clearance": "permission_granted", "approval_ref": ""}
    _assert_fires(ents, "permission_granted without approval_ref")
    ents[0]["licensing"]["clearance"] = "permission_pending"
    _assert_fires(ents, "YELLOW requires permission_granted")
    # control: with an approval ref it is allowed
    ents[0]["licensing"].update(clearance="permission_granted", approval_ref="EMAIL-2026-10-01-philly")
    assert _errs(ents) == []


def test_duplicate_alias_is_an_error():
    ents = _base()
    ents[1]["aliases"] = ["usbbb", "usaaa"]
    _assert_fires(ents, "alias 'usaaa' already belongs to USAAA")


def test_alias_equal_to_other_symbol_is_an_error():
    ents = _base()
    ents[0]["aliases"] = ["usaaa", "usccc"]
    ents[2]["aliases"] = ["derivedccc"]
    _assert_fires(ents, "is the symbol of USCCC")


def test_unnormalized_alias_is_an_error():
    ents = _base()
    ents[0]["aliases"] = ["USAAA "]
    _assert_fires(ents, "not normalized")


def test_derivation_input_missing_is_an_error():
    ents = _base()
    ents[2]["derivation"] = {**ents[2]["derivation"], "inputs": ["USAAA", "USZZZ"]}
    _assert_fires(ents, "derivation input 'USZZZ' missing")


def test_circular_derivation_is_an_error():
    ents = [_derived("USXXX", ["USYYY"], op="diff"), _derived("USYYY", ["USXXX"], op="diff")]
    _assert_fires(ents, "circular derivation")
    self_loop = [_derived("USSELF", ["USSELF"], op="diff")]
    _assert_fires(self_loop, "circular derivation USSELF -> USSELF")


def test_unverified_enabled_is_an_error():
    ents = _base()
    ents[0]["source"] = {**ents[0]["source"], "verified": False}
    _assert_fires(ents, "enabled but source.verified is false")


def test_enabled_derived_with_disabled_input_is_an_error():
    ents = _base()
    ents[1]["status"] = "disabled"
    _assert_fires(ents, "has input USBBB that is disabled")


def test_enabled_unsupported_op_is_an_error():
    ents = _base()
    ents[2]["derivation"] = {**ents[2]["derivation"], "op": "magic"}
    _assert_fires(ents, "not computable by derive.py")
    ents[2]["status"] = "unverified"
    assert _errs(ents) == []          # allowed while not enabled


def test_unknown_adapter_and_enums_are_errors():
    for mutate, needle in [
        (lambda e: e["source"].update(adapter="nope"), "does not exist"),
        (lambda e: e.update(status="live"), "status 'live'"),
        (lambda e: e.update(frequency="Weekly"), "frequency 'Weekly'"),
        (lambda e: e.update(week_anchor="THU"), "week_anchor 'THU'"),
        (lambda e: e["units"].update(fmt="pct9"), "units.fmt 'pct9'"),
        (lambda e: e["units"].update(scale=0), "units.scale"),
        (lambda e: e["licensing"].update(clearance="maybe"), "licensing.clearance"),
        (lambda e: e["release"].update(typical_time_et="8:30am"), "typical_time_et"),
        (lambda e: e["release"].update(precision_hint="exact", typical_time_et=None), "precision exact without"),
        (lambda e: e["release"]["lag_rule"].update(kind="soon"), "lag_rule.kind"),
        (lambda e: e["pit"].update(backfill_class="L"), "contradicts revision.type"),
        (lambda e: e.update(symbol="XXCPI"), "does not parse back"),
        (lambda e: e.pop("catalog_row"), "missing keys"),
    ]:
        ents = _base()
        ents[0] = copy.deepcopy(ents[0])
        mutate(ents[0])
        _assert_fires(ents, needle)


def test_duplicate_symbol_is_an_error():
    ents = _base() + [_entry("USAAA", aliases=["usaaa2"])]
    _assert_fires(ents, "USAAA: duplicate symbol")


def test_notice_required_needs_resolvable_attribution():
    ents = _base()
    ents[0]["licensing"] = {**ents[0]["licensing"], "attribution_key": "nobody"}
    _assert_fires(ents, "does not resolve in attributions.json")


def test_shared_provider_identity_needs_twins():
    ents = _base()
    ents[1]["source"] = copy.deepcopy(ents[0]["source"])
    _assert_fires(ents, "same (adapter, provider_series_id, params) as enabled USAAA")
    ents[1]["twins"] = ["USAAA"]
    assert _errs(ents) == []


def test_enabled_symbol_colliding_with_equity_is_an_error():
    ents = _base()
    errs = R.validate_registry(ents, attributions=ATTR, equity={"USAAA"})
    assert any("collides with a real equity/ETF ticker" in e for e in errs)
    ents[0]["status"] = "disabled"
    ents[2]["status"] = "disabled"
    assert R.validate_registry(ents, attributions=ATTR, equity={"USAAA"}) == []   # reported, not an error


def test_fred_source_is_an_error_even_green_cleared():
    ents = _base()
    ents[0]["source"] = {**ents[0]["source"], "agency": "Federal Reserve Bank of St. Louis (FRED)", "adapter": "bls"}
    _assert_fires(ents, "FRED/ALFRED source on a non-excluded series")
    _assert_fires(ents, "FRED/ALFRED is never a production source")


def test_enabled_weekly_needs_anchor():
    ents = _base()
    ents[0]["frequency"] = "W"
    _assert_fires(ents, "weekly series without a week_anchor")


def test_cohort_derived_needs_cohort_inputs():
    ents = _base()
    ents[0]["cohort"] = False
    _assert_fires(ents, "non-cohort input USAAA")


def test_committed_file_mutations_fire():
    """Mutation check on the REAL registry: break one real entry per rail."""
    real = copy.deepcopy(R.all())
    idx = {e["symbol"]: i for i, e in enumerate(real)}
    cases = [
        ("USUMCSENT", lambda e: e.update(status="enabled"), "USUMCSENT: RED series must be status excluded"),
        ("USMEDCPI", lambda e: e.update(status="enabled"), "USMEDCPI: enabled but not production-eligible"),
        ("USRETAIL", lambda e: e.update(status="enabled"), "USRETAIL: enabled but source.verified is false"),
        ("USCPIYOY", lambda e: e["derivation"].update(inputs=["USCPINOPE"]), "derivation input 'USCPINOPE' missing"),
        ("USCPI", lambda e: e["aliases"].append("uscpinsa"), "alias 'uscpinsa' already belongs"),
    ]
    for sym, mutate, needle in cases:
        ents = copy.deepcopy(real)
        mutate(ents[idx[sym]])
        errs = R.validate_registry(ents)
        assert any(needle in x for x in errs), f"{sym}: {needle!r} not in {errs}"
    # circular on the real file: make USCPINSA derive from USCPIYOY (which derives from it)
    ents = copy.deepcopy(real)
    e = ents[idx["USCPINSA"]]
    e["source"]["adapter"] = "derived"
    e["derivation"] = {"op": "diff", "inputs": ["USCPIYOY"], "params": {}, "version": 1}
    assert any("circular derivation" in x for x in R.validate_registry(ents))


def test_presentation_max_age_days_override_is_validated():
    ok = _base()
    ok[0]["presentation"] = {"style": "line", "max_age_days": 90}
    ok[1]["presentation"] = {"style": "line", "max_age_days": None}      # explicit unlimited
    assert not [e for e in _errs(ok) if "max_age_days" in e]
    for bad in (0, -3, "45", True):
        b = _base()
        b[0]["presentation"] = {"style": "line", "max_age_days": bad}
        assert any("max_age_days" in e for e in _errs(b)), bad


def test_max_age_days_defaults_measure_one_release_interval_plus_grace():
    assert [R.max_age_days({"frequency": f}) for f in ("D", "W", "M", "Q", "A", "IRREG")] == [10, 13, 45, 120, 400, None]
    assert R.max_age_days({"frequency": "M", "presentation": {"max_age_days": 60}}) == 60
