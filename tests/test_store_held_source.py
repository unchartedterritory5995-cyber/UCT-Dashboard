"""e95 unit 2 (ruling F1) -- the THIRD held kind: a hand-added built-in graded on its published source, held locally.

A row graded on it carries ``sourceHeld`` (``source/<STD id>@<sha256>``); a run names what it held in
``sourceHeldStore`` ([{id, sha256}]); a run without it names the row "source-held", never MATCH or DIVERGE.
"""
from __future__ import annotations

from tools.vendor_harness import store_held as sh

SHA = "670d21c04b7d81b5ec5dfd0d614386628b8e020a1f2e12514a9ae83b77bb1541"
PIN = "source/STD;VWAP@" + SHA


def test_a_source_pin_parses_and_is_its_own_kind():
    assert sh.parse_pin(PIN) == ("source/STD;VWAP", SHA)
    assert sh.kind_of(PIN) == "source"
    assert sh.kind_of("supply/x-1d-2026-11-20@" + SHA) == "supply"
    assert sh.kind_of("Author/Lib/1@" + SHA) == "store"


def test_a_row_without_the_source_is_named_source_held_and_with_it_is_graded():
    row = {"file": "builtin-vwap-anchor-earnings-aapl-1d.json", "verdict": "MATCH", "sourceHeld": [PIN]}
    assert sh.pins_of(row) == [PIN]
    assert sh.held_from(row, set()) == [PIN]
    assert sh.reading(sh.held_from(row, set())) == "source-held: " + PIN
    held = sh.store_pins({"libraryStore": [], "sourceHeldStore": [{"id": "STD;VWAP", "sha256": SHA}]})
    assert PIN in held and sh.held_from(row, held) == []


def test_the_other_kinds_read_as_they_always_did():
    store = "Author/Lib/1@" + SHA
    assert sh.reading([store]) == "store-held: " + store
    both = sh.reading(sorted([store, PIN]))
    assert both == "store-held: " + store + "; source-held: " + PIN
