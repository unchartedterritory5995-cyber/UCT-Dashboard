"""GATE-S7-REGIME-CHANGE — S7 trigger type 4, and the FIRST absorption with TWO
legacy emitters.

⛔ Approved for CHECKPOINTS 1-2 ONLY (owner, 2026-09-13, packet `4b4c3549b`).
CP1 registers the type and pins the schema. CP2 adds a dark evaluator and a
forward-only harness over HARNESS-ARMED predicates. **No delivery. No projection
of member rows. No legacy change.** CP3, CP4 and the flip each need a new line.

══════════════════════════════════════════════════════════════════════════════
THE LEGACY SHAPES — REPORTED BEFORE THE SCHEMA IS PINNED, AND THERE ARE TWO
══════════════════════════════════════════════════════════════════════════════

Read from `api/**` on this tree (master `94209e962`), never from the type's name
and never from the completion plan's one-line description. ⚠️ The packet's own
line numbers were measured against `6576f044e`; every number below was RE-READ
here and several have moved.

| | **A — R4, the ledger path** | **B — the session-summary heuristic** |
|---|---|---|
| function | `rule_regime_flip` — `api/services/awareness/rules.py:127-162` | `maybe_emit_regime_shift(user_id)` — `api/services/voice_proactive_service.py:490-520` |
| prior label from | `awareness_regime_snapshots`, the durable per-cycle ledger (`regime_snapshots.get_last_label()`, `:45-53`) | **the TEXT of the member's last voice-session summary** — `list_summaries(user_id, limit=1)`, then `if r in last_text` |
| current label from | `voice_regime_classifier.get_current_regime()` (DEC-13's authority) | the same function |
| insight `kind` | `regime_flip` | `regime_shift` |
| importance | computed — `0.5 + 0.5*confidence`, x1.3 with positions, x1.4 urgency, clamped 1-10 (`rules.py:151,158-160` via `compute_relevance_score`) | **hard-coded 8** (`voice_proactive_service.py:515`) |
| who is eligible | any member with an open position **or** a watchlist symbol (`rules.py:144-147`) | any member with at least one voice-session summary — **no stake test at all** |
| driver | `run_awareness_scan()` → `engine.py:271` | `api/main.py:6584` (premarket) and `:6587` (RTH); `api/routers/voice.py:564` (on demand) |
| eligible population | every user row `_bulk_load_user_contexts` returns (`engine.py:33-63`) | only `voice_settings.enabled = 1` (`main.py:6574-6576`) |
| schedule / gate | 20-min weekday cron, **double-gated** `COMPASS_AUTOMATION_ENABLED` + `AWARENESS_ENGINE_ENABLED` | premarket 7-9 ET every 15 min and RTH 9-15 ET every 30 min, gated on `COMPASS_AUTOMATION_ENABLED` ONLY, **plus an on-demand door in the voice router** |
| durable row | ⛔ none S7 would recognise — a `voice_proactive_insights` row | the same |

⭐ The ledger's own docstring (`regime_snapshots.py:5-9`) names B as the thing it
replaced. ⛔ **It was not replaced. Both are wired** — `maybe_emit_regime_shift`
has **6 occurrences in stripped source**, its definition plus five call/import
sites, exactly as the packet measured.

⛔ **So an absorption that reproduces only R4 reports `legacy_only` for every
fire B makes — an alert a member LOSES at the flip.** `prior_label_source` below
is the field that makes that choice DECLARABLE instead of assumed.

══════════════════════════════════════════════════════════════════════════════
⛔⛔ F-S7-RC-4 — NEW, AND THE PACKET SAYS "TWO". THERE IS A THIRD, AND IT
     ALREADY SENDS TO DISCORD.
══════════════════════════════════════════════════════════════════════════════

`api/services/alerts.py:502-508` ships `alert_regime_change(old_phase,
new_phase, exposure)`, called from `api/routers/push.py:190-196` whenever the
brain's `intraday_update` payload arrives with a `regime.phase` different from
the previous cached payload's. It is:

  * **a BROADCAST alert** — `add_alert(..., user_id=None)`, so every member's
    feed, no stake test and no cohort;
  * **severity CRITICAL** (`_TYPE_SEVERITY["regime_change"]`, `alerts.py:98`),
    and `add_alert` fires the Discord webhook for WARNING or CRITICAL
    (`alerts.py:328-332`). ⛔ **So a "the regime changed" message ALREADY leaves
    the app today**, whenever `DISCORD_ALERT_WEBHOOK` is set;
  * **not durable** — `alert_durability.should_persist` returns False for a
    broadcast (`:69-70`), so it lives only in the ephemeral cache;
  * ⛔ **and its alert type string is `regime_change`, one character from this
    type's `regime-change`, in the SAME module that hosts S7's feed bridge.**

⭐ **It is NOT the same event and it is NOT absorbed here.** Its vocabulary is
the brain's market *phase* (Markup → Distribution) from the morning-wire push,
not DEC-13's five classifier labels, and DEC-13 does not name it. So
`prior_label_source` deliberately admits ONLY `ledger` and `session_summary`:
the third path is EXCLUDED BY NAME rather than forgotten, and
`test_the_THIRD_regime_emitter_is_declared_and_deliberately_NOT_absorbed` is the
rail that keeps it visible.

⚠️ **What it qualifies.** The packet's framing — *"the deliberate in-app-only
decision exists to prevent mass-emailing every position holder on every flip"* —
is true of paths A and B. It is **not** true of "a regime change reaches a
member" in general, and anyone sizing the flip against "regime alerts are in-app
only today" would be sizing against two thirds of the picture.

══════════════════════════════════════════════════════════════════════════════
⛔⛔ THE IN-APP-ONLY PROPERTY IS A STRUCTURAL ACCIDENT, NOT A RULE
══════════════════════════════════════════════════════════════════════════════

`api/services/awareness/engine.py:236-241`, quoted verbatim from this tree:

    # Away-deliver (email/Discord) only for personal, ticker-specific insights
    # above the floor. Regime flips are market-wide/systemic (symbol=None) - they
    # surface in-app + spoken at session start, but must NOT blast every position
    # holder's inbox on every flip (calm/surgical). Operator can add a dedicated
    # regime-change email later if desired.
    if importance >= _DELIVER_IMPORTANCE_FLOOR and candidate.symbol:

`_DELIVER_IMPORTANCE_FLOOR = 8` (`engine.py:26`). `rule_regime_flip` returns
`symbol=None` (`rules.py:154`, read by AST), so the **second conjunct is false by
construction** and the away-delivery branch is unreachable for this rule. Path B
never reaches `_fire_candidate` at all — it calls `add_insight` directly with
`symbol=None` — **a second module whose email-silence rests on the same
convention.**

⛔ **THE HAZARD THIS SCHEMA EXISTS TO CLOSE.** An S7 predicate carries an
`entity_scope` with an optional `symbol` and a per-predicate `channels` list
(`predicates.register_predicate(..., channels=None)`, `predicates.py:55`). A
`regime-change` predicate registered WITH a symbol — because "which names does
this flip affect" is the obvious next feature — or with the type's default
channel routing, **acquires email and Discord to every position holder on every
flip**, and nothing in the type's name or its evaluator would say so.

**Two fields are therefore FIXED VALUES rather than defaults**, so widening
either is a visible schema change (the value is persisted into
`alert_trigger_registry.params_schema` at registration) instead of an emergent
one:

  * `channels` = `["in_app"]` — `CHANNELS_FIXED`, and `resolve_channels()`
    IGNORES anything params supply.
  * `entity_ref` = `null` — `ENTITY_REF_FIXED`, and `resolve_entity_ref()`
    likewise. This one is the direct mirror of `and candidate.symbol`: the guard
    that keeps the flip quiet today is one conjunct in a different module's
    `if`, and pinning the symbol away here is what stops that from being luck.

⭐ **The confidence gate the legacy comment invites is OUT OF SCOPE.**
`min_confidence` being present in the schema is not authorization to route on it.

══════════════════════════════════════════════════════════════════════════════
⛔ F-S7-RC-1 — CONFIRMED. The dedup the docstring promises does not exist.
══════════════════════════════════════════════════════════════════════════════

`rule_regime_flip`'s docstring claims a label-scoped 6h cooldown. Measured on
this tree, **both halves are false**:

1. **The `dedup_key` never reaches `add_insight`.** `REGIME:{label}` is computed
   at `rules.py:161` and discarded: `engine.py:_fire_candidate` passes
   `symbol=candidate.symbol` (`:229`), which is `None`. Stripped-source search
   over 1,214 files under `api/`: `dedup_key` appears in `awareness/rules.py`
   and **never in `awareness/engine.py`** — the field is written and never read.
2. **There is no cooldown at all for a null symbol.**
   `voice_proactive_service.py:87` is `if symbol:` and the per-`(symbol, kind)`
   query at `:88-95` sits entirely inside it. The only remaining bound is
   `MAX_INSIGHTS_PER_USER_PER_DAY = 8` (`:28`), **shared across every insight
   kind**.

⭐ **What suppresses a repeat on path A is the LEDGER, not the cooldown.**
`record_snapshot` is called unconditionally every cycle (`engine.py:161`), so the
next cycle's `prev_label` equals the label just recorded and `rules.py:141`
returns `[]`. The behaviour is right; the stated mechanism is wrong, and the
difference bites exactly where the docstring claims to help: A->B->A across two
cycles fires **twice with no cooldown between them**.

⛔ **An absorption must reproduce the LEDGER's suppression, not the cooldown's.**
Building the 6h symbol cooldown the docstring describes would produce a rule that
agrees almost always and diverges precisely on the oscillation.

══════════════════════════════════════════════════════════════════════════════
⛔⛔ F-S7-RC-3 — NEW, AND SHARPER: PATH B HAS NO SUPPRESSION AT ALL
══════════════════════════════════════════════════════════════════════════════

F-S7-RC-1 is survivable on path A because the ledger moves. **Path B has no
ledger.** It compares against the text of the member's last session summary,
which does not change until the member has another voice session. So every
window scan that finds a mentioned label different from the current one queues
ANOTHER `regime_shift` row: `symbol=None` skips the cooldown, `importance=8`
clears `MIN_IMPORTANCE_TO_QUEUE`, and nothing else deduplicates.

Counted from the cron expressions at `api/main.py:6596-6605`: premarket
`hour="7-9", minute="*/15"` and RTH `hour="9-15", minute="*/30"` — on the order
of **twenty calls per member per weekday**, bounded only by the shared 8/day cap.
⛔ Which means an armed path B can consume a member's ENTIRE daily insight budget
with duplicates of one unchanged flip, crowding out `daily_focus`, `stop_hit` and
every other kind. Reproduced, not fixed — a migration that fixed it would be
measuring the fix.

══════════════════════════════════════════════════════════════════════════════
⛔ F-S7-RC-2 — NEW: path B's prior label is a SUBSTRING match, not a word match
══════════════════════════════════════════════════════════════════════════════

`if r in last_text` over `summary_text.lower()`. `"chop"` is a substring of
"choppy" and "chopped", so a summary that never named a regime can still yield
`prior_label="chop"`. The five labels are also a **SECOND HAND-TYPED COPY** of
the vocabulary, inline at `voice_proactive_service.py:506`, not
`voice_regime_classifier.REGIMES`. Both are railed below, in ORDER, because path
B returns the FIRST label in that tuple order that appears in the text and
differs from the current one.

══════════════════════════════════════════════════════════════════════════════
⛔ NO `replay_fn` — the SIXTH distinct reason this programme has met
══════════════════════════════════════════════════════════════════════════════

`price-level` refuses because a trendline has no past; `event-proximity` because
a calendar date moves; `catalyst-match` because the candidate set is paid LLM
output. This one refuses because **the classifier is a 15-minute TTL cache
(`_TTL_SECONDS = 900`, `voice_regime_classifier.py:205`) over a morning-wire
push, and no prior `signals` dict is persisted anywhere** — the ledger stores
only `(label, confidence)` (`regime_snapshots.py:21-30`). A past cycle's vote
cannot be reconstructed, so "what would this predicate have said on Tuesday" has
no input at all. **FORWARD-ONLY.**

⛔ And the harness must never append to that ledger: `record_snapshot` writes on
every cycle, so a second writer would move the legacy rule's own `prev_label` and
the comparison would be measuring the harness. Railed in
`regime_change_compare`.

══════════════════════════════════════════════════════════════════════════════
✅ THE GATE FLAGS, RE-READ LIVE — AND THEY MAKE THE FINDINGS ABOVE ACTIVE
══════════════════════════════════════════════════════════════════════════════

The packet inherited a five-week-old flag reading and said *"re-read both live
before any line is written."* Read live on `web`, **2026-09-12**
(`railway variables --service web --kv`):

    AWARENESS_ENGINE_ENABLED=1        <- path A IS ARMED
    COMPASS_AUTOMATION_ENABLED=1      <- path B IS ARMED (and gates path A too)
    DISCORD_ALERT_WEBHOOK             <- SET (value not recorded here)

⛔⛔ **So none of this is hypothetical.** Both legacy emitters run in production
today, which makes F-S7-RC-3 a live condition rather than a latent one: an armed
path B re-queues the same unchanged flip on every window scan until the shared
8/day cap, and that cap is shared with `daily_focus`, `stop_hit` and every other
insight kind.

⛔⛔ **And F-S7-RC-4's third path is not merely capable of reaching Discord — it
is CONFIGURED to.** `DISCORD_ALERT_WEBHOOK` is set, and `add_alert` fires it for
any WARNING or CRITICAL alert. `regime_change` is CRITICAL. ⚠️ **"Regime alerts
are in-app only today" is therefore FALSE as a statement about the product**, and
anyone sizing the flip against it is sizing against two thirds of the picture.

══════════════════════════════════════════════════════════════════════════════
⚠️ WHAT STILL COULD NOT BE MEASURED
══════════════════════════════════════════════════════════════════════════════

1. **How often the label actually flips.** `awareness_regime_snapshots` was NOT
   opened. ⛔ This is the number that decides whether CP2 can observe anything at
   all, and it is deliberately still unmeasured: the production ledger lives on
   the pod, reading it means an exec against a live member-serving process, and
   that is outside the CP1-CP2 authorization. A local `C:\\data\\auth.db` read
   would have answered about a different database and been worse than nothing.
2. **Path B's population** — how many members have a voice-session summary.
3. **How often the shared 8/day cap is actually hit**, which is what decides how
   much of a member's insight budget F-S7-RC-3 is really consuming.

Every count this type produces at CP1-CP2 is a fact about harness fixtures, never
about members.
"""
from __future__ import annotations

import json as _json
from typing import Any, Optional

from api.services.alert_taxonomy import registry as _registry

TYPE_ID = "regime-change"

# ── the vocabulary ───────────────────────────────────────────────────────────
#: The five labels DEC-13's authority declares (`voice_regime_classifier.py:24`).
#: ⛔ Declared here rather than imported so the type module keeps NO legacy
#: import at CP1; `test_the_label_vocabulary_IS_the_classifiers` derives the five
#: FROM THAT FILE'S AST and fails if a sixth regime is added there.
REGIME_LABELS = ("bull_trend", "bull_correction", "distribution", "chop", "bear_trend")

#: ⛔ THE ORDER IS LOAD-BEARING FOR PATH B and is a SECOND, hand-typed copy in
#: the legacy code (`voice_proactive_service.py:506`). `maybe_emit_regime_shift`
#: returns the FIRST label in this order that appears in the last summary's text
#: and differs from the current label — so a reordering there changes which prior
#: label path B infers. Railed against that site's AST, in order.
SESSION_SUMMARY_SCAN_ORDER = REGIME_LABELS

# ── which emitter's prior-label authority this predicate declares ────────────
LEDGER = "ledger"
SESSION_SUMMARY = "session_summary"
PRIOR_LABEL_SOURCES = (LEDGER, SESSION_SUMMARY)

#: ⛔ F-S7-RC-4 — THE THIRD EMITTER, DECLARED AND DELIBERATELY NOT ABSORBED.
#: `api/services/alerts.py`'s legacy alert TYPE STRING for the brain's
#: market-phase transition, which broadcasts and reaches Discord today. It is a
#: different vocabulary from a different authority, DEC-13 does not cover it, and
#: nothing here absorbs it -- but it is one character from this module's TYPE_ID
#: and it lives in the same feed, so it is named rather than left to be
#: rediscovered. ⛔ It is NOT a `prior_label_source`, on purpose.
EXCLUDED_EMITTER_ALERTS_TYPE = "regime_change"

# ── what makes a member eligible ─────────────────────────────────────────────
STAKE_POSITIONS = "positions"
STAKE_WATCHLIST = "watchlist"
STAKE_EITHER = "either"
STAKE_ANY = "any"
STAKES = (STAKE_POSITIONS, STAKE_WATCHLIST, STAKE_EITHER, STAKE_ANY)

#: R4's own gate, from `rules.py:144-147`: an open position OR a watched symbol.
LEGACY_STAKE_LEDGER = STAKE_EITHER
#: ⭐ AND `any` IS NOT AN UNPOPULATED SHAPE HERE — it is what the OTHER emitter
#: does. `maybe_emit_regime_shift` applies no stake test whatsoever; its
#: eligibility is "has at least one voice-session summary", which is a property
#: of the SOURCE, not of the member's book. So the two legacy paths disagree on
#: this axis today and the schema has to be able to say both.
LEGACY_STAKE_SESSION_SUMMARY = STAKE_ANY

# ── ⛔⛔ THE TWO FIXED VALUES (see the module docstring, §"structural accident")
#: FIXED, not a default. `resolve_channels()` ignores any params-supplied list,
#: and PARAMS_SCHEMA below is DERIVED from this constant — so widening it edits
#: the schema that `alert_trigger_registry` persists at registration, which is a
#: visible schema change rather than an emergent one.
CHANNELS_FIXED = ("in_app",)

#: FIXED, and this is the direct mirror of `engine.py:241`'s `and
#: candidate.symbol`. A market-wide flip carries NO entity. A predicate given one
#: would make the away-delivery branch REACHABLE.
ENTITY_REF_FIXED: Optional[str] = None

#: The importance path B hard-codes (`voice_proactive_service.py:513`) — equal to
#: `awareness/engine.py:26`'s `_DELIVER_IMPORTANCE_FLOOR`. Recorded because the
#: ONLY thing keeping that fire out of a member's inbox is the symbol conjunct.
LEGACY_IMPORTANCE_SESSION_SUMMARY = 8


def resolve_channels(params: Optional[dict[str, Any]] = None) -> tuple:
    """The channels this type delivers on. ⛔ ALWAYS `CHANNELS_FIXED`.

    `params` is accepted and DELIBERATELY IGNORED: a caller that hands this a
    wider list gets the fixed value back, so a predicate cannot widen delivery
    without editing this module — which edits `PARAMS_SCHEMA`, which changes the
    persisted registration row. `test_channels_CANNOT_widen_without_a_schema_change`
    is the rail and it is mutation-proved.
    """
    return CHANNELS_FIXED


def resolve_entity_ref(params: Optional[dict[str, Any]] = None) -> Optional[str]:
    """⛔ ALWAYS `None`. Same contract as `resolve_channels`, for the field that
    actually switches `engine.py:241`'s away-delivery branch on."""
    return ENTITY_REF_FIXED


PARAMS_SCHEMA = {
    "labels": "list[string] | null -- which regime labels this predicate watches, "
              "matched against the label the market flipped TO (never the one it "
              "came from -- 'tell me when it goes to bear_trend' is the obvious "
              "first widening and the ambiguity is settled here rather than in an "
              "evaluator). The five are "
              + _json.dumps(list(REGIME_LABELS)) +
              ", DERIVED from voice_regime_classifier.REGIMES by AST and railed "
              "against it. null = any flip, which is what BOTH legacy emitters do "
              "today. Unpopulated, pinned because a live schema is expensive to "
              "widen",

    "min_confidence": "float | null -- gate on the CURRENT reading's confidence. "
                      "⚠️ confidence is the WINNER'S SHARE OF TOTAL VOTES "
                      "(voice_regime_classifier.py:196-199), NOT a probability, "
                      "and a label computed from an all-None signals dict still "
                      "carries one. null = no gate, and null is BOTH legacy "
                      "shapes: R4 only feeds confidence into its importance score "
                      "and path B ignores it entirely. ⛔ Pinning this field is "
                      "NOT authorization to route delivery on it -- the legacy "
                      "comment's 'add it back with a confidence gate' is a PRODUCT "
                      "decision and is out of scope for every checkpoint here",

    "stake": "string -- 'positions' | 'watchlist' | 'either' | 'any'. What makes a "
             "member eligible. ⛔ THE TWO LEGACY EMITTERS DISAGREE ON THIS AXIS: "
             "R4 is 'either' (an open position OR a watched symbol, "
             "awareness/rules.py:144-147, so an inactive account gets nothing), "
             "while maybe_emit_regime_shift applies NO stake test at all -- 'any'. "
             "Carried explicitly because a predicate's eligibility is the whole "
             "difference between the two populations",

    "prior_label_source": "string -- 'ledger' | 'session_summary'. ⛔⛔ THE FIELD "
                          "THAT MAKES THE TWO-EMITTER PROBLEM DECLARABLE RATHER "
                          "THAN ASSUMED. 'ledger' is R4, diffing against "
                          "awareness_regime_snapshots -- and note that the LEDGER "
                          "is also what SUPPRESSES a repeat (F-S7-RC-1: the 6h "
                          "cooldown the docstring promises never runs, because the "
                          "dedup_key is discarded and add_insight skips its "
                          "per-symbol query for a null symbol). 'session_summary' "
                          "is voice_proactive_service.maybe_emit_regime_shift, "
                          "diffing against the TEXT of the member's last "
                          "voice-session summary by substring -- which has no "
                          "ledger and therefore NO suppression at all (F-S7-RC-3). "
                          "A predicate cannot be built without choosing, and the "
                          "choice is visible in the row. ⛔ TWO VALUES, NOT "
                          "THREE: alerts.alert_regime_change (the brain's "
                          "market-PHASE transition, broadcast, Discord-bearing) "
                          "is a different authority DEC-13 does not name, and it "
                          "is EXCLUDED BY NAME here rather than forgotten -- see "
                          "F-S7-RC-4 and EXCLUDED_EMITTER_ALERTS_TYPE",

    "channels": "FIXED VALUE " + _json.dumps(list(CHANNELS_FIXED)) + " -- NOT a "
                "default and NOT member-editable. resolve_channels() ignores "
                "anything params supply. ⛔ The in-app-only property of a regime "
                "flip today is a STRUCTURAL ACCIDENT, not a rule: "
                "awareness/engine.py:241 gates away-delivery on `importance >= "
                "_DELIVER_IMPORTANCE_FLOOR and candidate.symbol`, and regime flips "
                "carry symbol=None, so the branch is unreachable BY CONSTRUCTION. "
                "Pinned as a fixed value so widening delivery is a visible schema "
                "change (this string is persisted into "
                "alert_trigger_registry.params_schema) rather than something a "
                "later entity_scope quietly acquires",

    # ⚰️ THIS STRING USED TO HARD-TYPE "null" WHILE `channels` DERIVED ITS VALUE,
    # and the M3 mutation caught it: setting ENTITY_REF_FIXED = "SPY" left the
    # schema still saying `null`, so a widening of the field that actually
    # switches away-delivery on would NOT have shown up in the persisted
    # registration row. Derived now, like its sibling -- one authority per value.
    "entity_ref": "FIXED VALUE " + _json.dumps(ENTITY_REF_FIXED) + " -- a regime "
                  "flip is MARKET-WIDE and carries no "
                  "entity. ⛔ This is the direct mirror of engine.py:241's second "
                  "conjunct: an S7 predicate given an entity_scope symbol makes "
                  "the away-delivery branch REACHABLE and silently acquires email "
                  "and Discord to every position holder on every flip. "
                  "resolve_entity_ref() always returns None",
}

# ⛔ NO `replay_fn`. The classifier is a 15-minute TTL cache over a morning-wire
# push and no prior `signals` dict is persisted anywhere -- see the module
# docstring. FORWARD-ONLY.


def register(*, db_path: str | None = None) -> None:
    """Idempotent -- call at process start.

    ⛔ §2a ITEM 3 -- *what calls this evaluator, on what trigger, and which test
    fails if that wire is cut?* At CP1-CP2 the honest answer is **the comparison
    harness does**, directly, over predicates the harness itself arms; there is no
    scheduler entry and no flag, deliberately. `regime_change_compare.observe` is
    the only caller of `would_fire`, and
    `test_the_harness_is_the_only_caller_of_would_fire` is the rail that fails if
    that stops being true. The scheduler wire and its rail arrive with CP3 and
    need a new approval line.
    """
    _registry.register_trigger_type(TYPE_ID, PARAMS_SCHEMA, module=__name__, db_path=db_path)


# ─────────────────────────────────────────────────────────────────────────────
# CHECKPOINT 2 — the dark evaluator
# ─────────────────────────────────────────────────────────────────────────────

def resolve_confidence(raw: Any) -> float:
    """R4's own coercion, restated: `0.5 if confidence is None else float(...)`.

    ⛔ NEVER `or`. An explicit `0.0` is a legitimate zero-confidence reading and
    `or` would silently promote it to the 0.5 default -- the exact
    chosen-with-nullish / consumed-with-truthiness shape. `rules.py:137-140`
    already gets this right and the mirror must not un-fix it.
    """
    return 0.5 if raw is None else float(raw)


def prior_label(params: dict[str, Any], *, current_label: Optional[str],
                ledger_label: Optional[str] = None,
                last_summary_text: Optional[str] = None) -> Optional[str]:
    """The prior label THIS PREDICATE'S declared source would report.

    ⛔ Two emitters, two authorities, and the predicate names which one. There is
    no "the" prior label in this system and pretending there is would be the
    assumption `prior_label_source` exists to remove.

    `ledger`          -- whatever `regime_snapshots.get_last_label()` returned.
    `session_summary` -- path B's scan, reproduced exactly: lowercase the last
                         summary's text, walk `SESSION_SUMMARY_SCAN_ORDER`, and
                         return the FIRST label that is a SUBSTRING of the text
                         and differs from the current label.

    ⛔ THE SUBSTRING MATCH IS REPRODUCED, NOT FIXED (F-S7-RC-2). `"chop" in
    "the tape was choppy"` is True, so a summary that never named a regime can
    still produce a prior label. A dark rule that used word boundaries would
    disagree with the legacy exactly where the legacy is wrong, and CP2 measures
    the migration, not the bug.

    ⛔ `last_summary_text is None` means the member has NO summary at all, which
    is path B's `if not summaries: return 0` -- distinct from a summary that
    mentions no label.
    """
    src = params.get("prior_label_source")
    if src == LEDGER:
        return ledger_label or None
    if src == SESSION_SUMMARY:
        if last_summary_text is None:
            return None
        text = str(last_summary_text).lower()
        for label in SESSION_SUMMARY_SCAN_ORDER:
            if label in text and label != current_label:
                return label
        return None
    return None


def stake_satisfied(params: dict[str, Any], *, has_positions: bool,
                    has_watch: bool) -> bool:
    """R4's eligibility gate, generalised over the four declared stakes."""
    stake = params.get("stake") or LEGACY_STAKE_LEDGER
    if stake == STAKE_ANY:
        return True
    if stake == STAKE_POSITIONS:
        return bool(has_positions)
    if stake == STAKE_WATCHLIST:
        return bool(has_watch)
    if stake == STAKE_EITHER:
        return bool(has_positions or has_watch)
    return False


def would_fire(params: dict[str, Any], *, current_label: Optional[str],
               confidence: Any = None,
               ledger_label: Optional[str] = None,
               last_summary_text: Optional[str] = None,
               has_positions: bool = False,
               has_watch: bool = False) -> bool:
    """The DARK rule. Would this predicate alert this member on THIS reading?

    ⛔ DELIBERATELY THE LEGACY RULE, NOT AN IMPROVED ONE. CP1-CP2 measure the
    migration; a rule that fixes something while migrating measures the fix.

    ⭐ IT RETURNS A BOOLEAN, and unlike `catalyst-match` that is the right grain
    here: both legacy emitters produce AT MOST ONE insight per member per cycle
    (R4 returns a one-element list; path B `return`s inside its loop on the first
    match). There is no per-ticker fan-out to collapse, because there is no
    ticker -- the fire is market-wide by construction.

    ⛔ WHAT IS NOT MODELLED, and it is named in BLIND_SPOTS rather than silently
    assumed away: `add_insight`'s shared `MAX_INSIGHTS_PER_USER_PER_DAY = 8`. A
    real legacy fire can be suppressed by an unrelated `stop_hit` earlier that
    day, and this evaluator cannot see that.
    """
    if params.get("prior_label_source") not in PRIOR_LABEL_SOURCES:
        # A predicate with no declared authority evaluates to nothing rather than
        # raising -- the same call F-S7-2 made for an unreachable shape. Choosing
        # a default here would be the assumption the field exists to prevent.
        return False

    prev = prior_label(params, current_label=current_label,
                       ledger_label=ledger_label,
                       last_summary_text=last_summary_text)

    # R4's flip test, verbatim in shape (`rules.py:141`).
    if not current_label or not prev or current_label == prev:
        return False

    if not stake_satisfied(params, has_positions=has_positions, has_watch=has_watch):
        return False

    wanted = params.get("labels")
    if wanted and current_label not in set(wanted):
        return False

    floor = params.get("min_confidence")
    if floor is not None and resolve_confidence(confidence) < float(floor):
        return False

    return True


def predicate_fingerprint(params: dict[str, Any]) -> tuple:
    """What a change to the predicate's FIRING IDENTITY looks like.

    ⛔ When this tuple changes the open span CLOSES and its counts are discarded
    into `not_comparable` -- never carried forward as agreement. A parameter
    rewrite makes the pre-change ticks un-attributable to the migration, exactly
    as a moved anchor does for `price-level`.

    ⛔ `prior_label_source` IS IN THE TUPLE and is the most important member of
    it: flipping it does not narrow the same question, it asks a DIFFERENT
    EMITTER'S question. The two fixed values are in it too, so that a future
    widening of either cannot inherit a span accumulated while they were pinned.
    """
    labels = params.get("labels")
    floor = params.get("min_confidence")
    return (
        tuple(sorted(str(x) for x in labels)) if labels else None,
        None if floor is None else float(floor),
        params.get("stake") or LEGACY_STAKE_LEDGER,
        params.get("prior_label_source"),
        resolve_channels(params),
        resolve_entity_ref(params),
    )
