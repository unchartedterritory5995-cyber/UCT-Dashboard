"""D1 — tests for the (vendor, data_class) -> licensing class lookup table."""
from api.services import provider_licensing_class as plc


def test_known_pairs_return_expected_classes():
    # The Bus / DDLA columns, in force since the register's 2026-09-19 note (table restated 2026-11-19).
    assert plc.licensing_class_for("massive", "quotes") == "LA"
    assert plc.licensing_class_for("fmp", "fundamentals") == "LA"
    # Held at R: owner question ESC-11 (transcript AI).
    assert plc.licensing_class_for("fmp", "transcripts") == "R"
    # ESC-03 (Derived Works) ANSWERED BY THE OWNER 2026-11-22: LA, member display.
    assert plc.licensing_class_for("massive", "derived_analytics") == "LA"


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
        # ⚰️ This flipped R -> LA ("Business tier confirmed") while the row still read R. The row reads LA now,
        # so the simulated owner input runs the other way, or the assertion could not tell a change from none.
        plc._TABLE[("massive", "quotes")] = plc.LicensingClassEntry("R", "tier reverted", "T-01")
        assert plc.licensing_class_for("massive", "quotes") == "R"
    finally:
        plc._TABLE.clear()
        plc._TABLE.update(original)
    # Restored — the mutation did not leak into other tests.
    assert plc.licensing_class_for("massive", "quotes") == "LA"


def test_schwab_rows_state_the_registers_recorded_classes():
    """Schwab had no row until 2026-11-17, so every Schwab lookup read 'U' while the
    licensing register recorded the owner's answer (T-77/T-78: LA). The public
    recordings row (T-79) stays R, and equity quotes (no register row) stay
    unregistered: 'U', never inferred from the option rows."""
    assert plc.licensing_class_for("schwab", "option_chains") == "LA"
    assert plc.licensing_class_for("schwab", "option_quotes") == "LA"
    assert plc.licensing_class_for("schwab", "open_interest") == "LA"
    assert plc.licensing_class_for("schwab", "gex_public_recordings") == "R"
    assert plc.licensing_class_for("schwab", "quotes") == "U"
    rows = {dc: e.register_row for (v, dc), e in plc.all_entries().items() if v == "schwab"}
    assert rows == {"option_chains": "T-77", "option_quotes": "T-77", "open_interest": "T-78",
                    "gex_public_recordings": "T-79"}


def test_entry_for_carries_traceability_not_just_the_letter():
    entry = plc.entry_for("massive", "quotes")
    assert entry.licensing_class == "LA"
    assert entry.register_row  # non-empty — every entry cites its source row
    assert entry.note


def test_all_entries_returns_a_copy_not_the_live_table():
    snapshot = plc.all_entries()
    snapshot[("massive", "quotes")] = plc.LicensingClassEntry("X", "tampered", "n/a")
    assert plc.licensing_class_for("massive", "quotes") == "LA"  # unaffected by the copy's mutation
