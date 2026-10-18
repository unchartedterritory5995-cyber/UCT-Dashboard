"""P4b: sharing a page layout through the community library."""
from __future__ import annotations

import itertools

import pytest

from api.services.journal_two import template_gallery as gallery

SWITCHES = ("NOTEBOOK_STYLE_LIBRARY_ENABLED", "JOURNAL_PAGE_LAYOUTS_ENABLED", "NOTEBOOK_LAYOUT_SHARING_ENABLED")


def _set(monkeypatch, on: dict[str, bool]) -> None:
    for name in SWITCHES:
        monkeypatch.setenv(name, "1" if on.get(name) else "0")


@pytest.mark.parametrize("combo", list(itertools.product((False, True), repeat=3)))
def test_layout_sharing_needs_all_three_switches(monkeypatch, combo):
    _set(monkeypatch, dict(zip(SWITCHES, combo)))
    assert gallery.layout_sharing_enabled() is all(combo)


def test_layout_sharing_is_read_per_call(monkeypatch):
    _set(monkeypatch, {n: True for n in SWITCHES})
    assert gallery.layout_sharing_enabled() is True
    monkeypatch.setenv("NOTEBOOK_LAYOUT_SHARING_ENABLED", "0")
    assert gallery.layout_sharing_enabled() is False


@pytest.mark.parametrize("value", ["", "maybe", "2", "off", "no"])
def test_an_unrecognised_value_is_off(monkeypatch, value):
    _set(monkeypatch, {n: True for n in SWITCHES})
    monkeypatch.setenv("NOTEBOOK_LAYOUT_SHARING_ENABLED", value)
    assert gallery.layout_sharing_enabled() is False


def test_the_switch_is_server_only():
    from api.routers import auth
    assert "NOTEBOOK_LAYOUT_SHARING_ENABLED" not in auth.NOTEBOOK_FLAGS   # R-P4b-10: no payload key, +0 B
