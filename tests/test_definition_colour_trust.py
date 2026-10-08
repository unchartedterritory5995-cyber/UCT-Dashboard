"""Hardening 1 + 2 -- presentation colours are colours, and a definition carries a version.

⚰️ THE COLOUR GAP (inventory 2026-10-08). A definition's plot / paint / colour-setting
values were checked only as "a non-empty string" and the legend wrote them into inline
CSS, so a hand-crafted definition SHARED to a second member (install -> add to chart)
made the recipient's browser fetch a URL. The renderers now write only safe colours
(`objectColour.safeCssColour`); here, the server refuses to STORE one: every save, and
strictly on a copy (share install, fork). A legacy row keeps an unchanged value
(recorded, not enforced) -- no migration.

⚰️ THE VERSION MISMATCH (prod 2026-10-08). The server stored a definition POSTed without
`version`; every browser refused it ("version: required integer >= 1"). The save door
now requires it (as the browser does); a legacy row without one is SERVED with its row's.
"""
from __future__ import annotations

import json
import pathlib
import shutil
import sqlite3
import subprocess

import pytest

from api.services import indicator_alert_service as ias
from api.services import presentation_schema as ps
from api.services import user_definitions as svc

ROOT = pathlib.Path(__file__).resolve().parents[1]
CASES = json.loads((ROOT / "tests/fixtures/ast/object_colour_cases.json").read_text(encoding="utf-8"))
OWNER, FRIEND = "u-owner", "u-friend"
EVIL = "url(https://evil.example/x)"


@pytest.fixture(autouse=True)
def store(tmp_path, monkeypatch):
    monkeypatch.setattr(svc, "_DB_PATH", str(tmp_path / "user_definitions.db"))
    svc._init_db()
    alert_db = tmp_path / "auth.db"
    monkeypatch.setenv("AUTH_DB_PATH", str(alert_db))
    monkeypatch.setattr(ias, "_DB_PATH", str(alert_db))
    ias.init_schema()


def _definition(def_id, *, colour="#c9a84c", version=1):
    close = {"type": "series", "name": "close"}
    doc = {
        "schemaVersion": 1, "id": def_id,
        "meta": {"name": "Coloured", "shortName": "COL", "repaint": "non-repainting"},
        "compute": {"kind": "ast", "ast": close, "fn": svc.ast_hash(close)},
        "placement": {"target": "price"},
        "plots": [{"key": "value", "style": "line", "role": "primary", "color": "$color", "legend": {}}],
        "inputs": [{"key": "color", "label": "Color", "type": "color", "default": colour}],
    }
    if version is not None:
        doc["version"] = version
    return doc


def _tamper(def_id, doc):
    """Write a stored row past the door -- a row saved BEFORE this rule."""
    with sqlite3.connect(svc._DB_PATH) as c:
        c.execute("UPDATE user_definitions SET definition = ? WHERE user_id = ? AND def_id = ?",
                  (json.dumps(doc), OWNER, def_id))


# ── the grammar ────────────────────────────────────────────────────────────────

@pytest.mark.skipif(shutil.which("node") is None, reason="node not on PATH")
def test_the_grammar_is_the_browser_s():
    js = (ROOT / "app/src/components/chart/engine/objectColour.js").as_uri()
    src = subprocess.run(["node", "--input-type=module", "-e",
                          f"import {{ PRESENTATION_COLOUR }} from {json.dumps(js)}; process.stdout.write(PRESENTATION_COLOUR.source)"],
                         capture_output=True, text=True, timeout=60).stdout
    assert src == ps.PRESENTATION_COLOUR.pattern


@pytest.mark.parametrize("value", CASES["presentation"]["accept"])
def test_accepted(value):
    assert ps.is_presentation_colour(value)


@pytest.mark.parametrize("value", CASES["presentation"]["reject"])
def test_refused(value):
    assert not ps.is_presentation_colour(value)


# ── every field, at the save door ───────────────────────────────────────────────

@pytest.mark.parametrize("where", ["input-default", "plot-color", "colorUp", "palette", "gradient", "fillColor", "paint"])
def test_an_unsafe_colour_in_any_field_is_refused_and_nothing_is_stored(where):
    def_id = svc.new_def_id()
    doc = _definition(def_id)
    plot = doc["plots"][0]
    if where == "input-default":
        doc["inputs"][0]["default"] = EVIL
    elif where == "plot-color":
        plot["color"] = EVIL
    elif where == "colorUp":
        plot.update(colorMode="sign", colorUp=EVIL, colorDown="#ff0000")
    elif where == "palette":
        plot["colorPalette"] = ["#ffffff", EVIL]
    elif where == "gradient":
        plot["colorGradient"] = {"from": "#000000", "to": EVIL}
    elif where == "fillColor":
        plot["fillColor"] = EVIL
    elif where == "paint":
        doc["paints"] = [{"kind": "bgcolor", "color": EVIL, "colorMode": "column:value"}]
    with pytest.raises(svc.SaveRefused) as exc:
        svc.save(OWNER, def_id, doc)
    assert exc.value.guard == "presentation:colour", str(exc.value)
    assert svc.get(OWNER, def_id) is None


def test_the_colour_guard_names_itself():
    def_id = svc.new_def_id()
    with pytest.raises(svc.SaveRefused) as exc:
        svc.save(OWNER, def_id, _definition(def_id, colour=EVIL))
    assert exc.value.guard == "presentation:colour"


@pytest.mark.parametrize("ok", ["#c9a84c", "rgba(41, 98, 255, .2)", "hsl(210, 50%, 40%)", "red", "token:info"])
def test_legitimate_colours_save_and_reopen_unchanged(ok):
    def_id = svc.new_def_id()
    svc.save(OWNER, def_id, _definition(def_id, colour=ok))
    assert svc.get(OWNER, def_id)["definition"]["inputs"][0]["default"] == ok


# ── legacy rows, edits, copies ─────────────────────────────────────────────────

def test_a_legacy_row_keeps_an_unchanged_unsafe_colour_but_an_edit_may_not_introduce_one():
    def_id = svc.new_def_id()
    svc.save(OWNER, def_id, _definition(def_id))
    _tamper(def_id, _definition(def_id, colour=EVIL))          # stored before the rule
    # an edit that leaves the stored value as it is still saves (no migration)…
    unchanged = _definition(def_id, colour=EVIL, version=2)
    unchanged["meta"]["name"] = "Renamed"
    svc.save(OWNER, def_id, unchanged)
    # …but an edit that introduces a NEW unsafe value is refused
    worse = _definition(def_id, colour=EVIL, version=3)
    worse["plots"][0]["fillColor"] = "var(--leak)"
    with pytest.raises(svc.SaveRefused) as exc:
        svc.save(OWNER, def_id, worse)
    assert exc.value.guard == "presentation:colour"


def test_a_SHARED_legacy_unsafe_row_is_refused_at_install_and_at_fork():
    def_id = svc.new_def_id()
    svc.save(OWNER, def_id, _definition(def_id))
    _tamper(def_id, _definition(def_id, colour=EVIL))
    token = svc.share(OWNER, def_id)["token"]
    with pytest.raises(svc.SaveRefused) as exc:
        svc.install_share(FRIEND, token)
    assert exc.value.guard == "presentation:colour"
    with sqlite3.connect(svc._DB_PATH) as c:
        assert c.execute("SELECT COUNT(*) FROM user_definitions WHERE user_id = ?", (FRIEND,)).fetchone()[0] == 0
    with pytest.raises(svc.SaveRefused):
        svc.fork(OWNER, def_id)


def test_a_safe_shared_definition_still_installs_and_forks():
    def_id = svc.new_def_id()
    svc.save(OWNER, def_id, _definition(def_id, colour="rgba(41, 98, 255, .2)"))
    token = svc.share(OWNER, def_id)["token"]
    assert svc.install_share(FRIEND, token)
    assert svc.fork(OWNER, def_id)


# ── the version contract ───────────────────────────────────────────────────────

@pytest.mark.parametrize("bad", [None, 0, -1, "1", True, 1.5])
def test_a_definition_without_a_valid_version_is_refused_at_save(bad):
    """ASKED: POST a document with no / a non-integer version (the measured prod case:
    no version). DID: refused before anything is stored -- the browser would refuse to
    draw it."""
    def_id = svc.new_def_id()
    doc = _definition(def_id, version=bad)
    if bad is None:
        doc.pop("version", None)
    with pytest.raises(ValueError, match="version"):
        svc.save(OWNER, def_id, doc)
    assert svc.get(OWNER, def_id) is None


def test_a_LEGACY_row_without_a_version_is_served_with_its_row_version():
    def_id = svc.new_def_id()
    svc.save(OWNER, def_id, _definition(def_id))
    legacy = _definition(def_id)
    legacy.pop("version")
    _tamper(def_id, legacy)
    got = svc.get(OWNER, def_id)
    assert got["definition"]["version"] == got["version"] == 1
    # …and it can be shared and installed (the install door reads through the same path)
    token = svc.share(OWNER, def_id)["token"]
    assert svc.install_share(FRIEND, token)
