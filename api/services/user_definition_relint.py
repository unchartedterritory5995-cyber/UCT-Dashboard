"""THE RE-LINT PASS `user_definitions.py` ASKED FOR, IN WRITING, BEFORE IT WAS NEEDED.

⭐ THIS IS NOT A BUG FIX. `user_definitions.py`'s own docstring states the design
and names this module as its future obligation:

    `repaint` IS STORED, NOT RECOMPUTED AT READ TIME. The badge a user was SHOWN
    when they saved, and the badge an alert was admitted under, must be the SAME
    FACT. Recomputing at read time means a linter improvement silently re-badges
    a definition somebody already armed, and the receipts claim becomes a moving
    target. **A linter change therefore requires an explicit re-lint pass with
    its own notification — a Phase-E problem, named here so it is not discovered
    there.**

We are in Phase E, the linter changed, and this is the pass. ⛔ SO THIS MODULE
DOES NOT "FIX" THE STORED-NOT-RECOMPUTED DESIGN. It leaves the admission gate
reading the stored column, it installs no hook in `save()` and none in the
admission path, and it is invoked explicitly or not at all.

────────────────────────────────────────────────────────────────────────────────
THE LINTER CHANGE THAT MADE THIS DUE, MEASURED
────────────────────────────────────────────────────────────────────────────────
`b66d4d1f8` and `9e932591b` retired a narrow `^arg(N)$` lookback grammar that had
branded `adx` **"Repaints"** — the second commit measured it in those words:
*"ast_lint.lint_repaint(adx(high,low,close,14)) = repaints / 'cannot bound',
while every other reader answered 28"*. Re-measured here on 2026-08-26 the same
call lints `non-repainting`, `forward=0`, `back=28`.

So every definition saved before that fix with an `adx` in it carries a stored
`repaints`, and `alert_user_series._gate_repaint` refuses `repaints` OUTRIGHT.
Those definitions are **permanently un-armable**, and nothing tells their owner
why — because the store's own growth guard closes the only other escape: a
byte-identical re-save `return`s before the append carrying `prev["repaint"]`, so
a user who re-saves the same formula does NOT get re-linted. The drift is stuck
by construction.

⚠️ AND THAT FUNCTION IS NOT WHY THIS PASS EXISTS, IT IS ONLY TODAY'S INSTANCE.
Measured on the manifest at 2026-08-26: `closedTable.json` holds **57 functions**
and exactly **one** declares a compound window. That number is narrow today and
is a property of nothing — so this module is driven by
`user_definitions.lint_verdict`, which reads the manifest, and it names no
function of the grammar anywhere in its source.
`tests/test_user_definition_relint.py` asserts that structurally, because a pass
hardcoded to one name covers nothing the day a second one lands.

────────────────────────────────────────────────────────────────────────────────
⛔⛔ THE TWO DRIFT DIRECTIONS ARE NOT SYMMETRIC, AND THAT ASYMMETRY IS THE DESIGN
────────────────────────────────────────────────────────────────────────────────
**A. STORED IS STRICTER THAN THE LINTER NOW IS** (stored `repaints`, linter now
`non-repainting`). The definition is un-armable for a claim the engine has since
withdrawn. **Healing is strictly safe**: no alert was ever admitted under a
LOOSER claim than the stored one, so there is nothing to invalidate and nobody
to notify. **Healed automatically, and recorded** in `user_definition_relint_log`
so the change is auditable rather than silent.

**B. STORED IS LOOSER THAN THE LINTER NOW IS** (stored `non-repainting`, linter
now `repaints`). An alert may be **armed right now under a claim that is no
longer true** — an alert whose own fire may stop having happened. ⛔ NEVER
FLIPPED, not even "for consistency". Silently re-badging is precisely what the
design comment forbids, and here it would RETROACTIVELY change what an armed
alert was admitted under. It is reported, with the affected ACTIVE alert ids
named, for a human decision.

⭐ A HEAL THAT TREATED BOTH DIRECTIONS THE SAME WOULD BE WORSE THAN NO HEAL,
because one is bookkeeping and the other is a safety notification wearing
bookkeeping's clothes.

────────────────────────────────────────────────────────────────────────────────
WHICH IS "STRICTER" IS **MEASURED FROM THE DOOR**, NEVER TYPED HERE
────────────────────────────────────────────────────────────────────────────────
A hand-written `{"non-repainting": 0, ...}` in this file would be a SECOND
AUTHORITY over the one question that decides which direction a drift is — and
this repo's most repeated defect is exactly that shape. So `admission_rank()`
DRIVES `alert_user_series._gate_repaint` itself, once per mode, and reads the
answer off the real door:

    admitted with no acknowledgement          -> 0
    refused bare, admitted with an ack        -> 1
    refused both ways                         -> 2

The gate is a pure function of two mappings (no I/O, no bars), so driving it
costs nothing and can never disagree with the door it describes. A mode the gate
treats in a way this function cannot place RAISES rather than guessing —
fail-closed, the same direction `ast_lint` itself fails.

────────────────────────────────────────────────────────────────────────────────
⭐ CURRENT VERSION ONLY. HISTORY IS NEVER TOUCHED — AND THAT IS DERIVED
────────────────────────────────────────────────────────────────────────────────
Every admission path reaches the store at version `None`, i.e. **the live newest
row**, and there are exactly two of them:

    alert_user_series.py:676   `admit_user_definition` takes a `version`, and its
                               ONLY caller `arm_for_alert` — the first-arm AND
                               the re-arm path — passes `None`.
    alert_user_series.py:744   `user_value_function` -> `_gate_definition(..., None)`.

`alert.def_version` is READ once (`alert_user_series.py:420`, to size a lookback)
and **written nowhere in `api/`**, so no alert carries a version pin today.

Therefore healing the newest live row is **exactly sufficient**: no admission
decision anywhere reads any other version's `repaint`. And healing history would
be **actively harmful** — an old version's `repaint` is the receipt for *"the
badge a user was SHOWN when they saved"*, rewriting it is the moving target the
design names by that word, and those rows are precisely what a `defId@version`
pin points at under a store whose contract is *"a pin is only free if the row it
points at CANNOT CHANGE UNDER ITS HOLDER"*.

⚠️ THE ONE ROW THIS PASS WRITES IS THEREFORE NARROW ON PURPOSE: the `repaint`
COLUMN of the newest live row, under a compare-and-set (still newest, still
carrying the value the decision was taken against), never the `definition` blob,
never `ast_hash`, never `rev`, never `version`. A concurrent `save()` that
appended while we were deciding means our target is no longer newest, and the
heal is SKIPPED rather than written onto a superseded row.

⛔ AND THE WRITE IS HERE, NOT IN `user_definitions.py`. That module's append-only
claim is asserted by an AST walk over its OWN source
(`test_the_MODULE_ISSUES_NO_UPDATE_STATEMENT_and_the_scan_can_see_one`), and it
is a real invariant about user-authored CONTENT. This is not content: it is a
MEASUREMENT the store took, and the design already declared it re-takeable by an
explicit pass. Keeping the statement out of that file keeps the content
invariant true and puts the one exception where it can be read.

The store's own connection settings and process-wide write lock are IMPORTED,
not re-declared (`_connect`, `_WRITE_LOCK`, `_ensure`, `_newest`) — a second
`sqlite3.connect` with hand-copied pragmas would be a second posture over one
file, and a second "which row is live" would be a second authority over the
question `live_definitions()` exists to answer.
"""
from __future__ import annotations

import contextlib
import json
import time
from typing import Any, Dict, List, Mapping, Optional

# ─── the audit trail ─────────────────────────────────────────────────────────
#
# ⭐ APPEND-ONLY, IN THE SAME FILE AS THE ROWS IT KEYS ON. A record of what was
# healed that lived in a different database from the definitions would be a
# record of nothing (`indicator_alert_service.db_path` makes the same point about
# the fired log). NO TRIGGER: the store asserts its file is trigger-free
# (`test_N_saves_leave_N_ROWS_and_the_file_carries_NO_TRIGGER`) and a trigger
# here would make that measurement false from a file the test does not read.

_LOG_SCHEMA = """
CREATE TABLE IF NOT EXISTS user_definition_relint_log (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id   TEXT    NOT NULL,
  def_id    TEXT    NOT NULL,
  version   INTEGER NOT NULL,
  plot_key  TEXT    NOT NULL,
  old_mode  TEXT    NOT NULL,
  new_mode  TEXT    NOT NULL,
  healed_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_relint_log_def
  ON user_definition_relint_log(user_id, def_id, version);
"""

#: The separator inside an armed-index key. A NUL can appear in neither a user id
#: nor a `u_<hex>.<plotKey>` address, so `"a" + SEP + "b.c"` cannot collide with
#: `"a" + SEP + "b.c"` assembled from different halves.
_KEY_SEP = "\x00"

# ─── the four verdicts a comparison can reach ────────────────────────────────

#: Stored and current agree. Nothing to do, nothing to say.
AGREED = "agreed"

#: **Direction A** — stored is STRICTER than the linter now is. Safe to heal.
STORED_STRICTER = "stored-stricter"

#: **Direction B** — stored is LOOSER than the linter now is. NEVER auto-flipped.
STORED_LOOSER = "stored-looser"

#: Neither: the stored dict and the recomputed dict do not describe the same set
#: of plots, or one side carries a mode the gate's vocabulary does not hold, or
#: the linter cannot read the definition at all.
#: ⛔ Reported, never healed — an absent answer is not a negative one.
UNCOMPARABLE = "uncomparable"


#: ⭐ C45 — the stored `requirements` stamp lacks a tag the manifest derives
#: today. The ONE direction of that column this pass acts on, and it is the
#: opposite of `repaint`'s: a stamp SHORTER than reality ADMITS a script to a
#: consumer that should have refused it (`closedTable.json::_requirement_tags.
#: _stamped_not_recomputed`), so it is healed toward MORE tags and the armed
#: alerts standing on the short stamp are NAMED.
REQUIREMENTS_SHORT = "requirements-short"

#: The `plot_key` a requirements heal is logged under. Not a plot: the stamp is
#: one list for the whole definition. A plot key is a formula identifier and
#: cannot start with `*`, so this cannot collide with one.
REQUIREMENTS_LOG_KEY = "*requirements"


class RelintVocabularyError(RuntimeError):
    """A repaint mode this pass cannot place on the gate's own scale.

    ⛔ RAISED, NOT DEFAULTED. A mode that silently ranked as "clean" would heal a
    definition INTO a claim nobody measured; a mode that silently ranked as
    "worst" would report a safety incident that is not one. Both are worse than
    a loud stop.
    """


_RANKS: Optional[Dict[str, int]] = None


def _rank_one(mode: str) -> int:
    """Ask the REAL admission door how hard `mode` is to arm.

    ⛔ THE GATE IS DRIVEN, NOT MODELLED. `_gate_repaint` reads two mappings and
    raises; it touches no database, no bars and no network, so driving it is
    cheap and it is the only reading that cannot drift from the door.
    """
    from api.services import alert_user_series as aus

    row = {"def_id": "u_000000000000", "repaint": {"probe": mode}}
    bare: Mapping[str, Any] = {}
    acked: Mapping[str, Any] = {"meta": {aus.REPAINT_ACK_KEY: {"probe": True}}}

    def admits(definition: Mapping[str, Any]) -> bool:
        try:
            aus._gate_repaint(row, definition)
            return True
        except aus.AdmissionRefused:
            return False

    if admits(bare):
        if not admits(acked):
            raise RelintVocabularyError(
                f"{mode!r} is admitted bare but refused WITH an acknowledgement — "
                "the gate does not order this mode and this pass will not guess")
        return 0
    if admits(acked):
        return 1
    return 2


def admission_rank(mode: Any) -> int:
    """How refusing the stored badge is: 0 (freest) .. 2 (refused outright).

    ⭐ DERIVED FROM `alert_user_series._gate_repaint`, once, and cached. The whole
    notion of a drift "direction" rests on this ordering, and a copy of it typed
    into this file is the second-authority defect that costs this repo more than
    any other.
    """
    global _RANKS
    if _RANKS is None:
        from api.services import ast_lint
        _RANKS = {m: _rank_one(m) for m in ast_lint.REPAINT_MODES}
    if not isinstance(mode, str) or mode not in _RANKS:
        raise RelintVocabularyError(
            f"repaint mode {mode!r} is outside the linter's vocabulary "
            f"{sorted(_RANKS)} — this pass refuses to place it on the gate's scale")
    return _RANKS[mode]


def ranks() -> Dict[str, int]:
    """The whole scale, for a caller that wants to see it (and for the rails)."""
    admission_rank("non-repainting")          # force the derivation
    return dict(_RANKS or {})


#: The rank `_rank_one` returns for a mode the gate refuses BARE and admits WITH
#: an acknowledgement. Named rather than written as a `1` at the call site: the
#: number is an artefact of how the probe is ordered, and what a caller wants is
#: the MEANING.
RANK_NEEDS_ACK = 1


def needs_acknowledgement(mode: Any) -> bool:
    """Does arming this badge require a recorded author acknowledgement?

    ⚠️ THE ANSWER IS THE REASON A HEAL CAN STILL LEAVE A MEMBER STUCK. Healing a
    plot from `repaints` to `preview-repaints` is a real improvement and is safe
    — but it does not make the plot armable, and no shipped surface can record
    the acknowledgement that would. `format_report` says so out loud rather than
    letting the heal read as "fixed".
    """
    return admission_rank(mode) == RANK_NEEDS_ACK


# ─── the comparison, PER PLOT ────────────────────────────────────────────────

def compare_row(row: Mapping[str, Any]) -> List[dict]:
    """One stored definition -> one finding per plot key.

    ⛔ PER PLOT, NEVER PER DEFINITION. `lint_verdict` returns `{plotKey: mode}`
    because that is the granularity the owner ruled on and the granularity
    `_gate_repaint` iterates. A whole-definition comparison — `stored == current`
    — would be a single "they differ" on a two-plot definition where one plot
    healed and the other drifted DANGEROUSLY, and the two would be indistinguishable.

    The RECOMPUTATION goes through `user_definitions.lint_verdict`, not through
    `ast_lint` directly, so what this pass compares against is exactly what a
    `save()` today would have STORED. A second call into the linter with options
    of this module's own choosing would be comparing the store against something
    the store would never write.
    """
    from api.services import user_definitions

    definition = row.get("definition") or {}
    stored = row.get("repaint")
    findings: List[dict] = []

    def finding(plot_key: Any, stored_mode: Any, current_mode: Any,
                verdict: str, note: str) -> dict:
        return {
            "user_id": row.get("user_id"),
            "def_id": row.get("def_id"),
            "version": row.get("version"),
            "plot_key": plot_key,
            "stored": stored_mode,
            "current": current_mode,
            "verdict": verdict,
            "note": note,
        }

    if not isinstance(stored, dict):
        return [finding(None, stored, None, UNCOMPARABLE,
                        "the stored `repaint` column is not a {plotKey: mode} object")]

    try:
        current = user_definitions.lint_verdict(definition)
    except Exception as exc:                                       # noqa: BLE001
        # ⛔ FAIL-CLOSED. A definition the linter can no longer read is a fact to
        # REPORT, never a reason to heal toward anything. The stored badge stands,
        # which is the direction that keeps a refusal a refusal.
        return [finding(None, stored, None, UNCOMPARABLE,
                        "the linter could not read this definition today: "
                        f"{type(exc).__name__}: {exc}")]

    for plot_key in sorted(set(stored) | set(current), key=str):
        if plot_key not in stored:
            findings.append(finding(
                plot_key, None, current[plot_key], UNCOMPARABLE,
                "this plot has no stored verdict — the plot key set moved under "
                "the stored row, which is a document question, not a badge one"))
            continue
        if plot_key not in current:
            findings.append(finding(
                plot_key, stored[plot_key], None, UNCOMPARABLE,
                "the linter no longer emits a verdict for this stored plot key"))
            continue

        stored_mode, current_mode = stored[plot_key], current[plot_key]
        try:
            s_rank, c_rank = admission_rank(stored_mode), admission_rank(current_mode)
        except RelintVocabularyError as exc:
            findings.append(finding(plot_key, stored_mode, current_mode,
                                    UNCOMPARABLE, str(exc)))
            continue

        if s_rank == c_rank:
            # ⚠️ RANK FIRST, THEN STRING EQUALITY. Two DIFFERENT modes at the same
            # rank would be a drift with NO direction — healable neither way, and
            # a fact somebody should see rather than a silent "agreed".
            if stored_mode == current_mode:
                findings.append(finding(plot_key, stored_mode, current_mode,
                                        AGREED, "stored and current agree"))
            else:
                findings.append(finding(
                    plot_key, stored_mode, current_mode, UNCOMPARABLE,
                    "the two verdicts differ but the gate treats them the same, "
                    "so this drift has no safe direction"))
        elif s_rank > c_rank:
            findings.append(finding(
                plot_key, stored_mode, current_mode, STORED_STRICTER,
                "the stored badge is HARDER to arm than the engine now measures; "
                "no alert was admitted under a looser claim, so healing "
                "invalidates nothing and notifies nobody"))
        else:
            findings.append(finding(
                plot_key, stored_mode, current_mode, STORED_LOOSER,
                "the stored badge is EASIER to arm than the engine now measures — "
                "an alert may be armed right now under a claim that is no longer "
                "true; this is never flipped automatically"))
    return findings


# ─── GT: direction B, TOLD TO ITS OWNER ──────────────────────────────────────
#
# ⭐⭐ RT4 follow-up (owner ruling 2026-10-02). The shared clock table now
# declares the right edge of the nine last-bar clock leaves (`3a77b89423`), so
# a definition saved BEFORE that fix which reads one of them carries a stored
# `non-repainting` the engine no longer measures. This pass already finds it
# (direction B, `STORED_LOOSER`) and, by design, NEVER flips it. What was missing
# is the member being TOLD: `member_notice` turns the same finding into a
# sentence the store serves beside the row (`repaint_notice`), and the Builder
# shows it when its owner opens the definition.
#
# ⛔ IT WRITES NOTHING. The stored label stays the stored label; the notice is a
# derived field of the SERVED row, like `scan_refusal`. ⛔ It is general over
# direction B, not hard-coded to the nine leaves: whatever made the stored label
# looser than today's measurement, the owner is told the same true thing.

_NOTICE_CACHE: Dict[tuple, Optional[dict]] = {}
_NOTICE_CACHE_MAX = 4096


def member_notice(row: Mapping[str, Any]) -> Optional[dict]:
    """The member-visible notice for a stored row whose label is LOOSER than
    today's measurement, or ``None``.

    ``{"plots": [{plot_key, stored, current}], "sentence": str}``.

    ⭐ MEMOISED PER (user, def, version): a stored version never changes (the
    store appends), and today's measurement only changes with the code, which
    is a new process. So the lint runs once per row per boot, not per list read.
    ⛔ NEVER RAISES: a row the linter cannot read gets no notice (the relint
    pass reports it as `uncomparable`; the list must not fail over it)."""
    key = (str(row.get("user_id")), row.get("def_id"), row.get("version"),
           row.get("ast_hash"), json.dumps(row.get("repaint"), sort_keys=True, default=str))
    if key in _NOTICE_CACHE:
        return _NOTICE_CACHE[key]
    notice: Optional[dict] = None
    try:
        from api.services import runtime_definitions
        if not runtime_definitions.is_runtime(row.get("definition") or {}):
            looser = [f for f in compare_row(row) if f.get("verdict") == STORED_LOOSER]
            if looser:
                plots = [{"plot_key": f["plot_key"], "stored": f["stored"],
                          "current": f["current"]} for f in looser]
                parts = "; ".join(
                    f"`{p['plot_key']}` was saved as {p['stored']} and measures "
                    f"{p['current']} today" for p in plots)
                notice = {
                    "plots": plots,
                    "sentence": (
                        "This indicator was saved under an older repaint rule: "
                        f"{parts}. Its saved label is kept as it was, so nothing "
                        "you armed under it has changed; saving a change to the "
                        "formula records today's label."),
                }
    except Exception:                                              # noqa: BLE001
        notice = None
    if len(_NOTICE_CACHE) >= _NOTICE_CACHE_MAX:
        _NOTICE_CACHE.clear()
    _NOTICE_CACHE[key] = notice
    return notice


# ─── armed, or merely saved ──────────────────────────────────────────────────

def armed_index() -> Dict[str, List[int]]:
    """`{"<user_id>\\0<def_id>.<plotKey>": [alert_id, ...]}` for ACTIVE alerts.

    ⭐ ARMED IS A DIFFERENT FACT FROM SAVED, and it is the difference between a
    notification and a footnote. Read ONCE for the whole pass and indexed: a
    per-plot query would be an N+1 over the alert table for a pass whose entire
    job is a sweep.

    ⚠️ THE COLUMN IS `active`, AND `list_active()` IS WHAT KNOWS THAT.
    `indicator_alert_service` carries a comment about a prod probe that read this
    table as empty against `is_active` and reached the right answer for the wrong
    reason — so the filter is not re-spelled here, the function that owns it is
    called. It also refuses to filter by `state` or `scope`, which is right for
    this question too: a fired or snoozed alert is still armed under the stored
    claim.

    The address is canonicalised through `indicator_alert_evaluator.resolve_address`,
    the ONE owner of that grammar, because the stored `indicator` string is
    whatever the create path was handed.
    """
    from api.services import alert_user_series as aus
    from api.services import indicator_alert_evaluator as ev
    from api.services import indicator_alert_service as ias

    index: Dict[str, List[int]] = {}
    for alert in ias.list_active():
        address = ev.resolve_address(alert.get("indicator"))
        if not aus.is_user_address(address):
            continue
        index.setdefault(f"{alert.get('user_id')}{_KEY_SEP}{address}", []).append(
            int(alert.get("id")))
    return index


def _armed_for(index: Mapping[str, List[int]], finding: Mapping[str, Any]) -> List[int]:
    plot_key = finding.get("plot_key")
    if plot_key is None:
        # No plot key means the finding is about the whole row, so every active
        # alert on any of this definition's plots is in scope. Widening rather
        # than reporting none is the safe direction for a finding nobody can
        # narrow.
        prefix = f"{finding.get('user_id')}{_KEY_SEP}{finding.get('def_id')}."
        return sorted(a for key, ids in index.items() if key.startswith(prefix)
                      for a in ids)
    return sorted(index.get(
        f"{finding.get('user_id')}{_KEY_SEP}{finding.get('def_id')}.{plot_key}", []))


# ─── the heal ────────────────────────────────────────────────────────────────

def _heal(finding: Mapping[str, Any], now: int) -> bool:
    """Write ONE plot's healed verdict, under compare-and-set. True if written.

    ⛔ THE READ-MODIFY-WRITE IS INSIDE THE STORE'S OWN `_WRITE_LOCK`, and the row
    is re-read there. `save()` releases that lock across a network delivery and
    re-reads for exactly this reason; a heal computed against a row that has been
    superseded since would land a stale badge on a definition the user has edited.
    """
    from api.services import user_definitions as ud

    with ud._WRITE_LOCK, contextlib.closing(ud._connect()) as c:
        ud._ensure(c)
        c.executescript(_LOG_SCHEMA)
        row = ud._newest(c, finding["user_id"], finding["def_id"])
        if row is None or row["deleted_at"] is not None:
            return False
        if row["version"] != finding["version"]:
            return False                      # superseded while we were deciding
        try:
            stored = json.loads(row["repaint"])
        except Exception:                                          # noqa: BLE001
            return False
        plot_key = finding["plot_key"]
        if not isinstance(stored, dict) or stored.get(plot_key) != finding["stored"]:
            return False                      # the value moved under the decision
        stored[plot_key] = finding["current"]
        c.execute(
            "UPDATE user_definitions SET repaint=? "
            "WHERE user_id=? AND def_id=? AND version=?",
            (json.dumps(stored, sort_keys=True, separators=(",", ":")),
             str(finding["user_id"]), finding["def_id"], int(finding["version"])),
        )
        c.execute(
            "INSERT INTO user_definition_relint_log "
            "(user_id, def_id, version, plot_key, old_mode, new_mode, healed_at) "
            "VALUES (?,?,?,?,?,?,?)",
            (str(finding["user_id"]), finding["def_id"], int(finding["version"]),
             str(plot_key), str(finding["stored"]), str(finding["current"]), now),
        )
        c.commit()
    return True


# ─── C45 — the requirements stamp ────────────────────────────────────────────
#
# ⭐ THE MANIFEST PROMISED THIS AND THE PASS DID NOT DO IT. `_requirement_tags.
# _stamped_not_recomputed` says, of this column: *"the re-lint pass heals toward
# MORE tags and reports the missing direction with the armed consumers named"*.
# Until C45 this module never read the column. It mattered the day a tag's roster
# grew: every definition saved BEFORE the roster grew carries a stamp that says
# nothing, every consumer reads the STORED stamp (by design — the contract a
# member saved under and the one a consumer admitted it under are one fact), and
# so the new containment reached no definition that already existed.
#
# ⛔ THE DIRECTION IS ONE-WAY. A stored stamp that is LONGER than today's
# derivation refuses more than it need; that is the safe side and it is left
# alone (a tag removed from the manifest is a ruling, and un-refusing a stored
# definition is not this pass's to do). Only a MISSING tag is written.

def requirements_drift(row: Mapping[str, Any]) -> Optional[dict]:
    """One stored definition -> the tags its stamp lacks, or ``None``.

    The derivation is `user_definitions.requirement_tags` — exactly what a
    `save()` today would stamp — never a second reading of the manifest here.
    """
    from api.services import user_definitions

    stored = row.get("requirements")
    if not isinstance(stored, list):
        stored = []
    current = user_definitions.requirement_tags(row.get("definition") or {})
    missing = sorted(set(current) - set(stored))
    if not missing:
        return None
    return {
        "user_id": row.get("user_id"),
        "def_id": row.get("def_id"),
        "version": row.get("version"),
        "plot_key": None,                 # the whole definition: every plot's alerts
        "stored": sorted(stored),
        "current": sorted(set(stored) | set(current)),
        "missing": missing,
        "verdict": REQUIREMENTS_SHORT,
        "note": "the stored requirements stamp lacks a tag the manifest derives "
                "today — a comparability consumer reading it admits a script it "
                "should refuse",
    }


def _heal_requirements(finding: Mapping[str, Any], now: int) -> bool:
    """Write the longer stamp, under compare-and-set. True if written.

    Same lock, same re-read and same narrowness as `_heal`: the `requirements`
    COLUMN of the newest live row, and only if it still holds the value the
    decision was taken against.
    """
    from api.services import user_definitions as ud

    with ud._WRITE_LOCK, contextlib.closing(ud._connect()) as c:
        ud._ensure(c)
        c.executescript(_LOG_SCHEMA)
        row = ud._newest(c, finding["user_id"], finding["def_id"])
        if row is None or row["deleted_at"] is not None:
            return False
        if row["version"] != finding["version"]:
            return False                      # superseded while we were deciding
        if ud._requirements_of(row) != list(finding["stored"]):
            return False                      # the stamp moved under the decision
        c.execute(
            "UPDATE user_definitions SET requirements=? "
            "WHERE user_id=? AND def_id=? AND version=?",
            (json.dumps(list(finding["current"]), separators=(",", ":")),
             str(finding["user_id"]), finding["def_id"], int(finding["version"])),
        )
        c.execute(
            "INSERT INTO user_definition_relint_log "
            "(user_id, def_id, version, plot_key, old_mode, new_mode, healed_at) "
            "VALUES (?,?,?,?,?,?,?)",
            (str(finding["user_id"]), finding["def_id"], int(finding["version"]),
             REQUIREMENTS_LOG_KEY, json.dumps(list(finding["stored"])),
             json.dumps(list(finding["current"])), now),
        )
        c.commit()
    return True


def heal_log(user_id: Any = None, def_id: Optional[str] = None) -> List[dict]:
    """The audit trail: every heal this pass has written, oldest first.

    ⭐ THIS IS WHAT MAKES THE SAFE DIRECTION AUDITABLE RATHER THAN SILENT. A heal
    with no record would be the silent re-badge the design forbids, arriving
    through the door built to avoid it — the difference is that a heal in this
    direction can be READ BACK and argued with.
    """
    from api.services import user_definitions as ud

    where, args = "", []
    if user_id is not None:
        where, args = " WHERE user_id=?", [str(user_id)]
        if def_id is not None:
            where, args = where + " AND def_id=?", args + [def_id]
    with contextlib.closing(ud._connect()) as c:
        c.executescript(_LOG_SCHEMA)
        rows = c.execute(
            "SELECT user_id, def_id, version, plot_key, old_mode, new_mode, healed_at "
            "FROM user_definition_relint_log" + where + " ORDER BY id", args).fetchall()
    return [{"user_id": r[0], "def_id": r[1], "version": r[2], "plot_key": r[3],
             "old_mode": r[4], "new_mode": r[5], "healed_at": r[6]} for r in rows]


# ─── the pass ────────────────────────────────────────────────────────────────

def relint(*, heal: bool = True, now: Optional[int] = None) -> dict:
    """Re-lint every live definition and reconcile the stored badge.

    Direction A is healed automatically and logged. Direction B is reported with
    the ids of every ACTIVE alert on the affected plot. Nothing else is written.

    :returns: ``{definitions_read, plots_read, agreed, healed, healed_count,
      needs_decision, uncomparable, armed_alerts_affected, heal_enabled}``

    ⭐ `definitions_read` AND `plots_read` ARE PART OF THE ANSWER, NOT DEBUG.
    A pass over an empty store reports zero drift, and "zero drift" and "read
    nothing" are the same sentence to a caller who only looks at the lists. The
    counts are what let a reader tell a clean bill of health from a vacuous one,
    `format_report` says so IN WORDS when the store was empty, and
    `tests/test_user_definition_relint.py` pins a floor on them.

    ⛔ IDEMPOTENT BY CONSTRUCTION, NOT BY A FLAG. After a heal the stored verdict
    IS the recomputed one, so the second run reaches `AGREED` and writes nothing —
    no `UPDATE`, no log row. A heal that kept healing is a heal that is not
    converging. Direction B keeps REPORTING on every run, which is not a change:
    a report that stopped reporting an outstanding safety question would be the
    worse failure.
    """
    from api.services import user_definitions

    now = int(time.time()) if now is None else int(now)
    armed = armed_index()

    definitions_read = plots_read = agreed = 0
    healed: List[dict] = []
    needs_decision: List[dict] = []
    uncomparable: List[dict] = []

    requirements_healed: List[dict] = []
    requirements_unhealed: List[dict] = []

    from api.services import runtime_definitions
    for row in user_definitions.live_definitions():
        definitions_read += 1
        # ⭐ RT1 — a runtime-lane document carries no tree and no manifest-derived
        # stamp to drift: its repaint verdict is the runtime door's
        # (`runtime_definitions.repaint_stamp`), and no consumer that reads these
        # two stamps admits its lane. There is nothing here to compare.
        if runtime_definitions.is_runtime(row.get("definition") or {}):
            continue
        # ⭐ C45 — the requirements stamp, healed toward MORE tags (see
        # `requirements_drift`). The armed ids are EVERY active alert on the
        # definition: each stands on the short stamp and is refused at its next
        # admission, with the tag's own sentence.
        short = requirements_drift(row)
        if short is not None:
            short = dict(short, armed_alert_ids=_armed_for(armed, short))
            if heal and _heal_requirements(short, now):
                requirements_healed.append(dict(short, healed_at=now))
            else:
                requirements_unhealed.append(dict(short, healed_at=None))
        for found in compare_row(row):
            plots_read += 1
            verdict = found["verdict"]
            if verdict == AGREED:
                agreed += 1
                continue
            # ⭐ THE ARMED IDS ARE ATTACHED TO **BOTH** DIRECTIONS. On the safe
            # side they are how a reader can see for themselves that nothing was
            # armed under the looser claim, instead of taking this module's word.
            found = dict(found, armed_alert_ids=_armed_for(armed, found))
            if verdict == STORED_STRICTER:
                if heal and _heal(found, now):
                    healed.append(dict(
                        found, healed_at=now,
                        # ⛔ A HEAL IS NOT ALWAYS AN UNBLOCK. See
                        # `needs_acknowledgement`: this flag is what stops the
                        # report telling a member to do something no screen offers.
                        ack_required=needs_acknowledgement(found["current"])))
                else:
                    needs_decision.append(dict(found, healed_at=None))
            elif verdict == STORED_LOOSER:
                needs_decision.append(found)
            else:
                uncomparable.append(found)

    # ⛔ UNCOMPARABLE COUNTS AS AFFECTED, AND OMITTING IT WAS A FALSE ALL-CLEAR.
    # An alert armed on a badge this pass cannot place is EXACTLY the case the pass
    # exists to surface — "I could not tell" is not "nothing is wrong", and a
    # reader who only checks `armed_alerts_affected` was told the second when the
    # truth was the first. An empty authority is not one
    # (`lesson_a_second_authority_over_one_value`).
    # ⭐ C45 — AND EVERY ALERT STANDING ON A SHORT REQUIREMENTS STAMP, healed or
    # not: healed, it is refused at its next admission; unhealed, it is admitted
    # under a stamp that is known to be wrong. Either way somebody must be told.
    affected = sorted({a for f in needs_decision + uncomparable
                       + requirements_healed + requirements_unhealed
                       for a in f.get("armed_alert_ids") or []})
    return {
        "requirements_healed": requirements_healed,
        "requirements_unhealed": requirements_unhealed,
        "definitions_read": definitions_read,
        "plots_read": plots_read,
        "agreed": agreed,
        "healed": healed,
        "healed_count": len(healed),
        "needs_decision": needs_decision,
        "uncomparable": uncomparable,
        "armed_alerts_affected": affected,
        "heal_enabled": bool(heal),
    }


def format_report(report: Mapping[str, Any]) -> str:
    """The pass's finding as prose a human can act on.

    ⛔ THE DANGEROUS HALF LEADS, AND IT NAMES NAMES. A report that opened with
    "12 healed" and buried one armed alert standing on a claim that is no longer
    true would be a safety notification wearing bookkeeping's clothes — the exact
    shape this module's header refuses. Ids and plot keys, never a count alone
    (`lesson_a_differ_can_truncate_the_names_a_rail_exists_to_report`).
    """
    lines: List[str] = []
    dangerous = [f for f in report.get("needs_decision") or []
                 if f.get("verdict") == STORED_LOOSER]
    unplaceable = report.get("uncomparable") or []

    # ⭐ C45 — CONTAINMENT LEADS. A requirements stamp shorter than the manifest
    # derives is a script admitted to a consumer that should have refused it.
    def stamp_lines(found: List[dict]) -> List[str]:
        out = []
        for f in found:
            ids = f.get("armed_alert_ids") or []
            out.append(
                f"  {f['def_id']} v{f['version']} (user {f['user_id']}): "
                f"stored {f['stored']!r}, the manifest derives {f['current']!r} "
                f"(missing {f['missing']!r}) — "
                + (f"ARMED: active alert ids {ids}" if ids
                   else "no ACTIVE alert on this definition"))
        return out

    short_unhealed = report.get("requirements_unhealed") or []
    short_healed = report.get("requirements_healed") or []
    if short_unhealed:
        lines.append(
            f"NEEDS A DECISION — {len(short_unhealed)} stored requirements stamp(s) "
            "LACK a tag the manifest derives today and were NOT healed (heal "
            "disabled, or the row moved under the decision; re-run). Until they "
            "are, every consumer reading the stamp admits a script it should refuse:")
        lines.extend(stamp_lines(short_unhealed))
    if short_healed:
        lines.append(
            f"CONTAINMENT HEALED — {len(short_healed)} stored requirements stamp(s) "
            "gained the tag(s) they lacked. Each definition is now refused by the "
            "consumers its tags name, with the tag's own sentence; an ARMED alert "
            "below is refused at its next admission and its owner should be told:")
        lines.extend(stamp_lines(short_healed))
    if short_unhealed or short_healed:
        lines.append("")

    def armed_clause(f: Mapping[str, Any]) -> str:
        ids = f.get("armed_alert_ids") or []
        return (f"ARMED: active alert ids {ids}" if ids
                else "no ACTIVE alert on this plot (a footnote, not a notification)")

    if dangerous:
        lines.append(
            f"NEEDS A DECISION — {len(dangerous)} stored badge(s) are now LOOSER "
            "than the engine measures. These are NOT flipped automatically:")
        for f in dangerous:
            lines.append(
                f"  {f['def_id']}.{f['plot_key']} v{f['version']} "
                f"(user {f['user_id']}): stored {f['stored']!r}, linter now "
                f"{f['current']!r} — " + armed_clause(f))
    elif not unplaceable:
        lines.append("NEEDS A DECISION — none. No stored badge is looser than "
                     "the engine now measures, and every stored badge could be "
                     "placed on the gate's scale.")

    # ⛔ PROMOTED, AND IT LEADS WHEN IT IS THE ONLY OUTSTANDING THING.
    #
    # This block used to sit at the BOTTOM, under a heading that read like
    # bookkeeping, while the report OPENED with "NEEDS A DECISION — none". So a
    # definition whose badge this pass could not place — with an alert armed on
    # it — was reported as an all-clear. ⭐ "None" meaning "I could not tell" is
    # the empty-authority defect in its most dangerous form, and it is worse than
    # the drift it was hiding: a human reads the first line and stops.
    if unplaceable:
        lines.append(
            f"NEEDS A DECISION — {len(unplaceable)} stored badge(s) could NOT be "
            "compared at all. This pass has NO opinion on them, which is not the "
            "same as a clean one:")
        for f in unplaceable:
            lines.append(
                f"  {f['def_id']}.{f.get('plot_key')} v{f['version']} "
                f"(user {f['user_id']}): {f['note']} — " + armed_clause(f))

    unhealed = [f for f in report.get("needs_decision") or []
                if f.get("verdict") == STORED_STRICTER]
    if unhealed:
        lines.append("")
        lines.append(
            f"SAFE BUT NOT HEALED — {len(unhealed)} (heal disabled, or the row "
            "moved under the decision; re-run):")
        for f in unhealed:
            lines.append(f"  {f['def_id']}.{f['plot_key']} v{f['version']} "
                         f"(user {f['user_id']}): {f['stored']!r} -> {f['current']!r}")

    healed = report.get("healed") or []
    lines.append("")
    lines.append(f"HEALED (safe direction) — {len(healed)}:")
    for f in healed:
        lines.append(
            f"  {f['def_id']}.{f['plot_key']} v{f['version']} "
            f"(user {f['user_id']}): {f['stored']!r} -> {f['current']!r}"
            + ("  [STILL NOT ARMABLE — see below]" if f.get("ack_required") else ""))
    if not healed:
        lines.append("  none")

    # ⛔ AN INSTRUCTION A MEMBER CANNOT ACT ON IS THE SAME DEFECT AS A REFUSAL A
    # MEMBER CANNOT READ. The gate's own refusal says *"record one in
    # meta.repaintAck for this version to arm it anyway"* — and NOTHING in
    # `app/src` writes that field. Measured 2026-08-26: `repaintAck` appears in
    # the whole repo exactly once outside this pass, as
    # `alert_user_series.REPAINT_ACK_KEY`. So a heal that lands on
    # `preview-repaints` moves a member from "refused outright" to "refused
    # pending an acknowledgement no screen can record", and telling them to go
    # record one would be sending them somewhere that does not exist.
    #
    # `defSchema` treats `meta.*` as ignore-and-preserve and the store keeps
    # unknown meta keys, so the FIELD works — what is missing is a surface. That
    # distinction is the actionable half, so it is what gets printed.
    ack_blocked = [f for f in healed if f.get("ack_required")]
    if ack_blocked:
        lines.append("")
        lines.append(
            f"  ⚠️ {len(ack_blocked)} of the heals above land on a badge that still "
            "needs an author acknowledgement, and NO SHIPPED SURFACE CAN RECORD ONE. "
            "Do not tell these members to acknowledge it — they cannot. Until an "
            "editor writes `meta.repaintAck`, the honest sentence is that the "
            "engine now rates the plot as settling after a known number of bars, "
            "and arming it is not yet available:")
        for f in ack_blocked:
            lines.append(f"    {f['def_id']}.{f['plot_key']} (user {f['user_id']}) "
                         f"is now {f['current']!r}")

    lines.append("")
    tail = (f"READ {report.get('definitions_read')} live definition(s), "
            f"{report.get('plots_read')} plot verdict(s); "
            f"{report.get('agreed')} agreed.")
    if not report.get("definitions_read"):
        tail += (" ⚠️ THE STORE HELD NO LIVE DEFINITION — this is a pass that read "
                 "nothing, NOT a clean bill of health.")
    lines.append(tail)
    return "\n".join(lines).rstrip()


# ─── the invocable door ──────────────────────────────────────────────────────
#
# ⛔ A HOOK IS WHAT THE DESIGN FORBIDS, SO THIS IS A COMMAND. `save()` is
# untouched and the admission path is untouched; a re-lint happens when somebody
# runs it after changing the linter, which is the "explicit pass" the store's
# docstring asked for.
#
# ⚠️ DELIVERY IS DELIBERATELY NOT WIRED, AND THAT IS DECLARED RATHER THAN
# QUIETLY OMITTED. `format_report` produces the notification's BODY; which
# channel it goes to and who receives it is a product decision — this repo has at
# least three plausible answers (the admin Discord, `watchlist_alert_service`, and
# the member-facing `indicator_alert_service.user_definition_refusals` surface,
# which is already the place a member is told why a formula is not offered).
# Guessing one would put a safety notification on a channel nobody agreed to read.

def _main(argv: Optional[List[str]] = None) -> int:                # pragma: no cover
    import argparse

    parser = argparse.ArgumentParser(
        description="Re-lint stored user definitions after a linter change.")
    parser.add_argument("--dry-run", action="store_true",
                        help="report only; heal nothing, including direction A")
    args = parser.parse_args(argv)
    report = relint(heal=not args.dry_run)
    print(format_report(report))
    # ⛔ EXIT 1 WHILE ANYTHING IS OUTSTANDING — INCLUDING WHAT THIS PASS COULD NOT
    # PLACE. Exiting 0 on an uncomparable finding tells every caller that gates on
    # this command that the store is clean, when the true answer is "I could not
    # tell" — and an alert may be armed on the badge in question.
    return 1 if (report["needs_decision"] or report["uncomparable"]
                 or report["requirements_unhealed"]) else 0


if __name__ == "__main__":                                         # pragma: no cover
    raise SystemExit(_main())
