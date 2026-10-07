"""Market Cap V1 RELEASE CONTRACT -- the manifest and the authority pointer (schema + verification).

LIFECYCLE
    source inputs -> immutable input snapshot (hashes + provenance) -> builder -> immutable candidate build ->
    validation gates -> published immutable artifacts -> release manifest -> AUTHORITY pointer -> member reader.

A refresh never mutates anything: it produces a NEW build id, NEW objects and a NEW write-once manifest, and only then
may the pointer move. Rollback is the pointer moving back (N+1 -> N); nothing is rebuilt or deleted.

KEYS (private bucket; `marketcap_pit/v1/` prefix):
    obj/<sha256>.json.gz                     serving document (artifacts.py), content-addressed, write-once
    builds/<build_id>/manifest.json          THE release manifest, write-once
    builds/<build_id>/build.db.gz            the immutable build DB (audit / forensic), write-once
    builds/<build_id>/validation.json        the release-gate report, write-once
    AUTHORITY.json                           the ONLY mutable object: which build members read
    status.json                              the refresh heartbeat (never authority)

The pointer names an EXACT manifest (key + sha256) -- never "latest", never a listing. A reader proves
pointer -> manifest sha -> build id -> document sha -> bytes before serving a single value.
"""
from __future__ import annotations

import re

PREFIX = "marketcap_pit/v1"
AUTHORITY_KEY = f"{PREFIX}/AUTHORITY.json"
STATUS_KEY = f"{PREFIX}/status.json"
MANIFEST_FORMAT = 1
POINTER_FORMAT = 1
COMPATIBLE_DOC_FORMATS = (1,)
BUILD_ID_RE = re.compile(r"^MCAP_V1-\d{8}T\d{6}Z$")
SHA_RE = re.compile(r"^[0-9a-f]{64}$")
ACCEPTANCE = ("HUMAN_CUTOVER", "AUTOMATED_REFRESH", "ROLLBACK")


class ContractError(ValueError):
    pass


# ⛔⛔ REVOKED BUILDS -- a build listed here can NEVER be published, pointed at (advance / rollback / cutover), pinned
# (MCAP_PIT_PIN) or served, whatever a manifest, pointer or operator says. Matched by build id AND by DB sha256, so a
# re-wrapped copy of the same DB under a new build id is refused too. Append-only: an entry is never removed.
REVOKED_BUILDS = {
    "MCAP_V1-20261005T205248Z": {
        "db_sha256": "fae1dbb5701d28cd857d3a8d2bf7a5f6e6f7f9d05bfe73b6208fdb373624a7ba",
        "reason": "REJECTED first M3 build (diagnostic only): its offering gate shifted Obs.public_at, changing split-basis"
                  " and validator decisions (OPTH/SURG/CTM holds, an ACOG value, label drift). Superseded by"
                  " MCAP_V1-20261005T234206Z (accepted M3, 20/20 holds).",
    },
}
REVOKED_DB_SHA = {v["db_sha256"]: k for k, v in REVOKED_BUILDS.items()}


def assert_not_revoked(build_id: str | None = None, db_sha256: str | None = None) -> None:
    if build_id in REVOKED_BUILDS:
        raise ContractError(f"{build_id} is REVOKED: {REVOKED_BUILDS[build_id]['reason']}")
    if db_sha256 in REVOKED_DB_SHA:
        raise ContractError(f"build DB {db_sha256[:16]} is REVOKED ({REVOKED_DB_SHA[db_sha256]})")


def obj_key(sha: str) -> str:
    if not SHA_RE.match(sha or ""):
        raise ContractError(f"not a sha256: {sha!r}")
    return f"{PREFIX}/obj/{sha}.json.gz"


def build_prefix(build_id: str) -> str:
    if not BUILD_ID_RE.match(build_id or ""):
        raise ContractError(f"not a Market Cap V1 build id: {build_id!r}")
    return f"{PREFIX}/builds/{build_id}"


def manifest_key(build_id: str) -> str:
    return f"{build_prefix(build_id)}/manifest.json"


def db_key(build_id: str) -> str:
    return f"{build_prefix(build_id)}/build.db.gz"


def validation_key(build_id: str) -> str:
    return f"{build_prefix(build_id)}/validation.json"


# Every key a manifest must carry, and its type. Extra keys are allowed (additive evolution); missing ones are not.
MANIFEST_FIELDS = {
    "format": int, "dataset": str, "build_id": str,
    "methodology": dict,            # methodology.identity(): version, commit, semantics, files_digest
    "code": dict,                   # {"commit", "tree", "dirty"}
    "inputs": dict,                 # {"snapshot_id", "files": {name: {"sha256", "bytes"}}, "provenance": {...}}
    "build": dict,                  # {"started_at", "finished_at", "db_sha256", "db_bytes"}
    "knowledge": dict,              # {"latest_valued_session", "filing_knowledge_cutoff", "latest_harvest_at", ...}
    "artifacts": dict,              # {"documents": {ticker: sha}, "census": {...}, "db": {...}}
    "validation": dict,             # {"key", "sha256", "status", "gates": {...}}
    "schema": dict,                 # {"document_format", "compatible_readers"}
    "published_at": str,
}


def validate_manifest(m: dict, *, build_id: str | None = None) -> None:
    """Raise ContractError unless `m` is a complete, self-consistent, PASSED release manifest."""
    if not isinstance(m, dict):
        raise ContractError("manifest is not an object")
    for k, t in MANIFEST_FIELDS.items():
        if k not in m:
            raise ContractError(f"manifest lacks {k}")
        if not isinstance(m[k], t):
            raise ContractError(f"manifest {k} is not {t.__name__}")
    if m["format"] != MANIFEST_FORMAT:
        raise ContractError(f"unsupported manifest format {m['format']}")
    if m["dataset"] != "MCAP_V1":
        raise ContractError("manifest is not MCAP_V1")
    build_prefix(m["build_id"])
    assert_not_revoked(m["build_id"], (m.get("build") or {}).get("db_sha256"))
    assert_not_revoked(None, ((m.get("artifacts") or {}).get("db") or {}).get("sha256"))
    if build_id is not None and m["build_id"] != build_id:
        raise ContractError(f"manifest names {m['build_id']}, expected {build_id}")
    if m["schema"].get("document_format") not in COMPATIBLE_DOC_FORMATS:
        raise ContractError("documents are in a format this reader does not understand")
    if m["validation"].get("status") != "PASS":
        raise ContractError(f"validation status {m['validation'].get('status')!r} -- only PASS is releasable")
    for k in ("key", "sha256"):
        if not m["validation"].get(k):
            raise ContractError(f"validation lacks {k}")
    docs = m["artifacts"].get("documents")
    if not isinstance(docs, dict) or not docs:
        raise ContractError("manifest names no documents")
    for t, s in docs.items():
        if not SHA_RE.match(str(s)):
            raise ContractError(f"document sha for {t} is malformed")
    for k in ("latest_valued_session", "filing_knowledge_cutoff"):
        if not m["knowledge"].get(k):
            raise ContractError(f"knowledge lacks {k}")
    db = m["artifacts"].get("db") or {}
    if not (SHA_RE.match(str(db.get("sha256", ""))) and db.get("key") == db_key(m["build_id"])):
        raise ContractError("manifest does not name its immutable build DB")
    if m["build"].get("db_sha256") != db.get("sha256"):
        raise ContractError("build db sha and artifact db sha disagree")
    if m["code"].get("dirty"):
        raise ContractError("built from a dirty tree")


def make_pointer(manifest_sha: str, build_id: str, *, previous: dict | None, at: str, by: str, reason: str,
                 acceptance: str) -> dict:
    """`human_rooted`: True when this authority was put in place by a human (cutover / rollback), or by automated
    refreshes descending from such a move. An automated advance is only ever allowed from a human-rooted authority."""
    if acceptance not in ACCEPTANCE:
        raise ContractError(f"acceptance must be one of {ACCEPTANCE}")
    if not reason or not by:
        raise ContractError("a pointer move needs `by` and `reason`")
    p = {"format": POINTER_FORMAT, "build_id": build_id, "manifest_key": manifest_key(build_id),
         "manifest_sha256": manifest_sha, "previous": None, "advanced_at": at, "by": by, "reason": reason,
         "acceptance": acceptance,
         "human_rooted": acceptance in ("HUMAN_CUTOVER", "ROLLBACK") or bool(previous and previous.get("human_rooted"))}
    if acceptance == "AUTOMATED_REFRESH" and not (previous and previous.get("human_rooted")):
        raise ContractError("an automated advance needs a human-rooted authority to advance from")
    if previous:
        p["previous"] = {"build_id": previous["build_id"], "manifest_sha256": previous["manifest_sha256"]}
    validate_pointer(p)
    return p


def validate_pointer(p: dict) -> None:
    if not isinstance(p, dict) or p.get("format") != POINTER_FORMAT:
        raise ContractError("pointer format unsupported")
    build_prefix(p.get("build_id", ""))
    assert_not_revoked(p["build_id"])
    if p.get("manifest_key") != manifest_key(p["build_id"]):
        raise ContractError("pointer manifest_key does not match its build id")
    if not SHA_RE.match(str(p.get("manifest_sha256", ""))):
        raise ContractError("pointer manifest sha malformed")
    if p.get("acceptance") not in ACCEPTANCE:
        raise ContractError("pointer acceptance unknown")
    if not isinstance(p.get("human_rooted"), bool):
        raise ContractError("pointer lacks human_rooted")
