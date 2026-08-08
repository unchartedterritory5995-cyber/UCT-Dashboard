"""An EDIT changes what the formula computes — measured, not assumed.

🔴 THE DEFECT. `alert_user_series.forget()` had NO PRODUCTION CALL SITE
(AST-verified over `api/**`, `tools/**`, `tests/**`: every caller was a test).
`_make_value_fn` CAPTURES the tree and `USER_FUNCS` is keyed `(user_id, address)`
with no version in the key, so after a save that bumped `compute.rev` the
registry kept handing out the SAME FUNCTION OBJECT. Measured end to end before
the fix:

    rev_bumped : True   rev: 2   (migration notice delivered)
    sma20 before edit   : 112.685
    value AFTER the edit: 112.685   (same object as before: True)
    value after forget(): 111.4522

So a member is told *"you have been switched to new maths"*, their alert is reset
and suppressed for a cycle — and then evaluates the OLD formula, forever, until
the pod restarts. Lane-independent: both `_evaluate_one` and
`_evaluate_one_closed` read the same captured object.

⛔ WHY "ASSERT `forget` WAS CALLED" IS NOT THE TEST. A spy on `forget` passes on a
tree where the registry is dropped at the wrong MOMENT (before the append, so a
concurrent read re-caches the row that is still there) and on one where the
rebuild path is broken. Every case below reads a NUMBER back out of the lane a
member's alert is evaluated on. The structural rail exists too — one case, at the
bottom — because "no call site at all" is the failure that actually happened and
it is invisible to any behavioural test that stubs the store.
"""
import ast as _ast
import pathlib

import pytest

from api.services import alert_user_series as aus
from api.services import indicator_alert_evaluator as ev
from api.services import indicator_alert_service as ias
from api.services import user_definitions as ud
from api.services import watchlist_alert_service as wls


_ROOT = pathlib.Path(__file__).resolve().parent.parent

USER_A = "edit-user-a"
DEF_ID = "u_beef0123cafe"
ADDRESS = f"{DEF_ID}.value"


def _sma(period: int) -> dict:
    return {"type": "call", "name": "sma", "args": [
        {"type": "series", "name": "close"},
        {"type": "num", "value": period},
    ]}


def defn(*, period: int = 20, name: str = "My Average") -> dict:
    return {
        "schemaVersion": 1, "id": DEF_ID, "version": 1,
        "meta": {"name": name, "shortName": "MA"},
        "compute": {"kind": "ast", "ast": _sma(period)},
        "placement": {"target": "price"},
        "plots": [{"key": "value", "style": "line", "role": "primary"}],
        "inputs": [],
    }


#: A rising series, so `sma(close, 20)` and `sma(close, 5)` cannot coincide.
BARS = [{"t": 1_700_000_000 + i * 300, "o": 100.0 + i, "h": 101.0 + i,
         "l": 99.0 + i, "c": 100.0 + i, "v": 1_000} for i in range(60)]


def _sma_of(period: int) -> float:
    closes = [b["c"] for b in BARS]
    return sum(closes[-period:]) / period


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
def transports(monkeypatch):
    """The migration NOTICE goes nowhere, and it is spied at the TRANSPORT.

    ⛔ `deliver_alert_payload` ITSELF IS NOT REPLACED — it carries the delivery
    logic the notice rides on, and replacing it would make "the member was told"
    a claim about a stub. The spy sits one level in, at `add_alert`, which is the
    shape `tests/test_alert_user_admission.py` uses for the same reason.
    """
    told: list = []
    monkeypatch.setattr(wls, "add_alert", lambda *a, **k: told.append((a, k)))
    monkeypatch.setattr(wls, "send_email", lambda *a, **k: None)
    monkeypatch.setattr(wls, "_get_user_email", lambda uid: None)
    import api.services.alerts as _alerts
    monkeypatch.setattr(_alerts, "_fire_discord", lambda payload: None)
    return told


@pytest.fixture
def bars(monkeypatch):
    monkeypatch.setattr(ev, "_fetch_bars_for_alert",
                        lambda sym, tf, count=200: [dict(b) for b in BARS])


def _alert_row(alert_id: int) -> dict:
    row = ias.get(alert_id)
    assert row is not None
    return row


# ═══ 1. THE HEADLINE — the next evaluation returns the NEW number ════════════

def test_an_EDIT_changes_what_the_next_evaluation_COMPUTES(
        defs_db, alerts_db, transports, bars):
    """🔴 THE MEASUREMENT THE DEFECT WAS FOUND WITH, AS A GATE.

    One armed alert, one definition, one set of bars. The maths is edited through
    the real `user_definitions.save` — the same path `PUT /api/user-definitions/
    {def_id}` calls — and the number the ALERT LANE reads has to move with it.
    """
    ud.save(USER_A, DEF_ID, defn(period=20))
    alert_id = ias.create(user_id=USER_A, sym="TEST", indicator=ADDRESS,
                          condition="above", threshold=-1e9, tf="5")

    before, _ = ev._evaluate_one(_alert_row(alert_id), bars=BARS, mode="forming")
    assert before == pytest.approx(_sma_of(20)), (
        "the alert did not read the ORIGINAL formula — nothing measured below "
        "would mean anything")
    captured = aus.user_value_function(USER_A, ADDRESS)

    result = ud.save(USER_A, DEF_ID, defn(period=5))
    assert result["rev_bumped"] is True and result["rev"] == 2, result
    assert result["migrated"] == 1, (
        f"the armed binding was not migrated ({result}) — the story this test "
        "tells (told about new maths, then given the old) is not being driven")

    after, _ = ev._evaluate_one(_alert_row(alert_id), bars=BARS, mode="forming")
    assert after == pytest.approx(_sma_of(5)), (
        "the alert is STILL evaluating the pre-edit tree. The registry holds a "
        "CAPTURED tree keyed with no version, so without a `forget` the member "
        "is notified of new maths and then judged on the old one, until the pod "
        "restarts")
    assert after != pytest.approx(before), "the two formulas agree — vacuous"
    assert aus.user_value_function(USER_A, ADDRESS) is not captured, (
        "the same function OBJECT came back, which is the mechanism itself")


def test_the_CLOSED_lane_moves_with_the_edit_too(
        defs_db, alerts_db, transports, bars):
    """Lane-independent, because both lanes read ONE registered object: `fn` for
    the forming lane and `fn.column` for the closed one. A fix that only reached
    the value function would leave the shipped lane stale."""
    ud.save(USER_A, DEF_ID, defn(period=20))
    alert_id = ias.create(user_id=USER_A, sym="TEST", indicator=ADDRESS,
                          condition="above", threshold=-1e9, tf="5")
    now = float(BARS[-1]["t"]) + 86_400.0

    before, _, _ = ev._evaluate_one_closed(_alert_row(alert_id), bars=BARS,
                                           now_epoch=now)
    assert before == pytest.approx(_sma_of(20))

    ud.save(USER_A, DEF_ID, defn(period=5))
    after, _, idx = ev._evaluate_one_closed(_alert_row(alert_id), bars=BARS,
                                            now_epoch=now)
    assert idx == len(BARS) - 1
    assert after == pytest.approx(_sma_of(5))

    column = aus.user_value_function(USER_A, ADDRESS).column(BARS, {})
    assert len(column) == len(BARS)
    assert column[idx] == pytest.approx(after)


# ═══ 2. THE WIDENING — every APPEND, not only a `rev` bump ═══════════════════

def test_a_save_that_does_NOT_bump_rev_still_drops_the_captured_definition(
        defs_db, alerts_db, transports, bars):
    """⛔ THE ONE-LINE FIX WAS SCOPED TO `if rev_bumped:` AND THAT IS TOO NARROW.

    What `_make_value_fn` captures is the whole `definition`, and `_inputs_for`
    reads `definition["inputs"]` out of that capture on EVERY evaluation.
    `ast_hash` covers `compute.ast` only, so changing an input's declared default
    — or anything else outside the tree — moves what the formula computes and
    bumps NOTHING. Same staleness, no rev to hang it on.

    Asserted structurally because that is where it is observable: a presentation
    edit changes no number by construction, so a number-based case here would be
    the vacuous one.
    """
    ud.save(USER_A, DEF_ID, defn(period=20, name="First"))
    ias.create(user_id=USER_A, sym="TEST", indicator=ADDRESS,
               condition="above", threshold=-1e9, tf="5")
    assert aus.USER_FUNCS, "nothing was registered — the drop below is vacuous"

    result = ud.save(USER_A, DEF_ID, defn(period=20, name="Second"))
    assert result["appended"] is True and result["rev_bumped"] is False, result
    assert aus.USER_FUNCS == {}, (
        "an appended version left the previous capture in the registry. A save "
        "that changes `inputs` rather than the tree is exactly this shape and "
        "would serve the old defaults forever")


def test_a_BYTE_IDENTICAL_re_save_does_NOT_drop_the_admission(
        defs_db, alerts_db, transports, bars):
    """⛔ THE CASE THAT MUST NOT FORGET, AND IT IS THE COMMON ONE.

    An autosaving editor re-posts the same document constantly; `save` returns
    early for a byte-identical blob and appends nothing. Dropping the registry
    there would re-run four gates per keystroke for no change at all.
    """
    ud.save(USER_A, DEF_ID, defn(period=20))
    ias.create(user_id=USER_A, sym="TEST", indicator=ADDRESS,
               condition="above", threshold=-1e9, tf="5")
    captured = aus.user_value_function(USER_A, ADDRESS)

    result = ud.save(USER_A, DEF_ID, defn(period=20))
    assert result["appended"] is False, result
    assert aus.user_value_function(USER_A, ADDRESS) is captured, (
        "a no-op re-save dropped a live admission")


def test_an_armed_alert_does_not_go_QUIET_across_the_edit(
        defs_db, alerts_db, transports, bars):
    """⛔ THE FAILURE DIRECTION OF THE FIX ITSELF.

    `forget` is a CACHE DROP, not a de-admission: `user_value_function` rebuilds
    a miss from the store through the four deterministic gates. A fix that left
    the alert unable to resolve would trade a stale number for silence, which is
    the worse of the two (`refusal_for_alert` can attribute a refusal; nothing
    attributes a quiet).
    """
    ud.save(USER_A, DEF_ID, defn(period=20))
    alert_id = ias.create(user_id=USER_A, sym="TEST", indicator=ADDRESS,
                          condition="above", threshold=-1e9, tf="5")
    ud.save(USER_A, DEF_ID, defn(period=5))

    value, triggered = ev._evaluate_one(_alert_row(alert_id), bars=BARS,
                                        mode="forming")
    assert value is not None and triggered is True
    assert aus.refusal_for_alert(_alert_row(alert_id)) is None


# ═══ 3. THE STRUCTURAL RAIL — `forget` has a PRODUCTION call site ════════════

def _forget_call_sites() -> set:
    """Every `<alert_user_series>.forget(...)` call under `api/`, by AST.

    ⛔ AST, NEVER A GREP, AND THE REASON IS ON THE RECORD: a grep on this branch
    reported five call sites for `admit_alert_fire` and all five were PROSE. This
    module's own docstrings say the word `forget` repeatedly.

    Import aliases are resolved per file, so `aus.forget()` counts and a
    same-named method on some other object does not.
    """
    out = set()
    for path in sorted((_ROOT / "api").rglob("*.py")):
        try:
            tree = _ast.parse(path.read_text(encoding="utf-8"))
        except SyntaxError:                             # pragma: no cover
            continue
        aliases = set()
        for node in _ast.walk(tree):
            if isinstance(node, _ast.ImportFrom) and node.module in (
                    "api.services", "api.services.alert_user_series"):
                for a in node.names:
                    if a.name == "alert_user_series" or node.module.endswith(
                            "alert_user_series"):
                        aliases.add(a.asname or a.name)
            if isinstance(node, _ast.Import):
                for a in node.names:
                    if a.name == "api.services.alert_user_series":
                        aliases.add(a.asname or a.name)
        if not aliases:
            continue
        for node in _ast.walk(tree):
            if isinstance(node, _ast.Call) and isinstance(node.func, _ast.Attribute) \
                    and node.func.attr == "forget" \
                    and isinstance(node.func.value, _ast.Name) \
                    and node.func.value.id in aliases:
                out.add(str(path.relative_to(_ROOT)).replace("\\", "/"))
    return out


def test_forget_has_a_PRODUCTION_call_site_and_it_is_the_write_path():
    """🔴 THE FINDING ITSELF, AS A RAIL.

    `forget` shipped with every caller in `tests/`. A registry-invalidation
    function nobody invokes is indistinguishable from one that works, because
    what it prevents is a number being subtly OLD rather than an error being
    raised — which is why this needs to be asserted structurally and not only
    through the numbers above.
    """
    sites = _forget_call_sites()
    assert "api/services/user_definitions.py" in sites, (
        f"`alert_user_series.forget` is not called from the definition WRITE "
        f"path. Call sites found under api/: {sorted(sites) or 'NONE'}")


def test_user_value_functions_docstring_claim_about_forget_is_TRUE_now():
    """`user_value_function` asserts that a definition whose maths changes *"gets
    a new `ast_hash`, a `compute.rev` bump and a `forget`"*. Two of those three
    were true. This pins the sentence to the call site so the pair cannot drift
    apart again silently."""
    doc = aus.user_value_function.__doc__ or ""
    assert "forget" in doc
    assert _forget_call_sites(), "the claim is back to being unbacked"
