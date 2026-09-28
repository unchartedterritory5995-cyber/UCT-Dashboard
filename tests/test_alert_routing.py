"""TERM-011 / RM-N09 — the rails for the class-based alert resolver.

Spec §7 names four rails and requires each to be seen RED before it is green, each
with a control so it cannot pass vacuously. This file carries those four plus the
three properties the spec's own text depends on but does not list as rails: that the
resolver is PURE, that the gate is read PER CALL, and that the kill switch is
evaluated BEFORE anything else.

⛔ SCOPED RUN ONLY. `python -m pytest tests/test_alert_routing.py
tests/test_feature_flag_ledger.py -q`. Never an unscoped pytest on this box: one
reached 18 GB and was OOM-killed, and `-k` does not help because collection is where
the memory goes.

⛔ WHAT THESE RAILS CANNOT DO. They prove a CLASS reaches a distinct destination.
They cannot prove the class is the RIGHT one — the spec's §4 classification is a
judgement applied to a mechanically-derived call-site list, and it is reviewed by a
person or it is not reviewed. Nothing here is evidence about §4.
"""

from __future__ import annotations

import ast
import importlib
import json
import os
from pathlib import Path

import pytest

from api.services import alert_routing as ar

REPO = Path(__file__).resolve().parents[1]
MODULE_PATH = REPO / "api" / "services" / "alert_routing.py"
LEDGER_PATH = REPO / "docs" / "feature_flags.json"

#: ⭐ DERIVED, never typed. Spec §2's union vocabulary is exactly the keys of the
#: priority table — `info`, `warning`, `critical` and the production typo `warn`. A
#: hand-typed list here would drift the day a fifth literal reaches `emit`, and it
#: would drift in the flattering direction (fewer severities checked, nothing red).
SEVERITY_UNION = tuple(sorted(ar.SEVERITY_PRIORITY))


# ───────────────────────────────────────────────────────────────────────────────
# R1 — DIFFERENT CHANNELS, SAME RUN. The acceptance test is a DESTINATION.
# ───────────────────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("severity", SEVERITY_UNION)
def test_R1_ops_and_business_never_share_a_destination(severity):
    """⭐ The whole ticket in one assertion, at every severity in the estate.

    THE CONTROL IS THE NON-EMPTY HALF, and it is not decoration: `"" != ""` is
    false, so a pair of EMPTY strings would satisfy "the two names differ" nowhere.
    A resolver that returned `""` for both classes would pass a bare inequality
    check and route nothing anywhere.
    """
    ops = ar.resolve_channel(ar.CLASS_OPS, severity)
    business = ar.resolve_channel(ar.CLASS_BUSINESS, severity)

    assert ops.primary_env, "the OPS destination name is empty"
    assert business.primary_env, "the BUSINESS destination name is empty"
    assert ops.primary_env != business.primary_env, (
        f"at severity {severity!r} both classes resolve to {ops.primary_env!r}. "
        "A class field over one channel satisfies nothing: an ops alarm and a "
        "member event emitted in the same run must land in DIFFERENT channels."
    )


def test_R1_the_union_vocabulary_contains_the_word_the_two_SCALES_share():
    """⛔ NON-VACUITY for the parametrisation above: if the derivation stopped
    seeing a severity, R1 would shrink SILENTLY — fewer rows, nothing red.

    ⚰️ AND THE SPEC'S REASON FOR `warn` IS STALE, WHICH IS WORTH KNOWING HERE.
    The spec says `bars_reconciliation.py` passes `"warn"` as an emit severity;
    at this branch's HEAD it passes `"warning"` (fixed by `6b6deabe1`, the first
    commit on this branch), and the emit vocabulary re-derived over all 22 sites is
    two literals, not three. `warn` stays in the table because `emit` still
    validates nothing and because `ok`/`warn`/`fail` is `audit.py`'s live per-bar
    DIFF scale — two scales sharing one word is what caused the original defect.
    """
    assert ar.SEVERITY_WARN_TYPO in SEVERITY_UNION
    assert {ar.SEVERITY_INFO, ar.SEVERITY_WARNING, ar.SEVERITY_CRITICAL} <= set(SEVERITY_UNION)
    assert len(SEVERITY_UNION) == 4, SEVERITY_UNION


# ───────────────────────────────────────────────────────────────────────────────
# R2 — NO DEFAULT. An unclassified emitter fails BY NAME.
# ───────────────────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("bad", [None, "", "   ", "both", "BOTH", "op", "opss",
                                "OPS_ALERT", 0, 1, 7, ["ops"], {"class": "ops"},
                                object()])
def test_R2_an_unknown_class_REFUSES_rather_than_defaulting(bad):
    """⛔⛔ A DEFAULT HERE ROUTES AN OPS ALARM INTO THE MEMBER CHANNEL, SILENTLY.

    `"both"` is in this list on purpose and is the case a reader is most likely to
    think should work: the spec's §4.3 has thirteen dual-audience producers, and a
    third enum member is the one-channel non-solution wearing a class field. A BOTH
    producer calls the resolver TWICE.

    ⭐ THE CONTROL IS IN THE SAME TEST FILE, one function down: without a positive
    case, a resolver that raised unconditionally would satisfy every row here.
    """
    with pytest.raises(ar.UnroutableAlert):
        ar.resolve_channel(bad, ar.SEVERITY_CRITICAL)


def test_R2_the_control_both_valid_classes_resolve_in_the_same_test():
    """⛔ THE NON-VACUITY HALF OF R2. "everything raises" must not read as a pass."""
    for cls, expected in ((ar.CLASS_OPS, ar.OPS_WEBHOOK_ENV),
                          (ar.CLASS_BUSINESS, ar.BUSINESS_WEBHOOK_ENV)):
        decision = ar.resolve_channel(cls, ar.SEVERITY_CRITICAL)
        assert decision.alert_class == cls
        assert decision.primary_env == expected


@pytest.mark.parametrize("spelling", ["ops", "OPS", " Ops ", "\tbusiness\n", "BUSINESS"])
def test_R2_a_valid_class_is_accepted_case_and_whitespace_insensitively(spelling):
    """A producer that writes `"OPS"` is classified, not refused. The refusal is for
    a class nobody DECLARED, never for a capital letter."""
    assert ar.resolve_channel(spelling, ar.SEVERITY_INFO).alert_class in ar.ALERT_CLASSES


def test_R2_the_refusal_names_the_PRODUCER_MODULE():
    """⛔ "fails the rail BY NAME" — the error text must say WHO emitted it.

    Derived from the caller's frame, so a producer gets named without having to
    remember to pass anything; an explicit `producer=` wins when a wrapper wants to
    name its own caller instead.
    """
    with pytest.raises(ar.UnroutableAlert) as raised:
        ar.resolve_channel(None, ar.SEVERITY_CRITICAL)
    assert __name__ in str(raised.value), (
        f"the refusal did not name this module ({__name__}); it said: {raised.value}")

    with pytest.raises(ar.UnroutableAlert) as raised:
        ar.resolve_channel(None, ar.SEVERITY_CRITICAL, producer="api/services/made_up.py:99")
    assert "api/services/made_up.py:99" in str(raised.value)


def test_R2_the_refusal_message_names_the_valid_classes_and_the_two_call_rule():
    """A refusal that does not say what to do instead gets "fixed" with a default."""
    with pytest.raises(ar.UnroutableAlert) as raised:
        ar.resolve_channel("both", ar.SEVERITY_CRITICAL)
    text = str(raised.value)
    for fragment in (ar.CLASS_OPS, ar.CLASS_BUSINESS, "NO default", "once per class"):
        assert fragment in text, f"{fragment!r} missing from the refusal: {text}"


# ───────────────────────────────────────────────────────────────────────────────
# R3 — THE SECOND TRANSPORT SURVIVES THE FIRST.
# ───────────────────────────────────────────────────────────────────────────────

def test_R3_an_OPS_critical_still_names_the_email_leg_with_BOTH_discord_vars_BLANKED(monkeypatch):
    """⛔ BLANKED with `setenv(..., "")`, NEVER `delenv`.

    `tools/audit_sandbox_env.py:57-58` states the rule for this exact variable:
    *"BLANK, never popped — a blank webhook posts nothing; removing the var lets a
    default re-appear."* A rail that deleted the variable would be testing a state
    this estate is not allowed to produce.

    ⭐ AND THE REASON THIS PASSES IS ITSELF THE POINT: the resolver reads no
    environment, so blanking the Discord variables cannot reach its answer. That is
    what makes the criterion — "with the primary channel's variable blanked, a
    CRITICAL still reaches the second channel" — a property of the DESIGN rather
    than of whatever Railway happens to hold.
    """
    monkeypatch.setenv(ar.OPS_WEBHOOK_ENV, "")
    monkeypatch.setenv(ar.ADMIN_WEBHOOK_ENV, "")

    decision = ar.resolve_channel(ar.CLASS_OPS, ar.SEVERITY_CRITICAL)
    assert decision.second_transport_env == ar.OPS_EMAIL_ENV
    assert decision.second_transport_status is None, (
        "the resolver named the email leg AND reported an outcome for it; "
        "whether it landed is the transport's to report, never the resolver's")


@pytest.mark.parametrize("severity", [s for s in SEVERITY_UNION if s != "critical"])
def test_R3_the_control_a_non_critical_OPS_alert_does_NOT_reach_the_email_leg(severity):
    """⛔ THE CONTROL, and without it R3 passes on a resolver that emails EVERYTHING.

    The reported outcome is `CHANNEL_SKIPPED` WITH A REASON, never a bare skip:
    `compass_health.py:155-157` is the precedent — it returns
    *"no recipients (set COMPASS_HEALTH_EMAIL_TO or ADMIN_EMAILS)"* rather than
    skipping quietly.
    """
    decision = ar.resolve_channel(ar.CLASS_OPS, severity)
    assert decision.second_transport_env is None
    assert decision.second_transport_status == ar.CHANNEL_SKIPPED
    assert ar.SEVERITY_CRITICAL in (decision.second_transport_skip_reason or "")


def test_R3_a_BUSINESS_critical_does_not_reach_the_ops_email_leg():
    """The second transport is OPS-class only. A member's payment failure is not a
    page, and the email address that receives pages is not a member channel."""
    decision = ar.resolve_channel(ar.CLASS_BUSINESS, ar.SEVERITY_CRITICAL)
    assert decision.second_transport_env is None
    assert decision.second_transport_status == ar.CHANNEL_SKIPPED
    assert ar.CLASS_OPS in (decision.second_transport_skip_reason or "")


def test_R3_the_skip_reason_is_present_exactly_when_the_status_is():
    """A status with no reason is the bare skip the precedent above forbids; a reason
    with no status is a sentence nobody will read."""
    for cls in ar.ALERT_CLASSES:
        for severity in SEVERITY_UNION + ("", "banana"):
            d = ar.resolve_channel(cls, severity)
            assert (d.second_transport_status is None) == (d.second_transport_skip_reason is None)


# ───────────────────────────────────────────────────────────────────────────────
# R4 — NO PRODUCER CAN NAME THE WRONG DESTINATION.
#
# ⚠️ R4 AS THE SPEC WRITES IT IS VACUOUS IN THIS COMMIT, AND SAYING SO IS THE
# HONEST MOVE. It sweeps "each module converted in steps 3-7"; this is step 2 and
# that set is EMPTY, so a sweep would pass over nothing. What CAN be pinned today is
# the resolver's own side of the same property — that the routing table is the one
# authority over which name belongs to which class, and that nothing else in the
# module hard-codes a destination.
# ───────────────────────────────────────────────────────────────────────────────

def test_R4_the_table_is_the_only_place_a_destination_is_bound_to_a_class():
    """⭐ `co_names` on the compiled function, not a grep over the source.

    `tests/test_provider_coverage_alerts.py:125-130` established why:
    *"`co_names` holds referenced globals/attrs, not string literals — so a mention
    in the docstring can't false-positive this the way grepping source text would"*.
    This module's docstrings name every webhook variable repeatedly, so a text scan
    would be red on arrival for reasons that are not misroutes.
    """
    names = set(ar.resolve_channel.__code__.co_names)
    # The POSITIVE half: it really does consult the tables.
    assert "PRIMARY_ENV_BY_CLASS" in names
    assert "FALLBACK_ENV_BY_CLASS" in names
    assert "SECOND_TRANSPORT_ENV_BY_CLASS" in names
    # …and the negative half: no destination constant is reached directly, so a
    # class can only ever get the name its table row gives it.
    for constant in ("OPS_WEBHOOK_ENV", "BUSINESS_WEBHOOK_ENV",
                     "ADMIN_WEBHOOK_ENV", "OPS_EMAIL_ENV"):
        assert constant not in names, (
            f"resolve_channel reaches {constant} directly, so the table is no longer "
            "the single authority over which class gets which destination")


def test_R4_every_class_in_the_vocabulary_has_a_row_in_every_table():
    """A class present in `ALERT_CLASSES` but absent from `PRIMARY_ENV_BY_CLASS`
    would raise a KeyError inside the resolver — a refusal for the wrong reason,
    which reads to an operator as "the resolver is broken" rather than "that class
    was never given a destination"."""
    for cls in ar.ALERT_CLASSES:
        assert cls in ar.PRIMARY_ENV_BY_CLASS
        assert cls in ar.FALLBACK_ENV_BY_CLASS
    assert set(ar.SECOND_TRANSPORT_ENV_BY_CLASS) <= set(ar.ALERT_CLASSES)


# ───────────────────────────────────────────────────────────────────────────────
# SEVERITY IS DEMOTED — it is a within-class priority, never a router.
# ───────────────────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("alert_class", ar.ALERT_CLASSES)
def test_severity_never_changes_the_destination(alert_class):
    """⛔ THE DEMOTION, asserted directly. `alerts.py:431` fires Discord on
    `warning` OR `critical` while `chart_health_alerts.py:37` pages on `critical`
    only — two doors, two rules, and severity deciding both DESTINATION and
    PRIORITY is the conflation this ticket exists to end."""
    destinations = {ar.resolve_channel(alert_class, s).primary_env
                    for s in SEVERITY_UNION + ("", "banana", "WARN", "Critical")}
    assert len(destinations) == 1, destinations


def test_the_typo_ranks_WITH_warning_and_not_as_something_unknown():
    """`warn` is `warning` misspelt in production source. Ranking it as unknown
    would put a real ops alarm below `info` in a within-class ordering."""
    assert (ar.resolve_channel(ar.CLASS_OPS, "warn").priority
            == ar.resolve_channel(ar.CLASS_OPS, ar.SEVERITY_WARNING).priority)
    assert ar.resolve_channel(ar.CLASS_OPS, "warn").severity_known is True


def test_the_priorities_are_ordered_critical_above_warning_above_info():
    p = ar.SEVERITY_PRIORITY
    assert p[ar.SEVERITY_CRITICAL] > p[ar.SEVERITY_WARNING] > p[ar.SEVERITY_INFO] \
        > ar.UNKNOWN_SEVERITY_PRIORITY


@pytest.mark.parametrize("severity", ["", "   ", "banana", None, 7, ["critical"]])
def test_an_unknown_severity_RANKS_LOWEST_and_never_refuses(severity):
    """⛔ REFUSING ON SEVERITY WOULD DROP AN ALARM WHOSE CLASS WAS DECLARED.
    `chart_health_alerts.emit` takes severity as a free string and validates
    nothing, so an unrecognised value is a certainty, not an edge case."""
    decision = ar.resolve_channel(ar.CLASS_OPS, severity)
    assert decision.severity_known is False
    assert decision.priority == ar.UNKNOWN_SEVERITY_PRIORITY
    assert decision.primary_env == ar.OPS_WEBHOOK_ENV


# ───────────────────────────────────────────────────────────────────────────────
# THE RESOLVER IS PURE. Two rails, and they fail for different reasons.
# ───────────────────────────────────────────────────────────────────────────────

def _env_reading_functions(source: str) -> set:
    """Which functions in `source` read the environment. ⛔ AST, never a grep.

    The module's docstrings deliberately SAY `os.environ.get` while reading
    nothing, so a text search over that file cannot answer this question at all —
    it would report the prose as a read. A module-level read reports as
    `"<module>"`, which is precisely the `discord_notify.py:11` defect.
    """
    tree = ast.parse(source)
    parents: dict = {}
    for node in ast.walk(tree):
        for child in ast.iter_child_nodes(node):
            parents[child] = node

    def enclosing(node: ast.AST) -> str:
        cur = parents.get(node)
        while cur is not None:
            if isinstance(cur, (ast.FunctionDef, ast.AsyncFunctionDef)):
                return cur.name
            cur = parents.get(cur)
        return "<module>"

    readers: set = set()
    for node in ast.walk(tree):
        if not isinstance(node, ast.Attribute) or not isinstance(node.value, ast.Name):
            continue
        if node.value.id == "os" and node.attr in ("environ", "getenv"):
            readers.add(enclosing(node))
    return readers


def test_the_ONLY_environment_read_in_the_module_is_the_gate_reader():
    """⛔ The purity rail, and the import-time rail, in one derivation.

    `{"routing_enabled"}` exactly. `"<module>"` appearing here is the defect
    `api/services/discord_notify.py:11` still has — a module constant captured at
    import, against which blanking the variable reaches nothing until a restart
    while `--kv` agrees it is gone. `"resolve_channel"` appearing here means the
    resolver stopped being pure.
    """
    found = _env_reading_functions(MODULE_PATH.read_text(encoding="utf-8"))
    assert found == {"routing_enabled"}, found


def test_the_purity_derivation_can_actually_SEE_a_read():
    """⛔ NON-VACUITY. An AST walk that matched nothing would report an empty set
    for a module riddled with reads, and the rail above would pass over it."""
    planted = (
        "import os\n"
        "CAPTURED = os.environ.get('X', '1')\n"
        "def f():\n"
        "    return os.getenv('Y')\n"
        "def pure():\n"
        "    return 1\n"
    )
    assert _env_reading_functions(planted) == {"<module>", "f"}
    assert _env_reading_functions("def pure():\n    return 1\n") == set()


def test_the_resolver_returns_the_same_answer_whatever_the_environment_holds(monkeypatch):
    """The behavioural half of purity: identical decisions under three different
    environment states. A resolver that consulted a variable would answer
    differently for at least one of them."""
    def snapshot():
        return [ar.resolve_channel(c, s) for c in ar.ALERT_CLASSES for s in SEVERITY_UNION]

    for name in (ar.OPS_WEBHOOK_ENV, ar.BUSINESS_WEBHOOK_ENV,
                 ar.ADMIN_WEBHOOK_ENV, ar.OPS_EMAIL_ENV):
        monkeypatch.setenv(name, "")
    blanked = snapshot()
    for name in (ar.OPS_WEBHOOK_ENV, ar.BUSINESS_WEBHOOK_ENV,
                 ar.ADMIN_WEBHOOK_ENV, ar.OPS_EMAIL_ENV):
        monkeypatch.setenv(name, "https://example.invalid/not-a-real-webhook")
    assert snapshot() == blanked
    monkeypatch.setenv(ar.ROUTING_FLAG_ENV, "0")
    assert snapshot() == blanked, (
        "the resolver's answer moved with the kill switch. The switch governs "
        "whether a producer ASKS (routing_enabled_for), never what the answer is — "
        "otherwise flipping it would silently redirect rather than revert.")


def test_the_decision_carries_NAMES_and_never_a_value(monkeypatch):
    """⛔ A webhook URL in a route stamp is a credential in a Discord message."""
    secret = "https://discord.com/api/webhooks/000/SECRET-TOKEN-DO-NOT-LEAK"
    for name in (ar.OPS_WEBHOOK_ENV, ar.BUSINESS_WEBHOOK_ENV,
                 ar.ADMIN_WEBHOOK_ENV, ar.OPS_EMAIL_ENV):
        monkeypatch.setenv(name, secret)
    decision = ar.resolve_channel(ar.CLASS_OPS, ar.SEVERITY_CRITICAL)
    rendered = repr(decision) + ar.route_stamp(decision) + ar.route_stamp(
        decision, used_fallback=True)
    assert secret not in rendered
    assert "SECRET-TOKEN-DO-NOT-LEAK" not in rendered
    # …and the non-vacuity half: the NAMES really are in there, so "absent" is not
    # because the stamp is empty.
    assert ar.OPS_WEBHOOK_ENV in rendered


def test_the_fallback_stamp_is_the_route_plus_one_label():
    """Spec §5.2: an OPS post that fell back must be *stamped* `route=fallback:admin`,
    so a misroute is visible in the message itself with no Railway access. The
    resolver cannot know a fallback happened — establishing that means reading the
    primary variable — so the caller states it and the literal lives in one place."""
    decision = ar.resolve_channel(ar.CLASS_OPS, ar.SEVERITY_CRITICAL)
    assert ar.route_stamp(decision) == decision.route
    stamped = ar.route_stamp(decision, used_fallback=True)
    assert stamped.startswith(decision.route)
    assert ar.FALLBACK_ROUTE_STAMP in stamped
    assert ar.FALLBACK_ROUTE_STAMP not in ar.route_stamp(decision)


# ───────────────────────────────────────────────────────────────────────────────
# THE GATE — read PER CALL, kill switch FIRST.
# ───────────────────────────────────────────────────────────────────────────────

def test_the_gate_is_read_PER_CALL_not_captured_at_import(monkeypatch):
    """⭐ THE ONE THAT MATTERS, and the idiom is `tests/test_hub_preview_flag.py`'s:
    same process, same imported module, NO reload, one environment change between
    two calls.

    A module-level capture passes every other test in this file and fails this one,
    which is exactly the defect that makes a no-redeploy rollback a fiction:
    `railway variables --set` has been measured NOT to restart some services, and
    against an import-time capture the operator reads the variable back changed,
    sees `--kv` agree, and the running process keeps behaving as before.
    """
    monkeypatch.setenv(ar.ROUTING_FLAG_ENV, "1")
    assert ar.routing_enabled() is True
    monkeypatch.setenv(ar.ROUTING_FLAG_ENV, "0")     # no reimport between these
    assert ar.routing_enabled() is False, (
        "ALERT_ROUTING_ENABLED did not change without a reimport — it is captured "
        "at import, and every 'no redeploy needed' claim about it is false")
    monkeypatch.setenv(ar.ROUTING_FLAG_ENV, "1")
    assert ar.routing_enabled() is True


def test_a_reimported_module_still_reads_it_per_call(monkeypatch):
    """The stronger form: even a freshly imported module must not latch the value.
    `importlib.reload` is what a module-level capture would survive."""
    monkeypatch.setenv(ar.ROUTING_FLAG_ENV, "0")
    fresh = importlib.reload(ar)
    try:
        assert fresh.routing_enabled() is False
        monkeypatch.setenv(ar.ROUTING_FLAG_ENV, "1")
        assert fresh.routing_enabled() is True
    finally:
        importlib.reload(ar)


def test_unset_means_ON_and_the_DEFAULT_LITERAL_is_pinned(monkeypatch):
    """⛔ KILL SWITCH: unset means "nothing has been killed".

    Both halves, because they fail differently. The behaviour test alone lets
    somebody change the default to "0" and "fix" this test to match, leaving an
    observability change dark on a variable nobody set — `project_feature_flag_ledger`'s
    indistinguishable case. Pinning the LITERAL makes that edit visible.
    """
    monkeypatch.delenv(ar.ROUTING_FLAG_ENV, raising=False)
    assert ar.routing_enabled() is True
    assert ar.ROUTING_FLAG_DEFAULT == "1", (
        "the env default for ALERT_ROUTING_ENABLED must be \"1\" (ON). Default-on "
        "with an explicit \"0\" escape is what keeps the rollback a variable "
        "rather than a revert.")


@pytest.mark.parametrize("raw,expected", [
    ("0", False), ("false", False), ("FALSE", False), ("no", False), ("off", False),
    (" Off ", False), ("", True), ("1", True), ("true", True), ("yes", True),
    ("on", True), ("banana", True), ("2", True),
])
def test_the_gate_normalises_and_never_raises(monkeypatch, raw, expected):
    """⚠️ `""` READS AS ON, and that is deliberate for a kill switch: blanking is
    how this estate turns a WEBHOOK off, and blanking the switch itself must not
    accidentally revert the routing decision. The off spellings are explicit."""
    monkeypatch.setenv(ar.ROUTING_FLAG_ENV, raw)
    assert ar.routing_enabled() is expected


def test_the_KILL_SWITCH_is_evaluated_BEFORE_anything_else(monkeypatch):
    """⛔⛔ THE ORDERING, and it is load-bearing exactly as it is in
    `askai.py:47 enabled_for` — *"the kill switch, read FIRST and per call. Off
    means this module touches neither auth.db nor wisdom.db."*

    ⭐ A SPY, not a return value. A bare-except fail-closed means a flipped order
    ALSO returns False, so asserting the answer proves nothing about the order.
    What a false flag has to buy is that nothing downstream of it runs.
    """
    calls: list = []
    real = ar._normalised_class
    monkeypatch.setattr(ar, "_normalised_class",
                        lambda value: (calls.append(value), real(value))[1])

    monkeypatch.setenv(ar.ROUTING_FLAG_ENV, "0")
    assert ar.routing_enabled_for(ar.CLASS_OPS) is False
    assert calls == [], (
        "the class was inspected although the kill switch was off. A false flag "
        "must beat every other consideration, or 'flip one variable and the "
        "decision stops happening' is not true.")

    # …and the control: with the switch ON the second consideration IS consulted,
    # so the emptiness above is the order and not a function that never runs.
    monkeypatch.setenv(ar.ROUTING_FLAG_ENV, "1")
    assert ar.routing_enabled_for(ar.CLASS_OPS) is True
    assert calls == [ar.CLASS_OPS]


def test_the_composed_gate_fails_CLOSED_when_the_class_check_raises(monkeypatch):
    """The bare-except half of the askai shape. Fail-closed here means "keep
    today's behaviour", never "drop the alert": False tells a producer to take the
    pre-split `DISCORD_WEBHOOK_URL` path, which is what `ALERT_ROUTING_ENABLED=0`
    is specified to restore."""
    monkeypatch.setenv(ar.ROUTING_FLAG_ENV, "1")

    def boom(_value):
        raise RuntimeError("the class check exploded")

    monkeypatch.setattr(ar, "_normalised_class", boom)
    assert ar.routing_enabled_for(ar.CLASS_OPS) is False


def test_the_composed_gate_is_not_a_softer_resolver(monkeypatch):
    """⛔ A producer that asks the gate and gets True, then hands `resolve_channel`
    a class it does not recognise, STILL fails by name. Swallowing R2 here would be
    the forbidden default wearing a predicate's clothes."""
    monkeypatch.setenv(ar.ROUTING_FLAG_ENV, "1")
    assert ar.routing_enabled_for("both") is False
    with pytest.raises(ar.UnroutableAlert):
        ar.resolve_channel("both", ar.SEVERITY_CRITICAL)


# ───────────────────────────────────────────────────────────────────────────────
# THE LEDGER — the declared default must equal the reader's literal default.
# ───────────────────────────────────────────────────────────────────────────────

def _ledger_flags() -> dict:
    return json.loads(LEDGER_PATH.read_text(encoding="utf-8"))["flags"]


def test_the_ledger_default_matches_the_readers_literal_default():
    """⛔ TWO AUTHORITIES OVER ONE VALUE IS THE DEFECT; this pins them together.

    `docs/feature_flags.json` is what a human reads to learn a gate's polarity, and
    `feature_flag_index` cannot derive this one's default (it reads only a literal
    second argument, and the reader uses a module constant — the deliberate path
    `needs_declaration`'s own docstring describes). So the ledger is the ONLY
    written record of the polarity, and a drift between it and the code would leave
    the record describing a gate that behaves the other way round.
    """
    entry = _ledger_flags().get(ar.ROUTING_FLAG_ENV)
    assert entry is not None, (
        f"{ar.ROUTING_FLAG_ENV} has no entry in docs/feature_flags.json. The reader "
        "exists, so the flag-ledger rail requires one.")
    assert entry.get("default") == ar.ROUTING_FLAG_DEFAULT, (
        f"the ledger declares default={entry.get('default')!r} while the reader "
        f"falls back to {ar.ROUTING_FLAG_DEFAULT!r}")


def test_the_ledger_entry_records_that_the_gate_is_ON_by_default_despite_being_dark():
    """⚠️ A READER WILL FIND `status: dark` BESIDE A DEFAULT OF "1" CONFUSING, so the
    note has to resolve it: the CAPABILITY is dark because the resolver has no
    caller, while the GATE defaults on because it is a kill switch. Without that
    sentence the entry looks like one of the two fields is a mistake."""
    entry = _ledger_flags()[ar.ROUTING_FLAG_ENV]
    assert entry["status"] == "dark"
    assert entry["where"] == [], "declared dark but claimed to be set somewhere"
    note = (entry.get("note") or "").lower()
    assert "no caller" in note or "no consumer" in note, note
    assert "kill switch" in note, note


# ───────────────────────────────────────────────────────────────────────────────
# THE ADMIN DIAGNOSTIC — the three names are reportable, and it still reports
# {set, length} and NEVER a value.
# ───────────────────────────────────────────────────────────────────────────────

def _health():
    module = importlib.import_module("api.routers.admin_api_health")
    return module, module.api_health(user=None)


@pytest.mark.parametrize("name", ["DISCORD_OPS_WEBHOOK_URL",
                                 "DISCORD_BUSINESS_WEBHOOK_URL",
                                 "OPS_ALERT_EMAIL_TO"])
def test_each_new_destination_is_reported_by_the_admin_diagnostic(name):
    """Spec §5.3: *"a variable that is not in that list is a variable nobody can
    check without Railway."* This is the only surface that answers "is it set?"
    without a Railway read."""
    _module, payload = _health()
    assert name in payload["groups"]["infra_and_comms"]


def test_the_gate_is_reported_among_the_feature_flags():
    _module, payload = _health()
    assert ar.ROUTING_FLAG_ENV in payload["groups"]["feature_flags"]


def test_the_reported_names_are_the_ones_the_resolver_actually_uses():
    """⛔ DERIVED FROM THE MODULE, never retyped. A diagnostic reporting
    `DISCORD_OPS_WEBHOOK` while the resolver names `DISCORD_OPS_WEBHOOK_URL` would
    answer "not set" forever about a variable that was set — the stale-name defect
    this repo keeps paying for."""
    _module, payload = _health()
    reported = set(payload["groups"]["infra_and_comms"]) | set(payload["groups"]["feature_flags"])
    for name in (ar.OPS_WEBHOOK_ENV, ar.BUSINESS_WEBHOOK_ENV, ar.ADMIN_WEBHOOK_ENV,
                 ar.OPS_EMAIL_ENV, ar.ROUTING_FLAG_ENV):
        assert name in reported, f"{name} is unreportable without a Railway read"


def test_the_admin_diagnostic_reports_set_and_length_and_NEVER_a_value(monkeypatch):
    """⛔⛔ A WEBHOOK URL PRINTED INTO AN ADMIN RESPONSE IS A CREDENTIAL LEAK, and
    this commit adds three secret-bearing names to that response.

    ⭐ THE NON-VACUITY HALF IS `set`/`length`: "the sentinel is absent" would also
    be true of a diagnostic that read nothing at all. Asserting the key was READ —
    `set` is True and `length` equals the sentinel's length — is what makes the
    absence mean something.
    """
    sentinel = "sentinel-value-that-must-never-be-returned-0123456789"
    for name in (ar.OPS_WEBHOOK_ENV, ar.BUSINESS_WEBHOOK_ENV, ar.OPS_EMAIL_ENV):
        monkeypatch.setenv(name, sentinel)
    _module, payload = _health()

    for name in (ar.OPS_WEBHOOK_ENV, ar.BUSINESS_WEBHOOK_ENV, ar.OPS_EMAIL_ENV):
        status = payload["groups"]["infra_and_comms"][name]
        assert status["set"] is True                       # it really was read
        assert status["length"] == len(sentinel)           # …and read correctly
        assert set(status) == {"set", "length"}            # and nothing else is exposed
    assert sentinel not in json.dumps(payload)


# ───────────────────────────────────────────────────────────────────────────────
# THIS COMMIT HAS NO CONSUMER, AND THE NAME IS NOT THE ONE ALREADY TAKEN.
# ───────────────────────────────────────────────────────────────────────────────

def _imports_alert_routing(source: str) -> bool:
    """Does `source` IMPORT this module? ⛔ AST, never a substring search.

    ⚰️ THE FIRST VERSION OF THIS RAIL WAS A GREP FOR `"alert_routing"` AND IT WAS
    RED ON ARRIVAL, for three reasons and not one:

      • `api/services/alert_taxonomy/db.py:14` and `delivery.py:7` name
        **`alert_routing_prefs`** — the per-user, per-trigger-type channel-override
        table from `specs/alerts-monitoring-spec.md`, a design `delivery.py:6-10`
        records as explicitly NOT implemented. It is prose about an unbuilt table,
        and this module's name is a PREFIX of it.
      • `admin_api_health.py`'s new comments name this module on purpose, to say
        where the resolver lives.
      • Neither is an import, which is the thing "has a consumer" actually means.

    ⭐ Same lesson as `reachable.test.js`'s *"a grep here once found 5 call sites,
    all five of them prose"*, and as R4's `co_names` choice above.
    """
    try:
        tree = ast.parse(source)
    except SyntaxError:                                  # pragma: no cover
        return False
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            if any(a.name.split(".")[-1] == "alert_routing" for a in node.names):
                return True
        elif isinstance(node, ast.ImportFrom):
            module = node.module or ""
            if module.split(".")[-1] == "alert_routing":
                return True
            if any(a.name == "alert_routing" for a in node.names):
                return True
    return False


# ⚰️ `test_nothing_under_api_imports_this_module_yet` WAS HERE AND WAS DELETED BY
# TERM-011 STEP 3, WHICH IS WHAT IT ASKED FOR: *"IF YOU ARE WIRING THE FIRST
# CONSUMER, DELETE THIS TEST IN THAT SAME COMMIT … deleting it is the record that
# step 3 happened."* Its assertion was "there are no consumers under api/" — a
# property that does not NARROW when the first producer is converted, it simply
# stops being true, so there is no weaker version of it to keep.
# ⭐ WHERE THE COVERAGE WENT: `api/services/alert_destination.py` is the consumer,
# and `tests/test_alert_destination.py` is its rail. The resolver's own purity,
# R2 refusal and variable-name contract are still asserted by the rest of THIS
# file — nothing about `resolve_channel` lost a test here.

@pytest.mark.parametrize("source,expected", [
    ("from api.services import alert_routing\n", True),
    ("from api.services.alert_routing import resolve_channel\n", True),
    ("import api.services.alert_routing\n", True),
    ("import api.services.alert_routing as ar\n", True),
    # …and the three shapes that made the grep version red on arrival:
    ('"""names alert_routing_prefs, an unbuilt table."""\n', False),
    ("# api/services/alert_routing.py is a resolver with no caller\n", False),
    ("from api.services import alert_routing_prefs\n", False),
])
def test_the_consumer_detector_distinguishes_an_IMPORT_from_a_MENTION(source, expected):
    """⛔ NON-VACUITY IN BOTH DIRECTIONS. A detector that answered False for
    everything would make the rail above pass over a module imported everywhere; one
    that answered True for prose is the version that was red on arrival."""
    assert _imports_alert_routing(source) is expected


def test_the_sweep_above_really_walks_the_api_tree():
    """⛔ THE OTHER NON-VACUITY: a glob that matched no files would report no
    offenders however good the detector is. `alerts.py` is the module this one
    imports its vocabulary FROM, so it is guaranteed to be in the walk."""
    walked = {p.relative_to(REPO).as_posix() for p in (REPO / "api").rglob("*.py")}
    assert "api/services/alerts.py" in walked
    assert "api/services/alert_routing.py" in walked
    assert len(walked) > 100, len(walked)


def test_the_resolver_is_NOT_called_resolve_channels():
    """⛔ `api/services/alert_taxonomy/regime_change.py:308` already owns
    `resolve_channels`, and it is a DIFFERENT thing: it returns a fixed
    `("in_app",)` and deliberately ignores its argument. Two functions one letter
    apart, one of which ignores its input, is a misread waiting to happen — and the
    misread would look like a routing decision while being a constant."""
    assert hasattr(ar, "resolve_channel")
    assert not hasattr(ar, "resolve_channels"), (
        "alert_routing grew a `resolve_channels`; that name is taken and means "
        "something else")
    regime = importlib.import_module("api.services.alert_taxonomy.regime_change")
    assert regime.resolve_channels() == ("in_app",)
    assert regime.resolve_channels({"channels": ["discord"]}) == ("in_app",)


def test_the_module_does_not_import_a_transport():
    """⛔ Spec §9: *"Reuse the routing, not a second copy of the poster."* A
    resolver that imported `requests` or `httpx` would be one commit away from
    being a twenty-sixth Discord transport."""
    tree = ast.parse(MODULE_PATH.read_text(encoding="utf-8"))
    imported = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            imported.update(a.name.split(".")[0] for a in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module:
            imported.add(node.module.split(".")[0])
    for forbidden in ("requests", "httpx", "urllib", "socket", "smtplib", "aiohttp"):
        assert forbidden not in imported, f"the resolver imports {forbidden}"
    assert "os" in imported, "non-vacuity: the import walk really does see imports"
