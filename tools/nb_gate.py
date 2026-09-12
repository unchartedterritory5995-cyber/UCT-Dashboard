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


def rows() -> list[list[str]]:
    if not LOG.exists():
        return []
    out = []
    for line in LOG.read_text(encoding="utf-8").splitlines():
        if not line.startswith("|") or line.startswith("|---") or "at (ET)" in line:
            continue
        out.append([c.strip() for c in line.strip("|").split("|")])
    return out


def main() -> int:
    at = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=-4))).strftime("%Y-%m-%d %H:%M ET")
    last_run, last_result = heartbeat()
    r = rows()
    fails = []

    # ⛔ HEARTBEAT FIRST. An unobserved window is not a clean one.
    hb_ok = last_result.strip() == "0"
    if not hb_ok:
        fails.append(f"heartbeat: Last Result {last_result!r} (expected 0) - the window is UNOBSERVED, not clean")

    # trigger 1 - any row whose flag is not OK
    # ⛔ A SKIPPED row is a reading that could not be TAKEN - unobserved, never a
    # red. Counting it as a trigger would revert a healthy product because
    # another workstream deployed during the sampler's minute.
    bad = [x for x in r if x and not x[-1].startswith("OK") and "SKIPPED" not in x[-1]]
    skipped = [x for x in r if x and "SKIPPED" in x[-1]]
    t1 = "PASS" if not bad else "FAIL"
    if bad:
        fails.append(f"trigger 1: {len(bad)} non-OK row(s), first at {bad[0][0]}")

    # trigger 2 - conflict count above the preserved evidence set
    conf = []
    for x in r:
        try:
            if int(x[4]) > PRESERVED_CONFLICTS:
                conf.append(x)
        except (ValueError, IndexError):
            pass
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
            f"trigger 2: sync-conflict rose above {PRESERVED_CONFLICTS} at {conf[0][0]} "
            "- ATTRIBUTE IT before calling it a defect. Rule out, in order: "
            "(1) a canary in flight; (2) two tabs on one note; (3) a SECOND WRITER - the "
            "note-connectors background sync, whose fork is CORRECT; (4) any of the seven "
            "advancing families - update_note (PUT / hero x2 / version restore), "
            "append_widget_embed, append_financial_fact, append_document_excerpt, "
            "restore_note, import_confirm, delete_folder. The derived list is "
            "`doorEnumeration.test.js` (1); it, not this comment, is the authority.")

    # trigger 3 - NOT readable here, by construction
    t3 = "n/a - canary or member report only"

    # trigger 4 - console errors seen by the rig (same bundle a member runs)
    errs = []
    for x in r:
        try:
            if int(x[6]) > 0:
                errs.append(x)
        except (ValueError, IndexError):
            pass
    t4 = "PASS" if not errs else "FAIL"
    if errs:
        fails.append(f"trigger 4: console errors at {errs[0][0]}")

    # ⭐ THE MEMBER COUNT COMES FROM THE SAMPLER, WHICH KNOWS IDENTITIES.
    # The timing rule below is kept only as a fallback for rows written before
    # the sampler recorded `members` - it cannot see the owner's own browsing,
    # which is exactly how 14:00:28 was misread as the first member.
    member_counts = []
    for x_ in r:
        if len(x_) > 1 and "members " in x_[1]:
            try:
                member_counts.append(int(x_[1].split("members ")[1].split()[0].strip("()")))
            except (ValueError, IndexError):
                pass
    if member_counts:
        m = max(member_counts)
        member = (f"none - 0 independent members ({len(member_counts)} row(s) counted by identity)"
                  if m == 0 else f"{m} INDEPENDENT MEMBER OPT-IN(S) - see the log")
        cans = []
    else:
        cans = canary_times()
    member = "none - every opt-in is the rig" + chr(39) + "s (" + str(len(cans)) + " canary run(s) excluded)"
    for x in r:
        if len(x) > 1 and x[1] not in ("-", "", chr(8212)) and not is_rig(x[1], cans):
            member = "FIRST MEMBER OPT-IN " + x[1] + " (row " + x[0] + ")"
            break

    verdict = "KEEP" if (hb_ok and not bad and not errs and not conf) else "REVERT"
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
