"""The knowledge source policy, read per request (never at import). Default-deny.

A source string from the Brain Pack (`knowledge_base.source`) is classified as:
  admitted   listed under `sources` with admit=true  -> may be retrieved and cited
  pending    listed with admit=false                 -> excluded, reported as an approval candidate
  excluded   matched by a `prefix_classes` row       -> excluded with its licence class and reason
  unknown    anything else                           -> excluded (a new source the owner has not seen)
"""
from __future__ import annotations

import datetime
import json
import os
import re
import time
from pathlib import Path
from typing import Optional

ENV_PATH = "UCT_AGENT_KNOWLEDGE_POLICY"
DEFAULT_PATH = Path(__file__).resolve().parents[4] / "docs" / "agent" / "knowledge" / "policy.json"

_cache: dict = {"path": None, "key": None, "data": None}

# A file whose mtime is this close to "now" may still be rewritten inside the same mtime tick, so a cache hit on it is
# not trusted (git's "racily clean" rule). Only the first moments after an edit pay a re-read.
RACY_WINDOW_NS = 2_000_000_000


def file_key(st: os.stat_result) -> tuple:
    """Cache key for a small config file: (mtime_ns, size). The float st_mtime alone served a STALE file when two
    writes landed in one mtime tick; the size catches almost every such rewrite at zero extra I/O."""
    return (st.st_mtime_ns, st.st_size)


def cache_hit(entry: dict, p: Path, st: os.stat_result) -> bool:
    """True when `entry` (path/key/data) still describes `p`. A same-size rewrite inside one mtime tick keeps the key,
    so a file modified within RACY_WINDOW_NS of now is always re-read instead of trusted."""
    return (entry["path"] == str(p) and entry["key"] == file_key(st)
            and time.time_ns() - st.st_mtime_ns > RACY_WINDOW_NS)


def path() -> Path:
    return Path(os.environ.get(ENV_PATH) or DEFAULT_PATH)


def load() -> dict:
    """The policy, re-read when the file changes. A missing or broken file is an EMPTY policy (deny all)."""
    p = path()
    try:
        st = p.stat()
    except OSError:
        return _empty("policy file missing")
    if cache_hit(_cache, p, st):
        return _cache["data"]
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
        if not isinstance(data, dict) or not isinstance(data.get("sources"), dict):
            raise ValueError("bad shape")
    except (OSError, ValueError):
        return _empty("policy file unreadable")
    _cache.update(path=str(p), key=file_key(st), data=data)
    return data


def _empty(why: str) -> dict:
    return {"policy_version": 0, "sources": {}, "prefix_classes": [], "error": why}


def version() -> int:
    try:
        return int(load().get("policy_version") or 0)
    except (TypeError, ValueError):
        return 0


def classify(source: Optional[str]) -> dict:
    """{state, licence, label, reason} for one source string. Never raises."""
    pol = load()
    s = str(source or "").strip()
    for pc in pol.get("prefix_classes") or []:      # review N2: an excluded prefix wins over any named key
        if isinstance(pc, dict) and s.startswith(str(pc.get("prefix") or "\0")):
            return {"state": "excluded", "licence": pc.get("licence") or "unresolved", "label": s,
                    "reason": pc.get("reason") or "excluded by policy"}
    row = pol.get("sources", {}).get(s)
    if isinstance(row, dict):
        if row.get("admit") is True:
            return {"state": "admitted", "licence": row.get("licence") or "unresolved",
                    "label": row.get("label") or s, "reason": ""}
        return {"state": "pending", "licence": row.get("licence") or "unresolved",
                "label": row.get("label") or s, "reason": row.get("pending") or "not approved"}
    return {"state": "unknown", "licence": "unresolved", "label": s or "(blank)",
            "reason": "a source the policy does not list (default-deny)"}


_CLEARED_FIELDS = ("template", "provenance_ref", "rights_review_ref", "approved_by", "approved_on")


def rights_cleared(name: Optional[str]) -> Optional[dict]:
    """The rights-cleared concept entry for this template, only when EVERY required field is present."""
    for e in (load().get("templates") or {}).get("rights_cleared_concepts") or []:
        if isinstance(e, dict) and str(e.get("template") or "") == str(name or "") \
                and all(str(e.get(f) or "").strip() for f in _CLEARED_FIELDS):
            return e
    return None


def classify_template(origin_trader: Optional[str], name: Optional[str] = None) -> dict:
    """A setup template's source is its origin_trader (the table has no source column). Default-deny: only an origin
    listed in templates.team_origins is admitted, or a template on the rights-cleared concept list (empty until a
    provenance + rights review clears one); an unresolved origin and every other origin are excluded."""
    t = load().get("templates") or {}
    o = str(origin_trader or "").strip()
    cleared = rights_cleared(name) if name else None
    if cleared:
        return {"state": "admitted", "licence": "team_authored_concept_rights_cleared",
                "label": f"a team-authored concept explanation (rights review {cleared['rights_review_ref']})",
                "reason": "", "provenance_ref": cleared["provenance_ref"], "rights_review_ref": cleared["rights_review_ref"]}
    team = {str(x).strip().lower() for x in t.get("team_origins") or []}
    unresolved = {str(x).strip().lower() for x in t.get("unresolved_origins") or []}
    if team and o.lower() in team:
        return {"state": "admitted", "licence": t.get("team_licence") or "team_owned",
                "label": f"a UCT team setup template (origin: {o})", "reason": ""}
    if o.lower() in unresolved:
        return {"state": "excluded", "licence": "unresolved", "label": f"a setup template (origin: {o or 'unknown'})",
                "reason": "its origin is not resolved to approved team-owned content"}
    return {"state": "excluded", "licence": t.get("other_licence") or "third_party_methodology",
            "label": f"a setup template from {o}'s published methodology",
            "reason": "third-party methodology is not approved team-owned content"}


def classify_record(key: str) -> dict:
    """A setup-record source (team_archive, setup_performance, trigger_performance). Default-deny."""
    row = (load().get("records") or {}).get(key)
    if isinstance(row, dict) and row.get("admit") == "conditional":
        return {"state": "conditional", "licence": row.get("licence") or "unresolved", "label": row.get("label") or key,
                "reason": "", "methodology_id": row.get("methodology_id"), "methodology": row.get("methodology")}
    if isinstance(row, dict) and row.get("admit") is True:
        return {"state": "admitted", "licence": row.get("licence") or "unresolved", "label": row.get("label") or key,
                "reason": ""}
    if isinstance(row, dict):
        return {"state": "pending", "licence": row.get("licence") or "unresolved", "label": row.get("label") or key,
                "reason": row.get("pending") or "not approved"}
    return {"state": "unknown", "licence": "unresolved", "label": key, "reason": "a record source the policy does not list"}


_CLEARED_ROW_FIELDS = ("kb_id", "content_sha", "provenance_ref", "rights_review_ref", "approved_by", "approved_on")
_SHA = re.compile(r"^[0-9a-f]{64}$")


_APPROVER = re.compile(r"^(?=.*[A-Za-z])[A-Za-z0-9 .'@_-]{2,80}$")


def _approved_on_ok(v) -> bool:
    """An ISO calendar date (YYYY-MM-DD) that exists and is not in the future (UTC)."""
    s = str(v or "").strip()
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", s):
        return False
    try:
        d = datetime.date.fromisoformat(s)
    except ValueError:
        return False
    return d <= datetime.datetime.now(datetime.timezone.utc).date()


def cleared_row_ids() -> dict:
    """{kb_id: content_sha} for policy.cleared_rows entries with EVERY required field present (provenance + rights
    review) and well formed (review #751 note 3: a positive integer kb_id, an approver name, an ISO approval date not
    in the future; delta 3: the sha256 content_sha of the text that was reviewed, as the index records it). The caller
    serves a cleared row only while its current content_sha matches, so changed text loses its clearance. Any other
    entry is ignored, so its row stays withheld."""
    out = {}
    for e in load().get("cleared_rows") or []:
        if not (isinstance(e, dict) and all(str(e.get(f) or "").strip() for f in _CLEARED_ROW_FIELDS)):
            continue
        if not (_APPROVER.match(str(e["approved_by"]).strip()) and _approved_on_ok(e["approved_on"])):
            continue
        sha = str(e["content_sha"]).strip().lower()
        if not _SHA.match(sha):
            continue
        k = e["kb_id"]
        if isinstance(k, bool):
            continue
        try:
            k = int(str(k).strip())
        except (TypeError, ValueError):
            continue
        if k > 0:
            out[k] = sha
    return out


MENTIONS_WITHHOLD, MENTIONS_SERVE_FLAGGED = "withhold", "serve_flagged"


def excluded_mentions_mode() -> str:
    """Review #751 delta 6 (owner directive 2026-11-04, withhold uncertain): an admitted row that NAMES an excluded
    setup is withheld unless cleared ("withhold", the default and what any value but "serve_flagged" means). The owner
    may re-admit those rows as a block, served flagged commentary_only, with "serve_flagged"."""
    v = str((load().get("excluded_setup_mentions") or {}).get("mode") or "").strip().lower() \
        if isinstance(load().get("excluded_setup_mentions"), dict) else ""
    return MENTIONS_SERVE_FLAGGED if v == MENTIONS_SERVE_FLAGGED else MENTIONS_WITHHOLD


def admitted_sources() -> list[str]:
    """Admitted keys, re-checked through classify() so a key under an excluded prefix can never be admitted."""
    return sorted(k for k, v in load().get("sources", {}).items()
                  if isinstance(v, dict) and v.get("admit") is True and classify(k)["state"] == "admitted")


def excluded_categories() -> set[str]:
    return {str(c).upper() for c in load().get("excluded_categories") or []}


def dated_categories() -> set[str]:
    return {str(c).upper() for c in load().get("dated_categories") or []}


def dated_max_age_days() -> int:
    return _int(load().get("dated_max_age_days"), 30)


def trader(name: Optional[str]) -> str:
    n = str(name or "").strip()
    return str((load().get("trader_aliases") or {}).get(n, n))


def search_setting(key: str, default: int) -> int:
    return _int((load().get("search") or {}).get(key), default)


HARD_N_MIN = 30          # owner rule: no figure below 30 outcomes; policy.json may raise it, never lower it


def stats_n_min() -> int:
    return max(HARD_N_MIN, _int((load().get("stats") or {}).get("n_min"), HARD_N_MIN))


def pack_setting(key: str, default: int) -> int:
    return _int((load().get("pack") or {}).get(key), default)


def _int(v, default: int) -> int:
    try:
        return int(v)
    except (TypeError, ValueError):
        return default
