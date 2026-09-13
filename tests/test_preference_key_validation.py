"""B6 — `POST /api/auth/preferences` key allow-list + `joystick_hub` schema.

⭐ WHAT THIS RAIL IS FOR. The endpoint now refuses a key it does not know. That
is the fix AND the risk: a key the shipped client writes but the allow-list
lacks is a 400 in a member's face on a gesture that used to work, and nothing in
the backend can notice — the client's `setPref` reports the failure and changes
nothing (`usePreferences.js`, "the settle contract"), so the member just sees a
setting that will not stick.

So the accept-side rail does NOT restate a list of keys. It RE-DERIVES the set
from `app/src/**` — every key literal handed to `setPref`/`setPrefMerged`, with
local and imported `const` names resolved — and drives each one at the real
router through a real client. Add a key to the client without adding it here and
this goes red at the key, by name.

⛔ AND NOT FROM PRODUCTION DATA. Every expectation below comes from the code's
own authorities:
  - the key set from the client's own call sites;
  - the `joystick_hub` defaults from `HUB_SETTINGS_DEFAULTS` in
    `app/src/hub/useHubSettings.js`;
  - the three numeric bounds from the ONLY control that writes them,
    `JoystickSettingsCard.jsx`'s `<NumberSetting min= max=>` sliders.
A bound changed in the UI without changing the server goes red here.

⛔ NON-VACUITY. Three of these tests derive a set by scanning files. Each one
asserts the set is non-empty AND contains a named sentinel it must contain, so a
scan that silently matches nothing fails instead of passing with zero cases.
"""
from __future__ import annotations

import json
import os
import re

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.routers import auth as auth_router
from tests.authclients import PAID_MEMBER, authorize

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
APP_SRC = os.path.join(REPO, "app", "src")
HUB_SETTINGS_JS = os.path.join(APP_SRC, "hub", "useHubSettings.js")
SETTINGS_CARD_JSX = os.path.join(APP_SRC, "pages", "settings", "JoystickSettingsCard.jsx")


@pytest.fixture(scope="module")
def client():
    """The REAL auth router, mounted at its own prefix, behind a real client.

    The identity is overridden (`authorize`), never the gate — `authclients`'
    rule. Everything this rail measures (the Pydantic model, the validator, the
    write) runs exactly as it does in `api.main`.
    """
    # The repo-root conftest already points AUTH_DB_PATH at a per-session
    # sandbox; this creates the schema inside it so the write path is real.
    from api.services import auth_db

    auth_db.init_db()
    app = FastAPI()
    app.include_router(auth_router.router)
    authorize(app, PAID_MEMBER)
    return TestClient(app)


# ── Deriving the client's key set ────────────────────────────────────────────

_CALL = re.compile(r"\b(?:setPref|setPrefMerged|deletePref)\s*\(\s*([A-Za-z0-9_$'\"]+)")
_LOCAL_CONST = re.compile(r"\bconst\s+([A-Za-z0-9_$]+)\s*=\s*['\"]([^'\"]*)['\"]")
_EXPORT_CONST = re.compile(r"\bexport\s+const\s+([A-Za-z0-9_$]+)\s*=\s*['\"]([^'\"]*)['\"]")
_IMPORT = re.compile(r"import\s*\{([^}]*)\}\s*from\s*['\"]([^'\"]+)['\"]")

#: Call sites whose first argument is a forwarded parameter, not a key. Each is
#: accounted for by a named authority rather than waved through:
#:   - `usePreferences.js` IS the hook — its `setPref(key, …)` is the definition.
#:   - `ChartsWorkspace.jsx` loops `WIDGET_GLOBAL_PREF_KEYS`, asserted separately.
#:   - the two `usePreferences` test files pass their own fixture's key.
_FORWARDED_PARAM_NAMES = {"key"}


def _iter_sources():
    for dirpath, dirnames, filenames in os.walk(APP_SRC):
        dirnames[:] = [d for d in dirnames if d not in ("node_modules", "__snapshots__")]
        for name in filenames:
            if name.endswith((".js", ".jsx")):
                yield os.path.join(dirpath, name)


def _read(path):
    with open(path, "r", encoding="utf-8", errors="replace") as fh:
        return fh.read()


def _exported_consts():
    """`module path -> {NAME: 'value'}` for every `export const NAME = 'literal'`."""
    out = {}
    for path in _iter_sources():
        found = dict(_EXPORT_CONST.findall(_read(path)))
        if found:
            out[os.path.normcase(os.path.splitext(path)[0])] = found
    return out


def _resolve_import(importer_path, spec, name, exports):
    """Resolve `name` imported from `spec` by `importer_path`, or None."""
    if not spec.startswith("."):
        return None
    base = os.path.normcase(
        os.path.normpath(os.path.join(os.path.dirname(importer_path), spec))
    )
    for cand in (base, os.path.join(base, "index")):
        table = exports.get(os.path.normcase(cand))
        if table and name in table:
            return table[name]
    return None


def derive_client_preference_keys():
    """Every preference key the shipped client writes through this endpoint.

    Returns `(keys, unresolved)` — `unresolved` is the set of identifier names a
    call site passed that were neither a literal nor a resolvable const.
    """
    exports = _exported_consts()
    keys, unresolved = set(), set()
    for path in _iter_sources():
        src = _read(path)
        if "setPref" not in src and "deletePref" not in src:
            continue
        local = dict(_LOCAL_CONST.findall(src))
        imported = {}
        for names, spec in _IMPORT.findall(src):
            for raw in names.split(","):
                nm = raw.split(" as ")[-1].strip()
                if not nm:
                    continue
                val = _resolve_import(path, spec, nm, exports)
                if val is not None:
                    imported[nm] = val
        for arg in _CALL.findall(src):
            if arg[0] in "'\"":
                keys.add(arg.strip("'\""))
            elif arg in local:
                keys.add(local[arg])
            elif arg in imported:
                keys.add(imported[arg])
            else:
                unresolved.add(arg)
    return keys, unresolved


def _js_object_literal(src, name):
    """Extract `const NAME = Object.freeze({...})` / `= {...}` as a dict of raw text.

    ⛔ Anchored on the ASSIGNMENT, never on the first mention. Both of these names
    appear in a COMMENT above their own declaration, and `src.index(name)` walked
    from there into the NEXT object literal in the file — which parsed cleanly and
    returned a plausible-looking dict of the wrong thing.
    """
    decl = re.search(rf"\b(?:const|let|var)\s+{re.escape(name)}\s*=", src)
    assert decl, f"{name} is not declared in this file"
    brace = src.index("{", decl.end())
    depth, i = 0, brace
    while i < len(src):
        if src[i] == "{":
            depth += 1
        elif src[i] == "}":
            depth -= 1
            if depth == 0:
                break
        i += 1
    body = src[brace + 1 : i]
    out = {}
    for m in re.finditer(r"^\s*([A-Za-z0-9_$]+)\s*:\s*(.+?),\s*$", body, re.M):
        out[m.group(1)] = m.group(2).strip()
    return out


def hub_defaults_from_code():
    """`HUB_SETTINGS_DEFAULTS`, read from the client file that owns it."""
    raw = _js_object_literal(_read(HUB_SETTINGS_JS), "HUB_SETTINGS_DEFAULTS")
    out = {}
    for field, text in raw.items():
        if text in ("true", "false"):
            out[field] = text == "true"
        elif re.fullmatch(r"-?\d+(\.\d+)?", text):
            out[field] = float(text) if "." in text else int(text)
        elif text.startswith(("'", '"')):
            out[field] = text.strip("'\"")
        elif "Object.freeze({})" in text or text == "{}":
            out[field] = {}
        else:
            out[field] = text
    return out


def hub_slider_bounds_from_code():
    """`{field: (min, max)}` from `JoystickSettingsCard.jsx`'s NumberSetting sliders."""
    src = _read(SETTINGS_CARD_JSX)
    bounds = {}
    for block in re.findall(r"<NumberSetting\b(.*?)/>", src, re.S):
        mn = re.search(r"\bmin=\{(-?\d+)\}", block)
        mx = re.search(r"\bmax=\{(-?\d+)\}", block)
        fld = re.search(r"set\('([A-Za-z0-9_$]+)'\)", block)
        if mn and mx and fld:
            bounds[fld.group(1)] = (int(mn.group(1)), int(mx.group(1)))
    return bounds


# ── The accept side: nothing the client writes today may be refused ──────────

def test_every_key_the_client_writes_is_still_accepted(client):
    """THE defect this endpoint's allow-list can cause, railed by derivation."""
    keys, unresolved = derive_client_preference_keys()

    # Non-vacuity: the scan must have found a real, named set.
    assert len(keys) >= 25, f"key scan found only {len(keys)} keys — the scan is broken"
    for sentinel in ("chart_settings", "joystick_hub", "theme", "charts_workspace_layout"):
        assert sentinel in keys, f"scan missed {sentinel!r} — the scan is broken"

    # Anything the scan could not resolve must be a known forwarded parameter,
    # never a key quietly dropped from the check.
    assert unresolved <= _FORWARDED_PARAM_NAMES, (
        f"unresolved key expressions: {sorted(unresolved - _FORWARDED_PARAM_NAMES)}"
    )

    refused = []
    for key in sorted(keys):
        value = "{}" if key == "joystick_hub" else "x"
        resp = client.post("/api/auth/preferences", json={"key": key, "value": value})
        if resp.status_code != 200:
            refused.append((key, resp.status_code, resp.json().get("detail")))
    assert refused == [], f"the endpoint refuses keys the client writes: {refused}"


def test_widget_global_pref_keys_are_accepted(client):
    """`ChartsWorkspace.jsx:1342` writes these by lookup, not by literal."""
    src = _read(os.path.join(APP_SRC, "components", "chart", "chartThemes.js"))
    table = _js_object_literal(src, "WIDGET_GLOBAL_PREF_KEYS")
    values = [v.strip("'\"") for v in table.values()]

    assert len(values) >= 4, "WIDGET_GLOBAL_PREF_KEYS scan found nothing"
    assert "theme_tracker_settings" in values, "scan missed a known member"

    for key in values:
        resp = client.post("/api/auth/preferences", json={"key": key, "value": "{}"})
        assert resp.status_code == 200, f"{key}: {resp.status_code} {resp.text}"


def test_the_codes_own_hub_defaults_are_accepted(client):
    """A fresh account's exact `joystick_hub` blob must store."""
    defaults = hub_defaults_from_code()

    assert len(defaults) >= 9, f"defaults scan found {len(defaults)} fields"
    for sentinel in ("enabled", "handedness", "holdMs", "travelPx", "doubleTapMs", "overrides"):
        assert sentinel in defaults, f"defaults scan missed {sentinel!r}"

    resp = client.post(
        "/api/auth/preferences",
        json={"key": "joystick_hub", "value": json.dumps(defaults)},
    )
    assert resp.status_code == 200, resp.text


def test_the_coach_mark_write_is_accepted(client):
    """⛔ THE FIELD THE DEFAULTS DO NOT CONTAIN.

    `HubRoot.jsx:356` writes `coachMarkSeen: true` onto the whole current blob.
    A schema derived from `HUB_SETTINGS_DEFAULTS` alone does not know that field,
    and rejecting it would leave the coach mark on screen for good.
    """
    src = _read(os.path.join(APP_SRC, "hub", "HubRoot.jsx"))
    assert "coachMarkSeen: true" in src, "HubRoot no longer writes coachMarkSeen"

    blob = dict(hub_defaults_from_code())
    blob["coachMarkSeen"] = True
    resp = client.post(
        "/api/auth/preferences",
        json={"key": "joystick_hub", "value": json.dumps(blob)},
    )
    assert resp.status_code == 200, resp.text


def test_an_unknown_hub_field_from_an_older_build_is_carried(client):
    """`withDefaults` spreads the stored blob into every later write, so one
    stale field would otherwise become a permanent 400 on all hub settings."""
    blob = dict(hub_defaults_from_code())
    blob["someFieldAnOlderBuildWrote"] = {"nested": 1}
    resp = client.post(
        "/api/auth/preferences",
        json={"key": "joystick_hub", "value": json.dumps(blob)},
    )
    assert resp.status_code == 200, resp.text


def test_a_cleared_hub_value_is_accepted(client):
    for value in ("", "null"):
        resp = client.post(
            "/api/auth/preferences", json={"key": "joystick_hub", "value": value}
        )
        assert resp.status_code == 200, f"{value!r}: {resp.text}"


# ── The refuse side, asserted by the message the caller is shown ─────────────

def test_an_unknown_key_is_refused_by_name(client):
    resp = client.post(
        "/api/auth/preferences", json={"key": "not_a_real_pref", "value": "x"}
    )
    assert resp.status_code == 400
    assert resp.json()["detail"] == "Unknown preference key 'not_a_real_pref'."


def test_the_key_space_cannot_be_grown(client):
    """The abuse this closes: arbitrary rows minted against one account."""
    for key in ("a" * 400, "joystick_hub ", "JOYSTICK_HUB", "../../etc/passwd", ""):
        resp = client.post("/api/auth/preferences", json={"key": key, "value": "x"})
        assert resp.status_code == 400, f"{key!r} was accepted"


@pytest.mark.parametrize("field", ["enabled", "haptics", "stickyFan", "highContrast", "coachMarkSeen"])
def test_a_non_boolean_hub_flag_is_refused(client, field):
    resp = client.post(
        "/api/auth/preferences",
        json={"key": "joystick_hub", "value": json.dumps({field: "yes"})},
    )
    assert resp.status_code == 400
    assert resp.json()["detail"] == f"joystick_hub.{field} must be true or false."


def test_handedness_is_refused_outside_its_two_values(client):
    resp = client.post(
        "/api/auth/preferences",
        json={"key": "joystick_hub", "value": json.dumps({"handedness": "middle"})},
    )
    assert resp.status_code == 400
    assert resp.json()["detail"] == "joystick_hub.handedness must be 'left' or 'right'."


def test_the_numeric_bounds_match_the_sliders_that_write_them(client):
    """⭐ The bounds are DERIVED from the Settings card, not restated here.

    Move a slider's `min`/`max` without moving the server and this goes red.
    """
    bounds = hub_slider_bounds_from_code()

    assert len(bounds) == 3, f"slider scan found {len(bounds)} sliders, expected 3"
    for sentinel in ("holdMs", "travelPx", "doubleTapMs"):
        assert sentinel in bounds, f"slider scan missed {sentinel!r}"

    for field, (lo, hi) in bounds.items():
        message = f"joystick_hub.{field} must be a number between {lo} and {hi}."
        # Both ends of the slider must store.
        for ok in (lo, hi):
            resp = client.post(
                "/api/auth/preferences",
                json={"key": "joystick_hub", "value": json.dumps({field: ok})},
            )
            assert resp.status_code == 200, f"{field}={ok}: {resp.text}"
        # One step outside either end must not, and must say so.
        for bad in (lo - 1, hi + 1):
            resp = client.post(
                "/api/auth/preferences",
                json={"key": "joystick_hub", "value": json.dumps({field: bad})},
            )
            assert resp.status_code == 400, f"{field}={bad} was accepted"
            assert resp.json()["detail"] == message


@pytest.mark.parametrize("field", ["holdMs", "travelPx", "doubleTapMs"])
def test_a_stringified_number_is_refused(client, field):
    """The hazard `NumberSetting`'s own comment names: `'90' > '1200'` is TRUE.

    A string that LOOKS in-range is the whole point — `str(lo)` is the slider's
    own minimum, so this cannot be passing on the range check.
    """
    lo, _hi = hub_slider_bounds_from_code()[field]
    resp = client.post(
        "/api/auth/preferences",
        json={"key": "joystick_hub", "value": json.dumps({field: str(lo)})},
    )
    assert resp.status_code == 400
    assert resp.json()["detail"] == f"joystick_hub.{field} must be a number."


@pytest.mark.parametrize("field", ["holdMs", "travelPx", "doubleTapMs"])
def test_a_boolean_is_not_a_number(client, field):
    """⛔ `isinstance(True, int)` is True in Python — R-08's third hole, here.

    ⭐ THE MESSAGE IS THE ASSERTION, NOT THE STATUS. `True` is `1` and `1` is
    outside all three sliders' ranges, so deleting the bool test still yields a
    400 — from the range branch, saying a different sentence. Asserting the type
    sentence is the only thing that can tell the two apart; asserting `== 400`
    alone rails nothing here, and was measured surviving exactly that mutation.
    """
    resp = client.post(
        "/api/auth/preferences",
        json={"key": "joystick_hub", "value": json.dumps({field: True})},
    )
    assert resp.status_code == 400
    assert resp.json()["detail"] == f"joystick_hub.{field} must be a number."


def test_a_non_object_hub_blob_is_refused(client):
    for value in ("3", '"enabled"', "[1,2]", "not json at all"):
        resp = client.post(
            "/api/auth/preferences", json={"key": "joystick_hub", "value": value}
        )
        assert resp.status_code == 400, f"{value!r} was accepted"
        assert resp.json()["detail"] == "joystick_hub must be a JSON object."


def test_overrides_must_be_an_object(client):
    resp = client.post(
        "/api/auth/preferences",
        json={"key": "joystick_hub", "value": json.dumps({"overrides": ["a"]})},
    )
    assert resp.status_code == 400
    assert resp.json()["detail"] == "joystick_hub.overrides must be a JSON object."


def test_a_refused_write_stores_nothing(client):
    """The refusal must not be cosmetic — the row must not move."""
    good = json.dumps({"handedness": "left"})
    assert client.post(
        "/api/auth/preferences", json={"key": "joystick_hub", "value": good}
    ).status_code == 200
    before = client.get("/api/auth/preferences").json().get("joystick_hub")
    assert before == good

    client.post(
        "/api/auth/preferences",
        json={"key": "joystick_hub", "value": json.dumps({"handedness": "middle"})},
    )
    after = client.get("/api/auth/preferences").json().get("joystick_hub")
    assert after == before
