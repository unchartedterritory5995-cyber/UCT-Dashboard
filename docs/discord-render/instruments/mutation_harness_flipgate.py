"""Mutation proofs for the FLIP GATE ITSELF — three states per row, not two.

    python docs/discord-render/instruments/mutation_harness_flipgate.py
    python docs/discord-render/instruments/flip_preconditions.py --self-check   # runs this set
    pytest tests/test_flip_gate_cannot_lie.py                                   # and so does this

⛔⛔ WHY THIS HARNESS IS NOT LIKE THE OTHERS
    Every other `mutation_harness*.py` breaks a line of PRODUCT source and asserts a rail goes
    red. This one breaks EVIDENCE and asserts the GATE changes its verdict, because the thing
    under test is an instrument and the way an instrument fails is by describing a world that
    is not there.

⚰️ THE DEFECT IT EXISTS TO MAKE IMPOSSIBLE. `check_s2_measured` was

        MET if list(glob("*real*.json")) else NOT_MEASURABLE

    It counted files and never opened one. The first `--real` runs in the programme's history all
    printed `TOTALS load_harness FAIL` — and the row flipped from NOT MEASURABLE to **MET**,
    because five files now existed. Producing failing evidence made the gate greener. Two sibling
    rows had the identical shape. A single mutation control — "plant a FAIL, assert NOT MET" —
    would have caught all three on the day they were written.

⛔⛔ AND THE CONTROL THAT CATCHES THE OPPOSITE MISTAKE. A row hard-coded to `return NOT_MET`
    passes every "plant a failure" case in this file and is exactly as useless as the row that
    counted files. So EVERY row is proved in THREE states:

        (a) PASS planted   -> MET             the row can go green at all (non-vacuity)
        (b) FAIL planted   -> NOT MET         the row reads the verdict and it is not the file's name
        (c) evidence gone  -> NOT MEASURABLE  absence is never a pass, and never a failure either

    plus per-row UNREADABLE cases — evidence that exists and cannot be parsed — because
    "we read nothing" and "everything passed" must never render as the same row.

⛔ NOTHING IS PLANTED INTO THE REPOSITORY. Every case builds a COMPLETE passing evidence tree in
    a fresh `tempfile.mkdtemp()`, then breaks exactly one row's artifact in it. That is why
    `flip_preconditions.Evidence` is injectable: an instrument that had to corrupt the real
    evidence directory to test itself would never be tested, and the first person to Ctrl-C it
    would leave a planted failure behind for the integrator to find.

⛔ THE B4 GUARD, AND WHY THIS FILE CALLS ONLY HALF OF IT
    `harness_guard.guard()` is two things: `require_throwaway_worktree` (refuse to run outside a
    sacrificed tree) and `preflight_anchors` (refuse to start on a stale source anchor).
      · The tree guard IS called, from `main()`, because the standing rule is that a file named
        `mutation_harness*.py` refuses to run in the integrator's tree. It is defence in depth
        here and NOT what makes this harness safe — what makes it safe is that it only ever
        writes under `mkdtemp()`. Say that plainly rather than let a marker file take credit.
      · `preflight_anchors` is NOT called, deliberately. It enumerates `MUTATIONS = [...]` entries
        that name a source file and an anchor string; this harness has none, so the preflight
        would enumerate zero controls and refuse with its own VACUOUS verdict (exit 87). A guard
        that fires on a file it was never meant to read is a red that teaches people to override
        guards. `anchor_check` reads this file as contributing 0 controls, which is the truth.
"""
from __future__ import annotations

import datetime as _dt
import json
import pathlib
import shutil
import sys
import tempfile
from dataclasses import dataclass, field
from typing import Callable

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

import flip_preconditions as fp  # noqa: E402

MET, NOT_MET, NOT_MEASURABLE = fp.MET, fp.NOT_MET, fp.NOT_MEASURABLE

PASS_PLANTED, FAIL_PLANTED, EVIDENCE_GONE, UNREADABLE = (
    "PASS planted", "FAIL planted", "evidence deleted", "unreadable evidence")

#: The id the sandbox's flip packet declares. Shaped like a real Discord snowflake (17-20 digits)
#: because the parser is the thing under test — a fake id of the wrong LENGTH would prove nothing.
CANARY_ID = "1549129739048853544"
OTHER_ID = "1400000000000000001"


# ══════════════════════════════════════════════════════════════════════════════
# 1. The passing tree. Every case starts from this and breaks exactly one thing.
# ══════════════════════════════════════════════════════════════════════════════

def _w(path: pathlib.Path, text: str) -> pathlib.Path:
    """⛔ LF, always, and never `open('w')` on a path that might already hold something."""
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(text.encode("utf-8"))
    return path


FAKE_HARNESS_PASS = '''"""A stand-in harness whose only job is to answer --dry-check."""
import sys


def dry_check():
    print("TOTALS mutation_harness_sandbox --dry-check PASS mutations=3 stale=0")
    return 0


if "--dry-check" in sys.argv:
    raise SystemExit(dry_check())
raise SystemExit("this stand-in never mutates anything")
'''

FAKE_HARNESS_FAIL = FAKE_HARNESS_PASS.replace(
    "--dry-check PASS mutations=3 stale=0", "--dry-check FAIL mutations=3 stale=2")

#: ⛔ THE HARNESS THAT CANNOT ANSWER. 11 of the 13 real harnesses look like this: `sys.argv[1]` is
#: the repo ROOT and there is no `--dry-check` handler anywhere. Invoking one with the flag made it
#: die in harness_guard printing a refusal banner — no "NOT APPLIED" string — which the old row
#: read as SUCCESS.
FAKE_HARNESS_NO_DRYCHECK = '''import sys
from pathlib import Path
ROOT = Path(sys.argv[1]).resolve()
raise SystemExit("would have mutated files under " + str(ROOT))
'''

FAKE_HARNESS_SILENT = '''import sys


def dry_check():
    print("checked some things")   # --dry-check but NO TOTALS line
    return 0


if "--dry-check" in sys.argv:
    raise SystemExit(dry_check())
'''

#: ⛔ A 3.5 INDEX DECLARES ITSELF IN ITS OWN TITLE. The row used to find its evidence by directory
#: name; it now reads the document. A fixture whose title does not declare the smoke is not a
#: "minimal" fixture — it is a different case (an undeclared index), and there is a dedicated case
#: for that below.
SMOKE_TITLE = "# 3.5 — the real-Discord smoke (sandbox)\n\n"


def labelled_load(*, real=None, model=fp.ec.CLOSED_LOOP, renderer=fp.ec.RENDERER_PRODUCTION,
                  purpose=fp.ec.PURPOSE_SLO,
                  concurrency=30, arrival_rate=None, stats_n=400, **meta_over) -> dict:
    """A load artifact wearing the labels `evidence_contract` requires, for varying one at a time.

    ⛔ THE POINT OF THE DEFAULTS IS THAT A MUTATION CHANGES EXACTLY ONE THING. Every case that wants
    to prove "an unlabelled model is refused" or "the fallback renderer cannot answer S2" overrides
    that ONE key; everything else stays admissible, so a red case cannot be red for a second reason
    nobody noticed (`lesson_mutations_can_cancel_each_other`)."""
    meta = {"kind": fp.ec.KIND_LOAD, "model": model, "renderer": renderer, "purpose": purpose,
            "concurrency": concurrency, "arrival_rate": arrival_rate, "seconds": 20.0,
            "mode": "real", "delivery": "none"}
    meta.update(meta_over)
    doc = {"meta": meta, "stats": {"n": stats_n, "p50": 1.0, "p95": 2.0, "p99": 3.0,
                                   "over_1s": 0, "over_3s": 0}}
    if real is not None:
        doc["real"] = real
    return doc


def plant_passing_tree(root: pathlib.Path, soak_dir: pathlib.Path,
                       now: _dt.datetime | None = None) -> fp.Evidence:
    """A sandbox in which EVERY row should read MET. If this drifts, every case here is a lie."""
    now = now or _dt.datetime.now(_dt.timezone.utc)

    # no_xfails — real tests, no xfail decorator, plus prose that MENTIONS xfail (the row must
    # match the decorator form only; this is the false-positive control for its regex).
    _w(root / "tests" / "test_discord_render_forensics.py",
       "# this file used to carry an @pytest.mark.xfail and no longer does\n"
       "def test_c01_named_failure():\n    assert True\n\n"
       "async def test_c02_ack_deadline():\n    assert True\n")

    # forensics_closed — every class row carries a closure marker and a commit
    _w(root / "docs" / "discord-render" / "01-failure-forensics.md",
       "# 01\n\n| Class | State |\n|---|---|\n"
       "| **C-01** | ✅ closed `abc1234` |\n"
       "| **C-02** | ✅ closed `def5678` |\n")

    # cache_wired — the import form that the AST must see through an alias
    _w(root / "api" / "services" / "discord_render" / "adapters" / "bindings.py",
       "from ..artifact_cache import artifact_cache\n\n"
       "def bind():\n    return artifact_cache\n")

    # soak_24h — exactly enough clean ticks for the 24 h window
    soak = soak_dir / "soak.log"
    _w(soak, "".join(f"tick {i} TOTALS soak_job PASS rss=100\n"
                     for i in range(fp.SOAK_TICKS_FOR_24H)))

    # shadow_chart — a rail that drives the real route with a real signature
    _w(root / "tests" / "test_discord_render_shadow_reaches_chart.py",
       '"""Gap 3 rail."""\n'
       "def test_every_command_that_reaches_the_route_produces_a_shadow_record():\n"
       '    client.post("/api/discord/interactions", headers={"X-Signature-Ed25519": sig},\n'
       '                content=json.dumps({"data": {"name": "chart"}}))\n')

    # canary_scope — the packet DECLARES one id, the read-back says the process is running it
    _w(root / "docs" / "discord-render" / "06-flip-packet.md",
       "# 06\n\n| `DISCORD_RENDER_V2_CHANNELS=<canary id>` | a PLACEHOLDER, not a declaration |\n"
       "```sh\n"
       f'railway variables --service web --set "DISCORD_RENDER_V2_CHANNELS={CANARY_ID}"\n'
       "```\n")
    _w(root / "docs" / "discord-render" / "evidence" / "canary-scope.json",
       json.dumps({"read_at": now.strftime("%Y-%m-%dT%H:%M:%SZ"), "source": "in-process",
                   "v2_channels": [CANARY_ID], "commit": "0123456789ab"}, indent=2) + "\n")

    # s2_measured — one --real run, every percentile inside its ceiling.
    # ⛔ IT CARRIES ITS LABELS. Since D-02 the row selects on CONTENT through `evidence_contract`, so
    # a fixture without `meta.model` / `meta.renderer` is not a weaker passing run — it is an
    # artifact the row is RIGHT to refuse, and a base sandbox built that way would make every case
    # below read NOT MEASURABLE for a reason that has nothing to do with the mutation.
    _w(root / "docs" / "discord-render" / "evidence" / "step3" / "load-real-a.json",
       json.dumps(labelled_load(
           real={"end_to_end_ms": {"p50": 120.0, "p95": 900.0, "p99": 1800.0},
                 "jobs": 40, "success_rate": 1.0, "failures_by_class": {}}), indent=2))

    # chaos_real — scenarios that state their own verdict AND their own mode, including a refusal
    # (refused ≠ passed). `mode` is what tells a real run from a rig run; the filename never did.
    _w(root / "docs" / "discord-render" / "evidence" / "step3" / "chaos-real.json",
       json.dumps({"renderer_down": {"state": "pass", "mode": "real"},
                   "bars_api_502": {"state": "pass", "mode": "real"},
                   "flow_worker_unreachable": {"state": "refused", "mode": "real"}}, indent=2))

    # smoke — an INDEX that DECLARES ITSELF and marks all fifteen rows PASS, nothing outstanding
    _w(root / "docs" / "discord-render" / "evidence" / "smoke-sandbox" / "INDEX.md",
       SMOKE_TITLE + "".join(f"| {i} | step | ✅ **PASS** | shot{i}.jpg |\n"
                             for i in range(1, fp.SMOKE_ROWS_TOTAL + 1)))
    _w(root / "docs" / "discord-render" / "evidence" / "smoke-sandbox" / "shot1.jpg", "not-a-jpeg")

    # render_alerts — the ACL line, which is the one the row reads
    _w(soak_dir / "render-alerts-access.log",
       "2026-09-14T10:00Z RENDER_ALERTS_ACCESS HTTP 200\n"
       "2026-09-14T11:00Z RENDER_ALERTS_ACL ACL_OK overwrites=2\n")

    # mutations_applied — one stand-in harness that answers --dry-check affirmatively
    _w(root / "docs" / "discord-render" / "instruments" / "mutation_harness_sandbox.py",
       FAKE_HARNESS_PASS)

    return fp.Evidence(root=root, soak_log=soak)


# ══════════════════════════════════════════════════════════════════════════════
# 2. The cases. Each `break_it` receives the already-passing sandbox.
# ══════════════════════════════════════════════════════════════════════════════

@dataclass
class Case:
    key: str
    kind: str
    expect: str
    why: str
    break_it: Callable[[pathlib.Path, pathlib.Path], None] | None = None
    kwargs: dict = field(default_factory=dict)
    #: A substring the evidence sentence must contain, so a row cannot reach the right STATE for
    #: the wrong reason. ⛔ An identity join is not a correctness check.
    says: str = ""


def _rm(p: pathlib.Path) -> None:
    if p.is_dir():
        shutil.rmtree(p)
    elif p.exists():
        p.unlink()


def _cases() -> list[Case]:
    D = "docs/discord-render"
    cs: list[Case] = []

    def three(key: str, artifact: str, break_fail, why_fail: str, says_fail: str = "",
              says_gone: str = "", **kwargs):
        """(a) MET on the passing tree · (b) NOT MET on a planted failure · (c) gone -> unmeasurable."""
        cs.append(Case(key, PASS_PLANTED, MET, "the planted passing tree", None, kwargs))
        cs.append(Case(key, FAIL_PLANTED, NOT_MET, why_fail, break_fail, kwargs, says_fail))
        cs.append(Case(key, EVIDENCE_GONE, NOT_MEASURABLE, f"{artifact} deleted",
                       lambda r, s, a=artifact: _rm((s if a.startswith("<soak>") else r)
                                                    / a.replace("<soak>/", "")),
                       kwargs, says_gone))

    # ── no_xfails ──────────────────────────────────────────────────────────
    three("no_xfails", "tests/test_discord_render_forensics.py",
          lambda r, s: _w(r / "tests" / "test_discord_render_forensics.py",
                          "import pytest\n@pytest.mark.xfail(strict=True)\n"
                          "def test_c01_named_failure():\n    assert False\n"),
          "an xfail decorator on a programme feature", says_fail="1 xfail decorator",
          says_gone="is missing")
    cs.append(Case("no_xfails", UNREADABLE, NOT_MEASURABLE,
                   "the suite exists but declares NO tests — a vacuous 'zero xfails'",
                   lambda r, s: _w(r / "tests" / "test_discord_render_forensics.py",
                                   "# every test was deleted in a bad merge\n"),
                   says="declares NO tests"))

    # ── forensics_closed ───────────────────────────────────────────────────
    three("forensics_closed", f"{D}/01-failure-forensics.md",
          lambda r, s: _w(r / D / "01-failure-forensics.md",
                          "| **C-01** | ✅ closed `abc1234` |\n| **C-02** | 🔴 open |\n"),
          "a class row that is not closed", says_fail="still open", says_gone="is missing")
    cs.append(Case("forensics_closed", UNREADABLE, NOT_MEASURABLE,
                   "a table with no `| **C-` rows at all — the old shape printed MET on '0/0'",
                   lambda r, s: _w(r / D / "01-failure-forensics.md", "# 01\n\nnothing here yet\n"),
                   says="no `| **C-` rows"))
    cs.append(Case("forensics_closed", UNREADABLE, NOT_MEASURABLE,
                   "a row carrying no closure marker of any kind",
                   lambda r, s: _w(r / D / "01-failure-forensics.md",
                                   "| **C-01** | ✅ closed `abc1234` |\n| **C-02** | reworded |\n"),
                   says="no closure marker"))

    # ── cache_wired ────────────────────────────────────────────────────────
    three("cache_wired", "api/services/discord_render/adapters/bindings.py",
          lambda r, s: _w(r / "api/services/discord_render/adapters/bindings.py",
                          "# the cache is built, and nothing on the hot path calls it\n"
                          "def bind():\n    return None\n"),
          "built but unwired — the failure this programme has shipped twice",
          says_fail="no importer", says_gone="is missing")
    cs.append(Case("cache_wired", UNREADABLE, NOT_MEASURABLE,
                   "bindings.py mid-edit: the old shape crashed the WHOLE gate with a traceback",
                   lambda r, s: _w(r / "api/services/discord_render/adapters/bindings.py",
                                   "def bind(:\n    artifact_cache\n"),
                   says="does not parse"))

    # ── soak_24h ───────────────────────────────────────────────────────────
    three("soak_24h", "<soak>/soak.log",
          lambda r, s: _w(s / "soak.log",
                          "".join(f"tick {i} TOTALS soak_job PASS\n" for i in range(80))
                          + "tick 80 TOTALS soak_job FAIL rss grew 40MB\n"),
          "a non-PASS tick inside the window", says_fail="non-PASS tick",
          says_gone="no readable soak log")
    cs.append(Case("soak_24h", UNREADABLE, NOT_MEASURABLE,
                   "a log with lines but no TOTALS verdict — no TOTALS line is not a run",
                   lambda r, s: _w(s / "soak.log", "starting up\nconnected\nstill here\n"),
                   says="carries no `TOTALS soak_job` line"))

    # ── shadow_chart ───────────────────────────────────────────────────────
    three("shadow_chart", "tests/test_discord_render_shadow_reaches_chart.py",
          lambda r, s: _w(r / "tests/test_discord_render_shadow_reaches_chart.py",
                          "def test_shadow_emits():\n"
                          "    observe.observe_ack(cmd='chart')   # never touches the route\n"),
          "a rail that calls the emitter directly and no longer drives the route",
          says_fail="drives the real route", says_gone="quiet Monday")
    cs.append(Case("shadow_chart", UNREADABLE, NOT_MET,
                   "⛔ the old row's exact defect: a file that EXISTS and declares no tests",
                   lambda r, s: _w(r / "tests/test_discord_render_shadow_reaches_chart.py", "\n"),
                   says="declares NO tests"))

    # ── canary_scope ───────────────────────────────────────────────────────
    scope = f"{D}/evidence/canary-scope.json"
    three("canary_scope", scope,
          lambda r, s: _w(r / scope, json.dumps(
              {"read_at": _now_iso(), "source": "in-process",
               "v2_channels": [CANARY_ID, OTHER_ID], "commit": "abc"})),
          "the running allowlist carries an id the packet never declared",
          says_fail="NOT DECLARED", says_gone="is missing")
    cs.append(Case("canary_scope", FAIL_PLANTED, NOT_MET,
                   "⛔⛔ THE DANGEROUS STATE: an EMPTY allowlist, which OI-35 defines as EVERY "
                   "channel — the member flip wearing a canary's label",
                   lambda r, s: _w(r / scope, json.dumps(
                       {"read_at": _now_iso(), "source": "in-process", "v2_channels": [],
                        "commit": "abc"})),
                   says="narrows to NOTHING"))
    cs.append(Case("canary_scope", UNREADABLE, NOT_MEASURABLE,
                   "a read-back older than 24 h — a pod reboot since then would not show",
                   lambda r, s: _w(r / scope, json.dumps(
                       {"read_at": _now_iso(-26), "source": "in-process",
                        "v2_channels": [CANARY_ID], "commit": "abc"})),
                   says="h old (limit 24 h)"))
    cs.append(Case("canary_scope", UNREADABLE, NOT_MEASURABLE,
                   "a read-back that is not JSON",
                   lambda r, s: _w(r / scope, "{v2_channels: oops"),
                   says="not readable JSON"))
    cs.append(Case("canary_scope", UNREADABLE, NOT_MEASURABLE,
                   "a read-back with no `read_at` — indistinguishable from one taken last week",
                   lambda r, s: _w(r / scope, json.dumps({"v2_channels": [CANARY_ID]})),
                   says="carries no `read_at`"))
    cs.append(Case("canary_scope", UNREADABLE, NOT_MEASURABLE,
                   "the packet declares only the `<canary id>` PLACEHOLDER",
                   lambda r, s: _w(r / D / "06-flip-packet.md",
                                   "`DISCORD_RENDER_V2_CHANNELS=<canary id>` then enable\n"),
                   says="placeholder"))

    # ── s2_measured ────────────────────────────────────────────────────────
    s2 = f"{D}/evidence/step3/load-real-a.json"
    three("s2_measured", s2,
          lambda r, s: _w(r / s2, json.dumps(labelled_load(
              real={"end_to_end_ms": {"p50": 14854.7, "p95": 18117.2, "p99": 18836.4},
                    "jobs": 139, "success_rate": 0.3571,
                    "failures_by_class": {"queue_full": 81}}))),
          "⚰️ THE REAL 2026-09-14 NUMBERS — the run whose existence used to make the row MET",
          says_fail="p50 14855ms > 2500ms", says_gone="NONE admissible")
    cs.append(Case("s2_measured", UNREADABLE, NOT_MEASURABLE,
                   "a run that states jobs but NO percentile — 'nothing exceeded the ceiling' is "
                   "not 'nothing was measured'",
                   lambda r, s: _w(r / s2, json.dumps(labelled_load(
                       real={"end_to_end_ms": {"over_15s": 3}, "jobs": 10,
                             "success_rate": None}))),
                   says="NONE admissible"))
    cs.append(Case("s2_measured", UNREADABLE, NOT_MEASURABLE,
                   "a --real artifact that is not JSON",
                   lambda r, s: _w(r / s2, "TOTALS load_harness FAIL\n"),
                   says="unreadable"))
    # ── s2_measured · the D-02 selector class ──────────────────────────────
    # ⛔ FOUR CASES THE OLD FILENAME SELECTOR COULD NOT HAVE FAILED, because it never opened a label.
    cs.append(Case("s2_measured", UNREADABLE, NOT_MEASURABLE,
                   "⚰️ THE VOID ARTIFACT. Marked void in its own file, it must be SKIPPED, COUNTED "
                   "and NAMED — the real one decided this row for a day",
                   lambda r, s: _w(r / s2, json.dumps(labelled_load(
                       real={"end_to_end_ms": {"p50": 14854.7, "p95": 18117.2, "p99": 18836.4},
                             "jobs": 139, "success_rate": 0.3571,
                             "failures_by_class": {"queue_full": 81}},
                       void=True, void_reason="an open loop at 30 arrivals/second",
                       superseded_by="load-closedloop-30.json"))),
                   says="1 void"))
    cs.append(Case("s2_measured", UNREADABLE, NOT_MEASURABLE,
                   "⛔ renderer=fallback — eligible for admission, INCONCLUSIVE for latency, and "
                   "the row must say WHY",
                   lambda r, s: _w(r / s2, json.dumps(labelled_load(
                       renderer=fp.ec.RENDERER_FALLBACK,
                       real={"end_to_end_ms": {"p50": 120.0, "p95": 900.0, "p99": 1800.0},
                             "jobs": 40, "success_rate": 1.0, "failures_by_class": {}}))),
                   says="renderer=fallback; needs chart-renderer"))
    cs.append(Case("s2_measured", UNREADABLE, NOT_MEASURABLE,
                   "⛔ no load model — `rate` alone cannot distinguish arrivals/second from "
                   "concurrency, and for a whole programme nobody could tell which they were reading",
                   lambda r, s: _w(r / s2, json.dumps(labelled_load(
                       model=None, concurrency=None, rate=30.0,
                       real={"end_to_end_ms": {"p50": 120.0, "p95": 900.0, "p99": 1800.0},
                             "jobs": 40, "success_rate": 1.0, "failures_by_class": {}}))),
                   says="unlabelled load model"))
    # ⛔⛔ A DELIBERATE OVERLOAD IS REPORTED, NEVER JUDGED — and the pair below is what stops that
    # becoming a way out of a red. The first proves a characterisation artifact carrying a breach
    # does NOT redden the row; the second proves the SAME artifact, labelled `slo`, DOES. Without
    # the second, "characterisation" would be a label that excuses any number.
    _breach = {"end_to_end_ms": {"p50": 14854.7, "p95": 18117.2, "p99": 18836.4},
               "jobs": 139, "success_rate": 0.3571, "failures_by_class": {"queue_full": 81}}
    cs.append(Case("s2_measured", UNREADABLE, NOT_MEASURABLE,
                   "a CHARACTERISATION run carrying a breach is reported, not judged",
                   lambda r, s: _w(r / s2, json.dumps(labelled_load(
                       real=_breach, purpose="characterisation"))),
                   says="informational, not judged"))
    cs.append(Case("s2_measured", FAIL_PLANTED, NOT_MET,
                   "⛔ NON-VACUITY: the SAME breach labelled `slo` DOES redden the row — otherwise "
                   "'characterisation' is a label that excuses any number",
                   lambda r, s: _w(r / s2, json.dumps(labelled_load(
                       real=_breach, purpose="slo"))),
                   says="p50 14855ms > 2500ms"))
    cs.append(Case("s2_measured", UNREADABLE, NOT_MEASURABLE,
                   "⛔ a determinism artifact sitting in step3 — the old selector admitted "
                   "`determinism-real-20runs.json` purely because its NAME held the word 'real'",
                   lambda r, s: (_w(r / s2, "") or (r / s2).unlink(),
                                 _w(r / f"{D}/evidence/step3/determinism-real-20runs.json",
                                    json.dumps({"meta": {"fixture": "NVDA", "pinned_now": "x"},
                                                "per_component": {"bars": "identical"},
                                                "runs": 20}))),
                   says="NONE admissible"))

    # ── chaos_real ─────────────────────────────────────────────────────────
    chaos = f"{D}/evidence/step3/chaos-real.json"
    three("chaos_real", chaos,
          lambda r, s: _w(r / chaos, json.dumps(
              {"renderer_down": {"state": "fail", "mode": "real",
                                 "detail": "silence, no named message"},
               "bars_api_502": {"state": "pass", "mode": "real"}})),
          "a scenario that failed for real", says_fail="1 failed", says_gone="rig stubs are not evidence")
    cs.append(Case("chaos_real", UNREADABLE, NOT_MEASURABLE,
                   "every scenario REFUSED — an empty set is not a pass",
                   lambda r, s: _w(r / chaos, json.dumps(
                       {"renderer_down": {"state": "refused", "mode": "real"},
                        "bars_api_502": {"state": "refused", "mode": "real"}})),
                   says="no scenario actually ran"))
    cs.append(Case("chaos_real", UNREADABLE, NOT_MEASURABLE,
                   "a state word the row does not recognise — guessing is how an instrument "
                   "invents a finding",
                   lambda r, s: _w(r / chaos, json.dumps(
                       {"renderer_down": {"state": "degraded-ish", "mode": "real"}})),
                   says="cannot read"))
    cs.append(Case("chaos_real", UNREADABLE, NOT_MEASURABLE,
                   "a summary field beside the scenarios — the old shape scored `ran: 13` as a "
                   "FAILURE",
                   lambda r, s: _w(r / chaos, json.dumps(
                       {"renderer_down": {"state": "pass", "mode": "real"}, "ran": 13})),
                   says="not a scenario"))
    cs.append(Case("chaos_real", UNREADABLE, NOT_MEASURABLE,
                   "⚰️ A RIG RUN RENAMED. Thirteen scenarios, thirteen passes, every one against a "
                   "stub — the old `chaos*real*.json` glob would have carried the row to MET on it",
                   lambda r, s: _w(r / chaos, json.dumps(
                       {f"scenario_{i}": {"state": "pass", "mode": "rig"} for i in range(13)})),
                   says="against the rig"))

    # ── smoke ──────────────────────────────────────────────────────────────
    idx = f"{D}/evidence/smoke-sandbox/INDEX.md"
    three("smoke", idx,
          lambda r, s: _w(r / idx, SMOKE_TITLE
                          + "| 1 | /chart | ✅ **PASS** |\n| 8 | /buzz | 🔴 **FAIL** |\n"),
          "an index with a red row", says_fail="FAIL mark",
          says_gone="a screenshot is not a verdict")
    cs.append(Case("smoke", FAIL_PLANTED, NOT_MET,
                   "2 of 15 rows PASS — a partial smoke is not a smoke",
                   lambda r, s: _w(r / idx, SMOKE_TITLE
                                   + "| 1 | ✅ **PASS** |\n| 5 | 🟡 **PARTIAL** |\n"
                                     "| 2-15 | ⛔ **NOT RUN** |\n"),
                   says="only 1/15"))
    cs.append(Case("smoke", FAIL_PLANTED, NOT_MET,
                   "⛔ fifteen PASS marks spread over two indexes while rows are still NOT RUN — "
                   "the arithmetic flipping the row, not the evidence",
                   lambda r, s: (_w(r / idx, SMOKE_TITLE
                                    + "".join("| n | ✅ **PASS** |\n" for _ in range(8))),
                                 _w(r / D / "evidence/smoke-second/INDEX.md",
                                    SMOKE_TITLE
                                    + "".join("| n | ✅ **PASS** |\n" for _ in range(8))
                                    + "| rest | ⛔ **NOT RUN** |\n")),
                   says="double-counted"))
    cs.append(Case("smoke", UNREADABLE, NOT_MEASURABLE,
                   "an INDEX that marks nothing — prose is not a result",
                   lambda r, s: _w(r / idx, SMOKE_TITLE
                                   + "We ran some things and they looked fine.\n"),
                   says="carrying no row verdict"))
    cs.append(Case("smoke", UNREADABLE, NOT_MEASURABLE,
                   "⚰️ A COMPLETE INDEX IN A DIRECTORY NAMED SOMETHING ELSE. The old row globbed "
                   "`smoke*/INDEX.md`, so it reported NOT MEASURABLE beside a finished run — and "
                   "an index that does not declare itself is still not this row's evidence",
                   lambda r, s: (_w(r / idx, "") or (r / idx).unlink(),
                                 _w(r / D / "evidence/run-2026-09-15/INDEX.md",
                                    "# notes from the session\n\n"
                                    + "".join("| n | ✅ **PASS** |\n"
                                              for _ in range(fp.SMOKE_ROWS_TOTAL)))),
                   says="does not declare itself"))

    # ── render_alerts ──────────────────────────────────────────────────────
    alog = "<soak>/render-alerts-access.log"
    three("render_alerts", alog,
          lambda r, s: _w(s / "render-alerts-access.log",
                          "RENDER_ALERTS_ACCESS HTTP 200\n"
                          "RENDER_ALERTS_ACL CONTRIBUTOR_ALLOWED overwrites=1\n"),
          "Contributor holds an allow overwrite", says_fail="Contributor is ALLOWED",
          says_gone="no readable access-probe log")
    cs.append(Case("render_alerts", UNREADABLE, NOT_MEASURABLE,
                   "an older probe build that writes ACCESS and never ACL — the access line is a "
                   "fact about the BOT, not about who else can see the channel",
                   lambda r, s: _w(s / "render-alerts-access.log",
                                   "RENDER_ALERTS_ACCESS HTTP 200\n"),
                   says="has not written an ACL line"))

    # ── mutations_applied ──────────────────────────────────────────────────
    harn = f"{D}/instruments/mutation_harness_sandbox.py"
    three("mutations_applied", f"{D}/instruments",
          lambda r, s: _w(r / harn, FAKE_HARNESS_FAIL),
          "a harness whose anchors have gone stale", says_fail="stale anchors in",
          says_gone="no harnesses found", run=True)
    cs.append(Case("mutations_applied", UNREADABLE, NOT_MEASURABLE,
                   "⛔⛔ THE OLD ROW'S EXACT DEFECT: a harness with no --dry-check handler. It was "
                   "invoked anyway, died in harness_guard, printed no 'NOT APPLIED' — and the row "
                   "read that silence as success and printed MET having checked nothing",
                   lambda r, s: _w(r / harn, FAKE_HARNESS_NO_DRYCHECK),
                   {"run": True}, says="declares a --dry-check handler"))
    cs.append(Case("mutations_applied", UNREADABLE, NOT_MEASURABLE,
                   "a harness that answers --dry-check and prints no TOTALS line — a run with no "
                   "TOTALS line is not a run, whatever the exit code says",
                   lambda r, s: _w(r / harn, FAKE_HARNESS_SILENT),
                   {"run": True}, says="no TOTALS --dry-check line"))
    cs.append(Case("mutations_applied", UNREADABLE, NOT_MEASURABLE,
                   "a harness declaring mutations=0 — it passes its own dry check trivially",
                   lambda r, s: _w(r / harn, FAKE_HARNESS_PASS.replace(
                       "mutations=3 stale=0", "mutations=0 stale=0")),
                   {"run": True}, says="vacuous dry check"))
    return cs


def _now_iso(offset_hours: float = 0.0) -> str:
    return (_dt.datetime.now(_dt.timezone.utc)
            + _dt.timedelta(hours=offset_hours)).strftime("%Y-%m-%dT%H:%M:%SZ")


# ══════════════════════════════════════════════════════════════════════════════
# 3. Running them
# ══════════════════════════════════════════════════════════════════════════════

@dataclass
class Result:
    case: Case
    got: str
    detail: str
    ok: bool
    note: str = ""


def run_case(case: Case, tmp: pathlib.Path) -> Result:
    root, soak = tmp / "repo", tmp / "soak"
    root.mkdir(parents=True, exist_ok=True)
    soak.mkdir(parents=True, exist_ok=True)
    # ⛔ A linked-worktree marker so the sandbox is never mistaken for the main checkout by
    # anything that walks it. It is a temp dir; nothing here survives the run.
    _w(root / ".git", "gitdir: /nowhere/.git/worktrees/sandbox\n")
    ev = plant_passing_tree(root, soak)
    if case.break_it is not None:
        case.break_it(root, soak)
    row = fp.run_row(case.key, ev, **case.kwargs)
    got, detail = row["state"], row["evidence"]
    ok = got == case.expect
    note = ""
    if ok and case.says and case.says not in detail:
        # ⛔ RAIL THE SENTENCE, NOT JUST THE GUARD. The right state for the wrong reason is how a
        # row passes its control today and stops describing the world tomorrow.
        ok, note = False, f"state ok but the evidence never says {case.says!r}"
    return Result(case, got, detail, ok, note)


def run_all(cases: list[Case] | None = None) -> list[Result]:
    cases = _cases() if cases is None else cases
    out: list[Result] = []
    for case in cases:
        tmp = pathlib.Path(tempfile.mkdtemp(prefix="flipgate-mut-"))
        try:
            out.append(run_case(case, tmp))
        finally:
            shutil.rmtree(tmp, ignore_errors=True)
    return out


def coverage_gaps(cases: list[Case] | None = None) -> list[str]:
    """⛔ NON-VACUITY OF THE HARNESS ITSELF. A row added to `flip_preconditions.CHECKS` without
    all three controls is named here — it is structurally impossible to add a silent row."""
    cases = _cases() if cases is None else cases
    gaps = []
    for key in fp.ROW_KEYS:
        kinds = {c.kind for c in cases if c.key == key}
        missing = {PASS_PLANTED, FAIL_PLANTED, EVIDENCE_GONE} - kinds
        if missing:
            gaps.append(f"{key} has no control for: {', '.join(sorted(missing))}")
    unknown = {c.key for c in cases} - set(fp.ROW_KEYS)
    gaps += [f"case names a row that does not exist: {k}" for k in sorted(unknown)]
    if not cases:
        gaps.append("the case set is EMPTY — a harness that enumerated nothing proved nothing")
    return gaps


def report(results: list[Result], out=None) -> int:
    """Print the table; return the number of failures (0 = the gate cannot lie about any row)."""
    # ⚠️ cp1252 consoles again — every `why` in this file carries ⛔. Reuse the gate's own printer
    # rather than a second copy of it (a guard repeated is a guard unproved).
    out = fp.printer() if out is None else out
    gaps = coverage_gaps()
    for g in gaps:
        out(f"  FAIL coverage {g}")
    width = max((len(r.case.key) for r in results), default=10)
    by_key: dict[str, list[Result]] = {}
    for r in results:
        by_key.setdefault(r.case.key, []).append(r)
    for key in fp.ROW_KEYS:
        for r in by_key.get(key, []):
            flag = "ok  " if r.ok else "FAIL"
            out(f"  {flag} {r.case.key:<{width}} {r.case.kind:<18} "
                f"want={r.case.expect:<15} got={r.got:<15} {r.note or r.case.why[:66]}")
            if not r.ok:
                out(f"       evidence said: {r.detail[:160]}")
    failed = sum(not r.ok for r in results) + len(gaps)
    out(f"TOTALS mutation_harness_flipgate {'PASS' if not failed else 'FAIL'} "
        f"rows={len(fp.ROW_KEYS)} cases={len(results)} failed={failed}")
    return failed


def dry_check(out=None) -> int:
    """The cheap half, in the shape every other harness uses: are the controls still ADDRESSED at
    rows that exist? Nothing is planted and no case is run.

    ⛔ The analogue of a stale anchor here is a control aimed at a row that has been renamed or
    removed — `coverage_gaps` finds both directions, and a control set that enumerated nothing is
    itself a failure, not a clean result.
    """
    out = fp.printer() if out is None else out
    cases = _cases()
    gaps = coverage_gaps(cases)
    for g in gaps:
        out(f"  NOT APPLIED: {g}")
    out(f"TOTALS mutation_harness_flipgate --dry-check {'PASS' if not gaps else 'FAIL'} "
        f"mutations={len(cases)} stale={len(gaps)}")
    return 0 if not gaps else 1


def main(argv=None) -> int:
    argv = sys.argv[1:] if argv is None else argv
    # ⛔ FLAGS ARE NOT PATHS — the defect that made 11 sibling harnesses take `--dry-check` as
    # their repo root and die in the guard, which the old gate row then read as success.
    positional = [a for a in argv if not a.startswith("-")]
    root = pathlib.Path(positional[0]).resolve() if positional else fp.ROOT

    # ⛔ --dry-check plants nothing and runs nothing, so it needs no sandbox and must not demand
    # one: the gate calls it from whatever tree the integrator is standing in.
    if "--dry-check" in argv:
        return dry_check()

    # ⛔ B4 — the tree guard, imported, never copy-pasted. See the module docstring for why only
    # this half of `guard()` is called and why it is NOT what makes this harness safe.
    from harness_guard import require_throwaway_worktree  # noqa: E402
    require_throwaway_worktree(root, pathlib.Path(__file__).name)

    return 1 if report(run_all()) else 0


if __name__ == "__main__":
    raise SystemExit(main())
