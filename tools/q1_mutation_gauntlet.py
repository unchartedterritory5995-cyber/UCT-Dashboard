"""Wave Q1 — every guard in the offline layer, broken on purpose, one at a time.

⛔ WHY THIS IS A COMMITTED TOOL AND NOT A SESSION'S SCRATCH EDITS.

Nine mutations were run and proved earlier in this wave. The resume doc records
the RESULT -- "all nine mutations ALL PROVED" -- and not one of the recipes. So
when the deploy gate demanded "every mutation reddening, on master AND
post-merge", the nine could not be re-run: the evidence had outlived the
experiment. A mutation you cannot repeat is a claim, not a measurement.

⛔ RESTORE IS AN INVERSE WRITE FROM MEMORY, NEVER `git checkout`.
A checkout restores whatever is committed, which silently reverts anything else
in the file -- including work in progress that was never the mutation's to touch.
The original bytes are held in memory and written back in a `finally`, and the
restore is VERIFIED byte-for-byte before the next mutation runs.

⛔ EVERY MUTATION NEEDS A CONTROL. A rail that is red before the mutation proves
nothing when it is red after it, so the gauntlet runs the rails GREEN first and
refuses to start if they are not.

⛔ THE EXPECTED-RED SET IS NOT TYPED. Each mutation declares which rail files
SHOULD redden; the gauntlet reports what actually reddened and flags any
mutation whose blast radius differs. A mutation that reddens nothing is a guard
nobody is testing; one that reddens everything is a guard nobody has isolated.

Usage:
    python tools/q1_mutation_gauntlet.py                 # the full gauntlet
    python tools/q1_mutation_gauntlet.py --only M4       # one mutation
    python tools/q1_mutation_gauntlet.py --self-check    # prove the harness can fail
"""
from __future__ import annotations

import argparse
import pathlib
import re
import subprocess
import sys

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

REPO = pathlib.Path(__file__).resolve().parent.parent
APP = REPO / "app"
OFF = "src/pages/journal-2-0/lib/offline"
NB = "src/pages/journal-2-0/components/notebook"

# The rail set. ⛔ DERIVING IT AS "the offline directory plus the notebook tests"
# WAS TOO NARROW AND SILENTLY DULLED A MUTATION. `EMIT_NOTHING`'s only rail is
# `lib/setContentEmitsUpdate.test.js`, which lives one directory UP from
# `lib/offline/` because it is about a TipTap v2-vs-v3 API change rather than
# about the offline layer. Breaking the constant reddened nothing, and the
# conclusion "this guard is untested" was wrong — the guard was tested by a file
# the harness never ran.
#
# ⭐ A DERIVED SET IS ONLY AS GOOD AS THE PROPERTY IT DERIVES ON. Directory
# membership is a proxy for "is this a Wave Q1 rail"; naming a Wave Q1 module or
# guard is the property itself. Both are used below, and their UNION is the set.
RAIL_DIRS = [f"{OFF}"]
RAIL_FILES = [
    # ⚰️ SEVEN RAILS THE HARNESS WAS NOT RUNNING, found by its own self-check
    # on 2026-09-12. Every one names `lib/offline` and every one arrived with the
    # door work (`0ecc4f886`) — so from that merge until now, a mutation to a door
    # guard could redden nothing here and be reported as UNRAILED. ⛔ That is the
    # dangerous direction: under-reported coverage invites deleting a guard that
    # was fine, which is why the coverage case exists at all.
    "src/pages/journal-2-0/components/AddPositionModal.test.jsx",
    "src/pages/journal-2-0/GlobalAddPositionProvider.settle.test.jsx",
    "src/pages/journal-2-0/components/notebook/HeroImagePicker.settle.test.jsx",
    "src/pages/journal-2-0/components/notebook/NoteEditorPage.excerpts.test.jsx",
    "src/pages/journal-2-0/tabs/NotebookTab.test.jsx",
    "src/pages/journal-2-0/components/notebook/ThesisReviewSection.test.jsx",
    "src/pages/journal-2-0/components/notebook/doorsThroughTheEditor.property.test.jsx",
    # ⛔ WAVE K lives in THREE places, and only one of them is `lib/offline`.
    # The gate is a component; the applier is in `src/context`, outside
    # journal-2-0 entirely. A rail set derived from the offline directory sees
    # neither — which is the same under-reporting that made `EMIT_NOTHING` look
    # untested, one wave later.
    f"{NB}/NotebookFlagGate.test.jsx",
    "src/context/authFlagPaths.test.js",
    f"{NB}/NoteEditorPage.durable.test.jsx",
    f"{NB}/NoteEditorPage.interleavings.test.jsx",
    f"{NB}/NoteEditorPage.nullbaseline.test.jsx",
    f"{NB}/NoteEditorPage.slowload.test.jsx",
    "src/pages/journal-2-0/lib/setContentEmitsUpdate.test.js",
]

# The property the directory proxy misses. Any journal-2-0 test naming one of
# these must be in the rail set no matter which directory it sits in.
GUARD_NAMES = (
    # Wave K
    "notebookFlags", "latchNotebookFlags", "NotebookFlagGate", "applyServerFlags",
    "lib/offline", "settleLandedSave", "EMIT_NOTHING", "emitUpdate",
    "usableBaseline", "landedBaseline", "isSupersededBaseline",
    "outboxDrain", "useDurableNote", "offlineFlag", "hydratedRef",
)

# ── the guards, and how to break each one ────────────────────────────────────
#   find/replace are exact and must match EXACTLY ONCE -- an ambiguous mutation
#   is not a mutation, it is a guess about which call site was hit.
MUTATIONS = [
    dict(id="M1", guard="usableBaseline rejects the empty string",
         file=f"{OFF}/baseline.js",
         find="if (typeof c === 'string' && c.trim() !== '') return c",
         repl="if (typeof c === 'string') return c",
         note="'' reads PRESENT to the producer and ABSENT to the consumer"),

    dict(id="M2", guard="landedBaseline: a DIRTY record may not vouch for itself",
         file=f"{OFF}/baseline.js",
         find="if (!record || record.dirty) return null",
         repl="if (!record) return null",
         note="a dirty record's baseline is what its next send will CLAIM"),

    dict(id="M3", guard="isSupersededBaseline compares INSTANTS, not strings",
         file=f"{OFF}/baseline.js",
         find="  return ta < tb",
         repl="  return String(a) < String(b)",
         note="ISO sorts lexicographically only while every value shares an offset"),

    dict(id="M4", guard="isSupersededBaseline REFUSES on unparseable input",
         file=f"{OFF}/baseline.js",
         find="if (!Number.isFinite(ta) || !Number.isFinite(tb)) return false",
         repl="if (!Number.isFinite(ta) || !Number.isFinite(tb)) return true",
         note="this decision DELETES queued member work"),

    dict(id="M5", guard="isSupersededBaseline refuses when either side is absent",
         file=f"{OFF}/baseline.js",
         find="if (a === null || b === null) return false",
         repl="if (a === null || b === null) return true",
         note="no baseline is not evidence of being superseded"),

    # ⚰️ THIS MUTATION WAS A NO-OP AND REPORTED A GUARD AS UNTESTED.
    # It added a field to the `report` PAYLOAD -- `reason: NO_BASELINE,` ->
    # `reason: NO_BASELINE, __mutated_send_anyway: true,` -- which no control
    # flow reads. The drain still refused, every rail stayed green, and the
    # harness concluded the refusal was unrailed. A mutation has to change a
    # DECISION; decorating the description of one changes nothing.
    dict(id="M6", guard="the drain REFUSES a baseline-less entry",
         file=f"{OFF}/outboxDrain.js",
         find="if (!isUsableBaseline(entry.baseUpdatedAt)) {",
         repl="if (false && !isUsableBaseline(entry.baseUpdatedAt)) {",
         note="baseUpdatedAt IS the compare-and-set; without it the PUT has none"),

    dict(id="M7", guard="the drain's supersede refusal exists at all",
         file=f"{OFF}/outboxDrain.js",
         find="if (isSupersededBaseline(entry.baseUpdatedAt, landed)) {",
         repl="if (false && isSupersededBaseline(entry.baseUpdatedAt, landed)) {",
         note="M11 -- the ordering where the drain claims between unmount and resolve"),

    dict(id="M8", guard="the supersede refusal is NARROW",
         file=f"{OFF}/outboxDrain.js",
         find="const landed = landedBaseline(noteRec)",
         repl="const landed = landedBaseline(noteRec) || '9999-01-01T00:00:00.000Z'",
         note="M12 -- widened, it deletes every queued entry unsent"),

    dict(id="M9", guard='settleLandedSave writes at all',
         file=f"{OFF}/useDurableNote.js",
         find='  const landed = usableBaseline(updatedAt)\n  if (!accountId || !noteId || !landed) return null\n  try {\n    const db = await connect(accountId)\n    const prev = await getNote(db, noteId)',
         repl='  const landed = usableBaseline(updatedAt)\n  if (landed) return null\n  if (!accountId || !noteId || !landed) return null\n  try {\n    const db = await connect(accountId)\n    const prev = await getNote(db, noteId)',
         note='M10 -- the store-direct settle that survives unmount'),

    dict(id="M10", guard="settleLandedSave REBASES when still ahead",
         file=f"{OFF}/useDurableNote.js",
         find="    const caughtUp = sameAuthoredContent(acked, current)\n"
              "    const state = caughtUp ? (acked || current) : current",
         repl="    const caughtUp = true\n"
              "    const state = caughtUp ? (acked || current) : current",
         note="clearing on an ack for OLDER words is how offline systems lose the newest"),

    dict(id="M11", guard='settleLandedSave needs an account AND a note',
         file=f"{OFF}/useDurableNote.js",
         find='  if (!accountId || !noteId || !landed) return null\n  try {\n    const db = await connect(accountId)\n    const prev = await getNote(db, noteId)',
         repl='  if (!landed) return null\n  try {\n    const db = await connect(accountId)\n    const prev = await getNote(db, noteId)',
         note="a settle without an identity writes into the wrong account's store"),

    dict(id="M13", guard="the in-flight marker is WRITTEN at all",
         file=f"{OFF}/useDurableNote.js",
         find="    await putMeta(db, markerKeyFor(noteId), marker)",
         repl="    void db  // mutated: marker never written",
         note="without it the drain claims a note whose save is on the wire"),

    dict(id="M14", guard="guard 2 asks the server AT ALL (both passes)",
         file=f"{OFF}/outboxDrain.js",
         find='  if (!serverCopyIsOurs) return null',
         repl="  return null  // mutated: never ask the server",
         note="the shared helper -- with it dark, every 409 forks blind"),

    dict(id="M15", guard='the 409 check is NARROW — only a PROVEN-identical body is removed',
         file=f"{OFF}/outboxDrain.js",
         find='          if (mine?.ours && mine.identical) {',
         repl='          if (mine?.ours || true) {',
         note='widened, it discards a genuine second writer AND any entry whose words the server never got'),

    dict(id="M16", guard="the staleness threshold is a real duration",
         file=f"{OFF}/inFlight.js",
         find="export const IN_FLIGHT_TTL_MS = 10_000",
         repl="export const IN_FLIGHT_TTL_MS = 0",
         note="a threshold of 0 expires every live marker and sends mid-flight"),

    # ── R-B: three more doors to one defect. Each gets its own mutation, even
    # though all three route through `settleMetadataRevision`, because each is a
    # separate call site and a future edit can break one without the others.
    dict(id="M17", guard="the FOLDER door settles the revision it just advanced",
         file=f"{NB}/NoteEditorPage.jsx",
         find="    await settleMetadataRevision(await update({ folderId: folderId || null }))",
         repl="    await update({ folderId: folderId || null })",
         note="a metadata PUT moves updatedAt without carrying the member's body"),

    dict(id="M18", guard="the TICKER door settles the revision it just advanced",
         file=f"{NB}/NoteEditorPage.jsx",
         find="    await settleMetadataRevision(await update({ ticker: ticker || null }))",
         repl="    await update({ ticker: ticker || null })",
         note="same door, different handle"),

    dict(id="M19", guard="the TAGS door settles the revision it just advanced",
         file=f"{NB}/NoteEditorPage.jsx",
         find="    await settleMetadataRevision(await update({ tags }))",
         repl="    await update({ tags })",
         note="same door, different handle"),

    # ── R-F: §21 inertness. ⛔ The one-line rollback is only real if every
    # store-direct entry point honours the flag.
    # ⛔ Mutates the SETTLE's gate specifically: it is the entry point that
    # writes the record, the outbox AND the landed ring, so with the gate gone
    # the flag-off case sees three kinds of write the rollback promised would
    # not happen. `offlineStorageAvailable` is left intact so the mutation
    # isolates the FLAG rather than storage detection.
    # ⛔ Mutates the SETTLE's flag gate specifically: it is the entry point
    # that writes the record, the outbox AND the landed ring, so with the gate
    # gone the flag-off case sees three kinds of write the rollback promised
    # would not happen. The storage gate is left intact so this isolates the
    # FLAG rather than storage detection.
    # ⛔ The find string carries the whole gate block because
    # `if (!offlineEnabled()) return null` alone appears in THREE functions —
    # and an ambiguous mutation is a guess about which call site was hit.
    dict(id="M20", guard="§21 — the settle honours offlineEnabled()",
         file=f"{OFF}/useDurableNote.js",
         find='  if (!offlineEnabled()) return null\n  // ⛔ NO STORE, NO MARKER, AND NO WAITING FOR ONE. A private window or an old\n  // browser has nowhere to write this, and without the check the save would pay\n  // the full write budget on every keystroke-debounced attempt while waiting for\n  // a connection that can never open. Cheap, and it is the honest answer: the\n  // marker is an optimisation, and the 409 check still covers the outcome.\n  if (!offlineStorageAvailable()) return null\n  const landed = usableBaseline(updatedAt)',
         repl='  // ⛔ NO STORE, NO MARKER, AND NO WAITING FOR ONE. A private window or an old\n  // browser has nowhere to write this, and without the check the save would pay\n  // the full write budget on every keystroke-debounced attempt while waiting for\n  // a connection that can never open. Cheap, and it is the honest answer: the\n  // marker is an optimisation, and the 409 check still covers the outcome.\n  if (!offlineStorageAvailable()) return null\n  const landed = usableBaseline(updatedAt)',
         note="with the flag off, a write is a write the rollback promised not to make"),

    # ⛔ M21 disables ONLY the post-409 pass, leaving the pre-send one intact.
    # That is the slow-PUT ordering exactly: the pre-send answer was a truthful
    # "no" and the ONLY thing standing between the member and a duplicate is
    # asking again after the send.
    dict(id="M21", guard="guard 2 is asked AGAIN on the 409, not only before the send",
         file=f"{OFF}/outboxDrain.js",
         find='          const mine = await askServerIfOurs(db, entry, serverCopyIsOurs)',
         repl="          const mine = null  // mutated: skip the second pass",
         note="the server answer CHANGES across the send; one pass gets one case wrong"),

    # ── the two defects that lost a member's words, 2026-09-10 ───────────────
    # ⛔ Both of these SHIPPED. Neither was visible to any mechanism-level rail;
    # both are visible to the property rail, which is why it exists.
    dict(id="M22", guard="a door treats NO LOCAL STATE as no evidence, not as caught-up",
         file=f"{NB}/NoteEditorPage.jsx",
         find="    const current = captureLocalState()",
         repl="    const current = captureLocalState() || saved",
         note="the exact shipped line: `|| saved` makes acked === current, reads as "
              "caught up, and DELETES the queued entry with the member's words in it"),

    dict(id="M23", guard='"ours" alone is NEVER a reason to remove a queued entry',
         file=f"{OFF}/outboxDrain.js",
         find="          if (mine?.ours && mine.identical) {",
         repl="          if (mine?.ours) {",
         note="the shipped rule. A door moves the revision, the ring says ours, and "
              "the entry is dropped though the server body never held its words"),

    # ⛔⛔ THE SHIPPED DEFAULT ITSELF. This mutation INVERTS WITH THE FLIP, in the
    # same commit: while the wave ships OFF it proves false→true reddens the
    # unset-branch rails; after the flip it becomes true→false and must redden
    # the post-flip unset-branch rails, which by then assert ON.
    # ⛔ Without it, the one value that decides what an UNSET key MEANS for every
    # member is the only constant in this layer with no mutation behind it — and
    # "off and unset" is indistinguishable from "off on purpose" precisely
    # because nothing forces the distinction.
    dict(id="M24", guard="the SHIPPED DEFAULT is what the unset-branch rails assert",
         file=f"{OFF}/offlineFlag.js",
         find="export const OFFLINE_DEFAULT_ON = true",
         repl="export const OFFLINE_DEFAULT_ON = false",
         note="flipping it silently changes what an unset key means for every member"),

    # ⛔⛔ Q1 FIX 3 — CLASSIFY BEFORE CHOOSING. The append-only merge existed and
    # was UNREACHABLE for any door this browser fired: the landed ring vouched
    # for the revision first and the drain rebased-and-resent the queued body
    # over the server's own appended block. A widget sent to the journal, a saved
    # price, a PDF excerpt — captured, confirmed, then gone when a queued edit
    # drained. Measured 24/24 metadata green and 0/18 append before the fix.
    # ⭐ The mutation is permanent BY OWNER RULING: this ordering is the whole
    # fix, it is one line, and a future refactor that hoists the ring back above
    # the classifier would restore the defect in silence.
    dict(id="M25", guard="Q1 fix 3 — the ring does not decide before the diff is read",
         file=f"{OFF}/outboxDrain.js",
         find="  if (shape === APPEND_ONLY) return { plan: 'merge', base, shape }",
         repl="  if (false && shape === APPEND_ONLY) return { plan: 'merge', base, shape }",
         note="with the merge unreachable, every append family loses the block the "
              "member just captured — and no metadata family notices"),

    dict(id="M26", guard="Q1 fix 3 - the ring-vouched question is asked in ONE place",
         file=f"{OFF}/outboxDrain.js",
         find="          const ring = ringVouchedPlan(mine, noteRec)",
         repl="          const ring = { plan: 'rebase', base: null, shape: null }\n"
              "          entry = await rebaseEntry(db, entry, mine.serverUpdatedAt)",
         note="the PRE-SEND site decides on the vouch alone again - the half that "
              "never 409s, so nothing downstream could ever catch it"),

    # ══════════════════════════════════════════════════════════════════════
    # WAVE K — the runtime kill switch. K-R1 … K-R10.
    # ══════════════════════════════════════════════════════════════════════
    # ⛔ HALF OF THIS WAVE IS PYTHON. Two of its guards live on the server and
    # are broken against pytest rails (`runner="pytest"`, `root="repo"`); a
    # gauntlet that could only reach vitest would have left them as "proved by
    # hand, once" — the evidence-outliving-the-experiment failure this whole
    # tool was written to end.
    #
    # ⛔ TEN RAILS, TEN MUTATIONS, AND THEY ARE NOT ONE-TO-ONE ON PURPOSE.
    # K-R9 has two halves — *fresh on the server, frozen per tab* — and they are
    # different guards in different languages (K9 and K5). K-R1 has a provider
    # and a consumer (K7 and K1), and breaking either loses the kill. One
    # mutation per rail would have meant writing the same guard twice, and a
    # guard repeated is a guard unproved.

    dict(id="K1", guard="K-R1 — the CONSUMER honours the served answer",
         file=f"{OFF}/offlineFlag.js",
         find="""  const served = notebookFlag('notebook_offline_default_on')
  return served === null ? OFFLINE_DEFAULT_ON : served""",
         repl="""  const served = notebookFlag('notebook_offline_default_on')
  void served
  return OFFLINE_DEFAULT_ON""",
         note="the switch is set, the payload carries it, and nothing reads it — "
              "a kill switch that answers correctly to nobody"),

    dict(id="K7", guard="K-R1/K-R7 — the PROVIDER answers at all",
         file=f"{OFF}/notebookFlags.js",
         find="""export function notebookFlag(key) {
  if (!latched) return null""",
         repl="""export function notebookFlag(key) {
  if (latched) return null""",
         note="with the latch mute, all sixteen doors fall back to the constant "
              "and the flip reaches no one"),

    dict(id="K2", guard="K-R2 — an OLDER BACKEND does not latch",
         file=f"{OFF}/notebookFlags.js",
         find="    if (!has) return null",
         repl="    if (false) return null",
         note="a payload with none of the keys is a stale pod, not a decision; "
              "latching from it kills the wave on one stale answer"),

    dict(id="K3", guard="K-R3 — the member's opt-out is TERMINAL",
         file=f"{OFF}/offlineFlag.js",
         find="    if (v === '0') return false",
         repl="    if (v === '0') { /* mutated: the member's own choice is ignored */ }",
         note="a member who switched this wave off must never be switched back on "
              "by a value somebody set in Railway"),

    dict(id="K4", guard="K-R4 — the first-render gate renders NOTHING before the answer",
         file=f"{NB}/NotebookFlagGate.jsx",
         find="  if (!ready && !timedOut) return fallback",
         repl="  if (false) return fallback",
         note="shape B in one line: the durable layer mounts, opens the account's "
              "IndexedDB and takes the sync lock before the server's false arrives"),

    dict(id="K5", guard="K-R5/K-R9 — FROZEN PER TAB: the first payload wins",
         file=f"{OFF}/notebookFlags.js",
         find="""      return latched
    }
    if (!payload) return null""",
         repl="""      latched = null
    }
    if (!payload) return null""",
         note="unlatched, `offlineEnabled()` can answer no between a PUT going out "
              "and its ack coming back — the one thing §21 cannot survive"),

    dict(id="K10", guard="K-R10 — every auth path applies the one map",
         file="src/context/AuthContext.jsx",
         find="""    applyServerFlags(data)
    return data
  }

  const signup""",
         repl="""    // MUTATED: the TOTP path stops applying the server flags
    return data
  }

  const signup""",
         note="a flag wired into three paths and missed in the fourth works for "
              "everyone except the members who take that door"),

    dict(id="K6", guard="K-R6 — the env var and the payload key are DERIVED",
         runner="pytest", root="repo",
         file="api/routers/auth.py",
         find="    return env_name.lower()",
         repl='    return env_name.lower().replace("notebook_", "nb_")',
         note="two names for one flag, drifting apart with nothing to notice"),

    dict(id="K9", guard="K-R9 — FRESH ON THE SERVER: read per request, not at import",
         runner="pytest", root="repo",
         file="api/routers/auth.py",
         find="""    out = {}
    for env_name, default_on in NOTEBOOK_FLAGS.items():""",
         repl="""    out = _notebook_flags.__dict__.setdefault("mutant_cache", {})
    if out:
        return dict(out)
    for env_name, default_on in NOTEBOOK_FLAGS.items():""",
         note="captured once, the flip needs a redeploy and every no-redeploy "
              "sentence in the flip packet is a fiction"),

    dict(id="K8", guard="K-R8 — the reach statement is VERBATIM in all five places",
         runner="pytest", root="repo",
         file="tools/window_check.py",
         find='"until K-1."',
         repl='"until K-1 (see the spec)."',
         note="the last rollback sentence that drifted took eleven evidence rows "
              "to find, and it is read at the worst possible moment"),

    dict(id="M12", guard="the editor emits NOTHING when it sets content itself",
         file=f"{NB}/NoteEditorPage.jsx",
         find="const EMIT_NOTHING = { emitUpdate: false }",
         repl="const EMIT_NOTHING = { emitUpdate: true }",
         note="onUpdate fires when the DATA changed, not when a PERSON did"),

]


# ⛔⛔ WAVE K PUT HALF OF ITSELF IN PYTHON, so half of its guards cannot be
# broken against a vitest rail. The kill switch is served by `_access_payload`
# and its two load-bearing properties — the env↔key derivation and the
# PER-REQUEST read — are pytest rails. A gauntlet that could only run vitest
# would have recorded those two guards as "proved by hand, once", which is the
# precise failure this tool's docstring was written about: the evidence
# outliving the experiment.
PY_RAILS = [
    "tests/test_notebook_flags.py",
    "tests/test_hub_preview_flag.py",
    "tests/test_k_reach_statement.py",
]


def rails_argv() -> list[str]:
    return RAIL_DIRS + RAIL_FILES


def run_rails(run) -> tuple[int, int, list[str]]:
    """→ (failed_tests, passed_tests, failing_files). Totals line or it did not run."""
    out = run(["npx", "vitest", "run", *rails_argv()])
    clean = re.sub(r"\x1b\[[0-9;]*m", "", out)
    m_tests = re.search(r"^\s*Tests\s+(.+)$", clean, re.M)
    m_files = re.search(r"^\s*Test Files\s+(.+)$", clean, re.M)
    if not m_tests or not m_files:
        raise SystemExit(
            "  ⛔ NO TOTALS LINE — the rails did not run. A run without a totals "
            "line is not a run, and a mutation judged on one is worse than none.")
    failed = int(re.search(r"(\d+) failed", m_tests.group(1)).group(1)) if "failed" in m_tests.group(1) else 0
    passed = int(re.search(r"(\d+) passed", m_tests.group(1)).group(1)) if "passed" in m_tests.group(1) else 0
    # ⛔ NAMES, NOT A COUNT. "3 red" tells you a guard is railed; WHICH rails went
    # red tells you whether it is railed in the right place. The first version of
    # this matched only vitest's `FAIL <path>` banner and printed "(unnamed)" for
    # every mutation, which is the same names-not-counts defect the ledger and the
    # shard gate each had to fix.
    files = set(re.findall(r"(?:FAIL|❯)\s+(\S*?[\w.-]+\.test\.jsx?)", clean))
    files |= set(re.findall(r"^\s*(?:FAIL|×|✗)\s+(\S*?[\w.-]+\.test\.jsx?)", clean, re.M))
    return failed, passed, sorted(files)


def run_py_rails(run_py) -> tuple[int, int, list[str]]:
    """The pytest half. → (failed, passed, failing node ids).

    ⛔ SAME REFUSAL AS THE VITEST HALF. pytest prints its own totals line and a
    run that dies at collection prints none; reading the exit code instead is
    how a gate reports green for a suite that never started.
    """
    out = run_py([sys.executable, "-m", "pytest", *PY_RAILS, "-q", "-p", "no:warnings"])
    clean = re.sub(r"\x1b\[[0-9;]*m", "", out)
    # pytest's summary is the LAST line carrying "N passed" / "N failed".
    lines = [ln for ln in clean.splitlines()
             if re.search(r"\b\d+ (?:passed|failed)\b", ln)]
    if not lines:
        raise SystemExit(
            "  ⛔ NO PYTEST TOTALS LINE — the rails did not run. A run without a "
            "totals line is not a run, and a mutation judged on one is worse than none.")
    line = lines[-1]
    failed = int(re.search(r"(\d+) failed", line).group(1)) if "failed" in line else 0
    passed = int(re.search(r"(\d+) passed", line).group(1)) if "passed" in line else 0
    names = sorted(set(re.findall(r"^FAILED (\S+)", clean, re.M)))
    return failed, passed, names


def apply(path: pathlib.Path, find: str, repl: str) -> str:
    original = path.read_text(encoding="utf-8")
    n = original.count(find)
    if n != 1:
        raise SystemExit(
            f"  ⛔ {path.name}: the mutation site occurs {n} times, not once. An "
            f"ambiguous mutation is a guess about which call site was hit.")
    path.write_text(original.replace(find, repl), encoding="utf-8")
    return original


def restore(path: pathlib.Path, original: str) -> None:
    path.write_text(original, encoding="utf-8")
    if path.read_text(encoding="utf-8") != original:
        raise SystemExit(f"  ⛔ {path.name}: RESTORE FAILED — stop and fix by hand.")


def self_check() -> int:
    bad = 0

    def case(name, ok):
        nonlocal bad
        print(f"  {'ok ' if ok else 'FAIL'}  {name}")
        bad += 0 if ok else 1

    # A totals line that is absent must raise, never be read as zero failures.
    try:
        run_rails(lambda _a: "some output with no totals at all")
        case("a run with NO totals line is refused", False)
    except SystemExit:
        case("a run with NO totals line is refused", True)

    fake = "Test Files  2 failed | 15 passed (17)\nTests  3 failed | 173 passed (176)\n"
    f, p, _ = run_rails(lambda _a: fake)
    case("a totals line is parsed as failures, not as text", f == 3 and p == 173)

    # ⛔ THE PYTEST HALF REFUSES THE SAME WAY. Wave K put two guards on the
    # server, so the gauntlet grew a second runner — and a second runner that
    # could not tell "0 failed" from "never ran" would report a green gauntlet
    # for a suite that died at collection.
    try:
        run_py_rails(lambda _a: "collected 0 items / 1 error, and no summary")
        case("a PYTEST run with no totals line is refused", False)
    except SystemExit:
        case("a PYTEST run with no totals line is refused", True)

    fy, py_, names = run_py_rails(
        lambda _a: ("FAILED tests/test_notebook_flags.py::test_x - AssertionError\n"
                    "2 failed, 55 passed in 1.20s\n"))
    case("a pytest totals line is parsed as failures, not as text", fy == 2 and py_ == 55)
    case("…and the failing NODE IDS are named, never just counted",
         names == ["tests/test_notebook_flags.py::test_x"])

    # An ambiguous site must refuse rather than mutate an arbitrary occurrence.
    import tempfile
    with tempfile.TemporaryDirectory() as d:
        t = pathlib.Path(d) / "x.js"
        t.write_text("a\na\n", encoding="utf-8")
        try:
            apply(t, "a", "b")
            case("a site occurring twice is refused", False)
        except SystemExit:
            case("a site occurring twice is refused", True)
        t.write_text("keep me\n", encoding="utf-8")
        orig = apply(t, "keep me", "broken")
        restore(t, orig)
        case("restore puts the ORIGINAL bytes back", t.read_text(encoding="utf-8") == "keep me\n")

    # ⛔ THE RAIL SET MUST COVER EVERY TEST THAT NAMES A GUARD, wherever it sits.
    # This case exists because the directory-only derivation missed
    # `lib/setContentEmitsUpdate.test.js` and reported EMIT_NOTHING as untested.
    # A harness that under-reports coverage is worse than one that under-reports
    # failures: it invites you to delete a guard that was fine.
    j2 = APP / "src/pages/journal-2-0"
    covered = set()
    for d in RAIL_DIRS:
        covered |= {p.resolve() for p in (APP / d).glob("*.test.js*")}
    covered |= {(APP / f).resolve() for f in RAIL_FILES}
    naming = set()
    for p_ in j2.rglob("*.test.js*"):
        try:
            body = p_.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        if any(g in body for g in GUARD_NAMES):
            naming.add(p_.resolve())
    missed = sorted(p_.name for p_ in naming - covered)
    case(f"the rail set covers every test naming a guard{'' if not missed else ' — MISSED ' + ', '.join(missed)}",
         not missed)
    # ...and a control: the property must actually select files, or the case above
    # passes because it found nothing to check.
    case("the guard-name sweep is not vacuous (it selects real files)", len(naming) >= 10)

    # Every declared mutation site must exist exactly once in the real tree.
    for m in MUTATIONS:
        p_ = (REPO if m.get("root") == "repo" else APP) / m["file"]
        n = p_.read_text(encoding="utf-8").count(m["find"]) if p_.exists() else 0
        case(f"{m['id']}: its guard is present exactly once", n == 1)

    print("self-check:", "PASS" if not bad else f"FAIL ({bad})")
    return 1 if bad else 0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--only")
    ap.add_argument("--self-check", action="store_true")
    args = ap.parse_args()
    if args.self_check:
        return self_check()

    def run(argv):
        return subprocess.run(argv, cwd=APP, capture_output=True,
                              encoding="utf-8", errors="replace", shell=True).stdout

    def run_py(argv):
        # ⛔ cwd=REPO, not APP: pytest resolves `tests/...` and the repo-root
        # conftest (the shared-data-root tripwire) from the repository root, and
        # a run started anywhere else silently loses both.
        return subprocess.run(argv, cwd=REPO, capture_output=True,
                              encoding="utf-8", errors="replace").stdout

    def site_of(m):
        return (REPO if m.get("root") == "repo" else APP) / m["file"]

    todo = list(MUTATIONS)
    if args.only:
        todo = [m for m in todo if m["id"] == args.only]

    print("⭐ CONTROL FIRST — the rails must be GREEN before anything is broken.")
    f0, p0, _ = run_rails(run)
    if f0:
        print(f"  ⛔ {f0} rail(s) already red. A mutation proves nothing against a red control.")
        return 1
    # ⛔ BOTH halves, and the pytest control runs even when no pytest mutation
    # is selected: a --only K1 that skipped it would report a green gauntlet
    # over a rail set half of which was never executed.
    fy0, py0, _ = run_py_rails(run_py)
    if fy0:
        print(f"  ⛔ {fy0} SERVER rail(s) already red. A mutation proves nothing.")
        return 1
    print(f"  control: {p0} browser + {py0} server tests green\n")

    rows = []
    for m in todo:
        path = site_of(m)
        original = apply(path, m["find"], m["repl"])
        try:
            if m.get("runner") == "pytest":
                failed, _passed, files = run_py_rails(run_py)
            else:
                failed, _passed, files = run_rails(run)
        finally:
            restore(path, original)
        rows.append((m, failed, files))
        mark = "🔴" if failed else "⛔ DID NOT REDDEN"
        print(f"  {m['id']:<4} {mark} {failed:>3} red   {m['guard']}")
        if not failed:
            print(f"        ⛔ a guard nothing tests. {m['note']}")
        else:
            print(f"        files: {', '.join(f.split('/')[-1] for f in files) or '(unnamed)'}")

    print("\n⭐ CONTROL AGAIN — every file restored, the rails must be green once more.")
    f1, p1, _ = run_rails(run)
    fy1, py1, _ = run_py_rails(run_py)
    print(f"  after restore: {p1} browser + {py1} server green, {f1 + fy1} red")
    dull = [m["id"] for m, failed, _ in rows if not failed]
    ok = not dull and f1 == 0 and fy1 == 0 and p1 == p0 and py1 == py0
    print("\nGAUNTLET:", "PASS — every guard reddened its own rails" if ok
          else f"FAIL — dulled: {dull or 'none'}; control drift: "
               f"{p0}->{p1} browser, {py0}->{py1} server")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
