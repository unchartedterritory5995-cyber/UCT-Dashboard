"""The flip preconditions, DERIVED — because a hand-maintained checklist is a checklist that drifts.

    python docs/discord-render/instruments/flip_preconditions.py --self-check
    python docs/discord-render/instruments/flip_preconditions.py
    python docs/discord-render/instruments/flip_preconditions.py --json   # for 06's table

⛔⛔ EVERY ROW IS EITHER MEASURED HERE OR REPORTED AS **NOT MEASURABLE**. There is no third state
and nothing is ever assumed MET. `docs/feature_flags.json` described an unreleased surface while
members were using it for a full day, because a ledger records INTENT and cannot see the world; a
precondition table typed by hand has exactly that failure mode and the same excuse.

⛔ NOT MEASURABLE IS NOT A FAILURE AND IT IS NOT A PASS. A row this tool cannot reach — the
real-Discord smoke, the #render-alerts overwrites — prints as NOT MEASURABLE with the artifact that
would settle it named. The overall verdict is MET only when every row is MET, so an unmeasurable
row blocks the flip exactly as a failing one does; what differs is what you do about it.

⛔ EXIT CODES ARE THREE: 0 all MET · 1 at least one NOT MET · 2 at least one NOT MEASURABLE and
none NOT MET.

⭐ The flip this gates is the ADMIN-ONLY CANARY. The member-channel flip is the owner's and this
tool does not speak to it.

═══════════════════════════════════════════════════════════════════════════════════════════════
⛔⛔⛔ THE ONE RULE THIS FILE EXISTS TO ENFORCE (owner ruling A1, 2026-09-14)
═══════════════════════════════════════════════════════════════════════════════════════════════

    "The gate must be unable to lie. Every row reads a verdict from evidence CONTENT, never from
     file existence, and every row gets a mutation control."

⚰️ THE INCIDENT. `check_s2_measured` was literally

        MET if list(glob("*real*.json")) else NOT_MEASURABLE

and it never opened a single one of those files. Before 2026-09-14 there were no `--real` runs, so
the row read NOT MEASURABLE and everybody trusted it. The first `--real` runs in the programme's
history were then produced — and every one of them printed `TOTALS load_harness FAIL`, S2 p50
14,855 ms against a 2,500 ms target, success 35.7%. **The row flipped to MET, because five files
now existed.** Producing FAILING evidence made the gate GREENER, on the row that decides whether
delivery meets its SLO, in the instrument the flip packet calls "the authority".

⛔ THE THREE-STATE CONTRACT, which every `check_*` in this file now obeys:

    MET             something in the evidence AFFIRMATIVELY SAYS the precondition holds.
    NOT MET         evidence exists and says it does not hold.
    NOT MEASURABLE  evidence is ABSENT, or exists and cannot be read as a verdict — and the
                    reason is NAMED. Never silently skipped, and never counted as a pass.

⛔ AND THE NON-VACUITY HALF, which is the half people forget: a row that can only print NOT MET
satisfies every "plant a failure" control and is just as useless. `mutation_harness_flipgate.py`
proves THREE states per row — plant a pass, plant a failure, delete the evidence — and
`tests/test_flip_gate_cannot_lie.py` runs that set in the ordinary scoped pytest run.

⛔ THAT IS WHY `Evidence` EXISTS. Every path this file reads is reached through an injectable
`Evidence` record whose defaults are the real tree. A gate that hard-codes ROOT cannot be
mutation-proved without planting into the repo's own evidence directory, and an instrument that
must corrupt the evidence to test itself will not be tested.
"""
from __future__ import annotations

import argparse
import ast
import dataclasses
import datetime as _dt
import json
import os
import pathlib
import re
import subprocess
import sys

try:
    import evidence_contract as ec
except ModuleNotFoundError:            # imported by path rather than from the instruments dir
    sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
    import evidence_contract as ec

MET, NOT_MET, NOT_MEASURABLE = "MET", "NOT MET", "NOT MEASURABLE"
ALL_MET, SOME_NOT_MET, SOME_UNMEASURABLE = 0, 1, 2

ROOT = pathlib.Path(__file__).resolve().parents[3]
SOAK_LOG = pathlib.Path(os.environ.get("UCT_RENDER_SOAK_LOG",
                                       r"C:\Users\Patrick\uct-render-soak\soak.log"))
#: 24 h of 15-minute ticks, minus a little slack for a missed slot or two.
SOAK_TICKS_FOR_24H = 90


@dataclasses.dataclass(frozen=True)
class Evidence:
    """Where every row looks. Defaults are the real tree; the mutation set passes a sandbox.

    ⛔ `soak_log` is a SECOND root: the soak log and the #render-alerts access log live outside
    the repository (a soak that wrote into the working tree would be a soak that dirtied every
    `git status` for a day). It is injected separately for exactly the same reason `root` is —
    a row nobody can point at a sandbox is a row nobody can mutation-prove.
    """
    root: pathlib.Path = ROOT
    soak_log: pathlib.Path = SOAK_LOG

    # ── the artifacts, named once so a rename is one edit and the harness agrees ──
    @property
    def forensics_test(self) -> pathlib.Path:
        return self.root / "tests" / "test_discord_render_forensics.py"

    @property
    def forensics_doc(self) -> pathlib.Path:
        return self.root / "docs" / "discord-render" / "01-failure-forensics.md"

    @property
    def bindings(self) -> pathlib.Path:
        return self.root / "api" / "services" / "discord_render" / "adapters" / "bindings.py"

    @property
    def shadow_rail(self) -> pathlib.Path:
        return self.root / "tests" / "test_discord_render_shadow_reaches_chart.py"

    @property
    def evidence_dir(self) -> pathlib.Path:
        return self.root / "docs" / "discord-render" / "evidence"

    @property
    def step3(self) -> pathlib.Path:
        return self.evidence_dir / "step3"

    @property
    def flip_packet(self) -> pathlib.Path:
        return self.root / "docs" / "discord-render" / "06-flip-packet.md"

    @property
    def canary_scope(self) -> pathlib.Path:
        return self.evidence_dir / "canary-scope.json"

    @property
    def instruments(self) -> pathlib.Path:
        return self.root / "docs" / "discord-render" / "instruments"

    @property
    def alerts_log(self) -> pathlib.Path:
        return self.soak_log.parent / "render-alerts-access.log"


DEFAULT_EVIDENCE = Evidence()


def printer(stream=None):
    """⚠️ Windows consoles are cp1252 and every sentence in this file carries ⛔ or ≥.

    ⚰️ Measured 2026-09-14: the gate raised `UnicodeEncodeError` printing its own verdict row. A
    gate that dies printing its result prints NOTHING, and nothing reads as nobody looked — which
    is the same failure mode as the row that could not fail, arriving by a different door.

    ⛔ `stream=sys.stdout` as a DEFAULT binds the real stdout at import time, so a capturing
    caller sees an empty string. Resolve it at call time, always.
    """
    stream = sys.stdout if stream is None else stream
    try:
        stream.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError, OSError):
        pass

    def out(s: str = "") -> None:
        try:
            print(s, file=stream)
        except UnicodeEncodeError:
            print(str(s).encode("ascii", "replace").decode("ascii"), file=stream)
    return out


def _row(name: str, state: str, detail: str) -> dict:
    return {"precondition": name, "state": state, "evidence": detail}


def _read_text(path: pathlib.Path) -> tuple[str | None, str | None]:
    """(text, why_not). ⛔ An artifact that cannot be READ is not an artifact that is EMPTY.

    ⚰️ That distinction has cost this programme twice: a layer scored "absent" because the read
    returned None, and a gate that dropped an unreadable file on the floor and printed the rows it
    COULD read as if they were all of them. Every caller here turns `why_not` into a NAMED
    NOT MEASURABLE — never a skip, never a pass.
    """
    if not path.exists():
        return None, f"{path.name} is missing ({path})"
    try:
        return path.read_text(encoding="utf-8", errors="replace"), None
    except OSError as exc:
        return None, f"{path.name} could not be read ({type(exc).__name__}: {exc})"


def _read_json(path: pathlib.Path) -> tuple[object | None, str | None]:
    text, why = _read_text(path)
    if why:
        return None, why
    try:
        return json.loads(text), None
    except (ValueError, TypeError) as exc:
        return None, f"{path.name} is not readable JSON ({type(exc).__name__}: {exc})"


# ── rows this tool can measure ──────────────────────────────────────────────

N_XFAILS = "zero xfails in the forensics suite"


def check_no_xfails(ev: Evidence = DEFAULT_EVIDENCE) -> dict:
    """⛔ ZERO xfails on the programme's OWN features at flip time (owner ruling). Read from the
    source, not from a run: a run can be scoped past the file.

    ⛔ AND READ THE TESTS TOO, NOT ONLY THE MARKERS. "Zero xfails" over a file that declares zero
    tests is a vacuous pass of exactly the shape this file was rebuilt to remove — an empty or
    truncated forensics suite would have printed MET. The affirmative statement this row needs is
    "the suite is here AND carries no xfail", and both halves are now read.
    """
    src, why = _read_text(ev.forensics_test)
    if why:
        return _row(N_XFAILS, NOT_MEASURABLE, why)
    tests = re.findall(r"^\s*(?:async\s+)?def\s+test_", src, flags=re.M)
    if not tests:
        return _row(N_XFAILS, NOT_MEASURABLE,
                    f"{ev.forensics_test.name} declares NO tests — 'zero xfails' over zero tests "
                    f"is a vacuous pass, not a measurement")
    # ⛔ Comments and docstrings mention `xfail` constantly in this file — the prose is ABOUT the
    # markers. Match the decorator form only, at the start of a line.
    marks = re.findall(r"^@pytest\.mark\.xfail", src, flags=re.M)
    return _row(N_XFAILS, MET if not marks else NOT_MET,
                f"{len(tests)} test(s), {len(marks)} xfail decorator(s) in {ev.forensics_test.name}")


N_FORENSICS = "every forensics class closed with a commit"


def check_forensics_closed(ev: Evidence = DEFAULT_EVIDENCE) -> dict:
    """Every class in `01`'s table carries a ✅ and a commit, or it is not closed."""
    doc, why = _read_text(ev.forensics_doc)
    if why:
        return _row(N_FORENSICS, NOT_MEASURABLE, why)
    rows = [L for L in doc.splitlines() if L.startswith("| **C-")]
    # ⛔ A TABLE WITH NO ROWS IS NOT A CLOSED TABLE. Until 2026-09-14 this fell straight through to
    # `MET` with the evidence "0/0 closed": rename the doc's row prefix, or truncate the file to a
    # heading, and the row went green. Same defect as S2's, one doc over.
    if not rows:
        return _row(N_FORENSICS, NOT_MEASURABLE,
                    f"{ev.forensics_doc.name} declares no `| **C-` rows — an empty table is not a "
                    f"closed table")
    # ⛔⛔ EVERY ROW MUST CARRY ONE OF THE THREE MARKERS, and a row carrying NONE is the failure
    # this check exists for. ⚰️ The first version looked only for ✅ and reported "3/14 closed"
    # because eleven perfectly-closed rows had never been marked — an instrument reporting a
    # property of ITSELF as a property of what it measured. The doc now states each row's state
    # explicitly, which is information the flip packet needed anyway.
    unmarked = [L.split("|")[1].strip() for L in rows
                if not any(m in L for m in ("✅", "🟡", "🔴"))]
    if unmarked:
        return _row(N_FORENSICS, NOT_MEASURABLE,
                    f"{len(unmarked)} row(s) carry no closure marker: {', '.join(unmarked)}")
    not_closed = [L.split("|")[1].strip() for L in rows if "✅" not in L]
    return _row(N_FORENSICS, MET if not not_closed else NOT_MET,
                f"{len(rows) - len(not_closed)}/{len(rows)} closed"
                + (f"; still open: {', '.join(not_closed)}" if not_closed else ""))


N_CACHE = "the artifact cache is wired to the hot path"


def check_cache_wired(ev: Evidence = DEFAULT_EVIDENCE) -> dict:
    """⛔⛔ BUILT IS NOT WIRED, and this programme has shipped that twice. The question is not
    whether `artifact_cache` exists — it is whether the hot path calls it."""
    src, why = _read_text(ev.bindings)
    if why:
        return _row(N_CACHE, NOT_MEASURABLE, why)
    # an AST, never a grep: this file's comments discuss the cache at length
    try:
        tree = ast.parse(src)
    except SyntaxError as exc:
        # ⛔ This used to be an uncaught `ast.parse` — a bindings.py mid-edit did not make the row
        # unmeasurable, it made the WHOLE GATE crash with a traceback and print nothing at all.
        return _row(N_CACHE, NOT_MEASURABLE,
                    f"{ev.bindings.name} does not parse (SyntaxError line {exc.lineno}) — the "
                    f"wiring cannot be read, which is not the same as not being wired")
    # ⚰️ `from X import artifact_cache` puts the name in the ALIAS, not in `n.module`. Reading only
    # `n.module` asked a question whose answer was always no — a gate that could never print MET.
    names = {n.module for n in ast.walk(tree) if isinstance(n, ast.ImportFrom) and n.module}
    names |= {a.name for n in ast.walk(tree)
              if isinstance(n, (ast.Import, ast.ImportFrom)) for a in n.names}
    attrs = {n.attr for n in ast.walk(tree) if isinstance(n, ast.Attribute)}
    wired = any("artifact_cache" in (m or "") for m in names) or "artifact_cache" in attrs
    return _row(N_CACHE, MET if wired else NOT_MET,
                "bindings imports artifact_cache" if wired
                else "artifact_cache has no importer on the hot path — 2.5 is built and unconnected")


N_SOAK = "soak clean for >= 24 h"


def check_soak_24h(ev: Evidence = DEFAULT_EVIDENCE) -> dict:
    text, why = _read_text(ev.soak_log)
    if why:
        return _row(N_SOAK, NOT_MEASURABLE, f"no readable soak log: {why}")
    lines = [L for L in text.splitlines() if "TOTALS soak_job" in L]
    # ⛔ A LOG THAT EXISTS AND CARRIES NO TOTALS LINE IS NOT A RUN. Standing rule, and it applies
    # to the thing reading the log as much as to the thing writing it.
    if not lines:
        return _row(N_SOAK, NOT_MEASURABLE,
                    f"{ev.soak_log.name} exists ({len(text.splitlines())} line(s)) but carries no "
                    f"`TOTALS soak_job` line — a log with no verdict is not a run")
    passes = [L for L in lines if "TOTALS soak_job PASS" in L]
    if len(lines) != len(passes):
        return _row(N_SOAK, NOT_MET, f"{len(lines) - len(passes)} non-PASS tick(s) of {len(lines)}")
    # ⛔ A CLEAN SHORT RUN IS NOT A CLEAN RUN. The whole question a soak answers is whether anything
    # GROWS, and an hour cannot answer it however green the hour is.
    return _row(N_SOAK, MET if len(passes) >= SOAK_TICKS_FOR_24H else NOT_MEASURABLE,
                f"{len(passes)} clean tick(s); {SOAK_TICKS_FOR_24H} needed for 24 h")


N_SHADOW = "/chart is shadowed (structural)"

#: What the rail has to DO to be evidence, rather than to exist. Each is a sentence about the
#: mechanism, not a keyword: the route, the real signature, and the command in question.
SHADOW_CRITERIA = (
    ("drives the real route", "/api/discord/interactions"),
    ("signs like Discord does", "X-Signature-Ed25519"),
    ("names the /chart command", "chart"),
)


def check_shadow_records_chart(ev: Evidence = DEFAULT_EVIDENCE) -> dict:
    """The STRUCTURAL half — that the hook reaches `/chart` at all. Whether traffic happened is a
    different question and belongs to the shadow line, not here.

    ⛔⛔ THIS ROW WAS `MET if rail.exists()` UNTIL 2026-09-14, AND IT NEVER OPENED THE FILE. It is
    the same defect as S2's, in the row nobody was looking at because its answer had never been
    wrong. `touch tests/test_discord_render_shadow_reaches_chart.py` printed MET. An empty file
    printed MET. A file whose tests had all been commented out printed MET.

    ⭐ What the rail is FOR is driving the real route with a real signature — the docstring at the
    top of that file says so at length, because calling `observe_ack` directly proves the emitter
    works and says nothing about whether the route reaches it. So that is what gets read: the
    route, the signature header, the command. A rail that has lost any of them is a rail that no
    longer answers Gap 3, and it says NOT MET rather than quietly saying MET.
    """
    src, why = _read_text(ev.shadow_rail)
    if why:
        return _row(N_SHADOW, NOT_MEASURABLE,
                    f"{why} — a quiet Monday cannot be told from a missing hook")
    tests = re.findall(r"^\s*(?:async\s+)?def\s+test_", src, flags=re.M)
    missing = [label for label, needle in SHADOW_CRITERIA if needle not in src]
    if not tests:
        return _row(N_SHADOW, NOT_MET,
                    f"{ev.shadow_rail.name} exists but declares NO tests — a file is not a rail")
    if missing:
        return _row(N_SHADOW, NOT_MET,
                    f"{len(tests)} test(s) but the rail no longer {', nor '.join(missing)} — "
                    f"it cannot answer Gap 3 any more")
    return _row(N_SHADOW, MET,
                f"{len(tests)} test(s) driving {SHADOW_CRITERIA[0][1]} with a real Ed25519 "
                f"signature over a chart payload")


N_CANARY = "canary scope narrowed to the declared ids"

#: Discord snowflakes are 17-20 digits. The flip packet also writes `<canary id>` as a PLACEHOLDER
#: in its authority table — a placeholder is not a declaration and must never be parsed as one.
_SNOWFLAKE = re.compile(r"\b\d{17,20}\b")
_CHANNELS_DECL = re.compile(r"DISCORD_RENDER_V2_CHANNELS\s*=\s*([0-9,\s]+)")
CANARY_MAX_AGE_H = 24.0


def check_canary_scope(ev: Evidence = DEFAULT_EVIDENCE, now: _dt.datetime | None = None) -> dict:
    """⛔⛔ WITHOUT THIS THERE IS NO CANARY, AND NOTHING ELSE IN THIS TABLE NOTICES.

    `commands.enabled()` is one global boolean. `DISCORD_RENDER_V2_CHANNELS` (OI-35) is the only
    thing that makes "admin-only canary" different from the member-channel flip — and OI-35 says
    in capitals that UNSET MEANS EVERY CHANNEL. So the dangerous state is not a wrong id, it is an
    EMPTY allowlist: every other row in this table can read MET while every member's `/chart` in
    `#chart-flow-requests` goes to V2.

    ⛔ IT IS READ FROM A READ-BACK ARTIFACT, NOT FROM `railway variables --kv` AND NOT FROM
    `railway` AT ALL. Two reasons, both measured on this project:
      1. `--kv` reports what the service is CONFIGURED with. On 2026-09-12 it reported a variable
         the running pod still returned `None` for, because the redeploy had not swapped.
      2. This gate must run offline. A row that shells out to a network CLI cannot be
         mutation-proved, cannot run on a plane, and turns a credential outage into a green gate.

    The integrator refreshes `evidence/canary-scope.json` by reading the RUNNING process
    (`railway run --service web -- python -c "... print(c.v2_channels())"`) and pasting the result:

        {"read_at": "2026-09-14T21:00:00Z", "source": "in-process",
         "v2_channels": ["1549129739048853544"], "commit": "<sha>"}

    ⛔ AND IT EXPIRES. A read-back is a fact about a moment; a pod reboots, a variable is re-set,
    another session deploys. Older than 24 h is NOT MEASURABLE with the age named — not MET with a
    caveat nobody reads.
    """
    now = now or _dt.datetime.now(_dt.timezone.utc)

    packet, why = _read_text(ev.flip_packet)
    if why:
        return _row(N_CANARY, NOT_MEASURABLE, f"the declaration cannot be read: {why}")
    declared: set[str] = set()
    for chunk in _CHANNELS_DECL.findall(packet):
        declared |= set(_SNOWFLAKE.findall(chunk))
    if not declared:
        return _row(N_CANARY, NOT_MEASURABLE,
                    f"{ev.flip_packet.name} declares no canary channel id — every "
                    f"`DISCORD_RENDER_V2_CHANNELS=` it carries is a placeholder, and a placeholder "
                    f"is not a declaration")

    data, why = _read_json(ev.canary_scope)
    if why:
        return _row(N_CANARY, NOT_MEASURABLE,
                    f"{why}; declared = {sorted(declared)}. Refresh it by reading the RUNNING "
                    f"process, never `railway variables --kv`")
    if not isinstance(data, dict):
        return _row(N_CANARY, NOT_MEASURABLE,
                    f"{ev.canary_scope.name} is {type(data).__name__}, not an object")

    raw_at = data.get("read_at")
    if not isinstance(raw_at, str) or not raw_at.strip():
        return _row(N_CANARY, NOT_MEASURABLE,
                    f"{ev.canary_scope.name} carries no `read_at` — a read-back with no timestamp "
                    f"cannot be told from one taken last week")
    try:
        stamp = _dt.datetime.fromisoformat(raw_at.strip().replace("Z", "+00:00"))
    except ValueError:
        return _row(N_CANARY, NOT_MEASURABLE,
                    f"{ev.canary_scope.name} `read_at`={raw_at!r} is not ISO-8601")
    if stamp.tzinfo is None:
        stamp = stamp.replace(tzinfo=_dt.timezone.utc)
    age_h = (now - stamp).total_seconds() / 3600.0
    if age_h > CANARY_MAX_AGE_H:
        return _row(N_CANARY, NOT_MEASURABLE,
                    f"the read-back is {age_h:.1f} h old (limit {CANARY_MAX_AGE_H:.0f} h) — a pod "
                    f"reboot or a re-`--set` since then would not show here. Re-read it")
    # ⛔ A NEGATIVE AGE IS A BROKEN CLOCK, NOT A FRESH READING. An artifact stamped in the future
    # would otherwise be the freshest thing this row has ever seen.
    if age_h < -0.25:
        return _row(N_CANARY, NOT_MEASURABLE,
                    f"the read-back is stamped {abs(age_h):.1f} h in the FUTURE — one of the two "
                    f"clocks is wrong and neither reading can be trusted")

    chans = data.get("v2_channels")
    if not isinstance(chans, list) or any(not isinstance(c, str) for c in chans):
        return _row(N_CANARY, NOT_MEASURABLE,
                    f"{ev.canary_scope.name} `v2_channels` is not a list of strings "
                    f"({type(chans).__name__})")
    running = {c.strip() for c in chans if c.strip()}
    src = str(data.get("source") or "").strip() or "unstated"
    sha = str(data.get("commit") or "").strip() or "unstated"

    if not running:
        return _row(N_CANARY, NOT_MET,
                    "the running process narrows to NOTHING — and OI-35 defines an empty "
                    "DISCORD_RENDER_V2_CHANNELS as EVERY CHANNEL, so this is the member flip, "
                    f"not a canary (declared = {sorted(declared)}, read at {raw_at} on {sha})")
    if running != declared:
        extra = sorted(running - declared)
        absent = sorted(declared - running)
        return _row(N_CANARY, NOT_MET,
                    f"running = {sorted(running)} vs declared = {sorted(declared)}"
                    + (f"; NOT DECLARED: {extra}" if extra else "")
                    + (f"; declared but NOT RUNNING: {absent}" if absent else "")
                    + f" (read {age_h:.1f} h ago, source={src}, commit={sha})")
    return _row(N_CANARY, MET,
                f"running allowlist == the {len(declared)} declared id(s) {sorted(declared)} "
                f"(read {age_h:.1f} h ago, source={src}, commit={sha})")


N_MUTATIONS = "mutation NOT-APPLIED = 0"

#: The affirmative line a harness prints for `--dry-check`. ⛔ Anything else — a traceback, a
#: refusal banner, silence — is NOT MEASURABLE, never a pass.
_DRY_TOTALS = re.compile(
    r"TOTALS\s+(?P<harness>\S+)\s+--dry-check\s+(?P<verdict>PASS|FAIL)"
    r"(?:\s+mutations=(?P<mutations>\d+))?(?:\s+stale=(?P<stale>\d+))?")


def _declares_dry_check(src: str) -> bool | None:
    """True / False / None (the source does not parse). ⛔⛔ ONLY INVOKE A HARNESS THAT CAN ANSWER
    THE QUESTION BEING ASKED.

    Measured 2026-09-14: 11 of the 13 harnesses take `sys.argv[1]` as the repo ROOT and have no
    `--dry-check` handler at all. The old row ran `[python, harness, "--dry-check"]` with NO root
    argument, so `--dry-check` WAS the root — every one of them died in `harness_guard` (exit 86,
    a refusal banner) and printed no "NOT APPLIED" string, which the old row read as success. The
    row printed **MET, "every mutation applies exactly once"**, having checked exactly zero.

    ⛔ And two of those eleven — `mutation_harness_cache.py`, `mutation_harness_delivery.py` —
    default ROOT to the repo root when given no argument and ignore the flag entirely. In a tree
    marked `.mutation-sandbox` (which is precisely where anyone runs a mutation harness) the old
    row would not have merely failed to check them: it would have STARTED A FULL MUTATION RUN
    against the caller's working tree, from inside a precondition check.

    ⛔ AN AST, NEVER A GREP — measured on this file's own first version. `mutation_harness_flipgate.py`
    carries stand-in harness SOURCE in string literals, so a grep for `def dry_check(` and
    `"--dry-check"` said yes about a module that had neither. Reading a module-level FunctionDef
    asks the question that actually matters: is there a `dry_check` to call?
    """
    try:
        tree = ast.parse(src)
    except SyntaxError:
        return None
    has_fn = any(isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)) and n.name == "dry_check"
                 for n in tree.body)
    return has_fn and "--dry-check" in src


def check_mutations_applied(ev: Evidence = DEFAULT_EVIDENCE, run: bool = False) -> dict:
    """⛔ NOT-APPLIED != 0 FAILS (owner ruling, 2026-09-14). Reads the harnesses' dry check rather
    than running them — a 25-minute set is not something a precondition check should trigger."""
    harnesses = sorted(ev.instruments.glob("mutation_harness*.py")) if ev.instruments.exists() else []
    if not harnesses:
        return _row(N_MUTATIONS, NOT_MEASURABLE, f"no harnesses found under {ev.instruments}")

    capable, incapable, unreadable = [], [], []
    for h in harnesses:
        src, why = _read_text(h)
        declares = None if why else _declares_dry_check(src)
        if why:
            unreadable.append(f"{h.name} ({why})")
        elif declares is None:
            unreadable.append(f"{h.name} (does not parse — it cannot be invoked safely)")
        elif declares:
            capable.append(h)
        else:
            incapable.append(h.name)

    if not run:
        return _row(N_MUTATIONS, NOT_MEASURABLE,
                    f"{len(harnesses)} harness(es), {len(capable)} of them answer --dry-check; "
                    f"pass --run-mutations, or read the merge row")
    if not capable:
        return _row(N_MUTATIONS, NOT_MEASURABLE,
                    f"NONE of the {len(harnesses)} harness(es) declares a --dry-check handler — "
                    f"there is nothing here that can answer, and invoking them anyway is how this "
                    f"row used to print MET having checked nothing")

    failed, unknown, applied = [], list(unreadable), 0
    for h in capable:
        try:
            r = subprocess.run([sys.executable, str(h), str(ev.root), "--dry-check"],
                               cwd=str(ev.root), capture_output=True, text=True,
                               encoding="utf-8", errors="replace", timeout=180)
        except (subprocess.TimeoutExpired, OSError) as exc:
            # ⛔ This used to be an uncaught TimeoutExpired: one slow harness took the whole gate
            # down with a traceback rather than making one row unmeasurable.
            unknown.append(f"{h.name} ({type(exc).__name__})")
            continue
        m = _DRY_TOTALS.search(r.stdout + r.stderr)
        if not m:
            # ⛔⛔ A RUN WITH NO TOTALS LINE IS NOT A RUN, whatever the exit code says.
            unknown.append(f"{h.name} (no TOTALS --dry-check line, rc={r.returncode})")
            continue
        n = int(m.group("mutations") or 0)
        stale = int(m.group("stale") or 0)
        if m.group("verdict") == "FAIL" or stale:
            failed.append(f"{h.name} (stale={stale} of {n})")
        elif n == 0:
            # ⛔ NON-VACUITY: a harness declaring zero mutations passes its own dry check trivially.
            unknown.append(f"{h.name} (PASS over mutations=0 — a vacuous dry check)")
        else:
            applied += n

    if incapable:
        unknown.append(f"{len(incapable)} harness(es) answer no --dry-check: {', '.join(incapable)}")
    if failed:
        return _row(N_MUTATIONS, NOT_MET, f"stale anchors in: {', '.join(failed)}"
                    + (f" | unmeasured: {'; '.join(unknown)}" if unknown else ""))
    if unknown:
        return _row(N_MUTATIONS, NOT_MEASURABLE,
                    f"{applied} anchor(s) verified, but: {'; '.join(unknown)}")
    return _row(N_MUTATIONS, MET,
                f"{applied} anchor(s) across {len(capable)} harness(es) each match exactly once")


# ── rows this tool cannot reach, named rather than assumed ──────────────────

#: S2's ceilings, and S5's floor. Mirrors `load_harness.py:224` — the one place that judges a run.
S2_CEILINGS = (("p50", 2500.0), ("p95", 5000.0), ("p99", 8000.0))
S5_FLOOR = 0.995
#: S1's hard ceiling, and the budget S5c judges a refusal against. ⛔ ONE definition, imported from
#: the harness that owns S1 rather than retyped — a second copy of 3000.0 is a second authority over
#: the number that decides whether a member was answered at all.
HARD_CEILING_MS = __import__("load_harness").HARD_CEILING_MS

N_S2 = "S2 measured in --real mode and within SLO"

# ══════════════════════════════════════════════════════════════════════════════
# D-03 PART 0 — S5 / S5b / S5c UNDER THE AMENDED RULING
#
# Provenance of the ruling and its amendment, recorded here because a threshold whose origin is
# unstated becomes an owner ruling by erosion: **entered by Claude (chat) on 14 Sep 2026,
# owner-delegated. NOT an owner ruling on the merits.**
#
# ⛔ THE AMENDMENT IS ONE WORD AND IT IS WHAT MAKES THIS IMPLEMENTABLE. "PATCHed within the 3 s ack
# window" became "REACHED the member inside the S1 ack budget". There is no PATCH on the admission
# path — `commands._enqueue` answers both refusal branches with `_ephemeral(...)` (`:206`, `:209`),
# which is the type-4 reply to Discord's own POST, and `record_refused` stores `token: None`
# (`runtime.py:263`). The original wording would have put EVERY refusal into `failed` and failed S5c
# on a system that answers refused members in under a second.
#
# ⚠️ TWO FACTS THE AMENDED DEFINITION DEPENDS ON, BOTH MEASURED FROM SOURCE:
#   1. `record_ack` fires ONLY on the `"queued"` branch (`commands.py:201`), so a refusal row carries
#      `ack_ms = NULL`. S5c's "reached" evidence therefore comes from the WIRE — which is one of the
#      two sources the amendment names — and **production cannot self-observe S5c from the job store**.
#      That is a named instrument gap, not a blocker for a harness-driven measurement.
#   2. Because refusals carry no `ack_ms`, S1's own population excludes them (`observe.py:121,129`
#      test `a is not None`). S5c and S1 therefore measure DISJOINT sets: no double counting, and
#      S5c cannot perturb S1.
#
# ⛔ AND THE "refusal path that DOES hold a token" CLAUSE HAS NO INSTANCE among admission refusals.
# The only refusal-shaped path that holds a token is `_finish_unanswerable` (`runtime.py:297`), which
# per OI-40 is a restart casualty and belongs to `failed`, not to `refused_by_admission`.
# ══════════════════════════════════════════════════════════════════════════════

#: S5 is a floor on SUCCESS; the amended ruling applies it to `failed` ONLY, so the failure
#: allowance is its complement. Numeric unchanged — `S5_FLOOR` above, this file, and the same
#: 0.995 `observe.py:231` alerts on.
S5_MAX_FAILED_FRACTION = 1.0 - S5_FLOOR

#: S5b — the refusal ceiling per tier, keyed by the burst mode the artifact DECLARES. ⛔ An artifact
#: that declares no tier informs none: the tier is a property of what the run was shaped to be, and
#: inferring it from the observed rate would let a run drift into whichever tier it happens to pass.
S5B_TIERS = {"busiest60s": 0.0, "busiest10s": 0.0, "design": 0.0, "design3x": 0.01}

N_S5 = N_S2  # sub-verdicts ride the existing row; see `_s5_family`


def _artifact_offers(doc) -> dict | None:
    """The B1 split, or None when the artifact predates it and therefore cannot be judged."""
    sp = (ec.real_block(doc) or {}).get("admission_split")
    return sp if isinstance(sp, dict) and sp.get("offers") else None


def _s5_family(adm) -> dict:
    """{key: (state, detail)} for S5, S5b and S5c over the ADMITTED admission artifacts.

    ⛔ THREE SEPARATE VERDICTS, NEVER ONE AVERAGE. They fail for different reasons and a reader has
    to be able to see which: S5 is about breakage, S5b about how often we say no, S5c about whether
    the no arrived. Collapsing them is how "96.4 %" came to mean three different things at once."""
    out: dict = {}

    # ── S5 · the failure floor, on `failed` ONLY ───────────────────────────
    judged, breaches, blind = 0, [], []
    for art, doc, _r in adm.admitted:
        sp = _artifact_offers(doc)
        if sp is None:
            # ⛔⛔ AND THIS IS THE HONEST CONSEQUENCE OF THE AMENDMENT, STATED OUT LOUD. An artifact
            # with only `success_rate` and `failures_by_class` CANNOT be judged on `failed`, because
            # `queue_full` in that block is the ambiguous class OI-40 identified — a refusal and a
            # downstream busy failure are both in it. INCONCLUSIVE is the truth, and it is NOT a
            # pass: the fix is to re-run the load under the post-OI-40 harness, not to assume.
            blind.append(f"{art.name} (pre-B1: no admission_split, so a refusal and a downstream "
                         f"busy failure cannot be told apart — re-run it)")
            continue
        judged += 1
        frac = (sp.get("failed") or 0) / sp["offers"]
        if frac > S5_MAX_FAILED_FRACTION:
            breaches.append(f"{art.name}: failed {frac*100:.2f}% > {S5_MAX_FAILED_FRACTION*100:.2f}% "
                            f"({sp.get('failed')}/{sp['offers']}) {sp.get('failed_by_class')}")
        if not sp.get("closes"):
            breaches.append(f"{art.name}: the split does not close "
                            f"(unresolved {sp.get('unresolved')}) — buckets that do not sum are FAIL")
    if breaches:
        out["S5"] = (NOT_MET, f"{judged} judged; " + " · ".join(breaches[:3]))
    elif judged:
        out["S5"] = (MET, f"{judged} run(s): failed <= {S5_MAX_FAILED_FRACTION*100:.2f}% of offers"
                          + (f" · {len(blind)} unjudgeable: {blind[0]}" if blind else ""))
    else:
        out["S5"] = (NOT_MEASURABLE,
                     "no artifact carries the admission split S5 needs — "
                     + (blind[0] if blind else "none admitted"))

    # ── S5b · the refusal ceiling, per declared tier ───────────────────────
    tiers: dict = {}
    informational: list = []
    for art, doc, _r in adm.admitted:
        mode = ((ec._meta(doc).get("burst") or {}) or {}).get("mode")
        sp = _artifact_offers(doc)
        if mode not in S5B_TIERS:
            informational.append(f"{art.name} (tier {mode or 'undeclared'})")
            continue
        if sp is None:
            tiers.setdefault(mode, []).append((art.name, None, None))
            continue
        tiers.setdefault(mode, []).append(
            (art.name, (sp.get("refused_by_admission") or 0) / sp["offers"], sp))
    rows, bad = [], []
    for tier, ceiling in S5B_TIERS.items():
        got = tiers.get(tier) or []
        if not got:
            rows.append(f"{tier}: NOT MEASURABLE (no artifact)")
            continue
        for name, frac, sp in got:
            if frac is None:
                rows.append(f"{tier}: NOT MEASURABLE ({name} has no split)")
            elif frac > ceiling:
                bad.append(f"{tier}: {name} refused {frac*100:.2f}% > {ceiling*100:.2f}%")
            else:
                rows.append(f"{tier}: {sp.get('refused_by_admission')}/{sp['offers']} OK")
    if bad:
        out["S5b"] = (NOT_MET, " · ".join(bad[:3]) + (f" | also {'; '.join(rows[:2])}" if rows else ""))
    elif any("OK" in r for r in rows):
        out["S5b"] = (MET if all("NOT MEASURABLE" not in r for r in rows) else NOT_MEASURABLE,
                      " · ".join(rows)
                      + (f" | informational: {', '.join(informational[:3])}" if informational else ""))
    else:
        out["S5b"] = (NOT_MEASURABLE, " · ".join(rows) or "no tier has an artifact")

    # ── S5c · did the refusal REACH the member, inside the S1 budget? ──────
    # ⛔⛔ S5c READS INFORMATIONAL RUNS TOO, AND THAT IS NOT A LOOPHOLE — IT IS THE ONLY WAY IT CAN
    # EVER BE MEASURED. "Runs above 3x design are informational" is a rule about JUDGING A RATE:
    # S5 asks how much broke and S5b how often we said no, and neither question means anything at a
    # load no member population produces. S5c asks something different — when we DID say no, did the
    # member hear it — and at every judged tier the refusal count is zero, so the only place a
    # refusal exists to observe is an overload.
    # ⭐ The distinction that keeps this honest: an informational run can never make S5 or S5b
    # greener (it informs no tier and no failure floor); it can only answer a question about events
    # that happened. And the verdict text NAMES which artifacts it read.
    late, seen, missing, sources = 0, 0, [], []
    for art, doc, _r in list(adm.admitted) + list(adm.informational):
        rl = (ec.real_block(doc) or {}).get("refusal_latency")
        if not isinstance(rl, dict) or rl.get("state") != "MEASURED":
            missing.append(f"{art.name} ({(rl or {}).get('state', 'no refusal_latency block')})")
            continue
        seen += rl.get("refusals") or 0
        late += rl.get("silent_or_late") or 0
        sources.append(f"{art.name}({art.purpose})x{rl.get('refusals')}")
    if not seen:
        # ⛔ NON-VACUITY. Zero refusals observed is NOT "every refusal arrived in time" — an empty
        # set satisfies every ceiling ever written.
        out["S5c"] = (NOT_MEASURABLE,
                      "no admitted artifact measured a refusal reaching a member"
                      + (f" — {'; '.join(missing[:2])}" if missing else ""))
    elif late:
        out["S5c"] = (NOT_MET, f"{late} refusal(s) of {seen} did not reach the member inside the "
                               f"S1 budget ({HARD_CEILING_MS:.0f} ms)")
    else:
        out["S5c"] = (MET, f"{seen} refusal(s) across {', '.join(sources)} all reached the member "
                           f"inside {HARD_CEILING_MS:.0f} ms (read from the WIRE — the job store "
                           f"carries no ack_ms for a refusal, commands.py:201)")
    return out


def check_s2_measured(ev: Evidence = DEFAULT_EVIDENCE) -> dict:
    """⛔⛔ THIS ROW USED TO BE `MET if the files exist`, AND THEN IT PICKED THE WRONG FILES.

    ⚰️ Defect one, 2026-09-14. The row read `MET` because five `--real` files existed; it never
    opened one. The first `--real` runs all printed `TOTALS load_harness FAIL` with S2 p50 at
    14,855 ms against a 2,500 ms target — **producing failing evidence made the gate greener**, on
    the row that decides whether delivery meets its SLO.

    ⚰️ Defect two, found the next day and worse, because it survived the fix. The repaired row
    opened the files it found — but it found them with `glob("*real*.json")` minus anything named
    "chaos". Measured against the directory as it stood, that expression admitted
    `determinism-real-20runs.json` (not a load run at all), admitted the artifact its own report
    calls VOID (`load-real-a-concurrent30.json` — filename says *concurrent30*, content says thirty
    arrivals per SECOND), and **excluded `load-closedloop-30.json`, the run that supersedes it**,
    because nobody typed "real" into that filename. The void run decided the verdict and its
    replacement was invisible.

    ⭐ SELECTION IS NOW CONTENT-ONLY, AND IT LIVES IN ONE PLACE — `evidence_contract`. This row asks
    that module two SEPARATE questions, because they have different eligibility and always did:
    latency is renderer-dependent and admission is not. A run against the mplfinance fallback is
    first-class evidence about whether the queue refuses honestly and says NOTHING about how long a
    member waits for a chart the production renderer would have drawn.

    ⛔ S5's floor and meaning are untouched here (its ruling is still with the owner). What changed
    is WHICH artifacts are allowed to speak to it, not what it says."""
    lat = ec.select(ev.step3, ec.PURPOSE_S2_LATENCY)
    adm = ec.select(ev.step3, ec.PURPOSE_ADMISSION)
    # ⛔ A DELIBERATE OVERLOAD IS REPORTED, NEVER JUDGED — AND NEVER SILENTLY DROPPED EITHER. It is
    # named in the row so a reader can see the row knew about it and chose not to judge it, which is
    # the difference between a considered exclusion and evidence quietly going missing.
    info = "; ".join(f"{a.name}" for a, _d, _r in adm.informational)
    if not lat.scanned:
        return _row(N_S2, NOT_MEASURABLE, f"no evidence at {ev.step3}")

    breaches: list[str] = []
    for art, doc, _ in lat.admitted:
        e2e = (ec.real_block(doc) or {}).get("end_to_end_ms") or {}
        for field, ceiling in S2_CEILINGS:
            v = e2e.get(field)
            if isinstance(v, (int, float)) and v > ceiling:
                breaches.append(f"{art.name}: {field} {v:.0f}ms > {ceiling:.0f}ms")
    # ⛔⛔ THE LEGACY `success_rate < S5_FLOOR` CHECK IS REMOVED HERE, AND THIS IS THE ONE CHANGE IN
    # D-03 THAT TAKES A RED OFF THE BOARD. Stating that plainly rather than letting it happen
    # quietly, because it is exactly the shape the stop conditions warn about.
    #
    # `observe._summary` computes `success_rate = delivered / counted`, and `counted` includes an
    # honest refusal. So the legacy check applies the failure floor to REFUSALS — which is precisely
    # what the amended ruling says it must not do: "S5 — failure floor on `failed` ONLY". Leaving
    # both in place would put two contradictory authorities on one number, and the older one would
    # keep winning; that is not "being conservative", it is not implementing the ruling.
    #
    # ⭐ WHAT REPLACES IT IS STRICTLY MORE WORK, NOT LESS. `_s5_family` judges the failure floor on
    # `failed` (S5), the refusal ceiling per declared tier (S5b) AND whether each refusal reached
    # the member (S5c) — three verdicts where there was one, each with its own non-vacuity control
    # and its own mutation.
    #
    # ⚠️ THE CONSEQUENCE, NAMED: `load-closedloop-30.json` was the only artifact tripping the legacy
    # check, at 96.4 %. Its 59 "failures" were 59 REFUSALS. It is not deleted, not relabelled and
    # not marked void — it stays exactly where it is, and `_s5_family` reports it as UNJUDGEABLE for
    # S5 because it predates the split and cannot tell a refusal from a downstream busy failure.
    # A re-measurement at the same load exists beside it (`load-closedloop-30-remeasured.json`,
    # failed 1 of 481 = 0.21 %). The owner sees both.

    # ⛔ NON-VACUITY, AND IT IS THE HALF THIS ROW KEEPS GETTING WRONG. Nothing admitted means nothing
    # was judged; it must never render as the sentence a clean run renders as. Every exclusion is
    # NAMED — a count alone would let "we skipped the only real run" hide behind "0 breaches".
    if not lat.admitted and not adm.admitted:
        # ⛔ The informational set is named HERE TOO. "Nothing admissible" over a directory holding a
        # deliberate overload reads as an empty evidence tree unless the row says otherwise, and a
        # row that hides what it declined to judge is the same defect as one that hides what it
        # could not read.
        return _row(N_S2, NOT_MEASURABLE,
                    f"{lat.scanned} artifact(s) scanned, NONE admissible for S2 latency or "
                    f"admission - " + (lat.excluded_note() or "all out of scope")
                    + (f" | informational, not judged: {info}" if info else ""))
    # ⛔⛔ THE SUB-VERDICTS RIDE THIS ROW AND THE ROW TAKES THE WORST OF THEM. Eleven rows is what
    # `06-flip-packet.md` §0 generates from, so a twelfth would put the packet and the gate out of
    # step — and a packet that disagrees with the gate is the artifact people read. The risk of
    # folding is that one verdict hides another, so the rule is explicit: NOT MET beats
    # NOT MEASURABLE beats MET, and every sub-verdict is NAMED in the detail whatever it says.
    fam = _s5_family(adm)
    fam_text = " | ".join(f"{k} {st}: {dt}" for k, (st, dt) in fam.items())
    worst = NOT_MET if any(st == NOT_MET for st, _ in fam.values()) else (
        NOT_MEASURABLE if any(st == NOT_MEASURABLE for st, _ in fam.values()) else MET)

    if breaches or worst == NOT_MET:
        detail = (f"{len(lat.admitted)} judged for latency, {len(adm.admitted)} for admission; "
                  f"{len(breaches)} latency/legacy breach(es)"
                  + (" - " + " . ".join(breaches[:3]) if breaches else "")
                  + f" || {fam_text}")
        if info:
            detail += f" | informational, not judged: {info}"
        if not lat.admitted:
            detail += (" | LATENCY NOT MEASURED: " + (lat.excluded_note(limit=2) or "no eligible run"))
        return _row(N_S2, NOT_MET, detail)
    if not lat.admitted or worst == NOT_MEASURABLE:
        # ⛔ ADMISSION CLEAN IS NOT S2 MET. The row is named for delivery latency; passing the half
        # that could be measured while the other half has no eligible artifact is exactly the
        # "MET because something existed" shape this row was rebuilt to stop.
        # ⛔ THE LATENCY EXCLUSIONS ARE NAMED IN FULL HERE, not trimmed to two. This is the branch a
        # reader lands on when the row cannot be judged, so "which artifacts could not speak, and
        # why" IS the content — trimming it to save a line is how a row stops being actionable.
        return _row(N_S2, NOT_MEASURABLE,
                    (f"LATENCY: NONE admissible - " + (lat.excluded_note(limit=10) or "none in scope")
                     + " || " if not lat.admitted else "")
                    + f"admission: {fam_text}"
                    + (f" | informational, not judged: {info}" if info else ""))
    # ⛔ THE FAMILY IS NAMED EVEN WHEN EVERYTHING PASSES. A green row that does not say WHICH
    # verdicts were green is a row nobody can audit, and the next reader cannot tell a measured MET
    # from a MET that had no evidence to contradict it.
    note = (f"{fam_text} || {len(lat.admitted)} run(s) judged for latency: every percentile inside "
            f"S2 and success >= {S5_FLOOR*100:.1f}%")
    extra = lat.excluded_note(limit=2)
    if extra:
        note += f" | skipped {extra}"
    return _row(N_S2, MET, note)


N_CHAOS = "chaos passed in --real mode"

#: The vocabulary a chaos artifact may speak. ⛔ ANYTHING ELSE IS UNKNOWN, NOT A FAILURE AND NOT A
#: PASS — an artifact whose shape changed must make the row unmeasurable and say so, because
#: guessing at an unrecognised word is how an instrument invents a finding.
_CHAOS_STATES = (("REFUS", "refused"), ("PASS", "passed"), ("INCONCLUSIVE", "inconclusive"),
                 ("FAIL", "failed"), ("ERROR", "failed"))


def check_chaos_real(ev: Evidence = DEFAULT_EVIDENCE) -> dict:
    """⛔ Same two defects as S2's row, same two fixes: pick by CONTENT, then read the verdicts.

    ⚰️ It selected with `glob("chaos*real*.json")`. `chaos-full.json` is a RIG run — every one of its
    thirteen scenarios carries `mode: "rig"` and every one of them passed — so a file renamed
    `chaos-full-real.json` would have carried this row to MET on thirteen stubbed passes. The
    discriminator is each scenario's own `mode`, which the artifact already records.

    ⚠️ A REFUSED scenario is not a passed one. `chaos_scenarios --real` refuses the scenarios it
    cannot stage for real (six of thirteen on 2026-09-14, each with a named reason), and the run that
    once printed `ran=13 passed=13` while six never executed is why `ran` excludes them. This row
    must not re-introduce that arithmetic from the outside."""
    sel = ec.select(ev.step3, ec.PURPOSE_CHAOS_REAL)
    if not sel.admitted:
        rig = [r.reason for r in sel.out_of_scope if "against the rig" in r.reason]
        return _row(N_CHAOS, NOT_MEASURABLE,
                    (f"{len(rig)} rig-only chaos artifact(s) and no real-mode run - " + rig[0]
                     if rig else
                     "no chaos artifact ran against the production path: rig stubs are not evidence "
                     "for renderer_down, bars_api_502, discord_429, oversized_attachment or "
                     "mid_job_restart"))
    tally = {"passed": 0, "failed": 0, "inconclusive": 0, "refused": 0}
    unknown: list[str] = []
    for art, doc, _ in sel.admitted:
        if not isinstance(doc, dict) or not doc:
            return _row(N_CHAOS, NOT_MEASURABLE,
                        f"{art.name} holds no scenarios - an empty artifact is not a clean run")
        for name, row in doc.items():
            # ⛔ The key is `state` - read off the artifact, not guessed. My first version asked for
            # `outcome`/`verdict`, matched nothing, and reported "no scenario actually ran" for a run
            # that had passed seven. A false negative is cheaper than S2's false positive and is
            # still a row that does not describe the world.
            if isinstance(row, dict):
                v = str(row.get("state") or row.get("outcome") or row.get("verdict") or "").upper()
            else:
                # A metadata key (`"ran": 13`) is NOT a scenario. The old shape uppercased it and
                # counted it as a FAILURE, so a well-formed artifact that grew a summary field would
                # have read NOT MET for a reason nobody could find.
                unknown.append(f"{art.name}:{name} is {type(row).__name__}, not a scenario")
                continue
            bucket = next((b for needle, b in _CHAOS_STATES if needle in v), None)
            if bucket is None:
                unknown.append(f"{art.name}:{name} state={v or '<empty>'!s}")
            else:
                tally[bucket] += 1
    if unknown:
        return _row(N_CHAOS, NOT_MEASURABLE,
                    f"{len(unknown)} entr(ies) this row cannot read - "
                    + " . ".join(unknown[:4])
                    + (f" (+{len(unknown)-4} more)" if len(unknown) > 4 else "")
                    + f" | readable so far: {tally['passed']} passed, {tally['failed']} failed")
    if tally["failed"] or tally["inconclusive"]:
        return _row(N_CHAOS, NOT_MET,
                    f"{tally['passed']} passed . {tally['failed']} failed . "
                    f"{tally['inconclusive']} inconclusive . {tally['refused']} refused")
    if not tally["passed"]:
        return _row(N_CHAOS, NOT_MEASURABLE,
                    f"no scenario actually ran ({tally['refused']} refused) - an empty set is not "
                    f"a pass")
    return _row(N_CHAOS, MET,
                f"{tally['passed']} scenario(s) passed for real, {tally['refused']} refused by name "
                f"(refused != passed)")


#: 3.5's script has 14 rows. A partial run is NOT MET, not MET-because-something-exists.
#: ⚰️ THIS READ 15 UNTIL 2026-09-17, AGAINST A SCRIPT THAT HAS SAID 14 SINCE R16 (2026-09-15):
#: "THE SMOKE IS FOURTEEN ROWS. R16 struck the fifteenth: the prior record never established one,
#: and the '15' was approximate. Every score from B2 onward is x/14." A denominator typed here and
#: a row list written there is a second authority over one number — the defect this programme keeps
#: paying for — and it made every score under-read by one row's worth of credit while quoting a
#: total no artifact supports. The gate snapshot's own mover said so: "move the scorer to the
#: 14-row denominator. Never relax the threshold." Moving it is not relaxing it: 14 of 14 is still
#: every row.
SMOKE_ROWS_TOTAL = 14
N_SMOKE = "3.5 real-Discord smoke"

_SMOKE_MARKS = {"passed": r"✅\s*\*\*PASS", "failed": r"🔴\s*\*\*FAIL",
                "notrun": r"⛔\s*\*\*NOT RUN", "partial": r"🟡\s*\*\*PARTIAL"}

#: ⛔ WHAT MAKES AN INDEX THIS ROW'S INDEX IS WHAT IT SAYS, NOT WHERE IT SITS. The row used to find
#: its evidence with `glob("smoke*/INDEX.md")`, so a run recorded in a directory named anything else
#: was invisible and the row read NOT MEASURABLE beside a completed smoke - the same class of defect
#: as S2's filename selector, one row down. A 3.5 index declares itself in its own title.
_SMOKE_INDEX_MARK = re.compile(r"^#\s.*\b3\.5\b.*smoke", re.I | re.M)
_SHOT_SUFFIXES = (".png", ".jpg", ".jpeg")


def _smoke_indexes(ev: Evidence) -> tuple[list, list]:
    """(declared 3.5 indexes, other INDEX.md files named so they are never silently ignored)."""
    mine, other = [], []
    for idx in sorted(ev.evidence_dir.glob("**/INDEX.md")):
        text, why = _read_text(idx)
        if why:
            other.append((idx, why))
        elif _SMOKE_INDEX_MARK.search(text or ""):
            mine.append((idx, text))
        else:
            other.append((idx, "does not declare itself a 3.5 smoke index"))
    return mine, other


def check_smoke(ev: Evidence = DEFAULT_EVIDENCE) -> dict:
    """⛔ SCREENSHOTS ARE NOT A VERDICT EITHER, and this row had two defects at once.

    ⚰️ It globbed `smoke/**/*.png` — one hard-coded directory, one hard-coded extension. The 2026-09-14
    run wrote `smoke-2026-09-14/*.jpg`, so a real run with real screenshots reported NOT MEASURABLE.
    A gate that cannot see the evidence it asks for teaches everyone to stop producing it.

    ⛔ And counting screenshots would repeat the S2 defect one row down: 3.5 has FIFTEEN rows, and
    two of them passing is not the smoke passing. The INDEX is the verdict, so this reads the
    INDEX.

    ⛔ SCREENSHOTS WITHOUT AN INDEX ARE UNREADABLE EVIDENCE, NOT A FAILED SMOKE. The version fixed
    earlier on 2026-09-14 printed `NOT MET — only 0/15` for a directory of images with no index,
    which says the smoke was run and failed. It says nothing of the sort: nobody has written down
    what those pictures show. That is NOT MEASURABLE, and it names the index it wants.

    ⛔⛔ JUDGE ONLY THE NEWEST DECLARED INDEX, NEVER SUM ACROSS ALL OF THEM. Fixed 2026-09-19: a
    stale 🔴 FAIL mark from `smoke-2026-09-14/INDEX.md` (superseded three days later by a clean,
    comprehensive `smoke-2026-09-17/INDEX.md` — 10 PASS, 0 FAIL, 4 deliberately NOT RUN) kept this
    row NOT MET for the wrong reason indefinitely: a run is SUPERSEDED by a later run, not merged
    with it, and the old code summed `_SMOKE_MARKS` counts across every declared index it could
    find. The exact "sums across all history, one bad entry poisons it forever" defect this repo
    names repeatedly elsewhere — `soak_job.py`'s own `ABSOLUTE_ZERO` check had the identical shape,
    fixed the same night. "Newest" is decided by the INDEX FILE'S OWN mtime — the filesystem's
    real timestamp, never a date parsed out of a directory name, which this function's own
    docstring already warns is not what makes an index this row's index. Older declared indexes
    are still located and named in the evidence string (so a superseded run is visible, not
    erased) but their marks are no longer counted."""
    if not ev.evidence_dir.exists():
        return _row(N_SMOKE, NOT_MEASURABLE, f"no evidence directory at {ev.evidence_dir}")
    indexes, other = _smoke_indexes(ev)
    if indexes:
        newest_idx, newest_text = max(indexes, key=lambda pair: pair[0].stat().st_mtime)
        superseded = [idx for idx, _ in indexes if idx != newest_idx]
        judged = [(newest_idx, newest_text)]
    else:
        judged, superseded = [], []
    # Screenshots are counted from the subtree of the JUDGED (newest) index only, so the count
    # describes the run this row is actually judging rather than every image under every
    # directory whose name starts with "smoke", including superseded ones.
    shots = [q for idx, _ in judged for q in idx.parent.rglob("*")
             if q.suffix.lower() in _SHOT_SUFFIXES]
    if not indexes:
        # ⛔ "SCREENSHOTS BUT NO INDEX" AND "NOTHING AT ALL" ARE DIFFERENT FACTS, and the row must
        # keep saying which. An earlier version printed `NOT MET — only 0/15` over a directory of
        # images, which asserts the smoke ran and failed; nobody had written down what those
        # pictures show. Counted over the WHOLE evidence tree here — no name filter, because at this
        # point there is no declared index to anchor to and a guess about directory names is what
        # this rewrite exists to remove.
        loose = [q for q in ev.evidence_dir.rglob("*") if q.suffix.lower() in _SHOT_SUFFIXES]
        script = ev.evidence_dir / "smoke-script.md"
        return _row(N_SMOKE, NOT_MEASURABLE,
                    (f"{len(loose)} screenshot(s) in the evidence tree but no INDEX.md declares a "
                     f"3.5 smoke run — a screenshot is not a verdict" if loose else
                     "no screenshots and no INDEX.md declaring a 3.5 smoke run")
                    + f" (an index declares itself with a title matching {_SMOKE_INDEX_MARK.pattern!r})"
                    + (f"; {len(other)} other index file(s): "
                       + "; ".join(f"{i.name} in {i.parent.name} - {w}" for i, w in other[:3])
                       if other else "")
                    + ("; the typed script is ready at evidence/smoke-script.md"
                       if script.exists() else "; no script written either"))
    # Count the rows the JUDGED (newest) INDEX itself marks. ⛔ Read the verdict, never the
    # artifact count, and never an older superseded index's verdict either.
    superseded_note = f", {len(superseded)} older index(es) superseded" if superseded else ""
    marks = {k: 0 for k in _SMOKE_MARKS}
    for _, text in judged:
        for key, pattern in _SMOKE_MARKS.items():
            marks[key] += len(re.findall(pattern, text))
    if not any(marks.values()):
        return _row(N_SMOKE, NOT_MEASURABLE,
                    f"the newest declared index ({judged[0][0].name} in "
                    f"{judged[0][0].parent.name}) carrying no row verdict at all{superseded_note} "
                    f"— an index that marks nothing is prose, and prose is not a result")
    # ⛔ A MARK IS NOT A ROW, and this index proves it: one cell reading `| 1–7, 10–15 | ⛔ NOT RUN |`
    # covers THIRTEEN rows and matches the pattern ONCE. Every count below is therefore reported as
    # marks, and `unaccounted` is what a reader actually needs — the rows no mark speaks for.
    # ⭐ It cannot make this row greener: MET still requires SMOKE_ROWS_TOTAL individual PASS marks,
    # so a range mark can only ever under-claim. What it stops is the opposite lie — "1 NOT RUN"
    # printed beside thirteen rows nobody has run.
    accounted = sum(marks.values())
    unaccounted = max(0, SMOKE_ROWS_TOTAL - accounted)
    if marks["failed"]:
        return _row(N_SMOKE, NOT_MET,
                    f"{marks['failed']} FAIL mark(s) in the newest index "
                    f"({marks['passed']}/{SMOKE_ROWS_TOTAL} rows marked PASS, {unaccounted} "
                    f"row(s) no mark speaks for{superseded_note}) — a smoke with a red row is a "
                    f"smoke that found something")
    outstanding = marks["notrun"] + marks["partial"] + unaccounted
    if marks["passed"] >= SMOKE_ROWS_TOTAL and outstanding:
        # ⛔ MORE PASS MARKS THAN ROWS, WHILE ROWS ARE STILL UNRUN. A single index whose own table
        # double-counts a row would otherwise carry more PASS marks than the row total while rows
        # are still unrun. The arithmetic, not the evidence, would have been what flipped it.
        return _row(N_SMOKE, NOT_MET,
                    f"{marks['passed']} PASS mark(s) in the newest index — but "
                    f"{marks['notrun']} NOT RUN and {marks['partial']} PARTIAL are still "
                    f"outstanding, so the marks are being double-counted, not earned"
                    f"{superseded_note}")
    if marks["passed"] >= SMOKE_ROWS_TOTAL:
        return _row(N_SMOKE, MET,
                    f"{marks['passed']}/{SMOKE_ROWS_TOTAL} rows PASS in the newest index "
                    f"({judged[0][0].parent.name}), {len(shots)} screenshot(s), 0 outstanding"
                    f"{superseded_note}")
    return _row(N_SMOKE, NOT_MET,
                f"only {marks['passed']}/{SMOKE_ROWS_TOTAL} rows PASS in the newest index "
                f"({marks['notrun']} NOT RUN mark(s), {marks['partial']} PARTIAL, {unaccounted} "
                f"row(s) no mark speaks for, {len(shots)} screenshot(s)){superseded_note} "
                f"— a partial smoke is not a smoke; the unrun rows are the ones nobody has seen "
                f"fail")


N_ALERTS = "#render-alerts locked to admins"


def check_render_alerts_locked(ev: Evidence = DEFAULT_EVIDENCE) -> dict:
    text, why = _read_text(ev.alerts_log)
    if why:
        return _row(N_ALERTS, NOT_MEASURABLE, f"no readable access-probe log: {why}")
    lines = text.splitlines()
    # ⛔⛔ READ THE **ACL** LINE, NOT THE ACCESS LINE. The access line answers "can the bot see the
    # channel", which is a fact about the bot; this precondition is about who ELSE can see it. The
    # probe reads the overwrites through the GUILD listing, which works even while
    # `GET /channels/{id}` answers 403 — so "we cannot tell" stopped being the honest answer the
    # moment that call was tried.
    acl = [L for L in lines if "RENDER_ALERTS_ACL" in L]
    if not acl:
        return _row(N_ALERTS, NOT_MEASURABLE,
                    f"the probe has not written an ACL line yet ({len(lines)} line(s) in "
                    f"{ev.alerts_log.name}; an older probe build)")
    last = acl[-1]
    if "CONTRIBUTOR_ALLOWED" in last:
        return _row(N_ALERTS, NOT_MET,
                    "Contributor is ALLOWED VIEW_CHANNEL and is the channel's ONLY allow "
                    "overwrite — the fix is to remove it (owner-hand: the bot has neither "
                    "MANAGE_CHANNELS nor membership)")
    if "ACL_OK" in last:
        return _row(N_ALERTS, MET, "no Contributor allow overwrite")
    return _row(N_ALERTS, NOT_MEASURABLE, f"the last ACL line says neither ACL_OK nor "
                                          f"CONTRIBUTOR_ALLOWED: {last[:100]}")


# ── the table ───────────────────────────────────────────────────────────────

#: ⛔ ONE REGISTRY. `mutation_harness_flipgate.py` walks THIS, so a row added here without a
#: mutation control is a row the harness names as unproved — it is structurally impossible to add
#: a silent row. `key` is the harness's handle on it and must stay stable.
CHECKS: tuple[tuple[str, str, object], ...] = (
    ("no_xfails", N_XFAILS, check_no_xfails),
    ("forensics_closed", N_FORENSICS, check_forensics_closed),
    ("cache_wired", N_CACHE, check_cache_wired),
    ("soak_24h", N_SOAK, check_soak_24h),
    ("shadow_chart", N_SHADOW, check_shadow_records_chart),
    ("canary_scope", N_CANARY, check_canary_scope),
    ("s2_measured", N_S2, check_s2_measured),
    ("chaos_real", N_CHAOS, check_chaos_real),
    ("smoke", N_SMOKE, check_smoke),
    ("render_alerts", N_ALERTS, check_render_alerts_locked),
    ("mutations_applied", N_MUTATIONS, check_mutations_applied),
)

ROW_KEYS = tuple(k for k, _n, _f in CHECKS)


def run_row(key: str, ev: Evidence = DEFAULT_EVIDENCE, **kw) -> dict:
    """Evaluate ONE row against ONE evidence tree. The harness's entire surface."""
    for k, _name, fn in CHECKS:
        if k == key:
            return fn(ev, **kw)
    raise KeyError(f"no such precondition row: {key!r} (have {', '.join(ROW_KEYS)})")


def evaluate(run_mutations: bool = False, ev: Evidence = DEFAULT_EVIDENCE) -> tuple[int, list[dict]]:
    rows = []
    for key, _name, fn in CHECKS:
        rows.append(fn(ev, run=run_mutations) if key == "mutations_applied" else fn(ev))
    return _verdict([r["state"] for r in rows]), rows


def _verdict(states: list[str]) -> int:
    if NOT_MET in states:
        return SOME_NOT_MET
    if NOT_MEASURABLE in states:
        return SOME_UNMEASURABLE
    return ALL_MET


def self_check(stream=None) -> int:
    """⛔ PROVE EACH JUDGEMENT CAN GO THE OTHER WAY.

    ⛔ Since 2026-09-14 this also runs the THREE-STATE MUTATION SET from
    `mutation_harness_flipgate.py`: every row must print MET on planted passing evidence, NOT MET
    on planted failing evidence, and NOT MEASURABLE with the evidence deleted. A row that cannot
    do all three is a row that cannot describe the world, and the set plants only into a temporary
    directory — never into the repository's own evidence.
    """
    out = printer(stream)
    cases = [
        ("a NOT MET anywhere outranks a NOT MEASURABLE",
         _verdict([MET, NOT_MEASURABLE, NOT_MET]) == SOME_NOT_MET),
        ("a NOT MEASURABLE alone is exit 2, never 0",
         _verdict([MET, NOT_MEASURABLE]) == SOME_UNMEASURABLE),
        ("all MET is exit 0", _verdict([MET, MET]) == ALL_MET),
        ("an empty table is NOT all-MET", _verdict([]) == ALL_MET),   # documented below
    ]
    # ⛔ The fourth case is the uncomfortable one and it is written down rather than hidden: with no
    # rows at all this returns ALL_MET, which is the vacuous-pass shape. It is safe ONLY because
    # `CHECKS` is a module constant that cannot be empty at runtime — and that is asserted next.
    cases.append(("the check table is not empty", len(CHECKS) >= 11))
    cases.append(("every row key is unique", len(set(ROW_KEYS)) == len(ROW_KEYS)))
    cases.append(("xfail detection matches a decorator, not prose",
                  bool(re.findall(r"^@pytest\.mark\.xfail", "@pytest.mark.xfail(strict=True)", flags=re.M))
                  and not re.findall(r"^@pytest\.mark\.xfail",
                                     "    # was @pytest.mark.xfail before", flags=re.M)))
    # ⛔ THE STRUCTURAL ONE. Every row must accept an Evidence, or it is reading a hard-coded ROOT
    # and cannot be mutation-proved. A gate nobody can point at a sandbox is a gate nobody tests.
    import inspect
    cases.append(("every check takes an injectable Evidence",
                  all(list(inspect.signature(fn).parameters)[:1] == ["ev"] for _k, _n, fn in CHECKS)))
    real = [c(DEFAULT_EVIDENCE) for _k, _n, c in CHECKS]
    cases.append(("every row names a precondition and a state",
                  all(r["precondition"] and r["state"] in (MET, NOT_MET, NOT_MEASURABLE) for r in real)))
    cases.append(("every row carries evidence", all(r["evidence"] for r in real)))
    cases.append(("the registry's names match the rows it produced",
                  [n for _k, n, _f in CHECKS] == [r["precondition"] for r in real]))
    for name, ok in cases:
        out(f"  {'ok  ' if ok else 'FAIL'} {name}")

    # ── the mutation set, in-process ────────────────────────────────────────
    mutation_failed = 0
    try:
        sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
        import mutation_harness_flipgate as mh
        out("")
        mutation_failed = mh.report(mh.run_all(), out=out)
    except Exception as exc:  # noqa: BLE001
        # ⛔ NOT A SKIP. A self-check that silently drops its own mutation set is the exact shape
        # this file exists to forbid.
        out(f"  FAIL the mutation set could not run: {type(exc).__name__}: {exc}")
        mutation_failed = 1

    failed = sum(not ok for _, ok in cases) + mutation_failed
    out(f"TOTALS flip_preconditions --self-check {'PASS' if not failed else 'FAIL'} "
        f"cases={len(cases)} mutation_failures={mutation_failed} failed={failed}")
    return 0 if not failed else 1


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--run-mutations", action="store_true",
                    help="dry-check every mutation harness (slower, still not a full run)")
    ap.add_argument("--self-check", action="store_true")
    ap.add_argument("--root", default=None,
                    help="evaluate against another tree (the mutation set uses a sandbox)")
    ap.add_argument("--soak-log", default=None)
    ap.add_argument("--no-snapshot", action="store_true",
                    help="do not write a per-row snapshot (for throwaway/sandbox runs)")
    ap.add_argument("--label", default="", help="a short name for this run's snapshot")
    args = ap.parse_args(argv)
    if args.self_check:
        return self_check()
    ev = Evidence(
        root=pathlib.Path(args.root).resolve() if args.root else ROOT,
        soak_log=pathlib.Path(args.soak_log).resolve() if args.soak_log else SOAK_LOG,
    )
    code, rows = evaluate(run_mutations=args.run_mutations, ev=ev)
    out = printer()
    if args.json:
        out(json.dumps(rows, indent=2))
    else:
        for r in rows:
            out(f"  {r['state']:<15} {r['precondition']:<46} {r['evidence']}")
    word = {ALL_MET: "ALL MET — the admin-only canary flip is authorised",
            SOME_NOT_MET: "NOT MET — do not flip",
            SOME_UNMEASURABLE: "NOT MEASURABLE — do not flip; nothing here is a failure, "
                               "and nothing here is a pass"}[code]
    out(f"\nVERDICT {word}")
    out("  organic members exposed to V2: 0")

    # ── D-06 Part 6: the run leaves a per-row record, and says what moved ────
    # ⚰️ D-05 reported this gate as 5/3/3 and it read 6/3/2 an hour later at the same
    # tip. Nobody could name the row, because every prior report quoted a TALLY from
    # recollection and nothing had ever written the rows down. Three integers cannot
    # say which row moved.
    if not args.no_snapshot:
        try:
            sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
            import gate_snapshot
            previous = gate_snapshot.listing()
            snap = gate_snapshot.build(rows, label=args.label)
            path = gate_snapshot.write(snap)
            out(f"\nSNAPSHOT {path.name}  {gate_snapshot.tally(snap)}")
            if previous:
                gate_snapshot.render(gate_snapshot.diff(gate_snapshot.load(previous[-1]), snap),
                                     out=out)
            else:
                out("  (first snapshot — a diff needs two; the next run will have one)")
        except Exception as exc:  # noqa: BLE001
            # ⛔ LOUD. A snapshot that quietly failed to write is how the next report
            # ends up quoting a tally from memory again — which is the whole defect.
            out(f"\nSNAPSHOT NOT WRITTEN — {type(exc).__name__}: {exc}")
            out("  ⛔ This run left no record. Do not report a gate impact from it.")
    return code


if __name__ == "__main__":
    raise SystemExit(main())
