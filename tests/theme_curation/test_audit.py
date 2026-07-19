from datetime import date
from tools.theme_curation import audit


def _now_days():
    return date(2025, 7, 18).toordinal()


def test_dead_dup_thin_and_gap():
    tax = {"themes": [
        {"id": "space", "name": "Space", "sector_id": "innov", "holdings": [
            {"sym": "RKLB"}, {"sym": "ASTS"}, {"sym": "DEADCO"}, {"sym": "RKLB"},  # dup + dead
        ]},
        {"id": "thintheme", "name": "Thin", "sector_id": "innov",
         "holdings": [{"sym": "AAA"}]},  # thin
    ]}
    cap = {"RKLB", "ASTS", "AAA", "SNDK", "VLTO"}
    ipo = {"SNDK": "2025-02-01", "VLTO": "2023-09-30"}  # SNDK recent, VLTO aged
    r = audit.audit_taxonomy(tax, cap, ipo, _now_days())
    assert "DEADCO" in r["themes"]["space"]["dead"]
    assert "RKLB" in r["themes"]["space"]["dups"]
    assert r["themes"]["thintheme"]["thin"] is True
    gp = {g["sym"]: g for g in r["gap_pool"]}
    assert "SNDK" in gp and gp["SNDK"]["aged_out"] is False   # in cap, in no theme, recent
    assert gp["VLTO"]["aged_out"] is True                     # aged IPO


def test_write_audit_md_smoke():
    tax = {"themes": [{"id": "space", "name": "Space", "sector_id": "innov",
                       "holdings": [{"sym": "RKLB"}]}]}
    r = audit.audit_taxonomy(tax, {"RKLB"}, {}, _now_days())
    md = audit.write_audit_md(r, tax)
    assert "Space" in md and "# " in md


def test_dead_syms_collects_union_absent_from_cap():
    tax = {"themes": [
        {"id": "a", "holdings": [{"sym": "LIVE"}, {"sym": "GONE"}]},
        {"id": "b", "holdings": [{"sym": "GONE"}, {"sym": "OFFCAP"}]},
    ]}
    assert audit.dead_syms(tax, {"LIVE"}) == {"GONE", "OFFCAP"}


def test_liveness_split_moves_live_names_off_dead():
    # GONE is delisted (not live) -> stays 'dead'; OFFCAP still trades -> 'off_universe'
    tax = {"themes": [{"id": "a", "name": "A", "sector_id": "s", "holdings": [
        {"sym": "LIVE"}, {"sym": "GONE"}, {"sym": "OFFCAP"}]}]}
    cap = {"LIVE"}
    r = audit.audit_taxonomy(tax, cap, {}, _now_days(), live={"OFFCAP"})
    flags = r["themes"]["a"]
    assert flags["dead"] == ["GONE"]              # delisted only
    assert flags["off_universe"] == ["OFFCAP"]    # live but off cap_universe
    # None => no split (backward compatible): both not-in-cap names stay 'dead'
    r2 = audit.audit_taxonomy(tax, cap, {}, _now_days(), live=None)
    assert set(r2["themes"]["a"]["dead"]) == {"GONE", "OFFCAP"}
    assert r2["themes"]["a"]["off_universe"] == []


def test_write_audit_md_renders_cap_gap_worklist():
    tax = {"themes": [{"id": "a", "name": "Fintech", "sector_id": "fin", "holdings": [
        {"sym": "V"}, {"sym": "FI"}]}]}
    r = audit.audit_taxonomy(tax, {"V"}, {}, _now_days(), live={"FI"})
    md = audit.write_audit_md(r, tax)
    assert "cap_universe gap" in md
    assert "FI — Fintech" in md                   # sym -> theme names, add-to-cap worklist
    assert "off cap_universe" in md               # per-theme label
