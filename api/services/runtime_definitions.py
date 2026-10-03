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

⛔ THE SERVER NEVER TRUSTS THE CLIENT'S IDENTITY OR VERDICT. The source hash is
recomputed here from ``compute.source``; the repaint class is re-derived here
by ``runtime_repaint.runtime_repaint_of`` — the mirror of the client door's
``engine/runtime/runtimeRepaint.js``, over the same rule table, held to one
answer per corpus script by ``tests/test_runtime_repaint.py`` (RT2).
"""
from __future__ import annotations

import hashlib
import json
import os
import re
from typing import Any, Optional

from api.services import runtime_repaint

#: The compute kind this module owns.
RUNTIME_KIND = "runtime"

SAVE_ENV = "PINE_RUNTIME_SAVE_ENABLED"
KILL_ENV = "PINE_RUNTIME_KILL_LIST"

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


def handle(definition: dict) -> str:
    """The `ast_hash` column's value for a runtime document."""
    return HASH_PREFIX + source_hash(definition["compute"]["source"])


def repaint_stamp(definition: dict) -> dict:
    """`{plotKey: mode}` — the same shape `lint_verdict` stores for a tree.

    RT2: the class re-derived here from the source (`runtime_repaint`), the one
    the client door states — never read off the document."""
    mode = runtime_repaint.runtime_repaint_of(definition["compute"]["source"])["mode"]
    return {k: mode for k in definition["compute"]["outputs"]}


def stamp_served(row: dict) -> dict:
    """A stored runtime row as SERVED: the kill switch stamped on, never stored.

    Returns a copy; the stored row is not touched."""
    definition = row.get("definition")
    if not is_runtime(definition):
        return row
    why = killed(row.get("def_id"), definition["compute"].get("source"))
    if not why:
        return row
    out = dict(row)
    d = json.loads(json.dumps(definition))
    meta = d.get("meta") if isinstance(d.get("meta"), dict) else {}
    meta["runtimeKilled"] = why
    d["meta"] = meta
    out["definition"] = d
    return out
