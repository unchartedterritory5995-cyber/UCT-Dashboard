"""Data unit S4-0 (2026-11-19): the Pine data families and the licence rows they rest on.

What these rails hold:
  * the three licensing-table pairs S4-0 adds (SEC fundamentals A, FINRA short interest / short volume LA)
    restate their register rows (T-83, T-93, T-94);
  * every family's GENERATED `licence` block equals the live table (one authority, one mirror);
  * a family is served only when its pair is A or LA and it carries no hold, and a pair flipped to R
    refuses the family BY NAME (the capability, not a flag);
  * no sentence the member can see names a vendor (register T-46);
  * today's state, by name: which families serve and why the rest do not.
"""
from __future__ import annotations

import json
import re

import pytest

from api.services import pine_data_catalog as cat
from api.services import provider_licensing_class as plc


def _cat():
    return cat.load()


def test_the_three_rows_s4_0_adds_restate_their_register_rows():
    assert plc.entry_for("sec_edgar", "fundamentals").licensing_class == "A"
    assert plc.entry_for("sec_edgar", "fundamentals").register_row == "T-83"
    assert plc.entry_for("massive", "short_interest").licensing_class == "LA"
    assert plc.entry_for("massive", "short_interest").register_row == "T-93"
    assert plc.entry_for("massive", "short_volume").licensing_class == "LA"
    assert plc.entry_for("massive", "short_volume").register_row == "T-94"


def test_the_stale_rows_were_restated_in_their_own_unit():
    """⚰️ Was `test_s4_0_restates_no_stale_row` (coordinator ruling C1, 2026-11-19: the stale rows switch other
    consumers and are their own unit). That unit landed the same day: the register's 2026-09-19 note puts the DDLA /
    Bus column in force, so FMP earnings (T-35/T-36) and Massive reference (T-07) read LA. Massive derived analytics
    stays R: ESC-03 (does the Business grant reach Derived Works) is an open owner question."""
    assert plc.licensing_class_for("fmp", "earnings") == "LA"
    assert plc.entry_for("fmp", "earnings").register_row == "T-35/T-36"
    assert plc.licensing_class_for("massive", "reference") == "LA"
    assert plc.licensing_class_for("massive", "derived_analytics") == "R"


def test_every_generated_licence_block_equals_the_live_table():
    c = _cat()
    assert cat.stale_families(c) == [], (
        "a family's licence block disagrees with provider_licensing_class.py: "
        "run python -m api.services.pine_data_catalog --write")
    for fam, spec in c["families"].items():
        entry = plc.entry_for(spec["vendor"], spec["dataClass"])
        assert spec["licence"] == {"class": entry.licensing_class, "registerRow": entry.register_row}, fam


def test_the_generator_is_idempotent_on_the_committed_file():
    c = _cat()
    assert cat.render(cat.with_licence_blocks(c)) == cat.CATALOG_PATH.read_text(encoding="utf-8")
    assert cat.main(["--check"]) == 0


def test_check_fails_when_a_block_is_tampered():
    c = _cat()
    c["families"]["financial"]["licence"] = {"class": "LA", "registerRow": "T-83"}
    assert cat.stale_families(c) == ["financial"]


@pytest.mark.parametrize("family", sorted(json.loads(cat.CATALOG_PATH.read_text(encoding="utf-8"))["families"]))
def test_a_family_serves_only_on_A_or_LA_and_refuses_by_name_on_R(family, monkeypatch):
    c = _cat()
    spec = c["families"][family]
    spec.pop("hold", None)
    pair = (spec["vendor"], spec["dataClass"])
    monkeypatch.setitem(plc._TABLE, pair, plc.LicensingClassEntry("LA", "test", "T-TEST"))
    assert cat.family_refusal(family, c) is None
    monkeypatch.setitem(plc._TABLE, pair, plc.LicensingClassEntry("A", "test", "T-TEST"))
    assert cat.family_refusal(family, c) is None
    for cls in ("R", "U", "X"):
        monkeypatch.setitem(plc._TABLE, pair, plc.LicensingClassEntry(cls, "test", "T-TEST"))
        guard, sentence = cat.family_refusal(family, c)
        assert guard == cat.LICENCE_GUARD
        assert f"licensing class {cls} " in sentence
        assert "licensing register row T-TEST" in sentence
        assert spec["label"] in sentence
        for name in spec["pine"]:
            assert f"`{name}`" in sentence


def test_the_rendered_licence_sentence_is_the_one_the_chart_renders(monkeypatch):
    """The same literal as pineDataCatalog.test.js: both readers fill one template from one file."""
    monkeypatch.setitem(plc._TABLE, ("sec_edgar", "fundamentals"), plc.LicensingClassEntry("R", "test", "T-83"))
    assert cat.family_refusal("financial") == (
        "pine-data:licence",
        "Not served: `request.financial`. The financial data rests on licensing class R "
        "(licensing register row T-83), and a member's script reads only data classed A or LA.")


def test_a_hold_refuses_by_name_after_the_licence_passes():
    guard, sentence = cat.family_refusal("uct_short_interest")
    assert guard == "pine-data:owner-hold"
    assert "`uct.short_interest`, `uct.days_to_cover`" in sentence and "O7" in sentence
    guard, sentence = cat.family_refusal("uct_short_volume")
    assert guard == "pine-data:owner-hold" and "O7" in sentence


def test_unknown_names_and_unserved_fields_refuse_by_name():
    assert cat.family_refusal("nope")[0] == cat.UNKNOWN_GUARD
    assert cat.name_refusal("request.security")[0] == cat.UNKNOWN_GUARD
    guard, sentence = cat.name_refusal("earnings.standardized")
    assert guard == cat.FIELD_GUARD and "`earnings.standardized`" in sentence
    assert cat.family_of("UCT:COT:GC") == "uct_cot"          # the longest declared prefix wins
    assert cat.family_of("UCT:UCTA50") == "uct_breadth"
    assert cat.family_of("UCT:UCTFG") == "uct_sentiment"
    assert cat.family_of("earnings.actual") == "earnings"


def test_today_by_name():
    """What the catalogue serves and refuses today. If a register restatement moves a class, regenerate the blocks
    and update this list in that unit, on purpose. ⚰️ 2026-11-19 (ruling C1's own unit): earnings (T-35/T-36) and
    dividends / splits (T-07) moved from pine-data:licence to served when the table followed the register's 2026-09-19
    note. Nothing reads the catalogue at runtime yet (S4-3 onward), so no member sees the change today."""
    got = {fam: (cat.family_refusal(fam) or ("served",))[0] for fam in cat.families()}
    assert got == {
        "earnings": "served", "dividends": "served", "splits": "served",
        "financial": "served",
        "uct_rs_rating": "pine-data:licence", "uct_rs_line": "pine-data:licence", "uct_breadth": "pine-data:licence",
        "uct_cot": "pine-data:licence",
        "uct_short_interest": "pine-data:owner-hold", "uct_short_volume": "pine-data:owner-hold",
        "uct_sentiment": "pine-data:licence",
    }


def _vendor_patterns(c):
    names = set(c["vendorNames"])
    names |= {v for (v, _dc) in plc.all_entries()}          # every vendor key the table knows
    names |= {spec["vendor"] for spec in c["families"].values()}
    names -= {"unregistered"}
    return [re.compile(r"(?<![A-Za-z])" + re.escape(n.replace("_", " ")) + r"(?![A-Za-z])", re.IGNORECASE)
            for n in sorted(names)] + [re.compile(r"(?<![A-Za-z])" + re.escape(n) + r"(?![A-Za-z])", re.IGNORECASE)
                                       for n in sorted(names) if "_" in n]


def test_no_member_facing_sentence_names_a_vendor(monkeypatch):
    c = _cat()
    pats = _vendor_patterns(c)
    texts = []
    for fam, spec in c["families"].items():
        texts.append(("disclosure", fam, spec["disclosure"]))
        texts += [("field", n, r) for n, r in spec.get("refusedNames", {}).items()]
        if spec.get("hold"):
            texts.append(("hold", fam, spec["hold"]["reason"]))
        # every refusal sentence, under every class, with the member's own spellings blanked out
        for cls in ("R", "U", "LA"):
            monkeypatch.setitem(plc._TABLE, (spec["vendor"], spec["dataClass"]),
                                plc.LicensingClassEntry(cls, "test", "T-TEST"))
            out = cat.family_refusal(fam, c)
            if out:
                texts.append(("refusal", fam, out[1].replace(cat._names(spec), "NAMES")))
    texts += [("template", k, v) for k, v in c["sentences"].items()]
    hits = [(kind, who, p.pattern) for kind, who, text in texts for p in pats if p.search(text)]
    assert hits == []


def test_the_vendor_list_covers_every_vendor_the_table_names():
    c = _cat()
    spelled = {n.lower().replace(" ", "") for n in c["vendorNames"]}
    for vendor in {v for (v, _dc) in plc.all_entries()}:
        key = vendor.replace("_edgar", "").replace("_", "").lower()
        assert key in spelled or vendor.lower() in spelled, vendor


def test_tradingview_families_say_they_are_not_tradingviews():
    for fam, spec in cat.families().items():
        assert "UCT" in spec["disclosure"], fam
        if spec["namespace"] == "tradingview":
            assert spec["disclosure"].endswith("not TradingView's."), fam


def test_every_pine_name_has_one_family():
    seen = {}
    for fam, spec in cat.families().items():
        for name in list(spec["pine"]) + list(spec.get("refusedNames", {})):
            assert name not in seen, f"{name} is declared by {seen.get(name)} and {fam}"
            seen[name] = fam


def test_values_never_leave_the_product_by_default():
    assert _cat()["rules"]["valuesLeaveProduct"] is False
