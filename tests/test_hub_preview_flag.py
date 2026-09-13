"""HUB_PREVIEW_ENABLED — the server half of the joystick-hub preview kill switch.

⛔ THE POINT OF THIS FLAG IS THAT IT WORKS WITHOUT A REDEPLOY. The rollback plan for
the whole preview release is "flip it in Railway", and `railway variables --set` stages
a value against a RUNNING pod. If the value were captured at import, flipping it would
change nothing until the next deploy — the switch would look present and do nothing at
the exact moment it is needed.

So the load-bearing property is not "false hides the hub". It is **"the value is read at
request time"**, and that is what `test_the_flag_is_read_per_request` proves by changing
the environment between two calls without reimporting anything.
"""

import importlib
import os

import pytest


@pytest.fixture
def access_payload():
    """`_access_payload` as the running server would call it."""
    mod = importlib.import_module("api.routers.auth")
    return mod._access_payload


@pytest.fixture
def a_member():
    return {"id": "u1", "email": "m@example.com", "role": "member"}


def _flag(payload_fn, user, value):
    if value is None:
        os.environ.pop("HUB_PREVIEW_ENABLED", None)
    else:
        os.environ["HUB_PREVIEW_ENABLED"] = value
    return payload_fn(user, "free")["hub_preview_enabled"]


@pytest.fixture(autouse=True)
def _restore_env():
    before = os.environ.get("HUB_PREVIEW_ENABLED")
    yield
    if before is None:
        os.environ.pop("HUB_PREVIEW_ENABLED", None)
    else:
        os.environ["HUB_PREVIEW_ENABLED"] = before


def test_unset_means_not_killed(access_payload, a_member):
    """⛔ DEFAULT ON. It is a KILL switch: unset means "nothing has been killed".

    The opposite default would make a variable someone forgot to set
    indistinguishable from a deliberate shutdown — the exact ambiguity recorded in
    `project_feature_flag_ledger`.
    """
    assert _flag(access_payload, a_member, None) is True


@pytest.mark.parametrize("value", ["0", "false", "FALSE", "no", "off", " Off "])
def test_explicit_off_spellings_kill_it(access_payload, a_member, value):
    assert _flag(access_payload, a_member, value) is False


@pytest.mark.parametrize("value", ["1", "true", "yes", "on", "anything-else"])
def test_everything_else_leaves_it_alive(access_payload, a_member, value):
    assert _flag(access_payload, a_member, value) is True


def test_the_flag_is_read_per_request(access_payload, a_member):
    """⭐ THE ONE THAT MATTERS. Same process, same imported module, no reload.

    A module-level capture passes every other test in this file and fails this one,
    which is precisely the defect that would make the rollback plan a fiction.
    """
    assert _flag(access_payload, a_member, "1") is True
    assert _flag(access_payload, a_member, "0") is False    # no reimport between these
    assert _flag(access_payload, a_member, "1") is True


def test_the_flag_is_on_every_auth_response_not_just_me(a_member):
    """signup / login / me share `_access_payload`, so a fresh session carries it.

    If it rode only `/api/auth/me`, a user who just signed up would see the hub for
    one render before the first poll corrected them.
    """
    src = open(
        os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                     "api", "routers", "auth.py"),
        encoding="utf-8",
    ).read()
    # The field is defined once, inside the shared payload helper.
    assert src.count('"hub_preview_enabled"') == 1
    helper_at = src.index("def _access_payload")
    field_at = src.index('"hub_preview_enabled"')
    assert field_at > helper_at, "the flag must live inside _access_payload"

def test_the_default_in_source_is_ON_and_cannot_be_flipped_unnoticed():
    """⛔ THE DEFAULT ITSELF IS PINNED, not just its observable effect.

    `test_unset_means_not_killed` above proves the BEHAVIOUR today. This proves the
    LITERAL, because the two fail differently: someone changing the default to "0" and
    then "fixing" the behaviour test to match would leave production dark on a variable
    nobody set, and every test would still be green.

    Convention, recorded verbatim in CLAUDE.md and the spec:
      HUB_PREVIEW_ENABLED unset or true -> hub eligible
      false -> hub hidden for everyone on next authenticated request
    Production sets it TRUE deliberately, so "on on purpose" is distinguishable from
    "unset" (`project_feature_flag_ledger`).
    """
    src = open(
        os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                     "api", "routers", "auth.py"),
        encoding="utf-8",
    ).read()
    i = src.index("hub_preview_enabled")
    window = src[i:i + 400]
    assert '"HUB_PREVIEW_ENABLED", "1"' in window, (
        "the env default for HUB_PREVIEW_ENABLED must be \"1\" (ON). It is a KILL "
        "switch: unset means nothing has been killed. Flipping this default would make "
        "a forgotten variable indistinguishable from a deliberate shutdown."
    )



# ---------------------------------------------------------------------------
# RESEARCH_TECHNICAL_TAB_ENABLED — the Research "Technical" tab gate.
#
# Same request-time mechanism, OPPOSITE polarity: the hub flag is a KILL switch
# (unset = not killed), this is an ENABLEMENT gate (unset = not released yet).
#
# ⛔ _access_payload is on the UNIVERSAL auth path — signup, login and
# /api/auth/me all build it. An exception here is a LOGIN OUTAGE, not a dark
# tab, so the property worth pinning is not "false hides the tab" but "no
# environment value, however malformed, can make the payload builder raise".
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("raw,expected", [
    ("1", True), ("true", True), ("TRUE", True), ("  on  ", True), ("Yes", True),
    ("0", False), ("false", False), ("no", False), ("off", False),
    ("", False), ("   ", False), ("banana", False), ("2", False),
    ("null", False), ("None", False), ("[]", False), ("\t\n", False),
])
def test_the_technical_tab_gate_normalizes_and_never_raises(
    access_payload, a_member, monkeypatch, raw, expected
):
    monkeypatch.setenv("RESEARCH_TECHNICAL_TAB_ENABLED", raw)
    payload = access_payload(a_member, "free")          # must not raise
    assert payload["research_technical_tab_enabled"] is expected


def test_the_technical_tab_gate_is_off_when_unset(access_payload, a_member, monkeypatch):
    """Unset must read as NOT RELEASED. A forgotten variable can never expose
    a surface nobody decided to ship — the inverse of the hub switch's default."""
    monkeypatch.delenv("RESEARCH_TECHNICAL_TAB_ENABLED", raising=False)
    assert access_payload(a_member, "free")["research_technical_tab_enabled"] is False


def test_the_technical_tab_gate_is_read_per_request(access_payload, a_member, monkeypatch):
    """Flipping it in Railway must change behaviour once the pod restarts, with
    no code change. A module-level capture would need a redeploy of the app."""
    monkeypatch.setenv("RESEARCH_TECHNICAL_TAB_ENABLED", "0")
    assert access_payload(a_member, "free")["research_technical_tab_enabled"] is False
    monkeypatch.setenv("RESEARCH_TECHNICAL_TAB_ENABLED", "1")
    assert access_payload(a_member, "free")["research_technical_tab_enabled"] is True


# ---------------------------------------------------------------------------
# NOTEBOOK_* — Wave K puts four more flags on this same payload.
#
# ⛔⛔ THE PER-REQUEST PROPERTY IS ASSERTED HERE, FOR THEM TOO, AND THE ROSTER IS
# DERIVED. This file is where "the value is read at request time" lives, and a
# rail that covered one flag on the payload while four neighbours went uncovered
# would be satisfied by exactly the mistake it exists to catch — a module-level
# capture creeping back in on the new keys, where every OTHER test still passes
# and the no-redeploy rollback quietly becomes a fiction.
#
# ⭐ The keys come from `auth.NOTEBOOK_FLAGS` through `_notebook_flag_key`, never
# from a list typed here: a fifth flag added tomorrow is covered the day it
# lands, and a hand-typed list would drift in the flattering direction (fewer
# flags checked, nothing red).
# ---------------------------------------------------------------------------

def _notebook_env_names():
    mod = importlib.import_module("api.routers.auth")
    names = sorted(mod.NOTEBOOK_FLAGS)
    assert names, "no Notebook flags found — this rail would pass over an empty set"
    return names


@pytest.mark.parametrize("env_name", _notebook_env_names())
def test_each_notebook_flag_is_read_PER_REQUEST(access_payload, a_member, monkeypatch, env_name):
    """Same process, same imported module, no reload — one env change between
    two calls. ⛔ This is the one that a module-level capture fails."""
    mod = importlib.import_module("api.routers.auth")
    key = mod._notebook_flag_key(env_name)

    monkeypatch.setenv(env_name, "1")
    assert access_payload(a_member, "free")[key] is True
    monkeypatch.setenv(env_name, "0")                    # no reimport between these
    assert access_payload(a_member, "free")[key] is False, (
        f"{env_name} did not change without a reimport — it is captured at import, "
        "and every 'no redeploy needed' claim about it is false")
    monkeypatch.setenv(env_name, "1")
    assert access_payload(a_member, "free")[key] is True


def test_the_notebook_flags_ride_the_SAME_payload_helper_as_the_hub_flag(a_member):
    """⛔ One helper, or the flip reaches some auth paths and not others.

    `_access_payload` is what signup, login and /api/auth/me all build. A
    Notebook key defined anywhere else would work for whichever door happened to
    call that other code — and the door people forget is signup, the one a NEW
    member takes.
    """
    mod = importlib.import_module("api.routers.auth")
    src = open(mod.__file__, encoding="utf-8").read()
    helper_at = src.index("def _access_payload")
    splice_at = src.index("_notebook_flags()", helper_at)
    assert splice_at > helper_at, "the Notebook flags must be spliced inside _access_payload"
    # …and the payload really carries them, so the splice is not decorative.
    payload = mod._access_payload(a_member, "free")
    for env_name in _notebook_env_names():
        assert mod._notebook_flag_key(env_name) in payload
