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
