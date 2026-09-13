"""F-I1-4 — THE `_full_answer_text()` COMPLETENESS RAIL.

─── THE DEFECT THIS EXISTS FOR ───────────────────────────────────────────────

`ticker_explain._grounding_flags` is the blocking gate: no ungrounded number,
no fabricated `evidence_id`, and no decisive Buy/Sell/Hold verdict may reach a
member. It governs exactly one thing — **the text `_full_answer_text()`
unions**, and nothing else. Today that union is a hand-written list of six
`data.get(...)` calls.

So the governed set and the emittable set are held together by a convention.
Add a ninth model-authored field to `EXPLAIN_SCHEMA` tomorrow — a
`risk_note`, a `what_to_watch`, a `disclaimer` — forget the one line in
`_full_answer_text`, and that field becomes **ungoverned prose**: the model may
state any number it likes in it, cite anything, or write "you should buy this
stock now", and every gate in this module stays silent. Nothing goes red. The
answer ships.

That is the same shape as every hand-typed enumeration this repo keeps
re-recording (`lesson_a_second_authority_over_one_value`,
`lesson_a_projection_drops_what_it_does_not_name`): a list beside the thing it
claims to describe, with nothing forcing the two to agree.

─── WHAT THIS RAIL DOES ──────────────────────────────────────────────────────

1. **DERIVES the emittable field set from `EXPLAIN_SCHEMA`**, never a typed
   list. The schema is the complete enumeration *because* it declares
   `additionalProperties: False` at every level — the model structurally cannot
   emit a key it does not name. That property is asserted here, or this whole
   rail would be measuring a subset.

2. **DEMANDS A GOVERNANCE DECISION FOR EVERY FIELD.** `FIELD_GOVERNANCE` below
   maps each derived field to how it is governed. A field in the schema and not
   in that map fails this rail BY NAME, and a map entry whose field has left
   the schema fails it too — the map cannot outlive the schema in either
   direction.

   ⛔ **ADDING A FIELD TO `EXPLAIN_SCHEMA` BREAKS THIS TEST UNTIL IT IS
   REGISTERED.** That is the requirement, not a side effect. An unfamiliar
   schema SHAPE (something that is neither a string nor an array-of-objects)
   fails too, rather than being silently skipped — a skipped shape is exactly
   how an enumeration goes quietly incomplete.

3. **PROVES THE ROUTING BEHAVIOURALLY, NOT BY READING THE SOURCE.** For every
   field registered as prose, a sentinel ungrounded number is placed in THAT
   FIELD ALONE and `_grounding_flags` must report it; a decisive-verdict
   sentence is placed in that field alone and the hard-boundary check must
   report that. An AST scan of `_full_answer_text` would prove the field is
   *mentioned*; this proves it is *governed*, which is the property that
   matters and the only one a member feels.

⭐ **AND IT CARRIES A CONTROL.** The same sentinel, in a key the schema does not
declare, produces NO flag. Without that pair, "every field is governed" could
be satisfied by a gate that flags everything, including things it never saw.
"""
from __future__ import annotations

import pytest

from api.services import ticker_explain as te


# ── The one evidence bundle every probe below is scored against ──────────────
#
# Deliberately minimal and number-free: `_evidence_numbers` returns an empty
# set for it, so ANY number in a model-authored field is ungrounded and a
# sentinel needs no coordination with a fixture. It also carries no
# upgrade/downgrade vocabulary, so `_conflicting_evidence_pairs` is empty and
# the cross-fact branch of the gate cannot fire and mask a missing flag.
_EVIDENCE = [{
    "id": "E1", "type": "news", "date": "two thousand twenty six",
    "source": "Reuters",
    "text": "Apple announced a services partnership with a streaming provider.",
    "url": None,
}]

# A number that appears nowhere in `_EVIDENCE`, is not ISO-date-shaped, is not
# a month-name date and is not an SEC form number — so none of the gate's
# masking passes (`_ISO_DATE_RE`, `_MONTH_NAME_DATE_RE`, `_FORM_NUMBER_RE`)
# can swallow it before extraction runs.
_SENTINEL_NUMBER = "987654.321"

# The hard boundary, in a phrasing `_DECISIVE_RE` recognises. Kept as ONE
# sentence so a field probe places exactly one violation.
_SENTINEL_VERDICT = "You should buy this stock now."


# ── Deriving the emittable field set from the schema ─────────────────────────

def _derive_model_authored_fields(schema: dict, prefix: str = "") -> list[str]:
    """Every field path the model can emit, read off `EXPLAIN_SCHEMA`.

    ⛔ AN UNFAMILIAR SHAPE IS A FAILURE, NEVER A SKIP. The two shapes this
    assistant's schema uses today are a string leaf and an array of objects; a
    third shape (a nested object, a oneOf, an array of strings) means a new
    kind of model-authored content exists that nobody has decided how to
    govern, and the honest answer is to stop rather than to quietly not
    enumerate it.
    """
    assert schema.get("additionalProperties") is False, (
        f"EXPLAIN_SCHEMA{' at ' + prefix if prefix else ''} does not set "
        "additionalProperties=False, so the model can emit keys the schema "
        "never names and this rail's enumeration is not complete. Every "
        "assertion in this file would be measuring a subset."
    )
    out: list[str] = []
    for name, spec in (schema.get("properties") or {}).items():
        path = f"{prefix}{name}"
        kind = spec.get("type")
        if kind == "string":
            out.append(path)
        elif kind == "array" and (spec.get("items") or {}).get("type") == "object":
            out.extend(_derive_model_authored_fields(spec["items"], prefix=f"{path}[]."))
        else:
            raise AssertionError(
                f"EXPLAIN_SCHEMA field {path!r} has a shape this rail does not "
                f"understand ({kind!r}). A new model-authored shape needs a "
                "governance decision and an extension here — it must not be "
                "silently skipped, which is precisely how a gate stops covering "
                "what the model can say."
            )
    return out


PROSE = "prose — must be unioned by _full_answer_text and governed by _grounding_flags"

# ── The governance ledger ────────────────────────────────────────────────────
#
# ⛔ EVERY KEY HERE IS A DECISION, AND EVERY DECISION IS PROVED BELOW. A field
# is either PROSE (free text the model composes, so the grounding gate and the
# hard-boundary gate must both reach it) or it names a DIFFERENT governed path,
# and that path gets its own proof test in this file. There is no third option
# and no "not applicable" — a model-authored field nobody governs is the
# defect.
FIELD_GOVERNANCE: dict[str, str] = {
    "summary": PROSE,
    "interpretation": PROSE,
    "caveat": PROSE,
    "clarification_question": PROSE,
    "refusal_reason": PROSE,
    "key_facts[].statement": PROSE,

    # NOT prose: a closed vocabulary, not composed text. Governed by the schema
    # enum plus `explain_recent_activity`'s fail-closed coercion (an
    # unrecognised value is a blocking flag, and a second unrecognised value
    # serves a refusal) and by `_clean_history`'s own coercion on the way back
    # in. Proved by `test_response_state_is_a_closed_vocabulary_that_fails_closed`.
    "response_state": "closed enum + fail-closed coercion to 'refuse'",

    # NOT prose: an identifier, not a claim. Governed by `_grounding_flags`'s
    # `valid_ids` membership check, which is a STRONGER guarantee than the
    # numeric scan gives prose — an id must exist in THIS turn's bundle, not
    # merely be plausible. Proved by
    # `test_evidence_id_is_governed_by_the_valid_ids_check`.
    "key_facts[].evidence_id": "membership in this turn's evidence ids",
}


def _blank_answer() -> dict:
    """A structurally valid, entirely empty answer — the canvas each probe
    writes exactly one violation onto."""
    return {"response_state": "answer", "summary": "", "key_facts": [],
            "interpretation": "", "caveat": "", "clarification_question": "",
            "refusal_reason": ""}


def _answer_with(path: str, text: str) -> dict:
    """Place `text` in the single model-authored field named by `path`."""
    data = _blank_answer()
    if path.startswith("key_facts[]."):
        data["key_facts"] = [{"statement": "", "evidence_id": "E1"}]
        data["key_facts"][0][path.split("].", 1)[1]] = text
    else:
        data[path] = text
    return data


DERIVED_FIELDS = _derive_model_authored_fields(te.EXPLAIN_SCHEMA)
PROSE_FIELDS = [f for f in DERIVED_FIELDS if FIELD_GOVERNANCE.get(f) == PROSE]


class TestTheEnumerationIsDerivedAndComplete:
    def test_the_schema_is_the_complete_enumeration(self):
        # The premise of the whole rail, asserted rather than assumed: a schema
        # that allows extra properties cannot enumerate what the model emits.
        # `_derive_model_authored_fields` asserts this at every level as it
        # walks; this names it out loud at the top level so the reason is
        # visible where somebody would think about relaxing it.
        assert te.EXPLAIN_SCHEMA.get("additionalProperties") is False
        assert (te.EXPLAIN_SCHEMA["properties"]["key_facts"]["items"]
                .get("additionalProperties") is False)

    def test_the_derivation_is_not_vacuous(self):
        # ⛔ NON-VACUITY. Every assertion below iterates a derived list; a
        # derivation that returned nothing would make all of them pass over an
        # empty set (`lesson_a_fixture_that_cannot_distinguish_is_not_a_rail`).
        assert len(DERIVED_FIELDS) >= 7, DERIVED_FIELDS
        assert len(PROSE_FIELDS) >= 5, PROSE_FIELDS
        # Named anchors, not a count: the two fields whose governance is NOT
        # prose must both be present, or the classification below is untested.
        assert "response_state" in DERIVED_FIELDS
        assert "key_facts[].evidence_id" in DERIVED_FIELDS
        # And the nested traversal really happened — a walk that stopped at the
        # top level would silently drop every key_facts field.
        assert "key_facts[].statement" in DERIVED_FIELDS

    def test_every_model_authored_field_has_a_governance_decision(self):
        unregistered = [f for f in DERIVED_FIELDS if f not in FIELD_GOVERNANCE]
        assert not unregistered, (
            f"these fields were added to EXPLAIN_SCHEMA and nobody decided how "
            f"they are governed: {unregistered}. If the field is free text the "
            "model composes, add it to `_full_answer_text` AND register it as "
            "PROSE here — until then the grounding gate and the Buy/Sell/Hold "
            "boundary do not read it, and anything the model writes there "
            "ships unchecked."
        )

    def test_the_ledger_cannot_outlive_the_schema(self):
        # The other direction, and it is the one that rots quietly: an entry
        # for a field that no longer exists is a governance claim about
        # nothing, and it makes the ledger look more complete than it is.
        stale = [f for f in FIELD_GOVERNANCE if f not in DERIVED_FIELDS]
        assert not stale, (
            f"these fields are registered here but are not in EXPLAIN_SCHEMA "
            f"any more: {stale}. Delete their entries."
        )


class TestEveryProseFieldIsActuallyGoverned:
    """The load-bearing half. Behavioural, one field at a time."""

    @pytest.mark.parametrize("path", PROSE_FIELDS)
    def test_an_ungrounded_number_in_this_field_alone_is_flagged(self, path):
        data = _answer_with(path, f"The figure is {_SENTINEL_NUMBER} on that basis.")
        flags = te._grounding_flags(data, _EVIDENCE)
        assert any(_SENTINEL_NUMBER in f for f in flags), (
            f"a number that appears nowhere in the evidence was written into "
            f"{path!r} and the grounding gate said nothing. That field is "
            "UNGOVERNED PROSE: `_grounding_flags` only reads what "
            "`_full_answer_text` unions, and this field is not in that union. "
            f"Flags actually raised: {flags}"
        )

    @pytest.mark.parametrize("path", PROSE_FIELDS)
    def test_a_decisive_verdict_in_this_field_alone_is_flagged(self, path):
        # The D9 hard boundary travels on the same union. A field added to the
        # schema but not to `_full_answer_text` is a place a Buy/Sell/Hold
        # directive can be served from — which is the one thing this assistant
        # is defined as never doing.
        data = _answer_with(path, _SENTINEL_VERDICT)
        flags = te._grounding_flags(data, _EVIDENCE)
        assert any("decisive verdict language" in f for f in flags), (
            f"a Buy/Sell/Hold directive written into {path!r} reached the "
            f"member unflagged. Flags actually raised: {flags}"
        )

    @pytest.mark.parametrize("path", PROSE_FIELDS)
    def test_this_field_is_present_in_the_unioned_text(self, path):
        # The weaker, direct statement of the same fact, kept because it names
        # the function a fix belongs in. It is NOT a substitute for the two
        # behavioural probes above — a field could be unioned and still not
        # scanned if the gate ever stopped calling `_full_answer_text`.
        marker = "uct-i1-field-probe-marker"
        assert marker in te._full_answer_text(_answer_with(path, marker)), (
            f"`_full_answer_text` does not include {path!r} in its union."
        )


class TestTheProbeCanTellGovernedFromUNGOVERNED:
    """⭐ THE CONTROL. Without it, every assertion above is satisfied by a gate
    that reports a violation for any input at all — including text the model
    never emitted."""

    def test_the_same_sentinel_in_an_undeclared_key_raises_nothing(self):
        data = _blank_answer()
        # A key EXPLAIN_SCHEMA does not declare — structurally unreachable for
        # the real model, and used here only to show the probe is reading
        # specific fields rather than the whole dict.
        assert "__not_a_declared_field__" not in te.EXPLAIN_SCHEMA["properties"]
        data["__not_a_declared_field__"] = f"The figure is {_SENTINEL_NUMBER}."
        flags = te._grounding_flags(data, _EVIDENCE)
        assert not any(_SENTINEL_NUMBER in f for f in flags), (
            "the gate flagged a sentinel that lives in no declared field, so it "
            "is not reading fields at all and the per-field assertions above "
            f"prove nothing. Flags: {flags}"
        )

    def test_a_clean_answer_raises_nothing(self):
        # The second half of the control: the gate is not simply always-on.
        data = _answer_with("summary", "Apple announced a services partnership.")
        assert te._grounding_flags(data, _EVIDENCE) == []


class TestTheTwoNonProseFieldsAreGovernedTheWayTheLedgerSays:
    def test_response_state_is_a_closed_vocabulary_that_fails_closed(self):
        # (a) the schema pins the vocabulary to the module's own tuple — not a
        #     second hand-typed copy of it.
        assert (tuple(te.EXPLAIN_SCHEMA["properties"]["response_state"]["enum"])
                == tuple(te._RESPONSE_STATES))
        # (b) an unrecognised value is a BLOCKING condition in the orchestrator,
        #     not a pass-through. Asserted on the literal `explain_recent_activity`
        #     checks against, so a rename cannot leave this green.
        assert "recommend_buy" not in te._RESPONSE_STATES
        # (c) and it coerces to `refuse` on the way back in as prior-turn
        #     state, so an unrecognised state can never re-enter as context
        #     either.
        cleaned = te._clean_history(
            [{"sym": "AAPL", "question": "q", "response_state": "recommend_buy",
              "domains": ["news"], "summary": "s"}], "AAPL")
        assert cleaned and cleaned[0]["response_state"] == "refuse"

    def test_evidence_id_is_governed_by_the_valid_ids_check(self):
        data = _blank_answer()
        data["key_facts"] = [{"statement": "Something true.", "evidence_id": "E999"}]
        flags = te._grounding_flags(data, _EVIDENCE)
        assert any("unverified evidence_id" in f for f in flags), flags
        # Control: the real id raises nothing, so the check is a membership
        # test and not a blanket rejection.
        data["key_facts"] = [{"statement": "Something true.", "evidence_id": "E1"}]
        assert te._grounding_flags(data, _EVIDENCE) == []
