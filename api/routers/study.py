"""Study — the drill product's API (spec §7.1 router table, §13.2 T5/T9/T10/
T11/T17, §13.7 D6/D7/D18, §8).

  GET  /api/study/map                     skill map (docs/study/skill_map.json) + the member's bands
  GET  /api/study/today                   Today's Study, created lazily; prompts + visible bars inline
  POST /api/study/sessions                {kind, skill_id} → a practice/skill/checkpoint/refresher set;
                                          kind 'unit' = the skill's walk-throughs first (max 3), then scored
  GET  /api/study/items/{id}              prompt only
  GET  /api/study/items/{id}/bars         visible bars; "symbol" is the item id
  POST /api/study/attempts                scores server-side; returns correct/score/reveal (+forward bars)
  POST /api/study/attempts/{id}/step      next n forward bars — only after an attempt exists
  GET/PUT /api/study/profile
  GET  /api/study/leaderboard             weekly XP, opt-outs excluded
  GET  /api/study/admin/review            drafts by lane / type / skill (admin)
  POST /api/study/admin/review/{id}       approve | fix | reject (admin)
  POST /api/study/import                  bank upsert (PUSH_SECRET); bars via get_bars_before ONLY
  GET  /api/study/admin/corrections/export

⛔ THE KILL SWITCH IS READ PER REQUEST. `STUDY_ENABLED` unset or anything but
0/false/no/off means ON (it is a kill switch on a shipped product, the
HUB_PREVIEW_ENABLED polarity); off hides every route behind the framework's
own 404 so the product is indistinguishable from a route that does not exist
(the `_curriculum_armed` precedent). A module-level capture would need a
redeploy to flip, which is the rollback this switch exists to avoid.

⛔ `require_paid` is LOCAL with its own 402 sentence (T11). `require_admin`
and `get_current_user` are the shared middleware's.

⛔ `sym` and forward bars never leave this module before a scored attempt
(§8.4): the only reads are `study_store.get_item_prompt` / `get_visible_bars`
(which cannot return them) and the two post-attempt doors. `tests/
test_study_no_sym_leak.py` walks every member response shape.
"""
from __future__ import annotations

import json
import os
from datetime import date, timedelta
from typing import Any, Optional

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel

from api.middleware.auth_middleware import (
    get_current_user_with_plan,
    is_paid_user,
    require_admin,
)
from api.services import study_import, study_scoring, study_select, study_store

router = APIRouter(prefix="/api/study", tags=["study"])

_OFF_VALUES = ("0", "false", "no", "off")
#: Item types whose reveal carries forward bars (the chart types).
_CHART_REVEAL_TYPES = {"spot", "levels", "next", "tap", "grade", "family", "call_scan",
                       "call_archive", "listen", "autopsy"}
#: Forward bars served on the reveal; the rest come through /step.
REVEAL_FORWARD_BARS = 20
STEP_MAX = 60


def study_enabled() -> bool:
    """READ PER REQUEST — never captured at import (T10)."""
    return os.environ.get("STUDY_ENABLED", "1").strip().lower() not in _OFF_VALUES


def _armed() -> None:
    if not study_enabled():
        raise HTTPException(status_code=404, detail="Not Found")


def require_paid(user: dict = Depends(get_current_user_with_plan)) -> dict:
    """Dependency: Study is a paid surface (admins + paid plans + trial)."""
    if not is_paid_user(user):
        raise HTTPException(status_code=402, detail="Study requires a paid plan")
    return user


def require_push_secret(authorization: str = Header(default="")) -> None:
    secret = os.environ.get("PUSH_SECRET", "")
    token = authorization[7:] if authorization.lower().startswith("bearer ") else ""
    if not secret or token != secret:
        raise HTTPException(status_code=401, detail="Unauthorized")


_ARMED = [Depends(_armed)]


# ── Models ────────────────────────────────────────────────────────────────────

class SessionIn(BaseModel):
    kind: str = "free"                 # daily | skill | checkpoint | refresher | free
    skill_id: Optional[str] = None
    size: int = study_select.SET_SIZE


class AttemptIn(BaseModel):
    item_id: str
    answer: Any = None
    session_id: Optional[str] = None
    time_ms: Optional[int] = None


class StepIn(BaseModel):
    n: int = 1
    offset: int = REVEAL_FORWARD_BARS


class ProfileIn(BaseModel):
    daily_goal: Optional[int] = None
    reminder_time: Optional[str] = None
    reminder_on: Optional[bool] = None
    leaderboard_optout: Optional[bool] = None
    journal_autopsy_optin: Optional[bool] = None
    placement_json: Optional[Any] = None
    display_name: Optional[str] = None


class ReviewIn(BaseModel):
    action: str                        # approve | fix | reject
    reason: Optional[str] = None
    field: Optional[str] = None
    after: Any = None


class TrustIn(BaseModel):
    state: str                         # manual | sampled
    sample_rate: Optional[float] = None


class ImportIn(BaseModel):
    items: list[dict] = []
    terms: list[dict] = []


# ── Helpers ───────────────────────────────────────────────────────────────────

def _skill_map() -> dict:
    """docs/study/skill_map.json when present (Phase 0 deliverable), else {}."""
    here = os.path.dirname(os.path.abspath(__file__))
    path = os.path.join(here, "..", "..", "docs", "study", "skill_map.json")
    try:
        with open(path, encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return {}


def _prompt_or_404(item_id: str) -> dict:
    p = study_store.get_item_prompt(item_id)
    if not p:
        raise HTTPException(status_code=404, detail="Item not found")
    return p


def _set_payload(user_id: str, session: dict) -> dict:
    """Prompts + visible bars inline for a session (T5), with the ids already
    answered so a resume reads "Continue · 6 left" (D18)."""
    items = []
    for iid in session.get("item_ids") or []:
        p = study_store.get_item_prompt(iid)
        if not p:
            continue
        if p.get("has_chart"):
            p["bars"] = study_store.get_visible_bars(iid)
        items.append(p)
    return {
        "session_id": session["id"],
        "kind": session.get("kind"),
        "day_et": session.get("day_et"),
        "items": items,
        "answered_item_ids": study_store.answered_item_ids(user_id, session["id"]),
        "finished_at": session.get("finished_at"),
    }


def _bank_query():
    return study_store.list_bank()


# ── Member routes ─────────────────────────────────────────────────────────────

@router.get("/map", dependencies=_ARMED)
def get_map(user: dict = Depends(require_paid)):
    """The skill map (a stub reading docs/study/skill_map.json) plus this
    member's skill rows so the trail can colour its nodes."""
    return {"map": _skill_map(), "skills": study_store.list_skills(user["id"])}


@router.get("/today", dependencies=_ARMED)
def get_today(user: dict = Depends(require_paid)):
    """Today's Study for this ET day — created lazily on first read (T9: no
    06:30 fan-out job). Bars ride inline (T5)."""
    uid = user["id"]
    day = study_store.et_day_of()
    session = study_store.get_daily_session(uid, day)
    if session is None:
        ids = study_select.compose_today(uid, _bank_query)
        session = study_store.create_session(uid, "daily", ids, day_et=day)
    payload = _set_payload(uid, session)
    payload["profile"] = _profile_view(study_store.get_profile(uid))
    return payload


@router.post("/sessions", dependencies=_ARMED)
def post_session(body: SessionIn, user: dict = Depends(require_paid)):
    """A skill / checkpoint / refresher / free set. `skill_id` narrows the
    bank; a kind of 'daily' returns today's set instead of a second one."""
    uid = user["id"]
    if body.kind == "daily":
        return get_today(user)
    if body.kind not in ("skill", "checkpoint", "refresher", "free", "unit"):
        raise HTTPException(status_code=400, detail="kind must be daily|skill|checkpoint|refresher|free|unit")
    if body.kind == "unit" and not body.skill_id:
        raise HTTPException(status_code=400, detail="a unit session needs a skill_id")
    n = max(1, min(30, int(body.size or study_select.SET_SIZE)))

    def bank():
        rows = study_store.list_bank()
        if body.skill_id:
            rows = [r for r in rows if r["skill_id"] == body.skill_id]
        return rows

    if body.kind == "unit":
        # §13.9 #1: the unit's walk-throughs first (max 3, prompt_json.order
        # then id), then the scored items as today composes them.
        ids = study_select.compose_unit(uid, body.skill_id, bank, n=n)
    else:
        due_slots = 0 if body.kind in ("skill", "checkpoint") else study_select.DUE_SLOTS
        ids = study_select.compose_today(uid, bank, n=n, due_slots=due_slots)
    session = study_store.create_session(uid, body.kind, ids, skill_id=body.skill_id)
    return _set_payload(uid, session)


@router.get("/items/{item_id}", dependencies=_ARMED)
def get_item(item_id: str, _user: dict = Depends(require_paid)):
    """Prompt only — no key, no ticker, no forward bars."""
    return _prompt_or_404(item_id)


@router.get("/items/{item_id}/bars", dependencies=_ARMED)
def get_item_bars(item_id: str, _user: dict = Depends(require_paid)):
    """Visible bars; the `symbol` field is the item id (§6.1)."""
    _prompt_or_404(item_id)
    bars = study_store.get_visible_bars(item_id)
    if not bars:
        raise HTTPException(status_code=404, detail="No chart for this item")
    return bars


@router.post("/attempts", dependencies=_ARMED)
def post_attempt(body: AttemptIn, user: dict = Depends(require_paid)):
    """Score server-side, write the attempt in ONE transaction, return the
    reveal (ticker, dates, provenance, lesson, and for chart items the first
    forward bars). Must answer in < 300 ms (D6): one read + one write."""
    uid = user["id"]
    item = study_store.get_item_full(body.item_id)
    if not item or item.get("review_status") != study_store.STATUS_APPROVED:
        raise HTTPException(status_code=404, detail="Item not found")
    verdict = study_scoring.score(item["type"], body.answer, item.get("answer_json"))
    result = study_store.record_attempt(
        uid, item["id"], body.answer, verdict.correct, verdict.score,
        time_ms=body.time_ms, session_id=body.session_id, unscored=verdict.unscored)
    reveal = study_store.reveal_for(item)
    reveal["detail"] = verdict.detail
    if item.get("bars_ref") or item["type"] in _CHART_REVEAL_TYPES:
        fwd = study_store.get_forward_bars(item["id"])
        reveal["forward_bars"] = fwd[:REVEAL_FORWARD_BARS]
        reveal["forward_total"] = len(fwd)
    # A walk-through (§13.9 #1) is recorded as seen: `unscored` true, `score`
    # null, XP 0, and the player skips the reveal card on this flag.
    return {"attempt_id": result["attempt_id"], "item_id": item["id"],
            "correct": verdict.correct, "score": verdict.score,
            "unscored": bool(result.get("unscored")), "reveal": reveal,
            "progress": {k: result[k] for k in ("xp_gained", "xp", "level", "streak",
                                                "streak_best", "due_at", "weekly_xp",
                                                "daily_done")},
            "skill": result["skill"]}


@router.post("/attempts/{attempt_id}/step", dependencies=_ARMED)
def post_step(attempt_id: int, body: StepIn, user: dict = Depends(require_paid)):
    """Forward bars beyond the reveal, `n` at a time from `offset` — ONLY when
    a scored attempt by this member exists for the item (§6.1)."""
    att = study_store.get_attempt(attempt_id)
    if not att or att.get("user_id") != user["id"]:
        raise HTTPException(status_code=404, detail="Attempt not found")
    fwd = study_store.get_forward_bars(att["item_id"])
    off = max(0, int(body.offset))
    n = max(1, min(STEP_MAX, int(body.n)))
    chunk = fwd[off:off + n]
    return {"item_id": att["item_id"], "offset": off, "bars": chunk,
            "next_offset": off + len(chunk), "done": off + len(chunk) >= len(fwd),
            "forward_total": len(fwd)}


def _profile_view(p: dict) -> dict:
    out = dict(p)
    for k in ("reminder_on", "leaderboard_optout", "journal_autopsy_optin"):
        out[k] = bool(out.get(k))
    return out


@router.get("/profile", dependencies=_ARMED)
def get_profile(user: dict = Depends(require_paid)):
    p = study_store.get_profile(user["id"])
    return {"profile": _profile_view(p), "badges": study_store.list_badges(user["id"])}


@router.put("/profile", dependencies=_ARMED)
def put_profile(body: ProfileIn, user: dict = Depends(require_paid)):
    patch = {k: v for k, v in body.model_dump().items() if v is not None}
    p = study_store.update_profile(user["id"], patch)
    return {"profile": _profile_view(p)}


@router.get("/leaderboard", dependencies=_ARMED)
def get_leaderboard(week: Optional[str] = None, user: dict = Depends(require_paid)):
    """This week at the Desk: top 10 by weekly XP + you. Opt-outs excluded."""
    week_et = week or study_store.week_of(study_store.et_day_of())
    try:
        date.fromisoformat(week_et)
    except ValueError:
        raise HTTPException(status_code=400, detail="week must be YYYY-MM-DD")
    return study_store.leaderboard(week_et, user_id=user["id"])


# ── Admin review (graduated trust, §13.9 #3) ─────────────────────────────────

@router.get("/admin/review", dependencies=_ARMED)
def admin_review(lane: Optional[str] = None, type: Optional[str] = None, skill: Optional[str] = None,
                 limit: int = 150, _admin: dict = Depends(require_admin)):
    drafts = study_store.list_drafts(lane=lane, item_type=type, skill=skill, limit=max(1, min(500, limit)))
    types = sorted({d["type"] for d in drafts})
    return {"drafts": drafts, "counts": study_store.draft_counts(), "skills": study_store.draft_skill_counts(),
            "trust": {t: study_store.trust_state(t) for t in types}}


@router.get("/admin/items/{item_id}/bars", dependencies=_ARMED)
def admin_item_bars(item_id: str, _admin: dict = Depends(require_admin)):
    """The reviewer's chart: the member's visible window PLUS the forward strip,
    for an item in ANY review state. The member route (`/items/{id}/bars`)
    serves approved items only and never the forward bars; the review screen
    needs both, because the owner judges a draft by what the member will see
    AND by what happened next. `symbol` is the item id (§6.1), as everywhere."""
    vis = study_store.get_visible_bars(item_id, approved_only=False)
    if not vis:
        raise HTTPException(status_code=404, detail="No chart for this item")
    vis["forward"] = study_store.get_forward_bars(item_id)
    return vis


@router.post("/admin/review/{item_id}", dependencies=_ARMED)
def admin_review_item(item_id: str, body: ReviewIn, admin: dict = Depends(require_admin)):
    try:
        return study_store.review(item_id, body.action, admin.get("id") or admin.get("email") or "admin",
                                  reason=body.reason, field=body.field, after=body.after)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/admin/trust/{item_type}", dependencies=_ARMED)
def admin_trust(item_type: str, body: TrustIn, _admin: dict = Depends(require_admin)):
    """The owner's answer to "switch this type to sampled?"."""
    try:
        return study_store.set_trust_state(item_type, body.state, sample_rate=body.sample_rate)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/admin/corrections/export", dependencies=_ARMED)
def admin_corrections_export(since_id: int = 0, limit: int = 5000,
                             _admin: dict = Depends(require_admin)):
    rows = study_store.export_corrections(since_id=since_id, limit=max(1, min(20000, limit)))
    return {"corrections": rows, "next_since_id": rows[-1]["id"] if rows else since_id}


# ── Import (PUSH_SECRET) ──────────────────────────────────────────────────────

def _ymd_key(asof: str) -> int:
    return int(str(asof).replace("-", "")[:8])


def _key_from_date(d: date) -> int:
    return int(d.strftime("%Y%m%d"))


_FORWARD_HORIZON_DAYS = {"D": 2, "W": 10, "M": 45}   # calendar days per forward bar


def resolve_bars(spec: dict) -> dict:
    """Resolve an item's `bars` spec against the server's OWN bars.db through
    `bars_sqlite.get_bars_before` ONLY — never a provider fetch (B3). Returns
    {ok, bars_id, visible, forward, sha256, reason}. A sha256 recorded at
    authoring time that disagrees with the server's bars is a miss
    ("sha_mismatch": the bars changed; re-author)."""
    from api.services import bars_sqlite
    sym = str(spec.get("sym") or "").upper()
    tf = str(spec.get("tf") or "D")
    window = int(spec.get("window") or 120)
    forward_n = int(spec.get("forward") or 20)
    asof_key = spec.get("asof_key")
    if asof_key is None and spec.get("asof"):
        if tf in _FORWARD_HORIZON_DAYS:
            asof_key = _ymd_key(spec["asof"])
    if not sym or asof_key is None:
        return {"ok": False, "reason": "bad_spec"}
    asof_key = int(asof_key)
    visible_rows = bars_sqlite.get_bars_before(sym, tf, window, asof_key)
    if not visible_rows:
        return {"ok": False, "reason": "no_bars", "sym": sym, "tf": tf}
    fwd_to = spec.get("forward_to_key")
    if fwd_to is None and tf in _FORWARD_HORIZON_DAYS:
        d = date(asof_key // 10000, (asof_key // 100) % 100, asof_key % 100)
        fwd_to = _key_from_date(d + timedelta(days=forward_n * _FORWARD_HORIZON_DAYS[tf] + 7))
    forward_rows: list = []
    if fwd_to is not None and forward_n > 0:
        later = bars_sqlite.get_bars_before(sym, tf, window + forward_n + 50, int(fwd_to))
        forward_rows = [r for r in later if int(r[0]) > asof_key][:forward_n]
    to_bar = lambda r: {"t": r[0], "o": r[1], "h": r[2], "l": r[3], "c": r[4], "v": r[5]}  # noqa: E731
    visible = [to_bar(r) for r in visible_rows]
    forward = [to_bar(r) for r in forward_rows]
    digest = study_store.bars_sha256(visible)
    if spec.get("sha256") and str(spec["sha256"]).lower() != digest:
        return {"ok": False, "reason": "sha_mismatch", "sym": sym, "tf": tf,
                "expected": spec["sha256"], "got": digest}
    return {"ok": True, "tf": tf, "visible": visible, "forward": forward, "sha256": digest}


@router.post("/import", dependencies=_ARMED)
def import_bank(body: ImportIn, _: None = Depends(require_push_secret)):
    """Bulk upsert from docs/study/bank/*.json. Items land as DRAFTS. An item
    with a `bars` spec gets its snapshot resolved from the server's bars.db
    via get_bars_before only; a miss is REPORTED, never fetched. Each item's
    `bars` spec is popped before the row is written. A fixture item may carry
    `bars_embed` (its own bars, the record itself) which is stored as-is.

    Every item runs the importer checks (study_import.check_item: number
    grounding, voice, near-duplicate, review lane). A failing item is STILL
    stored, as a draft with `import_flags`, and listed under `flagged` in the
    response — never silently dropped (§13.6: the review card shows the two
    automatic checks)."""
    misses: list = []
    rejected: list = []
    flagged: list = []
    ready: list = []
    skills = {str(raw.get("skill_id") or "") for raw in body.items if isinstance(raw, dict)}
    dup_bank: list = list(study_store.list_question_rows(skills)) if skills else []
    for raw in body.items:
        it = dict(raw)
        spec = it.pop("bars", None)
        embed = it.pop("bars_embed", None)
        iid = it.get("id") or study_store.new_item_id()
        it["id"] = iid
        # §8.8: nothing goes live unreviewed. The one exception is an item the
        # owner approved in the chat review (docs/study/corrections): it carries
        # `reviewed.by == "owner"` and arrives as approved.
        reviewed = it.pop("reviewed", None)
        if not (it.get("review_status") == "approved" and isinstance(reviewed, dict)
                and reviewed.get("by") == "owner"):
            it.pop("review_status", None)
        chk = study_import.check_item(it, dup_bank)
        it["import_flags"] = chk["flags"] or None
        it["review_lane"] = it.get("review_lane") or chk["lane"]
        if chk["flags"]:
            flagged.append({"id": iid, "flags": chk["flags"]})
        dup_bank.append({"id": iid, "skill_id": it.get("skill_id"), "prompt_json": it.get("prompt_json"),
                         "asof": it.get("asof") or (spec or {}).get("asof") or (embed or {}).get("asof"),
                         "sym": it.get("sym") or (spec or {}).get("sym") or (embed or {}).get("sym")})
        if embed and isinstance(embed, dict) and embed.get("bars"):
            bars_id = it.get("bars_ref") or f"sb_{iid}"
            study_store.upsert_bars(bars_id, str(embed.get("tf") or "D"), list(embed["bars"]),
                                    embed.get("forward"), embed.get("sha256"))
            it["bars_ref"] = bars_id
            it["sym"] = str(it.get("sym") or embed.get("sym") or "").upper() or None
            it["asof"] = it.get("asof") or embed.get("asof")
            ready.append(it)
            continue
        if spec:
            res = resolve_bars(spec)
            if not res["ok"]:
                (rejected if res["reason"] == "sha_mismatch" else misses).append(
                    {"id": iid, **{k: v for k, v in res.items() if k != "ok"}})
                if res["reason"] == "sha_mismatch":
                    continue
                # a bars miss: the item is still stored (draft) so the next
                # import pass can resolve it; it cannot be approved until then.
                it["bars_ref"] = it.get("bars_ref") or f"sb_{iid}"
                it["sym"] = str(it.get("sym") or spec.get("sym") or "").upper() or None
                it["asof"] = it.get("asof") or spec.get("asof")
                ready.append(it)
                continue
            bars_id = it.get("bars_ref") or f"sb_{iid}"
            study_store.upsert_bars(bars_id, res["tf"], res["visible"], res["forward"], res["sha256"])
            it["bars_ref"] = bars_id
            it["sym"] = str(it.get("sym") or spec.get("sym") or "").upper() or None
            it["asof"] = it.get("asof") or spec.get("asof")
        ready.append(it)
    try:
        up = study_store.upsert_items(ready) if ready else {"inserted": 0, "updated": 0, "ids": []}
        n_terms = study_store.upsert_terms(body.terms) if body.terms else 0
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"inserted": up["inserted"], "updated": up["updated"], "ids": up["ids"],
            "terms": n_terms, "misses": misses, "rejected": rejected, "flagged": flagged}
