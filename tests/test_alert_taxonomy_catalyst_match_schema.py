"""GATE-S7-CATALYST-MATCH Checkpoint 1 — registration + schema, nothing else.

⛔ The type must be DARK BY CONSTRUCTION, not by intention: no delivery import,
no write to the legacy dedup table, no call into the catalyst engine, and nothing
calling `register()` yet. Each is asserted FROM THE SOURCE rather than promised.
"""
from __future__ import annotations

import ast
import pathlib

from api.services.alert_taxonomy import catalyst_match as cm
from api.services.alert_taxonomy import db as _db
from api.services.alert_taxonomy import registry as _registry

_REPO = pathlib.Path(__file__).resolve().parents[1]
_MODULE = _REPO / "api" / "services" / "alert_taxonomy" / "catalyst_match.py"
_LEGACY = _REPO / "api" / "services" / "catalyst" / "engine.py"
_SYNTH = _REPO / "api" / "services" / "catalyst" / "synthesize.py"


#: ⛔⛔ DOCUMENTATION IS NOT ALWAYS A DOCSTRING IN THIS PACKAGE. `PARAMS_SCHEMA`
#: and `BLIND_SPOTS` are prose that happens to be stored in string LITERALS, so a
#: docstring-only stripper leaves every word of them in the "code" it hands back
#: — and the first draft of this file went red because the schema DESCRIBES the
#: legacy dedup table it must never touch. Blanking these two by name is the fix;
#: `test_the_stripper_sees_code_and_not_prose` proves it still sees real code.
_PROSE_CONSTANTS = ("PARAMS_SCHEMA", "BLIND_SPOTS", "CATALYST_TYPE_CONVENTION")


def _code_only(path: pathlib.Path) -> str:
    """⛔ CODE, NEVER PROSE. This module discusses delivery, the dedup table and
    the legacy functions at length — a naive substring search matches its own
    explanation and every assertion below would be red on its documentation."""
    tree = ast.parse(path.read_text(encoding="utf-8"))
    for node in ast.walk(tree):
        if (isinstance(node, ast.Expr) and isinstance(node.value, ast.Constant)
                and isinstance(node.value.value, str)):
            node.value.value = ""
        if isinstance(node, ast.Assign) and any(
                isinstance(t, ast.Name) and t.id in _PROSE_CONSTANTS for t in node.targets):
            node.value = ast.Constant(value="<prose>")
    return ast.unparse(ast.fix_missing_locations(tree))


def _names_used_in_functions(path: pathlib.Path) -> set:
    """Every global NAME read inside a function body — the honest test of
    "does the evaluator consult this constant", which a substring search over a
    module that also DESCRIBES the constant cannot answer."""
    tree = ast.parse(path.read_text(encoding="utf-8"))
    used = set()
    for fn in [n for n in ast.walk(tree) if isinstance(n, ast.FunctionDef)]:
        for node in ast.walk(fn):
            if isinstance(node, ast.Name) and isinstance(node.ctx, ast.Load):
                used.add(node.id)
            if isinstance(node, ast.Attribute):
                used.add(node.attr)
    return used


def test_the_stripper_sees_code_and_not_prose():
    """⛔ THE CONTROL FOR EVERY ABSENCE ASSERTION BELOW. Without it, a stripper
    that returned '' would make all of them pass over nothing."""
    code = _code_only(_MODULE)
    raw = _MODULE.read_text(encoding="utf-8")
    # (a) both needles ARE in the prose
    assert "deliver_alert_payload" in raw
    assert "catalyst_alerts_fired" in raw
    # (b) and NEITHER is in the code
    assert "deliver_alert_payload" not in code
    assert "catalyst_alerts_fired" not in code
    # (c) and the stripper still sees real code. ⛔ Named against what CP1
    # SHIPS — `register` and the type id — not against an evaluator this
    # checkpoint does not have. A control that asserts a symbol from a later
    # checkpoint is a control that cannot run at its own checkpoint.
    assert "def register" in code
    assert "TYPE_ID = 'catalyst-match'" in code or 'TYPE_ID = "catalyst-match"' in code
    assert "register_trigger_type" in code
    assert len(code) > 500


# --- the type ---------------------------------------------------------------

def test_the_type_id_is_the_spec_s_id():
    assert cm.TYPE_ID == "catalyst-match"


def test_registration_round_trips_the_schema(tmp_path):
    p = str(tmp_path / "at.db")
    _db.init_db(db_path=p)
    cm.register(db_path=p)
    types = {t["type_id"]: t for t in _registry.list_trigger_types(db_path=p)}
    assert "catalyst-match" in types
    assert types["catalyst-match"]["module"] == "api.services.alert_taxonomy.catalyst_match"
    assert types["catalyst-match"]["params_schema"] == cm.PARAMS_SCHEMA


def test_register_is_idempotent(tmp_path):
    p = str(tmp_path / "at.db")
    _db.init_db(db_path=p)
    cm.register(db_path=p)
    cm.register(db_path=p)
    rows = [t for t in _registry.list_trigger_types(db_path=p)
            if t["type_id"] == "catalyst-match"]
    assert len(rows) == 1, "a second boot must upsert, never duplicate"


# --- F-S7-CM-1: every shape the legacy path has, pinned at registration ------

def test_BOTH_legacy_rules_are_pinned_not_just_the_watchlist_one():
    """⛔ The obvious reading of "catalyst match" is the watchlist rule. There
    are TWO, and the second one needs no watchlist at all."""
    assert set(cm.MATCH_RULES) == {"watchlist", "grade"}
    assert "match_rule" in cm.PARAMS_SCHEMA


def test_the_admin_only_cohort_of_the_grade_rule_is_pinned():
    """`_fire_mustknow_alerts` reads `role='admin'` and the legacy comment says
    why in its own words: so subscribers do not get a surprise push."""
    assert set(cm.COHORTS) == {"self", "admins"}
    assert "cohort" in cm.PARAMS_SCHEMA


def test_the_member_set_is_pinned_WIDER_than_the_legacy_query_reaches():
    """The same call F-S7-2 made for `trendline`: pin the shapes nothing
    populates yet, so a later widening is a data change not a schema change."""
    assert set(cm.MEMBER_SETS) == {"watchlists", "tags", "positions", "uct20"}


def test_the_TAG_vocabulary_is_CLOSED_because_tagging_py_is_deterministic():
    assert set(cm.TAGS) == {"Earnings", "Catalyst", "Gapper", "News"}


def test_the_CATALYST_TYPE_vocabulary_is_OPEN_and_says_so():
    """⛔⛔ THE F-S7-CM-1 ITEM 3 PIN, AND IT IS THE WHOLE POINT OF THIS
    CHECKPOINT. The fifteen labels live in a PROMPT. The parser passes the
    model's answer through unnormalised. Pinning an enum would be the F-S7-4
    mistake made on purpose."""
    schema = cm.PARAMS_SCHEMA["catalyst_types"]
    assert "OPEN VOCABULARY" in schema
    assert "list[string] | null" in schema
    # the convention is RECORDED, so a reader can see what is asked for...
    assert "FDA" in cm.CATALYST_TYPE_CONVENTION
    assert len(cm.CATALYST_TYPE_CONVENTION) == 15
    # ...and NO FUNCTION IN THE MODULE READS IT. ⛔ An AST check, not a
    # substring one: the schema's own description NAMES the constant, so a
    # substring search answers a question about the documentation.
    assert "CATALYST_TYPE_CONVENTION" not in _names_used_in_functions(_MODULE), (
        "the evaluator consults the convention — then it is an enum after all, "
        "and the F-S7-4 lesson has been un-learned")


def test_the_convention_is_the_PROMPTS_list_read_from_the_prompt_itself():
    """⛔ DERIVED, NOT TYPED. If someone edits the prompt's label list, this goes
    red and the convention constant must be updated with it — rather than the
    two quietly diverging, which is how the 54-vs-137 scalar count drifted."""
    prompt = _SYNTH.read_text(encoding="utf-8")
    block = prompt.split("CATALYST_TYPE", 1)[1].split("TAG:", 1)[0]
    for label in cm.CATALYST_TYPE_CONVENTION:
        assert label in block, f"{label} is no longer in synthesize.py's prompt"


def test_the_grade_vocabulary_matches_synthesize_s_own_set():
    """⛔ NOT A SECOND COPY OF A GUESS — read from the module that owns it."""
    from api.services.catalyst import synthesize
    assert set(cm.VALID_GRADES) == set(synthesize._VALID_GRADES)


def test_the_dedup_grain_is_the_legacy_tables_primary_key():
    """`catalyst_alerts_fired` PK is (user_id, ticker, market_date). Pinned as a
    FIELD because it is the shape a later type will want to change, and changing
    it silently multiplies what a member receives."""
    assert cm.DEDUP_GRAIN == "user_ticker_day"
    ddl = (_REPO / "api" / "services" / "catalyst" / "store.py").read_text(encoding="utf-8")
    block = ddl.split("CREATE TABLE IF NOT EXISTS catalyst_alerts_fired", 1)[1].split(");", 1)[0]
    assert "PRIMARY KEY (user_id, ticker, market_date)" in block


def test_displayed_only_is_pinned_because_the_legacy_call_sites_pass_displayed():
    """Read from the legacy code: both `_fire_*` call sites are handed
    `displayed`, never `top_12`."""
    legacy = _code_only(_LEGACY)
    assert "_fire_catalyst_alerts(displayed, md)" in legacy
    assert "_fire_mustknow_alerts(displayed, md)" in legacy
    assert "displayed_only" in cm.PARAMS_SCHEMA


# --- dark by construction ---------------------------------------------------

def test_the_type_module_imports_NO_delivery():
    code = _code_only(_MODULE)
    for forbidden in ("deliver_alert_payload", "watchlist_alert_service",
                      "send_email", "discord"):
        assert forbidden not in code, f"{forbidden} reached the type module's CODE"


def test_the_type_module_never_touches_the_legacy_dedup_table():
    """⛔ Scoped to the TYPE module. The harness has the same prohibition and its
    own rail (`test_the_harness_imports_no_delivery_and_no_legacy_engine`), so
    this file does not reach across into a module CP1 does not ship — a test that
    named a file its own checkpoint has not created is how a checkpoint boundary
    stops being real."""
    code = _code_only(_MODULE)
    assert "catalyst_alerts_fired" not in code, (
        "the type module names the legacy dedup table in CODE — a dark rule must "
        "not read or write the table the live path dedups against")


def test_the_type_module_never_calls_the_catalyst_engine():
    code = _code_only(_MODULE)
    assert "catalyst.engine" not in code
    assert "_fire_catalyst_alerts" not in code
    assert "_fire_mustknow_alerts" not in code


def test_there_is_no_replay_fn_and_the_module_says_why():
    code = _code_only(_MODULE)
    assert "replay_fn" not in code
    raw = _MODULE.read_text(encoding="utf-8")
    assert "FORWARD-ONLY" in raw


def test_nothing_calls_register_yet_and_that_is_the_checkpoint_boundary():
    """⛔ REGISTRATION IS NOT ACTIVATION. §2a item 3's warning, applied: CP1-CP2
    add no scheduler entry and no flag. The rail that this stays true is here so
    an accidental wire is caught rather than discovered at CP3."""
    main = _code_only(_REPO / "api" / "main.py")
    assert "catalyst_match" not in main, (
        "api/main.py wires catalyst-match — that is CP3 and needs a new approval line")
