"""HELD WITHHOLDS, SERVER SIDE: A SAVED COPY MINTED BEFORE A WITHHOLD IS REFUSED BY NAME (coordinator ruling 2026-11-19).

The member door honours the narrow withholds licence-held captures ask for (`engine/heldWithholds.js`, part B) on every
NEW mint, and stamps the ones it honoured on the document (``meta.heldWithholds``: sorted `<door>:<scope>:<target>`
keys, `heldWithholds.js::heldWithholdKey`). A copy a member SAVED before a withhold existed keeps its old bytes, and with
them the element a comparison against TradingView found wrong. This is the server half, the twin of
`host_known_divergence.py`: such a copy is refused BY NAME at every door, never silently served with its old bytes.

  * the save door           `user_definitions.save` / `_save_runtime` (a document that does not honour its script's
                            withholds is not stored: a direct API save, a fork, an old tab)
  * a share install         `user_definitions.install_share` (the shared version is judged on its author's script)
  * served rows             `runtime_definitions.stamp_served` (``meta.heldDivergence``: the sentence; the client's
                            install door and the headless compute refuse the stamp, by name)
  * every server lane       `user_definitions.engine_withheld_reason` (alerts, the sweep, screens, backtests, the
                            scannable stamp): a chart never draws what the alerts withhold, or the reverse

A stored copy is OWED a withhold when its script (`ast`: the script stored beside the document; `runtime`: the document's
own `compute.source`) carries one FOR THE DOOR THE COPY WAS MINTED ON (`ast` -> `host`, `runtime` -> `runtime`) that its
stamp does not name. Re-added, the member door mints a copy that stamps it, and it is served again. A withhold the host
door cannot honour narrowly (anything but a drawing family) refuses the whole script there too, so its sentence says
that instead of "add it again".

⛔ ONE AUTHORITY: the committed file `app/src/components/chart/engine/heldWithholds.json` (derived by
`tools/vendor_harness/held_evidence.py --write`, never hand-typed), the same bytes the browser imports. The key is
`heldWithholds.js::heldWithholdKey`'s (`tests/fixtures/held_withhold_keys.json` holds both to the same answers).
⛔ A REFUSAL IS NEVER A DELETE (`feedback_kill_switch_never_a_delete`): a stored row is served stamped and refused, never
rewritten; it is served again the moment its script's withholds are lifted or a copy honouring them replaces it.
⛔ An unreadable or malformed file names NOTHING and is logged loudly (the `host_known_divergence` rule): a broken file
must not take every member's scripts down with it.
⛔ A copy with no script beside it (a studio edit, a Formula, a share install: the author's Pine never travels) cannot be
named by its script and is not refused here; a share install is judged at install time on its author's stored script.
"""
from __future__ import annotations

import hashlib
import json
import logging
import os
import pathlib
import re
import threading
from typing import Any, Iterable, Optional

_log = logging.getLogger("held_withholds")

#: The stable refusal code (registered: `app/src/components/chart/supportLoop/refusalCodes.json`).
GUARD = "pine:held-divergence"
#: The served-row stamp the client's install door and headless compute refuse (`heldWithholds.js::HELD_DIVERGENCE_STAMP`).
STAMP = "heldDivergence"
#: The mint stamp the member door writes (`heldWithholds.js::HELD_WITHHOLDS_STAMP`). Stored, never scrubbed.
MINTED = "heldWithholds"

FILE_PATH = str(pathlib.Path(__file__).resolve().parents[2] / "app" / "src" / "components" / "chart" / "engine"
                / "heldWithholds.json")

#: the door a stored document was minted on, by its lane
DOOR_OF_KIND = {"ast": "host", "runtime": "runtime"}
#: the scopes each door withholds narrowly (the rest refuse the whole script on that door: `memberPaneDefinition.js`)
NARROW_SCOPES = {"host": frozenset({"objectFamily"}),
                 "runtime": frozenset({"output", "outputColour", "paint", "objectFamily"})}

_FAMILY_PLURAL = {"line": "lines", "label": "labels", "box": "boxes", "table": "tables",
                  "linefill": "fills between lines", "polyline": "polylines"}
_HASH_RE = re.compile(r"^[0-9a-f]{64}$")
_lock = threading.Lock()
_cache: dict = {"key": None, "entries": {}}


def source_hash(source: str) -> str:
    """sha256 of the Pine source, UTF-8: the identity every door computes (`heldWithholds.js` uses `sha256Hex`)."""
    return hashlib.sha256(str(source).encode("utf-8")).hexdigest()


def committed() -> dict:
    """``{sha256: [withhold]}`` as committed. Re-read when the file changes (path + mtime + size), never cached past it."""
    path = FILE_PATH
    try:
        st = os.stat(path)
        key = (path, st.st_mtime_ns, st.st_size)
    except OSError:
        _log.error("[held-withholds] %s unreadable: nothing is withheld", path)
        return {}
    with _lock:
        if _cache["key"] == key:
            return _cache["entries"]
    try:
        with open(path, encoding="utf-8") as f:
            doc = json.load(f)
        entries = {s["sha256"]: [w for w in s["withholds"] if isinstance(w, dict)] for s in doc["scripts"]
                   if isinstance(s, dict) and isinstance(s.get("sha256"), str) and _HASH_RE.match(s["sha256"])
                   and isinstance(s.get("withholds"), list)}
    except (OSError, ValueError, KeyError, TypeError):
        _log.exception("[held-withholds] %s malformed: nothing is withheld", path)
        entries = {}
    with _lock:
        _cache["key"], _cache["entries"] = key, entries
    return entries


def withhold_key(w: dict) -> str:
    """`heldWithholds.js::heldWithholdKey`, the same words: `<door>:<scope>:<target>`."""
    scope = w.get("scope")
    target = (f"{w.get('kind')}@{w.get('line')}" if scope == "paint"
              else w.get("family") if scope == "objectFamily" else w.get("title"))
    return f"{w.get('door')}:{scope}:{target}"


def door_of(definition: Any) -> Optional[str]:
    """The door a stored document was minted on (`host` / `runtime`), or None for any other document."""
    compute = definition.get("compute") if isinstance(definition, dict) else None
    return DOOR_OF_KIND.get(compute.get("kind")) if isinstance(compute, dict) else None


def applies_to(definition: Any) -> bool:
    """Is this stored document one a Pine door mints (an `ast` or a `runtime` document)?"""
    return door_of(definition) is not None


def script_of(definition: Any, pine_source: Any = None) -> Optional[str]:
    """The script a stored document was minted from: a runtime document carries its own; an `ast` one has the script
    stored beside it (`pine_source`), or none."""
    door = door_of(definition)
    if door == "runtime":
        src = definition["compute"].get("source")
    elif door == "host":
        src = pine_source
    else:
        return None
    return src if isinstance(src, str) and src else None


def _withholds_of(source: str) -> list:
    entries = committed()
    if not entries:
        return []
    ws = entries.get(source_hash(source))
    if ws is None and "\r\n" in source:
        ws = entries.get(source_hash(source.replace("\r\n", "\n")))
    return ws or []


def owed(definition: Any, pine_source: Any = None) -> list:
    """The withholds this stored copy's script carries, for the door it was minted on, that its stamp does not name."""
    source = script_of(definition, pine_source)
    if source is None:
        return []
    door = door_of(definition)
    ws = [w for w in _withholds_of(source) if w.get("door") == door]
    if not ws:
        return []
    meta = definition.get("meta") if isinstance(definition.get("meta"), dict) else {}
    stamp = meta.get(MINTED)
    honoured = {k for k in stamp if isinstance(k, str)} if isinstance(stamp, list) else set()
    return [w for w in ws if withhold_key(w) not in honoured]


def _what(w: dict) -> str:
    scope = w.get("scope")
    if scope == "outputColour":
        return f"the colour of `{w.get('title')}`"
    if scope == "paint":
        return f"its `{w.get('kind')}` `{w.get('title')}` (line {w.get('line')})"
    if scope == "objectFamily":
        return f"its {_FAMILY_PLURAL.get(w.get('family'), w.get('family'))}"
    return f"`{w.get('title')}`"


#: who reads the sentence: a stored copy being drawn, a document being saved, a shared version being installed
AUDIENCES = ("load", "save", "share")


def _sentence(ws: list, door: str, audience: str) -> str:
    what = "; ".join(_what(w) for w in ws)
    whole = any(w.get("scope") not in NARROW_SCOPES.get(door, frozenset()) for w in ws)
    if whole:
        # the door refuses the script itself: there is no narrower version to add again
        verb = {"load": "drawn", "save": "saved", "share": "installed"}[audience]
        return (f"{GUARD}: this script is not {verb}: a comparison against TradingView found {what} different. It is "
                "withheld until that is fixed, and comes back once a new comparison against TradingView matches.")
    if audience == "save":
        return (f"{GUARD}: this copy is not saved: a comparison against TradingView found {what} different, and this "
                "copy does not withhold it. Add the script again to get the version that withholds it and draws the "
                "rest.")
    if audience == "share":
        return (f"{GUARD}: this shared version is not installed: a comparison against TradingView found {what} "
                "different, and it was saved before that was withheld. The member who shared it can add the script "
                "again and share the new version, which withholds it and draws the rest.")
    return (f"{GUARD}: this saved copy is not drawn: a comparison against TradingView found {what} different, and this "
            "copy was saved before that was withheld. Add the script again to get the version that withholds it and "
            "draws the rest.")


def refused(definition: Any, pine_source: Any = None, *, audience: str = "load") -> Optional[str]:
    """The refusal sentence for a stored (or to-be-stored) copy that does not honour its script's withholds, else
    ``None``. `audience`: ``load`` (a stored copy, drawn or run), ``save`` (the save door), ``share`` (a share
    install or preview, judged on the author's stored script)."""
    if audience not in AUDIENCES:
        raise ValueError(f"audience {audience!r} is not one of {AUDIENCES}")
    ws = owed(definition, pine_source)
    return _sentence(ws, door_of(definition), audience) if ws else None


def census(rows: Iterable) -> dict:
    """SAVED COPIES BY COUNT, per script the committed file names: ``{sha256: {"copies", "owed", "byDoor"}}``.

    `rows` are stored rows (``definition`` as stored JSON text or a dict, ``pine_source`` when the row holds one): the
    live newest version of each saved definition (`user_definitions.held_withholds_census`). Counts only: no member,
    no definition id, no script text leaves this function. ⛔ Run it on a local copy of the tables, never on production
    from a session (the coordinator's rule for this census)."""
    entries = committed()
    out = {sha: {"copies": 0, "owed": 0, "byDoor": {"host": 0, "runtime": 0}} for sha in entries}
    if not entries:
        return out
    for row in rows:
        try:
            definition = row["definition"]
        except (KeyError, IndexError, TypeError):
            continue
        if isinstance(definition, str):
            try:
                definition = json.loads(definition)
            except ValueError:
                continue
        try:
            pine_source = row["pine_source"]
        except (KeyError, IndexError, TypeError):
            pine_source = None
        source = script_of(definition, pine_source)
        if source is None:
            continue
        sha = source_hash(source)
        if sha not in entries and "\r\n" in source:
            sha = source_hash(source.replace("\r\n", "\n"))
        if sha not in entries:
            continue
        c = out[sha]
        c["copies"] += 1
        c["byDoor"][door_of(definition)] += 1
        if owed(definition, pine_source):
            c["owed"] += 1
    return out
