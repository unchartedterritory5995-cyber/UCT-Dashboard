"""Wave Q1 — the Sunday gate reading, written to a file for a PERSON to act on.

⛔⛔ IT DOES NOT MERGE ANYTHING. A REVERT verdict is WRITTEN, never executed. An
instrument that can deploy is an instrument that can deploy by mistake, and this
wave produced seven instrument defects - every one of which made the product look
broken. The one thing none of them could do was ship.

Reads the observation log against the four triggers in
`docs/notebook/wave-q1-sunday-gate.md`, checks the sampler's heartbeat, and writes
`wave-q1-gate-verdict.md`. Run it any time; it is idempotent.
"""
from __future__ import annotations

import datetime
import os
import pathlib
import re
import subprocess
import sys

HERE = pathlib.Path(__file__).resolve().parent
LOG = pathlib.Path(os.environ.get("NB_OBSERVE_LOG", "") or (HERE / "wave-q1-observation-log.md"))
OUT = pathlib.Path(os.environ.get("NB_GATE_VERDICT", "") or (HERE / "wave-q1-gate-verdict.md"))

# A FIXED CONSTANT HERE WOULD MANUFACTURE A MEMBER OUT OF THE INSTRUMENT.
#
# This was RIG_LAST alone, and every canary run moves the feed past it: the
# Saturday canary fired its own opt-in 12 seconds after its sentinel, so the gate
# would have reported "FIRST MEMBER OPT-IN 2026-09-12 13:33:06" - the
# instrument's own activity read as the population's, on the one evening that
# reading decides a rollback. That is the round-3 shape exactly.
#
# So canary times are DERIVED from the rows the canary itself stamps, never typed
# a second time. Any opt-in within CANARY_WINDOW_S of a stamped canary is ours.
RIG_LAST = "2026-09-12 05:17:56"          # the last opt-in BEFORE any canary row
CANARY_WINDOW_S = 300
_RESUME_DEFAULT = "C:" + '\\' + "Users" + '\\' + "Patrick" + '\\' + "uct-worktrees" + '\\' + "notebook-flip" + '\\' + "docs" + '\\' + "notebook" + '\\' + "wave-q1-RESUME-HERE.md"
RESUME = pathlib.Path(os.environ.get("NB_RESUME_DOC", "") or _RESUME_DEFAULT)

# C-4 - the DO-NOT-BUILD sweep, run in every gate (owner ruling 2026-09-13).
#
# !! THIS FILE RUNS FROM A COPY OUTSIDE EVERY WORKTREE, so it cannot find the
# repo by walking up from itself the way the sweep tool does. The path is an
# absolute default with an env override - the same shape RESUME already uses,
# and for the same reason. A wrong path reports DID NOT RUN, which is a
# different fact from a clean sweep and is printed as one.
_REPO_DEFAULT = "C:\\Users\\Patrick\\uct-worktrees\\notebook-k"
GATE_REPO = pathlib.Path(os.environ.get("NB_GATE_REPO", "") or _REPO_DEFAULT)


def do_not_build() -> str:
    """One line for the verdict: did any DO-NOT-BUILD item gain code?

    !! IT IS NOT A TRIGGER. This gate decides whether to revert Wave Q1 over an
    OBSERVATION WINDOW; a static sweep of the repo says nothing about that
    window, and wiring it to the verdict would let a regex revert a healthy
    product. It is reported so the owner reads it every Sunday, and nothing more.
    """
    tool = GATE_REPO / "tools" / "q1_do_not_build_sweep.py"
    if not tool.exists():
        return f"DID NOT RUN - no sweep tool at {tool} (this is not a clean result)"
    try:
        proc = subprocess.run([sys.executable, str(tool), '--quiet'], cwd=str(GATE_REPO),
                              capture_output=True, text=True, encoding='utf-8',
                              errors='replace', timeout=180)
    except (OSError, subprocess.SubprocessError) as e:
        return f"DID NOT RUN - {type(e).__name__}: {e} (this is not a clean result)"
    out = ((proc.stdout or '') + (proc.stderr or '')).strip().splitlines()
    head = out[0] if out else '(no output)'
    if proc.returncode == 0:
        return f"CLEAN - {head}"
    hits = [ln.strip() for ln in out if ': ' in ln and ':' in ln.split(': ')[-1]]
    return ("MATCHES - each is a QUESTION, not a verdict: "
            + '; '.join(hits[:6]) + (' ...' if len(hits) > 6 else ''))


def canary_times() -> list:
    """Every canary run stamped UTC time, from the doc the canary writes."""
    if not RESUME.exists():
        return []
    out = []
    pat = "[*][*](20[0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]Z)[*][*]"
    for m in re.finditer(pat, RESUME.read_text(encoding='utf-8')):
        try:
            out.append(datetime.datetime.strptime(m.group(1), "%Y-%m-%dT%H:%M:%SZ"))
        except ValueError:
            pass
    return out


def is_rig(stamp: str, canaries: list) -> bool:
    """True when this opt-in falls inside a canary window - i.e. it is ours."""
    try:
        t = datetime.datetime.strptime(stamp.strip(), "%Y-%m-%d %H:%M:%S")
    except ValueError:
        return True                       # unparseable: do NOT claim a member
    if stamp.strip() <= RIG_LAST:
        return True
    return any(abs((t - c).total_seconds()) <= CANARY_WINDOW_S for c in canaries)
PRESERVED_CONFLICTS = 3          # the round-3 evidence set; historical, never new


def heartbeat() -> tuple[str, str]:
    """Task Scheduler is the ONLY signal that the job ran at all."""
    try:
        out = subprocess.run(["schtasks", "/Query", "/TN", "UCT-WaveQ1-Observe", "/FO", "LIST", "/V"],
                             capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=60).stdout
        last = re.search(r"Last Run Time:\s*(.+)", out)
        res = re.search(r"Last Result:\s*(.+)", out)
        return (last.group(1).strip() if last else "UNREADABLE",
                res.group(1).strip() if res else "UNREADABLE")
    except Exception as e:                                   # noqa: BLE001
        return (f"ERR {type(e).__name__}", "ERR")


# =============================================================================
# COLUMNS ARE RESOLVED BY NAME, FROM THE LOG'S OWN HEADER.
# =============================================================================
# !!!! A POSITIONAL INDEX IS A SECOND AUTHORITY OVER A SCHEMA, and this one was
# already wrong when it was found (2026-09-13, hours before the run it decides).
#
# The log carries THREE header blocks - 8, 8 and 9 columns - because the
# config-served column landed mid-window. Trigger 2 read `x[4]` and trigger 4
# read `x[6]`, correct for the 8-column schema and OFF BY ONE for every row
# written since: `x[4]` became blocked-baseline instead of sync-conflict, and
# `x[6]` became outbox instead of console errors. Both triggers were reading a
# different column from the one they name, on the newest rows, silently.
#
# * So each row is bound to the header block it sits under, and a trigger asks
# for a column BY NAME. A header spelling this table does not know is a LOUD
# failure, never a silent shift - the schema may change again, and the next
# change must break the gate rather than quietly re-aim it.
_COLUMNS = {
    "at (et)": "at",
    "opt-in (member, old schema)": "optin_member_old",
    "latest opt-in (utc)": "latest_optin",
    "opt-in (windowed)": "optin_windowed",
    "config-served (members)": "config_served",
    "blocked-baseline": "blocked",
    "sync-conflict": "conflicts",
    "sync-conflict notes": "conflicts",
    "outbox": "outbox",
    "console errors": "console",
    "flag": "flag",
}


def canonical(header_cell: str) -> str | None:
    """A header cell -> its canonical key, or None when nothing here knows it.

    ! The parenthetical is dropped ONLY when the stem alone is unambiguous.
    `opt-in (windowed)` and `opt-in (member, OLD schema)` share a stem and are
    DIFFERENT columns, so both full spellings are listed above and the stem
    `opt-in` is deliberately not a key.
    """
    k = re.sub(r'[\s]+', ' ', header_cell.strip().lower())
    if k in _COLUMNS:
        return _COLUMNS[k]
    stem = re.split(r'\s*[(\u2014]', k)[0].strip()
    if stem in _COLUMNS and stem != 'opt-in':
        return _COLUMNS[stem]
    return None


# An observation row is identified by its OWN FIRST COLUMN, never by 'starts
# with a pipe'.
#
# !!!! THE LOG ALSO CARRIES A PROSE TABLE - the member identity/exclusion list
# that came with the attributable-member report - whose rows start with a pipe
# and end in `**no**` / `**YES**`. The old predicate read all five as
# observation rows; none starts with 'OK' and none says SKIPPED, so trigger 1
# counted five reds that do not exist. Measured against the LIVE log:
# 'trigger 1: 5 non-OK row(s), first at identity', VERDICT REVERT, with nothing
# wrong with the wave.
_ROW_AT = re.compile(r'^20[0-9]{2}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2} ET$')


def is_observation_row(cells: list[str]) -> bool:
    """True only for a row the sampler wrote. Pure, so it is testable."""
    return bool(cells) and bool(_ROW_AT.match(cells[0].strip()))


def parsed_rows() -> tuple[list[dict], list[str]]:
    """Every observation row as {canonical column: value}, plus any complaints.

    !! A COMPLAINT IS NOT A RED. An unknown header or a row whose width does not
    match its header means this gate cannot READ that row - which is a different
    fact from the row being bad, and is reported as its own line rather than
    folded into a trigger.
    """
    if not LOG.exists():
        return [], ['no observation log at ' + str(LOG)]
    out, gripes, keys = [], [], None
    for line in LOG.read_text(encoding='utf-8').splitlines():
        if not line.startswith('|') or line.startswith('|---'):
            continue
        cells = [c.strip() for c in line.strip('|').split('|')]
        if 'at (ET)' in line:
            keys = [canonical(c) for c in cells]
            unknown = [c for c, k in zip(cells, keys) if k is None]
            if unknown:
                gripes.append('header column(s) this gate cannot name: '
                              + ', '.join(repr(u) for u in unknown))
            continue
        if not is_observation_row(cells):
            continue
        if keys is None:
            gripes.append('a row appeared before any header: ' + cells[0])
            continue
        if len(cells) != len(keys):
            gripes.append('row ' + cells[0] + ' has ' + str(len(cells))
                          + ' cell(s) under a ' + str(len(keys)) + '-column header')
            continue
        rec = {k: v for k, v in zip(keys, cells) if k}
        rec['_cells'] = cells
        out.append(rec)
    return out, gripes


def rows() -> list[list[str]]:
    """The raw cells, kept for callers that want the line as written."""
    return [r['_cells'] for r in parsed_rows()[0]]


def number(rec: dict, key: str):
    """A column as an int, or None when it is not a number.

    !! None IS NOT ZERO. A SKIPPED row writes an em dash, and a value that could
    not be READ must never be counted as a value of zero - the same distinction
    `_doc_text(None) == \'\'` got wrong twice in this wave.
    """
    try:
        return int(str(rec.get(key, '')).strip())
    except (TypeError, ValueError):
        return None


def is_skipped(rec: dict) -> bool:
    """ONE authority over 'this reading could not be taken'.

    !!!! IT WAS THREE COPIES AND ONLY ONE OF THEM EXISTED. Trigger 1 excluded
    SKIPPED rows; trigger 4 did not, and the 2026-09-12 23:00 SKIP - production
    unreachable mid-deploy - carried 20 console errors from a page that could not
    load. Trigger 4 read them as member-visible console errors and FAILED, which
    on its own would have printed REVERT tonight. A guard written once for one
    caller is a guard the next caller does not have
    (`lesson_a_guard_repeated_is_a_guard_unproved`).
    """
    return 'SKIPPED' in str(rec.get('flag', ''))


def main() -> int:
    at = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=-4))).strftime("%Y-%m-%d %H:%M ET")
    last_run, last_result = heartbeat()
    recs, gripes = parsed_rows()
    r = [x['_cells'] for x in recs]
    fails = []
    # !! A ROW THIS GATE COULD NOT READ IS ITS OWN FACT, reported beside the
    # triggers and never folded into one. 'I could not parse it' and 'it is bad'
    # are different, and collapsing them is how an instrument fault becomes a
    # product verdict.
    for g in gripes:
        fails.append('unreadable: ' + g)
    # ONE partition, used by every trigger below.
    observed = [x for x in recs if not is_skipped(x)]
    skipped_recs = [x for x in recs if is_skipped(x)]

    # ⛔ HEARTBEAT FIRST. An unobserved window is not a clean one.
    hb_ok = last_result.strip() == "0"
    if not hb_ok:
        fails.append(f"heartbeat: Last Result {last_result!r} (expected 0) - the window is UNOBSERVED, not clean")

    # trigger 1 - any row whose flag is not OK
    # ⛔ A SKIPPED row is a reading that could not be TAKEN - unobserved, never a
    # red. Counting it as a trigger would revert a healthy product because
    # another workstream deployed during the sampler's minute.
    bad = [x for x in observed if not str(x.get("flag", "")).startswith("OK")]
    skipped = skipped_recs
    t1 = "PASS" if not bad else "FAIL"
    if bad:
        fails.append(f"trigger 1: {len(bad)} non-OK row(s), first at {bad[0]['at']}")

    # trigger 2 - conflict count above the preserved evidence set
    # BY NAME, AND OVER OBSERVED ROWS ONLY. `x[4]` was sync-conflict under the
    # 8-column header and blocked-baseline under the 9-column one.
    conf = [x for x in observed
            if (number(x, 'conflicts') or 0) > PRESERVED_CONFLICTS]
    t2 = "PASS" if not conf else "NEEDS ATTRIBUTION"
    if conf:
        # ⛔⛔ ATTRIBUTION NOW HAS SEVEN FAMILIES TO RULE OUT, NOT FOUR.
        #
        # ⚰️ This wave recorded "the FOUR doors - every path that advances
        # updatedAt" and named body/folder/ticker/tags. Re-derived from the SQL
        # on 2026-09-12: SEVEN server-side functions advance a note, through nine
        # routes and sixteen client call sites. A new `sync-conflict` is not a
        # defect until every one of them is ruled out, and the list an operator
        # checks against has to be the derived one - that is the whole reason
        # `hero` shipped unsettled for a wave.
        fails.append(
            f"trigger 2: sync-conflict rose above {PRESERVED_CONFLICTS} at {conf[0]['at']} "
            "- ATTRIBUTE IT before calling it a defect. Rule out, in order: "
            "(1) a canary in flight; (2) two tabs on one note; (3) a SECOND WRITER - the "
            "note-connectors background sync, whose fork is CORRECT; (4) any of the seven "
            "advancing families - update_note (PUT / hero x2 / version restore), "
            "append_widget_embed, append_financial_fact, append_document_excerpt, "
            "restore_note, import_confirm, delete_folder. The derived list is "
            "`doorEnumeration.test.js` (1); it, not this comment, is the authority.")



    # ⛔⛔ AND ONE MEMBER REPORT IS NOW A KNOWN, FIXED DEFECT — NOT A TRIGGER.

    #

    # A member saying "I sent a chart to my journal / saved a price / saved a PDF

    # excerpt, and it VANISHED after reconnect" is Q1 fix 3, fixed at 9a213bd45.

    # The landed ring vouched for the revision and the drain rebased-and-resent

    # the queued body over the server's own appended block, so the append-only

    # merge was unreachable for any door that browser fired.

    #

    # ⭐ It is ATTRIBUTABLE and it is NOT a reason to revert the wave: the wave is

    # what makes the merge possible at all, and reverting would return that member

    # to a product with no queue to lose the block from. Check the SHA the pod is

    # serving; if fix 3 is an ancestor, the report predates the fix.

    # trigger 3 - NOT readable here, by construction
    t3 = "n/a - canary or member report only"

    # trigger 4 - console errors seen by the rig (same bundle a member runs)
    # !!!! OBSERVED ROWS ONLY, and BY NAME. This read `x[6]` over EVERY row: the
    # 2026-09-12 23:00 SKIP (production unreachable mid-deploy) carries 20 console
    # errors from a page that could not load, and `x[6]` is `outbox` under the
    # 9-column header anyway. Either fault alone printed REVERT.
    errs = [x for x in observed if (number(x, 'console') or 0) > 0]
    t4 = "PASS" if not errs else "FAIL"
    if errs:
        fails.append(f"trigger 4: console errors at {errs[0]['at']}")

    # ⭐ THE MEMBER COUNT COMES FROM THE SAMPLER, WHICH KNOWS IDENTITIES.
    # The timing rule below is kept only as a fallback for rows written before
    # the sampler recorded `members` - it cannot see the owner's own browsing,
    # which is exactly how 14:00:28 was misread as the first member.
    member_counts = []
    for x_ in recs:
        cell = str(x_.get('latest_optin') or x_.get('optin_member_old') or '')
        if "members " in cell:
            try:
                member_counts.append(int(cell.split("members ")[1].split()[0].strip("()")))
            except (ValueError, IndexError):
                pass
    # !!!! THE IDENTITY COUNT WAS COMPUTED AND THROWN AWAY.
    #
    # This block used to assign `member` from the sampler's identity count and
    # then OVERWRITE it unconditionally on the very next line, so the
    # authoritative answer never reached the verdict file. Worse, the branch
    # also emptied `cans`, so the timing fallback then ran against ZERO canary
    # windows - and every canary opt-in would have been reported as a member.
    #
    # * IT SURVIVED BECAUSE A SECOND BUG HID IT. The fallback read the WHOLE
    # cell (`2026-09-12 15:45:46 · members 0`), which no date parser
    # accepts, and `is_rig` answers True for anything unparseable - never claim a
    # member from a value you could not read. Fixing the parsing to address
    # columns by name made the cell parse, and the hidden bug came straight out:
    # the live log then read FIRST MEMBER OPT-IN 2026-09-12 15:45:46, on a row
    # whose own identity count says `members 0`.
    #
    # * So the two answers are ordered, not merged. The sampler KNOWS identities;
    # the timing rule only guesses from when an event landed, and it cannot see
    # the owner's own browsing - which is exactly how 14:00:28 was misread as the
    # first member. Identity wins whenever it is present.
    if member_counts:
        m = max(member_counts)
        member = (f"none - 0 independent members ({len(member_counts)} row(s) "
                  "counted by identity)"
                  if m == 0 else f"{m} INDEPENDENT MEMBER OPT-IN(S) - see the log")
    else:
        # No row carries an identity count - every row predates the sampler
        # learning to take one. Fall back to the timing rule, WITH its canary
        # windows, and say in the line itself which rule answered.
        cans = canary_times()
        member = ("none - every opt-in is the rig" + chr(39) + "s ("
                  + str(len(cans)) + " canary run(s) excluded; timing rule, "
                  "no identity count in any row)")
        for x in recs:
            cell = str(x.get('latest_optin') or x.get('optin_member_old') or '')
            stamp = cell.split(' ' + chr(183) + ' ')[0].strip()
            if stamp not in ('-', '', chr(8212), '0') and not is_rig(stamp, cans):
                member = ('FIRST MEMBER OPT-IN ' + stamp + ' (row ' + x['at']
                          + ', timing rule)')
                break

    dnb = do_not_build()
    # ! AN UNREADABLE ROW IS NOT A CLEAN ONE. It does not make the wave bad, so it
    # does not say REVERT on its own - it says the reading is INCOMPLETE, which is
    # the third state this programme keeps having to re-learn.
    unreadable = bool(gripes)
    verdict = "KEEP" if (hb_ok and not bad and not errs and not conf) else "REVERT"
    if verdict == 'KEEP' and unreadable:
        verdict = 'INCOMPLETE - the log has rows this gate could not read; see below'

    # ⛔⛔ A KEEP OVER ZERO REAL MEMBERS IS NOT POPULATION EVIDENCE.
    #
    # Every trigger below reads clean when nobody has run the layer - that is
    # what clean looks like over an EMPTY SET, and a bare "KEEP" in this file
    # would be read next week as "a week of members found nothing". It is the
    # same shape as a green browser matrix over a mount path nobody covered,
    # which is the error that gave this wave its incident.
    #
    # ⭐ So the verdict SAYS SO. The gate still keeps - there is nothing to
    # revert for - but it can never look like evidence it does not have.
    no_member = member.startswith("none")
    if verdict == "KEEP" and no_member:
        verdict = ("KEEP — no independent member exposure; 0 blocked-baseline "
                   "events measured over 0 real members")
    skip_note = ("" if not skipped else
                 f"{chr(10)}⚠️ {len(skipped)} SKIPPED row(s) - those intervals were UNOBSERVED, "
                 f"not clean.{chr(10)}")
    body = f"""# Wave Q1 — gate verdict

VERDICT: **{verdict}**
at:        {at}
heartbeat: Last Run Time {last_run} | Last Result {last_result}
rows read: {len(r)} ({len(skipped)} skipped){skip_note}  ({r[0][0] if r else 'none'} .. {r[-1][0] if r else 'none'})
member:    {member}
do-not-build: {dnb}

| trigger | result |
|---|---|
| 1 · unexplained red | {t1} |
| 2 · unattributable fork | {t2} |
| 3 · outbox stuck >5 min | {t3} |
| 4 · member console error | {t4} |

"""
    NLV = chr(10)
    if fails:
        body += '## Why this is not a clean KEEP' + NLV + NLV
        body += NLV.join('- ' + f for f in fails) + NLV + NLV
    tail = [
        '- This file does not merge anything. A REVERT verdict is a reading for a person',
        '  to act on: merge the draft rollback PR for',
        '  `rollback/notebook-offline-default-off` @ `3db89e205` with a MERGE COMMIT,',
        '  then verify `offlineFlag.js` reads `false` on `origin/master` and that `web`',
        '  redeployed. Full procedure: `docs/notebook/wave-q1-sunday-gate.md`.',
    ]
    body += NLV.join(tail) + NLV
    OUT.write_text(body, encoding="utf-8")
    print(body)
    return 0


if __name__ == "__main__":
    sys.exit(main())
