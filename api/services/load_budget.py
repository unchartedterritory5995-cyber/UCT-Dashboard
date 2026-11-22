"""How heavy a library indicator is to draw, measured by the server (Studio lane R6).

A member lists an indicator in the public library; other members install it and draw it on many
charts at once. Before a listing is accepted the server measures how much work the indicator does
over one fixed chart, files it in a class a card can show (light, moderate, heavy), and refuses a
listing that is over the library's budget.

THE MEASUREMENT IS A COUNT, NEVER A CLOCK. The engine's headless export
(`app/src/components/chart/engine/headlessCompute.js`, run under a bare `node` by
`tools/headless_work.mjs`) computes the definition over the engine's own seeded 5,000-bar reference
series and answers a deterministic `work` count in the lane's own unit, beside that lane's hard
ceiling. Same definition, same count, on every machine. The budget and the classes are FRACTIONS
OF THAT CEILING (the engine owns the ceiling; this file owns only the fractions), so they move
with it and nothing here retypes an engine number.

WHAT THE WEB POD MEASURES, AND WHAT IT DOES NOT:

  * a FORMULA (`compute.kind == "ast"`): measured here. The formula lane interprets a closed
    table of names; no member-written code runs.
  * a PASTED SCRIPT computed by the runtime lane (`compute.kind == "runtime"`): NOT run here.
    A member's script is run only by the isolated script service; until that measures it, the
    listing says "not measured yet" in words, carries no class and is never refused for load.
  * a formula that also carries a script's run half (`compute.runtimeObjects`,
    `compute.runtimeColours`): the formula half is counted (and refused if it alone is over
    budget), but the run half is not, so the listing says "not measured yet" as well. The run
    half's source is stripped before the document leaves this process.

NEVER A GUESS. A measurement that could not be made because of this server (`node` is missing,
the driver's answer is unreadable) or because the engine refused the document headlessly is
recorded as that, by name, and the listing goes ahead with no class: a missing number refuses
nobody. While the switch is off nothing is measured or recorded at all, and no answer carries a
`load`.

⛔ BUT NOT UNMEASURED BECAUSE IT WAS SLOW OR CROWDED. A run stopped at its time limit, or one
that found no free slot, is not accepted as an unmeasured listing (that would be the way around
the budget): the listing is refused by name (`load-busy`) and the member asks again
(`must_retry`).

One subprocess per measurement, at most `MEASURE_CONCURRENCY` at once in this process, killed at
`MEASURE_TIMEOUT_S`, never retried, with an environment that carries nothing but the search path.
A measurement that finds every slot taken WAITS up to `SLOT_WAIT_S` for one, on the request's own
worker thread, and then answers `busy`: so one listing holds a worker thread for at most
`SLOT_WAIT_S + MEASURE_TIMEOUT_S` seconds (15), and at most `MEASURE_CONCURRENCY` subprocesses
exist at any moment however many members press List at once.
"""
from __future__ import annotations

import json
import logging
import math
import os
import pathlib
import shutil
import subprocess
import threading
from typing import Any, Mapping, Optional

log = logging.getLogger("load_budget")

ROOT = pathlib.Path(__file__).resolve().parents[2]
DRIVER = ROOT / "tools" / "headless_work.mjs"

#: The switch. ⛔ `_ENABLED` suffix: `feature_flag_index.is_gate()` must see it, and
#: `docs/feature_flags.json` carries its ledger entry. Unset is OFF: nothing is measured, no
#: card carries a class, nothing is refused for load. Read on every call, never cached.
FLAG_ENV = "DEFINITION_LOAD_BUDGET_ENABLED"
FLAG_DEFAULT = "0"
_ON_VALUES = ("1", "true", "yes", "on")

#: A listed indicator may use at most this fraction of its lane's hard ceiling. Half: an
#: indicator in the library is drawn by many members on many charts at once, so it must leave
#: as much room as it takes.
PUBLISH_BUDGET_FRACTION = 0.5
#: The classes a card shows, lightest first: the largest fraction of the ceiling each one holds.
#: The last one's bound IS the budget, so every listed indicator has a class.
CLASS_FRACTIONS = (("light", 0.10), ("moderate", 0.25), ("heavy", PUBLISH_BUDGET_FRACTION))
LOAD_CLASSES = tuple(name for name, _ in CLASS_FRACTIONS)

#: The one lane this process measures (see the module header).
MEASURED_KIND = "ast"
RUNTIME_KIND = "runtime"
#: The parts of a formula document that hold a script's run half (`headlessCompute.js` names
#: the same two as `runParts`).
RUN_PARTS = ("runtimeObjects", "runtimeColours")

MEASURE_TIMEOUT_S = 10
MEASURE_CONCURRENCY = 2
SLOT_WAIT_S = 5
#: The child's heap cap, in MB. The reference series is 5,000 bars; a formula needs far less.
NODE_HEAP_MB = 256

# ⚠️ PER-PROCESS STATE (the web pod is one process): at most this many measurements run at once
# here. A second web process would double it.
_SLOTS = threading.BoundedSemaphore(MEASURE_CONCURRENCY)

#: The states a measurement can be in. Only the first carries a class.
MEASURED = "measured"
RUNTIME_LANE = "runtime-lane"          # a pasted script: the script service measures it, not this pod
RUN_PARTS_STATE = "run-parts"          # a formula with a script's run half: only the formula half is counted
ENGINE_REFUSED = "engine-refused"      # the headless compute refused the document, by name (`code`)
UNAVAILABLE = "unavailable"            # no node, a timeout, a bad answer, no free slot
STATES = (MEASURED, RUNTIME_LANE, RUN_PARTS_STATE, ENGINE_REFUSED, UNAVAILABLE)


def enabled() -> bool:
    """`DEFINITION_LOAD_BUDGET_ENABLED` right now."""
    return (os.environ.get(FLAG_ENV, FLAG_DEFAULT) or "").strip().lower() in _ON_VALUES


def budget_of(ceiling: Any) -> Optional[int]:
    """The most work a listed indicator may do, for a lane whose hard ceiling is `ceiling`."""
    if not _count(ceiling) or ceiling <= 0:
        return None
    return int(math.floor(ceiling * PUBLISH_BUDGET_FRACTION))


def class_of(work: Any, ceiling: Any) -> Optional[str]:
    """`light`, `moderate` or `heavy` for a count within the budget; None for a count over it
    (that listing is refused, so it has no class) or for anything that is not a count."""
    if not _count(work) or not _count(ceiling) or ceiling <= 0:
        return None
    for name, fraction in CLASS_FRACTIONS:
        if work <= math.floor(ceiling * fraction):
            return name
    return None


def over_budget(measurement: Any) -> bool:
    """Is this a NUMBER over the budget? Only a count refuses: every other state is False."""
    if not isinstance(measurement, Mapping):
        return False
    work, ceiling = measurement.get("work"), measurement.get("ceiling")
    limit = budget_of(ceiling)
    return bool(_count(work) and limit is not None and work > limit)


#: The two outcomes that mean the measurement could not be MADE in time. A listing is refused on
#: them (by name, `load-busy`) rather than accepted unmeasured: `busy` is every slot taken for
#: `SLOT_WAIT_S`, `timeout` is a run stopped at `MEASURE_TIMEOUT_S`.
RETRY_CODES = ("busy", "timeout")


def must_retry(measurement: Any) -> bool:
    """Could this measurement not be made in time? (Then the listing is refused, to be asked again.)"""
    return bool(isinstance(measurement, Mapping) and measurement.get("state") == UNAVAILABLE
                and measurement.get("code") in RETRY_CODES)


def retry_message(measurement: Mapping) -> str:
    """What the member reads when the measurement could not be made in time."""
    if measurement.get("code") == "timeout":
        return ("This indicator could not be measured within the library's time limit, so it was "
                "not listed. Try again; if it keeps happening, simplify it. It still works on your "
                "own charts and through a link you send.")
    return ("The library is measuring other indicators right now, so this one was not listed. "
            "Try again in a moment. Nothing about your indicator changed.")


def refusal_message(measurement: Mapping) -> str:
    """What the member who pressed List reads when the indicator is over the budget."""
    return ("This indicator is too heavy for the library. Drawing it on the library's test chart "
            "takes {work:,} steps, and a listed indicator may take at most {limit:,}. It still "
            "works on your own charts and through a link you send. Remove a line or simplify a "
            "calculation, then list it again.").format(
                work=int(measurement["work"]), limit=int(budget_of(measurement["ceiling"]) or 0))


def served(measurement: Any) -> Optional[dict]:
    """The `load` field a listing or a share answer carries, or None when there is no
    measurement at all (a listing from before this existed: the card draws nothing).

      {"class": "light" | "moderate" | "heavy", "work": <count>}     measured
      {"class": None, "measured": False}                             not measured yet
    """
    if not isinstance(measurement, Mapping) or measurement.get("state") not in STATES:
        return None
    if measurement.get("state") == MEASURED:
        name = class_of(measurement.get("work"), measurement.get("ceiling"))
        if name is not None:
            return {"class": name, "work": int(measurement["work"])}
    return {"class": None, "measured": False}


def measure(definition: Any) -> Optional[dict]:
    """Measure one stored definition. Never raises.

    ⛔ None while the switch is off: nothing is measured, so nothing is recorded and no answer
    carries a `load` (the listing door is exactly what it was before this existed).

    Otherwise always a state by name, {"state", "lane", "work", "ceiling", "code", "reference"}:
    `work` and `ceiling` are counts only for `measured` and `run-parts`; `code` names an engine
    refusal or why the measurement was unavailable.
    """
    if not enabled():
        return None
    compute = definition.get("compute") if isinstance(definition, Mapping) else None
    kind = compute.get("kind") if isinstance(compute, Mapping) else None
    if kind == RUNTIME_KIND:
        return _answer(RUNTIME_LANE, lane=RUNTIME_KIND)
    if kind != MEASURED_KIND:
        return _answer(UNAVAILABLE, code="lane")
    run_parts = [k for k in RUN_PARTS if compute.get(k)]
    document = _without_run_parts(definition) if run_parts else definition
    got = _run_driver(document)
    if got.get("state") == MEASURED and run_parts:
        got["state"] = RUN_PARTS_STATE
    return got


def measure_row(row: Any) -> Optional[dict]:
    """`measure`, for a STORED row (`user_definitions.get`): the document is measured AS SERVED.

    A stored row does not carry the stamps a member's browser receives (a known-divergence stamp,
    the runtime lane's kill and grading stamps): `runtime_definitions.stamp_served` adds them on
    every serving path. The measurement goes through the same function, so the engine's by-name
    refusals fire here exactly as they would for a member, and a document a member's chart
    refuses is `engine-refused` with that code, never measured as clean.

    ⛔ A pasted script's row is answered before it is stamped: it is never handed to the driver,
    and stamping it would run that lane's own checks for nothing.
    """
    if not enabled():
        return None
    definition = row.get("definition") if isinstance(row, Mapping) else None
    compute = definition.get("compute") if isinstance(definition, Mapping) else None
    if not isinstance(compute, Mapping) or compute.get("kind") != MEASURED_KIND:
        return measure(definition)
    from api.services import runtime_definitions                   # noqa: PLC0415
    served = runtime_definitions.stamp_served(dict(row))
    return measure(served.get("definition"))


# ─── the subprocess ──────────────────────────────────────────────────────────────

def _count(value: Any) -> bool:
    return isinstance(value, int) and not isinstance(value, bool) and value >= 0


def _answer(state: str, *, lane: Optional[str] = None, work: Optional[int] = None,
            ceiling: Optional[int] = None, code: Optional[str] = None,
            reference: Optional[str] = None) -> dict:
    return {"state": state, "lane": lane, "work": work, "ceiling": ceiling, "code": code,
            "reference": reference}


def _without_run_parts(definition: Mapping) -> dict:
    """The document with its script run half removed: that half holds the author's whole script
    and is not computed by the formula lane, so it never leaves this process."""
    compute = {k: v for k, v in definition["compute"].items() if k not in RUN_PARTS}
    return {**definition, "compute": compute}


def _child_env() -> dict:
    """What the child may see: where to find programs, and nothing else of this process's."""
    keep = ("PATH", "SYSTEMROOT", "SystemRoot", "TEMP", "TMP", "HOME")
    return {k: os.environ[k] for k in keep if k in os.environ}


def _run_driver(document: Mapping) -> dict:
    lane = MEASURED_KIND
    node = shutil.which("node")
    if node is None or not DRIVER.is_file():
        return _answer(UNAVAILABLE, lane=lane, code="no-node" if node is None else "no-driver")
    if not _SLOTS.acquire(timeout=SLOT_WAIT_S):
        return _answer(UNAVAILABLE, lane=lane, code="busy")
    try:
        request = json.dumps({"definition": document, "reference": True, "values": False})
        try:
            done = subprocess.run(
                [node, f"--max-old-space-size={NODE_HEAP_MB}", str(DRIVER)],
                input=request, cwd=str(ROOT), env=_child_env(), capture_output=True, text=True,
                encoding="utf-8", errors="replace", timeout=MEASURE_TIMEOUT_S, check=False)
        except subprocess.TimeoutExpired:
            log.warning("load_budget: the measurement was stopped at %ss", MEASURE_TIMEOUT_S)
            return _answer(UNAVAILABLE, lane=lane, code="timeout")
        except OSError as exc:
            log.warning("load_budget: node could not be started: %s", exc)
            return _answer(UNAVAILABLE, lane=lane, code="no-node")
    finally:
        _SLOTS.release()
    return _read_answer(done.returncode, done.stdout, done.stderr)


def _read_answer(code: int, stdout: str, stderr: str = "") -> dict:
    """The driver's answer as a measurement. Anything that is not a clean count is `unavailable`
    or `engine-refused`, by name: a number is never inferred."""
    lane = MEASURED_KIND
    try:
        doc = json.loads(stdout)
    except (TypeError, ValueError):
        log.warning("load_budget: the driver's answer was not JSON (exit %s): %s", code, (stderr or "")[-300:])
        return _answer(UNAVAILABLE, lane=lane, code="bad-answer")
    if code != 0 or not isinstance(doc, Mapping) or doc.get("ok") is not True:
        log.warning("load_budget: the driver did not answer (exit %s): %s", code,
                    str(doc.get("error") if isinstance(doc, Mapping) else "")[:300])
        return _answer(UNAVAILABLE, lane=lane, code="driver-error")
    result = doc.get("result")
    if not isinstance(result, Mapping):
        return _answer(UNAVAILABLE, lane=lane, code="bad-answer")
    reference = doc.get("reference") if isinstance(doc.get("reference"), Mapping) else {}
    sha = reference.get("sha256") if isinstance(reference.get("sha256"), str) else None
    # ⛔ only the lane this process is allowed to measure: an answer in another lane's unit is
    # not a number this budget may read
    if result.get("lane") != MEASURED_KIND:
        return _answer(UNAVAILABLE, lane=lane, code="lane")
    refusal = result.get("refusal")
    if isinstance(refusal, Mapping):
        return _answer(ENGINE_REFUSED, lane=lane, code=str(refusal.get("code") or "refused")[:120], reference=sha)
    ceiling = doc.get("ceiling") if isinstance(doc.get("ceiling"), Mapping) else {}
    work, top = result.get("work"), ceiling.get("value")
    if not _count(work) or not _count(top) or top <= 0:
        return _answer(UNAVAILABLE, lane=lane, code="bad-answer", reference=sha)
    return _answer(MEASURED, lane=lane, work=work, ceiling=top, reference=sha)
