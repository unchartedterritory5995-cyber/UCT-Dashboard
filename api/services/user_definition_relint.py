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

    for row in user_definitions.live_definitions():
        definitions_read += 1
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
                    healed.append(dict(found, healed_at=now))
                else:
                    needs_decision.append(dict(found, healed_at=None))
            elif verdict == STORED_LOOSER:
                needs_decision.append(found)
            else:
                uncomparable.append(found)

    affected = sorted({a for f in needs_decision for a in f.get("armed_alert_ids") or []})
    return {
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
    if dangerous:
        lines.append(
            f"NEEDS A DECISION — {len(dangerous)} stored badge(s) are now LOOSER "
            "than the engine measures. These are NOT flipped automatically:")
        for f in dangerous:
            ids = f.get("armed_alert_ids") or []
            lines.append(
                f"  {f['def_id']}.{f['plot_key']} v{f['version']} "
                f"(user {f['user_id']}): stored {f['stored']!r}, linter now "
                f"{f['current']!r} — "
                + (f"ARMED: active alert ids {ids}" if ids
                   else "no ACTIVE alert on this plot (a footnote, not a notification)"))
    else:
        lines.append("NEEDS A DECISION — none. No stored badge is looser than "
                     "the engine now measures.")

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
        lines.append(f"  {f['def_id']}.{f['plot_key']} v{f['version']} "
                     f"(user {f['user_id']}): {f['stored']!r} -> {f['current']!r}")
    if not healed:
        lines.append("  none")

    unc = report.get("uncomparable") or []
    if unc:
        lines.append("")
        lines.append(f"UNCOMPARABLE — {len(unc)} (reported, never healed):")
        for f in unc:
            lines.append(f"  {f['def_id']}.{f.get('plot_key')} v{f['version']}: "
                         f"{f['note']}")

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
    # Exit 1 while a human decision is outstanding, so a caller can gate on it.
    return 1 if report["needs_decision"] else 0


if __name__ == "__main__":                                         # pragma: no cover
    raise SystemExit(_main())
