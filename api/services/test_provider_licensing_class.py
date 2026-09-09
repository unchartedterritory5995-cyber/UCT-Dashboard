"""D1 — tests for the (vendor, data_class) -> licensing class lookup table."""
from api.services import provider_licensing_class as plc


def test_known_pairs_return_expected_classes():
    assert plc.licensing_class_for("massive", "quotes") == "R"
    assert plc.licensing_class_for("fmp", "fundamentals") == "R"


def test_unknown_pair_returns_unknown_never_a_permissive_default():
    """A pair with no researched row must never silently read as 'A'
    (Allowed) — that would be inventing an eligibility fact this system
    has no basis for."""
    assert plc.licensing_class_for("nonexistent_vendor", "made_up_class") == "U"


def test_changing_the_table_changes_every_consumer_with_zero_code_change():
    """PRD acceptance criterion 6 / spec §20's reversibility requirement:
    a single row's value change is visible everywhere the lookup is called,
    with no adapter code touched. Simulated here by monkeypatching the
    table's own module-level dict (the shape a real OI-03 resolution would
    edit) and confirming the SAME accessor function reflects it immediately."""
    original = dict(plc._TABLE)
    try:
        plc._TABLE[("massive", "quotes")] = plc.LicensingClassEntry("LA", "Business tier confirmed", "T-01")
        assert plc.licensing_class_for("massive", "quotes") == "LA"
    finally:
        plc._TABLE.clear()
        plc._TABLE.update(original)
    # Restored — the mutation did not leak into other tests.
    assert plc.licensing_class_for("massive", "quotes") == "R"


def test_entry_for_carries_traceability_not_just_the_letter():
    entry = plc.entry_for("massive", "quotes")
    assert entry.licensing_class == "R"
    assert entry.register_row  # non-empty — every entry cites its source row
    assert entry.note


def test_all_entries_returns_a_copy_not_the_live_table():
    snapshot = plc.all_entries()
    snapshot[("massive", "quotes")] = plc.LicensingClassEntry("X", "tampered", "n/a")
    assert plc.licensing_class_for("massive", "quotes") == "R"  # unaffected by the copy's mutation
