"""THE HOST LANE'S KNOWN-DIVERGENCE LIST, SERVER SIDE (owner decision 2026-11-17).

The runtime lane has a committed kill list (`api/data/pine_runtime_killlist.json`, read by
`runtime_definitions.kill_list`): a listed script falls back OFF the runtime lane at every door. This is
the HOST lane's twin. Every script with a committed TradingView capture that grades DIVERGE on the
production (host) lane is listed by the sha256 of its source, and every host door refuses it BY NAME
(`GUARD`, the sentence `refused` returns):

  * the save door           `user_definitions.save`            (a Pine `ast` document carrying a listed script)
  * served rows             `runtime_definitions.stamp_served` (``meta.hostKnownDivergence``; the client's
                                                                install door refuses the stamp)
  * alerts, the sweep, on-demand screens, backtests and the scannable stamp
                            `user_definitions.engine_withheld_reason` (the one question every server lane asks)

⛔ ONE AUTHORITY: the committed file `app/src/components/chart/engine/hostKnownDivergence.json` (under app/src
so the browser bundle imports the same bytes: `engine/hostKnownDivergence.js` reads it for the member preview
and the install door). It is GENERATED (`tools/vendor_harness/host_divergence.py --write`), never hand-typed,
and `tests/test_pine_host_known_divergence.py` re-derives it from the committed verdicts both ways.

⛔ A REFUSAL IS NEVER A DELETE (`feedback_kill_switch_never_a_delete`): a stored row is served stamped and
withheld, never rewritten; it comes back the moment its script is unlisted.
⛔ An unreadable or malformed file lists NOTHING extra and is logged loudly: the rail fails it in CI, and a
broken file must not take every member's scripts down with it (the same rule as `committed_kills`).
"""
from __future__ import annotations

import hashlib
import json
import logging
import os
import pathlib
import re
import threading
from typing import Any, Optional

_log = logging.getLogger("host_known_divergence")

#: The stable refusal code (registered: `app/src/components/chart/supportLoop/refusalCodes.json`).
GUARD = "pine:known-divergence"
#: The served-row stamp the client's install door refuses (`nativeRegistry.validateUserDefinitions`).
STAMP = "hostKnownDivergence"

LIST_PATH = str(pathlib.Path(__file__).resolve().parents[2] / "app" / "src" / "components" / "chart"
                / "engine" / "hostKnownDivergence.json")

_HASH_RE = re.compile(r"^[0-9a-f]{64}$")
_lock = threading.Lock()
_cache: dict = {"key": None, "entries": {}}


def source_hash(source: str) -> str:
    """sha256 of the Pine source, UTF-8: the identity every door computes (`runtime_definitions.source_hash`)."""
    return hashlib.sha256(str(source).encode("utf-8")).hexdigest()


def committed() -> dict:
    """``{sha256: entry}`` as committed. Re-read when the file changes (path + mtime), never cached past it."""
    path = LIST_PATH
    try:
        st = os.stat(path)
        key = (path, st.st_mtime_ns, st.st_size)
    except OSError:
        _log.error("[host-known-divergence] %s unreadable: nothing is listed", path)
        return {}
    with _lock:
        if _cache["key"] == key:
            return _cache["entries"]
    try:
        with open(path, encoding="utf-8") as f:
            doc = json.load(f)
        entries = {s["sha256"]: s for s in doc["scripts"]
                   if isinstance(s, dict) and isinstance(s.get("sha256"), str) and _HASH_RE.match(s["sha256"])}
    except (OSError, ValueError, KeyError, TypeError):
        _log.exception("[host-known-divergence] %s malformed: nothing is listed", path)
        entries = {}
    with _lock:
        _cache["key"], _cache["entries"] = key, entries
    return entries


def sentence(entry: dict) -> str:
    """What a member reads: the stable code, what differs on which captured chart, and that it is withheld
    until that is fixed (`engine/hostKnownDivergence.js::hostKnownDivergenceSentence`, the same words)."""
    return (f"{GUARD}: this script is not drawn: {entry.get('reason')}. It is withheld until that is fixed, "
            "and comes back once a new comparison against TradingView matches.")


def refused(source: Any) -> Optional[str]:
    """The refusal sentence when this Pine source is on the host known-divergence list, else ``None``."""
    if not isinstance(source, str) or not source:
        return None
    entries = committed()
    if not entries:
        return None
    e = entries.get(source_hash(source))
    if e is None and "\r\n" in source:
        e = entries.get(source_hash(source.replace("\r\n", "\n")))
    return sentence(e) if e is not None else None


def applies_to(definition: Any) -> bool:
    """Is this stored document drawn by the HOST lane? (A runtime document is the runtime lane's: its own
    kill list governs it.)"""
    compute = definition.get("compute") if isinstance(definition, dict) else None
    return isinstance(compute, dict) and compute.get("kind") == "ast"
