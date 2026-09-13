"""GATE-S7-REGIME-CHANGE Checkpoint 1 — registration + schema, nothing else.

⛔ The type must be DARK BY CONSTRUCTION, not by intention: no delivery import,
no read or write of the regime ledger, no call into either legacy emitter, no env
read of its own, and nothing calling `register()` yet. Each is asserted FROM THE
SOURCE rather than promised.

⛔⛔ AND THE SCHEMA IS PINNED AGAINST A MEASUREMENT, not against the type's name.
The in-app-only property of a regime flip is a STRUCTURAL ACCIDENT — one conjunct
in a different module's `if` — and the two FIXED VALUES in this schema
(`channels`, `entity_ref`) exist so widening delivery becomes a visible schema
change instead of something a later `entity_scope` quietly acquires.
"""
from __future__ import annotations

import ast
import json
import pathlib

from api.services.alert_taxonomy import db as _db
from api.services.alert_taxonomy import regime_change as rc
from api.services.alert_taxonomy import registry as _registry

_REPO = pathlib.Path(__file__).resolve().parents[1]
_MODULE = _REPO / "api" / "services" / "alert_taxonomy" / "regime_change.py"
_COMPARE = _REPO / "api" / "services" / "alert_taxonomy" / "regime_change_compare.py"
_RULES = _REPO / "api" / "services" / "awareness" / "rules.py"
_ENGINE = _REPO / "api" / "services" / "awareness" / "engine.py"
_VPS = _REPO / "api" / "services" / "voice_proactive_service.py"
_CLASSIFIER = _REPO / "api" / "services" / "voice_regime_classifier.py"
_ALERTS = _REPO / "api" / "services" / "alerts.py"

#: ⛔⛔ DOCUMENTATION IS NOT ALWAYS A DOCSTRING IN THIS PACKAGE. `PARAMS_SCHEMA`
#: and `BLIND_SPOTS` are prose stored in string LITERALS, so a docstring-only
#: stripper leaves every word of them in the "code" it hands back — and this
#: module's schema DESCRIBES the delivery it must never import. Blanking these two
#: by name is the fix; `test_the_stripper_sees_code_and_not_prose` proves it still
#: sees real code.
_PROSE_CONSTANTS = ("PARAMS_SCHEMA", "BLIND_SPOTS")


def _code_only(path: pathlib.Path) -> str:
    """⛔ CODE, NEVER PROSE. This module quotes `engine.py`'s away-delivery
    comment at length — a naive substring search matches its own explanation and
    every absence assertion below would be red on its documentation."""
    tree = ast.parse(path.read_text(encoding="utf-8"))
    for node in ast.walk(tree):
        if (isinstance(node, ast.Expr) and isinstance(node.value, ast.Constant)
                and isinstance(node.value.value, str)):
            node.value.value = ""
        if isinstance(node, ast.Assign) and any(
                isinstance(t, ast.Name) and t.id in _PROSE_CONSTANTS for t in node.targets):
            node.value = ast.Constant(value="<prose>")
    return ast.unparse(ast.fix_missing_locations(tree))


def _module_constant(path: pathlib.Path, name: str):
    """A module-level literal, read from the AST of the file that OWNS it.

    ⛔ Never `import` and never hand-typed: importing would make this test agree
    with whatever the other module happens to hold at runtime, and hand-typing
    would make it a second copy of a guess.
    """
    for node in ast.parse(path.read_text(encoding="utf-8")).body:
        if isinstance(node, ast.Assign):
            for tgt in node.targets:
                if isinstance(tgt, ast.Name) and tgt.id == name:
                    return ast.literal_eval(node.value)
    raise AssertionError(f"{name} is no longer a module-level literal in {path.name}")


def _function(path: pathlib.Path, name: str) -> ast.FunctionDef:
    for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"))):
        if isinstance(node, ast.FunctionDef) and node.name == name:
            return node
    raise AssertionError(f"{name} is gone from {path.name}")


def test_the_stripper_sees_code_and_not_prose():
    """⛔ THE CONTROL FOR EVERY ABSENCE ASSERTION BELOW. Without it, a stripper
    that returned '' would make all of them pass over nothing."""
    code = _code_only(_MODULE)
    raw = _MODULE.read_text(encoding="utf-8")
    # (a) the needles ARE in the prose
    assert "_DELIVER_IMPORTANCE_FLOOR" in raw
    assert "awareness_regime_snapshots" in raw
    assert "add_insight" in raw
    # (b) and NONE is in the code
    assert "_DELIVER_IMPORTANCE_FLOOR" not in code
    assert "awareness_regime_snapshots" not in code
    assert "add_insight" not in code
    # (c) and the stripper still sees real code. ⛔ Named against what CP1 SHIPS.
    assert "def register" in code
    assert "TYPE_ID = 'regime-change'" in code or 'TYPE_ID = "regime-change"' in code
    assert "register_trigger_type" in code
    assert len(code) > 500


# --- the type ---------------------------------------------------------------

def test_the_type_id_is_the_spec_s_id():
    assert rc.TYPE_ID == "regime-change"


def test_registration_round_trips_the_schema(tmp_path):
    p = str(tmp_path / "at.db")
    _db.init_db(db_path=p)
    rc.register(db_path=p)
    types = {t["type_id"]: t for t in _registry.list_trigger_types(db_path=p)}
    assert "regime-change" in types
    assert types["regime-change"]["module"] == "api.services.alert_taxonomy.regime_change"
    assert types["regime-change"]["params_schema"] == rc.PARAMS_SCHEMA


def test_register_is_idempotent(tmp_path):
    p = str(tmp_path / "at.db")
    _db.init_db(db_path=p)
    rc.register(db_path=p)
    rc.register(db_path=p)
    rows = [t for t in _registry.list_trigger_types(db_path=p)
            if t["type_id"] == "regime-change"]
    assert len(rows) == 1, "a second boot must upsert, never duplicate"


def test_the_schema_is_NOT_empty_and_names_every_field_the_gate_pinned():
    """SPEC-S7 §5.2 pinned this type as `{}`. The packet recommends against it
    and names five fields; this schema ships six — the sixth being `entity_ref`,
    the field that actually switches away-delivery on."""
    assert set(rc.PARAMS_SCHEMA) == {
        "labels", "min_confidence", "stake", "prior_label_source",
        "channels", "entity_ref",
    }


# --- the two emitters, pinned from source -----------------------------------

def test_BOTH_legacy_emitters_exist_and_the_schema_makes_the_CHOICE_declarable():
    """⛔ The completion plan describes ONE. Measured, a second ships beside it
    with a different prior-label authority — and an absorption that reproduced
    only R4 would report `legacy_only` for every fire the other makes."""
    assert set(rc.PRIOR_LABEL_SOURCES) == {"ledger", "session_summary"}
    assert "prior_label_source" in rc.PARAMS_SCHEMA

    # A — the ledger path exists and reads the durable ledger.
    rules_code = _code_only(_RULES)
    assert "def rule_regime_flip" in rules_code
    engine_code = _code_only(_ENGINE)
    assert "regime_snapshots.get_last_label()" in engine_code
    assert "regime_snapshots.record_snapshot" in engine_code

    # B — the session-summary path exists and diffs against summary TEXT.
    vps_code = _code_only(_VPS)
    assert "def maybe_emit_regime_shift" in vps_code
    assert "list_summaries(user_id, limit=1)" in vps_code
    assert "summary_text" in vps_code

    # ...and B IS WIRED, which is the half the ledger's docstring assumes away.
    for caller in (_REPO / "api" / "main.py", _REPO / "api" / "routers" / "voice.py"):
        assert "maybe_emit_regime_shift" in _code_only(caller), (
            f"{caller.name} no longer calls path B — if it was retired, this "
            "schema's two-emitter framing must be revisited, not quietly kept")


def test_the_two_emitters_use_DIFFERENT_insight_kinds_and_importances():
    """⛔ Different `kind` means different rows and different cooldown
    namespaces; a hard-coded 8 versus a computed score means one of them is
    pinned exactly at `_DELIVER_IMPORTANCE_FLOOR`."""
    a = ast.unparse(_function(_RULES, "rule_regime_flip"))
    b = ast.unparse(_function(_VPS, "maybe_emit_regime_shift"))
    assert "kind='regime_flip'" in a
    assert "kind='regime_shift'" in b
    assert "importance=8" in b
    assert rc.LEGACY_IMPORTANCE_SESSION_SUMMARY == 8
    # ...and 8 IS the away-delivery floor, derived from the module that owns it.
    assert _module_constant(_ENGINE, "_DELIVER_IMPORTANCE_FLOOR") == 8


def test_the_stake_axis_is_pinned_and_the_TWO_EMITTERS_DISAGREE_ON_IT():
    """⭐ `any` is NOT an unpopulated shape here — it is what the OTHER emitter
    does. R4 gates on an open position or a watched symbol; path B applies no
    stake test whatsoever."""
    assert set(rc.STAKES) == {"positions", "watchlist", "either", "any"}
    assert rc.LEGACY_STAKE_LEDGER == "either"
    assert rc.LEGACY_STAKE_SESSION_SUMMARY == "any"

    a = ast.unparse(_function(_RULES, "rule_regime_flip"))
    assert "has_positions" in a and "watch_syms" in a, (
        "R4 no longer applies a stake test — LEGACY_STAKE_LEDGER is now a claim "
        "about code that changed")

    b = ast.unparse(_function(_VPS, "maybe_emit_regime_shift"))
    for stake_word in ("positions", "watch_syms", "watchlist", "j2_positions"):
        assert stake_word not in b, (
            f"path B now consults {stake_word!r} — the two emitters no longer "
            "disagree on the stake axis and LEGACY_STAKE_SESSION_SUMMARY is stale")


def test_the_label_vocabulary_IS_the_classifiers_read_by_AST():
    """⛔ DERIVED, NEVER HAND-TYPED. A sixth regime added to DEC-13's authority
    goes RED here rather than quietly making this type blind to it."""
    declared = _module_constant(_CLASSIFIER, "REGIMES")
    assert len(declared) == 5, "the classifier's vocabulary changed size"
    assert tuple(declared) == rc.REGIME_LABELS
    # non-vacuity: the reader really read a tuple of labels, not an empty one
    assert "bull_trend" in declared and "bear_trend" in declared


def test_path_Bs_INLINE_label_tuple_is_a_SECOND_COPY_and_is_railed_IN_ORDER():
    """⛔ F-S7-RC-2's other half. `maybe_emit_regime_shift` hard-types the five
    labels rather than importing `REGIMES`, and it returns the FIRST one in that
    ORDER that matches — so a reorder there changes which prior label path B
    infers. Two copies of one vocabulary is exactly the second-authority shape,
    and this is the rail that makes a divergence loud."""
    fn = _function(_VPS, "maybe_emit_regime_shift")
    tuples = [ast.literal_eval(n.iter) for n in ast.walk(fn)
              if isinstance(n, ast.For) and isinstance(n.iter, ast.Tuple)]
    assert len(tuples) == 1, f"expected exactly one label loop in path B, saw {tuples}"
    assert tuple(tuples[0]) == rc.SESSION_SUMMARY_SCAN_ORDER, (
        "path B's inline label tuple no longer matches SESSION_SUMMARY_SCAN_ORDER "
        "-- ORDER included, because path B returns the first match")


def test_the_THIRD_regime_emitter_is_declared_and_deliberately_NOT_absorbed():
    """⛔⛔ F-S7-RC-4. The packet says there are TWO. There is a THIRD:
    `alerts.alert_regime_change`, broadcast, severity CRITICAL, and `add_alert`
    fires the Discord webhook for CRITICAL — so a 'regime changed' message
    ALREADY leaves the app today, on a vocabulary DEC-13 does not name.

    It is not absorbed. It is EXCLUDED BY NAME, so the next reader finds it here
    rather than rediscovering it after the flip.
    """
    alerts_code = _code_only(_ALERTS)
    assert "def alert_regime_change" in alerts_code
    assert "add_alert('regime_change'" in alerts_code

    # ⛔ Derived, not typed: the severity table maps the legacy type to a NAME,
    # and that name resolves to a module-level literal in the same file.
    severity_name = None
    for node in ast.parse(_ALERTS.read_text(encoding="utf-8")).body:
        if isinstance(node, ast.Assign) and any(
                isinstance(t, ast.Name) and t.id == "_TYPE_SEVERITY" for t in node.targets):
            for k, v in zip(node.value.keys, node.value.values):
                if isinstance(k, ast.Constant) and k.value == "regime_change":
                    assert isinstance(v, ast.Name)
                    severity_name = v.id
    assert severity_name == "SEVERITY_CRITICAL", (
        f"the legacy regime_change alert's severity is now {severity_name}")
    assert _module_constant(_ALERTS, severity_name) == "critical"

    # ...and CRITICAL is exactly what opens the Discord branch.
    assert "fires_discord = alert['severity'] in (SEVERITY_WARNING, SEVERITY_CRITICAL)" \
        in alerts_code
    assert "if _DISCORD_WEBHOOK and fires_discord:" in alerts_code

    # The exclusion is DECLARED, and it is NOT a prior_label_source.
    assert rc.EXCLUDED_EMITTER_ALERTS_TYPE == "regime_change"
    assert rc.EXCLUDED_EMITTER_ALERTS_TYPE not in rc.PRIOR_LABEL_SOURCES
    # ⛔ and it is ONE CHARACTER from this type's id, in the same feed module.
    assert rc.TYPE_ID.replace("-", "_") == rc.EXCLUDED_EMITTER_ALERTS_TYPE
    assert rc.TYPE_ID != rc.EXCLUDED_EMITTER_ALERTS_TYPE


# --- ⛔⛔ the away-delivery gate, verified from source ------------------------

def test_the_away_delivery_gate_is_the_conjunct_this_schema_pins_around():
    """⛔⛔ THE MEASUREMENT THE WHOLE SCHEMA RESTS ON, taken from the source
    rather than from the packet. `engine.py` gates away-delivery on
    `importance >= floor AND candidate.symbol`, and `rule_regime_flip` returns
    `symbol=None` — so the branch is unreachable BY CONSTRUCTION, not by rule."""
    engine_code = _code_only(_ENGINE)
    assert "if importance >= _DELIVER_IMPORTANCE_FLOOR and candidate.symbol:" \
        in engine_code, "the away-delivery conjunct moved — re-derive this schema"

    # The other half: the rule really does pass None.
    fn = _function(_RULES, "rule_regime_flip")
    symbols = [k.value for n in ast.walk(fn)
               if isinstance(n, ast.Call) and isinstance(n.func, ast.Name)
               and n.func.id == "InsightCandidate"
               for k in n.keywords if k.arg == "symbol"]
    assert len(symbols) == 1
    assert isinstance(symbols[0], ast.Constant) and symbols[0].value is None, (
        "rule_regime_flip now carries a symbol — away-delivery is REACHABLE and "
        "every position holder gets email and Discord on every flip")

    # And the delivery it would reach is the away one, not the in-app write.
    assert "deliver_alert_payload" in engine_code


def test_channels_CANNOT_widen_without_a_schema_change():
    """⛔⛔ THE RAIL THE PACKET ASKED FOR, and it has four independent halves so
    that no single edit can widen delivery quietly.

    1. the constant is exactly one channel;
    2. the SCHEMA STRING carries that constant's value, DERIVED from it — so
       editing the constant edits the schema that `alert_trigger_registry`
       persists, which is what makes a widening VISIBLE;
    3. `resolve_channels` ignores anything params supply, so a predicate cannot
       widen delivery at registration time;
    4. the registered row itself round-trips the fixed value.
    """
    # 1
    assert rc.CHANNELS_FIXED == ("in_app",)

    # 2 — derived, so the two cannot diverge; asserted anyway so a hand-edit of
    # either half is caught.
    assert json.dumps(list(rc.CHANNELS_FIXED)) in rc.PARAMS_SCHEMA["channels"]
    assert '["in_app"]' in rc.PARAMS_SCHEMA["channels"]
    assert "FIXED VALUE" in rc.PARAMS_SCHEMA["channels"]
    for widen in ("email", "discord", "sms", "push"):
        assert widen not in rc.PARAMS_SCHEMA["channels"].lower().split("resolve_channels")[0], \
            f"{widen} appears in the channels pin before its own explanation"

    # 3 — params cannot widen it
    for attempt in ([], ["email"], ["in_app", "discord"], None, "email"):
        assert rc.resolve_channels({"channels": attempt}) == ("in_app",)
    assert rc.resolve_channels() == ("in_app",)
    assert rc.resolve_channels({}) == ("in_app",)


def test_the_registered_row_carries_the_fixed_channel_so_a_widening_is_VISIBLE(tmp_path):
    """⛔ The persisted registration is the artifact an operator reads. If the
    fixed value did not reach it, widening delivery would leave no trace at all
    in the store that answers 'what types exist and what do they take'."""
    p = str(tmp_path / "at.db")
    _db.init_db(db_path=p)
    rc.register(db_path=p)
    row = [t for t in _registry.list_trigger_types(db_path=p)
           if t["type_id"] == "regime-change"][0]
    assert '["in_app"]' in row["params_schema"]["channels"]
    assert "null" in row["params_schema"]["entity_ref"]


def test_the_type_never_passes_a_channels_argument_to_register_predicate():
    """⛔ The OTHER way delivery widens: `predicates.register_predicate` takes a
    per-predicate `channels` list. This type must never hand it one."""
    tree = ast.parse(_MODULE.read_text(encoding="utf-8"))
    for node in ast.walk(tree):
        if isinstance(node, ast.Call):
            for kw in node.keywords:
                assert kw.arg != "channels", (
                    "the type module passes channels= to a call — that is the "
                    "per-predicate override, and it bypasses CHANNELS_FIXED")
    assert "register_predicate" not in _code_only(_MODULE), (
        "CP1 registers a TYPE, never a predicate")


def test_entity_ref_is_FIXED_null_because_that_is_what_switches_delivery_ON():
    """⛔ The direct mirror of `and candidate.symbol`. A `regime-change`
    predicate given an entity_scope symbol makes the away-delivery branch
    REACHABLE — email and Discord to every position holder on every flip."""
    assert rc.ENTITY_REF_FIXED is None
    for attempt in ("NVDA", "", None, ["NVDA"]):
        assert rc.resolve_entity_ref({"entity_ref": attempt}) is None
    assert rc.resolve_entity_ref() is None
    assert "FIXED VALUE null" in rc.PARAMS_SCHEMA["entity_ref"]
    assert "MARKET-WIDE" in rc.PARAMS_SCHEMA["entity_ref"]
    # ⚰️ DERIVED, and this half exists because the M3 mutation found it missing:
    # the schema string used to hard-type "null" while `channels` derived its
    # value, so widening the field that actually switches away-delivery on would
    # have left the persisted registration row unchanged.
    assert "FIXED VALUE " + json.dumps(rc.ENTITY_REF_FIXED) \
        in rc.PARAMS_SCHEMA["entity_ref"]


def test_min_confidence_is_pinned_unpopulated_and_is_NOT_authorization_to_route():
    """The code invites a confidence gate; pinning the field is how that
    invitation stops being a comment. ⛔ It is not permission to route on it."""
    assert "min_confidence" in rc.PARAMS_SCHEMA
    text = rc.PARAMS_SCHEMA["min_confidence"]
    assert "NOT a probability" in text
    assert "not authorization" in text.lower()
    # neither legacy emitter gates on confidence today
    assert rc.would_fire({"prior_label_source": "ledger", "stake": "any"},
                         current_label="bear_trend", ledger_label="chop",
                         confidence=0.0) is True


def test_labels_is_matched_against_the_label_flipped_TO():
    """⛔ 'which side' is a real ambiguity and it is settled in the schema, not
    left for an evaluator to decide silently."""
    assert "flipped TO" in rc.PARAMS_SCHEMA["labels"]
    p = {"prior_label_source": "ledger", "stake": "any", "labels": ["bear_trend"]}
    assert rc.would_fire(p, current_label="bear_trend", ledger_label="chop") is True
    assert rc.would_fire(p, current_label="chop", ledger_label="bear_trend") is False


# --- F-S7-RC-1, from source --------------------------------------------------

def test_F_S7_RC_1_the_dedup_key_is_COMPUTED_AND_DISCARDED():
    """⛔ `rule_regime_flip`'s docstring promises a label-scoped 6h cooldown via
    `add_insight`'s per-symbol window. Measured: the `dedup_key` is built at
    `rules.py:161` and never reaches `add_insight` — `engine.py` passes
    `symbol=candidate.symbol`, which is None for this rule.

    ⭐ CONFIRMED, not refuted. The behaviour is still right, but the LEDGER is
    what makes it right; an absorption that built the promised cooldown would
    diverge exactly on the oscillation the docstring was written about.
    """
    # the promise is really in the docstring (control for the claim itself)
    doc = ast.get_docstring(_function(_RULES, "rule_regime_flip")) or ""
    assert "6h per-symbol cooldown" in doc
    assert "dedup_key" in doc

    # the key is built...
    rules_code = _code_only(_RULES)
    assert "dedup_key=f'REGIME:{label}'" in rules_code

    # ...and the module that calls add_insight never mentions it.
    engine_code = _code_only(_ENGINE)
    assert "add_insight" in engine_code, "control: engine.py really is the caller"
    assert "dedup_key" not in engine_code, (
        "engine.py now forwards a dedup_key — F-S7-RC-1's first half is stale")
    assert "symbol=candidate.symbol" in engine_code


def test_F_S7_RC_1_add_insight_SKIPS_its_cooldown_for_a_null_symbol():
    """The second half, from source: the per-(symbol, kind) query sits entirely
    inside `if symbol:`, so a market-wide insight is bounded only by the shared
    daily cap. The executable proof is in the compare suite."""
    fn = _function(_VPS, "add_insight")
    guards = [n for n in ast.walk(fn)
              if isinstance(n, ast.If) and isinstance(n.test, ast.Name)
              and n.test.id == "symbol"]
    assert len(guards) == 1, "the `if symbol:` guard moved — re-derive F-S7-RC-1"
    body = ast.unparse(ast.Module(body=guards[0].body, type_ignores=[]))
    assert "voice_proactive_insights" in body and "created_at >= ?" in body, (
        "the cooldown query is no longer inside the null-symbol guard")
    assert _module_constant(_VPS, "MAX_INSIGHTS_PER_USER_PER_DAY") == 8
    assert _module_constant(_VPS, "MIN_SYMBOL_COOLDOWN_HOURS") == 6


# --- dark by construction ----------------------------------------------------

def test_the_module_RECORDS_the_live_flag_read_rather_than_inheriting_one():
    """⛔ The packet inherited a five-week-old flag reading and said to re-read
    both live before any line was written. They were re-read, and the result is
    what turns F-S7-RC-3 and F-S7-RC-4 from latent into ACTIVE — so the reading
    and its date belong in the module, not only in a report nobody keeps.

    ⚠️ This pins that the claim is DATED and ATTRIBUTED. It cannot re-measure the
    flags; a flag state is a fact about a moment, and the module says which.
    """
    raw = _MODULE.read_text(encoding="utf-8")
    assert "AWARENESS_ENGINE_ENABLED=1" in raw
    assert "COMPASS_AUTOMATION_ENABLED=1" in raw
    assert "2026-09-12" in raw
    assert "railway variables --service web --kv" in raw
    # ⛔ and the webhook VALUE is never written down, only its state
    assert "discord.com/api/webhooks" not in raw


def test_the_type_module_imports_NO_delivery():
    code = _code_only(_MODULE)
    for forbidden in ("deliver_alert_payload", "watchlist_alert_service",
                      "send_email", "discord", "alert_taxonomy.delivery"):
        assert forbidden not in code, f"{forbidden} reached the type module's CODE"


def test_the_type_module_never_touches_the_regime_ledger_or_either_emitter():
    """⛔ `record_snapshot` writes on every cycle and the legacy rule's own
    `prev_label` is whatever it last wrote. A second writer would move the thing
    being measured."""
    code = _code_only(_MODULE)
    for forbidden in ("awareness_regime_snapshots", "regime_snapshots",
                      "record_snapshot", "get_last_label", "add_insight",
                      "rule_regime_flip", "maybe_emit_regime_shift",
                      "get_current_regime", "list_summaries"):
        assert forbidden not in code, f"{forbidden} reached the type module's CODE"


def test_the_type_module_has_NO_env_read_and_no_flag_of_its_own():
    """⛔ REGISTRATION IS NOT ACTIVATION. Unlike `catalyst-match`, this type
    mirrors no env-configured legacy rule: `COMPASS_AUTOMATION_ENABLED` and
    `AWARENESS_ENGINE_ENABLED` decide whether the legacy RUNS, not what it
    decides, so the mirror needs neither and reads nothing."""
    for path in (_MODULE, _COMPARE):
        code = _code_only(path)
        assert "environ" not in code and "getenv" not in code, (
            f"{path.name} reads an env var — this type configures nothing")
        assert "ENABLED" not in code, f"{path.name} reads an _ENABLED flag"
        assert "add_job" not in code and "CronTrigger" not in code


def test_there_is_no_replay_fn_and_the_module_says_why():
    code = _code_only(_MODULE)
    assert "replay_fn" not in code
    raw = _MODULE.read_text(encoding="utf-8")
    assert "FORWARD-ONLY" in raw
    # the reason is this type's OWN, and it is the persisted-input one
    assert "_TTL_SECONDS" in raw and "no prior `signals` dict is persisted" in raw


def test_nothing_calls_register_yet_and_that_is_the_checkpoint_boundary():
    """⛔ CP1-CP2 add no scheduler entry and no wire. The rail that this stays
    true is here so an accidental wire is caught rather than discovered at CP3."""
    main = _code_only(_REPO / "api" / "main.py")
    assert "regime_change" not in main, (
        "api/main.py wires regime-change — that is CP3 and needs a new approval line")

    importers = []
    for p in (_REPO / "api").rglob("*.py"):
        if p.name == "regime_change.py":
            continue
        try:
            code = _code_only(p)
        except SyntaxError:
            continue
        if "alert_taxonomy import regime_change" in code or "regime_change.register" in code:
            importers.append(str(p.relative_to(_REPO)).replace("\\", "/"))
    assert importers == ["api/services/alert_taxonomy/regime_change_compare.py"], (
        f"expected only the harness to import the type; found {importers}")
