"""THE DOOR. A member can arm an alert on their own formula, over HTTP.

⭐ THE DEFECT, IN ONE SENTENCE. `api/routers/indicator_alerts.py::create_alert`
refused any address `indicator_alert_evaluator.value_function()` missed, and that
function walks the three GLOBAL partitions, from which `alert_user_series
.USER_FUNCS` is deliberately and permanently absent. So `POST /api/indicator-
alerts {"indicator": "u_a1b2c3d4e5f6.value"}` answered **400 "…is not an
indicator this chart can evaluate"**, and Phase D Task 12's entire admission
chain — the repaint gate, the budget-at-armed-version gate, the arm-time
cross-lane 1e-9 proof — sat BELOW that refusal and could not be reached from the
network at all. `alert_catalog()` walked the same three partitions, so the
popover (which carries no list of its own and refuses to carry a fallback) never
offered a user formula either: no API path AND no UI producer.

🔴 WHY EVERY EXISTING TEST STAYED GREEN, AND WHY THIS FILE ASSERTS THROUGH THE
ROUTER. `tests/test_alert_user_admission.py` drives `ias.create` and
`aus.admit_user_definition` DIRECTLY and proves both are correct — and they are.
`arm_for_alert`'s docstring even asserted it was *"the real arm path, the one the
router posts to"*, which was half false for the whole of its life. Both sides of
the seam were right; nothing tested the seam. So every case below issues a
REQUEST.

⛔ AND THE INVARIANCE IS ASSERTED IN THE SAME FILE. The fix is a SCOPED
resolution at the layer that holds a signed-in account — not a fourth entry in
the global walk. `all_addresses()` is still 31, `alert_catalog()` with no id is
still the same 16 groups, and `ADDRESS_PARTITIONS` is still three tables, which
is what keeps the frozen fire log and the 31/31 `--diff` addressing the same
alerts.
"""
import contextlib
import json
import sqlite3

import pytest

from api.services import alert_user_series as aus
from api.services import indicator_alert_evaluator as ev
from api.services import indicator_alert_service as ias
from api.services import user_definitions as ud


USER_A = "router-user-a"
USER_B = "router-user-b"
DEF_ID = "u_0f1e2d3c4b5a"
ADDRESS = f"{DEF_ID}.value"

_AST_SMA5 = {"type": "call", "name": "sma", "args": [
    {"type": "series", "name": "close"},
    {"type": "num", "value": 5},
]}


def defn(*, def_id: str = DEF_ID, tree=None, budget=None,
         name: str = "My Average") -> dict:
    compute: dict = {"kind": "ast", "ast": tree if tree is not None else _AST_SMA5}
    if budget is not None:
        compute["budget"] = budget
    return {
        "schemaVersion": 1, "id": def_id, "version": 1,
        "meta": {"name": name, "shortName": "MA"},
        "compute": compute, "placement": {"target": "price"},
        "plots": [{"key": "value", "style": "line", "role": "primary"}],
        "inputs": [],
    }


#: A short, monotonic series. Short on purpose: every admitting POST spawns a
#: node process for the cross-lane proof, and 60 bars proves the same thing 5,000
#: would.
BARS = [{"t": 1_700_000_000 + i * 300, "o": 100.0 + i, "h": 101.0 + i,
         "l": 99.0 + i, "c": 100.0 + i, "v": 1_000} for i in range(60)]


# ─── fixtures ────────────────────────────────────────────────────────────────

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
def bars(monkeypatch):
    """The evaluator's own fetcher, pinned. `arm_for_alert` calls it by name."""
    monkeypatch.setattr(ev, "_fetch_bars_for_alert",
                        lambda sym, tf, count=200: [dict(b) for b in BARS])


@pytest.fixture
def client(defs_db, alerts_db, bars):
    """A real TestClient over the real app, with ONE overridable account.

    ⚠️ THE ACCOUNT IS MUTABLE so a case can ask the same catalog as somebody
    ELSE. Scoping is the property that makes a per-user address safe, and it is
    not observable from a single signed-in user.
    """
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

    Same technique, same justification, as `tests/test_alert_user_admission.py`:
    `_gate_repaint` reads what `save` stored, so writing that value is how a test
    drives the repaint door rather than the linter.
    """
    row = ud.save(user_id, definition["id"], definition)
    if repaint is not None:
        with sqlite3.connect(str(ud._DB_PATH)) as c:
            c.execute("UPDATE user_definitions SET repaint=? "
                      "WHERE user_id=? AND def_id=? AND version=?",
                      (json.dumps(repaint), str(user_id), definition["id"],
                       row["version"]))
    return row


def post(client, **over) -> "object":
    body = {"sym": "TEST", "indicator": ADDRESS, "condition": "above",
            "threshold": 1.0, "tf": "5"}
    body.update(over)
    return client.post("/api/indicator-alerts", json=body)


@contextlib.contextmanager
def lane_disagreement(*, at_bar: int, by: float):
    """Make the Python lane answer differently at ONE bar, by a relative amount.

    ⛔ IT PERTURBS A VALUE; IT DOES NOT BLIND A LANE — the distinction Phase C
    Task 5 measured. A blinded lane is refused by `compare_lanes`' structural
    doors instead, so the mutation would prove nothing about the gate under test.

    ⛔ AND IT RESTORES ON EXIT RATHER THAN AT TEARDOWN, WHICH IS NOT A STYLE
    CHOICE — it was a measured failure. Built on `monkeypatch.setattr`, the undo
    runs when the TEST ends, not when the `with` ends, so the positive control
    that follows the refusal ran against a still-perturbed lane and read 400. A
    control that cannot pass is worse than no control
    (`lesson_cleanup_must_verify_ownership`), so the restore is owned here and
    asserted.
    """
    conf = aus._conformance()
    real = conf.run_py

    def perturbed(cases, bars):
        out = real(cases, bars)
        for col in out.values():
            if col[at_bar] is not None:
                col[at_bar] = col[at_bar] * (1.0 + by)
        return out

    conf.run_py = perturbed
    try:
        yield
    finally:
        conf.run_py = real
        assert conf.run_py is real, "the perturbation outlived its `with` block"


# ═══ 1. THE HEADLINE — a POST on a user formula ARMS ═════════════════════════

def test_a_POST_on_a_user_formula_REACHES_the_admission_chain_and_ARMS(client):
    """🔴 THE CASE THE WHOLE FIX IS FOR. This was a 400 that named the wrong
    problem; now the row exists, is labelled user-authored, and a series is
    registered — which only `admit_user_definition` does, so the admission chain
    really ran rather than being skipped.
    """
    save(USER_A, defn())
    r = post(client)
    assert r.status_code == 200, r.text
    alert_id = r.json()["id"]

    row = ias.get(alert_id)
    assert row["indicator"] == ADDRESS
    assert row["def_source"] == ias.DEF_SOURCE_USER, (
        "the row does not record that a user authored its arithmetic — the "
        "admission chain was bypassed, not reached")
    assert aus.scoped_key(USER_A, ADDRESS) in aus.USER_FUNCS, (
        "nothing was registered: `admit_user_definition` never ran, so a 200 "
        "here would mean an alert armed with no proof behind it")


def test_the_user_address_is_NOT_case_folded_on_the_way_in(client):
    """⛔ A USER PLOT KEY MAY BE camelCase, AND `resolve_address` LOWERCASES.

    The builtin branch has to fold (eight legacy keys are stored lowercase); the
    user namespace has no legacy and must keep the spelling the definition
    declares, or the store is asked for a plot it does not have.
    """
    definition = defn()
    definition["plots"] = [{"key": "fastLine", "style": "line", "role": "primary"}]
    save(USER_A, definition)
    r = post(client, indicator=f"{DEF_ID}.fastLine")
    assert r.status_code == 200, r.text
    assert ias.get(r.json()["id"])["indicator"] == f"{DEF_ID}.fastLine"


def test_an_unknown_BUILTIN_address_is_still_refused_exactly_as_before(client):
    """⛔ THE NON-MEASUREMENT ASSERTION. The gate that was over-broad is narrowed,
    not deleted: a typo is still a 400 that names the catalog, and the price
    aliases still redirect to the watchlist lane."""
    r = post(client, indicator="not_an_indicator")
    assert r.status_code == 400
    assert "is not an indicator this chart can evaluate" in r.json()["detail"]

    r2 = post(client, indicator="price")
    assert r2.status_code == 400
    assert "/api/watchlist-alerts" in r2.json()["detail"]

    # …and an address in the user GRAMMAR with nothing stored behind it is
    # refused by the DEFINITION gate — a different door, with a different
    # sentence, which is what makes "reached the chain" mean something.
    r3 = post(client, indicator=f"{DEF_ID}.value")
    assert r3.status_code == 400
    assert "[gate:definition]" in r3.json()["detail"]
    assert "is not an indicator this chart can evaluate" not in r3.json()["detail"]


# ═══ 2. REFUSED BY THE GATE THAT MEANS IT ════════════════════════════════════

def test_a_repainting_formula_is_refused_BY_THE_REPAINT_GATE_through_the_router(
        client):
    """⭐ THE SECOND HALF OF "REACHES THE ADMISSION CHAIN": the refusals a user
    sees now come from the door that decided, not from a lookup that never knew
    about them. Nothing is armed, because `create` raises before the INSERT."""
    save(USER_A, defn(), repaint={"value": "repaints"})
    r = post(client)
    assert r.status_code == 400, r.text
    detail = r.json()["detail"]
    assert "[gate:repaint]" in detail
    assert aus.REFUSAL_FRAGMENTS["repaint"] in detail
    assert ias.list_active() == []


def test_a_formula_over_its_budget_is_refused_BY_THE_BUDGET_GATE(client):
    save(USER_A, defn(budget={"maxNodes": 1}))
    r = post(client)
    assert r.status_code == 400, r.text
    assert "[gate:budget]" in r.json()["detail"]
    assert ias.list_active() == []


def test_the_ARM_TIME_CROSS_LANE_PROOF_is_reachable_from_HTTP(client):
    """🔴 THE GATE THAT WAS FURTHEST BELOW THE DEAD SEAM.

    D-A2's runtime half — both lanes, this tree, these bars, 1e-9 — is the last
    thing `ias.create` does before inserting, so it is the deepest proof that the
    door is genuinely open rather than open as far as the first cheap check.
    """
    save(USER_A, defn())
    with lane_disagreement(at_bar=30, by=1e-6):
        r = post(client)
    assert r.status_code == 400, r.text
    detail = r.json()["detail"]
    assert "[gate:cross-lane]" in detail
    assert "the two lanes disagree at bar 30" in detail
    assert ias.list_active() == []
    assert aus.USER_FUNCS == {}

    # …and the POSITIVE CONTROL: the same request, unperturbed, arms. Without it
    # this is satisfied by a door that refuses everything.
    assert post(client).status_code == 200


def test_one_accounts_formula_cannot_be_armed_by_another_over_HTTP(client):
    """The per-user property, asserted where it would actually be attacked."""
    save(USER_A, defn())
    client.become("id", USER_B)
    r = post(client)
    assert r.status_code == 400, r.text
    assert "[gate:definition]" in r.json()["detail"]
    assert ias.list_active() == []

    client.become("id", USER_A)
    assert post(client).status_code == 200


# ═══ 3. THE CATALOG OFFERS IT — the UI producer ══════════════════════════════

def _catalog(client) -> list:
    r = client.get("/api/indicator-alerts/catalog")
    assert r.status_code == 200, r.text
    return r.json()["catalog"]


def test_the_catalog_OFFERS_this_accounts_own_formula(client):
    """⭐ THE UI PRODUCER. `IndicatorAlertPopover` retired all five of its
    hand-written literals and refuses to keep a fallback, so it offers EXACTLY
    what this endpoint returns — which means a definition absent from here has no
    producer at all, not merely a missing one.
    """
    save(USER_A, defn(name="My Average"))
    entry = next((e for e in _catalog(client) if e["indicator"] == DEF_ID), None)
    assert entry is not None, (
        "the account's own formula is not in its own catalog — the popover has "
        "nothing to render and the alert can only be created by curl")
    assert entry["label"] == "My Average"
    assert entry["source"] == "user"
    assert entry["plots"][0]["value"] == ADDRESS, (
        "`plots[i].value` is the address the popover SUBMITS; anything else "
        "stores an alert the evaluator cannot resolve")

    # The conditions offered are the ones a bare LEVEL takes, derived from the
    # price address's own row rather than retyped here or there.
    close_entry = next(e for e in _catalog(client) if e["indicator"] == "close")
    assert entry["plots"][0]["conditions"] == close_entry["plots"][0]["conditions"]
    assert entry["conditions"] == entry["plots"][0]["conditions"]


def test_a_MULTI_PLOT_formula_offers_every_plot_paired_with_its_OWN_key(client):
    """⛔ THE PAIRING IS BUILT ONCE, NOT ZIPPED FROM TWO LISTS.

    "Alert me on my formula" can name more than one line, and a keyless plot
    makes a plots-list and a keys-list different lengths — after which `zip`
    labels every later line with the PREVIOUS one's name while every address
    stays valid. Nothing downstream can detect that, so it is asserted here, with
    a keyless plot exercised directly against the pairing helper.

    ⚠️ THE KEYLESS PLOT IS NOT DRIVEN THROUGH `save`, AND THE REASON IS MEASURED:
    `user_definitions.lint_verdict` returns `{plotKey: mode}`, so a keyless plot
    puts a `None` KEY in that dict and `json.dumps(..., sort_keys=True)` raises
    `TypeError: '<' not supported between instances of 'NoneType' and 'str'`
    before anything is stored. So the store cannot hold one today and the guard
    here is defensive — asserted at the helper, which is where it is reachable.
    """
    definition = defn(name="Two Lines")
    definition["plots"] = [
        {"key": "fast", "style": "line", "role": "primary", "name": "Fast"},
        {"key": "slow", "style": "line", "role": "secondary", "name": "Slow"},
    ]
    save(USER_A, definition)
    entry = next(e for e in _catalog(client) if e["indicator"] == DEF_ID)
    assert [(p["value"], p["label"]) for p in entry["plots"]] == [
        (f"{DEF_ID}.fast", "Two Lines · Fast"),
        (f"{DEF_ID}.slow", "Two Lines · Slow"),
    ]

    holed = {"plots": [dict(definition["plots"][0]),
                       {"style": "line", "role": "secondary"},
                       dict(definition["plots"][1])]}
    assert [key for _plot, key in aus._plots_of(holed)] == ["fast", "slow"]
    assert [p.get("name") for p, _k in aus._plots_of(holed)] == ["Fast", "Slow"], (
        "a keyless plot shifted the pairing — a later line would be labelled "
        "with an earlier one's name while every address stayed valid")


def test_the_catalog_is_SCOPED_and_shows_nobody_elses_formula(client):
    save(USER_A, defn())
    assert any(e["indicator"] == DEF_ID for e in _catalog(client))
    client.become("id", USER_B)
    assert not any(e["indicator"] == DEF_ID for e in _catalog(client)), (
        "another account's formula is offered in this one's dropdown")


def test_the_catalog_does_NOT_offer_a_formula_the_gates_would_refuse(client):
    """`alert_catalog`'s contract is that the dropdown cannot offer an alert that
    cannot fire. A `repaints` definition is exactly such an alert."""
    save(USER_A, defn(), repaint={"value": "repaints"})
    assert not any(e["indicator"] == DEF_ID for e in _catalog(client))

    # …and the control, on the same account and the same definition id: with the
    # verdict clean it IS offered, so "absent" measured the gate and not the
    # scoping, the store, or a typo in the id.
    save(USER_A, defn(name="v2"), repaint={"value": "non-repainting"})
    assert any(e["indicator"] == DEF_ID for e in _catalog(client))


def test_the_GLOBAL_catalog_is_BYTE_UNMOVED_by_the_scoped_one(client):
    """🔴 THE INVARIANCE, THROUGH THE SERVED ROUTE.

    The user entries are APPENDED. Every global group is where it was, in the
    order it was, so an existing user's dropdown opens on the option it always
    did — and `alert_catalog()` called with no account still returns the exact
    enumeration `--diff 31/31` and the frozen fire log are addressed by.
    """
    save(USER_A, defn())
    served = _catalog(client)
    global_entries = ev.alert_catalog()
    assert len(global_entries) == 16
    assert served[:len(global_entries)] == global_entries
    assert [e["indicator"] for e in served[len(global_entries):]] == [DEF_ID]

    assert len(ev.all_addresses()) == 31
    assert not [a for a in ev.all_addresses() if aus.is_user_address(a)]
    assert len(ev.ADDRESS_PARTITIONS) == 3
    assert all(p is not aus.USER_FUNCS for p in ev.ADDRESS_PARTITIONS)
    # …and a bare user address still resolves to NOTHING without an account.
    assert ev.value_function(ADDRESS) is None


# ═══ 4. THE PREFILL — `/current-value` carried the identical dead gate ═══════

def test_current_value_PREFILLS_a_user_formula_instead_of_refusing_it(client):
    """Spec §8's *"threshold prefilled from current value"*. The same
    `value_function(...) is None` gate lived here, so the threshold box on a user
    formula opened on a 400."""
    save(USER_A, defn())
    r = client.get("/api/indicator-alerts/current-value",
                   params={"sym": "TEST", "tf": "5", "indicator": ADDRESS})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["value"] == pytest.approx(sum(b["c"] for b in BARS[-5:]) / 5)
    assert body["instance_label"] == "My Average"


def test_current_value_refuses_a_user_formula_BY_ITS_GATE_too(client):
    save(USER_A, defn(), repaint={"value": "repaints"})
    r = client.get("/api/indicator-alerts/current-value",
                   params={"sym": "TEST", "tf": "5", "indicator": ADDRESS})
    assert r.status_code == 400, r.text
    assert "[gate:repaint]" in r.json()["detail"]
