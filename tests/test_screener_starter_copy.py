import os
import re

from api.services.screener import saved_screens
from api.services.screener.saved_screens import PATTERN_PRESETS, starters

GROUPS = {"Momentum leaders", "Breakouts & entries", "Bases & chart patterns", "Earnings", "Quality & value"}
_JS = os.path.join(os.path.dirname(__file__), "..", "app", "src", "pages", "screener", "focus", "screenGroups.js")


def _all(monkeypatch):
    monkeypatch.setenv(saved_screens.PATTERN_PRESETS_FLAG, "1")
    return starters()


def test_every_starter_has_a_description(monkeypatch):
    for s in _all(monkeypatch):
        d = s.get("description") or ""
        assert 10 <= len(d) <= 80, (s["id"], d)
        assert "—" not in d and "–" not in d and " - " not in d, s["id"]
        assert d.isascii(), s["id"]


def test_every_preset_has_a_group(monkeypatch):
    for s in _all(monkeypatch):
        if s["id"].startswith("starter_pattern_"):
            assert s["group"] == "Chart Patterns", s["id"]
        else:
            assert s.get("group") in GROUPS, s["id"]


def test_descriptions_are_unique(monkeypatch):
    ds = [s["description"] for s in _all(monkeypatch)]
    assert len(ds) == len(set(ds))


def test_every_pattern_preset_has_its_own_description():
    assert set(saved_screens.PATTERN_DESCRIPTIONS) == {p for p, _ in PATTERN_PRESETS}


def test_all_keys_present(monkeypatch):
    for s in _all(monkeypatch):
        assert set(s) >= {"id", "name", "spec", "group", "description"}


def test_server_groups_match_the_clients_fallback_map():
    """Parses the client's FALLBACK_GROUP (screenGroups.js) so the two cannot drift."""
    js = open(_JS, encoding="utf-8").read()
    label_to_key = {m.group(2): m.group(1) for m in
                    re.finditer(r"key: '(\w+)', label: '([^']+)'", js)}
    body = re.search(r"FALLBACK_GROUP = \{(.*?)\n\}", js, re.S).group(1)
    fallback = dict(re.findall(r"(\w+): '(\w+)'", body))
    assert fallback and label_to_key
    for s in starters():
        assert label_to_key[s["group"]] == fallback[s["id"]], s["id"]
    assert {s["id"] for s in starters()} == set(fallback)
