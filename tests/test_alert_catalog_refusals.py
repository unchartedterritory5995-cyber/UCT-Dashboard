"""🔴 THE ALERT PICKER OMITTED A REFUSED FORMULA AND SAID NOTHING.

`alert_user_series.user_catalog` runs the admission gates over every stored
formula and ``continue``s past the ones a gate refuses. That is CORRECT per
``alert_catalog``'s own contract -- *"the dropdown cannot offer an alert that
cannot fire"* -- and completely SILENT. A member typed a formula, the STORE
accepted it, ``GET /api/user-definitions`` lists it, the indicator library shows
it (since ``918e3c8a``), and the alert picker simply does not have it. The reason
existed the whole time, inside ``AdmissionRefused``, with no consumer on this
path at all. ``fix-visibility-report.md`` concern 4 named it as still open; this
is the close.

⛔⛔ WHY THIS FILE EXISTS WHEN BOTH COMPONENTS WERE ALREADY GREEN -- WHICH IS THE
DEFECT CLASS, NOT AN ASIDE. ``tests/test_alert_user_admission.py`` proves every
gate refuses what it should and names its own door.
``tests/test_alert_user_router.py::test_the_catalog_does_NOT_offer_a_formula_the_
gates_would_refuse`` proves the catalog omits a refused formula. Both are right,
both stay right, and between them sat a member who could not find their formula
and was told nothing. Every case below asserts the CONNECTION -- a sentence that
starts at a gate and ends in an HTTP response -- and the report records each wire
cut and the red it produced.

⛔ THE SENTENCE IS THE DOOR'S, AND THAT IS ASSERTED BY EQUALITY WITH THE DOOR
ITSELF, never by a literal typed here. A paraphrase would put a second,
unasserted spelling of every refusal on the wire, and
``REFUSAL_FRAGMENTS``' pairwise disjointness -- a SAFETY property, because two
gates once shared a phrase and a ``raises(match=...)`` passed with the safety
deleted -- says exactly nothing about a copy this file invented.
"""
import contextlib
import json
import sqlite3

import pytest

from api.services import alert_user_series as aus
from api.services import indicator_alert_evaluator as ev
from api.services import indicator_alert_service as ias
from api.services import user_definitions as ud


USER_A = "refusals-user-a"
USER_B = "refusals-user-b"
DEF_ID = "u_0a1b2c3d4e5f"

#: `sma(close, 5)`, canonical. Short and admissible: this file is about what
#: happens to a formula the gates REFUSE, so the tree itself must never be the
#: thing under suspicion.
_AST_SMA5 = {"type": "call", "name": "sma", "args": [
    {"type": "series", "name": "close"},
    {"type": "num", "value": 5},
]}


def defn(*, def_id: str = DEF_ID, tree=None, budget=None,
         name: str = "My Average", plots=None) -> dict:
    compute: dict = {"kind": "ast", "ast": tree if tree is not None else _AST_SMA5}
    if budget is not None:
        compute["budget"] = budget
    return {
        "schemaVersion": 1, "id": def_id, "version": 1,
        "meta": {"name": name, "shortName": "MA"},
        "compute": compute, "placement": {"target": "price"},
        "plots": [{"key": "value", "style": "line", "role": "primary"}]
        if plots is None else plots,
        "inputs": [],
    }


# ─── fixtures ────────────────────────────────────────────────────────────────
#
# The same three `test_alert_user_router.py` uses, for the same reasons: a real
# TestClient over the real app so the assertion is about what a browser receives,
# and a MUTABLE account so scoping is observable at all.

@pytest.fixture
def defs_db(tmp_path, monkeypatch):
    path = tmp_path / "user_definitions.db"
    monkeypatch.setenv("USER_DEFINITIONS_DB_PATH", str(path))
    monkeypatch.setattr(ud, "_DB_PATH", str(path))
    ud._init_db()
    aus.forget()
    try:
        yield path
    finally:
        aus.forget()


@pytest.fixture
def alerts_db(tmp_path, monkeypatch):
    path = tmp_path / "auth.db"
    monkeypatch.setenv("AUTH_DB_PATH", str(path))
    monkeypatch.setattr(ias, "_DB_PATH", str(path))
    ias.init_schema()
    return path


@pytest.fixture
def client(defs_db, alerts_db):
    from fastapi.testclient import TestClient
    from api.main import app
    from api.middleware.auth_middleware import get_current_user

    who = {"id": USER_A}
    app.dependency_overrides[get_current_user] = lambda: dict(who)
    try:
        c = TestClient(app)
        c.become = who.__setitem__            # type: ignore[attr-defined]
        yield c
    finally:
        app.dependency_overrides.pop(get_current_user, None)


def save(user_id: str, definition: dict, *, repaint: dict | None = None) -> dict:
    """Store a definition, optionally overriding the linter's STORED verdict.

    Same technique and same justification as `test_alert_user_admission.py`:
    `_gate_repaint` reads what `save` stored, so writing that column is how a
    test drives the repaint DOOR rather than the linter behind it.
    """
    row = ud.save(user_id, definition["id"], definition)
    if repaint is not None:
        with sqlite3.connect(str(ud._DB_PATH)) as c:
            c.execute("UPDATE user_definitions SET repaint=? "
                      "WHERE user_id=? AND def_id=? AND version=?",
                      (json.dumps(repaint), str(user_id), definition["id"],
                       row["version"]))
    return row


def served(client) -> dict:
    r = client.get("/api/indicator-alerts/catalog")
    assert r.status_code == 200, r.text
    return r.json()


@contextlib.contextmanager
def gates_for(row: dict, def_id: str):
    """Drive the REAL gates and hand back whatever they raise.

    ⛔ THIS IS HOW THE EXPECTED SENTENCE IS OBTAINED — from the door, at the
    moment of the assertion, never from a literal. `IndicatorLibraryDialog
    .refusals.test.jsx` takes the same position one surface over
    (`doorSentencesFor` calls the real installer): a truncation, a re-wording or
    a prefix quietly dropped fails, and a message the gates change moves the
    expectation with it instead of orphaning a copy typed in a test.
    """
    raised: list = []
    try:
        definition = aus._gate_lane(row)
        aus._gate_repaint(row, definition)
        aus._gate_budget(definition, def_id)
    except Exception as exc:  # noqa: BLE001 - the sentence IS the subject
        raised.append(exc)
    yield raised


# ═══ 1. THE HEADLINE — a refused formula's own sentence reaches the response ══

def test_a_REFUSED_formula_reaches_the_catalog_response_with_the_GATES_OWN_sentence(client):
    """🔴 THE CASE THE WHOLE FIX IS FOR.

    A `repaints` verdict is the refusal a member is most likely to hit and least
    able to guess at: the formula saved, it draws on the chart, and the alert
    picker does not have it.
    """
    save(USER_A, defn(name="Repainting Average"), repaint={"value": "repaints"})
    body = served(client)

    # The premise: it really is absent from the offerings. Without this the case
    # below could pass on a build that offers it AND explains it.
    assert not [e for e in body["catalog"] if e["indicator"] == DEF_ID]

    assert "refusals" in body, (
        "the catalog response carries no `refusals` block at all — a member who "
        "cannot find their formula in the picker is told nothing, which is the "
        "silence this endpoint was fixed to end")
    entry = next((r for r in body["refusals"] if r["id"] == DEF_ID), None)
    assert entry is not None, (
        f"{DEF_ID} is neither offered nor explained: {body['refusals']}")

    # ⭐ THE SENTENCE IS THE DOOR'S, COMPARED BY EQUALITY. `toEqual`-style, never
    # a substring: a truncation or a paraphrase has to fail.
    row = ud.get(USER_A, DEF_ID)
    with gates_for(row, DEF_ID) as raised:
        pass
    assert len(raised) == 1, "the gates admitted the fixture — it proves nothing"
    assert entry["messages"] == [str(raised[0])]

    # …and the door NAMES ITSELF, which is what makes "refused by a different
    # door" — the defect this branch has hit five times — detectable here.
    assert entry["gate"] == raised[0].gate == "repaint"
    assert aus.REFUSAL_FRAGMENTS["repaint"] in entry["messages"][0]
    assert "[gate:repaint]" in entry["messages"][0], (
        "the door's own attribution suffix was stripped — the message is not "
        "being passed through whole")
    # The member's own name for it, from the door's own labeller.
    assert entry["label"] == "Repainting Average"


def test_an_ACCEPTED_formula_carries_NO_refusal_at_all(client):
    """⛔ THE OTHER DIRECTION, AND IT IS THE ONE THAT MAKES THE FIRST MEAN
    ANYTHING. Without it, "the refusal appears" is satisfied by a build that
    reports every formula as refused — which would be a worse lie than silence,
    because it would tell a member their working formula is broken.
    """
    save(USER_A, defn(name="Fine Average"))
    body = served(client)

    assert [e["indicator"] for e in body["catalog"] if e["indicator"] == DEF_ID] == [DEF_ID]
    assert body["refusals"] == [], (
        "an admitted formula is reported as refused — the picker offers it and "
        "the same response says it cannot be offered")


def test_the_SAME_definition_id_flips_BOTH_WAYS_across_a_re_save(client):
    """⭐ ONE ID, TWO VERDICTS, IN ONE TEST — so "absent" and "explained" are
    measuring the GATE and not the scoping, the store, or a typo in the id.
    """
    save(USER_A, defn(), repaint={"value": "repaints"})
    first = served(client)
    assert [r["id"] for r in first["refusals"]] == [DEF_ID]
    assert not [e for e in first["catalog"] if e["indicator"] == DEF_ID]

    save(USER_A, defn(name="v2"), repaint={"value": "non-repainting"})
    second = served(client)
    assert second["refusals"] == []
    assert [e["indicator"] for e in second["catalog"] if e["indicator"] == DEF_ID] == [DEF_ID]


# ═══ 2. COMPLETENESS — the block is the CATALOG'S COMPLEMENT ═════════════════

def test_every_stored_formula_is_either_OFFERED_or_REFUSED(client):
    """⛔⛔ THE BICONDITIONAL, AND IT IS WHY THE SET IS NOT A SECOND RUN OF THE
    GATES.

    A `refusals` list derived independently could drift from `user_catalog`'s
    own skip decisions, and the drift would be silent in exactly the original
    direction: a formula in NEITHER list. So the offered ids come from
    `user_catalog` itself and everything else the store holds is reported —
    which makes this an equality rather than a hope.

    Four formulas, refused at three different doors plus one admitted, so the
    partition is real in both directions rather than trivially satisfied.
    """
    save(USER_A, defn(def_id="u_aaaaaaaaaaaa", name="Clean"))
    save(USER_A, defn(def_id="u_bbbbbbbbbbbb", name="Repaints"),
         repaint={"value": "repaints"})
    save(USER_A, defn(def_id="u_cccccccccccc", name="Over budget",
                      budget={"maxNodes": 1}))
    # A formula with no keyed plot: no gate refuses it and `user_catalog` still
    # skips it, because there is no `<def>.<plot>` address to offer. It is the
    # one omission with no door to quote, and the case that proves this function
    # is TOTAL rather than merely gate-shaped.
    save(USER_A, defn(def_id="u_dddddddddddd", name="No plots", plots=[]))

    body = served(client)
    stored = {r["def_id"] for r in ud.list_for_user(USER_A)}
    offered = {e["indicator"] for e in body["catalog"]} & stored
    refused = {r["id"] for r in body["refusals"]}

    assert offered == {"u_aaaaaaaaaaaa"}
    assert offered | refused == stored, (
        f"formulas in neither list: {stored - offered - refused} — this is the "
        "original silence, one remove out")
    assert not offered & refused, (
        f"formulas in BOTH lists: {offered & refused}")

    # …and each one is attributed to the door that really refused it, not to
    # whichever gate happens to run first.
    by_id = {r["id"]: r for r in body["refusals"]}
    assert by_id["u_bbbbbbbbbbbb"]["gate"] == "repaint"
    assert by_id["u_cccccccccccc"]["gate"] == "budget"
    assert by_id["u_dddddddddddd"]["gate"] is None
    assert ias.NO_PLOT_TO_OFFER in by_id["u_dddddddddddd"]["messages"][0]
    assert by_id["u_dddddddddddd"]["messages"][0] != by_id["u_bbbbbbbbbbbb"]["messages"][0]


def test_a_TABLE_refusal_is_reported_as_the_TABLES_OWN_sentence(client):
    """⛔ NOT RELABELLED AS A BUDGET REFUSAL. `_gate_budget` re-raises only
    `BudgetExceeded`; `interpret:node` / `resolve:function` / `resolve:arity` /
    `resolve:window` propagate as THEMSELVES, and its docstring says relabelling
    one would be the wrong-door defect. `user_catalog` swallows them into the
    same `continue`, so without this they would be the one refusal class that
    reached the member as a blank.

    ⚠️ THE FIXTURE IS A **STALE STORED VERDICT**, AND THAT IS MEASURED RATHER
    THAN CONVENIENT. Every tree the table cannot resolve also LINTS `repaints`,
    so on a freshly-saved definition `_gate_repaint` fires first and the table is
    never reached — the door order makes it so. The table refusal becomes the
    live one exactly when the stored verdict says clean and the tree no longer
    resolves, which is Phase D Task 10's own named mechanism (*"a closed-table
    entry removed … can invalidate a definition that was legal the day it was
    written"*) and the same fixture `IndicatorLibraryDialog.refusals.test.jsx`
    uses one surface over.
    """
    save(USER_A, defn(tree={"type": "call", "name": "notAFunction",
                            "args": [{"type": "series", "name": "close"}]}),
         repaint={"value": "non-repainting"})
    body = served(client)
    entry = next(r for r in body["refusals"] if r["id"] == DEF_ID)

    row = ud.get(USER_A, DEF_ID)
    with gates_for(row, DEF_ID) as raised:
        pass
    assert entry["messages"] == [str(raised[0])]
    assert entry["gate"] == raised[0].guard == "resolve:function"
    # …and it did NOT arrive wearing another door's name.
    assert "[gate:budget]" not in entry["messages"][0]
    assert aus.REFUSAL_FRAGMENTS["budget"] not in entry["messages"][0]


# ═══ 3. THE INVARIANTS THAT MUST NOT MOVE ════════════════════════════════════

def test_the_refusals_are_SCOPED_and_name_nobody_elses_formula(client):
    """A refusal sentence carries the member's own formula name and its id. One
    account's refusal reaching another's picker would be a disclosure, not a
    diagnostic.
    """
    save(USER_A, defn(name="A's private idea"), repaint={"value": "repaints"})
    assert [r["id"] for r in served(client)["refusals"]] == [DEF_ID]
    client.become("id", USER_B)
    assert served(client)["refusals"] == []


def test_the_CATALOG_half_of_the_response_is_BYTE_UNMOVED(client):
    """⛔ `refusals` IS A SECOND KEY, NEVER A ROW AMONG THE OFFERINGS. A refused
    formula has no address to submit, so an entry in `catalog` would be an option
    that arms nothing — the defect the library dialog's separate section exists
    to avoid, one surface over. And the global enumeration the frozen fire log
    and the 31/31 `--diff` address is untouched.
    """
    save(USER_A, defn(), repaint={"value": "repaints"})
    body = served(client)
    assert body["catalog"] == ev.alert_catalog()
    assert len(ev.alert_catalog()) == 16
    assert len(ev.all_addresses()) == 31
    assert len(ev.ADDRESS_PARTITIONS) == 3


def test_with_NO_account_the_read_out_is_empty_and_reaches_no_store(monkeypatch):
    """`alert_catalog()` with no id is the enumeration every rail measures, and
    this must not add a store read beside it. A falsey id returns `[]` before
    anything is opened.
    """
    def explode(*_a, **_k):  # pragma: no cover - the point is that it is not hit
        raise AssertionError("the store was read for an account that is not there")

    monkeypatch.setattr(ud, "list_for_user", explode)
    monkeypatch.setattr(aus, "user_catalog", explode)
    assert ias.user_definition_refusals(None) == []
    assert ias.user_definition_refusals("") == []
