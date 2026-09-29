"""TERM-039 (FB-S12-02) — member-facing feature status, DERIVED, never typed.

A member should be able to tell an unfinished capability from a broken one. This
module answers, per request, "which member-facing capabilities are here for THIS
member, and is any of them an early preview?" — and it answers ONLY what the server
can vouch for.

⛔⛔ TWO SOURCES, EACH THE ONLY AUTHORITY OVER ITS HALF, AND NEITHER RESTATED HERE.

  * WHICH capabilities are member-facing, and what a member calls them, is INTENT, and
    intent lives in `docs/feature_flags.json`: an entry that carries
    `"member_facing": {"label", "where"[, "payload_key"]}`. Nothing in this module or in
    the client names a capability — a hand-kept "here today / working on" list beside the
    flags that own the truth is the defect the spec names (DOC-1), and
    `tests/test_feature_status.py::test_labels_live_only_in_the_ledger` holds it out.
  * WHETHER a capability is on for this member RIGHT NOW is a live value on Railway, and
    this module never reads the environment for it. `project` is handed the payload
    `_access_payload` has just built — the same per-request readers the tabs and pages
    already obey — so the strip and the surface cannot disagree about one flag.

⛔ WHAT EACH STATE MEANS, and what it is never allowed to mean:

  * `released` — the payload says True and the reader did not restrict it to a subset.
    On for everyone it is on for.
  * `preview`  — the payload says True for THIS member, and the reader's live value is a
    restricted rollout (today: the owner-preview spelling `admin` on the Data Charts
    increments, `auth._preview_payload_keys`). This is the BETA mark. It is derived from
    the rollout scope, so it disappears on its own the moment the flag reaches everyone —
    "beta" can never become a permanent label somebody forgot to remove.
  * `unknown`  — the ledger declares the capability but the payload carries no boolean
    for it, so the server cannot vouch either way. Rendered as "not measured", NEVER
    dropped as if it were off and NEVER shown as released.
  * off        — the payload says False. The capability is NOT LISTED. A dark surface must
    be indistinguishable from a surface that does not exist (`rollout_gate.require_cohort`
    for the same reason returns FastAPI's own 404), so announcing it here would be a
    disclosure nobody decided on. Off is therefore silence, and silence is only ever off:
    a missing key is `unknown`, never silence.

⛔ AND WHEN THE LEDGER ITSELF CANNOT BE READ, THE WHOLE ANSWER IS `measured: False`.
The client renders that as "status not available", which is a different sentence from
"nothing here" — an empty strip would read as a product with no features.

⛔ NEVER RAISES. `_access_payload` is the universal auth path (signup, login, /me); an
exception here is a login outage, not a missing strip. `auth._feature_status` wraps the
call as well, so a defect in this module degrades to `measured: False`.
"""
from __future__ import annotations

import json
import logging
import os
from pathlib import Path
from typing import Iterable, Optional

log = logging.getLogger(__name__)

#: The ledger. Shipped with the image (`Dockerfile.web` copies the git tree), read at
#: request time through the cache below. Tests repoint this attribute.
LEDGER_PATH = Path(__file__).resolve().parents[2] / "docs" / "feature_flags.json"

RELEASED = "released"
PREVIEW = "preview"
UNKNOWN = "unknown"

#: The answer when the ledger cannot be read. A fresh dict per call so no caller can
#: mutate a shared one.
def not_measured() -> dict:
    return {"measured": False, "features": []}


#: (path, mtime_ns, size) -> declarations. Keyed on the FILE'S IDENTITY, not on a clock:
#: a relabel in the ledger reaches the next request, and an unchanged ledger costs one
#: stat per request rather than a 160 KB parse.
_cache: dict = {"key": None, "decls": None}


def _read_declarations(path: Path) -> Optional[list]:
    doc = json.loads(path.read_text(encoding="utf-8"))
    flags = doc.get("flags") if isinstance(doc, dict) else None
    if not isinstance(flags, dict):
        return None
    out = []
    for name, entry in flags.items():
        mf = entry.get("member_facing") if isinstance(entry, dict) else None
        if not isinstance(mf, dict):
            continue
        label, where = mf.get("label"), mf.get("where")
        if not (isinstance(label, str) and label.strip()
                and isinstance(where, str) and where.strip()):
            # A declaration the strip cannot name is not shown under a made-up name.
            # The ledger rail keeps real entries well-formed; this is the runtime floor.
            log.warning("[feature_status] %s: member_facing without label/where; skipped", name)
            continue
        key = mf.get("payload_key") or str(name).lower()
        out.append({"id": str(key), "label": label.strip(), "where": where.strip()})
    return out


def declarations() -> Optional[list]:
    """The ledger's member-facing declarations, or None when the ledger is unreadable."""
    path = Path(LEDGER_PATH)
    try:
        st = os.stat(path)
    except OSError:
        return None
    key = (str(path), st.st_mtime_ns, st.st_size)
    if _cache["key"] == key:
        return _cache["decls"]
    try:
        decls = _read_declarations(path)
    except (OSError, ValueError):
        log.exception("[feature_status] ledger unreadable at %s", path)
        decls = None
    _cache["key"], _cache["decls"] = key, decls
    return decls


def project(payload: dict, preview_ids: Iterable[str] = ()) -> dict:
    """The `feature_status` field: every declared capability this member can see, with
    its state, from the payload the server just built. See the module header for what
    each state may and may not mean."""
    decls = declarations()
    if decls is None:
        return not_measured()
    preview = frozenset(preview_ids)
    features = []
    for d in decls:
        value = payload.get(d["id"])
        if not isinstance(value, bool):
            state = UNKNOWN
        elif value is False:
            continue
        elif d["id"] in preview:
            state = PREVIEW
        else:
            state = RELEASED
        features.append({**d, "state": state})
    features.sort(key=lambda f: (f["where"].lower(), f["label"].lower()))
    return {"measured": True, "features": features}
