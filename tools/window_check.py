"""Wave Q1 — ONE COMMAND FOR A WINDOW-WATCH CHECK, INCLUDING A DAILY MINI-CANARY.

    python tools/window_check.py                 # run a check and stamp a row
    python tools/window_check.py --self-check    # prove every refusal fires
    python tools/window_check.py --dry-run       # run, print the row, write nothing
    python tools/window_check.py --park          # spawn the rig, park at /login, LEAVE IT UP
    python tools/window_check.py --label "check 6"
    python tools/window_check.py --no-canary     # reads only

⛔⛔ THERE IS NO CREDENTIALS FILE, AND THIS SCRIPT NEVER SIGNS IN.
The rig runs on a PERSISTENT Chrome profile that the owner signs into by hand,
once. The session cookie is a 30-day cookie, so one sign-in carries the whole
observation window. A script that could sign in would need the password on disk;
this one cannot, so there is nothing on disk to leak.

    .worktrees/canary-chrome-profile-persistent      (gitignored)

⛔ THE PROFILE IS NEVER DELETED. Deleting it would throw away the one thing that
makes unattended runs possible. Teardown kills the rig BROWSER by marker and
then waits for the profile lock to be released, because the next run has to be
able to open it — a run that leaves the profile locked breaks tomorrow silently.

WHAT A RUN DOES, IN ORDER
  0. GET /api/auth/me FIRST. 401 ⇒ no check row is written at all: a
     SIGN-IN REQUIRED row, a log line, a desktop notification, exit 1.
  1. reads     four durable stores · notebook locks · the opt-in key · notes ·
               leftover canary/conflict notes · both telemetry counts
  2. canary    opt in → create → type online → offline → type → reload ONLINE →
               reconnect → cleanup → opt back out
  3. teardown  by marker; profile KEPT; lock release verified
  4. stamp     one UTC-stamped row appended to the resume doc

⛔⛔ THREE REFUSALS, EACH WITH A TEST
  1. auth 401                 ⇒ never a check row.
  2. ANY read or step failed  ⇒ no row at all.
  3. ANY null/'' baseline, or ANY empty document ⇒ the run FAILS LOUDLY, the row
     is headed NEW FINDING, and the canary note is LEFT IN PLACE.
A run that finds something and then deletes the evidence is worse than no run.

⛔ THE FLAG CONSTANT IS NEVER TOUCHED. The canary sets the per-browser
localStorage opt-in inside the rig's own profile and sets it back to '0'.
⚠️ So from the second run onward the key reads '0', not unset — that is the
persistent profile remembering the last opt-out, and it is recorded as '0'.

⛔ THE RELOAD IS PERFORMED WITH THE NETWORK UP. Q1 has no service worker, so an
offline reload cannot fetch index.html: the SPA never loads and storage is not
readable from that context. That step would prove nothing.
"""
from __future__ import annotations

import argparse
import json
import os
import pathlib
import re
import socket
import subprocess
import sys
import tempfile
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone

# ⛔ WINDOWS STDOUT IS cp1252 AND THIS TOOL REPORTS IN ⛔/⭐/·. The deploy gate
# died mid-verdict on exactly this; a rig that crashes while printing a RED is
# strictly worse, because the run it was reporting on has already happened and
# the evidence goes with it. Guarded: a pipe that cannot be reconfigured must
# not take the tool down either.
for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass


ROOT = pathlib.Path(__file__).resolve().parent.parent
DOC = ROOT / "docs" / "notebook" / "wave-q1-RESUME-HERE.md"
LOG = ROOT / "docs" / "notebook" / "window-check.log"
PROD = "https://uctintelligence.com"
ACCOUNT_ID = "7a6d0299-fd98-4017-b8dc-51b849d1ab1d"

# ⭐ The profile IS the marker: its path is in the spawned browser's command
# line, so teardown can target it without ever guessing at a PID, and it cannot
# match the owner's Chrome.
#
# ⛔⛔ THE PROFILE PATH IS AN OVERRIDE, NOT A DISCOVERY. `ROOT` is the repo root
# of whichever WORKTREE holds this copy of the file, and every other worktree has
# its own empty `.worktrees/` — so this default silently resolves to a DIFFERENT
# directory the moment the tool is run from a second checkout, and a different
# directory is a SIGNED-OUT one. There is no credentials file anywhere on this
# machine, so nothing can sign a fresh profile back in. Pass `--profile` (or set
# `UCT_Q1_RIG_PROFILE`) to the ONE canonical rig profile when running from
# anywhere but the main worktree. The default below is byte-for-byte yesterday's
# behaviour, so nothing that already worked changes.
DEFAULT_PROFILE = ROOT / ".worktrees" / "canary-chrome-profile-persistent"
PROFILE_ENV = "UCT_Q1_RIG_PROFILE"

# ⛔ A MARKER IS A SUBSTRING MATCH OVER EVERY chrome.exe COMMAND LINE, and the
# match decides what gets killed. A short or generic profile directory name would
# match the OWNER'S browser, which this rig must never touch. So the marker is
# DERIVED from the profile directory name and refused when it is not distinctive.
MIN_MARKER_LEN = 12
_GENERIC_MARKERS = {"user data", "default", "chrome", "profile", "profiles",
                    "browser", "temp", "tmp", "data", "worktrees"}


def marker_for(profile) -> str:
    name = pathlib.Path(profile).name
    if len(name) < MIN_MARKER_LEN or name.strip().lower() in _GENERIC_MARKERS:
        raise SystemExit(
            f"STOP: `{name}` is too generic to serve as a kill marker. The marker is "
            "matched as a substring against every chrome.exe command line on this "
            "machine, so a generic one would match — and kill — the owner's own browser."
        )
    return name


def resolve_profile(cli: str | None = None) -> pathlib.Path:
    """CLI beats env beats today's default. Absolute, so no worktree can move it.

    ⛔ BLANK IS ABSENT AT EVERY LEVEL. A `--profile ""` chosen with `or` and then
    consumed with truthiness is `lesson_chosen_with_nullish_consumed_with_truthiness`:
    it would select the empty string, resolve it to the CWD, and point the rig at a
    directory nobody named. Each level is stripped and skipped when empty.
    """
    for raw in ((cli or ""), os.environ.get(PROFILE_ENV, "") or ""):
        raw = raw.strip()
        if raw:
            return pathlib.Path(raw).expanduser().resolve()
    return DEFAULT_PROFILE


def use_profile(profile) -> pathlib.Path:
    """Point the rig at ONE profile. MARKER is derived, never typed a second time
    (`lesson_a_second_authority_over_one_value`)."""
    global PROFILE, MARKER
    p = pathlib.Path(profile)
    MARKER = marker_for(p)          # ⛔ refuse BEFORE either global moves
    PROFILE = p
    return PROFILE


PROFILE = DEFAULT_PROFILE
MARKER = DEFAULT_PROFILE.name

# ⛔ A MISSING PROFILE IS NOT AN EMPTY ONE TO FILL IN. `mkdir` on a wrong path
# yields a signed-out profile that nothing here can sign back in, and the run then
# fails for a reason that looks like the product. Refuse, and name the fix.
ALLOW_NEW_PROFILE = False


def profile_refusal(profile, exists: bool, allow_new: bool) -> str | None:
    """Pure, so `--self-check` can prove the refusal fires AND that it stays
    silent for the canonical profile. Returns the refusal text, or None."""
    if exists or allow_new:
        return None
    return (
        f"STOP: no rig profile at {profile}\n"
        "  \u26d4 A FRESH PROFILE IS A SIGNED-OUT PROFILE, and there is no credentials "
        "file anywhere on this machine, so nothing can sign it back in.\n"
        f"  Point the tool at the canonical rig profile (--profile <path>, or {PROFILE_ENV}=<path>), "
        "or pass --allow-new-profile if you are deliberately creating one to sign in by hand "
        "with --park."
    )


CHROME = pathlib.Path(r"C:\Program Files\Google\Chrome\Application\chrome.exe")

ANCHOR = "## \U0001f4cb THE WINDOW-WATCH LOG"
SIGNIN_HEAD = "### \u26d4 SIGN-IN REQUIRED"
FLAG_KEY = "uct.j2.offline.enabled"
BLOCKED_EVENT = "j2:notebook_blocked_no_baseline"
OPT_IN_EVENT = "j2:notebook_offline_opt_in"
SENTINEL = "WINDOW-CHECK-SENTINEL"

# ⭐ THE SHAPE OF A ROW — and every count of rows derives from this one literal.
#
# ⚰️ 2026-09-10, mine: I searched for the shape of a row I EXPECTED —
# `^### check (\d+)` — instead of the shape of a ROW, got silence, and wrote the
# silence down as a fact. A `--label`led row (`### deploy #4 live — run 1 of 7 —
# …`) carries no check number at all, so anything keyed off that regex cannot
# see it. A door rotation keyed off it would have printed ONE door on all seven
# rows of a labelled streak while calling itself a rotation.
ROW_MARK = "| **mini-canary** |"

# ══════════════════════════════════════════════════════════════════════════════
# ⛔⛔ THE MINI-CANARY IS SUSPENDED. ONE SWITCH, AND IT IS THIS ONE.
# ══════════════════════════════════════════════════════════════════════════════
# Hard stop H1, streak run 1 against deploy #4c (2026-09-11T00:00:56Z, door
# `folder`): the offline sentence was ABSENT from the server body, the note
# forked from a single writer, and the note count moved. Owner's ruling: no
# fourth fix that night — close cleanly, hand off, the flag does NOT flip.
#
# ⭐ SUSPENDED IS NOT DELETED. The fork detector and the offline-sentence check
# stay defined, stay HARD REDS, and stay driven by `--self-check`. Re-arming is
# flipping this ONE constant back to False — never rebuilding them. A suspension
# that decays into a deletion is how a wave loses the instrument that found the
# defect, and this instrument caught H1 on three separate occasions while the
# step beside it read green every time.
# ⛔⛔ THE SUSPENSION IS LIFTED — 2026-09-11, and the reason it existed is gone.
#
# It was raised while self-fork round 3 was open. Round 3 CLOSED BY FINDING: the
# fork was the INSTRUMENT, not the product. `DOOR_JS` fired a metadata door with
# a raw `fetch`, so the editor's handlers never ran, `recordLandedRevision` never
# recorded the revision, and guard 2 correctly answered "not ours" and forked —
# which is the right answer to a second writer, and a member changing a ticker is
# not one. Measured on the same rig and ordering: the raw-fetch door lost 11 of 13
# (r = 0.85); the MEMBER'S OWN door lost 0 of 36 (r = 0.00).
#
# The canary now fires `REAL_DOOR_JS` — the member's door — so running it is no
# longer a way to reproduce an artifact.
CANARY_SUSPENDED = False
SUSPENSION_REASON = ""

# ⛔ ON EVERY ROW, AT THE TOP. A reader who needs it is not reading for pleasure.
ROLLBACK_LINE = ("⛔ **ROLLBACK — one line:** set `OFFLINE_DEFAULT_ON=false` on the "
                 "Railway `web` service. It stops processing; it destroys nothing.")


def new_since(titles, before):
    """Titles present NOW that were not present when the run started. Pure.

    THE SAME MISSING BASELINE HAS NOW BITTEN THREE TIMES in this tool, in three
    different steps: the fork detector, the cleanup leftovers, and (in
    q1_repro.py) the fork count that was fixed there and never carried across.
    Every one of them compared against ZERO instead of against the account's
    starting state, and every one of them reported the account's history as this
    run's output. One helper now, so there is one place to be right.
    """
    b = set(before or ())
    return [t for t in (titles or []) if t not in b]


def split_forks(canary_titles, forks_before):
    """(new, pre_existing). Pure, so the baseline is DRIVEN, not asserted about.

    A fork detector with no baseline reports the account's history as this run's
    output. On 2026-09-11 that produced a HARD RED naming a conflicted copy made
    twelve hours earlier and deliberately preserved, while the same run's note
    arithmetic said no fork had happened.
    """
    before = set(forks_before or ())
    copies = [t for t in (canary_titles or []) if "(conflicted copy)" in t]
    return (new_since(copies, before), [t for t in copies if t in before])


def canary_should_run(suspended: bool, no_canary_flag: bool) -> bool:
    """⛔ Pure, so the suspension is driven rather than asserted about.

    The SWITCH wins over the flag's absence: a scheduled task that forgets
    `--no-canary` must still not write to the account while H1 is open.
    """
    return (not suspended) and (not no_canary_flag)

# ══════════════════════════════════════════════════════════════════════════════
# THE DOOR ROTATION — round 2's three metadata doors, one per run
# ══════════════════════════════════════════════════════════════════════════════
# ⛔ Folder, ticker and tags each move the server's `updatedAt` while saying
# NOTHING about the member's words, so each one moves the baseline out from under
# a queued outbox entry exactly the way a second writer would — without a second
# writer existing. That is the shape the fix has to survive.
#
# ⭐ THE DOOR IS DERIVED FROM THE RUN'S OWN NUMBER, NEVER PASSED IN. A rotation
# the caller has to remember to vary is a rotation that silently stops varying,
# and seven rows would then say the same word while claiming to rotate.
DOORS = ("folder", "ticker", "tags")
DOOR_PATCH = {
    "folder": {"folderId": None},
    "ticker": {"ticker": "NVDA"},
    # ⛔ NEVER `sync-conflict` — that tag belongs to the preserved evidence set,
    # and nothing this tool creates may wear it.
    "tags": {"tags": ["window-check-door"]},
}
def offline_sentence(stamp: str, sentinel: str = SENTINEL) -> str:
    """THE sentence a run types while the transport is cut — and the EXACT string
    its landing is asserted against, in every tool that runs this path.

    ⛔⛔ ONE AUTHORITY, and it is written in a member's blood. The canary used to
    assert `_doc_has_text(server.bodyJson)`, which the words typed ONLINE satisfy
    — so on 2026-09-10 a run that DISCARDED the queued offline entry read GREEN
    on that step while the sentence was being lost. A green light with no
    information in it is worse than no step at all.

    ⭐ Typing and asserting now call this same function, so they cannot drift, and
    the stamp makes the sentence THIS run's — never a leftover from another.
    """
    return f"{sentinel} typed offline @ {stamp}"


def door_for(n: int) -> str:
    """Which door THIS run walks through. Pure, so the rotation can be driven."""
    return DOORS[n % len(DOORS)]


def door_survived(door: str, server_note) -> tuple:
    """Did the value this run's door set survive the drain's send?

    ⚠️ `folder` is N/A BY CONSTRUCTION and says so, rather than returning a green
    it never measured: the canary note has no folder, so `folderId: null` is
    still a real write (the server appends a SET and stamps `updated_at`) but its
    VALUE reads the same on both sides. That door is proved by the baseline move,
    and the row prints the caveat instead of a hollow tick.
    """
    if not isinstance(server_note, dict):
        return False, " — the server note could not be read"
    if door == "ticker":
        got = server_note.get("ticker")
        return got == DOOR_PATCH["ticker"]["ticker"], f" (`ticker` = {got!r})"
    if door == "tags":
        tags = server_note.get("tags") if isinstance(server_note.get("tags"), list) else []
        return DOOR_PATCH["tags"]["tags"][0] in tags, f" (`tags` = {tags!r})"
    return True, (" — `folder`'s VALUE check is N/A by construction (this note has no "
                  "folder); the door is proved by the baseline move above")


def utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


# ══════════════════════════════════════════════════════════════════════════════
# THE TWO FINDING DETECTORS — pure, so `--self-check` can drive them.
# ══════════════════════════════════════════════════════════════════════════════

def _walk(obj, path=""):
    if isinstance(obj, dict):
        for k, v in obj.items():
            yield from _walk(v, f"{path}.{k}" if path else k)
    elif isinstance(obj, list):
        for i, v in enumerate(obj):
            yield from _walk(v, f"{path}[{i}]")
    else:
        yield path, obj


def baseline_findings(label: str, artifact) -> list:
    """Every `baseUpdatedAt` must be a non-blank string.

    ⛔ `null` is the 2026-09-09 incident; `''` is the second defect found while
    hunting it. DIFFERENT findings, reported in different words.
    """
    out = []
    for path, value in _walk(artifact):
        if not path.split(".")[-1].startswith("baseUpdatedAt"):
            continue
        if value is None:
            out.append(f"`{label}.{path}` is **null** \u2014 a write with NO compare-and-set")
        elif not isinstance(value, str):
            out.append(f"`{label}.{path}` is a **{type(value).__name__}**, not a timestamp")
        elif value.strip() == "":
            out.append(f"`{label}.{path}` is **{'an empty string' if value == '' else 'whitespace'}** \u2014 falsy at the consumer")
    return out


def _doc_text(node) -> str:
    """Every text run in a ProseMirror document, concatenated.

    ⭐ ONE authority: `_doc_has_text` is this, asked whether it found anything.
    The two questions — "is there any text" and "is MY sentence in it" — must not
    be answered by two different walks that can drift apart.
    """
    if isinstance(node, dict):
        if node.get("type") == "text":
            return str(node.get("text", ""))
        return "".join(_doc_text(c) for c in node.get("content", []) or [])
    if isinstance(node, list):
        return "".join(_doc_text(c) for c in node)
    return ""


def _doc_has_text(node) -> bool:
    return bool(_doc_text(node).strip())


def empty_document_findings(label: str, artifact, expect_text: bool = True) -> list:
    """⛔ THE INCIDENT'S OWN SHAPE: an empty paragraph reads as a document until
    you ask whether any of it is text."""
    if not expect_text:
        return []
    out = []
    body = artifact.get("bodyJson") if isinstance(artifact, dict) else None
    if body is not None and not _doc_has_text(body):
        out.append(f"`{label}.bodyJson` holds **no text** \u2014 the empty-document shape")
    if isinstance(artifact, dict) and isinstance(artifact.get("patch"), dict):
        pb = artifact["patch"].get("bodyJson")
        if pb is not None and not _doc_has_text(pb):
            out.append(f"`{label}.patch.bodyJson` holds **no text** \u2014 the empty-document shape")
    return out


def conflict_findings(label: str, server_body, copy_body, mine: str, theirs: str) -> list:
    """Words must survive in BOTH directions when two writers meet.

    ⛔ The wave's whole invariant: the server keeps whoever arrived first,
    byte-unchanged, and the loser's work survives beside it as a real
    `(conflicted copy)`. A run that only checked one direction would pass while
    half the member's work vanished — and "the server still has *a* version" is
    exactly the reassurance that hides a clobber.
    """
    out = []
    server_txt = json.dumps(server_body) if server_body is not None else ""
    copy_txt = json.dumps(copy_body) if copy_body is not None else ""
    if theirs and theirs not in server_txt:
        out.append(f"`{label}` — the SERVER lost the other writer's words (**{theirs}** is gone): a clobber")
    if mine and mine not in copy_txt:
        out.append(f"`{label}` — the conflicted copy lost MY words (**{mine}** is gone): work destroyed on fork")
    return out


def _as_list(v) -> list:
    """⛔ The page-side readers report failure as the STRING 'ERR', not as an
    empty list. `x or []` passes that straight through and the next `+` blows up
    — which is exactly how check 5 died on its first run. Coerce, and let the
    caller notice the layer did not read."""
    return v if isinstance(v, list) else []


def layer_read_failed(layers: dict) -> list:
    """Which captured layers came back as an error rather than data.

    ⛔ Reported, never silently treated as "empty". "The outbox is empty" and
    "the outbox could not be read" are opposite conclusions from the same
    variable, and conflating them is how a canary passes by accident.
    """
    bad = []
    for k in ("draft", "record", "outbox"):
        v = layers.get(k)
        if isinstance(v, str) and v.startswith("ERR"):
            bad.append(f"{k}={v}")
    return bad


def should_clean_up(findings: list) -> bool:
    """⛔⛔ A run that finds something and then deletes the evidence is worse
    than no run."""
    return not findings


# ══════════════════════════════════════════════════════════════════════════════
# result objects
# ══════════════════════════════════════════════════════════════════════════════

@dataclass
class Read:
    name: str
    ok: bool
    value: object = None
    error: str = ""

    def render(self) -> str:
        if not self.ok:
            return f"\u26d4 **FAILED** \u2014 {self.error or 'no reading'}"
        return str(self.value)


@dataclass
class Check:
    label: str
    started: str = field(default_factory=utc_now)
    reads: list = field(default_factory=list)
    canary: list = field(default_factory=list)
    findings: list = field(default_factory=list)
    canary_ran: bool = False
    needs_signin: bool = False
    # ⭐ The run's own row number, and the door it derives. `number` is set ONCE,
    # in `main`, from the document itself — never chosen by a caller.
    number: int = 0
    door: str = ""
    # ⛔ The account's note count as this run found it. A fork and a discard are
    # DIFFERENT failures and both have to be visible: the discard is caught by the
    # sentence, the fork by this arithmetic.
    notes_before: int = 0
    # THE FORKS THAT WERE ALREADY THERE. A fork detector with no baseline counts
    # the account's history as this run's output.
    forks_before: tuple = ()
    # Every canary-titled note present at run start - the baseline the cleanup
    # receipt needs, for the same reason the fork detector needs one.
    canary_before: tuple = ()

    def add(self, name, ok, value=None, error=""):
        self.reads.append(Read(name, ok, value, error))
        return self.reads[-1]

    def step(self, name, ok, value=None, error=""):
        self.canary.append(Read(name, ok, value, error))
        return self.canary[-1]

    @property
    def complete(self) -> bool:
        """⛔ THE GATE. Auth 401, one failed read, or one failed step ⇒ no row."""
        if self.needs_signin:
            return False
        return bool(self.reads) and all(r.ok for r in self.reads) and all(s.ok for s in self.canary)

    @property
    def failures(self) -> list:
        return [r for r in self.reads + self.canary if not r.ok]

    def row(self) -> str:
        head = f"### {self.label} — **{self.started}**"
        lines = []
        if self.findings:
            lines += [head, "",
                      "## \U0001f6a8\U0001f6a8 NEW FINDING — STOP AND READ THIS", "",
                      "⛔ The daily mini-canary found the shape this whole wave exists to",
                      "prevent. **The canary note was deliberately NOT deleted** — the artifact",
                      "is on the account for inspection.", ""]
            lines += [f"- {f}" for f in self.findings]
            lines.append("")
        else:
            lines += [head, ""]
        # ⛔ THE ROLLBACK LINE IS AT THE TOP OF EVERY ROW, findings or not.
        lines += [ROLLBACK_LINE, ""]
        if CANARY_SUSPENDED:
            lines += [f"⛔ **{SUSPENSION_REASON}** — this row is READS ONLY: nothing was "
                      "opted in, nothing was created on the account, not a single write. "
                      "The fork detector and the offline-sentence check remain defined and "
                      "remain hard reds; re-arming is one constant.", ""]
        lines += ["| | reading |", "|---|---|"]
        for r in self.reads:
            lines.append(f"| {r.name} | {r.render()} |")
        # ⭐ STAMPED, so the seven rows SHOW the rotation instead of a sentence
        # claiming there is one. A row that names its own door is falsifiable by
        # eye; "the door rotates" is not.
        if self.canary_ran and self.door:
            lines.append(f"| door this run | **`{self.door}`** — `DOORS[{self.number} % 3]`, "
                         "derived from this run's own row number |")
        if self.canary_ran:
            lines.append("| **mini-canary** | " + (
                "\U0001f6a8 **NEW FINDING — see above**" if self.findings
                else f"\u2705 **{sum(1 for s in self.canary if s.ok)}/{len(self.canary)}** steps green"
            ) + " |")
            for s in self.canary:
                lines.append(f"| \u2003↳ {s.name} | {s.render()} |")
        elif CANARY_SUSPENDED:
            lines.append(f"{ROW_MARK} \u26d4 **{SUSPENSION_REASON}** |")
        else:
            lines.append("| **mini-canary** | \u2014 not run this pass |")
        lines.append("")
        return "\n".join(lines)


# ══════════════════════════════════════════════════════════════════════════════
# rig plumbing
# ══════════════════════════════════════════════════════════════════════════════

def free_port() -> int:
    """⛔ A PORT IS NOT A SERVER IDENTITY. An ephemeral port narrows the odds;
    the caller verifies the endpoint before driving it."""
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


def port_is_busy(port: int) -> bool:
    s = socket.socket()
    s.settimeout(1.0)
    try:
        s.connect(("127.0.0.1", port))
        return True
    except OSError:
        return False
    finally:
        s.close()


def profile_lock_released(timeout: int = 30, profile=None) -> tuple:
    """Can the NEXT run open this profile?

    ⛔ Chrome keeps `lockfile` (and `SingletonLock`) inside the user-data dir and
    holds it open for the life of the browser. A teardown that returns while the
    lock is still held means tomorrow's 09:00 run finds the profile busy and
    fails for a reason that has nothing to do with the product. So this waits and
    REPORTS, rather than assuming the kill was instantaneous.

    ⚠️ `SingletonLock` is the POSIX name; on Windows the artifact is `lockfile`.
    Both are checked so the answer is the same sentence on either platform.
    `profile` defaults to the rig's, and is passed explicitly for the Edge rig.
    """
    profile = PROFILE if profile is None else pathlib.Path(profile)
    locks = [profile / "lockfile", profile / "SingletonLock"]
    deadline = time.time() + timeout
    while True:
        held = []
        for p in locks:
            if not p.exists():
                continue
            try:
                with p.open("r+b"):
                    pass
            except OSError:
                held.append(p.name)
        if not held or time.time() > deadline:
            return (not held), held
        time.sleep(1)


def browser_processes():
    """⛔ NEVER COUNT `chrome.exe` — Chrome reaps children constantly and a count
    false-alarmed on 2026-09-10. BROWSER processes only (no `--type=`)."""
    ps = ("Get-CimInstance Win32_Process -Filter \"Name='chrome.exe'\" | "
          "Where-Object { $_.CommandLine -notlike '*--type=*' } | "
          "ForEach-Object { $_.ProcessId.ToString() + '|' + ($_.CommandLine -like '*" + MARKER + "*') }")
    r = subprocess.run(["powershell", "-NoProfile", "-Command", ps],
                       capture_output=True, text=True, encoding="utf-8", errors="replace")
    out = []
    for line in r.stdout.splitlines():
        if "|" in line:
            pid, mine = line.strip().split("|", 1)
            try:
                out.append((int(pid), mine.strip().lower() == "true"))
            except ValueError:
                pass
    return out


def kill_by_marker() -> int:
    ps = ("$c = Get-CimInstance Win32_Process -Filter \"Name='chrome.exe'\" | "
          "Where-Object { $_.CommandLine -like '*" + MARKER + "*' }; "
          "($c | Measure-Object).Count; "
          "$c | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }")
    r = subprocess.run(["powershell", "-NoProfile", "-Command", ps],
                       capture_output=True, text=True, encoding="utf-8", errors="replace")
    first = (r.stdout.strip().splitlines() or ["0"])[0]
    try:
        return int(first)
    except ValueError:
        return 0


def notify(title: str, text: str) -> bool:
    """A desktop balloon, so a signed-out rig is visible without opening a log.

    ⛔ Non-blocking by construction: a `MessageBox` would hang a scheduled task
    until someone clicked it, which is a worse failure than the one it reports.
    ⚠️ `msg.exe` does not exist on this edition of Windows — measured — so the
    NotifyIcon balloon is the path, and it was proved to fire before anything
    depended on it.
    """
    ps = (
        "Add-Type -AssemblyName System.Windows.Forms;"
        "$n = New-Object System.Windows.Forms.NotifyIcon;"
        "$n.Icon = [System.Drawing.SystemIcons]::Warning;"
        "$n.Visible = $true;"
        f"$n.ShowBalloonTip(15000, '{title}', '{text}', [System.Windows.Forms.ToolTipIcon]::Warning);"
        "Start-Sleep -Seconds 8; $n.Dispose()"
    )
    try:
        subprocess.run(["powershell", "-NoProfile", "-WindowStyle", "Hidden", "-Command", ps],
                       capture_output=True, timeout=40)
        return True
    except Exception:  # noqa: BLE001
        return False


def bring_to_front():
    ps = ("$p = Get-CimInstance Win32_Process -Filter \"Name='chrome.exe'\" | "
          "Where-Object { $_.CommandLine -like '*" + MARKER + "*' -and $_.CommandLine -notlike '*--type=*' } | "
          "Select-Object -First 1; if ($p) { "
          "Add-Type -AssemblyName Microsoft.VisualBasic; "
          "[Microsoft.VisualBasic.Interaction]::AppActivate($p.ProcessId) }")
    subprocess.run(["powershell", "-NoProfile", "-Command", ps], capture_output=True)


# ══════════════════════════════════════════════════════════════════════════════
# page-side reads
# ══════════════════════════════════════════════════════════════════════════════

AUTH_JS = """async () => {
  const r = await fetch('/api/auth/me', {credentials:'include'});
  let b = null; try { b = await r.json() } catch {}
  return {status: r.status, id: b?.user?.id ?? b?.id ?? null};
}"""


# ══════════════════════════════════════════════════════════════════════════════
# SELF-HEALING AUTH — the one thing that can break an unattended run.
# ══════════════════════════════════════════════════════════════════════════════

class ReauthUnavailable(Exception):
    """No configured way to re-issue a session without a human."""


def mint_session_token() -> str:
    """Issue a fresh 30-day session for the canary account, server-side.

    ⛔⛔ NOT IMPLEMENTED, AND DELIBERATELY NOT FAKED. Here is exactly what it
    would take, so the next session does not have to re-derive it:

    A session in this app is NOT signed — `auth_service.create_session` mints
    `secrets.token_urlsafe(48)` and INSERTS it into the `sessions` table
    (`SESSION_TTL_DAYS = 30`), and `validate_session` is a plain token lookup.
    So there is no signer and no secret to borrow: **minting means writing a row
    into production's `auth.db`**, which needs a shell on the production pod.

        railway ssh --service web
        /opt/venv/bin/python -c "from api.services.auth_service import create_session; \
                                 print(create_session('<canary user id>'))"

    then install the value as the `uct_session` cookie on `.uctintelligence.com`
    (httpOnly, secure, SameSite=Lax, path=/) via CDP `Network.setCookie`.

    ⛔ This session could not reach that shell: every probe toward the Railway
    CLI was refused by the environment's command classifier. That is a guardrail
    around production access, and routing around it — a different shell, a
    wrapper script — would be defeating it rather than satisfying it.

    ⛔ AND IT WRITES TO THE 1 GB `auth.db` THAT HOLDS ~20,640 REAL MEMBERS. That
    is a different risk class from everything else this rig does, all of which
    is confined to one canary account through the app's own HTTP surface.
    """
    raise ReauthUnavailable(
        "minting a session needs a production shell (railway ssh); "
        "this environment refuses that, and it must not be worked around"
    )


def reauthenticate(page, mint=mint_session_token) -> tuple:
    """⭐ Called on a 401 BEFORE giving up. Returns (ok, detail).

    ⛔ It installs a cookie the server issued. It never types a password, never
    reads one from disk, and never touches an account other than the canary.
    """
    try:
        token = mint()
    except ReauthUnavailable as e:
        return False, str(e)
    except Exception as e:  # noqa: BLE001
        return False, f"{type(e).__name__}: {e}"
    if not token or not isinstance(token, str):
        return False, "the minter returned nothing usable"
    cdp = page.context.new_cdp_session(page)
    cdp.send("Network.enable")
    cdp.send("Network.setCookie", {
        "name": "uct_session", "value": token, "domain": ".uctintelligence.com",
        "path": "/", "httpOnly": True, "secure": True, "sameSite": "Lax",
    })
    return True, "session re-issued server-side and installed via CDP"

# ⛔⛔ NEVER `indexedDB.open(name)` BARE FROM AN INSTRUMENT.
#
# Open-with-no-version CREATES the database if it is missing — an empty one, with
# zero object stores — and because the app opens at DB_VERSION 1, no upgrade ever
# fires afterwards, so the real stores are NEVER created. The reader therefore
# does not merely observe the layer; it PERMANENTLY BREAKS it. Measured
# 2026-09-10: three failed check-5 runs, `record=ERR: NotFoundError`, and a rig
# profile whose Notebook could no longer initialise.
#
# `indexedDB.databases()` asks without creating. Everything below goes through
# this, and a phantom (0-store) database is reported so the caller can repair it.
OPEN_IF_EXISTS = """
  async function openIfExists(name) {
    const known = (await indexedDB.databases()).map(d => d.name);
    if (!known.includes(name)) return {missing: true, db: null, stores: []};
    const db = await new Promise((res, rej) => {
      const r = indexedDB.open(name);
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
    const stores = [...db.objectStoreNames];
    return {missing: false, phantom: stores.length === 0, db, stores};
  }
"""

STATE_JS = """async (acct) => {
""" + OPEN_IF_EXISTS + """
  // ⛔ Read FIRST, before any early return below can skip it.
  const out = {optInKey: localStorage.getItem('uct.j2.offline.enabled')};
  try {
    const q = await navigator.locks.query();
    const _mine = [...q.held, ...q.pending].filter(l => String(l.name).startsWith('uct.nb.sync.'));
    out.locks = _mine.length;
    // NAMES, NOT A COUNT. A cleanup that says "locks=1" cannot be diagnosed;
    // one that says which lock, held or pending, and by what, can be.
    out.lockDetail = _mine.map(l => ({name: l.name, mode: l.mode, id: l.clientId}));
    out.held = (q.held || []).filter(l => String(l.name).startsWith('uct.nb.sync.')).map(l => l.mode);
    out.pending = (q.pending || []).filter(l => String(l.name).startsWith('uct.nb.sync.')).length;
    // ⛔⛔ AND THE CENSUS CANNOT ANSWER THE QUESTION THE ROW ASKS.
    //
    // `query()` still reports a lock held by a document Chrome has merely
    // FROZEN — a previous page kept in the back/forward cache — and nothing
    // evicts it while nobody asks for it. An opted-out cleanup page never asks,
    // so it counts a holder that is not running and calls the profile dirty.
    //
    // MEASURED 2026-09-11, both halves, on this rig:
    //   · navigate off the notebook with nothing waiting ⇒ the previous
    //     context's lock still reads HELD 5s later;
    //   · do it with a second tab WAITING ⇒ leadership transfers inside 5s and
    //     stays transferred through 60s.
    // So the frozen holder is harmless and the product is correct — but the
    // census cannot tell it from a live one.
    //
    // ⭐ ASK FOR THE LOCK INSTEAD. A grant IS the row's claim ("lock free ⇒ the
    // next run can open it"), and it is what forces Chrome to resolve a frozen
    // holder. No grant inside the budget ⇒ something LIVE holds it ⇒ RED.
    // ⛔ The callback returns undefined ON PURPOSE: that releases the lock the
    // instant it is granted, so the probe never becomes the leader it measures.
    out.lockClaimable = await new Promise((resolve) => {
      const ac = new AbortController();
      const t = setTimeout(() => { try { ac.abort() } catch (e) {} resolve(false) }, 5000);
      navigator.locks.request('uct.nb.sync.' + acct, {signal: ac.signal}, () => {
        clearTimeout(t); resolve(true); return undefined;
      }).catch(() => { clearTimeout(t); resolve(false) });
    });
  } catch { out.locks = 'ERR'; out.lockClaimable = 'ERR' }
  try {
    const h = await openIfExists('uct_notebook_' + acct);
    if (h.missing) { out.dbOpened = false; out.stores = null; out.storeNames = []; out.dbMissing = true; return out; }
    if (h.phantom) { out.dbOpened = true; out.stores = null; out.storeNames = []; out.dbPhantom = true; return out; }
    const db = h.db;
    out.dbOpened = true;
    out.storeNames = h.stores;
    const counts = {};
    for (const s of out.storeNames) {
      counts[s] = await new Promise(res => {
        const t = db.transaction(s, 'readonly').objectStore(s).getAll();
        t.onsuccess = () => res((t.result || []).length); t.onerror = () => res('ERR');
      });
    }
    out.stores = counts;
  } catch (e) { out.stores = 'ERR: ' + e.name; out.dbOpened = false }
  return out;
}"""

LAYERS_JS = """async ({acct, id}) => {
""" + OPEN_IF_EXISTS + """
  const out = {noteId: id};
  try { out.draft = JSON.parse(localStorage.getItem('uct.j2.notedraft.' + id) || 'null') } catch { out.draft = 'ERR' }
  try {
    const h = await openIfExists('uct_notebook_' + acct);
    if (h.missing)  { out.record = 'ERR: dbMissing'; out.outbox = 'ERR'; }
    else if (h.phantom) { out.record = 'ERR: dbPhantom'; out.outbox = 'ERR'; }
    else {
    const db = h.db;
    out.record = await new Promise(res => {
      const t = db.transaction('notes','readonly').objectStore('notes').get(id);
      t.onsuccess = () => res(t.result || null); t.onerror = () => res('ERR');
    });
    const all = await new Promise(res => {
      const t = db.transaction('outbox','readonly').objectStore('outbox').getAll();
      t.onsuccess = () => res(t.result || []); t.onerror = () => res([]);
    });
    out.outbox = all.filter(e => e.noteId === id);
    }
  } catch (e) { out.record = 'ERR: ' + e.name; out.outbox = 'ERR' }
  try {
    const r = await fetch('/api/j2/notes/' + id, {credentials:'include'});
    out.server = r.ok ? (await r.json()).note : {status: r.status};
  } catch { out.server = 'OFFLINE' }
  return out;
}"""

NOTES_JS = """async () => {
  const r = await fetch('/api/j2/notes?limit=300', {credentials:'include'});
  if (!r.ok) return {ok:false, status:r.status};
  const notes = (await r.json()).notes || [];
  return {ok:true, total: notes.length,
    canary: notes.filter(n => /CANARY|WINDOW-CHECK/i.test(n.title || '')).map(n => n.title),
    conflicts: notes.filter(n => (n.tags || []).includes('sync-conflict')).map(n => n.title)};
}"""

# ⛔⛔ THIS IS THE SECOND-WRITER SIMULATION, NOT THE MEMBER'S DOOR.
# It writes with its own fetch, so the editor's handlers never run. Keep it — the
# second-writer case is real and must keep forking — but never read its fork as a
# defect in the member's path. `REAL_DOOR_JS` below is the member's door.
DOOR_JS = """async ({id, patch}) => {
  // ⛔ METADATA ONLY — no title, no bodyJson. The server patches exactly the
  // keys it is sent, so this write moves `updatedAt` while saying nothing about
  // the member's words, which is the whole point of a metadata door. Sending the
  // body back would make this an ordinary save and would prove nothing.
  // ⛔ ONE retry on a 409, and the attempt count is REPORTED. The GET→PUT window
  // is one round trip wide and the drain is racing us BY DESIGN: a 409 there
  // means the queue moved the revision in between, which is not a defect and
  // must not read as one. A second attempt on the fresh baseline is honest;
  // looping past that would hide a real conflict behind a retry.
  let prev = null, w = null, j = null, tries = 0;
  while (tries < 2) {
    tries++;
    const before = await fetch('/api/j2/notes/' + id, {credentials:'include'})
                     .then(r => r.ok ? r.json() : null).catch(() => null);
    prev = before?.note?.updatedAt ?? null;
    const body = Object.assign({baseUpdatedAt: prev}, patch);
    w = await fetch('/api/j2/notes/' + id, {method:'PUT', credentials:'include',
      headers:{'Content-Type':'application/json'}, body: JSON.stringify(body)});
    j = await w.json().catch(() => null);
    if (w.status !== 409) break;
  }
  return {status: w.status, before: prev, after: j?.note?.updatedAt ?? null, attempts: tries};
}"""

REAL_DOOR_JS = """async ({door, value}) => {
  // ⛔⛔ THE MEMBER'S DOOR. `DOOR_JS` above fires a raw fetch from the page and
  // therefore simulates a SECOND WRITER — the editor's own handlers never run,
  // `settleMetadataRevision` never runs, `recordLandedRevision` never records the
  // revision, guard 2 correctly answers "not ours", and the note FORKS. That is
  // the right answer to another device, and it is NOT what a member changing a
  // ticker does.
  //
  // ⚰️ Measured 2026-09-11, same rig, same ordering, 3 sends beating the door:
  //      raw fetch door  13 runs  12 lost the offline sentence   r = 0.92
  //      this door       12 runs   0 lost the offline sentence   r = 0.00
  //    Three deploys were spent fixing a defect the instrument was creating.
  const fire = (el, type) => el.dispatchEvent(new Event(type, {bubbles: true}));
  const setNative = (el, v) => {
    const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
  };
  if (door === 'folder') {
    const sel = document.querySelector('select');
    if (!sel) return {ok:false, why:'no folder <select> on the page'};
    const opt = [...sel.options].find(o => o.value && o.value !== sel.value);
    if (!opt) return {ok:false, why:'no other folder to move to'};
    setNative(sel, opt.value); fire(sel, 'change');
    return {ok:true, via:'select.change'};
  }
  const ph = door === 'ticker' ? 'Ticker' : 'Tags (comma sep)';
  const el = document.querySelector(`input[placeholder="${ph}"]`);
  if (!el) return {ok:false, why:'no ' + ph + ' input on the page'};
  el.focus(); setNative(el, value); fire(el, 'input'); el.blur(); fire(el, 'blur');
  return {ok:true, via:'input.blur'};
}"""


ACTIVITY_JS = """async (names) => {
  // ⭐ TWO SOURCES, AND THEY ANSWER DIFFERENT QUESTIONS.
  //
  // /api/admin/activity is population-wide but admin-gated (ADMIN_EMAILS).
  // /api/auth/export-data is THIS ACCOUNT'S OWN activity_log, gated only by
  // get_current_user — so it always works for the rig, admin or not.
  //
  // ⛔ The scope is REPORTED, never silently swapped: "zero events across every
  // member" and "zero events on the rig's own account" are different facts, and
  // reading one as the other is how a gate gets satisfied by the wrong evidence.
  const count = (rows, n) => {
    const hits = rows.filter(x => x.action === n);
    return {count: hits.length, latest: hits.length ? hits[0].created_at : null};
  };
  // ⛔⛔ `response.ok` IS NOT PROOF THE ENDPOINT EXISTS. This app serves an SPA
  // catch-all, so a wrong path comes back **200 text/html** and `.ok` is true —
  // the same tell as the 2026 broker-sync incident ("GET /connect -> 200 HTML").
  // Measured here on 2026-09-10: the admin route lives under the auth router's
  // /api/auth prefix, and calling /api/admin/activity returned the index page.
  const asJson = async (res) => {
    if (!res.ok) return null;
    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('application/json')) return null;   // the catch-all, not us
    try { return await res.json() } catch { return null }
  };
  const admin = await fetch('/api/auth/admin/activity?limit=200', {credentials:'include'});
  const adminRows = await asJson(admin);
  if (Array.isArray(adminRows)) {
    const out = {ok:true, scope:'population-wide (admin)', adminStatus:admin.status};
    for (const n of names) out[n] = count(adminRows, n);
    return out;
  }
  const mine = await fetch('/api/auth/export-data', {credentials:'include'});
  const body = await asJson(mine);
  if (!body) return {ok:false, status:mine.status, adminStatus:admin.status,
                     note:'export-data did not return JSON'};
  const rows = body.activity || [];
  const out = {ok:true, scope:'this account only (export-data)',
               adminStatus:admin.status, rowCap: rows.length >= 100};
  for (const n of names) out[n] = count(rows, n);
  return out;
}"""


# ══════════════════════════════════════════════════════════════════════════════
# the run
# ══════════════════════════════════════════════════════════════════════════════

def spawn_rig():
    """Launch Chrome on the PERSISTENT profile and return (proc, endpoint)."""
    if not CHROME.exists():
        raise SystemExit(f"STOP: no Chrome at {CHROME}")
    refusal = profile_refusal(PROFILE, PROFILE.exists(), ALLOW_NEW_PROFILE)
    if refusal:
        raise SystemExit(refusal)
    PROFILE.mkdir(parents=True, exist_ok=True)
    print(f"rig profile: {PROFILE}  · marker `{MARKER}`", flush=True)
    released, held = profile_lock_released(timeout=5)
    if not released:
        raise SystemExit(
            f"STOP: the rig profile is locked by a running Chrome ({', '.join(held)}). "
            "Close it, or kill by marker, before starting a run."
        )
    port = free_port()
    if port_is_busy(port):
        raise SystemExit(f"STOP: something already answers on 127.0.0.1:{port}")
    proc = subprocess.Popen([
        str(CHROME), f"--user-data-dir={PROFILE}",
        f"--remote-debugging-port={port}", "--remote-debugging-address=127.0.0.1",
        "--no-first-run", "--no-default-browser-check", "--new-window", "about:blank",
    ])
    endpoint = f"http://127.0.0.1:{port}"
    for _ in range(30):
        try:
            import urllib.request
            with urllib.request.urlopen(endpoint + "/json/version", timeout=2) as r:
                return proc, endpoint, json.loads(r.read().decode())
        except Exception:  # noqa: BLE001
            time.sleep(1)
    return proc, endpoint, None


def _offliner(cdp):
    def offline(flag):
        cdp.send("Network.emulateNetworkConditions", {
            "offline": flag, "latency": 0,
            "downloadThroughput": 0 if flag else -1,
            "uploadThroughput": 0 if flag else -1})
    return offline


PROBE = ("async () => await fetch('/api/health', {cache:'no-store'})"
         ".then(r => 'ONLINE ' + r.status).catch(e => 'FAILED: ' + e.name)")


def flush_localstorage(page) -> str:
    """Ask Chrome to EXIT GRACEFULLY so localStorage reaches disk. Returns why not.

    CHROME BATCHES localStorage TO DISK, AND SIGKILL LOSES THE BATCH.
    Measured 2026-09-11: after the opt-in/opt-out pair, the on-disk store held
    `appends: 0, raw: []` - the key was not merely stale, it was ABSENT. The
    run's in-browser read-back of `'0'` was green and truthful about memory and
    said nothing about the disk. It had looked healthy only because an OLDER
    on-disk `'0'` was lying around; clearing the key exposed it.

    This matters most AFTER THE FLIP: with the default true, "unset" means ON, so
    a rig that cannot persist its opt-out starts every later run opted in - a
    browser in a state no member is in.

    `Browser.close` over CDP is a clean shutdown, which flushes. The marker kill
    in `teardown` still runs afterwards and mops up anything that ignored it.

    ⛔ IT MUST RUN WHILE PLAYWRIGHT IS STILL ALIVE. The first attempt put this in
    run_check's outer `finally`, which executes AFTER `with sync_playwright()`
    has exited - every call came back "Event loop is closed! Is Playwright
    already stopped?". A cleanup step that can only ever fail is not a cleanup
    step.
    """
    if page is None:
        return "no page"
    try:
        page.context.new_cdp_session(page).send("Browser.close")
        time.sleep(3)
        return ""
    except Exception as e:                                   # noqa: BLE001
        return f"{type(e).__name__}: {e}"


def teardown(chk: Check | None = None):
    """⛔ Kills the BROWSER by marker and KEEPS THE PROFILE. The profile is the
    signed-in session; deleting it would make every future run need a human."""
    killed = kill_by_marker()
    time.sleep(2)
    procs = browser_processes()
    mine_left = [p for p, mine in procs if mine]
    others = [p for p, mine in procs if not mine]
    released, held = profile_lock_released(timeout=30)
    if chk is not None:
        chk.add("teardown", not mine_left,
                f"killed **{killed}** by marker \u00b7 0 left \u00b7 owner's browser {others} untouched",
                f"{len(mine_left)} marked process(es) survived: {mine_left}")
        chk.add("profile KEPT, lock released", released,
                f"`{PROFILE.name}` retained \u00b7 lock free \u21d2 the next run can open it",
                f"lock still held: {held} \u2014 tomorrow's run would find the profile busy")
        # \u26d4 THE ONLY PLACE THE OPT-OUT CAN BE PROVED DURABLE. Chrome is dead now,
        # so this reads the disk itself rather than a browser's memory \u2014 and a
        # write killed before it flushes is LOST (measured 2026-09-10). Without
        # this, a green "opted back out" can sit on top of a disk still holding
        # '1', and the NEXT run silently starts already opted in.
        if getattr(chk, "canary_ran", False):
            disk = localstorage_on_disk(FLAG_KEY)
            chk.add("opt-out reached DISK (Chrome not running)", disk.get("value") == "0",
                    f"on-disk `{FLAG_KEY}` = **`'{disk.get('value')}'`** "
                    f"\u00b7 {disk.get('appends')} append(s) \u00b7 tail `{disk.get('sequence','')[-12:]}`",
                    f"on-disk value is **`{disk.get('value')!r}`**, not `'0'` \u2014 the opt-out "
                    "did not survive the kill; the NEXT run starts ALREADY OPTED IN")
    return killed, mine_left, others, released, held


def run_check(label: str, with_canary: bool, number: int = 0) -> Check:
    from playwright.sync_api import sync_playwright

    chk = Check(label=label, number=number)
    proc, endpoint, version = spawn_rig()
    chk.add("rig", bool(version),
            f"PID **{proc.pid}** \u00b7 {version['Browser']} \u00b7 CDP `{endpoint.split('//')[1]}` \u00b7 **persistent profile**" if version else None,
            "CDP endpoint never answered")
    if not version:
        teardown(chk)
        return chk

    note_id = None
    browser_handle = None
    try:
        with sync_playwright() as pw:
            b = pw.chromium.connect_over_cdp(endpoint)
            browser_handle = b
            ctx = b.contexts[0]
            page = ctx.pages[0] if ctx.pages else ctx.new_page()
            cdp = page.context.new_cdp_session(page)
            cdp.send("Network.enable")
            offline = _offliner(cdp)
            offline(False)

            # ── 0. AUTH FIRST. Everything else is meaningless without it. ────
            page.goto(PROD + "/journal/notebook", wait_until="domcontentloaded")
            page.wait_for_timeout(6000)
            me = page.evaluate(AUTH_JS)
            healed = ""
            if me.get("status") != 200 or me.get("id") != ACCOUNT_ID:
                # ⭐ SELF-HEAL FIRST. A signed-out rig is the one thing that can
                # break an unattended run, so try to fix it before reporting it.
                ok, detail = reauthenticate(page)
                if ok:
                    page.goto(PROD + "/journal/notebook", wait_until="domcontentloaded")
                    page.wait_for_timeout(5000)
                    me = page.evaluate(AUTH_JS)
                    healed = f" · ⭐ **self-healed**: {detail}"
                else:
                    healed = f" · re-auth unavailable: {detail}"
            if me.get("status") != 200 or me.get("id") != ACCOUNT_ID:
                chk.needs_signin = True
                chk.add("signed in", False,
                        error=f"/api/auth/me returned {me.get('status')}{healed}")
                return chk
            chk.add("signed in", True, f"`/api/auth/me` **200**, account `{me.get('id')}`{healed}")

            puts = []
            page.on("request", lambda r: puts.append({
                "url": r.url, "baseUpdatedAt": _put_baseline(r)})
                if r.method == "PUT" and "/api/j2/notes/" in r.url else None)

            offline(True); page.wait_for_timeout(800)
            off, off_flag = page.evaluate(PROBE), page.evaluate("() => navigator.onLine")
            offline(False); page.wait_for_timeout(800)
            on, on_flag = page.evaluate(PROBE), page.evaluate("() => navigator.onLine")
            chk.add("offline proven both ways",
                    off.startswith("FAILED") and off_flag is False and on.startswith("ONLINE") and on_flag is True,
                    f"offline \u21d2 `{off}`, `onLine={str(off_flag).lower()}` \u00b7 online \u21d2 `{on}`, `{str(on_flag).lower()}`",
                    "CDP offline did not cut the transport")

            st = page.evaluate(STATE_JS, ACCOUNT_ID)
            stores_ok, stores_txt = render_stores(st)
            chk.add("four durable stores", stores_ok, stores_txt, stores_txt)
            # ⛔ BOTH READINGS. The census can count a FROZEN holder from an
            # earlier page; the claim is whether this run can actually lead.
            chk.add("notebook locks", st.get("locks") != "ERR",
                    f"**{st.get('locks')}** `uct.nb.sync.*` · claimable: "
                    f"**{st.get('lockClaimable')}**", "navigator.locks unavailable")
            key = st.get("optInKey")
            chk.add("opt-in key", True, _render_key(key))

            nt = page.evaluate(NOTES_JS)
            chk.add("notes", bool(nt.get("ok")),
                    f"**{nt.get('total')}** \u00b7 canary notes {len(nt.get('canary') or [])} \u00b7 `sync-conflict` {len(nt.get('conflicts') or [])}"
                    if nt.get("ok") else None,
                    f"GET /api/j2/notes returned {nt.get('status')}")

            act = page.evaluate(ACTIVITY_JS, [BLOCKED_EVENT, OPT_IN_EVENT])
            if act.get("ok"):
                scope = act.get("scope", "?")
                bl, oi = act[BLOCKED_EVENT], act[OPT_IN_EVENT]
                cap = ("  \u26a0\ufe0f the export caps at 100 rows and returned a full page \u2014 "
                       "an older event may have fallen off" if act.get("rowCap") else "")
                chk.add("telemetry scope", True,
                        f"**{scope}**" + ("" if act.get("adminStatus") == 200 else
                                          f" \u2014 `/api/admin/activity` said **{act.get('adminStatus')}**, so this account is not in `ADMIN_EMAILS`"))
                chk.add("`j2:notebook_blocked_no_baseline`", True,
                        f"count **{bl['count']}** \u00b7 latest {bl['latest'] or '**none**'} \u00b7 scope: {scope}{cap}")
                chk.add("opted-in browsers (`j2:notebook_offline_opt_in`)", True,
                        f"count **{oi['count']}** \u00b7 latest {oi['latest'] or '**none**'} \u00b7 scope: {scope}"
                        + ("  \u26d4\u26d4 **zero events over zero opted-in browsers is not evidence**"
                           if oi["count"] == 0 else ""))
            else:
                for n in ("`j2:notebook_blocked_no_baseline`", "opted-in browsers (`j2:notebook_offline_opt_in`)"):
                    chk.add(n, False,
                            error=f"admin said {act.get('adminStatus')} and `/api/auth/export-data` said {act.get('status')}")

            if with_canary:
                note_id = _mini_canary(chk, page, offline, puts)
    finally:
        teardown(chk)
        if chk.findings and note_id:
            chk.add("\U0001f6a8 evidence kept", True,
                    f"canary note **`{note_id}`** was NOT deleted \u2014 inspect it before anything else")
    return chk


def render_stores(state: dict) -> tuple:
    """⛔ ABSENCE IS NOT FAILURE WHEN ABSENCE IS THE CORRECT STATE.

    With the offline layer off, there SHOULD be no per-account database — that
    is the dark posture working, and scoring it as "could not read" made a
    healthy rig look broken and refused a row that deserved to be stamped.

    The three cases are genuinely different:
      missing + opted OUT → expected at rest
      missing + opted IN  → a real failure: the layer should have built it
      phantom (0 stores)  → an instrument-inflicted break; needs deleting
    """
    key = state.get("optInKey")
    opted_in = key == "1"
    if state.get("dbPhantom"):
        return False, ("a PHANTOM database exists with **zero object stores** — "
                       "something opened it with no version. Delete it so the app can rebuild.")
    if state.get("dbMissing"):
        if opted_in:
            return False, "opted IN but no per-account database exists — the layer did not initialise"
        return True, "**none** — the layer is off, so there is no per-account database (expected at rest)"
    stores = state.get("stores")
    if not isinstance(stores, dict) or not stores:
        return False, f"could not read the per-account database ({stores!r})"
    return True, " · ".join(f"`{k}` {v}" for k, v in stores.items())


def _render_key(key) -> str:
    if key is None:
        return "**unset** \u2014 a profile that has never opted in"
    if key == "0":
        return "**`'0'`** \u2014 the rig's own last opt-out. \u26a0\ufe0f On a PERSISTENT profile this is the expected reading from run 2 onward; `unset` only ever appears on run 1."
    return f"**`'{key}'`** \u21d2 **OPTED IN** \u2014 unexpected at rest; a previous run did not opt back out"


def _canary_tail(chk: Check, page, note_id) -> str | None:
    """Decide, THEN clean. Never the other way round.

    ⛔⛔ Split out of `_canary_body` so `--self-check` can drive the REAL
    decision rather than assert about the order of two lines: a run that forks
    must reach the end with BOTH halves of the artifact present, and a run that
    does not fork must still clean up. A rail that only proved the first would
    have traded a destructive bug for a litter bug.
    """
    # \u26d4\u26d4 THE FORK IS DETECTED **BEFORE** ANYTHING IS DELETED.
    #
    # It used to be detected AFTER the cleanup block, and `should_clean_up` was
    # evaluated ABOVE it \u2014 so the guard whose whole job is "a finding is on the
    # account, keep the evidence" could not see the single-writer fork, because
    # the fork finding did not exist yet. On 2026-09-10 that cost us HALF the
    # artifact: the run created a `(conflicted copy)` at 16:55:43Z and deleted its
    # own ORIGINAL at 16:55:52Z \u2014 nine seconds later \u2014 and only then noticed. The
    # pair was recoverable solely because the delete is soft (Wave 0 trash).
    #
    # \u2b50 This is the same shape as the opt-out defect: A DECISION MADE BEFORE THE
    # INFORMATION THAT SHOULD DRIVE IT EXISTS. Read the notes first, decide second.
    # \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
    pre_notes = page.evaluate(NOTES_JS)
    pre_canary = pre_notes.get("canary") or []
    # BASELINED - AND IT WAS NOT, WHICH COST THIS WAVE A FALSE HARD RED.
    #
    # 2026-09-11T12:07Z: the first armed run of the re-armed streak reported
    # "THIS RUN FORKED ITS OWN NOTE - HARD RED" and named
    # `WINDOW-CHECK-SENTINEL 2026-09-11T00:00:56Z (conflicted copy)` - a note
    # created TWELVE HOURS EARLIER and deliberately preserved as round-3
    # evidence. The detector took every conflicted copy on the account as this
    # run's own output. The same run's arithmetic said `34 -> 35 (expected 35)`:
    # a real fork would have made it 36, so the instrument contradicted itself
    # and the COUNT was the half telling the truth.
    #
    # This is the same defect already fixed once in `tools/q1_repro.py` and never
    # carried across to here - lesson_a_guard_repeated_is_a_guard_unproved in its
    # other form: a guard fixed in one copy is not fixed.
    forks, _preexisting = split_forks(pre_canary, chk.forks_before)
    if forks:
        chk.findings.append(
            "**a SINGLE-WRITER offline session produced a `(conflicted copy)`** \u2014 "
            f"{len(forks)}: {forks}. The editor's own save moved the server after "
            "the outbox entry captured its baseline, so the drain's send 409'd and "
            "forked. No second device was involved."
        )
    # \u26d4\u26d4 HARD RED. Not a warning and not litter: a single-writer fork is the
    # defect the 2026-09-10 evidence set found, and a run that sees one must
    # refuse its row and KEEP BOTH HALVES of the artifact.
    chk.step("5 no fork from a single writer", not forks,
             "no `(conflicted copy)` created by this run"
             + (f" - {len(_preexisting)} pre-existing, excluded by baseline"
                if _preexisting else " - no pre-existing copies to exclude"),
             f"THIS RUN FORKED ITS OWN NOTE \u2014 HARD RED: {forks}")

    # \u26d4 THE ARITHMETIC, BESIDE THE FORK AND BEFORE THE DELETE. A fork and a
    # discard are DIFFERENT failures: the sentence catches the discard, this
    # catches anything the account GAINED \u2014 including a copy whose title the fork
    # regex never matched. Exactly one note should exist beyond the baseline: the
    # one this run created.
    pre_total = pre_notes.get("total")
    expected = chk.notes_before + 1 if isinstance(chk.notes_before, int) else None
    count_ok = isinstance(pre_total, int) and pre_total == expected
    chk.step("5 note count moved by exactly this run's own note", count_ok,
             f"**{chk.notes_before} \u2192 {pre_total}** (expected **{expected}**)",
             f"the account holds **{pre_total}** notes, expected **{expected}** "
             f"(baseline {chk.notes_before} + this run's one note)"
             if isinstance(pre_total, int) else
             f"the note list could not be read: {pre_notes!r}")
    if isinstance(pre_total, int) and isinstance(expected, int) and pre_total != expected:
        chk.findings.append(
            f"**the account's note count is {pre_total}, not {expected}** \u2014 this run's own note "
            f"accounts for one; the other {pre_total - expected:+d} is unexplained. A fork and a "
            "discard are different failures and this is the one that counts notes. PRESERVED."
        )

    # \u26d4 EVALUATED HERE, with every finding already appended \u2014 including the fork.
    if not should_clean_up(chk.findings):
        chk.step("5 cleanup", True,
                 "\U0001f6a8 **SKIPPED ON PURPOSE** \u2014 a finding is on the account and "
                 "the evidence stays, ORIGINAL AND COPY BOTH")
        return note_id

    page.evaluate("""async (id) => { await fetch('/api/j2/notes/' + id, {method:'DELETE', credentials:'include'}) }""", note_id)
    # ⛔ `indexedDB.open(name)` WITH NO VERSION CREATES THE DATABASE IF IT IS
    # MISSING — an empty one, with zero object stores. So a reader can conjure a
    # phantom DB as a side effect, and `transaction([])` then throws
    # InvalidAccessError, which is what killed check 5's second run. Guard on the
    # store list rather than assuming the layer has initialised.
    page.evaluate("""async (acct) => {
        const db = await new Promise(res => { const r = indexedDB.open('uct_notebook_'+acct); r.onsuccess = () => res(r.result) });
        const stores = [...db.objectStoreNames];
        if (stores.length) {
            const tx = db.transaction(stores, 'readwrite');
            stores.forEach(s => tx.objectStore(s).clear());
            await new Promise(res => { tx.oncomplete = res; tx.onerror = res });
        }
        for (const k of Object.keys(localStorage)) if (k.startsWith('uct.j2.notedraft.')) localStorage.removeItem(k);
        return {storesCleared: stores.length};
    }""", ACCOUNT_ID)
    # ⛔ ORDERING, and it is load-bearing: opt out BEFORE the verification reload.
    # Reloading the notebook while still opted IN re-engages the offline layer and
    # re-creates the stores this next read is about to call empty. The `finally`
    # in `_mini_canary` is the guarantee; this call is the ordering.
    opt_out(page)
    page.goto(PROD + "/journal/notebook", wait_until="domcontentloaded")
    page.wait_for_timeout(7000)
    end = page.evaluate(STATE_JS, ACCOUNT_ID)
    end_notes = page.evaluate(NOTES_JS)
    # \u26a0\ufe0f An EMPTY store map is not the same as "all four stores read 0". A
    # phantom database (opened with no version, never initialised) has no stores
    # at all, and `all()` over nothing is vacuously True \u2014 the exact shape of a
    # check that passes because it measured nothing.
    stores = end.get("stores") if isinstance(end.get("stores"), dict) else None
    zeroed = bool(stores) and all(v == 0 for v in stores.values())
    # BASELINED, for the third time and by the shared helper. The account
    # deliberately holds preserved round-3 evidence; counting it as this run's
    # litter turned a clean run red and would have had the next operator
    # "tidying" the very artifact the doc says nobody may touch (R-X, R-Z).
    leftovers = new_since(end_notes.get("canary") or [], chk.canary_before)
    _kept_before = [t for t in (end_notes.get("canary") or []) if t in set(chk.canary_before)]

    # ⭐ POST-cleanup leftovers, for the cleanup RECEIPT only. The fork question
    # is asked and answered ABOVE, on the PRE-cleanup list, before anything can be
    # deleted — one authority, and it runs before the delete that used to destroy
    # half the evidence.

    reasons = []
    if not zeroed:
        reasons.append(f"stores not all zero ({stores!r})")
    # ⛔ THE CLAIM, NOT THE CENSUS. `locks != 0` failed a clean run on
    # 2026-09-11 by counting a FROZEN holder (see STATE_JS). What this row
    # promises is that the next run can lead, and the only honest test of
    # that is to ask for the lock.
    if end.get("lockClaimable") is not True:
        # NAME THE HOLDER'S NEIGHBOURHOOD TOO. A Web Lock belongs to an
        # execution context, so "which pages are open" is half the answer and
        # this profile is PERSISTENT - it can restore tabs from a prior session.
        try:
            _pages = [pg.url for pg in page.context.pages]
        except Exception:                                    # noqa: BLE001
            _pages = ["<unreadable>"]
        reasons.append(f"the sync lock could NOT be claimed in 5s (lockClaimable="
                       f"{end.get('lockClaimable')!r}) - something LIVE holds it: "
                       f"{end.get('lockDetail')!r} ; {len(_pages)} page(s) open: {_pages}")
    # ⭐ The opt-in key is NOT asserted here any more. `_mini_canary`'s `finally`
    # owns it, asserts it, and runs on every exit — including the two this step
    # can never be reached from. One authority, at the point of the action.
    if leftovers:
        reasons.append(f"{len(leftovers)} leftover note(s) THIS RUN LEFT: {leftovers}")
    # ⛔ AND THE COUNT COMES BACK. A cleanup that leaves the account one note
    # heavier than it found it is litter; one note lighter is worse.
    end_total = end_notes.get("total")
    if isinstance(chk.notes_before, int) and isinstance(end_total, int) and end_total != chk.notes_before:
        reasons.append(f"note count ended at {end_total}, baseline was {chk.notes_before}")
    chk.step("5 cleanup \u2192 stores 0, sync lock claimable, opted out", not reasons,
             f"stores all zero: **{zeroed}** \u00b7 sync lock claimable: **{end.get('lockClaimable')}** (census **{end.get('locks')}**) \u00b7 key **`'{end.get('optInKey')}'`** \u00b7 leftover canary notes **{len(leftovers)}** (+{len(_kept_before)} pre-existing, excluded) \u00b7 notes **{chk.notes_before} \u2192 {end_total}**",
             # \u26d4 Name the sub-condition that failed. "cleanup incomplete" while
             # printing three values that all look fine cost a diagnosis today.
             "cleanup incomplete: " + " \u00b7 ".join(reasons))
    return note_id

def _put_baseline(req):
    try:
        body = req.post_data
        return json.loads(body).get("baseUpdatedAt", "<absent>") if body else "<no body>"
    except Exception:  # noqa: BLE001
        return "<unreadable>"


def localstorage_on_disk(key: str, profile=None) -> dict:
    """The last value this key was written with, read from the profile's leveldb
    WITH CHROME NOT RUNNING.

    ⭐ The only instrument that can disagree with the browser. An in-memory
    read-back cannot tell `written` from `flushed`, and that difference is a real
    one here: measured 2026-09-10, a localStorage write followed by an IMMEDIATE
    kill-by-marker is LOST (the value never reaches disk and reads back absent on
    the next open), while the same write followed by a settle and a navigation
    survives. So a green "opted back out" can sit on top of a disk that still
    says '1', and the next run then starts ALREADY OPTED IN — a different code
    path, with the layer engaged from first paint.

    The log is append-ordered and uncompacted here, so the highest offset is the
    newest write. Byte layout after the key on this Chrome: `\\x02\\x01<value>`.
    """
    profile = PROFILE if profile is None else pathlib.Path(profile)
    d = profile / "Default" / "Local Storage" / "leveldb"
    out = {"dir": str(d), "exists": d.exists(), "appends": 0,
           "sequence": "", "value": None, "raw": []}
    if not d.exists():
        return out
    needle = key.encode("utf-8")
    hits = []
    for f in sorted(d.iterdir()):
        if not f.is_file() or f.name in ("LOCK", "CURRENT"):
            continue
        try:
            blob = f.read_bytes()
        except OSError:
            continue
        start = 0
        while True:
            i = blob.find(needle, start)
            if i < 0:
                break
            tail = blob[i + len(needle): i + len(needle) + 3]
            ch = chr(tail[2]) if len(tail) > 2 and 32 <= tail[2] < 127 else None
            hits.append((f.name, i, ch, tail.hex()))
            start = i + 1
    hits.sort(key=lambda h: (h[0], h[1]))
    out["appends"] = len(hits)
    out["sequence"] = "".join(h[2] or "?" for h in hits)
    out["raw"] = [{"file": h[0], "offset": h[1], "value": h[2], "bytes": h[3]} for h in hits[-8:]]
    out["value"] = hits[-1][2] if hits else None
    return out


def opt_out(page) -> tuple:
    """Put the browser back to opted-OUT, and READ IT BACK. Returns (ok, value).

    ⛔ IT FORCES A FLUSH BEFORE RETURNING. Measured 2026-09-10: a write killed
    immediately afterwards never reaches disk, and this call is the LAST thing a
    run does before `teardown` kills the browser — exactly the losing shape. The
    settle-and-navigate is not politeness, it is the difference between the next
    run starting at rest and starting already opted in.

    ⛔⛔ THIS USED TO LIVE INSIDE THE CLEANUP BLOCK, WHICH IS THE ONE BRANCH THAT
    DOES NOT ALWAYS RUN. Three ways to skip it, and the log has two of them:

      · `if not should_clean_up(chk.findings): return` — cleanup is skipped ON
        PURPOSE when a finding is on the account, so a run that FOUND something
        also left the profile opted in;
      · the `2 create a note` early return, above it and unconditional —
        `check 11`, 2026-09-10T13:47:22Z, opted in at step 0 and returned;
      · any exception in between: there was no `finally` at all.

    ⭐ PRESERVING EVIDENCE AND STAYING OPTED IN ARE TWO DIFFERENT DECISIONS, and
    they were one branch. The note and the stores are evidence and must survive;
    the browser's opt-in is RIG STATE, and leaving it set silently changes what
    the next run measures — an opt-in counted per distinct profile is meaningless
    if one profile starts already opted in.

    ⛔ It reads the value BACK. A cleanup that cannot say whether it happened is
    the shape of the defect this whole wave keeps re-finding.
    ⭐ And it uses FLAG_KEY. The old line spelled `'uct.j2.offline.enabled'` in
    the JS while the opt-in passed FLAG_KEY — two authorities over one value that
    agreed only by luck.
    """
    try:
        got = page.evaluate(
            "(k) => { try { localStorage.setItem(k, '0'); return localStorage.getItem(k) }"
            "        catch (e) { return 'ERR: ' + e.name } }", FLAG_KEY)
        # ⛔ THE FLUSH. `/api/health` is a JSON document on the same origin — it
        # costs one request and runs NO app code, so it cannot mount the notebook
        # or start a drain while we are only trying to make a write durable.
        #
        # ⛔⛔ THESE DURATIONS ARE MEASURED, NOT CHOSEN. A settle of 1.5s + one
        # navigate + 1.5s was NOT enough: a localStorage removal under exactly
        # that pattern read back as gone IN MEMORY and was still on disk on the
        # next open, TWICE (2026-09-10). The pattern below is the one that came
        # back clean on a verifying reopen. ⚠️ Two points do not establish a rate,
        # so this is not "the flush time" — it is a bound that has held. The
        # AUTHORITY is `teardown`'s on-disk check with Chrome dead; if that ever
        # goes red, lengthen this rather than trusting the in-memory read-back.
        page.wait_for_timeout(6000)
        page.goto(PROD + "/api/health", wait_until="domcontentloaded")
        page.wait_for_timeout(4000)
        page.goto(PROD + "/api/health", wait_until="domcontentloaded")
        page.wait_for_timeout(4000)
        got = page.evaluate(
            "(k) => { try { return localStorage.getItem(k) } catch (e) { return 'ERR: ' + e.name } }",
            FLAG_KEY)
    except Exception as e:  # noqa: BLE001
        got = f"ERR: {type(e).__name__}"
    return got == "0", got


def _mini_canary(chk: Check, page, offline, puts, body=None) -> str | None:
    """Opt in, run the §15 path, and opt back out — WHATEVER happened in between.

    ⭐ The `body` seam exists so `--self-check` can drive the REAL control flow
    (an early return, an exception) instead of restating it. A rail that asserts
    "there is a finally" proves nothing about whether the finally does the work;
    this one makes the body return early and makes it raise, and watches.
    """
    chk.canary_ran = True
    page.evaluate("(k) => localStorage.setItem(k, '1')", FLAG_KEY)
    try:
        return (body or _canary_body)(chk, page, offline, puts)
    finally:
        # ⛔ EVERY exit lands here: the happy path, both early returns, and any
        # exception on its way out.
        ok, got = opt_out(page)
        chk.step("5 opted back out — ALWAYS, finding or not", ok,
                 f"`{FLAG_KEY}` read back as `'0'`",
                 f"the opt-out did not take (read back {got!r}) — THE RIG PROFILE IS "
                 "LEFT OPTED IN and the next run does not start from rest")
        # ⛔ AND IT HAS TO REACH DISK. The read-back above is truthful about
        # MEMORY and says nothing about the store: Chrome batches localStorage,
        # and the marker kill in `teardown` loses whatever has not flushed.
        # Measured 2026-09-11 - on-disk `appends: 0, raw: []`, the key absent
        # entirely, while this very step read back a green `'0'`. Asking Chrome
        # to exit cleanly here, while Playwright is still alive, is what makes
        # the opt-out durable; `teardown` still kills by marker afterwards.
        _flush_why = flush_localstorage(page)
        if _flush_why:
            chk.add("graceful close so the opt-out reaches disk", False,
                    error=f"Chrome would not exit cleanly ({_flush_why}) - the "
                          "opt-out may be lost when the kill lands")



def _canary_body(chk: Check, page, offline, puts) -> str | None:
    """The §15 happy path, every day, artifact captured at every step."""
    note_id = None
    # ⛔ THE SENTENCE THIS RUN WILL TYPE OFFLINE — decided once, here, and used
    # both to type and to assert. See `offline_sentence`.
    sentence = offline_sentence(chk.started)

    page.goto(PROD + "/journal/notebook", wait_until="domcontentloaded")
    page.wait_for_timeout(7000)
    # ⛔ THE COUNT BEFORE ANYTHING IS CREATED. Read here, not borrowed from the
    # reads above, so the canary can be driven on its own and so the arithmetic
    # is anchored to the moment the run starts touching the account.
    nt0 = page.evaluate(NOTES_JS)
    chk.notes_before = nt0.get("total") if isinstance(nt0, dict) else None
    # Captured at the SAME moment as the count, and for the same reason.
    chk.canary_before = tuple(nt0.get("canary") or ()) if isinstance(nt0, dict) else ()
    chk.forks_before = tuple(t for t in chk.canary_before if "(conflicted copy)" in t)
    st = page.evaluate(STATE_JS, ACCOUNT_ID)
    ok1 = st.get("held") == ["exclusive"] and st.get("pending") == 0 and st.get("dbOpened") is True
    chk.step("1 opt in \u2192 leadership", ok1,
             f"held **{st.get('held')}**, pending **{st.get('pending')}**, DB opened with {len(st.get('storeNames') or [])} stores",
             f"expected one EXCLUSIVE lock and an open DB; got held={st.get('held')} pending={st.get('pending')} dbOpened={st.get('dbOpened')}")

    created = page.evaluate("""async (t) => {
        const r = await fetch('/api/j2/notes', {method:'POST', credentials:'include',
          headers:{'Content-Type':'application/json'},
          body: JSON.stringify({title: t, bodyJson: {type:'doc', content:[]}})});
        if (!r.ok) return {ok:false, status:r.status};
        const b = await r.json();
        return {ok:true, id: b.note?.id ?? b.id};
    }""", f"{SENTINEL} {chk.started}")
    if not created.get("ok"):
        chk.step("2 create a note", False, error=f"POST /api/j2/notes returned {created.get('status')}")
        return None
    note_id = created["id"]
    puts.clear()
    page.goto(f"{PROD}/journal/notebook?note={note_id}", wait_until="domcontentloaded")
    page.wait_for_timeout(6000)
    try:
        pm = page.query_selector(".ProseMirror")
        if pm:
            pm.click(); page.keyboard.type(f"{SENTINEL} typed online.")
    except Exception:  # noqa: BLE001
        pass
    page.wait_for_timeout(6000)
    online_puts = [p for p in puts if note_id in p["url"]]
    bases = [p["baseUpdatedAt"] for p in online_puts]
    ok2 = len(online_puts) >= 1 and all(isinstance(x, str) and x.strip() and x != "<absent>" for x in bases)
    chk.step("2 type online \u2192 one CAS PUT", ok2,
             f"**{len(online_puts)}** PUT(s), baseline(s) `{bases}`",
             f"expected at least one PUT carrying a real baseline; got {bases}")
    if bases:
        chk.findings += baseline_findings("online PUT", {"baseUpdatedAt": bases[0]})

    offline(True); page.wait_for_timeout(1000)
    pr = page.evaluate(PROBE)
    chk.step("3 offline is real", pr.startswith("FAILED"), f"`{pr}`", f"probe said `{pr}` \u2014 the transport was not cut")
    try:
        pm = page.query_selector(".ProseMirror")
        if pm:
            pm.click(); page.keyboard.press("End"); page.keyboard.type(" " + sentence)
    except Exception:  # noqa: BLE001
        pass
    page.wait_for_timeout(6000)
    before = page.evaluate(LAYERS_JS, {"acct": ACCOUNT_ID, "id": note_id})

    # ⛔ NETWORK UP FIRST — no service worker, so an offline reload proves nothing.
    offline(False)

    # ══════════════════════════════════════════════════════════════════════════
    # ⭐ THE DOOR. Back online, and BEFORE the drain gets its chance, ONE metadata
    # PUT moves the server's `updatedAt` out from under the queued entry. No
    # second device, no second writer — the member's own editor changing a field
    # that says nothing about the words.
    #
    # ⛔ No wait in front of it. This PUT and the drain are in a race by nature,
    # so the race is BIASED and then REPORTED, never assumed: `sends_before_door`
    # counts this note's PUTs that already flew, so a run where the drain won says
    # so instead of quietly claiming a rebase that never had to happen.
    # ══════════════════════════════════════════════════════════════════════════
    door = door_for(chk.number)
    chk.door = door
    sends_before_door = len([p for p in puts if note_id in p["url"]]) - len(online_puts)
    # ⛔⛔ THE MEMBER'S DOOR, not a script's. This was `DOOR_JS` — a raw fetch —
    # and that is a SECOND-WRITER simulation whose fork is correct. Reading it as
    # a defect in the member's path cost this wave three deploys.
    _val = DOOR_PATCH["ticker"]["ticker"] if door == "ticker" else DOOR_PATCH["tags"]["tags"][0]
    _rr = page.evaluate(REAL_DOOR_JS, {"door": door, "value": _val})
    if not (isinstance(_rr, dict) and _rr.get("ok")):
        # ⛔ INCONCLUSIVE, NOT GREEN, AND NOT A RAW-FETCH FALLBACK. Falling back
        # to DOOR_JS here would silently reintroduce the artifact.
        chk.step(f"4 door `{door}` (the member's own control)", False,
                 f"could not be driven: {_rr}",
                 f"the real door could not be driven ({_rr}) — this run did NOT exercise a door")
        dr = {"status": None, "before": None, "after": None, "attempts": 0}
    else:
        page.wait_for_timeout(4000)
        _after = page.evaluate(
            "async (id) => (await (await fetch('/api/j2/notes/'+id,{credentials:'include'})).json()).note?.updatedAt",
            note_id)
        dr = {"status": 200, "before": None, "after": _after, "attempts": 1, "via": _rr.get("via")}
    if not isinstance(dr, dict):
        dr = {"status": None, "before": None, "after": None}
    door_moved = (dr.get("status") == 200 and isinstance(dr.get("after"), str)
                  and dr.get("after").strip() != "" and dr.get("after") != dr.get("before"))
    chk.step(f"4 door `{door}` moved the baseline under the queued entry", door_moved,
             f"run **#{chk.number}** ⇒ `DOORS[{chk.number} % 3]` = **`{door}`** · "
             f"PUT **{dr.get('status')}** in **{dr.get('attempts')}** attempt(s) · "
             f"baseline `{dr.get('before')}` → `{dr.get('after')}` · "
             f"queued sends that beat it: **{sends_before_door}**",
             f"the metadata PUT did not move the baseline (status {dr.get('status')}, "
             f"{dr.get('before')} → {dr.get('after')}) — this run did NOT exercise the rebase")
    # ⛔ Only when the write actually landed: a 200 whose note carries no
    # timestamp is the finding this tool hunts; a failed PUT is a red step, and
    # calling it a baseline finding would preserve evidence of nothing.
    if dr.get("status") == 200:
        chk.findings += baseline_findings(f"door-{door}", {"baseUpdatedAt": dr.get("after")})

    page.wait_for_timeout(1500)
    page.goto(f"{PROD}/journal/notebook?note={note_id}", wait_until="domcontentloaded")
    page.wait_for_timeout(8000)
    after = page.evaluate(LAYERS_JS, {"acct": ACCOUNT_ID, "id": note_id})
    rec = after.get("record") if isinstance(after.get("record"), dict) else {}
    # ⛔ THE SENTENCE HERE TOO, one layer down. "record holds text" is the same
    # uninformative green as "server holds text": the words typed ONLINE satisfy
    # it, so a local layer that dropped the member's offline sentence would read
    # healthy. Ask for the sentence, in every layer this step speaks for.
    draft_ok = (sentence in _doc_text((after.get("draft") or {}).get("bodyJson"))
                if isinstance(after.get("draft"), dict) else False)
    rec_ok = sentence in _doc_text(rec.get("bodyJson"))
    ob = _as_list(after.get("outbox"))
    # \u26d4 A layer that could not be READ is not a layer that is empty. Fail the
    # step and say which, rather than drawing a conclusion from a failed read.
    # THE WORDS ARE SAFE IF THEY ARE DURABLE AND EITHER QUEUED OR ALREADY LANDED.
    #
    # 2026-09-11: this step failed a HEALTHY run with record=True draft=False
    # outbox=0. It required `draft_ok or ob`, and with the network UP at reload
    # the drain had already succeeded - so the draft was legitimately cleared and
    # the queue legitimately empty, while the durable record held the sentence and
    # the server body (checked later in the same run) held it too. The member had
    # lost nothing; the assertion had simply named two layers that a SUCCESSFUL
    # sync is supposed to empty.
    #
    # The guard keeps its strength and loses the false red: the record must hold
    # the words, AND they must be either still queued or already on the server.
    # `LAYERS_JS` already returns the server copy, so this costs no extra read.
    srv_now = after.get("server") if isinstance(after.get("server"), dict) else {}
    server_has = sentence in _doc_text(srv_now.get("bodyJson"))
    unread = layer_read_failed(before) + layer_read_failed(after)
    chk.step("3 reload (network UP) \u2192 the local layers hold THE OFFLINE SENTENCE",
             rec_ok and (bool(ob) or server_has) and not unread,
             f"record holds the sentence: **{rec_ok}** \u00b7 draft holds the sentence: **{draft_ok}** \u00b7 outbox entries: **{len(ob)}** \u00b7 baseline `{rec.get('baseUpdatedAt')}`",
             ("layers that could not be read: " + ", ".join(unread)) if unread
             else (f"a local layer came back without the sentence - THE INCIDENT'S SHAPE. "
                   f"record={rec_ok} draft={draft_ok} outbox={len(ob)} server={server_has} "
                   f"baseline={rec.get('baseUpdatedAt')!r} sentence={sentence!r}"))
    for lab, art in (("pre-reload record", before.get("record")), ("post-reload record", rec)):
        if isinstance(art, dict):
            chk.findings += baseline_findings(lab, art) + empty_document_findings(lab, art)
    for e in _as_list(before.get("outbox")) + ob:
        if isinstance(e, dict):
            chk.findings += baseline_findings("outbox entry", e)

    page.goto(PROD + "/journal/notebook", wait_until="domcontentloaded")
    page.wait_for_timeout(12000)
    settled = page.evaluate(LAYERS_JS, {"acct": ACCOUNT_ID, "id": note_id})
    srec = settled.get("record") if isinstance(settled.get("record"), dict) else {}
    srv = settled.get("server") if isinstance(settled.get("server"), dict) else {}
    # \u26d4\u26d4 "server holds text" IS GONE FROM THIS STEP \u2014 DELETED, not kept beside
    # the real one. It was satisfied by the words typed ONLINE, so it read GREEN
    # through a run that threw the member's offline sentence away (streak run 1,
    # door `folder`, 2026-09-10). A step that cannot distinguish success from the
    # failure it exists to catch is a green light with no information in it.
    # The body question is asked below, ONCE, against the exact sentence typed.
    chk.step("4 reconnect \u2192 the queue settled (this step says NOTHING about the body)",
             srec.get("dirty") == 0 and not _as_list(settled.get("outbox"))
             and not layer_read_failed(settled),
             f"`dirty` **{srec.get('dirty')}** \u00b7 outbox **{len(_as_list(settled.get('outbox')))}** \u00b7 baseline `{srec.get('baseUpdatedAt')}`",
             ("layers that could not be read: " + ", ".join(layer_read_failed(settled)))
             if layer_read_failed(settled) else
             f"queue did not settle: dirty={srec.get('dirty')} outbox={len(_as_list(settled.get('outbox')))}")
    chk.findings += baseline_findings("settled record", srec)

    # ══════════════════════════════════════════════════════════════════════════
    # ⛔⛔ THE ASSERTION, AND THE WAVE'S ONE RULE:
    #   A QUEUED ENTRY IS NEVER REMOVED UNLESS THE SERVER BODY IS PROVEN TO
    #   CONTAIN ITS CONTENT.
    # So this is the only body question the canary asks, and it asks it against
    # the EXACT sentence this run typed while the transport was cut — not "is
    # there text", which the online words answer for free.
    # (The fork half is answered in `_canary_tail`, before anything is deleted;
    # the note-count half is answered there too.)
    # ══════════════════════════════════════════════════════════════════════════
    landed = sentence in _doc_text(srv.get("bodyJson"))
    door_kept, door_note = door_survived(door, srv)
    # ⭐ REPORTED, NOT GATED: a send carrying the post-door baseline is proof the
    # entry was re-based rather than replayed stale. When the drain beat the door
    # (see `sends_before_door`) there was nothing to rebase, and gating on it
    # would turn a race we lost into a red that means nothing.
    rebased = [p for p in puts if note_id in p["url"] and p["baseUpdatedAt"] == dr.get("after")]
    land_reasons = []
    if not landed:
        land_reasons.append(f"the server BODY DOES NOT CONTAIN the offline sentence `{sentence}` "
                            "— the queued entry was DISCARDED, not rebased")
    if not door_kept:
        land_reasons.append(f"the door value did not survive the drain's send{door_note}")
    chk.step(f"4 the server BODY CONTAINS THE OFFLINE SENTENCE (door `{door}`)", not land_reasons,
             f"`{sentence}` is in the server body: **{landed}** · a send carried the post-door "
             f"baseline `{dr.get('after')}`: **{bool(rebased)}** · door value kept: "
             f"**{door_kept}**{door_note}",
             " · ".join(land_reasons))
    if not landed:
        # ⛔⛔ LOST WORDS IS A HARD STOP, PERMANENTLY. A finding keeps the note on
        # the account: `should_clean_up` refuses and the evidence outlives the run.
        chk.findings.append(
            "**the server body does not contain the member's offline sentence** — "
            f"`{sentence}` is gone. The queued entry was discarded instead of being rebased "
            f"onto door `{door}`'s revision `{dr.get('after')}`. ⛔ The words typed ONLINE are "
            "still there, which is exactly why a 'server holds text' step would read green. "
            "The note is PRESERVED."
        )

    # \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
    return _canary_tail(chk, page, note_id)


# ══════════════════════════════════════════════════════════════════════════════
# stamping + logging
# ══════════════════════════════════════════════════════════════════════════════

# ══════════════════════════════════════════════════════════════════════════════
# THE 9/17 DECISION PACKET — regenerated on every run, so it is never stale.
# ══════════════════════════════════════════════════════════════════════════════

DECISION_BEGIN = "<!-- WINDOW-CHECK:DECISION:BEGIN -->"
DECISION_END = "<!-- WINDOW-CHECK:DECISION:END -->"

GO_MIN_GREEN_RUNS = 7
GO_MIN_OPT_INS = 5


def recommend(events, optins, green_runs, findings_seen) -> tuple:
    """⛔ PURE, so the recommendation can be railed rather than trusted.

    It NEVER flips the flag. It writes a sentence for a person, and it names
    which condition decided it — a verdict without its reason is an opinion.
    """
    blockers, met = [], []
    if findings_seen:
        blockers.append("a 🚨 NEW FINDING has fired — that is a NO-GO on its own")
    if events is None:
        blockers.append("the blocked-baseline event count is **UNREAD**")
    elif events > 0:
        blockers.append(f"**{events}** blocked-baseline event(s) fired — investigate before anything else")
    else:
        met.append("zero blocked-baseline events")
    if optins is None:
        blockers.append("the opt-in count is **UNREAD**")
    elif optins < GO_MIN_OPT_INS:
        blockers.append(f"only **{optins}** opted-in browser(s), need ≥ {GO_MIN_OPT_INS} — "
                        "zero events over a tiny population is not evidence")
    else:
        met.append(f"{optins} opted-in browsers")
    if green_runs < GO_MIN_GREEN_RUNS:
        blockers.append(f"only **{green_runs}** green daily run(s), need {GO_MIN_GREEN_RUNS}")
    else:
        met.append(f"{green_runs} consecutive green runs")
    return ("GO" if not blockers else "NO-GO"), blockers, met


def count_green_checks(text: str) -> int:
    return len(re.findall(re.escape(ROW_MARK) + " ✅", text))


def findings_ever(text: str) -> bool:
    return "NEW FINDING — STOP AND READ THIS" in text


def _num(read: Read | None):
    if read is None or not read.ok:
        return None
    m = re.search(r"count \*\*(\d+)\*\*", str(read.value))
    return int(m.group(1)) if m else None


def decision_block(chk: Check | None, text: str) -> str:
    events = optins = None
    if chk is not None:
        by = {r.name: r for r in chk.reads}
        events = _num(by.get("`j2:notebook_blocked_no_baseline`"))
        optins = _num(by.get("opted-in browsers (`j2:notebook_offline_opt_in`)"))
    green = count_green_checks(text)
    seen = findings_ever(text)
    verdict, blockers, met = recommend(events, optins, green, seen)
    stamp_as = f"{chk.label} — {chk.started}" if chk else "no run yet"

    fmt = lambda v: "⛔ **UNREAD**" if v is None else f"**{v}**"
    lines = [
        DECISION_BEGIN,
        "",
        f"⛔ **REGENERATED BY `tools/window_check.py` ON EVERY RUN — as of {stamp_as}.**",
        "It is never hand-edited: a decision table maintained by hand is one that",
        "goes stale exactly when it matters. Rows 4–9 below it are static and",
        "checked by eye on the day.",
        "",
        "| # | condition | latest reading |",
        "|---|---|---|",
        f"| 1 | Zero `notebook_blocked_no_baseline` across the instrument clock | {fmt(events)} |",
        f"| 2 | Opted-in browsers (the denominator) | {fmt(optins)} — need ≥ **{GO_MIN_OPT_INS}** |",
        f"| 3 | Consecutive green daily runs, mini-canary all steps | **{green}** — need **{GO_MIN_GREEN_RUNS}** |",
        f"| — | Has a 🚨 NEW FINDING ever fired? | **{'YES — NO-GO' if seen else 'no'}** |",
        "",
        f"## {'✅' if verdict == 'GO' else '⛔'} RECOMMENDATION: **{verdict}**",
        "",
    ]
    if met:
        lines += ["**Met:** " + " · ".join(met), ""]
    if blockers:
        lines += ["**What is holding it:**", ""] + [f"- {b}" for b in blockers] + [""]
    lines += [
        "⚠️ **The 36-minute gap stands.** The denominator starts 2026-09-10T05:42:53Z,",
        "the numerator 05:06:56Z. A browser that opted in inside that window is",
        "counted by neither, and that does not shrink with time.",
        "",
        "⚠️ **What no amount of green buys.** Every opted-in browser in that count is",
        "a *canary profile on the owner's machine driving the owner's own account*.",
        "It is not five members on five devices. The flip is still a step from \"it",
        "works when we drive it\" to \"it works for people\", and no amount of green",
        "here closes that distance — only the flip does, which is why the rollback",
        "is one line.",
        "",
        "⛔ **This script never flips the flag.** It writes a recommendation for the",
        "owner and nothing else.",
        "",
        DECISION_END,
    ]
    return "\n".join(lines)


def update_decision_packet(chk: Check | None, dry_run: bool = False) -> bool:
    try:
        text = DOC.read_text(encoding="utf-8")
    except OSError:
        return False
    if DECISION_BEGIN not in text or DECISION_END not in text:
        return False
    i = text.index(DECISION_BEGIN)
    j = text.index(DECISION_END) + len(DECISION_END)
    out = text[:i] + decision_block(chk, text) + text[j:]
    if dry_run:
        return True
    _write_doc(out)
    return True


def log_line(text: str) -> None:
    try:
        LOG.parent.mkdir(parents=True, exist_ok=True)
        with LOG.open("a", encoding="utf-8", newline="") as fh:
            fh.write(f"{utc_now()}  {text}\n")
    except OSError:
        pass


def _write_doc(out: str) -> None:
    fd, tmp = tempfile.mkstemp(dir=str(DOC.parent), suffix=".tmp")
    os.close(fd)
    tmp = pathlib.Path(tmp)
    try:
        with tmp.open("w", encoding="utf-8", newline="") as fh:
            fh.write(out)
        os.replace(tmp, DOC)
    except BaseException:
        tmp.unlink(missing_ok=True)
        raise


def signin_required_row(first_seen: str, last_seen: str, runs: int) -> str:
    return "\n".join([
        f"{SIGNIN_HEAD} — the rig profile is signed out",
        "",
        "⛔ **No check row was written, and none will be until this clears.** A",
        "signed-out rig can read nothing, and a row assembled from nothing reads as",
        "evidence. The daily task keeps running and keeps landing here.",
        "",
        "| | |",
        "|---|---|",
        f"| first seen | **{first_seen}** |",
        f"| last seen | **{last_seen}** |",
        f"| consecutive runs blocked | **{runs}** |",
        "| notification | a desktop balloon fires on every occurrence |",
        "",
        "**⭐ THE FIX IS ONE THING AND NOTHING ELSE: sign in once, in the rig window.**",
        "",
        "```",
        "python tools/window_check.py --park      # opens the rig at /login and leaves it up",
        "```",
        "",
        "Sign in there by hand, close nothing, and the next scheduled run picks the",
        "session up. ⛔ Do not add a credentials file, do not script the login form,",
        "do not copy cookies from another profile. The session cookie is a 30-day",
        "cookie, so one sign-in covers the whole observation window.",
        "",
    ])


def stamp_signin_required(chk: Check, dry_run: bool = False) -> None:
    """Idempotent: repeated signed-out runs UPDATE the standing row rather than
    appending a new one every morning. ⛔ Seven identical rows would bury the
    check rows this document exists for."""
    if dry_run:
        print(signin_required_row(chk.started, chk.started, 1))
        return
    text = DOC.read_text(encoding="utf-8")
    if ANCHOR not in text:
        return
    i = text.index(ANCHOR)
    j = text.find("\n### ", i)
    if j == -1:
        j = len(text)
    tail = text[j:]
    first, runs = chk.started, 1
    if tail.lstrip("\n").startswith(SIGNIN_HEAD):
        m = re.search(r"\| first seen \| \*\*(.+?)\*\* \|", tail)
        c = re.search(r"\| consecutive runs blocked \| \*\*(\d+)\*\* \|", tail)
        if m:
            first = m.group(1)
        if c:
            runs = int(c.group(1)) + 1
        end = tail.find("\n### ", 1)
        tail = tail[end:] if end != -1 else "\n"
    _write_doc(text[:j] + "\n" + signin_required_row(first, chk.started, runs) + tail)


def stamp(chk: Check, dry_run: bool = False) -> bool:
    """⛔⛔ A row is written only if auth held AND every read and step succeeded."""
    if chk.needs_signin:
        print("\u26d4 SIGN-IN REQUIRED: the rig profile is signed out. No check row written.")
        print("   Fix: `python tools/window_check.py --park`, sign in by hand, done.")
        if not dry_run:
            log_line(f"{chk.label}: SIGN-IN REQUIRED \u2014 /api/auth/me not 200")
            notify("UCT Wave Q1 - sign-in required",
                   "The window-check rig is signed out. Run: python tools/window_check.py --park")
        stamp_signin_required(chk, dry_run)
        return False
    if not chk.complete:
        names = ", ".join(r.name for r in chk.failures)
        print(f"\u26d4 REFUSING TO STAMP: {len(chk.failures)} read(s)/step(s) failed \u2014 {names}")
        print("   A check log whose rows might be partial reads as evidence. Nothing was written.")
        if not dry_run:
            log_line(f"{chk.label}: REFUSED \u2014 failed: {names}")
        return False
    if dry_run:
        print("--dry-run: the row below was NOT written\n")
        print(chk.row())
        return True
    text = DOC.read_text(encoding="utf-8")
    if ANCHOR not in text:
        print(f"\u26d4 REFUSING TO STAMP: cannot find the log heading in {DOC}")
        return False
    i = text.index(ANCHOR)
    j = text.find("\n### ", i)
    if j == -1:
        j = len(text)
    tail = text[j:]
    # A successful check clears any standing SIGN-IN REQUIRED row: the condition
    # it describes is over, and leaving it would contradict the row above it.
    if tail.lstrip("\n").startswith(SIGNIN_HEAD):
        end = tail.find("\n### ", 1)
        tail = tail[end:] if end != -1 else "\n"
    _write_doc(text[:j] + "\n" + chk.row() + tail)
    verdict = "NEW FINDING" if chk.findings else "green"
    print(f"\u2705 stamped: {chk.label} @ {chk.started} ({verdict})")
    log_line(f"{chk.label}: stamped, {verdict}, {len(chk.reads)} reads, {len(chk.canary)} canary steps")
    # \u2b50 And refresh the 9/17 packet from this run, so it is current on the day
    # rather than something someone has to remember to update.
    if update_decision_packet(chk):
        log_line(f"{chk.label}: decision packet refreshed")
    return True


def park() -> int:
    """Spawn the rig on the persistent profile, prove it, park at /login, LEAVE IT."""
    from playwright.sync_api import sync_playwright
    proc, endpoint, version = spawn_rig()
    if not version:
        print("\u26d4 the CDP endpoint never answered")
        return 1
    with sync_playwright() as pw:
        b = pw.chromium.connect_over_cdp(endpoint)
        ctx = b.contexts[0]
        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        cdp = page.context.new_cdp_session(page)
        cdp.send("Network.enable")
        offline = _offliner(cdp)
        offline(False)
        page.goto(PROD + "/login", wait_until="domcontentloaded")
        page.wait_for_timeout(3500)
        offline(True); page.wait_for_timeout(800)
        off, off_flag = page.evaluate(PROBE), page.evaluate("() => navigator.onLine")
        offline(False); page.wait_for_timeout(800)
        on, on_flag = page.evaluate(PROBE), page.evaluate("() => navigator.onLine")
        me = page.evaluate(AUTH_JS)
        print(json.dumps({
            "pid": proc.pid, "chrome": version["Browser"], "cdp": endpoint,
            "profile": str(PROFILE),
            "offline_probe": off, "navigator.onLine(offline)": off_flag,
            "online_probe": on, "navigator.onLine(online)": on_flag,
            "auth_me": me, "url": page.url,
        }, indent=1))
    bring_to_front()
    print("\nPARKED at /login. Sign in by hand in that window; leave it open or close it —")
    print("the profile keeps the session either way. This process now exits; the rig stays up.")
    log_line(f"parked for sign-in: pid {proc.pid}, profile {PROFILE.name}")
    return 0


def self_check() -> int:
    cases = []

    signed_out = Check(label="self-check: auth 401")
    signed_out.add("rig", True, "fine")
    signed_out.needs_signin = True
    signed_out.add("signed in", False, error="/api/auth/me returned 401")
    cases.append(("AUTH 401 is refused", stamp(signed_out, dry_run=True) is False))
    cases.append(("AUTH 401 makes the run incomplete", signed_out.complete is False))

    # ── the two re-auth branches ────────────────────────────────────────────
    class _Page:
        class _Ctx:
            def new_cdp_session(self, _):
                class _S:
                    sent = []

                    def send(self, m, p=None):
                        _S.sent.append(m)
                return _S()
        context = _Ctx()

    ok_h, detail_h = reauthenticate(_Page(), mint=lambda: "a-freshly-minted-token")
    cases.append(("re-auth SUCCEEDS ⇒ the run proceeds", ok_h is True))
    cases.append(("re-auth installs a cookie, never types a password",
                  "installed via CDP" in detail_h))
    ok_u, detail_u = reauthenticate(_Page(), mint=mint_session_token)
    cases.append(("re-auth UNAVAILABLE ⇒ falls back to SIGN-IN REQUIRED", ok_u is False))
    cases.append(("…and says why, in one line", "production shell" in detail_u))
    ok_b, detail_b = reauthenticate(_Page(), mint=lambda: "")
    cases.append(("a minter returning nothing is not treated as success", ok_b is False))

    # ── conflict: words must survive in BOTH directions ─────────────────────
    srv = {"c": [{"text": "THEIRS"}]}
    cpy = {"c": [{"text": "MINE"}]}
    cases.append(("CONTROL: both sides intact is NOT a finding",
                  conflict_findings("x", srv, cpy, "MINE", "THEIRS") == []))
    cases.append(("a CLOBBERED server is a finding",
                  bool(conflict_findings("x", {"c": [{"text": "MINE"}]}, cpy, "MINE", "THEIRS"))))
    cases.append(("a conflicted copy that lost MY words is a finding",
                  bool(conflict_findings("x", srv, {"c": []}, "MINE", "THEIRS"))))
    cases.append(("the SIGN-IN row names the one fix",
                  "sign in once, in the rig window" in signin_required_row("a", "b", 1).lower()))
    cases.append(("the SIGN-IN row forbids a credentials file",
                  "Do not add a credentials file" in signin_required_row("a", "b", 1)))

    bad = Check(label="self-check: a failed read")
    bad.add("rig", True, "fine"); bad.add("notes", False, error="500")
    cases.append(("a failed READ is refused", stamp(bad, dry_run=True) is False))

    badstep = Check(label="self-check: a failed canary step")
    badstep.add("rig", True, "fine"); badstep.step("4 reconnect", False, error="did not settle")
    cases.append(("a failed CANARY STEP is refused", stamp(badstep, dry_run=True) is False))

    cases.append(("a run with NO reads is refused", stamp(Check(label="empty"), dry_run=True) is False))

    good = Check(label="self-check: every read ok")
    good.add("rig", True, "fine"); good.add("notes", True, "32")
    cases.append(("a complete run stamps", stamp(good, dry_run=True) is True))
    cases.append(("the row carries every reading", "| notes | 32 |" in good.row()))
    cases.append(("a failed read renders as FAILED", "FAILED" in bad.reads[1].render()))

    cases.append(("a NULL baseline is a finding", bool(baseline_findings("o", {"baseUpdatedAt": None}))))
    cases.append(("an EMPTY-STRING baseline is a finding", bool(baseline_findings("o", {"baseUpdatedAt": ""}))))
    cases.append(("a WHITESPACE baseline is a finding", bool(baseline_findings("o", {"baseUpdatedAt": "  "}))))
    cases.append(("a NON-STRING baseline is a finding", bool(baseline_findings("o", {"baseUpdatedAt": 0}))))
    cases.append(("CONTROL: a real baseline is NOT a finding",
                  baseline_findings("o", {"baseUpdatedAt": "2026-09-10T05:00:00+00:00"}) == []))
    cases.append(("nested baselines are found too",
                  bool(baseline_findings("l", {"record": {"baseUpdatedAt": None}}))))
    cases.append(("an EMPTY document is a finding",
                  bool(empty_document_findings("r", {"bodyJson": {"type": "doc", "content": []}}))))
    cases.append(("the INCIDENT'S shape (empty paragraph) is a finding",
                  bool(empty_document_findings("r", {"bodyJson": {"type": "doc", "content": [{"type": "paragraph"}]}}))))
    cases.append(("CONTROL: a document with text is NOT a finding",
                  empty_document_findings("r", {"bodyJson": {"type": "doc", "content": [
                      {"type": "paragraph", "content": [{"type": "text", "text": "words"}]}]}}) == []))
    cases.append(("a finding SUPPRESSES cleanup", should_clean_up(["x"]) is False))
    cases.append(("CONTROL: no finding allows cleanup", should_clean_up([]) is True))

    # ⛔ The page-side readers report failure as the STRING 'ERR'. `x or []`
    #    passed that straight into a `+` and killed check 5's first run.
    cases.append(("'ERR' from a layer coerces to a list, never crashes",
                  _as_list("ERR") == [] and _as_list([1]) == [1]))
    cases.append(("a layer that could not be READ is reported, not read as empty",
                  layer_read_failed({"outbox": "ERR", "record": {}}) == ["outbox=ERR"]))
    cases.append(("CONTROL: layers that read fine report nothing",
                  layer_read_failed({"outbox": [], "record": {}, "draft": None}) == []))

    # ⛔ Absence is not failure when absence is the CORRECT state. Scoring the
    #    dark posture as "could not read" refused check 5 a row it had earned.
    ok_s, txt_s = render_stores({"dbMissing": True, "optInKey": "0"})
    cases.append(("no DB while opted OUT is EXPECTED, not a failure", ok_s is True))
    cases.append(("…and it says why", "expected at rest" in txt_s))
    ok_s, _ = render_stores({"dbMissing": True, "optInKey": "1"})
    cases.append(("no DB while opted IN is a real failure", ok_s is False))
    ok_s, txt_s = render_stores({"dbPhantom": True, "optInKey": "1"})
    cases.append(("a PHANTOM 0-store database is a failure", ok_s is False))
    cases.append(("…and it names the repair", "Delete it" in txt_s))
    ok_s, txt_s = render_stores({"stores": {"notes": 0, "outbox": 0}, "optInKey": "0"})
    cases.append(("CONTROL: real store counts read fine", ok_s is True and "`notes` 0" in txt_s))

    found = Check(label="self-check: a finding")
    found.add("rig", True, "fine"); found.canary_ran = True; found.step("3 reload", True, "fine")
    found.findings = baseline_findings("o", {"baseUpdatedAt": None})
    # ⛔ A single-writer run that forks is its own named failure, not litter.
    cases.append(("a single-writer fork is a FINDING, named as one",
                  "SINGLE-WRITER RUN MUST NOT PRODUCE A CONFLICTED COPY"
                  in pathlib.Path(__file__).read_text(encoding="utf-8")))
    cases.append(("cleanup names the sub-condition that failed",
                  "leftover note(s)" in pathlib.Path(__file__).read_text(encoding="utf-8")))

    cases.append(("a finding heads the row NEW FINDING", "NEW FINDING" in found.row()))
    cases.append(("the row names the evidence is kept", "NOT deleted" in found.row()))

    # ⭐ '0' is the EXPECTED reading on a persistent profile, and the row says so
    #    rather than leaving a reader to wonder why it is not `unset`.
    cases.append(("the key reading explains '0' on a persistent profile",
                  "run 2 onward" in _render_key("0")))
    cases.append(("an unexpected '1' at rest is called out", "unexpected" in _render_key("1")))

    # ── the recommendation: pure, railed, and it names its own reason ────────
    v, bl, _ = recommend(None, None, 0, False)
    cases.append(("UNREAD counts ⇒ NO-GO", v == "NO-GO"))
    cases.append(("…and says the counts are unread", any("UNREAD" in b for b in bl)))
    v, bl, _ = recommend(0, 5, 7, False)
    cases.append(("every condition met ⇒ GO", v == "GO" and bl == []))
    v, bl, _ = recommend(1, 5, 7, False)
    cases.append(("one blocked-baseline event ⇒ NO-GO", v == "NO-GO"))
    v, bl, _ = recommend(0, 4, 7, False)
    cases.append(("too few opted-in browsers ⇒ NO-GO", v == "NO-GO"))
    v, bl, _ = recommend(0, 5, 6, False)
    cases.append(("six green runs ⇒ NO-GO", v == "NO-GO"))
    v, bl, _ = recommend(0, 9, 9, True)
    cases.append(("a past NEW FINDING ⇒ NO-GO even with everything else green", v == "NO-GO"))
    cases.append(("…and it says which condition decided it",
                  any("NEW FINDING" in b for b in bl)))
    # ── the telemetry read must never need admin, and must say its scope ────
    cases.append(("the counts do NOT depend on admin — export-data is the fallback",
                  "/api/auth/export-data" in ACTIVITY_JS))
    cases.append(("the scope is reported, not silently swapped",
                  "population-wide (admin)" in ACTIVITY_JS and "this account only" in ACTIVITY_JS))
    cases.append(("a full 100-row export is flagged as a possible truncation",
                  "rowCap" in ACTIVITY_JS))
    # ⛔ Both routes live under the auth router's /api/auth prefix. Calling
    #    /api/admin/activity hits the SPA catch-all and returns 200 HTML, which
    #    `.ok` reports as success — measured 2026-09-10, and it crashed the run.
    cases.append(("the admin route carries the /api/auth prefix",
                  "'/api/auth/admin/activity" in ACTIVITY_JS))
    cases.append(("no bare /api/admin/activity remains",
                  "'/api/admin/activity" not in ACTIVITY_JS))
    cases.append(("a 200 that is not JSON is rejected, not parsed",
                  "application/json" in ACTIVITY_JS and "res.ok" in ACTIVITY_JS))

    blk = decision_block(None, "")
    cases.append(("the packet keeps the 36-minute gap", "36-minute gap" in blk))
    cases.append(("the packet keeps the 'what green cannot buy' caveat verbatim",
                  "not five members on five devices" in blk))
    cases.append(("the packet states it never flips the flag", "never flips the flag" in blk))
    cases.append(("green runs are counted from the doc, not from memory",
                  count_green_checks("| **mini-canary** | ✅ **6/6** |\n| **mini-canary** | ✅ **6/6** |") == 2))

    # ══════════════════════════════════════════════════════════════════════════
    # THE PROFILE-PATH OVERRIDE. ⛔ The bug it exists for: `ROOT` is the repo root
    # of THIS COPY of the file, so a second worktree resolves the default to its
    # own empty `.worktrees/` — a signed-out profile nothing can sign back in.
    # ══════════════════════════════════════════════════════════════════════════
    _saved = (PROFILE, MARKER, os.environ.get(PROFILE_ENV))
    try:
        os.environ.pop(PROFILE_ENV, None)
        cases.append(("CONTROL: with nothing set, the default is UNCHANGED",
                      resolve_profile(None) == DEFAULT_PROFILE))
        cases.append(("…and the default marker is the canonical directory name",
                      DEFAULT_PROFILE.name == "canary-chrome-profile-persistent"))
        env_p = pathlib.Path(tempfile.gettempdir()) / "canary-chrome-profile-persistent"
        os.environ[PROFILE_ENV] = str(env_p)
        cases.append((f"${PROFILE_ENV} overrides the default",
                      resolve_profile(None) == env_p.resolve()))
        cli_p = pathlib.Path(tempfile.gettempdir()) / "canary-chrome-profile-persistent-cli"
        cases.append(("--profile beats the env var",
                      resolve_profile(str(cli_p)) == cli_p.resolve()))
        cases.append(("a blank override is not an override",
                      resolve_profile("   ") == env_p.resolve()))
        os.environ.pop(PROFILE_ENV, None)

        # the two globals move as ONE — a marker that lags the profile would kill
        # the wrong browser, or none at all.
        use_profile(cli_p)
        cases.append(("use_profile moves the profile AND its derived marker together",
                      PROFILE == cli_p and MARKER == cli_p.name))
        try:
            use_profile(pathlib.Path(tempfile.gettempdir()) / "Default")
            generic_refused = False
        except SystemExit:
            generic_refused = True
        cases.append(("a GENERIC profile name is refused as a kill marker", generic_refused))
        cases.append(("…and the refusal happens BEFORE either global moves",
                      PROFILE == cli_p and MARKER == cli_p.name))
        cases.append(("CONTROL: the canonical name is accepted as a marker",
                      marker_for(DEFAULT_PROFILE) == "canary-chrome-profile-persistent"))
    finally:
        os.environ.pop(PROFILE_ENV, None)
        if _saved[2] is not None:
            os.environ[PROFILE_ENV] = _saved[2]
        globals()["PROFILE"], globals()["MARKER"] = _saved[0], _saved[1]

    # ⛔ Creating a missing profile is the failure this override exists to prevent.
    cases.append(("a MISSING profile is refused, never created",
                  profile_refusal(DEFAULT_PROFILE, False, False) is not None))
    cases.append(("…and the refusal says a fresh profile cannot be signed in",
                  "SIGNED-OUT PROFILE" in (profile_refusal(DEFAULT_PROFILE, False, False) or "")))
    cases.append(("…and it names the flag that fixes it",
                  "--profile" in (profile_refusal(DEFAULT_PROFILE, False, False) or "")))
    cases.append(("CONTROL: an EXISTING profile is not refused",
                  profile_refusal(DEFAULT_PROFILE, True, False) is None))
    cases.append(("CONTROL: --allow-new-profile is the deliberate escape hatch",
                  profile_refusal(DEFAULT_PROFILE, False, True) is None))
    cases.append(("spawn_rig actually CONSULTS the refusal",
                  "profile_refusal(PROFILE" in pathlib.Path(__file__).read_text(encoding="utf-8")))
    cases.append(("the lock check can be pointed at ANOTHER profile (the Edge rig)",
                  profile_lock_released(timeout=0, profile=pathlib.Path(tempfile.gettempdir()))[0] is True))
    cases.append(("…and it builds the lock paths from that ARGUMENT, not from PROFILE",
                  'locks = [profile / "lockfile", profile / "SingletonLock"]'
                  in pathlib.Path(__file__).read_text(encoding="utf-8")))

    # ══════════════════════════════════════════════════════════════════════════
    # THE OPT-OUT RUNS ON EVERY EXIT. ⛔ The defect it fixes: the restore lived
    # inside the cleanup block — skipped ON PURPOSE when a finding is kept, and
    # unreachable after the `2 create a note` early return, which is exactly what
    # fired on 2026-09-10T13:47:22Z. The profile was still opted IN a day later.
    # Driven through the REAL control flow, not asserted about it.
    # ══════════════════════════════════════════════════════════════════════════
    class _OptPage:
        """⭐ Models the STORE, not just the calls — so the read-back after the
        flush navigation reads what was actually written, and `sticks=False`
        models the real failure (the write does not take)."""

        def __init__(self, sticks=True):
            self.sticks, self.writes, self.navigations, self.store = sticks, [], [], {}

        def wait_for_timeout(self, _ms):
            pass

        def goto(self, url, **_k):
            self.navigations.append(url)

        def evaluate(self, js, arg=None):
            if "setItem(k, '0')" in js:
                self.writes.append("0")
                self.store[FLAG_KEY] = "0" if self.sticks else "1"
                return self.store[FLAG_KEY]
            if "setItem(k, '1')" in js:
                self.writes.append("1")
                self.store[FLAG_KEY] = "1"
                return None
            if "getItem" in js:
                return self.store.get(FLAG_KEY)
            return None

    def _drive(body, sticks=True):
        chk = Check(label="t")
        page = _OptPage(sticks)
        try:
            _mini_canary(chk, page, lambda _f: None, [], body=body)
        except Exception:  # noqa: BLE001
            pass
        step = next((s for s in chk.canary if "opted back out" in s.name), None)
        _drive.last_page = page
        return page.writes, step

    w, s = _drive(lambda *a: "note-id")
    cases.append(("CONTROL: the happy path opts in and back out", w == ["1", "0"] and s and s.ok))
    cases.append(("…and the opt-out navigates to flush the write to disk",
                  any("/api/health" in u for u in _drive.last_page.navigations)))
    w, s = _drive(lambda *a: None)                       # the `create a note` early return
    cases.append(("⛔ an EARLY RETURN still opts back out", w == ["1", "0"] and s and s.ok))
    def _raiser(*a):
        raise RuntimeError("the canary blew up mid-run")
    w, s = _drive(_raiser)
    cases.append(("⛔ an EXCEPTION still opts back out", w == ["1", "0"] and s and s.ok))
    # ⛔ A `finally` that also SWALLOWS is worse than none: the run would look
    # like it completed. The opt-out must happen AND the failure must still fly.
    _raised = False
    try:
        _mini_canary(Check(label="t"), _OptPage(), lambda _f: None, [], body=_raiser)
    except RuntimeError:
        _raised = True
    cases.append(("…and the exception still PROPAGATES (the finally does not swallow it)",
                  _raised))
    w, s = _drive(lambda *a: "note-id", sticks=False)
    cases.append(("⛔ an opt-out that does NOT take is reported, not assumed",
                  s is not None and not s.ok))
    cases.append(("…and the failure says the profile is left opted in",
                  "LEFT OPTED IN" in (s.render() if s else "")))
    src_wc = pathlib.Path(__file__).read_text(encoding="utf-8")
    canary_src = src_wc.split("def _mini_canary", 1)[1].split("\ndef _canary_body", 1)[0]
    cases.append(("the restore is in a `finally`, not on the success branch",
                  "finally:" in canary_src and "opt_out(page)" in canary_src))
    body_src = src_wc.split("def _canary_body", 1)[1].split("\n# ═", 1)[0]
    cases.append(("the cleanup JS no longer spells the flag key a second time",
                  "'uct.j2.offline.enabled'" not in body_src))
    cases.append(("CONTROL: that sweep can see the literal when it is there",
                  "'uct.j2.offline.enabled'" in (body_src + "'uct.j2.offline.enabled'")))
    cases.append(("the opt-out is asserted in ONE place, not two",
                  "expected '0'" not in body_src))

    # ══════════════════════════════════════════════════════════════════════════
    # ⛔⛔ THE FORK IS DETECTED BEFORE ANYTHING IS DELETED.
    # The defect: `should_clean_up` was evaluated ABOVE the fork detection, so the
    # guard whose job is "keep the evidence" could not see the fork finding — it
    # did not exist yet. On 2026-09-10 the run created a `(conflicted copy)` at
    # 16:55:43Z and deleted its own ORIGINAL 9.4s later, then noticed.
    # ⛔ DRIVEN, not asserted about: a run that forks must reach the end with the
    # artifact still present, and a run that does NOT fork must still clean up —
    # otherwise a destructive bug has been traded for a litter bug.
    # ══════════════════════════════════════════════════════════════════════════
    class _ForkPage:
        """Models the account. DELETE actually removes the note, so a rail that
        deletes the evidence cannot pass by accident."""

        def __init__(self, titles):
            self.notes = list(titles)
            self.deleted, self.navigations = [], []

        def wait_for_timeout(self, _ms):
            pass

        def goto(self, url, **_k):
            self.navigations.append(url)

        def query_selector(self, _sel):
            return None

        def keyboard(self):
            return None

        def evaluate(self, js, arg=None):
            if "method:'DELETE'" in js or 'method:"DELETE"' in js:
                self.deleted.append(arg)
                self.notes = [t for t in self.notes if t != arg]
                return None
            # ⛔ ORDER MATTERS: STATE_JS also contains `getItem`, so the generic
            # localStorage branch must come LAST or it swallows the state read and
            # the rail dies on a string instead of measuring anything.
            if "canary" in js:                       # NOTES_JS
                return {"ok": True, "total": len(self.notes),
                        "canary": [t for t in self.notes if SENTINEL in t]}
            if "optInKey" in js:                     # STATE_JS
                return {"optInKey": "0", "locks": 0, "lockClaimable": True,
                        "stores": {"notes": 0, "outbox": 0},
                        "dbOpened": True, "storeNames": ["notes"]}
            if "objectStoreNames" in js:
                return {"storesCleared": 0}
            if "setItem(k, '1')" in js:
                return None
            if "getItem" in js:
                return "0"
            return {}

    def _drive_fork(titles):
        chk = Check(label="t")
        page = _ForkPage(titles)
        # jump straight to the decision: seed the state step 4 leaves behind
        _canary_tail(chk, page, SENTINEL + " note")
        return chk, page

    forked = [SENTINEL + " note", SENTINEL + " note (conflicted copy)"]
    chk_f, page_f = _drive_fork(forked)
    cases.append(("⛔ a run that FORKS keeps BOTH halves — nothing is deleted",
                  page_f.deleted == [] and set(page_f.notes) == set(forked)))
    cases.append(("…and it names the fork as a finding, not as litter",
                  any("conflicted copy" in f for f in chk_f.findings)))
    cases.append(("…and the fork step is RED",
                  any(s.name.startswith("5 no fork") and not s.ok for s in chk_f.canary)))
    cases.append(("…and the skip says both halves are kept",
                  any("ORIGINAL AND COPY BOTH" in s.render() for s in chk_f.canary)))
    chk_c, page_c = _drive_fork([SENTINEL + " note"])
    cases.append(("CONTROL: a run with NO fork still CLEANS UP (no litter traded in)",
                  page_c.deleted == [SENTINEL + " note"] and page_c.notes == []))
    cases.append(("…and its fork step is green",
                  any(s.name.startswith("5 no fork") and s.ok for s in chk_c.canary)))
    tail_src = src_wc.split("def _canary_tail", 1)[1].split("\ndef ", 1)[0]
    cases.append(("the cleanup decision is made AFTER the fork is appended",
                  tail_src.index('chk.step("5 no fork') < tail_src.index("should_clean_up(chk.findings)")))
    cases.append(("…and the DELETE happens after that decision",
                  tail_src.index("should_clean_up(chk.findings)") < tail_src.index("method:'DELETE'")))
    # ⛔ SCOPED TO THE BODY, AND THE NEEDLE IS BUILT — a sweep that can match its
    # own case string counts itself. Third time this session; it is never obvious.
    _fork_needle = 'chk.step("5 no fork' + ' from a single writer"'
    _wc_body = src_wc.split("def self_check", 1)[0]
    cases.append(("there is exactly ONE fork detector, not two",
                  _wc_body.count(_fork_needle) == 1))
    cases.append(("CONTROL: that count can see a second one",
                  (_wc_body + _fork_needle).count(_fork_needle) == 2))

    # ⛔ THE WRITE MUST REACH DISK. Measured 2026-09-10: a localStorage write
    # followed by an IMMEDIATE kill-by-marker is lost, and `opt_out` is the last
    # thing a run does before the kill. An in-memory read-back cannot see this.
    optout_src = src_wc.split("def opt_out", 1)[1].split("\ndef _mini_canary", 1)[0]
    cases.append(("the opt-out forces a flush before the browser can be killed",
                  "/api/health" in optout_src and "goto" in optout_src))
    cases.append(("…via a document that runs NO app code (no drain, no notebook)",
                  "/journal/notebook" not in optout_src))
    cases.append(("…and it re-reads AFTER the flush, not before",
                  optout_src.rindex("getItem") > optout_src.index("goto")))
    cases.append(("teardown proves the value reached DISK, with Chrome dead",
                  "opt-out reached DISK" in src_wc
                  and "localstorage_on_disk(FLAG_KEY)" in src_wc))
    disk = localstorage_on_disk(FLAG_KEY, pathlib.Path(tempfile.gettempdir()))
    cases.append(("CONTROL: the disk reader reports absence rather than guessing",
                  disk["value"] is None and disk["appends"] == 0))
    cases.append(("…and it reads the profile it is GIVEN, not only the rig's",
                  "profile = PROFILE if profile is None" in src_wc))

    # ══════════════════════════════════════════════════════════════════════════
    # ⛔⛔ THE SUSPENSION — one switch, and SUSPENDED IS NOT DELETED.
    # ══════════════════════════════════════════════════════════════════════════
    # ⛔⛔ THE SWITCH IS NOW OFF — LIFTED 2026-09-11, round 3 closed by finding.
    # The pin is INVERTED rather than deleted: the state is still asserted, so
    # flipping it back on (or forgetting to) shows up as a red line and not as
    # silence. ⚰️ While it was on, seven "streak" runs exited 0 having exercised
    # nothing — the suppression worked and the reporting did not, which is why
    # the reads-only exit code below exists.
    cases.append(("⭐ the mini-canary is ARMED — the switch is off",
                  CANARY_SUSPENDED is False))
    cases.append(("…and the suspension REASON is cleared with it, never left stale",
                  SUSPENSION_REASON == ""))
    cases.append(("a note that was ALREADY THERE is not this run's leftover",
                  new_since(["kept"], ("kept",)) == []))
    cases.append(("CONTROL - a note this run created IS a leftover",
                  new_since(["kept", "mine"], ("kept",)) == ["mine"]))
    cases.append(("with NO baseline everything counts - the defect, reproduced",
                  new_since(["kept", "mine"], ()) == ["kept", "mine"]))
    _pre = ("SENTINEL 00:00:56Z (conflicted copy)",)
    cases.append(("⛔ a PRE-EXISTING conflicted copy is NOT this run's fork",
                  split_forks(list(_pre), _pre)[0] == []))
    cases.append(("⭐ CONTROL — a NEW conflicted copy still reports as a fork",
                  split_forks([_pre[0], "SENTINEL 12:07Z (conflicted copy)"], _pre)[0]
                  == ["SENTINEL 12:07Z (conflicted copy)"]))
    cases.append(("…and the pre-existing one is still NAMED, never silently dropped",
                  split_forks(list(_pre), _pre)[1] == list(_pre)))
    cases.append(("⛔ with NO baseline every copy counts — the defect, reproduced",
                  split_forks(list(_pre), ())[0] == list(_pre)))
    cases.append(("⛔ A READS-ONLY RUN IS NOT COUNTABLE — it exits 3, never 0",
                  'return 3' in src_wc and 'if not chk.canary:' in src_wc))
    cases.append(("…and the switch alone stops it, even with no --no-canary flag",
                  canary_should_run(True, False) is False))
    cases.append(("…and `--no-canary` alone stops it too, switch off",
                  canary_should_run(False, True) is False))
    cases.append(("⭐ RE-ARMING IS THAT ONE CONSTANT — nothing else to rebuild",
                  canary_should_run(False, False) is True))
    _susp_row = Check(label="check 11", number=11).row()
    cases.append(("every row carries the suspension note",
                  SUSPENSION_REASON in _susp_row))
    cases.append(("…and the ROLLBACK line sits at the TOP of the row",
                  ROLLBACK_LINE in _susp_row
                  and _susp_row.index(ROLLBACK_LINE) < _susp_row.index("| | reading |")))
    _find_row = Check(label="t", findings=["something"]).row()
    cases.append(("…on a FINDING row too — that reader needs it most",
                  ROLLBACK_LINE in _find_row))
    # ⛔ SUSPENDED IS NOT DELETED. Both hard reds must still be DEFINED, and the
    # rails that drive them must still run — a suspension that quietly removes
    # the instrument is how the next round goes unmeasured.
    _wc_all = pathlib.Path(__file__).read_text(encoding="utf-8")
    cases.append(("the FORK detector is still defined",
                  'chk.step("5 no fork' + ' from a single writer"' in _wc_all))
    cases.append(("the OFFLINE-SENTENCE check is still defined",
                  "the server BODY CONTAINS THE OFFLINE SENTENCE" in _wc_all
                  and "def offline_sentence" in _wc_all))
    cases.append(("the note-count check is still defined",
                  "5 note count moved by exactly this run's own note" in _wc_all))

    # ══════════════════════════════════════════════════════════════════════════
    # ⭐ THE DOOR ROTATION — derived, varying, and DRIVEN.
    # ══════════════════════════════════════════════════════════════════════════
    cases.append(("the door is derived from the run's own number",
                  [door_for(n) for n in (9, 10, 11)] == ["folder", "ticker", "tags"]))
    cases.append(("no two consecutive runs walk the same door",
                  all(door_for(n) != door_for(n + 1) for n in range(0, 40))))
    cases.append(("every door comes up inside any three consecutive runs",
                  all({door_for(k) for k in range(n, n + 3)} == set(DOORS) for n in range(0, 40))))
    # ⚰️ THE SHAPE OF A ROW, not the shape of a label. My own defect, driven:
    # the regex I trusted cannot see a `--label`led row, so a rotation keyed to it
    # would print ONE door across a whole labelled streak.
    _rows_doc = "\n".join([
        "### check 10 — **2026-09-10T13:37:03Z**", "", "| | reading |", "|---|---|",
        "| **mini-canary** | ✅ **6/6** steps green |", "",
        "### deploy #4 live — run 1 of 7 — **2026-09-10T20:40:00Z**", "", "| | reading |",
        "|---|---|", "| **mini-canary** | ✅ **6/6** steps green |", ""])
    cases.append(("rows are counted by the shape of a ROW, so a --labelled row counts too",
                  rows_stamped(_rows_doc) == 2))
    cases.append(("⚰️ CONTROL: the regex I once trusted sees only ONE of those two rows",
                  len(re.findall(r"^### check (\d+)", _rows_doc, re.M)) == 1))
    cases.append(("…so a --labelled streak still rotates its door",
                  len({door_for(rows_stamped(_rows_doc * k) + 1) for k in (1, 2, 3)}) == 3))
    cases.append(("`folder`'s value check says N/A rather than a green it never measured",
                  door_survived("folder", {})[0] is True and "N/A" in door_survived("folder", {})[1]))
    cases.append(("…while `ticker` and `tags` are checked against the server's own note",
                  door_survived("ticker", {"ticker": "NVDA"})[0]
                  and not door_survived("ticker", {"ticker": None})[0]
                  and door_survived("tags", {"tags": ["window-check-door"]})[0]
                  and not door_survived("tags", {"tags": []})[0]))
    cases.append(("…and an unreadable server note is never counted as survival",
                  not door_survived("ticker", "ERR: NotFoundError")[0]))
    cases.append(("the door tag is never `sync-conflict` — that label is the evidence set's",
                  "sync-conflict" not in json.dumps(DOOR_PATCH)))
    # ⛔ COMMENTS STRIPPED FIRST. The first version of this case matched the blob's
    # OWN comment — the line that says "no title, no bodyJson" — and went red on
    # the prose describing the property it was checking. A sweep that reads the
    # explanation instead of the code is measuring the claim, not the request.
    _door_code = "\n".join(l for l in DOOR_JS.splitlines() if not l.strip().startswith("//"))
    cases.append(("the door PUT carries metadata ONLY — never the member's body back",
                  "bodyJson" not in _door_code and "baseUpdatedAt" in _door_code))
    cases.append(("CONTROL: the comment-stripped blob is still the real request",
                  "method:'PUT'" in _door_code))
    cases.append(("…it retries ONCE on a 409 (the drain races it by design), never loops",
                  "tries < 2" in DOOR_JS and "attempts: tries" in DOOR_JS))
    cases.append(("…and the row prints how many attempts it took",
                  "dr.get('attempts')" in src_wc))
    _door_row = Check(label="check 10", number=10, canary_ran=True, door="ticker").row()
    cases.append(("the row STAMPS the door, so seven rows show the rotation",
                  "`ticker`" in _door_row and "DOORS[10 % 3]" in _door_row))
    cases.append(("CONTROL: a run with no door prints no door line",
                  "DOORS[" not in Check(label="check 10", canary_ran=True).row()))

    class _DrainPage:
        """Models the SERVER, the door and the drain — so the assertion is DRIVEN.

        ⭐ The drain fires on the navigation to the BARE notebook, because that is
        the real rule (the drain never touches the note that is open) — not on a
        call counter, which would model nothing.

        ⛔ BRANCH ORDER IS LOAD-BEARING, for the third time in this file:
        `OPEN_IF_EXISTS` puts `objectStoreNames` inside BOTH state and layer
        reads, and the store-clear JS also mentions `notedraft`. Match on the
        marker that is unique to each blob, most specific first.
        """

        class _El:
            def click(self):
                pass

        class _Keys:
            def __init__(self, page):
                self.page = page

            def press(self, _k):
                pass

            def type(self, text):
                p = self.page
                p.local_text += text            # the member's words, always local
                if p.online:
                    p.put(p.updated)            # the editor's own CAS save
                    p.server_text += text
                    p.updated = p.bump()
                else:
                    p.queued, p.offline_text = True, text
                    p.queued_base = p.updated

        def __init__(self, lands=True, door_moves=True, forks=False,
                     lock_claimable=True, lock_census=0):
            self.lands, self.door_moves, self.forks = lands, door_moves, forks
            # ⛔ TWO KNOBS, BECAUSE THEY CAME APART ON THE RIG. The census
            # counts a FROZEN holder; the claim asks whether the next run can
            # lead. `census=1, claimable=True` is the exact state that failed a
            # clean run on 2026-09-11, and it must be GREEN.
            self.lock_claimable, self.lock_census = lock_claimable, lock_census
            self.online, self.rev = True, 1
            self.updated = "REV-1"
            self.note_id = "note-1"
            self.server_text = ""
            self.local_text = ""
            self.offline_text = ""
            self.queued, self.queued_base = False, None
            self.ticker, self.tags = None, []
            self.puts, self.notes, self.deleted, self.navigations = [], [], [], []
            self.store = {}
            self.keyboard = _DrainPage._Keys(self)

        def bump(self):
            self.rev += 1
            return f"REV-{self.rev}"

        def put(self, base):
            self.puts.append({"url": f"/api/j2/notes/{self.note_id}", "baseUpdatedAt": base})

        def set_offline(self, flag):
            self.online = not flag

        def wait_for_timeout(self, _ms):
            pass

        def query_selector(self, _sel):
            return _DrainPage._El()

        def goto(self, url, **_k):
            self.navigations.append(url)
            if url.endswith("/journal/notebook") and self.queued and self.online:
                self.queued = False
                if self.lands:
                    self.put(self.updated)          # REBASED onto the current revision
                    self.server_text += self.offline_text
                    self.updated = self.bump()
                # lands=False: the 409 throws the entry away and nothing is sent
                if self.forks:
                    # ⭐ A note this run did not create, wearing a title the fork
                    # regex cannot match — so ONLY the arithmetic can see it.
                    self.notes.append("SOMETHING-ELSE untitled")

        def doc(self, text):
            return {"type": "doc", "content": [{"type": "paragraph",
                                                "content": [{"type": "text", "text": text}]}]}

        def server_note(self):
            return {"id": self.note_id, "updatedAt": self.updated, "ticker": self.ticker,
                    "tags": list(self.tags), "bodyJson": self.doc(self.server_text)}

        def evaluate(self, js, arg=None):
            if "method:'DELETE'" in js:
                self.deleted.append(arg)
                if arg == self.note_id:
                    self.notes = []
                return None
            if "dispatchEvent" in js:                      # REAL_DOOR_JS — the MEMBER's door
                # ⭐ The difference that matters: this goes through the product's
                # own handler, so the revision it creates is recorded as OURS and
                # a queued entry REBASES onto it instead of forking. Measured on
                # the rig, 12 runs, 0 losses.
                if not self.door_moves:
                    return {"ok": False, "why": "simulated: the control could not be driven"}
                d, v = (arg or {}).get("door"), (arg or {}).get("value")
                if d == "ticker":
                    self.ticker = v
                if d == "tags":
                    self.tags = [v]
                self.put(self.updated)
                self.updated = self.bump()
                # the queued entry is carried onto the door's revision
                if self.queued:
                    self.queued_base = self.updated
                return {"ok": True, "via": "input.blur"}
            if "note?.updatedAt" in js:                    # the post-door revision read
                return self.updated
            if "method:'PUT'" in js:                       # DOOR_JS
                before = self.updated
                if not self.door_moves:
                    # the blob retries once and gives up — it reports both.
                    return {"status": 409, "before": before, "after": before, "attempts": 2}
                patch = (arg or {}).get("patch") or {}
                if "ticker" in patch:
                    self.ticker = patch["ticker"]
                if "tags" in patch:
                    self.tags = list(patch["tags"])
                self.put(before)
                self.updated = self.bump()
                return {"status": 200, "before": before, "after": self.updated, "attempts": 1}
            if "method:'POST'" in js:                      # create the note
                self.notes.append(arg)
                return {"ok": True, "id": self.note_id}
            if "storesCleared" in js:
                return {"storesCleared": 1}
            if "limit=300" in js:                          # NOTES_JS
                return {"ok": True, "total": len(self.notes),
                        "canary": [t for t in self.notes if SENTINEL in t], "conflicts": []}
            if "notedraft" in js:                          # LAYERS_JS
                return {"draft": {"bodyJson": self.doc(self.local_text)},
                        "record": {"bodyJson": self.doc(self.local_text),
                                   "baseUpdatedAt": self.updated,
                                   "dirty": 1 if self.queued else 0},
                        "outbox": ([{"noteId": self.note_id, "baseUpdatedAt": self.queued_base}]
                                   if self.queued else []),
                        "server": self.server_note() if self.online else "OFFLINE"}
            if "optInKey" in js:                           # STATE_JS
                return {"optInKey": self.store.get(FLAG_KEY, "0"),
                        "locks": self.lock_census,
                        "lockClaimable": self.lock_claimable,
                        "lockDetail": [{"name": "uct.nb.sync.acct", "mode": "exclusive",
                                        "id": "FROZEN"}] * self.lock_census,
                        "held": ["exclusive"], "pending": 0, "dbOpened": True,
                        "storeNames": ["notes"], "stores": {"notes": 0}}
            if "setItem(k, '1')" in js:
                self.store[FLAG_KEY] = "1"
                return None
            if "setItem(k, '0')" in js:
                self.store[FLAG_KEY] = "0"
                return "0"
            if "getItem" in js:
                return self.store.get(FLAG_KEY)
            if "/api/health" in js:                        # PROBE
                return "ONLINE 200" if self.online else "FAILED: TypeError"
            return {}

    def _drive_canary(number=10, lands=True, door_moves=True, forks=False,
                      lock_claimable=True, lock_census=0):
        page = _DrainPage(lands=lands, door_moves=door_moves, forks=forks,
                          lock_claimable=lock_claimable, lock_census=lock_census)
        chk = Check(label="t", number=number)
        _mini_canary(chk, page, page.set_offline, page.puts)
        return chk, page

    def _step(chk, prefix):
        return next((s for s in chk.canary if s.name.startswith(prefix)), None)

    chk_g, page_g = _drive_canary(number=10)              # 10 % 3 = 1 → ticker
    cases.append(("DRIVEN: the canary walks its derived door and the run is green",
                  chk_g.door == "ticker" and all(s.ok for s in chk_g.canary) and not chk_g.findings))
    cases.append(("…the door PUT really moved the baseline under the queued entry",
                  (_step(chk_g, "4 door ") or Read("x", False)).ok and page_g.ticker == "NVDA"))
    cases.append(("…and the server BODY CONTAINS THE OFFLINE SENTENCE, rebased onto the door",
                  offline_sentence(chk_g.started) in page_g.server_text
                  and (_step(chk_g, "4 the server BODY") or Read("x", False)).ok))
    cases.append(("…and the note count moved by exactly one — this run's own note",
                  (_step(chk_g, "5 note count") or Read("x", False)).ok))
    cases.append(("DRIVEN: the rotation actually varies across n",
                  [_drive_canary(number=n)[0].door for n in (9, 10, 11)]
                  == ["folder", "ticker", "tags"]))
    _chk_t, _page_t = _drive_canary(number=11)            # tags
    cases.append(("…and the tags run really set its tag on the server note",
                  _page_t.tags == ["window-check-door"]))

    # ⛔⛔ THE EXACT FALSE-GREEN OF STREAK RUN 1, DRIVEN: the words typed ONLINE
    # are on the server, the offline sentence is NOT, the queue is empty and
    # clean. Every older signal reads healthy; only the sentence sees the loss.
    chk_r, page_r = _drive_canary(number=10, lands=False)
    landing = _step(chk_r, "4 the server BODY")
    cases.append(("⛔ DRIVEN: a run whose offline sentence is NOT in the server body is RED",
                  landing is not None and not landing.ok))
    cases.append(("…and the ONLINE words ARE on the server in that same run (the false-green)",
                  f"{SENTINEL} typed online." in page_r.server_text
                  and offline_sentence(chk_r.started) not in page_r.server_text))
    cases.append(("…and the drain step CANNOT see it — the queue settled clean",
                  (_step(chk_r, "4 reconnect") or Read("x", False)).ok))
    cases.append(("…and no step claims the server 'holds text' any more",
                  not any("holds text" in s.render() for s in chk_r.canary)))
    cases.append(("…so the RED is the only place a member's loss is reported",
                  "DISCARDED" in (landing.render() if landing else "")))
    cases.append(("…it is a FINDING (lost words = hard stop) and the note is PRESERVED",
                  any("does not contain the member's offline sentence" in f for f in chk_r.findings)
                  and page_r.deleted == [] and page_r.notes != []))
    # ⛔ THE FORK, COUNTED. A copy appearing on the account is a different failure
    # from a discard, and it must be visible even if its title never matches the
    # fork regex — so the arithmetic is driven too.
    chk_f2, page_f2 = _drive_canary(number=10, forks=True)
    cases.append(("⛔ DRIVEN: a run that GAINS a note is RED on the count",
                  not (_step(chk_f2, "5 note count") or Read("x", True)).ok))
    cases.append(("…it is a finding, and BOTH halves stay on the account",
                  any("note count is" in f for f in chk_f2.findings) and page_f2.deleted == []))
    cases.append(("…and a discard and a fork are reported as DIFFERENT failures",
                  any("does not contain the member's offline sentence" in f for f in chk_r.findings)
                  and not any("note count is" in f for f in chk_r.findings)))
    cases.append(("CONTROL: the green run DID clean up (no litter traded in)",
                  page_g.deleted == [page_g.note_id] and page_g.notes == []))
    chk_d, _page_d = _drive_canary(number=10, door_moves=False)
    cases.append(("⛔ a door PUT that does not move the baseline is RED, not assumed",
                  not (_step(chk_d, "4 door ") or Read("x", True)).ok))
    cases.append(("…and the door is opted back out of anyway",
                  (_step(chk_d, "5 opted back out") or Read("x", False)).ok))

    # ══════════════════════════════════════════════════════════════════════════
    # ⛔ THE CLEANUP LOCK — A CENSUS AND A CLAIM ARE DIFFERENT QUESTIONS
    # ══════════════════════════════════════════════════════════════════════════
    # 2026-09-11: `locks != 0` failed a run whose every product step was green.
    # The holder was a document Chrome had FROZEN earlier in the same run, and
    # nothing evicts one while nobody asks for the lock. Measured on the rig:
    # with a second tab WAITING, leadership transferred inside 5s and stayed
    # transferred through 60s — so a frozen holder never blocks the next run.
    # ⛔ THE FIX IS NOT A LOOSER THRESHOLD. It is a different measurement: ASK
    # for the lock. Both halves are driven below, and the RED still fires.
    chk_lk, _page_lk = _drive_canary(number=10, lock_claimable=False, lock_census=1)
    _lk = _step(chk_lk, "5 cleanup")
    cases.append(("⛔ DRIVEN: a sync lock that cannot be CLAIMED is RED",
                  _lk is not None and not _lk.ok))
    cases.append(("…and it says so — the holder is named, not just counted",
                  "could NOT be claimed" in (_lk.render() if _lk else "")))
    # ⭐ THE EXACT STATE OF 2026-09-11, AND IT MUST BE GREEN.
    chk_lc, _page_lc = _drive_canary(number=10, lock_claimable=True, lock_census=1)
    _lc = _step(chk_lc, "5 cleanup")
    cases.append(("⭐ CONTROL: a FROZEN holder (census 1) that IS claimable is GREEN",
                  _lc is not None and _lc.ok and not chk_lc.findings))
    cases.append(("…and the census is still PRINTED, so a stale holder stays visible",
                  "census **1**" in (_lc.render() if _lc else "")))
    cases.append(("⚰️ CONTROL: the census this replaced could not tell those two apart",
                  _page_lk.lock_census == _page_lc.lock_census == 1
                  and _lk is not None and _lc is not None and _lk.ok != _lc.ok))
    _body_src = src_wc.split("def _canary_body", 1)[1].split("\n# ═", 1)[0]
    cases.append(("the door is chosen INSIDE the canary from the run's own number",
                  "door_for(chk.number)" in _body_src))
    # ⛔⛔ PERMANENT RAIL. "does the server have any text" is the question that
    # read green while a member's sentence was being deleted. It is deleted from
    # this file, and it does not come back. Needle built, body-scoped, controlled.
    # ⚠️ COMMENTS STRIPPED, AND IT MATCHES THE CALL, NOT THE PHRASE. The first
    # version failed on the comments that explain why the call was removed —
    # prose about a defect is not the defect (same trap as the DOOR_JS case
    # above). The RENDERED-step version of this check is driven, two blocks up.
    _text_needle = "_doc_has_text(" + "srv"
    _body_code = "\n".join(l for l in _body_src.splitlines() if not l.strip().startswith("#"))
    cases.append(("⛔ nothing in the canary asks whether the server merely HAS TEXT",
                  _text_needle not in _body_code))
    cases.append(("CONTROL: that sweep can see the call when it is there",
                  _text_needle in (_body_code + _text_needle)))
    cases.append(("the sentence is typed and asserted from ONE variable",
                  "sentence = offline_sentence(chk.started)" in _body_src
                  and '" " + sentence' in _body_src
                  and "sentence in _doc_text(srv" in _body_src))
    # ⛔ BUILT NEEDLE, BODY SCOPE, AND A CONTROL — for the FOURTH time in this
    # file. The first version of this case read `"--door" not in src_wc` and went
    # red on ITSELF: the literal it was hunting was the literal it was written
    # with. A sweep over a source that contains the sweep counts the searcher.
    _door_flag = "--" + "door"
    _main_src = src_wc.split("def main(", 1)[1].split("\n    args = ap.parse_args()", 1)[0]
    cases.append(("…and no flag lets an operator choose it", _door_flag not in _main_src))
    cases.append(("CONTROL: that sweep can see a flag when one is there",
                  "--label" in _main_src))

    # ⛔ LAST, so every case above exists to be counted: suspended is not deleted,
    # and the three hard reds are still DRIVEN rather than merely present in the
    # source. (Placed here because a sweep over `cases` from the middle of the
    # function measures the cases written so far — which is not the question.)
    _names = [n for n, _ in cases]
    cases.append(("…and all three hard reds are still DRIVEN, not merely present",
                  any("offline sentence is NOT in the server body" in n for n in _names)
                  and any("a run that FORKS keeps BOTH halves" in n for n in _names)
                  and any("a run that GAINS a note" in n for n in _names)))
    cases.append(("CONTROL: that sweep can see a name that is NOT there",
                  not any("a rail nobody wrote" in n for n in _names)))

    bad_ct = 0
    for name, ok in cases:
        print(f"  {'ok  ' if ok else 'FAIL'} {name}")
        bad_ct += 0 if ok else 1
    print("self-check:", "PASS" if not bad_ct else f"FAIL ({bad_ct})")
    return 0 if not bad_ct else 1


def next_check_number() -> int:
    """The NAME of the next unlabelled run — `check N`, N above the highest one
    already written. ⚠️ It answers a different question from `this_run_number`
    below, and the two are not interchangeable: a `--label`led row carries no
    check number, so this one cannot count it."""
    try:
        text = DOC.read_text(encoding="utf-8")
    except OSError:
        return 1
    nums = [int(m) for m in re.findall(r"^### check (\d+)", text, re.M | re.I)]
    return (max(nums) + 1) if nums else 1


def rows_stamped(text: str) -> int:
    """How many check rows this document already holds — LABELLED OR NOT.

    ⭐ Counted by the shape of a ROW (`ROW_MARK`), never by the shape of a label.
    """
    return text.count(ROW_MARK)


def this_run_number() -> int:
    """The ordinal of the row THIS run will write — the door's only input.

    ⛔ Derived from the document, so it advances on every stamped run whatever
    the row is called. Keying the rotation to `next_check_number` would freeze it
    the moment a streak is run under `--label`, which is precisely when the seven
    rows are supposed to SHOW the rotation.
    """
    try:
        return rows_stamped(DOC.read_text(encoding="utf-8")) + 1
    except OSError:
        return 1


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--self-check", action="store_true")
    ap.add_argument("--park", action="store_true", help="spawn the rig at /login and leave it up for a hand sign-in")
    ap.add_argument("--label", default=None)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--no-canary", action="store_true")
    ap.add_argument("--profile", default=None,
                    help=f"absolute path to THE rig profile (or ${PROFILE_ENV}); "
                         "required from any worktree but the main one")
    ap.add_argument("--allow-new-profile", action="store_true",
                    help="permit CREATING a profile directory that does not exist "
                         "(a fresh profile is a signed-out one — only for --park)")
    args = ap.parse_args()

    global ALLOW_NEW_PROFILE
    ALLOW_NEW_PROFILE = bool(args.allow_new_profile)
    use_profile(resolve_profile(args.profile))

    if args.self_check:
        return self_check()
    if args.park:
        return park()

    label = args.label or f"check {next_check_number()}"
    # ⭐ Read ONCE, here, from the document — and there is deliberately no flag
    # for it. The door a run walks through is not the operator's to choose.
    number = this_run_number()
    log_line(f"{label}: starting (row #{number}, door `{door_for(number)}`)")
    try:
        chk = run_check(label, with_canary=canary_should_run(CANARY_SUSPENDED, args.no_canary),
                        number=number)
    except SystemExit as e:
        log_line(f"{label}: STOPPED — {e}")
        raise
    except BaseException as e:  # noqa: BLE001
        # ⛔ The log always closes the loop: "started and then nothing" is
        # indistinguishable from a machine that slept through the trigger.
        log_line(f"{label}: CRASHED — {type(e).__name__}: {e}")
        teardown(None)
        raise
    print()
    for r in chk.reads + chk.canary:
        print(f"  {'ok  ' if r.ok else 'FAIL'} {r.name}: {r.render()}")
    if chk.findings:
        print("\n\U0001f6a8 NEW FINDING")
        for f in chk.findings:
            print("   -", f)
    print()
    ok = stamp(chk, args.dry_run)
    if not (ok and not chk.findings):
        return 1
    # ⛔⛔ A RUN THAT DID NOT FIRE THE CANARY IS NOT A STREAK RUN, AND MUST NOT
    # BE COUNTABLE AS ONE.
    #
    # ⚰️ 2026-09-11: seven runs were launched as a streak against the deployed
    # build and all seven exited 0 in 106 seconds total. They had done READS
    # ONLY — no note, no typing, no door, no fork check — because
    # `CANARY_SUSPENDED` still won over the missing `--no-canary`, exactly as it
    # was designed to. The suppression worked; the REPORTING did not. A caller
    # counting exit codes cannot tell "seven clean canaries" from "seven runs
    # that did nothing", and that is the whole shape of the defect this wave
    # exists to hunt (`lesson_a_fixture_that_cannot_distinguish_is_not_a_rail`).
    #
    # So a reads-only run gets its OWN exit code. 0 means the canary ran and was
    # green; 3 means nothing was exercised. Any streak loop counts 0 and only 0.
    if not chk.canary:
        print("")
        print("⛔ READS-ONLY RUN - the canary did not fire, so this is NOT a streak run.")
        print("   exit 3: green reads, nothing exercised.")
        return 3
    return 0


if __name__ == "__main__":
    sys.exit(main())
