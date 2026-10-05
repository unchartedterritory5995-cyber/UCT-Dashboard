"""A2 (2026-10-04) — a member's PINE SOURCE, kept with their document.

Owner rulings (integrator, 2026-10-04, `docs/pine/member-authoring-plan.md` §5):

* **O1 — store it, private by default.** A document saved from the Pine Editor
  carries the script the member wrote in ``meta.pineSource``. It is NEVER read
  for compute: the trees (an ``ast`` document) or the lane's own source (a
  runtime document's ``compute.source``, a hybrid's ``objectsRun.source``) stay
  the authority over what is drawn. The source is what lets the editor REOPEN a
  saved script, update it in place and restore an older version.
* **O1 — strip it when the document leaves its owner.** A share link and the
  public library redistribute a document. The Pine text rides along ONLY when
  its own header declares a permissive licence — the predicate is
  ``tools/pine_survey/corpus_licence.py::is_permitted`` (MPL-2.0 / MIT /
  Apache-2.0), imported, never restated. Anything else is removed from the
  recipient's copy. ⛔ FAIL CLOSED: an unreadable predicate is "not permitted".
  ⛔ A RUNTIME or HYBRID document's source IS its implementation, so it cannot
  be stripped without breaking the copy — such a document is REFUSED at the
  share/list door (and again at resolve) unless every Pine text it carries is
  permissive.
* **O3 — a per-member stage, ``PINE_AUTHORING_STAGE``** (``off`` · ``admins`` ·
  ``all``; unset, empty or unrecognised read ``off``), modelled on
  ``runtime_definitions.PINE_RUNTIME_STAGE``. It rides the auth payload as
  ``pine_authoring_enabled`` (``api/routers/auth.py::_pine_authoring_flag``) and
  the client's Pine Editor tab needs BOTH it and the build flag
  ``VITE_PINE_AUTHORING_ENABLED``. The save door asks the same question: a
  member the stage does not admit never has a NEW source stored (it is dropped,
  and the save reports ``pine_source: withheld``). An EXISTING source is carried
  across a rename regardless — the stage gates authoring, it never deletes.

⛔ THE STORE'S OWNERSHIP RULE IS UNCHANGED AND IS THE PRIVACY GUARANTEE. Every
read in ``user_definitions`` is keyed on the CALLER's ``user_id``; a member
cannot address another member's row at all. The only ways out are the share
token and the library, and both go through ``for_recipient`` here.
"""
from __future__ import annotations

import json
import os
from typing import Any, Optional

# ─── O3: the rollout stage ───────────────────────────────────────────────────
STAGE_ENV = "PINE_AUTHORING_STAGE"
STAGE_OFF = "off"
STAGE_ADMINS = "admins"
STAGE_ALL = "all"
STAGES = (STAGE_OFF, STAGE_ADMINS, STAGE_ALL)

#: ⭐ A MODE TABLE so `feature_flag_index.mode_flags()` derives it (the name
#: carries no ENABLED marker). ⛔ The default is OFF: unset exposes nothing.
#: ⚠️ The KEY is a string literal on purpose: the index reads a constant key.
PINE_AUTHORING_MODE_FLAGS = {"PINE_AUTHORING_STAGE": (STAGE_OFF, (STAGE_OFF, STAGE_ADMINS, STAGE_ALL))}
assert STAGE_ENV in PINE_AUTHORING_MODE_FLAGS


def stage() -> str:
    """`PINE_AUTHORING_STAGE`, read PER CALL. ⛔ Anything unrecognised is ``off``."""
    v = os.environ.get(STAGE_ENV, STAGE_OFF).strip().lower()
    return v if v in STAGES else STAGE_OFF


def permitted(role: Any) -> bool:
    """May THIS member author Pine (see the editor, store a new source)?

    ⛔ A missing role is a MEMBER's, never an admin's."""
    s = stage()
    if s == STAGE_ALL:
        return True
    if s == STAGE_ADMINS:
        return role == "admin"
    return False


def withheld_sentence() -> str:
    s = stage()
    who = "no member" if s == STAGE_OFF else "admins only"
    return (f"the Pine Editor is switched on for {who} right now ({STAGE_ENV}={s}), "
            "so this script's source was not kept with it")


# ─── O1: the field ───────────────────────────────────────────────────────────
#: ``meta.pineSource`` — ``meta`` is IGNORE-AND-PRESERVE in `defSchema.js`, so the
#: shipped install door carries it without a schema change.
SOURCE_FIELD = "pineSource"
#: Stamped on a RECIPIENT's copy when the source was removed, with the reason.
WITHHELD_FIELD = "pineSourceWithheld"
#: The source's own cap. ⛔ It is NOT counted against the formula's 64 KiB (or
#: the runtime document's 128 KiB): those caps size the maths, and a long,
#: well-commented script must not make a small formula unsaveable. A row's worst
#: case is therefore its compute cap + this.
PINE_SOURCE_MAX_BYTES = 128 * 1024

_RUNTIME_KIND = "runtime"
_OBJECTS_RUN = "objectsRun"


def _meta(definition: Any) -> dict:
    m = definition.get("meta") if isinstance(definition, dict) else None
    return m if isinstance(m, dict) else {}


def lane_source(definition: Any) -> Optional[str]:
    """The Pine a document COMPUTES from, when its lane carries one: a runtime
    document's ``compute.source``, a hybrid's ``objectsRun.source``. ``None`` for
    a plain ``ast`` document (its ``compute.source`` is a FORMULA, not Pine)."""
    if not isinstance(definition, dict):
        return None
    compute = definition.get("compute")
    if isinstance(compute, dict) and compute.get("kind") == _RUNTIME_KIND:
        src = compute.get("source")
        return src if isinstance(src, str) else None
    run = definition.get(_OBJECTS_RUN)
    if isinstance(compute, dict) and compute.get("kind") == "ast" and isinstance(run, dict):
        src = run.get("source")
        return src if isinstance(src, str) else None
    return None


def stored_source(definition: Any) -> Optional[str]:
    src = _meta(definition).get(SOURCE_FIELD)
    return src if isinstance(src, str) and src.strip() else None


def source_of(definition: Any) -> Optional[str]:
    """The script a member would reopen: ``meta.pineSource``, else the lane's own."""
    return stored_source(definition) or lane_source(definition)


def without_source(definition: dict) -> dict:
    """A shallow copy with ``meta.pineSource`` removed — what the compute caps see."""
    meta = _meta(definition)
    if SOURCE_FIELD not in meta:
        return definition
    out = dict(definition)
    out["meta"] = {k: v for k, v in meta.items() if k != SOURCE_FIELD}
    return out


def _with_source(definition: dict, src: Optional[str]) -> dict:
    out = without_source(definition)
    if src is not None:
        out = dict(out)
        out["meta"] = dict(_meta(out), **{SOURCE_FIELD: src})
    return out


def settle_for_save(definition: dict, prev_definition: Optional[dict], *,
                    same_maths: bool, role: Any) -> tuple[dict, dict]:
    """``(document to store, report)`` — the save door's whole rule for the source.

    * ``meta.pineSource`` a string → size-checked (``ValueError`` over the cap),
      dropped if the saving member's stage does not admit authoring (report
      ``withheld``), dropped as a duplicate when it equals the lane's own source
      (report ``stored``: the reopen reads the lane's copy), else kept.
    * ``meta.pineSource`` ``None`` → an explicit "forget the source"; removed.
    * absent → the previous version's source is CARRIED when the maths did not
      move (a rename, a colour), so a read-modify-write that never knew about the
      field cannot silently delete it. A maths change with no source means the
      script no longer describes the document; nothing is carried.
    * anything else → ``ValueError`` naming the field.
    """
    meta = _meta(definition)
    if SOURCE_FIELD in meta:
        src = meta.get(SOURCE_FIELD)
        if src is None:
            return without_source(definition), {"pine_source": "none"}
        if not isinstance(src, str):
            raise ValueError(f"meta.{SOURCE_FIELD}: the member's Pine script — expected a string, "
                             f"got {type(src).__name__}")
        size = len(src.encode("utf-8"))
        if size > PINE_SOURCE_MAX_BYTES:
            raise ValueError(f"meta.{SOURCE_FIELD}: the script is {size} bytes, over this store's "
                             f"{PINE_SOURCE_MAX_BYTES}-byte cap for a Pine source — nothing was saved")
        if not src.strip():
            return without_source(definition), {"pine_source": "none"}
        if not permitted(role):
            return without_source(definition), {"pine_source": "withheld",
                                                 "reason": withheld_sentence()}
        if src == lane_source(definition):
            return without_source(definition), {"pine_source": "stored"}
        return definition, {"pine_source": "stored"}
    prev_src = stored_source(prev_definition) if prev_definition else None
    if prev_src is not None and same_maths:
        if prev_src == lane_source(definition):
            return definition, {"pine_source": "carried"}
        return _with_source(definition, prev_src), {"pine_source": "carried"}
    if lane_source(definition):
        return definition, {"pine_source": "stored"}
    return definition, {"pine_source": "none"}


def summary(definition: Any) -> Optional[dict]:
    """What a LIST row says about the source without carrying it."""
    src = source_of(definition)
    if src is None:
        return None
    return {"bytes": len(src.encode("utf-8")), "licence": licence_of(src)}


def for_listing(row: dict) -> dict:
    """A list row with ``meta.pineSource`` replaced by ``pine_source`` (a summary).

    ⭐ The list is read on the CHART path for every installed definition; the
    source is needed only to reopen one script, and ``GET /{def_id}`` serves it.
    ⛔ A runtime/hybrid document keeps its lane source — it computes from it."""
    definition = row.get("definition")
    out = dict(row)
    out["pine_source"] = summary(definition)
    if isinstance(definition, dict) and SOURCE_FIELD in _meta(definition):
        out["definition"] = without_source(definition)
    return out


# ─── O1: the licence, at every door a document leaves its owner by ───────────
UNREADABLE = "UNREADABLE"


def _corpus_licence():
    from tools.pine_survey import corpus_licence  # noqa: PLC0415 — the ONE authority
    return corpus_licence


def licence_of(text: Optional[str]) -> str:
    """The licence the script's own header declares (``corpus_licence.detect``).

    ⛔ FAIL CLOSED: a predicate that cannot be imported or raises reads as
    ``UNREADABLE``, which is never permitted."""
    try:
        return str(_corpus_licence().detect(text or ""))
    except Exception:  # noqa: BLE001
        return UNREADABLE


def redistributable(text: Optional[str]) -> bool:
    """True ONLY for an explicit MPL-2.0 / MIT / Apache-2.0 header."""
    try:
        return bool(_corpus_licence().is_permitted(text or ""))
    except Exception:  # noqa: BLE001
        return False


class NotRedistributable(ValueError):
    """A document whose Pine IS its implementation and is not licensed to travel."""


def share_refusal(definition: Any) -> Optional[str]:
    """Why this document may not leave its owner AT ALL, or ``None``.

    Only a runtime/hybrid document can be refused: its source is compute. A plain
    ``ast`` document always travels — with its source stripped when needed."""
    lane = lane_source(definition)
    if lane is None:
        return None
    if redistributable(lane):
        return None
    which = "runs from" if (definition.get("compute") or {}).get("kind") == _RUNTIME_KIND \
        else "draws its objects from"
    return (f"this script {which} its Pine source, and that source declares "
            f"{licence_of(lane)} rather than an MPL-2.0, MIT or Apache-2.0 licence in its header, "
            "so it is not shared or listed — a copy could not run without redistributing it")


def for_recipient(definition: dict) -> dict:
    """The document as anyone OTHER than its owner receives it.

    ⛔ Raises ``NotRedistributable`` for a runtime/hybrid document whose source is
    not permissive. Otherwise returns a deep copy with ``meta.pineSource`` removed
    unless permissive, and ``meta.pineSourceWithheld`` saying why it was."""
    why = share_refusal(definition)
    if why:
        raise NotRedistributable(why)
    doc = json.loads(json.dumps(definition))
    meta = _meta(doc)
    meta.pop(WITHHELD_FIELD, None)
    src = meta.get(SOURCE_FIELD)
    if src is not None and not (isinstance(src, str) and redistributable(src)):
        meta.pop(SOURCE_FIELD, None)
        meta[WITHHELD_FIELD] = (
            f"the author's Pine source declares {licence_of(src if isinstance(src, str) else '')} "
            "rather than an MPL-2.0, MIT or Apache-2.0 licence in its header, so it was not "
            "shared — this copy draws the same indicator, but cannot be opened as Pine")
    if meta or "meta" in doc:
        doc["meta"] = meta
    return doc
