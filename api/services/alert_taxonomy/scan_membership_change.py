"""GATE-S7-SCAN-MEMBERSHIP-CHANGE — S7 trigger type 4, the FOURTH absorption.

⛔ Approved for CHECKPOINTS 1-2 ONLY (owner, 2026-09-13). CP1 registers the type
and pins the schema. CP2 adds a dark evaluator and a forward-only harness over
HARNESS-ARMED predicates. **No delivery. No projection of member rows. No legacy
change. No read of `scan_hits`.** CP3 needs a new approval line.

──────────────────────────────────────────────────────────────────────────────
WHAT THIS ABSORBS — and it is COMPLETE, WIRED AND LIVE
──────────────────────────────────────────────────────────────────────────────

`api/services/screener/screen_alerts.py` (261 lines) already tells a member when
a name enters or leaves one of their screens. This is an ABSORPTION, not a new
capability, and the completion plan's sizing was written without it:

| | |
|---|---|
| the diff | `screen_alerts.diff_for(def_hash, tf)` -> `(as_of, entered, exited)` |
| driver | `screen_alerts.run_nightly(deliver=None, tf=None)` -> a receipt dict |
| schedule | `api/main.py`, job id `screener_screen_alerts`, `CronTrigger(hour=scan_evaluator.SWEEP_HOUR_ET, minute=SWEEP_MINUTE_ET + 10)` = **05:10 ET**, `max_instances=1` |
| gate | `scan_evaluator.enabled() and os.environ.get("SCREEN_ALERTS_ENABLED", "1") != "0"` |
| delivery | `watchlist_alert_service.deliver_alert_payload` = in-app + email + Discord |
| member doors | `GET`/`POST /api/screener/alerts`, `DELETE /api/screener/alerts/{def_hash}` — all `Depends(require_paid)` |

⛔ **THE GATE WAS RE-READ LIVE BEFORE THIS SCHEMA WAS PINNED**, because a code
default is not a configuration (`catalyst-match` §8b, twice in one day).
`railway variables --service web --kv`, 2026-09-12, 236 variables enumerated:

    SCAN_SWEEP_ENABLED=1          <- SET, and the code default is "0"
    SCREEN_ALERTS_ENABLED         <- UNSET, and the code default is ON

Control on the absence: the same enumeration returns 3 `SCREEN*` variables
(`SCREENER_ANALYST_PASS_ENABLED`, `SCREENER_LIVE_TIER_ENABLED`,
`SCREEN_BACKTEST_ENABLED`) and `CATALYST_MUSTKNOW_GRADES`, so it can see a
variable that is there. **Both gates are open: the legacy nightly job is
scheduled in production.**

──────────────────────────────────────────────────────────────────────────────
⛔⛔ THE LEGACY SHAPES, DERIVED BY AST FROM THE DDL — reported BEFORE pinning
──────────────────────────────────────────────────────────────────────────────

Read out of `screen_alerts._SCHEMA` by parsing the module, never from the gate
packet's prose. `tests/..._schema.py::test_the_legacy_shapes_are_DERIVED_...`
re-derives them every run, so a column added tomorrow turns this red rather than
letting the record drift.

    screen_alert_subs
        user_id     TEXT NOT NULL
        def_hash    TEXT NOT NULL
        def_id      TEXT NOT NULL
        name        TEXT NOT NULL
        mode        TEXT NOT NULL
        created_at  INTEGER NOT NULL
        PRIMARY KEY (user_id, def_hash)

    screen_alerts_fired
        user_id     TEXT NOT NULL
        def_hash    TEXT NOT NULL
        as_of       INTEGER NOT NULL
        fired_at    INTEGER NOT NULL
        entered     INTEGER NOT NULL
        exited      INTEGER NOT NULL
        PRIMARY KEY (user_id, def_hash, as_of)

    MODES = ('entry', 'exit', 'both')   MAX_NAMED = 12   MAX_PER_USER = 6
    scan_store.SCAN_JOIN_TF = 'D'

⚠️ **ONE NARROWING IS INVISIBLE IN THE TYPE'S NAME AND IS PINNED BELOW.**
`screen_alert_subs`'s PK is `(user_id, def_hash)`, so **one member cannot hold
two subscriptions to one definition with different modes** — `subscribe` is
`INSERT OR REPLACE`, so asking for `exit` on a screen you already watch for
`entry` silently REPLACES the first. An S7 predicate carries no such constraint,
so at the flip that narrowing either has to be re-imposed deliberately or a
member's two predicates on one screen become two alerts where they used to get
one. Recorded here because nothing about "scan membership change" says it.

✅ No divergence from the gate packet's prose was found in any of the above.

──────────────────────────────────────────────────────────────────────────────
⛔⛔ FINDING A — TWO CONSECUTIVE CYCLES ARE RETAINED BY THE ABSENCE OF A CALLER
──────────────────────────────────────────────────────────────────────────────

`scan_store.prune(before_as_of)` exists (`scan_store.py`, stripped line 200) and
deletes strictly before a horizon from **both** `scan_hits` and `scan_coverage`.
**It has ZERO callers.** Measured this pass with a prose-stripped AST search over
`api/**` — 1,214 files parsed, 0 unparsable:

    scan_store.prune   0 occurrences
    .prune(            3 call sites, ALL elsewhere (api/main.py 1032/1344/3634)
    prune(            39 occurrences across 20 modules

**CONTROL — the search can see a real `.prune(` call**: three of them, and the
stripper still finds `def record_hits` in `scan_store.py` while a docstring-only
sentence from the same file ("a trader would act on it") survives in the RAW text
and is GONE from the stripped text.

⛔ **So the finding is not "retention is fine".** The diff's input is guaranteed
by the ABSENCE of a caller, not by a policy — and `prune`'s own docstring says it
is EXPECTED to be wired (`alert_shadow_fires`: 53 bytes a row, no prune, 279 GB/yr;
a `scan_hits` row is 3.4x heavier). The day somebody wires it, the previous
session can vanish and the failure is silent in the flattering direction:
`diff_for` returns `(None, [], [])` and `run_nightly` counts it `no_previous` —
a member simply stops being told, with no error.

⭐ **THIS TYPE THEREFORE REFUSES TO CALL THAT STATE QUIET.** `would_fire` returns
`NOT_COMPARABLE` with `reason=REASON_NO_PREVIOUS`, which is a DIFFERENT answer
from `REASON_QUIET`, and the rails are in
`tests/test_alert_taxonomy_scan_membership_change_schema.py`:
the zero-callers measurement with its control, a two-session/one-session pair
driven against a real temp store, and a prune that actually removes the previous
session and is caught doing it.

⛔ CP1 MUST NOT EDIT `scan_store.py` (gate §6): flow-worker RUNS that module and
will not redeploy for a change to it, so an edit there leaves flow-worker on the
old copy with every test green. The retention guarantee is asserted FROM `tests/`.

──────────────────────────────────────────────────────────────────────────────
⛔⛔ FINDING B — THE PREVIOUS SESSION COMES FROM `scan_coverage`, NEVER `scan_hits`
──────────────────────────────────────────────────────────────────────────────

A swept session that matched NOTHING writes a coverage row and **zero** hits
rows. A hits-derived "previous session" therefore SKIPS every quiet night and
diffs tonight against some older, busier one — reporting every long-standing
member of the screen as newly ENTERED. That is a mass false alert on the night
nothing happened, and it is the failure `screen_alerts.py:25-32` and
`scan_store.recent_covered_as_ofs`'s docstring each state independently.

`PREVIOUS_SESSION_SOURCE` below is a CONSTANT and not a parameter, deliberately:
making it configurable would invite exactly the value that is wrong. Two rails:

  * `would_fire` REFUSES a `hits_by_as_of` mapping that omits a session named in
    `covered_sessions`, rather than treating the missing key as "no hits". A
    quiet session must be DECLARED as an empty list — a caller who assembled the
    map out of `scan_hits` alone drops that key and gets a loud
    `REASON_UNDECLARED_SESSION`, never a silent agreement.
  * a fixture with a QUIET SESSION IN THE MIDDLE, driven against the real
    `scan_store`, which demonstrates the counterfactual: the hits-derived
    previous session reports every long-standing member as ENTERED, and the
    coverage-derived one reports nothing.

──────────────────────────────────────────────────────────────────────────────
⛔ NO `replay_fn` — a FIFTH distinct reason, and it is this type's own
──────────────────────────────────────────────────────────────────────────────

`price-level` refuses replay because a trendline has no past; `event-proximity`
because a calendar date moves; `catalyst-match` because an LLM-graded row cannot
be re-synthesised; `position-risk` because the price cache keeps no history.
This one refuses because **a past session's hit set is retained only until
somebody wires a prune nobody has written yet, and `coverage(...) is None` means
"the sweep never ran" — which after a prune is FALSE.** A replay over the
surviving window would silently answer a different question from the one asked,
and `scan_store.prune`'s docstring already forbids the arithmetic form of it:
"A CLAIM SURFACE MUST NOT RE-DERIVE A HIT RATE OVER THE SURVIVING WINDOW AND
PRESENT IT AS THE WHOLE." **FORWARD-ONLY, four outcomes, never a pass rate.**

──────────────────────────────────────────────────────────────────────────────
⚠️ WHAT COULD NOT BE MEASURED THIS PASS
──────────────────────────────────────────────────────────────────────────────

`screener.db` was not opened. So: how many `screen_alert_subs` rows exist (i.e.
whether this absorption has any members at all), how many sessions
`scan_coverage` actually holds per definition, whether the nightly sweep is
currently succeeding, and the `screen_alerts_fired` row count are ALL UNKNOWN.
⛔ The first of those decides whether CP2's comparison can observe anything, and
a dark run over zero subscriptions prints four zeroes and reads like agreement —
which is why `report()` LEADS with what it observed.
"""
from __future__ import annotations

from typing import Any, Iterable, Mapping, Optional

from api.services.alert_taxonomy import registry as _registry

TYPE_ID = "scan-membership-change"

# ── direction, and the legacy vocabulary it maps onto ────────────────────────
#: S7's spelling (SPEC-S7 §5.2's `params` shape, which is CORRECT — only its
#: SOURCE attribution was wrong; see §1c of the gate and the spec correction
#: shipped with this checkpoint).
DIRECTION_ENTERED = "entered"
DIRECTION_LEFT = "left"
DIRECTION_EITHER = "either"
DIRECTIONS = (DIRECTION_ENTERED, DIRECTION_LEFT, DIRECTION_EITHER)

#: `screen_alerts.MODES`, restated. ⛔ NOT A SECOND AUTHORITY — the schema test
#: re-derives this tuple from `screen_alerts.py` by AST and fails if the two ever
#: disagree, the same shape `catalyst_match.VALID_GRADES` uses.
LEGACY_MODES = ("entry", "exit", "both")

#: The mapping the flip has to honour in both directions. A predicate speaks
#: S7's vocabulary; a subscription row speaks the legacy's.
MODE_BY_DIRECTION = {
    DIRECTION_ENTERED: "entry",
    DIRECTION_LEFT: "exit",
    DIRECTION_EITHER: "both",
}
DIRECTION_BY_MODE = {v: k for k, v in MODE_BY_DIRECTION.items()}

# ── the legacy's own shapes, pinned as FACTS ABOUT THE INCUMBENT ─────────────
#: ⛔ NOT S7 PARAMETERS. A per-run cap is a DELIVERY policy and belongs to
#: `delivery.py`'s own approval line, so these are recorded here (so the flip
#: cannot lose them by forgetting they existed) and are deliberately absent from
#: `PARAMS_SCHEMA`.
LEGACY_MAX_NAMED = 12        # symbols named in one message before "+N more"
LEGACY_MAX_PER_USER = 6      # alerts one member can receive in one nightly run

#: `scan_store.SCAN_JOIN_TF`. The legacy path takes exactly one value; it is
#: pinned as a FIELD anyway because it is the shape a later type will want to
#: change, and a value that is only ever one thing is the value nobody notices
#: becoming two.
LEGACY_TIMEFRAME = "D"

#: ⛔⛔ FINDING B, AS A CONSTANT AND NOT A PARAMETER. See the module docstring.
PREVIOUS_SESSION_SOURCE = "scan_coverage"
FORBIDDEN_SESSION_SOURCE = "scan_hits"

#: ⛔ FINDING A. The diff needs exactly this many covered sessions, and fewer is
#: `not_comparable`, never "quiet".
SESSIONS_REQUIRED = 2

#: The PK of `screen_alerts_fired`: one alert per member per definition per
#: SESSION, however many names moved. Pinned as a field because changing it
#: silently multiplies (or silences) what a member receives.
DEDUP_GRAIN = "user_definition_session"

# ── the evaluator's answers ──────────────────────────────────────────────────
#: ⛔ FOUR DISTINGUISHABLE REASONS, AND THE FIRST TWO ARE THE WHOLE POINT.
#: "the window that would let us compare is gone" and "we compared and nothing
#: moved" are different facts about a member's night, and a rule that returned a
#: bare `False` for both would make a broken sweep look like a quiet market.
REASON_NO_PREVIOUS = "no_previous"            # < SESSIONS_REQUIRED covered sessions
REASON_UNDECLARED_SESSION = "undeclared_session"   # finding B's structural refusal
REASON_QUIET = "quiet"                        # compared; nothing moved in this direction
REASON_DEDUPED = "deduped"                    # already fired for this (member, def, session)
REASON_FIRES = "fires"
REASONS = (REASON_NO_PREVIOUS, REASON_UNDECLARED_SESSION, REASON_QUIET,
           REASON_DEDUPED, REASON_FIRES)

#: The reasons that are NOT a comparable observation — the diff could not be
#: taken at all, so neither side's silence means anything.
NOT_COMPARABLE_REASONS = (REASON_NO_PREVIOUS, REASON_UNDECLARED_SESSION)


PARAMS_SCHEMA = {
    "definition_id": "string -- the screen. Maps to the legacy `def_hash` "
                     "(`screen_alert_subs.def_hash`). ⚠️ THE LEGACY PK IS "
                     "(user_id, def_hash), so one member cannot hold two "
                     "subscriptions to one definition with different modes — "
                     "`subscribe` is INSERT OR REPLACE and the second one "
                     "silently wins. An S7 predicate carries no such "
                     "constraint, so that narrowing has to be re-imposed "
                     "deliberately at the flip or a member gets two alerts "
                     "where they used to get one",

    "direction": "string -- 'entered' | 'left' | 'either'. The legacy column is "
                 "`screen_alert_subs.mode` with vocabulary ('entry','exit',"
                 "'both'); the mapping is MODE_BY_DIRECTION and is pinned "
                 "beside this schema rather than restated at a call site",

    "timeframe": "string -- the sweep's timeframe, `scan_store.SCAN_JOIN_TF` = "
                 "'D'. The legacy path takes exactly ONE value and passes it to "
                 "`diff_for`; pinned as a FIELD anyway because it is the shape a "
                 "later type will want to change, and a field that is only ever "
                 "one value is the one nobody notices becoming two",

    "dedup_grain": "string -- 'user_definition_session', the PRIMARY KEY of "
                   "`screen_alerts_fired` (user_id, def_hash, as_of). ⛔ ONE "
                   "ALERT PER MEMBER PER DEFINITION PER SESSION, however many "
                   "names moved — which is why this type's comparison counts "
                   "ALERTS and reports symbol drift separately, rather than "
                   "counting names and calling each one an alert",
}

# ⛔ NO `replay_fn`. See the module docstring — a past session's hit set survives
# only until somebody wires a prune nobody has written, and `coverage() is None`
# means "never swept", which after a prune is false.


def register(*, db_path: str | None = None) -> None:
    """Idempotent — call at process start.

    ⛔ §2a ITEM 3 — *what calls this evaluator, on what trigger, and which test
    fails if that wire is cut?* At CP1-CP2 the honest answer is **the comparison
    harness does**, directly, over predicates the harness itself arms; there is
    no scheduler entry and no flag, deliberately.
    `scan_membership_change_compare.observe` is the only caller, and
    `test_the_harness_is_the_only_caller_of_would_fire` is the rail that fails if
    that stops being true. The scheduler wire and its rail arrive with CP3 and
    need a new approval line.
    """
    _registry.register_trigger_type(TYPE_ID, PARAMS_SCHEMA, module=__name__, db_path=db_path)


# ─────────────────────────────────────────────────────────────────────────────
# CHECKPOINT 2 — the dark evaluator
# ─────────────────────────────────────────────────────────────────────────────

def mode_for(direction: Any) -> Optional[str]:
    """S7's `direction` as the legacy's `mode`. ⛔ ONE declaration of the mapping.

    Returns `None` for a direction outside the vocabulary rather than raising:
    a predicate naming a direction that does not exist evaluates to nothing, the
    same call F-S7-2 made for `trendline`.
    """
    return MODE_BY_DIRECTION.get(direction)


def wants(direction: Any) -> tuple:
    """`(wants_entered, wants_left)` for a direction. The legacy expression, restated:

        want_in  = entered if mode in ("entry", "both") else []
        want_out = exited  if mode in ("exit",  "both") else []
    """
    mode = mode_for(direction)
    if mode is None:
        return (False, False)
    return (mode in ("entry", "both"), mode in ("exit", "both"))


def _clean(symbols: Iterable[Any]) -> set:
    return {str(s).strip().upper() for s in (symbols or ()) if str(s or "").strip()}


def diff(covered_sessions: Iterable[Any],
         hits_by_as_of: Mapping[Any, Iterable[Any]]) -> dict[str, Any]:
    """`screen_alerts.diff_for`'s decision, over sessions HANDED IN.

    ⛔ THIS READS NO STORE. CP1-CP2 project no member row and touch no screener
    table; the caller supplies the two sessions and their hit sets, and the rails
    drive the REAL `scan_store` to prove those inputs are what the legacy path
    would have produced.

    ⛔⛔ `covered_sessions` MUST have come from `scan_coverage` — finding B. The
    one thing this function can enforce structurally is that a session it is told
    was SWEPT is also DECLARED in the hit map: a caller who assembled that map out
    of `scan_hits` alone drops the quiet session's key entirely, and treating a
    missing key as "no hits" would make that caller look correct. A quiet session
    must say so with an empty list.
    """
    sessions = [int(s) for s in (covered_sessions or ())]
    if len(sessions) < SESSIONS_REQUIRED:
        return {"as_of": None, "prev_as_of": None, "entered": [], "exited": [],
                "reason": REASON_NO_PREVIOUS}

    now_as_of, prev_as_of = sessions[0], sessions[1]
    declared = {int(k) for k in (hits_by_as_of or {})}
    missing = [s for s in (now_as_of, prev_as_of) if s not in declared]
    if missing:
        return {"as_of": None, "prev_as_of": None, "entered": [], "exited": [],
                "reason": REASON_UNDECLARED_SESSION, "undeclared": sorted(missing)}

    lookup = {int(k): v for k, v in hits_by_as_of.items()}
    now = _clean(lookup[now_as_of])
    prev = _clean(lookup[prev_as_of])
    return {"as_of": now_as_of, "prev_as_of": prev_as_of,
            "entered": sorted(now - prev), "exited": sorted(prev - now),
            "reason": None}


def would_fire(params: dict[str, Any], *,
               covered_sessions: Iterable[Any],
               hits_by_as_of: Mapping[Any, Iterable[Any]],
               already_fired: Iterable[Any] = ()) -> dict[str, Any]:
    """The DARK rule. Would this predicate alert its member tonight, and about what?

    ⛔ DELIBERATELY THE LEGACY RULE, NOT AN IMPROVED ONE. CP1-CP2 measure the
    migration; a rule that fixes something while migrating measures the fix.

    ⭐ IT RETURNS A DECISION, NOT A BOOLEAN AND NOT A BARE LIST, and both halves
    are forced by the legacy shape. The legacy dedups at `(user_id, def_hash,
    as_of)`, so **one session is one alert however many names moved** — a
    per-name return would count five names as five alerts. But the message NAMES
    the symbols, so an alert that fires on both sides carrying different names is
    a real difference, and a bare boolean could not see it. The decision carries
    both.

    ⛔ AND THE `reason` IS PART OF THE ANSWER. `no_previous` is not `quiet`: the
    first says the window that would let us compare is gone (finding A), the
    second says we compared and nothing moved. A rule that collapsed them would
    make a broken sweep and a still market the same observation.

    `already_fired` models `screen_alerts_fired` — the `as_of` values this member
    has already been alerted about for this definition.
    """
    want_in, want_out = wants(params.get("direction"))
    d = diff(covered_sessions, hits_by_as_of)

    if d["reason"] in NOT_COMPARABLE_REASONS:
        return {"fires": False, "as_of": None, "entered": [], "exited": [],
                "named": [], "reason": d["reason"],
                "undeclared": d.get("undeclared", [])}

    entered = list(d["entered"]) if want_in else []
    exited = list(d["exited"]) if want_out else []
    named = ([f"{DIRECTION_ENTERED}:{s}" for s in entered]
             + [f"{DIRECTION_LEFT}:{s}" for s in exited])

    if not named:
        # ⛔ SILENCE IS A RESULT, and it is the legacy's own (`skipped_quiet`).
        return {"fires": False, "as_of": d["as_of"], "entered": [], "exited": [],
                "named": [], "reason": REASON_QUIET}

    fired = {int(a) for a in (already_fired or ())}
    if d["as_of"] in fired:
        return {"fires": False, "as_of": d["as_of"], "entered": entered,
                "exited": exited, "named": named, "reason": REASON_DEDUPED}

    return {"fires": True, "as_of": d["as_of"], "entered": entered,
            "exited": exited, "named": named, "reason": REASON_FIRES}


def predicate_fingerprint(params: dict[str, Any]) -> tuple:
    """What a change to the predicate's FIRING IDENTITY looks like.

    ⛔ A parameter rewrite makes the pre-change ticks un-attributable to the
    migration, exactly as a moved anchor does for `price-level` and a moved
    calendar date does for `event-proximity`. When this tuple changes, the open
    span CLOSES and its counts are discarded into `not_comparable` — never
    carried forward as agreement.

    ⛔ `definition_id` IS IN THE TUPLE and it is the load-bearing member: a
    predicate re-pointed at a different screen is a different question wearing
    the same predicate id, and its old ticks describe a screen nobody is watching
    any more. `dedup_grain` is NOT — it is pinned, not configurable, and does not
    decide whether tonight's diff is non-empty.
    """
    return (
        (str(params.get("definition_id")).strip() if params.get("definition_id") else None),
        params.get("direction"),
        params.get("timeframe") or LEGACY_TIMEFRAME,
    )
