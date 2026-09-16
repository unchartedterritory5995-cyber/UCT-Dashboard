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

    !! THE BUDGET IS 900s, AND THAT IS A MEASUREMENT, NOT A GUESS.

    The sweep reads 4,711 files / 60 MB and matches 75 patterns; the read costs
    0.3s and the matching costs ~66s, because a 75-way regex alternation runs at
    a few MB/s. Standalone it takes 60-85s. At the gate's first budget of 180s it
    TIMED OUT under a loaded box (another session's six-shard gate was running),
    and the verdict printed "DID NOT RUN ... this is not a clean result" - a
    TOOLING failure wearing a verdict's clothes, on the one run of the week that
    decides keep-or-revert.

    * 900s is ~10x the measured cost, which is headroom for a contended box
    rather than a number chosen to make a red go away. The gate writes a file and
    has no deadline of its own, so waiting is free; being unable to say whether
    §8 is intact is not.

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
                              errors='replace', timeout=900)
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
    # Renamed 2026-09-13 when the column became three populations. The OLD
    # spelling stays mapped: every row already in the log carries it, and a
    # gate that cannot read its own history reports the window as unreadable.
    "opt-ins by population (utc)": "latest_optin",
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


def split_cells(line: str, ncols: int | None = None) -> list[str]:
    """A table line's cells, with a pipe INSIDE the LAST column put back.

    !!!! THE SAMPLER WRITES A PIPE INTO THE FLAG CELL. `nb_observe.py` joins the
    parts of an ANOMALY reason with `"  |  "`, so the row that finally carries
    the failing URL reads

        ... | 2 | **ANOMALY** - 2 console/page error(s): console.error: ...
            [issued by https://.../api/barspack/manifest:0]  |  HTTP: GET
            https://.../api/barspack/manifest -> 401 |

    which is TEN cells under a NINE-column header. Measured against the live log
    2026-09-14: the 01:00 ET row - the ONLY row that has ever carried a URL - was
    dropped as `row ... has 10 cell(s) under a 9-column header`, so the ownership
    ruling below would have had nothing to read.

    ⭐ The surplus is put back into the LAST column and nowhere else, and only
    when the caller says how many columns there are. Splitting the overflow
    across the middle would shift every column one place - the `x[4]`/`x[6]`
    defect this gate already paid for once - so the repair is deliberately the
    narrowest one that can be correct: the flag cell is the last column, it is
    the only free text the sampler writes, and the RAW pieces are rejoined with
    the pipe they were split on, so the cell is byte-identical to what was
    written.
    """
    raw = line.strip('|').split('|')
    if ncols and ncols >= 1 and len(raw) > ncols:
        raw = raw[:ncols - 1] + ['|'.join(raw[ncols - 1:])]
    return [c.strip() for c in raw]


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
        # ! The header decides the width, so it is split without one; a DATA row
        # is split against the header it sits under, which is what lets a pipe
        # inside the flag cell be put back instead of shifting every column.
        is_header = 'at (ET)' in line
        width = None if is_header or not keys or keys[-1] != 'flag' else len(keys)
        cells = split_cells(line, width)
        if is_header:
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


# =============================================================================
# TRIGGER 4 - OWNERSHIP OF THE FAILING REQUEST, NOT ITS SEVERITY.
# Owner ruling 2026-09-14, approved as proposed:
#   "Trigger-4 filter - filter by OWNERSHIP of the failing request's origin, not
#    severity. A 401 from a request the Notebook doesn't issue is FOREIGN and
#    recorded, not an ANOMALY; a 401 from anything the Notebook issues stays a
#    trigger. Rail both directions."
# =============================================================================
# Three consecutive rows (2026-09-13 19:00, 21:00, 23:00 ET) read
# `**ANOMALY** - 2 console/page error(s)` and the whole of their evidence was
# `Failed to load resource: the server responded with a status of 401 ()`. A
# STATUS cannot decide this: the same 401 is a foreign endpoint refusing an
# unauthenticated prefetch AND the Notebook's own write being rejected. The
# concrete case is `GET https://uctintelligence.com/api/barspack/manifest -> 401`
# - the app shell's chart/bars prefetch (`app/src/utils/prefetchBars.js`, reached
# from MoversSidebar / TickerPopup / FuturesStrip / CatalystTable), not the
# Notebook.
#
# ⛔⛔ UNKNOWN IS NOT CLEAR. The sampler only learned to record the failing URL on
# 2026-09-14; every row written before that names a COUNT and nothing else. An
# un-attributable row STAYS a trigger. Scoring "we cannot tell" as "not ours" is
# the same move as scoring an UNREADABLE close as absent, which this wave has
# already made once (`_doc_text(None) == ''`).
#
# ⭐ ONE PREFIX SET, ONE PLACE, AND NOT A URL. Hard-coding `/api/barspack/manifest`
# would leave the next foreign endpoint to be ruled on all over again. Ownership
# is a RULE about which API surface the Notebook page issues.
NOTEBOOK_REQUEST_PREFIXES = (
    # The Journal-2.0 surface. The Notebook page IS this API, and so is the
    # offline layer: `/api/j2/note`, `/api/j2/notes/...` and `/api/j2/telemetry`
    # are the only endpoints `app/src/pages/journal-2-0/lib/offline/*.js` issues.
    '/api/j2/',
    # The Notebook's capability flags ride the ACCESS PAYLOAD - `notebookFlags.js`
    # latches `notebook_offline_*` out of whatever `/api/auth/*` returns - so an
    # auth request that fails IS a Notebook failure. It is the exact shape K-1's
    # "an unreachable auth payload fails to OFF" is written against, and a 401
    # there would be the wave silently deciding it may not write.
    '/api/auth/',
)

# What the sampler writes beside the count, and how to read it back.
# `nb_observe.py` emits `  [issued by <url>:<line>]` from the console message's
# LOCATION, `  [no location]` when it has none, and
# `HTTP: <METHOD> <url> -> <status> ; ...` with a ` (+N more)` tail when it had
# to truncate the deduped failing-request list at three.
_ISSUED_BY = re.compile(r'\[issued by (\S+?):(-?\d+|None|null|undefined)\]')
_HTTP_ENTRY = re.compile(
    r'\b(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+(\S+)\s+->', re.I)
_TRUNCATED = re.compile(r'\(\+\d+ more\)')


def request_ownership(origin: str) -> str:
    """'notebook', 'foreign' or 'unknown' for ONE recorded request origin.

    ⛔ THE THIRD ANSWER IS THE WHOLE POINT. A predicate that only answers "is it
    ours?" turns every origin it cannot read into a foreign one, and this gate
    would then clear a hole it never looked at. Foreign is only ever returned for
    a path this rule can positively place on ANOTHER product's API surface.

    Classification is by PATH: every request the rig sees is same-origin against
    production, and a third-party host serving `/api/...` is foreign anyway.
    """
    s = (origin or '').strip().strip('.,;)]')
    if not s:
        return 'unknown'
    m = re.match(r'(?:[a-z][a-z0-9+.-]*://[^/\s]*)?(/\S*)', s, re.I)
    if not m:
        return 'unknown'
    path = m.group(1).split('?')[0].split('#')[0]
    if any(path == p.rstrip('/') or path.startswith(p)
           for p in NOTEBOOK_REQUEST_PREFIXES):
        return 'notebook'
    if path.startswith('/api/'):
        # Another product's endpoint on the same host. `/api/barspack/...`,
        # `/api/bars/...`, `/api/live-prices` - the app shell issues these on
        # every page, the Notebook issues none of them.
        return 'foreign'
    # A bundle chunk (`/assets/index-*.js`), a page URL, anything else: this rule
    # cannot place it, so it is not cleared.
    return 'unknown'


def console_attribution(flag_cell) -> dict:
    """Who owns the failing requests ONE observation row recorded?

    Returns {'verdict', 'origins', 'why'}. `verdict` is 'foreign' ONLY when the
    row's own evidence accounts for where its errors came from and every one of
    those origins is another product's.

    ⛔ FAILURE-SAFE IN FOUR PLACES, each of which would otherwise clear a row
    nobody has looked at:
      · a row that names no origin at all (every row before 2026-09-14);
      · `[no location]` - the console message had no location to attribute;
      · ` (+N more)` - the sampler truncated the failing-request list at three,
        so origins it did not print exist;
      · `pageerror:` - a JS exception thrown by the page. It has no request
        origin at all, and the page it was thrown on is `/journal/notebook`, so
        it is the Notebook's however clean the HTTP list beside it looks.
    """
    cell = str(flag_cell or '')
    if 'pageerror:' in cell:
        return {'verdict': 'notebook', 'origins': [],
                'why': 'a pageerror is an exception thrown by the Notebook page itself'}
    origins, seen = [], set()
    for m in _ISSUED_BY.finditer(cell):
        if m.group(1) not in seen:
            seen.add(m.group(1))
            origins.append(m.group(1))
    for m in _HTTP_ENTRY.finditer(cell):
        if m.group(1) not in seen:
            seen.add(m.group(1))
            origins.append(m.group(1))
    if not origins:
        return {'verdict': 'unknown', 'origins': [],
                'why': 'the row names no failing-request URL - it predates the '
                       'sampler recording one, and unknown is not clear'}
    if _TRUNCATED.search(cell):
        return {'verdict': 'unknown', 'origins': origins,
                'why': 'the row\'s failing-request list is TRUNCATED - origins it '
                       'did not print exist'}
    if '[no location]' in cell:
        return {'verdict': 'unknown', 'origins': origins,
                'why': 'a console error on this row carried NO location, so it '
                       'cannot be attributed'}
    kinds = [request_ownership(o) for o in origins]
    if 'notebook' in kinds:
        owned = [o for o, k in zip(origins, kinds) if k == 'notebook']
        return {'verdict': 'notebook', 'origins': origins,
                'why': 'Notebook-owned request(s) failed: ' + ', '.join(owned)}
    if 'unknown' in kinds:
        odd = [o for o, k in zip(origins, kinds) if k == 'unknown']
        return {'verdict': 'unknown', 'origins': origins,
                'why': 'origin(s) this gate cannot place: ' + ', '.join(odd)}
    return {'verdict': 'foreign', 'origins': origins,
            'why': 'every failing request is an endpoint the Notebook does not issue'}


# =============================================================================
# TRIGGER 1 - THE SAME OWNERSHIP FILTER, OVER THE WHOLE FLAG CELL.
# Owner ruling 2026-09-14, approved as proposed:
#   "Trigger 1 saying REVERT on a foreign row: apply the same ownership filter
#    you applied to trigger 4 - a foreign-origin console row is recorded, not a
#    trigger."
# =============================================================================
# ⛔⛔ TRIGGER 1 IS NOT A CONSOLE-ERROR TEST, AND READING IT AS ONE IS HOW THIS
# RULING GETS APPLIED TO THE WRONG CONDITION. It reads the sampler's FLAG CELL,
# which `nb_observe.py` writes as `OK`, or as `**ANOMALY** — <reason> · <reason>`
# over THREE reason families:
#   · `<N> console/page error(s): ...`            - the only one the ruling touches
#   · `UNKNOWN INTERNAL identity opted in (...)`  - an undeclared .internal account
#   · `blocked-baseline events = <N>`             - the wave's own headline metric
# (plus `**SKIPPED**`, which never reaches here - `is_skipped` partitions it out
# upstream, and an unobserved interval is not a red.)
#
# ⛔ So a filter that cleared a row BECAUSE its console errors were foreign would
# also clear a row carrying a blocked-baseline event beside them - the one number
# this window exists to watch. The ownership answer is about the failing REQUEST;
# it says nothing about the other two families and must never be read as if it
# did.
#
# ⭐ SO THE CLEARANCE IS AN ALLOW-LIST OF TWO ANSWERS. A row is cleared only when
# its ENTIRE flag is console evidence AND `console_attribution` - the ONE ownership
# authority above, never a second copy of it - says every origin belongs to another
# product. Everything else stays a trigger: a Notebook-owned error, an
# un-attributable one, any other reason family, and any flag shape this gate cannot
# read.
_ANOMALY_HEAD = re.compile(r'^\*\*ANOMALY\*\*\s*[\u2014\u2013-]\s*')
# ! THE TWO SEPARATORS DIFFER BY ONE SPACE AND NOTHING ELSE. `nb_observe.py` joins
# REASONS with `" · "` and the bits INSIDE one console reason with `"  ·  "`, so a
# naive split on the middot cuts a console reason in half. The lookarounds keep the
# two apart - and the failure direction is safe either way: an over-split leaves a
# fragment that is not a console reason, which REFUSES to clear the row.
_REASON_SEP = re.compile(r'(?<! ) \u00b7 (?! )')
_CONSOLE_REASON = re.compile(r'^\d+\s+console/page error\(s\):')


def flag_attribution(flag_cell) -> dict:
    """Trigger 1's reading of ONE row's flag: {'verdict', 'origins', 'why'}.

    `verdict` is one of:
      · 'ok'       - the sampler wrote OK; there is nothing to explain.
      · 'foreign'  - the WHOLE flag is console evidence and every origin belongs
                    to another product. RECORDED below, not a trigger.
      · 'notebook' / 'unknown' / 'other' - still a trigger.

    ⛔ 'other' is the answer that keeps this honest: a reason family this filter
    does not understand can never be cleared by an ownership answer about a
    DIFFERENT reason sitting on the same row.
    """
    cell = str(flag_cell or '').strip()
    if cell.startswith('OK'):
        return {'verdict': 'ok', 'origins': [], 'why': 'the sampler wrote OK'}
    m = _ANOMALY_HEAD.match(cell)
    if not m:
        return {'verdict': 'other', 'origins': [],
                'why': 'the flag is neither OK nor an ANOMALY this gate can read: '
                       + (cell[:80] if cell else '(empty)')}
    reasons = [s.strip() for s in _REASON_SEP.split(cell[m.end():]) if s.strip()]
    if not reasons:
        return {'verdict': 'other', 'origins': [],
                'why': 'an ANOMALY flag with no reason text'}
    other = [s for s in reasons if not _CONSOLE_REASON.match(s)]
    if other:
        return {'verdict': 'other', 'origins': [],
                'why': 'this row is red for a reason ownership does not answer: '
                       + other[0][:120]}
    return console_attribution(cell)


# =============================================================================
# TRIGGER 3 - READ THE CANARY'S OWN STAMP, do not print `n/a` beside evidence.
# =============================================================================
# The sampler runs OPTED OUT, so its outbox is structurally zero and it can say
# nothing about a stuck queue. Only the Sunday canary drives a real queue. Its
# result was already being written - and this gate printed
# `n/a - canary or member report only` beside it, on the one run of the week
# that reads it. 2026-09-13: the canary ran GREEN at 20:00:01Z and the verdict
# still said n/a.
#
# !! WHAT THE CANARY CAN AND CANNOT EVIDENCE, stated so nobody overclaims.
# A canary run lasts minutes, not hours, so it cannot observe an item stuck for
# more than five minutes. What it CAN observe is the condition whose absence
# that trigger watches for: it queues real work offline, reconnects, and reports
# whether the queue SETTLED. `outbox 0` at the settle step is positive evidence
# that the drain is not stranding work; it is not a five-minute observation, and
# the verdict line says so in those words.
CANARY_FRESH_HOURS = 30
_CANARY_HEAD = re.compile(r'^### ([a-z0-9-]+) \u2014 \*\*(20[0-9-]{8}T[0-9:]{8}Z)\*\*',
                          re.M)


def canary_queue_evidence(now=None):
    """The newest canary run's queue reading, or None with a reason.

    !! FRESHNESS IS PART OF THE READING. A canary from last Sunday says nothing
    about this window, and an old green is the most flattering thing a stale
    artifact can say.
    """
    if not RESUME.exists():
        return None, f'no resume doc at {RESUME}'
    text = RESUME.read_text(encoding='utf-8', errors='replace')
    heads = list(_CANARY_HEAD.finditer(text))
    if not heads:
        return None, 'no canary section in the resume doc'
    # Newest by STAMP, not by position: the doc is prepend-ordered today and
    # that is a layout choice, not a guarantee.
    head = max(heads, key=lambda m: m.group(2))
    label, stamp = head.group(1), head.group(2)
    try:
        when = datetime.datetime.strptime(stamp, '%Y-%m-%dT%H:%M:%SZ')
    except ValueError:
        return None, f'canary stamp {stamp!r} is unparseable'
    # tz-aware, then dropped to naive for comparison with the naive stamp —
    # `utcnow()` is deprecated and warns into the gate's own output.
    now = now or datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None)
    age_h = (now - when).total_seconds() / 3600.0
    if age_h > CANARY_FRESH_HOURS:
        return None, (f'the newest canary is {label} @ {stamp}, '
                      f'{age_h:.0f}h old - older than {CANARY_FRESH_HOURS}h, so it '
                      f'says nothing about this window')

    # chr(10) here, not the NLV bound inside main() — a module-level helper
    # must not depend on a caller's local.
    nxt = text.find(chr(10) + '### ', head.end())
    body = text[head.end(): nxt if nxt != -1 else len(text)]

    settle = re.search(r'the queue settled[^|]*\|([^|]*)\|', body)
    if not settle:
        return None, (f'canary {label} @ {stamp} wrote no queue-settled step - '
                      f'the run did not reach it')
    cell = settle.group(1)
    m = re.search(r'outbox\s+\*\*(\d+)\*\*', cell)
    if not m:
        return None, f'canary {label} @ {stamp}: the settle step names no outbox count'
    outbox = int(m.group(1))
    mini = re.search(r'\*\*mini-canary\*\*\s*\|[^|]*?(\d+)/(\d+)\*\* steps green', body)
    steps = f'{mini.group(1)}/{mini.group(2)}' if mini else 'unreported'
    return {'label': label, 'stamp': stamp, 'outbox': outbox,
            'steps': steps, 'age_h': age_h}, None

def main() -> int:
    at = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=-4))).strftime("%Y-%m-%d %H:%M ET")
    NLV = chr(10)
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
    # ⛔⛔ OWNERSHIP, NOT SEVERITY (owner ruling 2026-09-14) - the same filter
    # trigger 4 already carries, reached through `flag_attribution` so the rule
    # lives in ONE place. Two answers clear a row and no others: 'ok', and
    # 'foreign' (the whole flag is console evidence and every origin is another
    # product's). Ours, un-attributable, an UNKNOWN INTERNAL opt-in, a
    # blocked-baseline event, a flag shape this gate cannot read - all still FAIL.
    t1_attr = [(x, flag_attribution(x.get('flag'))) for x in observed]
    bad = [x for x, a in t1_attr if a['verdict'] not in ('ok', 'foreign')]
    t1_foreign = [(x, a) for x, a in t1_attr if a['verdict'] == 'foreign']
    skipped = skipped_recs
    t1 = ("PASS" if not bad else "FAIL") + (
        '' if not t1_foreign else
        f" - {len(t1_foreign)} FOREIGN row(s) recorded below, not blocking")
    if bad:
        why1 = next(a['why'] for x, a in t1_attr if x is bad[0])
        fails.append(f"trigger 1: {len(bad)} non-OK row(s), first at "
                     f"{bad[0]['at']} ({why1})")

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
    ev, why = canary_queue_evidence()
    if ev is None:
        t3 = f'n/a - {why}'
    elif ev['outbox'] == 0:
        t3 = (f"PASS - canary `{ev['label']}` @ {ev['stamp']} queued real work "
              f"offline and the queue SETTLED (outbox {ev['outbox']}, mini-canary "
              f"{ev['steps']} green). \u26a0\ufe0f A canary run is minutes long, so this "
              f"evidences that the drain does not strand work - it is not a "
              f"five-minute observation")
    else:
        t3 = (f"FAIL - canary `{ev['label']}` @ {ev['stamp']} left "
              f"**outbox {ev['outbox']}** at its settle step: the queue did NOT "
              f"settle")
        fails.append(f"trigger 3: the canary's queue did not settle "
                     f"(outbox {ev['outbox']} at {ev['stamp']})")

    # trigger 4 - console errors seen by the rig (same bundle a member runs)
    # !!!! OBSERVED ROWS ONLY, and BY NAME. This read `x[6]` over EVERY row: the
    # 2026-09-12 23:00 SKIP (production unreachable mid-deploy) carries 20 console
    # errors from a page that could not load, and `x[6]` is `outbox` under the
    # 9-column header anyway. Either fault alone printed REVERT.
    # ⛔⛔ OWNERSHIP, NOT SEVERITY (owner ruling 2026-09-14). A row whose errors
    # all come from endpoints the Notebook does not issue is FOREIGN: RECORDED
    # with its URL below, and not blocking. It is never dropped - a hole that is
    # invisible is worse than one that is attributed. Everything else - ours, or
    # un-attributable - still fails, and the COUNT this reads is unchanged.
    errs_all = [x for x in observed if (number(x, 'console') or 0) > 0]
    errs, foreign_rows = [], []
    for x_ in errs_all:
        attr = console_attribution(x_.get('flag'))
        (foreign_rows if attr['verdict'] == 'foreign' else errs).append((x_, attr))
    foreign_note = ('' if not foreign_rows else
                    f" - {len(foreign_rows)} FOREIGN row(s) recorded below, not blocking")
    t4 = ("PASS" if not errs else "FAIL") + foreign_note
    if errs:
        fails.append(f"trigger 4: console errors at {errs[0][0]['at']} "
                     f"({errs[0][1]['why']})")
    errs = [x_ for x_, _ in errs]

    # ⭐ ONE FOREIGN LEDGER FOR BOTH TRIGGERS, IN LOG ORDER. Trigger 1 reads the
    # FLAG and trigger 4 reads the console COLUMN, so they do not clear the same
    # set: a row whose only evidence is a failed HTTP request records `0` in the
    # console column and never reaches trigger 4 at all. Printing only trigger 4's
    # half would delete exactly that row from the record - and clearing a row from
    # a trigger and clearing it from the record are two different acts, only the
    # first of which was ruled on.
    _t4_ids = {id(x_) for x_, _ in foreign_rows}
    _t1_ids = {id(x_) for x_, _ in t1_foreign}
    _attr_by_id = {id(x_): a_ for x_, a_ in list(t1_foreign) + list(foreign_rows)}
    foreign_report = [(x_, _attr_by_id[id(x_)]) for x_ in observed
                      if id(x_) in _t4_ids or id(x_) in _t1_ids]


    # =========================================================================
    # THREE POPULATIONS, PRINTED EVERY TIME, NEVER SUMMED. Owner ruling 2026-09-13.
    # =========================================================================
    # !!!! ONE `members` FIGURE IS WHAT PUBLISHED OUR OWN TEST ACCOUNT AS SEVEN
    # INDEPENDENT MEMBERS. The sampler counted opt-in ROWS from any address not
    # on a two-item exclusion list; the T-12 smoke account was not on it, and the
    # 15:00 ET row read `members 7`. This gate would have printed
    # `organic members exposed = 7` into the artifact the K window is judged on.
    #
    # * ORGANIC is a person who is not us -- the only number the wave's claims may
    # be divided by. SYNTHETIC is an account we provisioned: it proves the path is
    # reachable and proves nothing about adoption. RIG/OWNER is the instrument.
    # They are three facts and they are never added together.
    def _pop(cell, name):
        """The count for one population, read from the row's own text."""
        m = re.search(name + r'\s+(\d+)', cell)
        return int(m.group(1)) if m else None

    organic = synthetic = rigowner = 0
    unknown_internal = 0
    legacy_rows = 0
    for x_ in recs:
        cell = str(x_.get('latest_optin') or x_.get('optin_member_old') or '')
        o = _pop(cell, 'organic')
        if o is None:
            # !! A ROW IN THE OLD `members N` SHAPE. Its number counted ROWS from
            # every non-excluded address, so it is NOT an organic count and must
            # not be read as one. Counted separately and reported, never folded in.
            if 'members ' in cell:
                legacy_rows += 1
            continue
        organic = max(organic, o)
        synthetic = max(synthetic, _pop(cell, 'synthetic') or 0)
        rigowner = max(rigowner, _pop(cell, 'rig/owner') or 0)
        unknown_internal = max(unknown_internal, _pop(cell, 'UNKNOWN INTERNAL') or 0)

    member = (
        'none - 0 organic members (nobody outside this programme has opened the '
        'Notebook in this window)' if organic == 0
        else str(organic) + ' ORGANIC MEMBER IDENTITY(S) - see the log'
    )
    organic_line = (
        'organic members exposed = ' + str(organic)
        + '  |  synthetic = ' + str(synthetic)
        + '  |  rig/owner = ' + str(rigowner)
        + (('  |  !! UNKNOWN INTERNAL = ' + str(unknown_internal)) if unknown_internal else '')
        + ('  (counted by distinct identity, never summed)')
    )
    if legacy_rows:
        organic_line += (NLV + '           ! ' + str(legacy_rows) + ' row(s) predate the '
                         'three-population split and carry the old `members N` count, '
                         'which counted ROWS from any non-excluded address. Those numbers '
                         'are NOT organic counts and are excluded from the three above.')

    dnb = do_not_build()
    # ! AN UNREADABLE ROW IS NOT A CLEAN ONE. It does not make the wave bad, so it
    # does not say REVERT on its own - it says the reading is INCOMPLETE, which is
    # the third state this programme keeps having to re-learn.
    unreadable = bool(gripes)
    stuck = isinstance(ev, dict) and ev.get("outbox", 0) > 0
    verdict = "KEEP" if (hb_ok and not bad and not errs and not conf and not stuck) else "REVERT"
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
POPULATION: {organic_line}
do-not-build: {dnb}

| trigger | result |
|---|---|
| 1 · unexplained red | {t1} |
| 2 · unattributable fork | {t2} |
| 3 · outbox stuck >5 min | {t3} |
| 4 · member console error | {t4} |

"""
    # (NLV is defined once, near the top of main() -- a second binding of the same value is the shape `lesson_a_second_authority_over_one_value` names.)
    if fails:
        body += '## Why this is not a clean KEEP' + NLV + NLV
        body += NLV.join('- ' + f for f in fails) + NLV + NLV
    # ⭐ FOREIGN ERRORS ARE PRINTED, ALWAYS. They do not block (owner ruling
    # 2026-09-14), and a filter whose output nobody can see is a filter that
    # deletes evidence. Each row names the URLs it was cleared on.
    if foreign_report:
        body += ('## Foreign console errors - RECORDED, not blocking' + NLV + NLV
                 + 'Triggers 1 and 4 both filter by OWNERSHIP of the failing '
                 + 'request, not by severity (owner rulings 2026-09-14). Every '
                 + 'error on these rows came from an endpoint the Notebook does '
                 + 'not issue, so they do not say REVERT - and they are named in '
                 + 'full, because a hole that is invisible is worse than one that '
                 + 'is attributed.'
                 + NLV + NLV)
        for x_, attr in foreign_report:
            body += ('- ' + str(x_.get('at')) + ' - '
                     + ', '.join(attr['origins']) + NLV)
        body += NLV
    if organic == 0:
        body += ('## !! What a KEEP over zero organic members does NOT mean' + NLV + NLV
                 + 'Every trigger reads clean when nobody has run the layer -- that is what '
                 + 'clean looks like over an EMPTY SET.' + NLV + NLV
                 + '!!!! **CONSEQUENCE FOR K-1.** Its precondition is a config-served rate '
                 + 'of 100% over the K window, measured by identity. If this window closes '
                 + 'with zero organic members, that is **100% of a synthetic population**, '
                 + 'and the K-1 flip packet must say so in those words rather than quoting '
                 + 'a rate that sounds like fleet coverage.' + NLV + NLV)
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
