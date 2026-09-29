"""TERM-039 (FB-S12-02) — member-facing feature status at the point of use.

The spec's own "Known it worked" is two sentences, and each is a rail here:

  * "Flipping a flag changes the strip with no content edit" —
    `test_flipping_a_flag_changes_the_strip_with_no_content_edit`, over EVERY
    flag the ledger declares member-facing.
  * "A member-visible BETA mark disappears when the flag reaches full rollout,
    proved by flipping it in a test" —
    `test_BETA_while_the_owner_preview_and_GONE_at_full_rollout`.

⛔ WHAT THE SERVER MAY SAY. A flag's live value lives on Railway and is read per
request by the reader that already feeds `_access_payload`; `docs/feature_flags.json`
records intent and names the surface. So the status is DERIVED from the payload the
server just built (never a second env read), labelled from the ledger (never a second
list), and anything the server cannot vouch for is `unknown` — never omitted as if it
were off, and never shown as released.
"""
from __future__ import annotations

import importlib
import json
import os
import re
from pathlib import Path

import pytest

auth = importlib.import_module("api.routers.auth")
feature_status = importlib.import_module("api.services.feature_status")

REPO = Path(__file__).resolve().parents[1]
LEDGER = REPO / "docs" / "feature_flags.json"

MEMBER = {"id": None, "role": "free", "created_at": None}
ADMIN = {"id": None, "role": "admin", "created_at": None}


def _declared():
    """The REAL ledger's member-facing declarations, read here independently of the
    service so a service that silently read nothing cannot agree with itself."""
    flags = json.loads(LEDGER.read_text(encoding="utf-8"))["flags"]
    return {name: entry["member_facing"] for name, entry in flags.items()
            if isinstance(entry.get("member_facing"), dict)}


DECLARED = _declared()


def _payload_key(name, mf):
    return mf.get("payload_key") or name.lower()


@pytest.fixture
def clean_env(monkeypatch):
    """Every declared flag unset, so one test's flip cannot ride into another."""
    for name in DECLARED:
        monkeypatch.delenv(name, raising=False)
    return monkeypatch


def _features(payload):
    fs = payload["feature_status"]
    return {f["id"]: f for f in fs["features"]}


# ── the ledger is the one source ─────────────────────────────────────────────

def test_the_ledger_declares_member_facing_flags_NON_VACUITY():
    """Every rail below loops over DECLARED. An empty set would make each of them pass
    over nothing and read as coverage."""
    assert len(DECLARED) >= 5, sorted(DECLARED)
    # the one flag that has an owner-preview scope today must be among them, or the
    # BETA rail below proves nothing about the real ledger
    assert "BREADTH_DC_V2_2_ENABLED" in DECLARED


@pytest.mark.parametrize("name", sorted(DECLARED))
def test_every_declaration_is_well_formed_and_plain(name):
    mf = DECLARED[name]
    assert set(mf) <= {"label", "where", "payload_key"}, (name, sorted(mf))
    for field in ("label", "where"):
        text = mf.get(field)
        assert isinstance(text, str) and text.strip(), (name, field, text)
        # member copy: plain, no emoji (the product's icons are UIcon, never a glyph)
        assert text.isascii(), f"{name}.{field} is not plain text: {text!r}"
        assert len(text) <= 60, f"{name}.{field} is too long for a strip line: {text!r}"


@pytest.mark.parametrize("name", sorted(DECLARED))
def test_the_server_vouches_for_OFF_explicitly(clean_env, name):
    """⛔ The payload must carry an explicit False when the flag is off. A key that is
    merely ABSENT when off cannot be told from a reader that failed, so the server could
    not vouch for either — and the strip would have to say "unknown" about a dark flag,
    which announces it. A flag whose payload key is present-only-when-on must not be
    declared member-facing until its reader says False out loud."""
    key = _payload_key(name, DECLARED[name])
    off = auth._access_payload(MEMBER, "pro")
    assert off.get(key) is False, f"{name}: off reads {off.get(key)!r}, not an explicit False"
    clean_env.setenv(name, "1")
    on = auth._access_payload(MEMBER, "pro")
    assert on.get(key) is True, f"{name}: '1' reads {on.get(key)!r} under {key!r}"


# ── the spec's two observables ───────────────────────────────────────────────

@pytest.mark.parametrize("name", sorted(DECLARED))
def test_flipping_a_flag_changes_the_strip_with_no_content_edit(clean_env, name):
    mf = DECLARED[name]
    key = _payload_key(name, mf)
    off = _features(auth._access_payload(MEMBER, "pro"))
    assert key not in off, f"{name} is listed while OFF — a dark surface was announced"
    clean_env.setenv(name, "1")
    on = _features(auth._access_payload(MEMBER, "pro"))
    assert key in on, f"{name} set to '1' never reached the strip"
    assert on[key]["state"] == "released"
    assert on[key]["label"] == mf["label"] and on[key]["where"] == mf["where"]


def test_BETA_while_the_owner_preview_and_GONE_at_full_rollout(clean_env):
    key = "breadth_dc_v2_2_enabled"
    clean_env.setenv("BREADTH_DC_V2_2_ENABLED", "admin")
    admin = _features(auth._access_payload(ADMIN, "pro"))
    member = _features(auth._access_payload(MEMBER, "pro"))
    assert admin[key]["state"] == "preview", admin.get(key)
    assert key not in member, "the owner preview was announced to a member it is off for"

    clean_env.setenv("BREADTH_DC_V2_2_ENABLED", "1")
    admin = _features(auth._access_payload(ADMIN, "pro"))
    member = _features(auth._access_payload(MEMBER, "pro"))
    assert admin[key]["state"] == "released", "BETA outlived full rollout"
    assert member[key]["state"] == "released"


def test_preview_is_DERIVED_from_the_reader_not_typed(clean_env):
    """The preview set is the flags whose live value is the owner-preview spelling,
    answered by the same parse `_breadth_dc_flags` uses — so nothing can mark a
    surface BETA that the reader does not also restrict."""
    assert auth._preview_payload_keys() == frozenset()
    clean_env.setenv("BREADTH_DC_V2_3_ENABLED", " Admin ")
    assert auth._preview_payload_keys() == frozenset({"breadth_dc_v2_3_enabled"})
    clean_env.setenv("BREADTH_DC_V2_3_ENABLED", "on")
    assert auth._preview_payload_keys() == frozenset()


# ── what the server cannot vouch for ─────────────────────────────────────────

def _write_ledger(path, flags):
    path.write_text(json.dumps({"_readme": [], "flags": flags}), encoding="utf-8")


def test_an_unvouched_flag_is_UNKNOWN_never_off_and_never_released(tmp_path, monkeypatch):
    ledger = tmp_path / "flags.json"
    _write_ledger(ledger, {
        "NOBODY_READS_THIS_ENABLED": {"status": "dark", "where": [], "note": "x",
                                      "member_facing": {"label": "Ghost", "where": "Nowhere"}},
        "RESEARCH_FLOW_TAB_ENABLED": {"status": "armed", "where": ["web"], "note": "x",
                                      "member_facing": {"label": "Flow tab", "where": "Research"}},
    })
    monkeypatch.setattr(feature_status, "LEDGER_PATH", ledger)
    monkeypatch.setenv("RESEARCH_FLOW_TAB_ENABLED", "1")
    fs = auth._access_payload(MEMBER, "pro")["feature_status"]
    assert fs["measured"] is True
    got = {f["id"]: f["state"] for f in fs["features"]}
    assert got == {"nobody_reads_this_enabled": "unknown",
                   "research_flow_tab_enabled": "released"}, got


@pytest.mark.parametrize("content", [None, "{not json", json.dumps({"flags": []})])
def test_an_unreadable_ledger_is_NOT_MEASURED_and_login_survives(tmp_path, monkeypatch, content):
    ledger = tmp_path / "flags.json"
    if content is not None:
        ledger.write_text(content, encoding="utf-8")
    monkeypatch.setattr(feature_status, "LEDGER_PATH", ledger)
    payload = auth._access_payload(MEMBER, "pro")
    assert payload["feature_status"] == {"measured": False, "features": []}
    assert "paid_equiv" in payload, "a status failure took the auth payload down with it"


def test_a_crash_in_the_projection_never_reaches_login(monkeypatch):
    def boom(*a, **k):
        raise RuntimeError("synthetic")
    monkeypatch.setattr(feature_status, "project", boom)
    payload = auth._access_payload(MEMBER, "pro")
    assert payload["feature_status"] == {"measured": False, "features": []}
    assert payload["paid_equiv"] is True


def test_a_ledger_edit_reaches_the_next_request(tmp_path, monkeypatch):
    """The cache is keyed on the file's identity, so relabelling a surface in the
    ledger is a content edit that lands without a restart."""
    ledger = tmp_path / "flags.json"
    entry = {"status": "armed", "where": ["web"], "note": "x",
             "member_facing": {"label": "Flow tab", "where": "Research"}}
    _write_ledger(ledger, {"RESEARCH_FLOW_TAB_ENABLED": entry})
    monkeypatch.setattr(feature_status, "LEDGER_PATH", ledger)
    monkeypatch.setenv("RESEARCH_FLOW_TAB_ENABLED", "1")
    first = _features(auth._access_payload(MEMBER, "pro"))
    assert first["research_flow_tab_enabled"]["label"] == "Flow tab"

    entry["member_facing"]["label"] = "Options flow tab"
    _write_ledger(ledger, {"RESEARCH_FLOW_TAB_ENABLED": entry})
    st = ledger.stat()
    os.utime(ledger, ns=(st.st_atime_ns, st.st_mtime_ns + 2_000_000_000))
    second = _features(auth._access_payload(MEMBER, "pro"))
    assert second["research_flow_tab_enabled"]["label"] == "Options flow tab"


def test_the_real_ledger_produces_no_UNKNOWN_with_everything_on(clean_env):
    for name in DECLARED:
        clean_env.setenv(name, "1")
    fs = auth._access_payload(MEMBER, "pro")["feature_status"]
    assert fs["measured"] is True
    states = {f["id"]: f["state"] for f in fs["features"]}
    assert len(states) == len(DECLARED), states
    assert set(states.values()) == {"released"}, states


# ── one source: no label is typed a second time ──────────────────────────────

_NEW_CODE = (
    "api/services/feature_status.py",
    "app/src/components/featureStatus/featureStatus.js",
    "app/src/components/featureStatus/BetaMark.jsx",
    "app/src/components/featureStatus/FeatureStatusStrip.jsx",
)


def test_labels_live_only_in_the_ledger():
    labels = {mf["label"] for mf in DECLARED.values()} | {mf["where"] for mf in DECLARED.values()}
    offenders = []
    for rel in _NEW_CODE:
        text = (REPO / rel).read_text(encoding="utf-8")
        text = re.sub(r"/\*[\s\S]*?\*/", " ", text)
        for label in labels:
            if re.search(r"""['"`]""" + re.escape(label) + r"""['"`]""", text):
                offenders.append(f"{rel}: {label!r}")
    assert offenders == [], offenders
