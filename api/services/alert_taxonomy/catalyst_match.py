"""GATE-S7-CATALYST-MATCH — S7 trigger type 3, the THIRD absorption.

⛔ Approved for CHECKPOINTS 1–2 ONLY (owner, 2026-09-12). CP1 registers the type
and pins the schema. CP2 adds a dark evaluator and a forward-only harness over
HARNESS-ARMED predicates. **No delivery. No projection of member rows. No legacy
change.** CP3 needs a new approval line.

──────────────────────────────────────────────────────────────────────────────
WHAT THIS ABSORBS — read from the code, not from the type's name
──────────────────────────────────────────────────────────────────────────────

`api/services/catalyst/engine.py`, and it is **TWO firing rules sharing ONE
dedup table**, not one:

| | rule A — watchlist | rule B — must-know |
|---|---|---|
| function | `_fire_catalyst_alerts` | `_fire_mustknow_alerts` |
| gate | `CATALYST_ALERTS_ENABLED`, default **ON** | `CATALYST_MUSTKNOW_ALERTS_ENABLED`, default **OFF** |
| cohort | every user with a watchlist row | **admins only** (`role='admin'`) |
| condition | the ticker is on the member's watchlist | the row's `grade` is in `CATALYST_MUSTKNOW_GRADES` (default `A,B`) |
| needs a watchlist? | yes | **no** — that is its entire point |
| delivery | `watchlist_alert_service.deliver_alert_payload` | the same function |

Dedup for BOTH: `catalyst_alerts_fired`, PK `(user_id, ticker, market_date)`, in
`/data/catalysts.db` (`store.try_record_alert`, an `INSERT` + `IntegrityError`
so it is atomic rather than check-then-write).

──────────────────────────────────────────────────────────────────────────────
⛔⛔ F-S7-CM-1 — FIVE SHAPES THE CODE ACTUALLY HAS, AND THREE ARE SURPRISES
──────────────────────────────────────────────────────────────────────────────

**1. THE TWO RULES SHARE A DEDUP KEY, SO THEY SUPPRESS EACH OTHER.** `run()`
calls `_fire_catalyst_alerts` first and `_fire_mustknow_alerts` second, and both
call `try_record_alert(user_id, ticker, market_date)`. For an ADMIN who also
watches the name, the watchlist alert wins and the must-know alert for that name
is silently skipped that day — the member gets the *watchlist* wording for a
grade-A catalyst. ⚠️ That is not a bug to fix during a migration; it is
behaviour to REPRODUCE, and a dark rule that fired both would read as
`new_only` on every admin's watchlist.

**2. THE CANDIDATE SET IS `displayed`, NOT `top_12`.** Both call sites pass
`displayed` — the ranked, grade-C-excluded rows — and the comment above them says
why in the code's own words: *"a grade-C row hidden from the table shouldn't
trigger an alert"*. A rule built against the selection output rather than the
display output would alert on names no member can see.

**3. ⛔⛔ `catalyst_type` IS UNCONSTRAINED MODEL OUTPUT. THERE IS NO CLOSED
VOCABULARY, ONLY A PROMPT.** `synthesize.py`'s prompt lists fifteen labels —
Earnings, M&A, FDA, Analyst, Contract, Guidance, Product, Legal, Insider, Index,
Offering, Momentum, Sector-wide, Flow, None — and then the parser does:

        "catalyst_type": (parsed.get("catalyst_type") or None),

with **no normalisation at all**, two lines under a `grade` that DOES get
`_normalize_grade`. So the fifteen are a convention the model is asked to follow,
not a contract the code enforces, and the column can hold anything the model
emits. ⭐ This is the `line`-alert_type discovery of F-S7-4 one level up: the
narrow reading is *"fifteen types, pin them as an enum"*, and it would have been
wrong the first time a model returned `FDA Approval` instead of `FDA`.
⛔ `catalyst_types` in the schema below is therefore an OPEN list of strings,
matched case-insensitively, and the fifteen are recorded as a CONVENTION.

**4. `tag` IS closed and deterministic, and is a different axis from `grade`.**
`tagging.py` assigns exactly one of `Earnings > Catalyst > Gapper > News` by
rule, never by model. A predicate may filter on it safely.

**5. THE MEMBER SET IS `watchlists JOIN watchlist_items` AND NOTHING ELSE.**
`_collect_user_watchlist_tickers`'s own docstring says *"any watchlist or flagged
ticker"* — the flagged list IS a `watchlists` row (`is_flagged_list`), so that
half is true. ⚠️ But the **seven colour-tag auto-lists (`ticker_tags`) are not in
that query**, nor are J2 positions or UCT20. A member who tags a name gold and
never adds it to a list is invisible to this alert. `member_set` is pinned below
so the narrowing is DETECTABLE rather than assumed.

──────────────────────────────────────────────────────────────────────────────
⛔ NO `replay_fn` — a third distinct reason, and the strongest of the three
──────────────────────────────────────────────────────────────────────────────

`price-level` refuses replay because a trendline has no past. `event-proximity`
refuses because a calendar date moves. This one refuses because **the candidate
set is the output of an LLM synthesis pass behind a cost cap and a
skip-if-stable hash**, cut by a quality gate that is itself tuned between runs.
Asking "would this have fired on Tuesday" re-runs today's gate over a stored row
whose `grade` was written by a model call that cost real money and will not be
made again. The answer would be about today's configuration, not Tuesday's
behaviour. **FORWARD-ONLY, and a predicate parameter change RESETS THE CLOCK.**

──────────────────────────────────────────────────────────────────────────────
⚠️ WHAT COULD NOT BE MEASURED THIS PASS
──────────────────────────────────────────────────────────────────────────────

A read-only probe of production `/data/catalysts.db` — the histogram of real
`catalyst_type` and `grade` values, and the row count in `catalyst_alerts_fired`
— was attempted and **refused by tooling policy**, so every shape above is
derived from source only. ⛔ That is precisely why `catalyst_types` is pinned
OPEN rather than as an enum: the one check that could have told us whether the
model stays inside its fifteen labels is the one that did not run, and an enum
guessed from a prompt is the F-S7-4 mistake made deliberately.
"""
from __future__ import annotations

from typing import Any, Iterable, Optional

from api.services.alert_taxonomy import registry as _registry

TYPE_ID = "catalyst-match"

# ── the two legacy rules ─────────────────────────────────────────────────────
RULE_WATCHLIST = "watchlist"
RULE_GRADE = "grade"
MATCH_RULES = (RULE_WATCHLIST, RULE_GRADE)

# ── which set defines "a name I care about" ──────────────────────────────────
#: ⛔ ONLY `watchlists` is reachable from the legacy query. The other three are
#: pinned unpopulated so a later widening is a data change, not a schema change,
#: and so the NARROWING is visible today instead of being discovered by a member
#: whose tagged name never alerted.
SET_WATCHLISTS = "watchlists"
SET_TAGS = "tags"
SET_POSITIONS = "positions"
SET_UCT20 = "uct20"
MEMBER_SETS = (SET_WATCHLISTS, SET_TAGS, SET_POSITIONS, SET_UCT20)

# ── who receives ─────────────────────────────────────────────────────────────
COHORT_SELF = "self"
COHORT_ADMINS = "admins"
COHORTS = (COHORT_SELF, COHORT_ADMINS)

#: `_normalize_grade`'s own set, not a second copy of a guess.
VALID_GRADES = ("A", "B", "C")

#: ⛔ The legacy must-know default, `CATALYST_MUSTKNOW_GRADES` = "A,B". Stated as
#: the DEFAULT it is, never as the rule: the env var can widen it and a predicate
#: carries its own `min_grade` so the two cannot silently diverge.
LEGACY_MUSTKNOW_GRADES = ("A", "B")

#: The deterministic tag vocabulary from `tagging.py`. CLOSED — this one really
#: is an enum, and saying so beside the open one is the point.
TAGS = ("Earnings", "Catalyst", "Gapper", "News")

#: ⚠️ A CONVENTION, NOT A CONTRACT. These are the fifteen labels
#: `synthesize.py`'s PROMPT asks for. Nothing in the code enforces them — see
#: F-S7-CM-1 item 3. Recorded so a reader can see what the model is *asked* for
#: while `catalyst_types` stays open to what it actually emits.
CATALYST_TYPE_CONVENTION = (
    "Earnings", "M&A", "FDA", "Analyst", "Contract", "Guidance", "Product",
    "Legal", "Insider", "Index", "Offering", "Momentum", "Sector-wide", "Flow",
    "None",
)

#: The one dedup grain the legacy table enforces, as its PK.
DEDUP_GRAIN = "user_ticker_day"

PARAMS_SCHEMA = {
    "match_rule": "string -- 'watchlist' | 'grade'. ⛔ TWO RULES, ONE DEDUP "
                  "TABLE: the legacy path runs the watchlist rule first and the "
                  "grade rule second, both writing catalyst_alerts_fired keyed "
                  "(user_id, ticker, market_date), so for an admin watching the "
                  "name the grade alert is SUPPRESSED that day. Reproduced, not "
                  "fixed (F-S7-CM-1 item 1)",

    "member_set": "string -- 'watchlists' | 'tags' | 'positions' | 'uct20'. ⛔ "
                  "ONLY 'watchlists' is reachable from the legacy query, which is "
                  "`watchlists JOIN watchlist_items` and therefore includes the "
                  "flagged list (it is a watchlists row) but NOT the seven "
                  "colour-tag auto-lists, NOT J2 positions and NOT UCT20. Pinned "
                  "so the narrowing is detectable",

    "entity_ref": "string | null -- the ticker, for a predicate that names one. "
                  "NULL is meaningful and is the grade rule's normal shape: "
                  "'tell me about any grade-A catalyst' names no entity",

    "cohort": "string -- 'self' | 'admins'. The legacy grade rule is "
              "ADMIN-ONLY (`_collect_admin_user_ids`, role='admin') so a "
              "subscriber never gets a surprise push; the watchlist rule is "
              "'self'. Carried explicitly because a grade predicate with "
              "cohort='self' is a FLIP decision, not a migration one",

    "min_grade": "string | null -- 'A' | 'B' | 'C'. Grades are ordered A > B > C "
                 "and `_normalize_grade` coerces anything else to NULL, which "
                 "means 'keep, unknown' downstream — a row with no grade is "
                 "NEVER hidden by the legacy path, so a min_grade predicate must "
                 "not hide it either",

    "catalyst_types": "list[string] | null -- ⛔⛔ AN OPEN VOCABULARY, MATCHED "
                      "CASE-INSENSITIVELY. `synthesize.py` passes the model's "
                      "`catalyst_type` through with NO normalisation (unlike "
                      "`grade`), so the column holds free text. The fifteen "
                      "labels the prompt asks for are recorded in "
                      "CATALYST_TYPE_CONVENTION as a convention. Pinning an enum "
                      "here would be the F-S7-4 mistake made on purpose",

    "tag": "string | null -- 'Earnings' | 'Catalyst' | 'Gapper' | 'News'. THIS "
           "one is closed and deterministic (`tagging.py` assigns exactly one by "
           "rule, never by model), which is why it is an enum and "
           "`catalyst_types` is not",

    "displayed_only": "boolean -- default true, and the legacy behaviour. Both "
                      "legacy call sites pass `displayed` (grade-C rows already "
                      "excluded), never `top_12`. A false here would alert on "
                      "rows no member can see; pinned so that state is declarable "
                      "rather than reachable by accident",

    "dedup_grain": "string -- 'user_ticker_day', the PK of catalyst_alerts_fired. "
                   "Pinned as a field because it is the one shape a later type "
                   "will want to change (per-refresh, per-week) and changing it "
                   "silently would multiply what a member receives",
}

# ⛔ NO `replay_fn`. See the module docstring — the candidate set is paid LLM
# output behind a cost cap, and replay would re-run today's gate over it.


def register(*, db_path: str | None = None) -> None:
    """Idempotent — call at process start.

    ⛔ §2a ITEM 3 — *what calls this evaluator, on what trigger, and which test
    fails if that wire is cut?* At CP1–CP2 the honest answer is **the comparison
    harness does**, directly, over predicates the harness itself arms; there is
    no scheduler entry and no flag, deliberately. `catalyst_match_compare.observe`
    is the only caller, and `test_the_harness_is_the_only_caller_of_would_fire`
    is the rail that fails if that stops being true — which is the form the
    question takes at a checkpoint with no wire yet. The scheduler wire and its
    rail arrive with CP3 and need a new approval line.
    """
    _registry.register_trigger_type(TYPE_ID, PARAMS_SCHEMA, module=__name__, db_path=db_path)


# ─────────────────────────────────────────────────────────────────────────────
# CHECKPOINT 2 — the dark evaluator
# ─────────────────────────────────────────────────────────────────────────────

def _norm_grade(raw: Any) -> Optional[str]:
    """`synthesize._normalize_grade`'s rule, restated read-only.

    ⛔ A MIRROR, AND IT IS RAILED. `test_the_grade_mirror_matches_synthesize`
    drives the real `_normalize_grade` against the same inputs. A mirror without
    a rail is a second authority over one value
    (`lesson_rail_the_mirror_not_just_the_lane`).
    """
    if not raw:
        return None
    g = str(raw).strip().upper()[:1]
    return g if g in VALID_GRADES else None


def _grade_rank(grade: Optional[str]) -> Optional[int]:
    """A > B > C, as 0 > 1 > 2. `None` stays `None` — NOT a worst rank.

    ⛔ Coercing an unknown grade to "worse than C" would hide it, and the legacy
    path never hides an ungraded row: `_normalize_grade`'s own docstring says
    None means *"keep, unknown"*.
    """
    if grade is None:
        return None
    try:
        return VALID_GRADES.index(grade)
    except ValueError:
        return None


def row_matches(params: dict[str, Any], row: dict[str, Any]) -> bool:
    """Do this predicate's row-level filters admit this catalyst row?

    Entity, tag, catalyst type and minimum grade — the parts that are about the
    ROW rather than about the member.
    """
    ref = params.get("entity_ref")
    ticker = (row.get("ticker") or "").upper()
    if ref and ticker != str(ref).upper():
        return False

    want_tag = params.get("tag")
    if want_tag and (row.get("tag") or "") != want_tag:
        return False

    wanted = params.get("catalyst_types")
    if wanted:
        # ⛔ CASE-INSENSITIVE, because the vocabulary is model output and the
        # model is only ASKED to use the fifteen labels. An exact-match filter
        # would silently drop `fda` and `FDA Approval`.
        have = (row.get("catalyst_type") or "").strip().lower()
        if have not in {str(w).strip().lower() for w in wanted}:
            return False

    floor = _norm_grade(params.get("min_grade"))
    if floor is not None:
        rank = _grade_rank(_norm_grade(row.get("grade")))
        # ⛔ `rank is None` means the row is UNGRADED, and an ungraded row passes.
        # The legacy path never hides one, so neither does this.
        if rank is not None and rank > _grade_rank(floor):
            return False

    return True


def would_fire(params: dict[str, Any], *,
               displayed: Iterable[dict[str, Any]],
               member_tickers: Iterable[str] = (),
               is_admin: bool = False,
               already_fired: Iterable[str] = ()) -> list[str]:
    """The DARK rule. Returns the tickers this predicate would alert on TODAY.

    ⛔ DELIBERATELY THE LEGACY RULE, NOT AN IMPROVED ONE. CP1–CP2 measure the
    migration; a rule that fixes something while migrating measures the fix.

    ⭐ IT RETURNS A LIST, NOT A BOOLEAN, and that is forced by the legacy shape:
    one refresh fires once PER MATCHING TICKER, and the dedup is per ticker too.
    A boolean would collapse "three names alerted" and "one name alerted" into
    one outcome and make the comparison unable to see a member's inbox double.

    `already_fired` models `catalyst_alerts_fired` — the tickers this user has
    already been alerted about for this market date, from EITHER rule. Passing it
    is what reproduces the cross-rule suppression in F-S7-CM-1 item 1.
    """
    rule = params.get("match_rule")
    if rule not in MATCH_RULES:
        return []

    rows = list(displayed)
    if params.get("displayed_only", True) is False:
        # A declared-but-unauthorized shape: the schema admits it so it is
        # nameable, and the evaluator treats it exactly as the legacy path would
        # if handed the wider set — it does not invent a second behaviour.
        pass

    fired = {str(t).upper() for t in already_fired}

    if rule == RULE_WATCHLIST:
        if (params.get("member_set") or SET_WATCHLISTS) != SET_WATCHLISTS:
            # Only `watchlists` is reachable from the legacy query. A predicate
            # naming another set is pinned-but-unauthorized: it evaluates to
            # nothing rather than raising, the same call F-S7-2 made.
            return []
        mine = {str(t).upper() for t in member_tickers}
        out = [(r.get("ticker") or "").upper() for r in rows
               if (r.get("ticker") or "").upper() in mine and row_matches(params, r)]
    else:  # RULE_GRADE
        if (params.get("cohort") or COHORT_ADMINS) == COHORT_ADMINS and not is_admin:
            # ⛔ Admin-only, and this is the guard that keeps a dark comparison
            # from ever describing a subscriber's inbox.
            return []
        floor = _norm_grade(params.get("min_grade"))
        out = []
        for r in rows:
            if not row_matches(params, r):
                continue
            g = _norm_grade(r.get("grade"))
            if floor is None:
                # No floor declared: the legacy default is the env var's A,B.
                if g not in LEGACY_MUSTKNOW_GRADES:
                    continue
            out.append((r.get("ticker") or "").upper())

    # Dedup, in order, preserving the legacy's "first rule to claim the (user,
    # ticker, day) wins" behaviour.
    seen: set[str] = set()
    result: list[str] = []
    for t in out:
        if not t or t in fired or t in seen:
            continue
        seen.add(t)
        result.append(t)
    return result


def predicate_fingerprint(params: dict[str, Any]) -> tuple:
    """What a change to the predicate's FIRING IDENTITY looks like.

    ⛔ A parameter rewrite makes the pre-change ticks un-attributable to the
    migration, exactly as a moved anchor does for `price-level` and a moved
    calendar date does for `event-proximity`. When this tuple changes, the open
    span CLOSES and its counts are discarded into `not_comparable` — never
    carried forward as agreement.

    ⛔ `displayed_only` IS IN THE TUPLE. It changes which rows are even eligible,
    so a predicate that flipped it mid-run would be answering a different
    question with the same span.
    """
    types = params.get("catalyst_types")
    return (
        params.get("match_rule"),
        params.get("member_set") or SET_WATCHLISTS,
        (str(params.get("entity_ref")).upper() if params.get("entity_ref") else None),
        params.get("cohort") or COHORT_ADMINS,
        _norm_grade(params.get("min_grade")),
        tuple(sorted(str(t).strip().lower() for t in types)) if types else None,
        params.get("tag"),
        bool(params.get("displayed_only", True)),
    )
