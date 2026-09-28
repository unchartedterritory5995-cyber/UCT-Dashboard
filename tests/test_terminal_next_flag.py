"""TERM-068 / RM-N11 — rung zero for Terminal-Next. The rails for the gate.

`10-roadmap/rollout-rollback.md` §4 lists thirteen things that must exist before
stage one. Items 1-4 are this file's subject, and item 4 is the one that is not a
formality:

    "A kill switch nobody has watched actually kill something isn't a kill
     switch, it's a variable."

So the rails below do not stop at *"the reader returns False"*. There is a test
consumer — a real FastAPI route behind the real dependency, driven through
`TestClient` against a real tagged account in the isolated `auth.db` — proven
REACHABLE with the flag on and REFUSED with it off. That is the test-level half
of item 4.

⚠️⚠️ THE PRODUCTION EXIT CONDITION IS NOT MET BY THIS FILE, and saying so is part
of the rail. There is no production consumer of `require_terminal_next` yet, so
nothing a member could reach has been watched to die. What is proved here is that
the LEVER works against something that would otherwise be reachable. The
production half needs a real Terminal-Next surface mounted behind this
dependency, and until then item 4 stays open.
⭐ `tests/test_terminal_next_kill_switch.py` (TERM-068) is the other half: it
DERIVES every cohort-gated route from the SERVED app and requires each one — plus
the `cohorts` payload field — to die with the switch thrown, with auth.db
fingerprinted identical before and after. So the first production consumer is
held to the kill the day it mounts, without anybody editing a list.

⛔ SCOPED RUN ONLY:
    python -m pytest tests/test_terminal_next_flag.py tests/test_feature_flag_ledger.py \\
                     tests/test_hub_preview_flag.py tests/test_breadth_dc_flags.py \\
                     tests/test_s7_filing_watch_flag.py tests/test_rollout.py -q
Never an unscoped pytest on this box: one reached 18 GB and was OOM-killed, and
`-k` does not help because collection is where the memory goes.

⛔ WHAT THESE RAILS CANNOT DO. They prove the gate's SHAPE — order, polarity,
per-request read, fail-closed, and the payload field. They say nothing about
whether the cohort contains the right people; that is
`tools/rollout_cohort.py`'s operator record and a human's judgement. And they
have no network, so they cannot know what Railway has set — that is
`tools/flag_ledger_audit.py`'s half.
"""
from __future__ import annotations

import importlib
import json
from pathlib import Path

import pytest
from fastapi import Depends, FastAPI, HTTPException
from fastapi.testclient import TestClient

from api.middleware.auth_middleware import get_current_user_with_plan
from api.services import auth_db, feature_flag_index as ffi, rollout
from api.services import rollout_gate as rg

REPO = Path(__file__).resolve().parents[1]
MODULE_PATH = REPO / "api" / "services" / "rollout_gate.py"
AUTH_ROUTER_PATH = REPO / "api" / "routers" / "auth.py"
LEDGER_PATH = REPO / "docs" / "feature_flags.json"

MEMBER_ID = "tn-member-1"
OUTSIDER_ID = "tn-outsider-1"


@pytest.fixture
def a_member():
    return {"id": MEMBER_ID, "email": "tn1@example.test", "role": "member", "plan": "free"}


@pytest.fixture
def an_outsider():
    return {"id": OUTSIDER_ID, "email": "tn2@example.test", "role": "member", "plan": "free"}


@pytest.fixture
def auth_store(tmp_path, monkeypatch):
    """A per-test `auth.db` built by the PRODUCT'S OWN `init_db()`.

    ⛔ BOTH HALVES, or the isolation is a fiction: `AUTH_DB_PATH` for the seven
    per-call readers AND `_auth_db._DB_PATH` for the six that captured it at
    import (`conftest.py`'s header records why). The repo-root conftest already
    isolates the session store; this narrows it to one test so a tag written
    here cannot reach the next one.

    ⭐ `init_db()` rather than a copied DDL. `tests/test_rollout.py` keeps a hand
    copy of the `user_tags` block and needs a rail to keep that copy honest; a
    third copy here would need a third rail.
    """
    path = tmp_path / "auth.db"
    monkeypatch.setenv("AUTH_DB_PATH", str(path))
    monkeypatch.setattr(auth_db, "_DB_PATH", str(path))
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    auth_db.init_db()
    return path


@pytest.fixture
def tagged(auth_store, a_member, an_outsider):
    """A REAL account carrying the REAL cohort tag, in an isolated `auth.db`.

    ⭐ NOT A MONKEYPATCHED STORE. The cohort read under test is the production
    SQL over the production `user_tags` table. A faked `includes` would let the
    gate pass while the join it depends on was wrong — and the join to `users`
    is not decoration (`rollout.cohort_user_ids`' own note).

    The outsider is seeded too, because a rail that only ever sees a member of
    the cohort cannot distinguish "the gate works" from "the gate says yes".
    """
    conn = auth_db.get_connection()
    try:
        for uid in (MEMBER_ID, OUTSIDER_ID):
            conn.execute(
                "INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (?,?,?)",
                (uid, uid + "@example.test", "x"))
        conn.commit()
    finally:
        conn.close()
    rollout.assign_cohort(rg.TERMINAL_NEXT_COHORT, [MEMBER_ID])
    assert rollout.includes(MEMBER_ID, rg.TERMINAL_NEXT_COHORT) is True, (
        "the fixture did not actually tag the member — every assertion below "
        "would pass for the wrong reason")
    assert rollout.includes(OUTSIDER_ID, rg.TERMINAL_NEXT_COHORT) is False
    return a_member


@pytest.fixture
def access_payload():
    """`_access_payload` as the running server would call it."""
    return importlib.import_module("api.routers.auth")._access_payload


@pytest.fixture(autouse=True)
def _flag_unset(monkeypatch):
    """Every test states the flag it wants. Unset is the starting point, so a
    test that forgets is testing the default rather than inheriting a stray."""
    monkeypatch.delenv(rg.TERMINAL_NEXT_FLAG_ENV, raising=False)


# ───────────────────────────────────────────────────────────────────────────────
# §4 ITEM 1 — DECLARED, WITH A NAME THE AST INDEX CAN SEE.
# ───────────────────────────────────────────────────────────────────────────────

def test_the_gate_is_VISIBLE_to_the_AST_index_and_demands_a_ledger_entry():
    """⛔ THE PREREQUISITE, and it is a property of the NAME, not of the intent.

    `is_gate()` is a name test — ENABLED / DISABLE / a trailing `_ON`. A gate
    named `TERMINAL_NEXT_MODE` would be invisible to the only inventory that has
    a rail, which is exactly how `DESK_PUBLIC_SHOWS` ran 25 days with the live
    wildcard and the doc disagreeing and nothing able to tell.

    ⭐ Driven through the real index over the real tree, so this cannot pass on a
    fixture that merely looks like the repo.
    """
    assert ffi.is_gate(rg.TERMINAL_NEXT_FLAG_ENV), (
        f"{rg.TERMINAL_NEXT_FLAG_ENV} carries no ENABLED/DISABLE/_ON marker, so "
        "`is_gate()` is false for it and no flag rail will ever ask about it")
    found = ffi.gates(ffi.repo_roots(REPO), REPO)
    assert rg.TERMINAL_NEXT_FLAG_ENV in found, (
        "the AST index cannot see the gate at all — the read must be "
        "`os.environ.get(<literal or module constant>)`, not through a parameter")
    entry = found[rg.TERMINAL_NEXT_FLAG_ENV]
    assert "api/services/rollout_gate.py" in entry["sites"], entry["sites"]
    assert ffi.needs_declaration(rg.TERMINAL_NEXT_FLAG_ENV, entry["default"]) is True, (
        "the gate no longer needs a ledger entry, which means its default reads "
        "as ON to the index — the polarity has been flipped under the rail")


# ───────────────────────────────────────────────────────────────────────────────
# §4 ITEM 2 — THE FLAG IS READ PER REQUEST.
# ───────────────────────────────────────────────────────────────────────────────

def test_the_flag_is_read_PER_REQUEST_not_captured_at_import(monkeypatch):
    """⭐ THE ONE THAT MATTERS, and the idiom is `tests/test_hub_preview_flag.py`'s:
    same process, same imported module, NO reload, one environment change between
    two calls.

    A module-level capture passes every other test in this file and fails this
    one, which is precisely the defect that makes the no-redeploy rollback a
    fiction: `railway variables --set` STAGES a value against a running pod, so
    the operator reads the variable back changed, sees `--kv` agree, and an
    import-time capture keeps behaving as before.
    """
    monkeypatch.setenv(rg.TERMINAL_NEXT_FLAG_ENV, "1")
    assert rg.terminal_next_enabled() is True
    monkeypatch.setenv(rg.TERMINAL_NEXT_FLAG_ENV, "0")      # no reimport between these
    assert rg.terminal_next_enabled() is False, (
        "TERMINAL_NEXT_ENABLED did not change without a reimport — it is "
        "captured at import, and every 'no redeploy needed' claim about it is false")
    monkeypatch.setenv(rg.TERMINAL_NEXT_FLAG_ENV, "1")
    assert rg.terminal_next_enabled() is True


def test_a_reimported_module_still_reads_it_per_call(monkeypatch):
    """The stronger form: even a freshly imported module must not latch the
    value. `importlib.reload` is what a module-level capture would survive."""
    monkeypatch.setenv(rg.TERMINAL_NEXT_FLAG_ENV, "0")
    fresh = importlib.reload(rg)
    try:
        assert fresh.terminal_next_enabled() is False
        monkeypatch.setenv(rg.TERMINAL_NEXT_FLAG_ENV, "1")
        assert fresh.terminal_next_enabled() is True
    finally:
        importlib.reload(rg)


def test_the_payload_field_is_read_PER_REQUEST_too(access_payload, tagged, monkeypatch):
    """⛔ THE SAME PROPERTY ONE LEVEL UP, because the payload is what a member
    actually receives. A per-call reader spliced into a payload that caches the
    RESULT is the same defect wearing a different hat."""
    monkeypatch.setenv(rg.TERMINAL_NEXT_FLAG_ENV, "1")
    assert access_payload(tagged, "free")["cohorts"] == [rg.TERMINAL_NEXT_COHORT]
    monkeypatch.setenv(rg.TERMINAL_NEXT_FLAG_ENV, "0")      # no reimport between these
    assert access_payload(tagged, "free")["cohorts"] == []
    monkeypatch.setenv(rg.TERMINAL_NEXT_FLAG_ENV, "1")
    assert access_payload(tagged, "free")["cohorts"] == [rg.TERMINAL_NEXT_COHORT]


# ───────────────────────────────────────────────────────────────────────────────
# §4 ITEM 3 — THE LITERAL DEFAULT IS PINNED, not just its observable effect.
# ───────────────────────────────────────────────────────────────────────────────

def test_unset_means_OFF_and_the_DEFAULT_LITERAL_is_pinned(monkeypatch):
    """⛔ BOTH HALVES, BECAUSE THEY FAIL DIFFERENTLY.

    The behaviour assertion alone lets somebody change the default to `"1"` and
    then "fix" this test to match, which would ship an unreleased member surface
    to the whole roster on a variable nobody set. Pinning the LITERAL makes that
    edit visible.

    ⛔ THE POLARITY, ARGUED: `TERMINAL_NEXT_ENABLED` takes the ENABLEMENT default
    although the rollout documents call it a kill switch, because the two
    directions cost different amounts — see `rollout_gate.py`'s header. The
    doctrine's own justification (`api/routers/auth.py:126-137`) is about
    ambiguity, and at rung zero the ambiguity is real in one direction only: a
    forgotten variable reading "off" costs nothing when there is no consumer,
    while a forgotten variable reading "on" costs the whole roster.
    """
    monkeypatch.delenv(rg.TERMINAL_NEXT_FLAG_ENV, raising=False)
    assert rg.terminal_next_enabled() is False
    assert rg.TERMINAL_NEXT_FLAG_DEFAULT == "0", (
        'the env default for TERMINAL_NEXT_ENABLED must be "0" (OFF). It is an '
        "ENABLEMENT gate over an unreleased surface: unset means \"not turned on "
        'yet". RB-4 is what flips this to a kill switch, BY HAND, at the S4 '
        "graduation commit — never silently here.")


@pytest.mark.parametrize("raw,expected", [
    ("1", True), ("true", True), ("TRUE", True), ("  on  ", True), ("Yes", True),
    ("0", False), ("false", False), ("no", False), ("off", False),
    ("", False), ("   ", False), ("banana", False), ("2", False),
    ("null", False), ("None", False), ("[]", False), ("\t\n", False),
    ("treu", False), ("admin", False),
])
def test_the_gate_normalises_and_never_raises(monkeypatch, raw, expected):
    """⛔ AN UNRECOGNISED VALUE TAKES THE DEFAULT, never the opposite of it — a
    typo'd `"treu"` must not turn a dark surface on.

    ⚠️ `"admin"` READS FALSE HERE, deliberately. `_breadth_dc_flags` gives that
    value owner-preview meaning; this gate does not, and S0's own text says
    unset means off *"for everyone including admins"*. A value that means
    something on a neighbouring flag and nothing here must degrade to the safe
    answer rather than be quietly honoured.
    """
    monkeypatch.setenv(rg.TERMINAL_NEXT_FLAG_ENV, raw)
    assert rg.terminal_next_enabled() is expected


# ───────────────────────────────────────────────────────────────────────────────
# THE ORDERING — the kill switch is evaluated FIRST.
# ───────────────────────────────────────────────────────────────────────────────

def test_the_KILL_SWITCH_is_evaluated_BEFORE_the_COHORT(monkeypatch):
    """⛔⛔ THE ORDER, copied from `askai.py:47 enabled_for` and stated as a
    boundary by `rollout.py:50-55`: *"the kill switch is evaluated FIRST, so
    `FLAG=false` beats any membership. Without that, turning a feature off would
    mean emptying a table."*

    ⭐ A SPY, NOT A RETURN VALUE — the discovery `tests/test_alert_routing.py`
    already made. The fail-closed bare except means a FLIPPED order also returns
    False, so asserting the answer proves nothing about the order. Worse here:
    for a TAGGED member with the flag off, a flipped order reads the tag (True),
    then the flag (False), and returns False — the identical answer. What a false
    flag has to buy is that nothing downstream of it RUNS.
    """
    calls: list = []
    real = rollout.includes
    monkeypatch.setattr(rollout, "includes",
                        lambda uid, cohort, **kw: (calls.append((uid, cohort)),
                                                   real(uid, cohort, **kw))[1])

    monkeypatch.setenv(rg.TERMINAL_NEXT_FLAG_ENV, "0")
    assert rg.terminal_next_enabled_for(MEMBER_ID) is False
    assert calls == [], (
        "the cohort store was consulted although the kill switch was off. "
        "`FLAG=false` must beat membership without touching a tag, or 'turning "
        "the feature off' has become 'reading the table anyway'.")

    # …and the control: with the switch ON the store IS consulted, so the
    # emptiness above is the ORDER and not a call that never happens.
    monkeypatch.setenv(rg.TERMINAL_NEXT_FLAG_ENV, "1")
    rg.terminal_next_enabled_for(MEMBER_ID)
    assert calls == [(MEMBER_ID, rg.TERMINAL_NEXT_COHORT)]


def test_the_payload_field_touches_no_tag_when_the_flag_is_off(access_payload, tagged,
                                                              monkeypatch):
    """The same ordering where a member can see it. ⛔ `cohorts` is the EFFECTIVE
    list, so an off flag empties the field without one row being read."""
    calls: list = []
    monkeypatch.setattr(rollout, "includes",
                        lambda uid, cohort, **kw: calls.append((uid, cohort)) or True)
    monkeypatch.setenv(rg.TERMINAL_NEXT_FLAG_ENV, "0")
    assert access_payload(tagged, "free")["cohorts"] == []
    assert calls == [], "the payload read a tag although the kill switch was off"


def test_no_id_means_off_and_the_store_is_never_asked(monkeypatch):
    """An unauthenticated caller, or a harness with no member, is OFF — and it
    does not open `auth.db` to find that out (the askai shape's second step)."""
    calls: list = []
    monkeypatch.setattr(rollout, "includes",
                        lambda uid, cohort, **kw: calls.append(uid) or True)
    monkeypatch.setenv(rg.TERMINAL_NEXT_FLAG_ENV, "1")
    assert rg.terminal_next_enabled_for(None) is False
    assert rg.terminal_next_enabled_for("") is False
    assert calls == []


# ───────────────────────────────────────────────────────────────────────────────
# FAIL CLOSED.
# ───────────────────────────────────────────────────────────────────────────────

def test_it_fails_CLOSED_when_the_cohort_lookup_raises(monkeypatch):
    """⛔ ANY exception at all means OFF. A dark surface that opens because the
    database was briefly unavailable is the worst failure this gate has."""
    monkeypatch.setenv(rg.TERMINAL_NEXT_FLAG_ENV, "1")

    def boom(*a, **kw):
        raise RuntimeError("auth.db is locked")

    monkeypatch.setattr(rollout, "includes", boom)
    assert rg.terminal_next_enabled_for(MEMBER_ID) is False


def test_the_payload_never_raises_even_when_the_store_explodes(access_payload, a_member,
                                                               monkeypatch):
    """⛔⛔ `_access_payload` IS THE UNIVERSAL AUTH PATH — signup, login and
    `/api/auth/me` all build it. An exception here is a LOGIN OUTAGE, not a dark
    surface, so the property worth pinning is not "off hides the cohort" but "no
    store failure, however total, can make the payload builder raise"."""
    monkeypatch.setenv(rg.TERMINAL_NEXT_FLAG_ENV, "1")

    def boom(*a, **kw):
        raise RuntimeError("auth.db is gone")

    monkeypatch.setattr(rollout, "includes", boom)
    payload = access_payload(a_member, "free")              # must not raise
    assert payload["cohorts"] == []


# ───────────────────────────────────────────────────────────────────────────────
# THE `cohorts` FIELD — the client's only channel, and it is on the shared helper.
# ───────────────────────────────────────────────────────────────────────────────

def test_the_cohorts_field_is_on_EVERY_auth_response_not_just_me(a_member):
    """signup / login / me share `_access_payload`, so a fresh session carries it.

    ⛔ Defined ONCE, inside the shared helper. A key defined anywhere else would
    work for whichever door happened to call that other code — and the door
    people forget is signup, the one a NEW member takes.
    """
    src = AUTH_ROUTER_PATH.read_text(encoding="utf-8")
    assert src.count('"cohorts"') == 1, "the field must be defined exactly once"
    helper_at = src.index("def _access_payload")
    field_at = src.index('"cohorts"')
    assert field_at > helper_at, "the cohorts field must live inside _access_payload"
    mod = importlib.import_module("api.routers.auth")
    assert "cohorts" in mod._access_payload(a_member, "free")


def test_the_field_reports_membership_when_the_flag_is_ON(access_payload, tagged,
                                                          an_outsider, monkeypatch):
    """⭐ THE THING THAT WAS GENUINELY ABSENT: the server could gate on a cohort
    while the client could not know it was in one. Driven BOTH ways, or "the
    field works" is indistinguishable from "the field says yes"."""
    monkeypatch.setenv(rg.TERMINAL_NEXT_FLAG_ENV, "1")
    assert access_payload(tagged, "free")["cohorts"] == [rg.TERMINAL_NEXT_COHORT]
    assert access_payload(an_outsider, "free")["cohorts"] == []


def test_an_UNREGISTERED_cohort_is_never_reported_to_a_client(access_payload, tagged,
                                                              monkeypatch):
    """⛔ FAIL CLOSED ON EXPOSURE. A cohort the client can see but nobody can
    switch off is a rollout with no lever, so only cohorts in
    `COHORT_KILL_SWITCHES` reach a browser. `s7-dark` is the live example: a
    server-side dark run with its own flag and no client half."""
    monkeypatch.setenv(rg.TERMINAL_NEXT_FLAG_ENV, "1")
    rollout.assign_cohort(rollout.S7_DARK, [MEMBER_ID])
    assert rollout.includes(MEMBER_ID, rollout.S7_DARK) is True, "fixture check"
    assert access_payload(tagged, "free")["cohorts"] == [rg.TERMINAL_NEXT_COHORT], (
        "a cohort with no registered kill switch was surfaced to the client")


def test_the_field_is_a_list_of_bare_names_never_the_prefixed_tag(access_payload, tagged,
                                                                  monkeypatch):
    """⛔ `rollout:` IS AN INTERNAL PREFIX. `rollout.tag_for` is the one place the
    two names are joined and it REFUSES an already-prefixed name, so leaking the
    tag to a client would create a second spelling the server would reject."""
    monkeypatch.setenv(rg.TERMINAL_NEXT_FLAG_ENV, "1")
    cohorts = access_payload(tagged, "free")["cohorts"]
    assert isinstance(cohorts, list) and all(isinstance(c, str) for c in cohorts)
    assert not any(c.startswith(rollout.ROLLOUT_PREFIX) for c in cohorts), cohorts


# ───────────────────────────────────────────────────────────────────────────────
# §4 ITEM 4 — THE OFF STATE WATCHED TO ACTUALLY KILL SOMETHING.
#
# ⚠️ THE TEST-LEVEL HALF ONLY. See this module's docstring: there is no
# production consumer yet, so what is proved is that the lever kills something
# that would otherwise be REACHABLE — not that a member has lost a surface.
# ───────────────────────────────────────────────────────────────────────────────

@pytest.fixture
def consumer(tagged, an_outsider):
    """A test consumer the dependency actually gates.

    ⛔ NOT A MOCK OF THE DEPENDENCY — `rg.require_terminal_next` is the object a
    production router would mount, resolved by FastAPI's own dependency
    machinery, over the real cohort read. Only the identity is overridden,
    because a cookie is not what is under test.

    `/both` carries the paid gate AND the cohort gate, in that order, so the
    rails can prove the second never swallows the first.
    """
    app = FastAPI()
    state = {"user": tagged}

    def require_paid(user: dict = Depends(get_current_user_with_plan)) -> dict:
        if user.get("plan") not in ("pro", "premium") and user.get("role") != "admin":
            raise HTTPException(status_code=402, detail="Terminal-Next requires a paid plan")
        return user

    @app.get("/dark")
    def dark(user: dict = Depends(rg.require_terminal_next)):
        return {"reached": user["id"]}

    @app.get("/both")
    def both(_paid: dict = Depends(require_paid),
             user: dict = Depends(rg.require_terminal_next)):
        return {"reached": user["id"]}

    app.dependency_overrides[get_current_user_with_plan] = lambda: state["user"]
    return TestClient(app), state


def test_the_OFF_state_KILLS_a_route_that_is_otherwise_REACHABLE(consumer, monkeypatch):
    """⛔⛔ THE EXIT CONDITION, and the order of the two halves is the point:
    the surface is proved REACHABLE first, so the refusal afterwards is a kill
    rather than a route that never worked.

    *"A kill switch nobody has watched actually kill something isn't a kill
    switch, it's a variable."*
    """
    client, _ = consumer

    monkeypatch.setenv(rg.TERMINAL_NEXT_FLAG_ENV, "1")
    alive = client.get("/dark")
    assert alive.status_code == 200, alive.text
    assert alive.json() == {"reached": MEMBER_ID}

    monkeypatch.setenv(rg.TERMINAL_NEXT_FLAG_ENV, "0")      # no reimport, no restart
    dead = client.get("/dark")
    assert dead.status_code == 404, (
        f"the flag was flipped off and the route still answered {dead.status_code} — "
        "the kill switch is a variable, not a switch")
    assert dead.json() == {"detail": rg.NOT_FOUND}

    # …and it comes back, so the "kill" is the flag and not a one-way latch.
    monkeypatch.setenv(rg.TERMINAL_NEXT_FLAG_ENV, "1")
    assert client.get("/dark").status_code == 200


def test_an_UNSET_flag_kills_it_too(consumer):
    """The state production is in right now. ⛔ Rung zero is reachable by nobody:
    S0's own words are *"unset ⇒ OFF for everyone including admins."*"""
    client, _ = consumer
    assert client.get("/dark").status_code == 404


def test_a_member_OUTSIDE_the_cohort_is_refused_with_the_flag_ON(consumer, an_outsider,
                                                                 monkeypatch):
    """The non-vacuity control on the whole exit condition: if the flag alone
    opened the route, the cohort would be decoration."""
    client, state = consumer
    monkeypatch.setenv(rg.TERMINAL_NEXT_FLAG_ENV, "1")
    state["user"] = an_outsider
    refused = client.get("/dark")
    assert refused.status_code == 404
    assert refused.json() == {"detail": rg.NOT_FOUND}


def test_the_refusal_is_404_and_byte_identical_to_an_UNKNOWN_ROUTE(consumer):
    """⛔ A DARK SURFACE MUST BE INDISTINGUISHABLE FROM ONE THAT DOES NOT EXIST,
    or the refusal itself announces the feature. Compared against FastAPI's own
    body for a path that genuinely is not mounted."""
    client, _ = consumer
    gated = client.get("/dark")
    never_existed = client.get("/no-such-route-at-all")
    assert gated.status_code == never_existed.status_code == 404
    assert gated.json() == never_existed.json()


def test_the_cohort_gate_sits_BESIDE_require_paid_and_never_replaces_it(consumer,
                                                                        monkeypatch):
    """⛔ ONE 402 KEEPS MEANING ONE THING — the rule
    `entitlements.limits_dependency` already states for the other axis: *"one
    answers 'may you be here at all' with a 402, the other answers 'how much of
    it do you get'."* Here: 402 is "you have not paid", 404 is "this has not been
    released to you", and neither may answer for the other.
    """
    client, state = consumer
    monkeypatch.setenv(rg.TERMINAL_NEXT_FLAG_ENV, "1")

    # Unpaid but in the cohort: the PAID sentence still refuses, with its own code.
    assert client.get("/both").status_code == 402
    # Paid and in the cohort: through.
    state["user"] = {**state["user"], "plan": "pro"}
    assert client.get("/both").status_code == 200
    # Paid, in the cohort, flag off: the COHORT sentence refuses, with its own code.
    monkeypatch.setenv(rg.TERMINAL_NEXT_FLAG_ENV, "0")
    assert client.get("/both").status_code == 404


# ───────────────────────────────────────────────────────────────────────────────
# THE LEDGER — the declared default and the reader's literal default must AGREE.
# ───────────────────────────────────────────────────────────────────────────────

def _ledger_flags() -> dict:
    return json.loads(LEDGER_PATH.read_text(encoding="utf-8"))["flags"]


def test_the_ledger_default_matches_the_readers_literal_default():
    """⛔ TWO AUTHORITIES OVER ONE VALUE IS THE DEFECT; this pins them together.

    `docs/feature_flags.json` is what a human reads to learn a gate's polarity,
    and `feature_flag_index` cannot derive this one's default — it reads only a
    literal second argument and the reader falls back to a module constant, the
    deliberate path `needs_declaration`'s own docstring describes. So the ledger
    is the ONLY written record of the polarity, and a drift between it and the
    code would leave the record describing a gate that behaves the other way
    round.
    """
    entry = _ledger_flags().get(rg.TERMINAL_NEXT_FLAG_ENV)
    assert entry is not None, (
        f"{rg.TERMINAL_NEXT_FLAG_ENV} has no entry in docs/feature_flags.json. The "
        "reader exists, so the flag-ledger rail requires one.")
    assert entry.get("default") == rg.TERMINAL_NEXT_FLAG_DEFAULT, (
        f"the ledger declares default={entry.get('default')!r} while the reader "
        f"falls back to {rg.TERMINAL_NEXT_FLAG_DEFAULT!r}")


def test_the_ledger_entry_records_WHY_it_is_dark_and_HOW_the_polarity_changes():
    """⚠️ A READER MUST NOT HAVE TO GUESS. `status: dark` can mean "held back" or
    "not built yet", and this one is the second: no consumer exists. And a gate
    whose polarity is scheduled to invert at graduation is a trap unless the
    entry says so, because the next reader will find RB-4's `armed` entry and
    think somebody flipped a default behind their back.
    """
    entry = _ledger_flags()[rg.TERMINAL_NEXT_FLAG_ENV]
    assert entry["status"] == "dark"
    assert entry["where"] == [], "declared dark but claimed to be set somewhere"
    note = (entry.get("note") or "").lower()
    assert "no consumer" in note, "the note must say WHY it is dark"
    assert "enablement" in note, "the note must name the polarity it has now"
    assert "rb-4" in note, "the note must name what flips the polarity, and when"
    assert "kill switch" in note, "the note must say what it becomes"


# ───────────────────────────────────────────────────────────────────────────────
# THE BOUNDARIES — what this module is NOT allowed to become.
# ───────────────────────────────────────────────────────────────────────────────

def test_the_gate_NEVER_reads_user_preferences():
    """⛔⛔ `POST /api/auth/preferences` accepts any `{key, value}` from any
    authenticated member, so an entitlement stored there is SELF-GRANTABLE. This
    is a source rail because the defect is a single import away and would pass
    every behavioural test in this file."""
    # ⭐ The module DOCSTRING names it in order to forbid it, so the rail reads the
    # code BELOW the docstring — otherwise the prohibition would trip its own rail.
    src = MODULE_PATH.read_text(encoding="utf-8")
    body = src.split('"""', 2)[-1]
    for forbidden in ("user_preferences", "preferences", "get_preference", "set_preference"):
        assert forbidden not in body, (
            f"rollout_gate touches {forbidden!r} — a member writes their own "
            "preferences, so a preference-backed entitlement is self-grantable")


def test_it_is_NOT_a_second_cohort_store():
    """⛔ MEMBERSHIP HAS ONE AUTHORITY: `user_tags`, read through
    `api/services/rollout.py`, written by `tools/rollout_cohort.py`. A second
    implementation of "who is in this cohort" is this repo's recurring defect, so
    this module must contain no SQL and no tag literal of its own."""
    src = MODULE_PATH.read_text(encoding="utf-8")
    body = src.split('"""', 2)[-1]
    for forbidden in ("SELECT", "INSERT", "DELETE", "user_tags", "get_connection"):
        assert forbidden not in body, (
            f"{forbidden!r} appears in rollout_gate — membership is rollout.py's")
    assert rollout.ROLLOUT_PREFIX not in body, (
        "the `rollout:` prefix is joined to a cohort name in exactly one place, "
        "`rollout.tag_for`")


def test_the_cohort_name_is_declared_once_and_is_bare():
    """⛔ ONE SPELLING. `rollout.tag_for` REFUSES an already-prefixed name, so a
    second spelling would silently project nobody."""
    assert rg.TERMINAL_NEXT_COHORT == "terminal-next"
    assert not rg.TERMINAL_NEXT_COHORT.startswith(rollout.ROLLOUT_PREFIX)
    assert rollout.tag_for(rg.TERMINAL_NEXT_COHORT) == "rollout:terminal-next"
    src = MODULE_PATH.read_text(encoding="utf-8")
    body = src.split('"""', 2)[-1]
    assert body.count('"terminal-next"') == 1, (
        "the cohort name is a literal in more than one place in this module")


def test_the_registered_cohorts_each_have_a_kill_switch_that_is_a_live_reader():
    """⛔ NON-VACUITY ON THE REGISTRY. An entry whose "kill switch" is a constant
    `True`, or a captured boolean, would make every off-state rail above
    meaningless. Each one is driven both ways through the environment.
    """
    assert rg.COHORT_KILL_SWITCHES, "an empty registry would make client_cohorts vacuous"
    import os
    for cohort, kill_switch in rg.COHORT_KILL_SWITCHES.items():
        assert not cohort.startswith(rollout.ROLLOUT_PREFIX), cohort
        assert callable(kill_switch), cohort
        before = os.environ.get(rg.TERMINAL_NEXT_FLAG_ENV)
        try:
            os.environ[rg.TERMINAL_NEXT_FLAG_ENV] = "1"
            on = kill_switch()
            os.environ[rg.TERMINAL_NEXT_FLAG_ENV] = "0"
            off = kill_switch()
        finally:
            if before is None:
                os.environ.pop(rg.TERMINAL_NEXT_FLAG_ENV, None)
            else:
                os.environ[rg.TERMINAL_NEXT_FLAG_ENV] = before
        assert (on, off) == (True, False), (
            f"{cohort}'s kill switch did not move with the environment — it is "
            "captured, or it is not a reader at all")
