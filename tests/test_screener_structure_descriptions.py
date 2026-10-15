"""The Base Structure filter's options carry each structure's description.

The Focus layout's setup tags read `preset.desc` for their tooltip; the text
comes from the registry (`base_catalog.Structure.desc`), never a client copy.
"""
from api.services.screener import base_catalog, filters


def _structures_by_label():
    return {s.label: s for s in base_catalog.ALL_STRUCTURES}


def test_every_structure_option_ships_its_registry_description():
    by_label = _structures_by_label()
    opts = [o for o in base_catalog.enum_options() if o.get("label") != "Any"]
    assert opts, "no structure options: the check below would pass over nothing"
    for o in opts:
        s = by_label[o["label"]]
        assert o["desc"] == s.desc
        assert isinstance(o["desc"], str) and o["desc"].strip()


def test_the_any_option_carries_no_description():
    any_opt = base_catalog.enum_options()[0]
    assert any_opt == {"label": "Any"}


def test_the_meta_payload_passes_the_descriptions_through(monkeypatch):
    # Stub every read the shared builder makes of a database or ledger, so only
    # the preset pass-through is under test.
    monkeypatch.setattr(filters, "_distinct_options", lambda col: [{"label": "Any"}])
    monkeypatch.setattr(filters, "_distinct_list_options", lambda col: [{"label": "Any"}])
    monkeypatch.setattr(filters, "_structure_evidence", lambda: None)
    built = filters._build_shared_filters({})
    entries = built if isinstance(built, list) else built.get("filters", built)
    entry = next(f for f in entries if f["key"] == "base_structure")
    named = [p for p in entry["presets"] if p.get("label") != "Any"]
    assert named and all(p.get("desc") for p in named)
    # a control: a filter whose presets never carried a description still has none
    other = next(f for f in entries if f["key"] == "consecutive_up")
    assert not any("desc" in p for p in other["presets"])
