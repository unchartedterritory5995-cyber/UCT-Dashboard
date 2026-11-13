"""RT1 (2026-10-02) — the store's door for a RUNTIME-LANE definition.

A member's Pine that the columnar ("host") lane refuses may be drawn by the
per-bar runtime lane instead (`app/.../memberPaneDefinition.js::
runtimeLaneDefinition`). Such a document carries the member's SOURCE as its
implementation (`compute.kind == "runtime"`), not a formula tree, so none of the
`ast` lane's server machinery applies to it: there is no tree to hash, lint, scan
or evaluate for an alert. This module is everything the store does with one.

⛔⛔ TWO SWITCHES, BOTH ENV VARS ON `web`, BOTH READ PER CALL (no restart to
change either):

* ``PINE_RUNTIME_SAVE_ENABLED`` — ``"1"`` lets the store ACCEPT a runtime
  document. Unset (the default) refuses every one with a sentence the member
  door renders verbatim. It ships OFF, like the client's
  ``VITE_PINE_RUNTIME_PANE_ENABLED``.
* ``PINE_RUNTIME_KILL_LIST`` — the PER-SCRIPT KILL SWITCH. Comma- or
  whitespace-separated entries, each a definition id (``u_`` + 12 hex) or the
  sha256 of a script's Pine source (64 hex, or a prefix of at least 12). A listed
  script falls back OFF the runtime lane: a save of it is refused, and a stored
  copy is SERVED with ``meta.runtimeKilled`` stamped on it so every client's
  install door refuses to draw it. ⛔ NOTHING IS DELETED OR REWRITTEN — the
  stored row is untouched, and unlisting the script brings it back on the next
  read (memory rule ``feedback_kill_switch_never_a_delete``).

⭐⭐ GT (2026-10-02, owner rulings D1 / D2 / D6) — THREE MORE, ALL READ PER CALL:

* ``PINE_RUNTIME_STAGE`` — WHO the runtime pane is for: ``off`` (the default,
  and what an unset or unrecognised value reads as), ``admins``, ``cohort``
  (WS-I, R2: admins plus the ``pine-runtime-pane`` cohort tag), ``all``. It
  rides the auth payload resolved for the member (``api/routers/auth.py::
  _access_payload`` -> ``pine_runtime_pane_enabled``), and the client's
  ``runtimePaneGate.runtimePaneEnabled()`` needs BOTH it and the build flag.
  The save door asks the same question of the saving member
  (``save_permission``): a member cannot save a runtime document while the
  stage is ``admins``, and nobody can while it is ``off``.
* ``PINE_RUNTIME_ALLOWLIST`` + ``api/data/pine_runtime_allowlist.json`` — the
  STARTER ALLOWLIST (D6). While the stage is on, the runtime lane serves only a
  script whose source sha256 (or a >=12-hex prefix of it) is listed in the
  committed JSON or in the variable (the union of the two). Adding a script is
  one line in either. An empty union serves NOTHING. A served stored row that
  is not listed is stamped ``meta.runtimeNotGraded`` (never deleted, never
  rewritten), the install door refuses that stamp, and a save is refused.
* ``RUNTIME_MAX_DEFINITION_BYTES`` (128 KiB, D2) — the store's cap for a
  RUNTIME document only. A formula keeps ``user_definitions.MAX_DEFINITION_BYTES``.

⛔ THE SERVER NEVER TRUSTS THE CLIENT'S IDENTITY OR VERDICT. The source hash is
recomputed here from ``compute.source``; the repaint class is re-derived here
by ``runtime_repaint.runtime_repaint_of`` — the mirror of the client door's
``engine/runtime/runtimeRepaint.js``, over the same rule table, held to one
answer per corpus script by ``tests/test_runtime_repaint.py`` (RT2).

W5 T12 (2026-11-02) -- THE SERVER LANES' ADMISSION (docs/pine/SERVER-RUNTIME-DESIGN.md, 3.5).
Three more variables, all read per call, and one function the server lanes ask:

* ``PINE_RUNTIME_SERVER_STAGE`` -- WHO the server lanes (alerts, scans, backtests, the rule
  record) run for: the pane's ladder (off, admins, cohort, all) in a variable of its own.
  Unset or unrecognised is ``off``. The stage the lanes run at is min(pane stage, server
  stage) (``effective_server_stage``), so a lane never reaches a member whose chart cannot
  draw the script (``server_permitted`` asks ``pane_permitted`` first).
* ``PINE_RUNTIME_SERVICE_URL`` and ``PINE_RUNTIME_SERVICE_SECRET`` -- where the web pod
  reaches the runtime service and the key that signs the request. Here they are only asked
  about being set (``service_missing``); the value of the secret is never read into a
  sentence or a log.
* ``server_lane_refusal(row, lane=...)`` -- the ONE admission question a server lane asks:
  kill list, allowlist (graded MATCH), pane stage, server stage, service set up, in that
  order. NOTHING CALLS IT YET (T13 onward wire it), so no member's behaviour changes.

WS-I PART 2 (2026-11-13) -- ADMISSION BY CAPABILITY. A member's own copy of a script differs by a
byte from any graded copy, so the per-script allowlist admits nothing a member brings. Two more
variables, both read per call:

* ``PINE_RUNTIME_CAPABILITY_ADMISSION`` -- ``off`` (the default; unset, empty or unrecognised all
  read ``off``) or ``on``. With ``on``, `not_graded` ALSO admits a script whose every capability
  (`pine_capabilities.capabilities_of`, one detector, over-declaring, closed world) is admitted
  in the committed registry (`pine_runtime_allowlist.json` ``capabilities``, each admitted row
  carrying vendor-graded MATCH evidence: `rollout_gate.pine_capability_admission`). The served
  stamp, the save door and the allow report follow it because they ask `not_graded`. ⛔ The
  SERVER lanes do not: `server_lane_refusal` asks ``graded_only=True``, which stays per-script.
  With ``off`` every answer here is the one before Part 2, byte for byte.
* ``PINE_RUNTIME_CAPABILITY_DENY`` -- capability ids SUBTRACTED from the admitted set (comma- or
  whitespace-separated). ⛔ SUBTRACT-ONLY: no variable ever adds a capability; admitting one is a
  commit to the registry, with its evidence. The kill list stays the per-script safety net and is
  asked before admission at every door.
"""
from __future__ import annotations

import contextlib
import hashlib
import json
import logging
import os
import re
import threading
import time
from collections import OrderedDict
from typing import Any, Optional

from api.services import runtime_repaint

log = logging.getLogger(__name__)

#: The compute kind this module owns.
RUNTIME_KIND = "runtime"

SAVE_ENV = "PINE_RUNTIME_SAVE_ENABLED"
KILL_ENV = "PINE_RUNTIME_KILL_LIST"

# ─── GT: the rollout stage (D1) ──────────────────────────────────────────────
STAGE_ENV = "PINE_RUNTIME_STAGE"
STAGE_OFF = "off"
STAGE_ADMINS = "admins"
STAGE_ALL = "all"
#: ⭐ WS-I (2026-10-31, owner ruling R2) — the stage between admins and all:
#: admins PLUS members tagged into `rollout_gate.PINE_RUNTIME_COHORT`
#: (`rollout:pine-runtime-pane`, a `user_tags` row). The ladder is
#: off -> admins -> cohort -> all; every step back is a variable, never a delete.
STAGE_COHORT = "cohort"
STAGES = (STAGE_OFF, STAGE_ADMINS, STAGE_COHORT, STAGE_ALL)
#: W5 T12 (owner ruling Q4, 2026-11-02): the stage of the SERVER lanes. Same ladder, own variable.
SERVER_STAGE_ENV = "PINE_RUNTIME_SERVER_STAGE"

#: ⭐ DECLARED AS A MODE TABLE so `feature_flag_index.mode_flags()` derives it
#: (the stage carries no ENABLED marker, so `gates()` cannot see it). The
#: default is the literal the code falls back to, in the same expression a
#: reader audits. ⛔ It is OFF: an unset variable never exposes the lane.
#: ⚠️ The KEY is a string literal on purpose: the index reads a constant key.
PINE_RUNTIME_MODE_FLAGS = {
    "PINE_RUNTIME_STAGE": (STAGE_OFF, (STAGE_OFF, STAGE_ADMINS, STAGE_COHORT, STAGE_ALL)),
    # W5 T12 (ruling Q4): the SERVER lanes' stage, the same ladder in a variable of its own.
    "PINE_RUNTIME_SERVER_STAGE": (STAGE_OFF, (STAGE_OFF, STAGE_ADMINS, STAGE_COHORT, STAGE_ALL)),
    # WS-I Part 2 (2026-11-13): admission by capability, off until the owner arms it.
    "PINE_RUNTIME_CAPABILITY_ADMISSION": ("off", ("off", "on")),
}
assert STAGE_ENV in PINE_RUNTIME_MODE_FLAGS
assert SERVER_STAGE_ENV in PINE_RUNTIME_MODE_FLAGS

# ─── WS-I Part 2: admission by capability (both variables read per call) ─────
CAPABILITY_ADMISSION_ENV = "PINE_RUNTIME_CAPABILITY_ADMISSION"
CAPABILITY_ADMISSION_OFF = "off"
CAPABILITY_ADMISSION_ON = "on"
CAPABILITY_DENY_ENV = "PINE_RUNTIME_CAPABILITY_DENY"
assert CAPABILITY_ADMISSION_ENV in PINE_RUNTIME_MODE_FLAGS
assert PINE_RUNTIME_MODE_FLAGS[CAPABILITY_ADMISSION_ENV][0] == CAPABILITY_ADMISSION_OFF

# ─── GT: the starter allowlist (D6) ──────────────────────────────────────────
ALLOW_ENV = "PINE_RUNTIME_ALLOWLIST"
#: The committed half of the allowlist. Edited by hand, one entry per script
#: graded MATCH against a TradingView capture; each entry names its evidence.
ALLOWLIST_PATH = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data",
                              "pine_runtime_allowlist.json")

#: ⭐ D2 — the size cap for a RUNTIME document. A runtime document carries the
#: member's whole Pine source AND the host translator's object program, so the
#: formula store's 64 KiB (sized for ~1,000 lines of formula) refused
#: trend-targets-algoalpha (83,875 B canonical). 128 KiB holds it with room,
#: and is still a named cap. ⛔ ONLY runtime documents: a formula keeps its own.
RUNTIME_MAX_DEFINITION_BYTES = 128 * 1024

#: The store's handle for a runtime document in the `ast_hash` column (NOT NULL
#: there). Prefixed so it can never collide with a tree's `sha256:` handle — and
#: so every consumer that keys on `ast_hash` (the sweep, `scan_hits`) can tell at a
#: glance that this is not a tree.
HASH_PREFIX = "runtime:sha256:"

#: ⚰️ RT2 — `REPAINT_RISK` (a regex mirrored from the client door) stood here
#: and REFUSED every source that mentioned another timeframe or the live bar.
#: The class is now STATED by `runtime_repaint.runtime_repaint_of` and checked
#: against what the document declares (`validate`).

#: Keys only an `ast` definition's compute block may carry.
_AST_ONLY_KEYS = ("ast", "trees", "treesHash", "scanPlot", "sources", "graph",
                  "astHash", "paramManifest")

_ID_RE = re.compile(r"^u_[0-9a-f]{12}$")
_HASH_RE = re.compile(r"^[0-9a-f]{12,64}$")
_PLOT_KEY_RE = re.compile(r"^[A-Za-z][A-Za-z0-9_]*$")


def is_runtime(definition: Any) -> bool:
    """Is this a runtime-lane document?"""
    compute = definition.get("compute") if isinstance(definition, dict) else None
    return isinstance(compute, dict) and compute.get("kind") == RUNTIME_KIND


def save_enabled() -> bool:
    """`PINE_RUNTIME_SAVE_ENABLED == "1"`, read per call. Default OFF."""
    return os.environ.get(SAVE_ENV, "").strip() == "1"


def kill_list() -> list[str]:
    """The kill list, normalised: lowercase, well-formed entries only, deduped."""
    raw = os.environ.get(KILL_ENV, "")
    out: list[str] = []
    for part in re.split(r"[\s,]+", raw):
        v = part.strip().lower()
        if (_ID_RE.match(v) or _HASH_RE.match(v)) and v not in out:
            out.append(v)
    return out


def stage() -> str:
    """`PINE_RUNTIME_STAGE`, read PER CALL: ``off`` · ``admins`` · ``cohort`` · ``all``.

    ⛔ AN UNSET, EMPTY OR UNRECOGNISED VALUE IS ``off`` — never the opposite.
    A typo ("admin", "everyone") must not open the lane to anyone."""
    v = os.environ.get(STAGE_ENV, STAGE_OFF).strip().lower()
    return v if v in STAGES else STAGE_OFF


def pane_permitted(role: Any, user_id: Any = None) -> bool:
    """May THIS member's pane draw a script through the runtime lane?

    ``all`` -> everyone; ``cohort`` -> admins and members tagged into the
    ``pine-runtime-pane`` cohort (WS-I, R2); ``admins`` -> ``role == "admin"``
    only; ``off`` -> nobody.
    ⛔ A missing role is a MEMBER's, never an admin's, and a missing id is
    OUTSIDE the cohort: a caller that forgets either fails closed."""
    s = stage()
    if s == STAGE_ALL:
        return True
    if s in (STAGE_ADMINS, STAGE_COHORT) and role == "admin":
        return True
    if s == STAGE_COHORT:
        # ⛔ Imported here, not at the top: `rollout_gate` imports FastAPI and the
        # auth middleware, which the store's save path must not drag in at import.
        from api.services import rollout_gate
        return bool(rollout_gate.pine_runtime_cohort_enabled_for(
            str(user_id) if user_id else None))
    return False


# --- W5 T12: the SERVER lanes' admission (docs/pine/SERVER-RUNTIME-DESIGN.md, 3.5) ---
#
# The alert cycle, the scans, the backtest and the rule record will run a member's
# script in the separate `pine-runtime` service (tasks T13-T17), and every one of them
# asks `server_lane_refusal` BEFORE it evaluates. ONE AUTHORITY: the kill list, the
# allowlist, the stage and the cohort are read here, through the functions the chart's
# own serving path uses (`killed`, `not_graded`, `pane_permitted`); the service holds no
# copy of any of them and has no variable for them.
#
# NOTHING CALLS THESE YET. Until a lane is wired to them (T13 onward) no member's
# behaviour changes, whatever the variables below hold.

#: Where the web pod reaches the runtime service (private network only). Read per call.
SERVICE_URL_ENV = "PINE_RUNTIME_SERVICE_URL"
#: The HMAC key that signs every request to the service (design 3.6). It is read here
#: ONLY to ask whether it is set: its VALUE never reaches a sentence, a log or the
#: ledger. The signing read is the client's (T11).
SERVICE_SECRET_ENV = "PINE_RUNTIME_SERVICE_SECRET"


def server_stage() -> str:
    """`PINE_RUNTIME_SERVER_STAGE`, read PER CALL: ``off`` | ``admins`` | ``cohort`` | ``all``.

    WHO the SERVER lanes (alerts, scans, backtests, the rule record) run for: the same
    ladder and the same vocabulary (`STAGES`) as `stage()`, in a variable of its own so
    the chart can be armed without arming the server lanes, and the server lanes can be
    killed alone (owner ruling Q4, 2026-11-02).

    NEVER READ THIS ON ITS OWN TO ADMIT ANYONE: the stage the server lanes run at is
    `effective_server_stage()`, the LOWER of this and the pane's.

    AN UNSET, EMPTY OR UNRECOGNISED VALUE IS ``off``, never the opposite. A typo
    ("admin", "everyone") must not open a server lane to anyone."""
    v = os.environ.get(SERVER_STAGE_ENV, STAGE_OFF).strip().lower()
    return v if v in STAGES else STAGE_OFF


def effective_server_stage() -> str:
    """The stage the server lanes really run at: min(pane stage, server stage) on the
    ladder `STAGES` (off < admins < cohort < all). Both are read per call.

    A server lane can therefore never reach a member whose chart cannot draw the
    script: with the pane at ``admins`` and the server at ``all`` this is ``admins``."""
    pane, server = stage(), server_stage()
    return pane if STAGES.index(pane) <= STAGES.index(server) else server


def server_permitted(role: Any, user_id: Any = None) -> bool:
    """May a script OWNED by this member run in a SERVER lane? (ruling Q4)

    Two questions, the pane's first. `pane_permitted` is CALLED here, not copied, so a
    member the chart cannot draw for is refused by construction, whatever
    `PINE_RUNTIME_SERVER_STAGE` says and whatever `pane_permitted` comes to mean later.
    Then the server stage's own audience: ``all`` -> everyone; ``cohort`` -> admins and
    the `pine-runtime-pane` cohort (the same tag the pane's cohort stage reads);
    ``admins`` -> ``role == "admin"`` only; ``off`` -> nobody.

    A missing role is a MEMBER's, never an admin's, and a missing id is OUTSIDE the
    cohort: a caller that forgets either fails closed. The server stage is the cohort's
    kill switch, read FIRST: at any other server stage no tag is read, so stepping the
    stage back withdraws every tagged member and touches no tag."""
    if not pane_permitted(role, user_id):
        return False
    s = server_stage()
    if s == STAGE_ALL:
        return True
    if s in (STAGE_ADMINS, STAGE_COHORT) and role == "admin":
        return True
    # Imported here, not at the top: `rollout_gate` imports FastAPI and the auth
    # middleware, which the store's save path must not drag in at import.
    from api.services import rollout_gate
    return bool(rollout_gate.cohort_enabled_for(
        str(user_id) if user_id else None, rollout_gate.PINE_RUNTIME_COHORT,
        kill_switch=lambda: s == STAGE_COHORT))


def _owner_role(owner_id: Any) -> Optional[str]:
    """The stored role of a definition's OWNER (`users.role`, the value the auth payload
    reads for the same member), or ``None`` when there is no id or the lookup fails.

    Read on EVERY call, never cached: a demotion reaches the next admission. A failure
    is a MEMBER (``None``), never an admin: the chain below then refuses at the
    ``admins`` stages and says so by name."""
    if not owner_id:
        return None
    try:
        from api.services import auth_service
        user = auth_service.get_user_by_id(str(owner_id))
    except Exception:  # noqa: BLE001 -- an unreadable owner is a member, and the lane refuses by name
        log.warning("[runtime_definitions] owner role unreadable; treated as a member")
        return None
    role = user.get("role") if isinstance(user, dict) else None
    return role if isinstance(role, str) else None


def service_missing() -> list[str]:
    """The names of the variables the web pod needs to reach the runtime service that
    are NOT set (blank counts as unset): `PINE_RUNTIME_SERVICE_URL` (where) and
    `PINE_RUNTIME_SERVICE_SECRET` (the key that signs the request). Empty means
    configured. Read per call. Names only: no value is ever returned.

    Each name is read by its own `os.environ.get(CONSTANT, ...)` on purpose, not through a loop
    variable: the flag index finds a read only in that form, and a ledgered name the index
    cannot see read would look like rot."""
    missing = []
    if not os.environ.get(SERVICE_URL_ENV, "").strip():
        missing.append(SERVICE_URL_ENV)
    if not os.environ.get(SERVICE_SECRET_ENV, "").strip():
        missing.append(SERVICE_SECRET_ENV)
    return missing


def server_lane_refusal(row: Any, *, lane: Any) -> Optional[tuple[str, str]]:
    """THE ONLY ADMISSION QUESTION A SERVER LANE ASKS of a stored runtime document:
    ``(guard, sentence)`` for the FIRST refusal that applies, or ``None`` when the lane
    may run it. Design 3.5, step by step; it never raises and never returns a
    non-refusal for a row it cannot read.

      1. kill list       `killed(def_id, source)`                 -> ``runtime:killed``
      2. graded          `not_graded(source)`                     -> ``runtime:not-yet-graded``
      3. pane stage      `pane_permitted(owner_role, owner_id)`   -> ``runtime:stage``
      4. server stage    `server_permitted(owner_role, owner_id)` -> ``runtime:server-stage``
      5. service set up  `service_missing()` is empty             -> ``runtime:server-unavailable``

    ONE AUTHORITY PER QUESTION: steps 1-3 ask the very functions the chart's serving path
    asks, so a script the chart refuses is refused here by the same reason and the same
    sentence (steps 1 and 2 return that sentence verbatim). Step 2 therefore admits only
    a script on the GRADED allowlist (ruling Q8: only allowlisted, MATCH-graded documents may
    use the service): `not_graded(source, graded_only=True)` asks `graded_allow_list` (the
    committed JSON served through `rollout_gate.pine_runtime_admission`), never a second
    list. ⛔ The operator variable `PINE_RUNTIME_ALLOWLIST` carries no evidence, so it keeps
    admitting on the browser pane only and NEVER on a server lane (coordinator ruling,
    2026-11-02).

    ALL FIVE ARE READ ON EVERY CALL and nothing is cached: a kill, a stage change or a
    demotion reaches the NEXT call, and nothing stored is touched (a kill switch is never
    a delete). The owner is the definition's, `row["user_id"]`, checked at EVALUATION
    time, every cycle, not once at arm.

    `lane` is the service profile asking (``alert``, ``on-demand``, ``backtest``,
    ``sweep``, ``record``); it only words the sentences, the five questions are the same
    in every lane. No sentence carries a variable's value other than a stage word, and
    never the URL or the secret."""
    lane_name = lane.strip() if isinstance(lane, str) and lane.strip() else "server"
    why_not = f"so this one does not run on the server ({lane_name} lane)"
    definition = row.get("definition") if isinstance(row, dict) else None
    def_id = row.get("def_id") if isinstance(row, dict) else None
    if not is_runtime(definition) or not isinstance(def_id, str) or not def_id:
        return ("runtime:not-runtime",
                f"this is not a stored runtime document, {why_not}")
    source = definition["compute"].get("source")
    reason = killed(def_id, source)
    if reason:
        return ("runtime:killed", reason)
    reason = not_graded(source, graded_only=True)
    if reason:
        return ("runtime:not-yet-graded", reason)
    owner_id = row.get("user_id")
    role = _owner_role(owner_id)
    if not pane_permitted(role, owner_id):
        return ("runtime:stage",
                "scripts drawn bar by bar are not switched on for this account right now "
                f"({STAGE_ENV}={stage()}), {why_not}")
    if not server_permitted(role, owner_id):
        return ("runtime:server-stage",
                "scripts drawn bar by bar are not switched on for server runs for this "
                f"account right now (effective stage {effective_server_stage()}: "
                f"{SERVER_STAGE_ENV}={server_stage()}, {STAGE_ENV}={stage()}), {why_not}")
    missing = service_missing()
    if missing:
        return ("runtime:server-unavailable",
                f"the runtime service is not set up on this server ({' and '.join(missing)} "
                f"not set), {why_not}")
    return None


def _allow_entries_from(raw: Any) -> list[str]:
    out: list[str] = []
    for part in raw:
        v = str(part if part is not None else "").strip().lower()
        if _HASH_RE.match(v) and v not in out:
            out.append(v)
    return out


def _allowlist_doc() -> Optional[dict]:
    try:
        with open(ALLOWLIST_PATH, encoding="utf-8") as fh:
            doc = json.load(fh)
    except (OSError, ValueError):
        return None
    return doc if isinstance(doc, dict) else None


def allow_report(*, with_capabilities: bool = True) -> dict:
    """WS-I (R1) — what the committed allowlist SERVES and what it WITHHOLDS, and
    why, plus the variable's entries (which carry no evidence: an operator
    override outside R1, reported so it is never invisible). Never raises on
    the file: an unreadable one serves nothing (fail closed).

    WS-I Part 2: while ``PINE_RUNTIME_CAPABILITY_ADMISSION=on`` it also carries
    ``capability_admission`` (`admitted_capabilities`: what is admitted, what is withheld and
    why, what the deny variable subtracted). With the variable off the report is the one
    before Part 2, key for key."""
    from api.services import rollout_gate
    doc = _allowlist_doc()
    served: list[dict] = []
    withheld: list[dict] = []
    scripts = doc.get("scripts") if doc else None
    registry = doc.get("capabilities") if doc else None
    for s in scripts if isinstance(scripts, list) else []:
        if not isinstance(s, dict):
            continue
        sha = _allow_entries_from([s.get("sha256")])
        reasons = rollout_gate.pine_runtime_admission(s, registry)
        if not sha:
            reasons = ["no well-formed sha256"] + reasons
        row = {"slug": s.get("slug"), "sha256": sha[0] if sha else None}
        if reasons:
            withheld.append(dict(row, reasons=reasons))
        else:
            served.append(row)
    overrides = _allow_entries_from(re.split(r"[\s,]+", os.environ.get(ALLOW_ENV, "")))
    report = {"served": served, "withheld": withheld, "env_overrides": overrides}
    if with_capabilities and capability_admission_on():
        report["capability_admission"] = admitted_capabilities()
    return report


def graded_allow_list() -> list[str]:
    """The GRADED allowlist: only what the committed JSON SERVES (`allow_report`'s
    ``served``: R1-graded, with a MATCH capture), never `PINE_RUNTIME_ALLOWLIST`.

    ⭐ The single authority for "graded" (W5 T12, ruling Q8): `allow_list` builds on it and
    the SERVER lanes ask it directly (`not_graded(..., graded_only=True)`), so the two can
    never disagree about what is graded. Read per call; an unreadable JSON serves nothing."""
    return [r["sha256"] for r in allow_report(with_capabilities=False)["served"]]


def allow_list() -> list[str]:
    """The starter allowlist: the committed JSON ∪ `PINE_RUNTIME_ALLOWLIST`.

    ⭐ WS-I (2026-10-31, owner ruling R1): a committed script is SERVED only when
    `rollout_gate.pine_runtime_admission` admits it: every capability it uses
    conformance-graded, and at least one MATCH capture with the pane on. One that
    fails is left out (served as not graded, never deleted); `allow_report`
    names why. ⚠️ The variable's entries carry no evidence and are NOT graded
    here: it stays an additive operator override (tests, an emergency add),
    recorded in `docs/feature_flags.json` as to be left UNSET in production.

    Both are read PER CALL, so an env edit needs no deploy. Each entry is a
    script's source sha256 or a prefix of at least 12 hex. ⛔ A definition id is
    NOT accepted here (unlike the kill list): grading is a property of the SCRIPT,
    and an id would admit whatever source somebody later saves under it.

    ⛔ AN UNREADABLE JSON CONTRIBUTES NOTHING (fail closed): the lane serves less,
    never more."""
    entries: list[str] = graded_allow_list()
    for e in _allow_entries_from(re.split(r"[\s,]+", os.environ.get(ALLOW_ENV, ""))):
        if e not in entries:
            entries.append(e)
    return entries


def not_graded(source: Optional[str], *, graded_only: bool = False,
               budget: "Optional[DetectorBudget]" = None, capability: bool = True,
               pending_ok: bool = False) -> Optional[str]:
    """Why this script is NOT served by the runtime lane (D6), or ``None``.

    The sentence is the reason; the code the member door declines with is
    ``runtime:not-yet-graded``. `graded_only=True` (the SERVER lanes, ruling Q8) admits
    only `graded_allow_list`, so an operator-variable entry is refused there; the default
    (the browser pane) admits `allow_list`, the variable included.

    WS-I Part 2: with ``PINE_RUNTIME_CAPABILITY_ADMISSION=on`` the browser pane (never
    ``graded_only``, never ``capability=False``) ALSO admits a script `capability_admitted`
    admits, within the request's `budget`; a source whose set the budget could not compute is
    answered "still being checked" (fail closed) and fills on a later request. Off, nothing changes."""
    sentence, pending = not_graded_reason(source, graded_only=graded_only, budget=budget,
                                          capability=capability)
    if pending and pending_ok:
        return None
    return sentence


def not_graded_at_save(source: Optional[str]) -> Optional[str]:
    """The save door's question (final verify of #1204). With capability admission on, a source
    whose capability set cannot be computed right now (the process-wide gate is busy) is SAVED and
    nothing is persisted for it: the row is served "still being checked" (fail closed, never drawn)
    and its first serve computes the set under the gate. Every other answer is `not_graded`'s. With
    admission off the call is exactly the one before Part 2."""
    if not capability_admission_on():
        return not_graded(source)
    return not_graded(source, pending_ok=True)


def not_graded_reason(source: Optional[str], *, graded_only: bool = False,
                      budget: "Optional[DetectorBudget]" = None, capability: bool = True) -> tuple:
    """``(sentence or None, pending)``: `not_graded`'s answer, and whether it is only "still being
    checked" (the capability set is not known yet: the budget or the process-wide gate was busy)."""
    h = source_hash(source) if isinstance(source, str) else ""
    if h and any(h.startswith(e) for e in (graded_allow_list() if graded_only else allow_list())):
        return None, False
    if h and capability and not graded_only and capability_admission_on():
        ok, missing = capability_admitted(source, budget=budget)
        if ok:
            return None, False
        if missing == [PENDING]:
            return (PENDING_SENTENCE.format(h=h[:12]), True)
    return (f"this script (sha256 {h[:12] or '?'}…) has not yet been graded against "
            "TradingView, so it is not drawn bar by bar"), False


def capability_admission_on() -> bool:
    """`PINE_RUNTIME_CAPABILITY_ADMISSION == "on"`, read PER CALL. ⛔ Unset, empty or any other
    value (a typo: "1", "true", "yes") is ``off``: a typo never widens what the lane serves."""
    v = os.environ.get(CAPABILITY_ADMISSION_ENV, CAPABILITY_ADMISSION_OFF).strip().lower()
    return v == CAPABILITY_ADMISSION_ON


def capability_deny() -> list[str]:
    """`PINE_RUNTIME_CAPABILITY_DENY`, read per call: the capability ids to SUBTRACT from the
    admitted set, lowercased, deduplicated. ⛔ It can only subtract (`admitted_capabilities`
    takes them out); an id it names that is not admitted changes nothing."""
    out: list[str] = []
    for part in re.split(r"[\s,]+", os.environ.get(CAPABILITY_DENY_ENV, "")):
        v = part.strip().lower()
        if v and v not in out:
            out.append(v)
    return out


def admitted_capabilities() -> dict:
    """WS-I Part 2 -- the capabilities admitted for capability admission, read per call:
    ``{"admitted": [...], "withheld": {name: [reasons]}, "denied": [...]}``.

    A registry row admits its capability only when `rollout_gate.pine_capability_admission`
    says so, the name is one the detector can return (`pine_capabilities.CAPABILITY_IDS`) and
    `PINE_RUNTIME_CAPABILITY_DENY` does not name it. ⛔ FAIL CLOSED: an unreadable or malformed
    JSON admits nothing. Never raises."""
    from api.services import pine_capabilities, rollout_gate
    doc = _allowlist_doc()
    registry = doc.get("capabilities") if doc else None
    deny = set(capability_deny())
    admitted: list[str] = []
    withheld: dict[str, list[str]] = {}
    denied: list[str] = []
    for name in sorted(k for k in registry if isinstance(k, str)) if isinstance(registry, dict) else []:
        if name not in pine_capabilities.CAPABILITY_IDS:
            withheld[name] = [f"`{name}` is not a capability the detector names"]
            continue
        reasons = rollout_gate.pine_capability_admission(name, registry[name])
        if reasons:
            withheld[name] = reasons
        elif name in deny:
            withheld[name] = [f"`{name}` is subtracted by {CAPABILITY_DENY_ENV}"]
            denied.append(name)
        else:
            admitted.append(name)
    return {"admitted": admitted, "withheld": withheld, "denied": denied}


#: ─── WHERE A SOURCE'S CAPABILITY SET COMES FROM (re-verify of #1204, 2026-11-13) ─────────────
#: The detector is linear but not free (~0.15 s on a near-128 KiB source), and serving rows
#: (`stamp_served`: the list, history, one row, a share) must never re-run it per row. In order:
#:   1. this process's LRU (`_CAPS_LRU`, a TRUE least-recently-used map; a fallback only);
#:   2. the PERSISTED set, computed once per source (`runtime_capabilities` in user_definitions.db,
#:      keyed by source sha256, valid only for `pine_capabilities.DETECTOR_VERSION`);
#:   3. a FRESH run of the detector, only while the request's `DetectorBudget` lasts: a saved row is
#:      computed at its save (flag on), an older row on its first serve, and a row past the budget
#:      is served fail-closed ("still being checked") and filled on a later request.
#: ⛔ The table holds no member identifier: a source's sha256 and the ids the detector named.
CAPS_TABLE = "runtime_capabilities"
_CAPS_DDL = (f"CREATE TABLE IF NOT EXISTS {CAPS_TABLE} (source_sha256 TEXT PRIMARY KEY, "
             "detector_version INTEGER NOT NULL, capabilities TEXT NOT NULL, computed_at INTEGER NOT NULL)")
#: The id `capability_admitted` reports for a source whose set is not known yet (budget spent).
#: Never in the vocabulary: a pending source is withheld, fail closed.
PENDING = "pending"
#: What a pending row is served with (`meta.runtimeNotGraded`, beside `meta.runtimePending: true`).
PENDING_SENTENCE = ("this script (sha256 {h}…) is still being checked against the parts of Pine graded "
                    "against TradingView, so it is not drawn bar by bar yet")
#: The served stamp that marks a `runtimeNotGraded` sentence as "being checked", not a refusal.
PENDING_STAMP = "runtimePending"
#: At most this many fresh detector runs per request, and no new one that would cross this much
#: time (its cost PROJECTED from the source's size before it starts).
DETECTOR_RUNS_PER_REQUEST = 8
DETECTOR_SECONDS_PER_REQUEST = 0.3
#: A source over this size gets at most ONE fresh run per request (adversarial near-cap sources cost
#: 0.3-0.6 s each: a second one would cross a second).
DETECTOR_BIG_SOURCE_BYTES = 64 * 1024
#: ⛔⛔ THE PROCESS-WIDE GATE (final verify of #1204, A2). The per-request budget bounds ONE request,
#: but the detector holds the GIL, so eight requests each spending their budget at once stall each
#: other (measured 3.5-5.1 s per request). ONE detector run at a time in the process; a request
#: that cannot take the gate WITHOUT WAITING serves the row "still being checked" and moves on.
_DETECTOR_GATE = threading.Semaphore(1)
#: ⛔ AND A DUTY CYCLE ON TOP OF IT. One run at a time is not enough: eight requests taking the gate
#: in turn still each wait out the other seven runs under the GIL (measured: every one of 8
#: concurrent cold lists 3.8 s with the gate alone). After a run of cost c, no new run starts until
#: the detector has been idle for c x (1/DUTY - 1), so detector work is at most DUTY of wall time,
#: process-wide. A request that finds it cooling serves the row "still being checked".
DETECTOR_DUTY_CYCLE = 1 / 3
_DETECTOR_IDLE_UNTIL = [0.0]
#: A running estimate of the detector's cost per source byte (an exponential average of the runs
#: measured), so a run is projected before it starts. Seeded conservatively (5 us/byte = 0.65 s
#: for a 128 KiB source).
_SECONDS_PER_BYTE = [5e-6]
_CAPS_LRU_MAX = 4096
_CAPS_LRU: "OrderedDict[str, frozenset]" = OrderedDict()
_CAPS_LRU_LOCK = threading.Lock()


class DetectorBudget:
    """How much fresh detector work ONE request may do. A run may start only when:
    runs remain; the request has not run one yet, OR the run's PROJECTED cost (source bytes x the
    running per-byte estimate) still fits under `seconds`; and, for a source over
    `DETECTOR_BIG_SOURCE_BYTES`, the request has not run a big one yet. (The first run is always
    allowed, or a large source would never be checked.) `None` where a budget is taken means one
    source only (the save door, the verdict door). Every fresh run also needs the process-wide
    gate (`_DETECTOR_GATE`), taken without waiting."""

    def __init__(self, runs: int = DETECTOR_RUNS_PER_REQUEST, seconds: float = DETECTOR_SECONDS_PER_REQUEST):
        self.runs = runs
        self.seconds = seconds
        self.spent = 0.0
        self.done = 0
        self.big_done = 0

    def allows(self, nbytes: int = 0) -> bool:
        if self.runs <= 0:
            return False
        if nbytes > DETECTOR_BIG_SOURCE_BYTES and self.big_done:
            return False
        projected = nbytes * _SECONDS_PER_BYTE[0]
        return self.done == 0 or self.spent + projected <= self.seconds

    def charge(self, nbytes: int, elapsed: float) -> None:
        self.runs -= 1
        self.done += 1
        self.spent += elapsed
        if nbytes > DETECTOR_BIG_SOURCE_BYTES:
            self.big_done += 1

    def take(self, nbytes: int = 0) -> bool:
        """`allows` and, when it does, reserve the run (rails and simple callers)."""
        if not self.allows(nbytes):
            return False
        self.runs -= 1
        self.done += 1
        if nbytes > DETECTOR_BIG_SOURCE_BYTES:
            self.big_done += 1
        return True


def _lru_get(key: str) -> Optional[frozenset]:
    with _CAPS_LRU_LOCK:
        hit = _CAPS_LRU.get(key)
        if hit is not None:
            _CAPS_LRU.move_to_end(key)
        return hit


def _lru_put(key: str, caps: frozenset) -> None:
    with _CAPS_LRU_LOCK:
        _CAPS_LRU[key] = caps
        _CAPS_LRU.move_to_end(key)
        while len(_CAPS_LRU) > _CAPS_LRU_MAX:
            _CAPS_LRU.popitem(last=False)


def _reset_capability_cache(*, persisted: bool = False) -> None:
    """Tests only: forget this process's LRU, and with `persisted` the stored sets too. Also ends
    any detector cool-down (a fresh process has none)."""
    with _CAPS_LRU_LOCK:
        _CAPS_LRU.clear()
    _DETECTOR_IDLE_UNTIL[0] = 0.0
    if persisted:
        from api.services import user_definitions as svc
        try:
            with contextlib.closing(svc._connect()) as c:
                c.execute(_CAPS_DDL)
                c.execute(f"DELETE FROM {CAPS_TABLE}")
                c.commit()
        except Exception:  # noqa: BLE001
            pass


def _store_get(key: str) -> Optional[frozenset]:
    """The persisted set for this source at the CURRENT detector version, or None. Never raises."""
    from api.services import pine_capabilities
    from api.services import user_definitions as svc
    try:
        with contextlib.closing(svc._connect()) as c:
            c.execute(_CAPS_DDL)
            r = c.execute(f"SELECT capabilities FROM {CAPS_TABLE} WHERE source_sha256 = ? "
                          "AND detector_version = ?", (key, pine_capabilities.DETECTOR_VERSION)).fetchone()
    except Exception:  # noqa: BLE001 - an unreadable store is a miss, never an admission
        return None
    if r is None:
        return None
    try:
        caps = json.loads(r[0])
    except ValueError:
        return None
    return frozenset(caps) if isinstance(caps, list) and all(isinstance(x, str) for x in caps) else None


def _store_put(key: str, caps: frozenset) -> None:
    from api.services import pine_capabilities
    from api.services import user_definitions as svc
    try:
        with contextlib.closing(svc._connect()) as c:
            c.execute(_CAPS_DDL)
            c.execute(f"INSERT OR REPLACE INTO {CAPS_TABLE} (source_sha256, detector_version, capabilities, "
                      "computed_at) VALUES (?, ?, ?, ?)",
                      (key, pine_capabilities.DETECTOR_VERSION, json.dumps(sorted(caps)), int(time.time())))
            c.commit()
    except Exception:  # noqa: BLE001 - a failed write only means the next serve computes again
        log.warning("[runtime_definitions] capability set not persisted")


def capabilities_for(source: str, *, budget: Optional[DetectorBudget] = None,
                     persist: bool = True) -> Optional[frozenset]:
    """This source's capability set: the LRU, then the persisted set, then (budget allowing) a
    fresh run, persisted unless `persist=False` (the verdict door stores nothing). ``None`` when
    the set is not known and the budget is spent: the caller serves it fail-closed."""
    from api.services import pine_capabilities
    key = source_hash(source)
    hit = _lru_get(key)
    if hit is not None:
        return hit
    stored = _store_get(key)
    if stored is not None:
        _lru_put(key, stored)
        return stored
    nbytes = len(source)
    if budget is not None and not budget.allows(nbytes):
        return None
    if not _DETECTOR_GATE.acquire(blocking=False):
        return None                      # another run holds the process: pending, never wait
    try:
        if time.monotonic() < _DETECTOR_IDLE_UNTIL[0]:
            return None                  # the detector is cooling down: pending, never wait
        t0 = time.perf_counter()
        caps = pine_capabilities.capabilities_of(source)
        elapsed = time.perf_counter() - t0
        _DETECTOR_IDLE_UNTIL[0] = time.monotonic() + elapsed * (1 / DETECTOR_DUTY_CYCLE - 1)
    finally:
        _DETECTOR_GATE.release()
    if nbytes >= 1024:
        _SECONDS_PER_BYTE[0] = 0.7 * _SECONDS_PER_BYTE[0] + 0.3 * (elapsed / nbytes)
    if budget is not None:
        budget.charge(nbytes, elapsed)
    if persist:
        _store_put(key, caps)
    _lru_put(key, caps)
    return caps


def capability_admitted(source: Any, *, budget: Optional[DetectorBudget] = None,
                        persist: bool = True) -> tuple:
    """``(ok, missing)``: does EVERY capability this source uses carry admission? ``missing``
    names, sorted, each capability it uses that is not admitted (a capability absent from the
    registry is missing: CLOSED WORLD; an unreadable source is missing ``unreadable``; a source
    whose set is not known yet because the request's budget is spent is missing ``pending``).

    Pure policy: it does NOT read `PINE_RUNTIME_CAPABILITY_ADMISSION` (`not_graded` does) and
    does NOT read the kill list (every door asks `killed` first). Never raises."""
    from api.services import pine_capabilities
    if not isinstance(source, str) or not source.strip():
        return False, [pine_capabilities.UNREADABLE]
    try:
        caps = capabilities_for(source, budget=budget, persist=persist)
        if caps is None:
            return False, [PENDING]
        admitted = set(admitted_capabilities()["admitted"])
    except Exception:  # noqa: BLE001 - fail closed: what cannot be read is not admitted
        log.warning("[runtime_definitions] capability admission unreadable; not admitted")
        return False, [pine_capabilities.UNREADABLE]
    missing = sorted(c for c in caps if c not in admitted)
    return (not missing), missing


def runtime_admission(source: Any) -> dict:
    """``POST /api/user-definitions/runtime-admission`` -- ``{sha256, admitted, missing}`` for one
    source, the client's per-hash verdict (`engine/runtimeKill.js`). ``admitted`` is True only
    when capability admission is ON, the script is not on the kill list, and
    `capability_admitted` admits it. The allowlist is NOT folded in (the client asks its own
    latched allowlist first). Nothing is stored and the source is never logged."""
    h = source_hash(source) if isinstance(source, str) else None
    # ⛔ B1 (review 2026-11-13): with the flag OFF the detector is NEVER run. The answer is a
    # constant, so no request can spend server time on a door that admits nothing.
    if not capability_admission_on():
        return {"sha256": h, "admitted": False, "missing": []}
    ok, missing = capability_admitted(source, persist=False)      # the verdict door stores nothing
    admitted = bool(ok and not killed(None, source))
    return {"sha256": h, "admitted": admitted, "missing": missing}


def save_permission(role: Any, user_id: Any = None) -> Optional[str]:
    """The save door's PER-MEMBER refusal (D1), or ``None``.

    ⛔ The SAME question the client's pane asks before it draws
    (`pane_permitted`), so a member who cannot see the lane cannot store into it
    either. The save switch, the kill list and the allowlist are asked by the
    caller, each with its own sentence."""
    if pane_permitted(role, user_id):
        return None
    s = stage()
    who = {STAGE_OFF: "no member", STAGE_COHORT: "admins and a test group only"}.get(
        s, "admins only")
    return (f"scripts drawn bar by bar are switched on for {who} right now "
            f"({STAGE_ENV}={s}), so this one is not saved")


def source_hash(source: str) -> str:
    """sha256 of the Pine source, UTF-8 — the same identity the client computes
    (`engine/runtimeKill.js::runtimeSourceHash`)."""
    return hashlib.sha256(str(source).encode("utf-8")).hexdigest()


def killed(def_id: Optional[str], source: Optional[str]) -> Optional[str]:
    """The reason this script is on the kill list, or ``None``."""
    entries = kill_list()
    if not entries:
        return None
    if def_id and def_id.lower() in entries:
        return (f"definition `{def_id}` is on the server's runtime kill list, so it is not "
                "drawn bar by bar")
    if isinstance(source, str):
        h = source_hash(source)
        if any(not _ID_RE.match(e) and h.startswith(e) for e in entries):
            return (f"this script (sha256 {h[:12]}…) is on the server's runtime kill list, "
                    "so it is not drawn bar by bar")
    return None


def validate(definition: dict) -> None:
    """The store's shape check for a runtime document — `defSchema.js::
    validateRuntimeCompute`'s rules, applied at the door every member shares.

    Raises ``ValueError`` with the sentence the router returns as a 400."""
    # ⭐ P1 HARDENING (2026-10-11) — a runtime document now names the language its
    # source is in (`meta.runtimeLanguage`, stamped by the member door). Every reader
    # here (`runtime_repaint`, the kill list, the allowlist) reads PINE, so a document
    # naming another language is refused rather than classified by the wrong grammar.
    # Absent (a document minted before the stamp) is Pine, as it always was.
    meta = definition.get("meta") if isinstance(definition.get("meta"), dict) else {}
    language = meta.get("runtimeLanguage")
    if language is not None and language != "pine":
        raise ValueError(f"meta.runtimeLanguage: {language!r} is not a language this store reads "
                         "a bar-by-bar script in — only 'pine' is")
    # ⭐ W5-T17 (design 5.2 step 5) — `meta.blockRuns` is the HOST translation's stamp for
    # an `ast` document's per-plot block gates. A runtime document decides its own
    # conditional calls INSIDE the run (a guard at step 6), so one carrying the stamp is
    # malformed and is refused at the door rather than read by the wrong lane.
    if "blockRuns" in meta:
        raise ValueError("meta.blockRuns: only an \"ast\" document carries the per-plot "
                         "block-run gates — a runtime document decides its conditional calls "
                         "inside its own run, so one carrying them is malformed and is not accepted")
    compute = definition.get("compute")
    if not isinstance(compute, dict) or compute.get("kind") != RUNTIME_KIND:
        raise ValueError("definition: not a runtime document")
    source = compute.get("source")
    if not isinstance(source, str) or not source.strip():
        raise ValueError('compute.source: a "runtime" definition carries the script it runs — '
                         "required non-empty string")
    repaint = runtime_repaint.runtime_repaint_of(source)
    if not repaint["ok"]:
        # ⛔ The client door never mints one of these (it declines the route), so
        # a document that arrives with one was not minted by it.
        raise ValueError(f"compute.source: {repaint['why']}, so a runtime document cannot state "
                         "its repaint behaviour and is not accepted")
    # ⭐ RT5 — `objects: true`: the run draws the document's objects itself, so a
    # drawing-only script maps no plot (`defSchema.js::validateRuntimeCompute`).
    own_objects = compute.get("objects")
    if own_objects is not None and own_objects is not True:
        raise ValueError("compute.objects: when present, true (the run draws the document's "
                         f"objects), got {own_objects!r}")
    outputs = compute.get("outputs")
    if not isinstance(outputs, dict) or (not outputs and own_objects is not True):
        raise ValueError('compute.outputs: a "runtime" definition maps each plot key to a '
                         "runtime output index — required non-empty object")
    for key, index in outputs.items():
        if not isinstance(key, str) or not _PLOT_KEY_RE.match(key):
            raise ValueError(f"compute.outputs: {key!r} is not a plot key")
        if not isinstance(index, int) or isinstance(index, bool) or index < 0:
            raise ValueError(f"compute.outputs.{key}: required integer >= 0 (a runtime output "
                             f"index), got {index!r}")
    for k in _AST_ONLY_KEYS:
        if compute.get(k) is not None:
            raise ValueError(f'compute.{k}: only an "ast" definition carries it — a "runtime" '
                             "definition's implementation is its source")
    plots = definition.get("plots")
    if not isinstance(plots, list) or not plots:
        raise ValueError("plots: a runtime document draws at least one plot")
    plot_keys = {p.get("key") for p in plots if isinstance(p, dict)}
    missing = [k for k in outputs if k not in plot_keys]
    if missing:
        raise ValueError(f"compute.outputs: {missing!r} names no plot of this document")
    # ⭐ RT2 — WHAT THE DOCUMENT CLAIMS IS WHAT THE SERVER MEASURES, in both
    # directions (the `ast` lane's rule: under-claiming is as false as over-
    # claiming). The badge (`meta.repaint`) and every drawn row's `forward`
    # window must equal the class re-derived from the source.
    meta = definition.get("meta") if isinstance(definition.get("meta"), dict) else {}
    declared = meta.get("repaint")
    if declared is not None and declared != repaint["mode"]:
        raise ValueError(f"meta.repaint — declared {declared!r} but this script measures "
                         f"{repaint['mode']!r} (it reads "
                         f"{', '.join(r['name'] for r in repaint['reads']) or 'nothing past its own bar'})")
    for p in plots:
        if isinstance(p, dict) and p.get("key") in outputs and "forward" in p                 and p["forward"] != repaint["forward"]:
            raise ValueError(f"plots.{p['key']}.forward — declared {p['forward']!r} but this script "
                             f"reads {repaint['forward']!r} bars ahead")


def request_reads(definition: Any) -> list[str]:
    """W5-T17 — the runtime document's REQUIREMENTS READ: the names of the ``request.*``
    calls in its source that read another symbol or timeframe (the identity request, the
    chart's own symbol at the chart's own timeframe, is not one). ``[]`` when it reads none.

    ONE AUTHORITY: the repaint classifier's own reads (`runtime_repaint_of`), never a
    second scan of the source. A source the classifier cannot read fails CLOSED, as
    ``["<unreadable source>"]``. Never raises."""
    try:
        source = definition["compute"]["source"]
        repaint = runtime_repaint.runtime_repaint_of(source)
    except Exception:  # noqa: BLE001 - fail closed, never raise out of a stamp
        return ["<unreadable source>"]
    if not repaint.get("ok"):
        return ["<unreadable source>"]
    req = runtime_repaint.RULES["requests"]
    return sorted(r["name"] for r in repaint.get("reads") or ()
                  if r["name"] in req["calls"] or r["name"].startswith(req["prefix"]))


def handle(definition: dict) -> str:
    """The `ast_hash` column's value for a runtime document."""
    return HASH_PREFIX + source_hash(definition["compute"]["source"])


def repaint_stamp(definition: dict) -> dict:
    """`{plotKey: mode}` — the same shape `lint_verdict` stores for a tree.

    RT2: the class re-derived here from the source (`runtime_repaint`), the one
    the client door states — never read off the document."""
    mode = runtime_repaint.runtime_repaint_of(definition["compute"]["source"])["mode"]
    return {k: mode for k in definition["compute"]["outputs"]}


def _not_graded_for_stamp(source: Any, budget: "Optional[DetectorBudget]", capability: bool) -> tuple:
    """`not_graded` as a served row asks it: the call before Part 2 (`not_graded(source)`) unless a
    budget or `capability=False` is in play WHILE capability admission is on. With it off neither can
    change the answer, so the call is exactly the one before Part 2 (every caller and test double
    sees the same call)."""
    if (budget is None and capability) or not capability_admission_on():
        return not_graded(source), False
    return not_graded_reason(source, budget=budget, capability=capability)


def stamp_served(row: dict, *, budget: "Optional[DetectorBudget]" = None,
                 capability: bool = True) -> dict:
    """A stored runtime row as SERVED: the kill switch stamped on, never stored.

    Returns a copy; the stored row is not touched.

    ⭐ ENGINE 53 — AND AN ``ast`` ROW THAT ASKS THE RUN FOR SOMETHING: a run half
    (``compute.runtimeObjects``, its drawings) or run-read colours (``compute.runtimeColours``,
    DIV-4). Stamped by the same three rules (the kill list, the stage, the allowlist); the
    client's install door installs the row as ever (its plots are the host's) and the BIND
    refuses only the run's part (`nativeRegistry.js::withRunHalf` / `withRuntimeColours`).
    A stale stamp a client wrote back is dropped, so the row reads today's lists."""
    definition = row.get("definition")
    if run_read_source(definition) is not None:
        return _stamp_run_read_ast(row, definition, budget=budget, capability=capability)
    if not is_runtime(definition):
        return row
    source = (definition.get("compute") or {}).get("source")
    why = killed(row.get("def_id"), source)
    # ⭐ WS-I (S6) — THE STAGE REACHES A SERVED ROW. With `PINE_RUNTIME_STAGE=off`
    # nobody may draw through the lane, so every runtime row read after the
    # switch-off is stamped exactly as a kill is (never stored, never deleted):
    # a tab still latched ON refuses it at its install door on its next read.
    if not why and stage() == STAGE_OFF:
        why = (f"scripts drawn bar by bar are switched off for every member right now "
               f"({STAGE_ENV}={STAGE_OFF}), so this one is not drawn bar by bar")
    # ⭐ GT (D6) — a stored runtime row whose script is not on the starter
    # allowlist is SERVED stamped, never deleted and never rewritten, exactly as
    # a kill is: the install door refuses the stamp, and listing the script
    # brings the row back on the next read.
    # WS-I Part 2: `budget` bounds the fresh detector runs a whole request may do; `capability=False`
    # (a non-latest history version, never drawn) asks no capability question at all.
    ungraded, pending = _not_graded_for_stamp(source, budget, capability)
    if not why and not ungraded:
        return row
    out = dict(row)
    d = json.loads(json.dumps(definition))
    meta = d.get("meta") if isinstance(d.get("meta"), dict) else {}
    if why:
        meta["runtimeKilled"] = why
    if ungraded:
        meta["runtimeNotGraded"] = ungraded
        if pending:
            meta[PENDING_STAMP] = True
    d["meta"] = meta
    out["definition"] = d
    return out


def run_read_source(definition: Any) -> Optional[str]:
    """ENGINE 53 -- the script an ``ast`` document asks the per-bar run to read (its run half's
    ``compute.runtimeObjects.source``, else DIV-4's ``compute.runtimeColours.source``), or
    ``None`` for every other document (a runtime one included: `stamp_served` stamps it as ever)."""
    if not isinstance(definition, dict):
        return None
    compute = definition.get("compute")
    if not isinstance(compute, dict) or compute.get("kind") != "ast":
        return None
    for key in ("runtimeObjects", "runtimeColours"):
        part = compute.get(key)
        if isinstance(part, dict) and isinstance(part.get("source"), str) and part.get("source"):
            return part["source"]
    return None


def _stamp_run_read_ast(row: dict, definition: dict, *, budget: "Optional[DetectorBudget]" = None,
                        capability: bool = True) -> dict:
    """`stamp_served` for an ``ast`` row with a run-read part: today's kill / stage / allowlist
    answer on ``meta``, a stale one dropped. Returns a copy; the stored row is not touched."""
    source = run_read_source(definition)
    why = killed(row.get("def_id"), source)
    if not why and stage() == STAGE_OFF:
        why = (f"scripts drawn bar by bar are switched off for every member right now "
               f"({STAGE_ENV}={STAGE_OFF}), so this one is not drawn bar by bar")
    ungraded, pending = _not_graded_for_stamp(source, budget, capability)
    meta_in = definition.get("meta") if isinstance(definition.get("meta"), dict) else {}
    if not why and not ungraded and not any(k in meta_in for k in RUN_READ_STAMPS):
        return row
    out = dict(row)
    d = json.loads(json.dumps(definition))
    meta = d.get("meta") if isinstance(d.get("meta"), dict) else {}
    for k in RUN_READ_STAMPS:
        meta.pop(k, None)
    if why:
        meta["runtimeKilled"] = why
    if ungraded:
        meta["runtimeNotGraded"] = ungraded
        if pending:
            meta[PENDING_STAMP] = True
    d["meta"] = meta
    out["definition"] = d
    return out


#: ENGINE 53 -- the meta key a run-half document names its own script by (sha256 of the Pine
#: source, UTF-8): `memberPaneDefinition.RUN_HALF_SOURCE_STAMP` on the client.
RUN_HALF_SOURCE_STAMP = "pineSourceSha256"


def run_half_source_refusal(definition: Any, pine_source: Optional[str]) -> Optional[str]:
    """ENGINE 53 -- why this save may not carry its run half, or ``None``.

    A run half (``compute.runtimeObjects``) is drawn only from the document's OWN script: its
    ``source``, the document's stamp (``meta.pineSourceSha256``) and the script saved beside it
    (the row's ``pine_source``) must be one script. A save that carries no script cannot bind
    one, and is refused too. Every document without a run half answers ``None``."""
    if not isinstance(definition, dict):
        return None
    compute = definition.get("compute")
    if not isinstance(compute, dict) or "runtimeObjects" not in compute:
        return None
    ro = compute.get("runtimeObjects")
    src = ro.get("source") if isinstance(ro, dict) else None
    if not isinstance(src, str) or not src:
        return "compute.runtimeObjects: a run half names the script it runs (source)"
    if not isinstance(pine_source, str) or not pine_source:
        return ("compute.runtimeObjects: a run half runs this indicator's own script, and this save "
                "carries no script to bind it to; save it from the script, or without its run half")
    own = source_hash(pine_source)
    if source_hash(src) != own:
        return ("compute.runtimeObjects.source: the run half names a different script from the one "
                "saved with this indicator, so it is not saved")
    meta = definition.get("meta") if isinstance(definition.get("meta"), dict) else {}
    stamp = meta.get(RUN_HALF_SOURCE_STAMP)
    if not isinstance(stamp, str) or stamp.lower() != own:
        return (f"meta.{RUN_HALF_SOURCE_STAMP}: the document does not name the script saved with it, "
                "so its run half is not saved")
    return None


#: ⛔⛔ THE KEYS ON AN ``ast`` DOCUMENT'S ``compute`` THAT CARRY THE AUTHOR'S PINE (each holds the
#: whole script as ``.source``): ENGINE 53's run half and DIV-4's run-read colours. `run_read_source`
#: reads the same two; `without_run_reads` removes both.
RUN_READ_KEYS = ("runtimeObjects", "runtimeColours")

#: The served stamps (`_stamp_run_read_ast`) that answer only for a run-read part: dropped with it.
RUN_READ_STAMPS = ("runtimeKilled", "runtimeNotGraded", "runtimePending")

#: `objectLoss.js::RUN_HALF_DRAWING_SENTENCE`, said on the drawing note of a document carrying a
#: run half (`memberPaneDefinition.js`). A copy without its run half drops it, exactly as the
#: client's own `withoutRunHalf` does. Held to the JS text by
#: `tests/test_share_strips_run_reads.py::test_the_run_half_sentence_is_the_clients`.
RUN_HALF_DRAWING_SENTENCE = (
    "Where this chart can run the script bar by bar the way TradingView does (at the script's own "
    "settings, with every plot agreeing with that run), its drawings are made by that run instead, "
    "complete.")

#: What the door says of a run-read paint (`memberPaneDefinition.js`, the `rtReadLines` note):
#: recognised by this lead, after the paint's own name.
RUN_READ_PAINT_LEAD = " takes its colour from running the script bar by bar"

#: What a copy says instead, of a `barcolor` whose colour only the author's script could compute.
RUN_READ_PAINT_GONE = (" is not drawn: its colour is worked out by running the author's script bar "
                       "by bar, and a shared copy does not carry the script.")


def _paint_name(p: dict) -> str:
    """The door's name for a paint in a disclosure: its kind in backticks, then `` (line N)``."""
    line = p.get("line")
    at = f" (line {line})" if isinstance(line, int) and not isinstance(line, bool) else ""
    return f"`{p.get('kind')}`{at}"


def without_run_reads(definition: Any) -> Any:
    """⛔⛔ THE AUTHOR'S PINE NEVER TRAVELS WITH A SHARE: ``definition`` as it may leave its owner.

    The ONE strip for every path that hands a definition to somebody other than its owner (the
    share preview `user_definitions.resolve_share`, and through it the copy `install_share`
    saves). Never mutates; returns the SAME object when there is nothing to strip, so a plain
    document travels byte for byte as before. Removes:

    * ``compute.runtimeObjects`` (ENGINE 53's run half) and ``compute.runtimeColours`` (DIV-4):
      each carries the whole script as ``.source``;
    * the paints that read a run-read colour column (``colorMode: column:<key>`` for a key of
      ``runtimeColours.keys``) -- without the run that column does not exist, and the schema
      refuses a paint naming it -- and ``paints`` itself when none is left, so the copy is the
      host document the door writes with the runtime lane off (the candles keep their own
      colours);
    * ``meta.pineSourceSha256`` (the script's fingerprint), and with a run-read part the served
      stamps that answered for it (``runtimeKilled``/``runtimeNotGraded``);
    * the disclosures that promised the run: the run half's drawing sentence, and a run-read
      paint's note, which is said again as not drawn.

    ⚠️ NOT A RUNTIME DOCUMENT (``compute.kind == "runtime"``): its ``compute.source`` IS its
    implementation, and is not a run-read part. It is returned unchanged (an open owner call,
    `docs/pine/evidence/2026-11-13-share-strips-run-reads/EVIDENCE.md`)."""
    if not isinstance(definition, dict):
        return definition
    compute = definition.get("compute")
    meta = definition.get("meta")
    present = [k for k in RUN_READ_KEYS if isinstance(compute, dict) and k in compute]
    stamped = isinstance(meta, dict) and RUN_HALF_SOURCE_STAMP in meta
    if not present and not stamped:
        return definition
    out = dict(definition)
    if present:
        out["compute"] = {k: v for k, v in compute.items() if k not in RUN_READ_KEYS}
    gone_meta = {RUN_HALF_SOURCE_STAMP} | (set(RUN_READ_STAMPS) if present else set())
    new_meta = ({k: v for k, v in meta.items() if k not in gone_meta}
                if isinstance(meta, dict) else meta)
    # the run-read colour columns, and the paints that read one
    rc = compute.get("runtimeColours") if "runtimeColours" in present else None
    keys = {k for k in (rc.get("keys") or ()) if isinstance(k, str)} if isinstance(rc, dict) else set()
    dropped: list = []
    if "runtimeColours" in present and isinstance(definition.get("paints"), list):
        kept = []
        for p in definition["paints"]:
            mode = p.get("colorMode") if isinstance(p, dict) else None
            if isinstance(mode, str) and mode.startswith("column:") and (
                    not keys or mode[len("column:"):] in keys):
                dropped.append(p)
            else:
                kept.append(p)
        if kept:
            out["paints"] = kept
        else:
            out.pop("paints", None)
    # the disclosures that promised the run
    if isinstance(new_meta, dict) and isinstance(new_meta.get("disclosures"), list):
        gone_names = {_paint_name(p) for p in dropped}
        tail = " " + RUN_HALF_DRAWING_SENTENCE
        notes = []
        for n in new_meta["disclosures"]:
            note = n.get("note") if isinstance(n, dict) else None
            if isinstance(note, str):
                if "runtimeObjects" in present and note.endswith(tail):
                    n = {**n, "note": note[:-len(tail)]}
                else:
                    name = next((g for g in gone_names if note.startswith(g + RUN_READ_PAINT_LEAD)), None)
                    if name is not None:
                        n = {**n, "note": name + RUN_READ_PAINT_GONE}
            notes.append(n)
        new_meta = {**new_meta, "disclosures": notes}
    if isinstance(meta, dict):
        out["meta"] = new_meta
    return out
