"""RE-TRANSLATE (b), PR (3a): the store of SERVER translations of a member's held script documents.

Track 6, `design_retranslate_b.md` section 2/3, with the coordinator's conditions (2026-11-22):

* ⛔⛔ NEVER WRITES `user_definitions` AND NEVER CREATES A VERSION. A server translation is an
  engine-keyed DERIVED artifact beside the member's versions, in its own table
  (`definition_server_translations`, declared with the store's schema in `user_definitions._SCHEMA`).
  This module issues exactly one kind of write, an ``INSERT OR IGNORE`` into that table (railed by
  AST and by a fingerprint of `user_definitions` before and after).
* UNIQUE ``(user_id, def_id, version, engine)``: one artifact per stored version per engine. A
  second answer for the same key is ignored, never an overwrite.
* SUPERSEDED ARTIFACTS ARE IGNORED, NEVER DELETED. `current_for` answers only the artifact of the
  row's OWN version at TODAY's engine; an artifact for an older version (the member saved again) or
  an older engine stays in the table, read by nobody. This module has no DELETE (railed). The only
  delete is account erasure (`user_definitions_erasure.MEMBER_TABLES` lists the table).
* SWITCH: ``PINE_SERVER_RETRANSLATE`` (``off`` | ``on``, read per call, default off). Off: `current_for`
  answers ``None`` for everyone, so every reader behaves exactly as today; nothing is deleted.
  Armed only on the coordinator's OK, after one measured night.

Nothing here translates (the pine-runtime service does, PR (2)), runs a job (PR (3b)) or changes a
served answer (the read path is PR (4)). Fail closed: an unreadable artifact is no artifact.
"""
from __future__ import annotations

import contextlib
import json
import logging
import os
import time
from typing import Any, Mapping, Optional

log = logging.getLogger("server_translations")

TABLE = "definition_server_translations"
FLAG_ENV = "PINE_SERVER_RETRANSLATE"
STATUSES = ("accepted", "refused")
MODE_OFF, MODE_ON = "off", "on"
#: A MODE flag (`feature_flag_index.mode_flags` reads this table: the default and the vocabulary are the
#: literals the code falls back to). Ledger row: docs/feature_flags.json.
SERVER_TRANSLATION_MODE_FLAGS = {
    "PINE_SERVER_RETRANSLATE": (MODE_OFF, (MODE_OFF, MODE_ON)),
}


def enabled() -> bool:
    """``PINE_SERVER_RETRANSLATE == "on"``, read per call. Default OFF; any other value is off."""
    default = SERVER_TRANSLATION_MODE_FLAGS[FLAG_ENV][0]
    return os.environ.get(FLAG_ENV, default).strip().lower() == MODE_ON


def _conn():
    from api.services import user_definitions
    c = user_definitions._connect()
    user_definitions._ensure(c)
    return c


def record(user_id: Any, def_id: str, version: int, engine: int, *, status: str,
           guard: Optional[str] = None, reason: Optional[str] = None,
           document: Optional[Mapping[str, Any]] = None, maths_identity: Optional[str] = None,
           digest: Optional[str] = None, created_at: Optional[float] = None) -> bool:
    """Append ONE server translation. ``True`` when it landed, ``False`` when the key already holds one
    (the first answer for a key stands). An ``accepted`` artifact carries its document and its maths
    identity; a ``refused`` one carries its guard and its reason."""
    if status not in STATUSES:
        raise ValueError(f"status must be one of {STATUSES}, got {status!r}")
    for name, v in (("user_id", user_id), ("def_id", def_id)):
        if not isinstance(v, str) or not v:
            raise ValueError(f"{name} must be a non-empty str, got {v!r}")
    for name, v in (("version", version), ("engine", engine)):
        if isinstance(v, bool) or not isinstance(v, int) or v < 0:
            raise ValueError(f"{name} must be a non-negative int, got {v!r}")
    if status == "accepted":
        if not isinstance(document, Mapping) or not isinstance(maths_identity, str) or not maths_identity:
            raise ValueError("an accepted translation carries its document and its maths identity")
        doc_text = json.dumps(document, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False)
    else:
        if not isinstance(guard, str) or not guard or not isinstance(reason, str) or not reason:
            raise ValueError("a refused translation carries its guard and its reason")
        doc_text = None
    from api.services import user_definitions
    at = float(created_at) if created_at is not None else time.time()
    with user_definitions._WRITE_LOCK, contextlib.closing(_conn()) as c:
        cur = c.execute(
            "INSERT OR IGNORE INTO definition_server_translations (user_id, def_id, version, engine, status, "
            "guard, reason, document_json, maths_identity, digest, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            (user_id, def_id, int(version), int(engine), status, guard, (reason or "")[:500] or None,
             doc_text, maths_identity, digest, at))
        c.commit()
        return cur.rowcount == 1


def current_for(row: Mapping[str, Any], engine: Optional[int] = None) -> Optional[dict]:
    """The server translation that answers for ``row`` (a stored version: ``user_id``, ``def_id``,
    ``version``) at ``engine`` (default: today's script engine), or ``None``: the switch is off, there
    is none for this version at this engine (an artifact for another version or engine is superseded
    and ignored), or it cannot be read (fail closed)."""
    if not enabled():
        return None
    try:
        if engine is None:
            from api.services import user_definitions
            engine = user_definitions.SCRIPT_ENGINE_VERSION
        if engine is None:
            return None
        key = (str(row["user_id"]), str(row["def_id"]), int(row["version"]), int(engine))
        with contextlib.closing(_conn()) as c:
            got = c.execute(
                "SELECT status, guard, reason, document_json, maths_identity, digest, created_at, engine "
                "FROM definition_server_translations WHERE user_id=? AND def_id=? AND version=? AND engine=?",
                key).fetchone()
        if got is None:
            return None
        out = dict(got)
        doc = out.pop("document_json")
        out["document"] = json.loads(doc) if doc is not None else None
        if out["status"] == "accepted" and not isinstance(out["document"], dict):
            return None
        return out
    except Exception:  # noqa: BLE001 -- an unreadable artifact is no artifact
        log.exception("[server-translations] unreadable artifact; ignored")
        return None
