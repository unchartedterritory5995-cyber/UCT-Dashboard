"""ONE plot-width ceiling, client and server.

The browser's `defSchema.LINE_WIDTH_HARD_MAX` and the server's
`presentation_schema.LINE_WIDTH_HARD_MAX` agree by ONE fixture both suites read:
`tests/fixtures/line_width_cap.json` (the vitest twin is
`app/src/components/chart/engine/__tests__/lineWidthCapParity.test.js`).

- `cases[].ok`: the save door refuses a NEW document carrying an over-cap width.
- `cases[].drawn`: the width the browser draws it at, and the width a COPY (share
  install, fork) stores -- the copy is clamped, not refused.
- `grandfathering[]`: a stored over-cap width is kept while unchanged, whatever else
  about its plot changes, and any change to it is refused.
"""
import json
import pathlib
import sqlite3

import pytest

from api.services import indicator_alert_service as ias
from api.services import presentation_schema as ps
from api.services import user_definitions as svc

ROOT = pathlib.Path(__file__).resolve().parent.parent
FIXTURE = json.loads((ROOT / "tests" / "fixtures" / "line_width_cap.json").read_text(encoding="utf-8"))
OWNER, FRIEND = "u-owner", "u-friend"


def doc(case):
    width = case["width"] if case["as"] == "literal" else "$lineWidth"
    plot = {"key": "value", "style": "line", "color": "#2962FF", "width": width,
            **case.get("plot", {})}
    return {
        "inputs": [{"key": "lineWidth", "type": "int",
                    "default": case["width"] if case["as"] == "input" else 2,
                    "min": 1, "max": max(10, case["width"])}],
        "plots": [plot],
    }


def drawn(d):
    return ps._drawn_width(d["plots"][0], ps._inputs_by_key(d))


def test_one_value_on_both_sides():
    assert ps.LINE_WIDTH_HARD_MAX == FIXTURE["max"]


@pytest.mark.parametrize("case", FIXTURE["cases"], ids=[f"{c['width']}-{c['as']}" for c in FIXTURE["cases"]])
def test_the_ceiling(case):
    codes = [e["code"] for e in ps.presentation_errors(doc(case))]
    assert ("plot-width" not in codes) == case["ok"], codes


def test_a_stored_row_already_over_the_ceiling_is_grandfathered_not_refused():
    over = doc({"width": 10000, "as": "literal"})
    refused, kept = ps.new_presentation_errors(over, stored=over)
    assert refused == [] and [e["code"] for e in kept] == ["plot-width"]


# ── gap 1: the width is grandfathered by key + drawn width, not the plot fingerprint ──

@pytest.mark.parametrize("g", FIXTURE["grandfathering"], ids=[g["name"] for g in FIXTURE["grandfathering"]])
def test_grandfathering_follows_the_width_not_the_rest_of_the_plot(g):
    refused, kept = ps.new_presentation_errors(doc(g["saved"]), stored=doc(g["stored"]))
    assert [e["code"] for e in refused] == (["plot-width"] if g["refused"] else []), refused
    assert [e["code"] for e in kept] == (["plot-width"] if g["kept"] else []), kept


def test_other_codes_keep_the_whole_plot_fingerprint():
    """Only `plot-width` moved off `_plot_fp`: a bad style stored on a plot is still
    re-checked when that plot's colour changes (the pre-existing rule)."""
    stored = {"plots": [{"key": "value", "style": "zones", "color": "#2962FF"}]}
    same = json.loads(json.dumps(stored))
    assert ps.new_presentation_errors(same, stored=stored)[0] == []
    recoloured = json.loads(json.dumps(stored))
    recoloured["plots"][0]["colorUp"] = "#FF0000"
    assert [e["code"] for e in ps.new_presentation_errors(recoloured, stored=stored)[0]] == ["plot-style"]


# ── gap 2: a copy is clamped to the width the browser draws ──────────────────

@pytest.mark.parametrize("case", FIXTURE["cases"], ids=[f"{c['width']}-{c['as']}" for c in FIXTURE["cases"]])
def test_the_copy_clamp_stores_the_drawn_width(case):
    src = doc(case)
    before = json.dumps(src, sort_keys=True)
    out, clamped = ps.clamp_plot_widths(src)
    assert drawn(out) == case["drawn"]
    assert bool(clamped) == (not case["ok"])
    assert "plot-width" not in [e["code"] for e in ps.presentation_errors(out)]
    assert json.dumps(src, sort_keys=True) == before          # never mutates its argument
    if case["ok"]:
        assert out is src
    elif case["as"] == "input":
        lw = out["inputs"][0]
        assert (lw["default"], lw["max"], out["plots"][0]["width"]) == (50, 50, "$lineWidth")


@pytest.fixture
def store(tmp_path, monkeypatch):
    monkeypatch.setattr(svc, "_DB_PATH", str(tmp_path / "user_definitions.db"))
    svc._init_db()
    alert_db = tmp_path / "auth.db"
    monkeypatch.setenv("AUTH_DB_PATH", str(alert_db))
    monkeypatch.setattr(ias, "_DB_PATH", str(alert_db))
    ias.init_schema()


def _definition(def_id, width, as_):
    close = {"type": "series", "name": "close"}
    d = doc({"width": width, "as": as_})
    return {
        "schemaVersion": 1, "id": def_id, "version": 1,
        "meta": {"name": "Wide", "shortName": "W", "repaint": "non-repainting"},
        "compute": {"kind": "ast", "ast": close, "fn": svc.ast_hash(close)},
        "placement": {"target": "price"},
        "plots": [{**d["plots"][0], "role": "primary", "legend": {}}],
        "inputs": [{**d["inputs"][0], "label": "Line width"}],
    }


def _tamper(def_id, d):
    """Write a stored row past the door -- a row saved BEFORE the ceiling."""
    with sqlite3.connect(svc._DB_PATH) as c:
        c.execute("UPDATE user_definitions SET definition = ? WHERE user_id = ? AND def_id = ?",
                  (json.dumps(d), OWNER, def_id))


@pytest.mark.parametrize("as_", ["literal", "input"])
def test_a_shared_over_cap_row_installs_and_forks_CLAMPED(store, as_):
    def_id = svc.new_def_id()
    svc.save(OWNER, def_id, _definition(def_id, 4, as_))
    _tamper(def_id, _definition(def_id, 10000, as_))
    token = svc.share(OWNER, def_id)["token"]
    installed = svc.get(FRIEND, svc.install_share(FRIEND, token)["def_id"])["definition"]
    forked = svc.get(OWNER, svc.fork(OWNER, def_id)["def_id"])["definition"]
    for copy in (installed, forked):
        assert drawn(copy) == FIXTURE["max"]
        assert ps.presentation_errors(copy) == []
    # the author's own row is untouched -- only the copy is repaired
    assert drawn(svc.get(OWNER, def_id)["definition"]) == 10000


def test_a_legacy_over_cap_row_saves_with_an_unrelated_edit_but_not_a_raised_width(store):
    def_id = svc.new_def_id()
    svc.save(OWNER, def_id, _definition(def_id, 4, "literal"))
    _tamper(def_id, _definition(def_id, 60, "literal"))
    restyled = _definition(def_id, 60, "literal")
    restyled["plots"][0]["style"] = "stepline"
    svc.save(OWNER, def_id, restyled)
    raised = _definition(def_id, 10000, "literal")
    raised["plots"][0]["style"] = "stepline"
    with pytest.raises(svc.SaveRefused) as exc:
        svc.save(OWNER, def_id, raised)
    assert exc.value.guard == "presentation:plot-width"
