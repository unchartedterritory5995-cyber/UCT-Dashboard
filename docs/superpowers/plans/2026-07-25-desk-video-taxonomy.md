# Desk Video Taxonomy + Landing Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure THE DESK's 295 videos into a Shows + Library taxonomy driven by transcript analysis, with server-owned category ordering, tags, and a redesigned landing page.

**Architecture:** Additive backend (new `edu_categories` table + `tags` column + PUSH_SECRET bulk-apply endpoint) → frontend renders server order and splits Shows (chronological rails) from Library (topic grids with tag chips) → data pipeline (local scripts + classification workflow) fills gaps and applies the owner-approved mapping. Spec: `docs/superpowers/specs/2026-07-25-desk-video-taxonomy-design.md`.

**Tech Stack:** FastAPI + SQLite (education.db), React 18 + CSS modules + SWR, pytest, vitest, faster-whisper (local, CPU).

## Global Constraints

- Theater/player is OUT OF SCOPE: `VideoDockSlot` stays the FIRST child of the Videos section; playback only via `videoStore.play(list, index)`; never let React write `transform` on the video host.
- Deep link `?v=<youtube_id>` fires once per mount (`deepLinkDone` ref) — must keep working.
- Transcript storage format is `[h:mm:ss] text` lines (mirror `desk_session_insights._timestamped_block`), 600,000-char cap.
- Breakpoints: ONLY 640 / 1024. Icons: `UIcon` registry, NO emoji. Tap targets ≥ 44px on touch.
- Shared repo: explicit-path `git add` only (NEVER `git add -A`); ship via `git push origin feat/desk-taxonomy:master`; web pushes only ≥4:20 PM ET or <9:15 AM ET.
- Cloudflare blocks non-browser User-Agents on uctintelligence.com — every prod HTTP call sends a Mozilla UA; PUSH_SECRET endpoints use `Authorization: Bearer <PUSH_SECRET>`.
- Worktree: `C:\Users\Patrick\uct-dashboard\.worktrees\desk-taxonomy` (branch `feat/desk-taxonomy`). Backend tests run from the worktree root: `python -m pytest tests/<file> -v`. Frontend: `cd app && npx vitest run <file>`.
- Nothing writes video categories to production until the owner approves the review artifact (Task 11 gate).

---

## File structure (what's created/modified)

| File | Responsibility |
|---|---|
| `api/services/education_service.py` | +`edu_categories` schema, +`tags` extra column, category-meta CRUD, grouped payload, bulk apply |
| `api/routers/education.py` | grouped `/videos` payload, `POST /taxonomy-apply` (PUSH_SECRET), `POST /categories/rename` + `PATCH /categories/{name}` (admin) |
| `api/services/desk_daily_session.py` | `_route` alias hardening + show auto-registration |
| `tests/test_education_taxonomy.py` | new backend tests (service) |
| `tests/test_education_router_taxonomy.py` | new backend tests (router) |
| `app/src/pages/desk/VideosSection.jsx` | drop `CATEGORY_ORDER`, integrate Hero/ShowRail/LibraryGrid, tag chips |
| `app/src/pages/desk/DeskHero.jsx` + `ShowRail.jsx` + `LibraryGrid.jsx` | new landing components |
| `app/src/pages/desk/VideosSection.module.css` | all new landing styles (old `EducationalVideos.module.css` untouched for theater-era classes) |
| `tools/desk_transcript_gapfill.py` | local: R2 audio → faster-whisper → insights-store |
| `tools/desk_taxonomy_dump.py` | local: full 295-video dump to JSON |
| `tools/desk_taxonomy_apply.py` | local: approved assignments → `POST /taxonomy-apply` |

Execution order: Tasks 1–4 (backend) → 5–8 (frontend) can interleave with 9–10 (data scripts; independent). Task 11 (classification + owner gate) needs 9+10. Task 12 (apply) needs 2 deployed + 11 approved. Task 13 ships.

---

### Task 1: `edu_categories` table + `tags` column + service CRUD

**Files:**
- Modify: `api/services/education_service.py` (schema at :25-60, `_EXTRA_COLUMNS` at :78-92, new functions after `reorder_category` :214-222)
- Test: `tests/test_education_taxonomy.py` (create)

**Interfaces:**
- Produces: `list_category_meta() -> list[dict]` (name, kind, sort_order, blurb; ordered kind DESC ['show' first], sort_order ASC, name ASC), `upsert_category(name, kind='library', sort_order=None, blurb=None) -> dict` (sort_order=None appends at tail within kind; existing row: only non-None fields updated), `rename_category(old, new) -> int` (rows moved; merges meta if `new` exists), `set_video_tags(video_id, tags: list[str]) -> None`, `bulk_apply_taxonomy(categories: list[dict], assignments: list[dict]) -> dict` (single transaction; returns `{"categories": n, "videos": n, "missing_ids": [...]}`), `grouped_videos_payload() -> dict` (`{"categories":[{name, kind, sort_order, blurb, videos:[...]}], "total": N}`).
- `videos[]` rows gain `tags` (parsed JSON list, `[]` when null).

- [ ] **Step 1: Write failing tests**

```python
# tests/test_education_taxonomy.py
"""edu_categories meta table + tags + grouped payload (Desk taxonomy redesign)."""
import importlib
import json

import pytest


@pytest.fixture()
def svc(tmp_path, monkeypatch):
    from api.services import education_service as es
    monkeypatch.setattr(es, "_DB_PATH", str(tmp_path / "education.db"))
    es._init_db()
    return es


def _add(svc, title, category, yt="", **kw):
    return svc.create_video({"youtube_id": yt or f"yt_{title[:8]}", "title": title,
                             "category": category, **kw})


def test_upsert_category_appends_at_tail_within_kind(svc):
    a = svc.upsert_category("Live Trading Sessions", kind="show")
    b = svc.upsert_category("Post-Market Recaps", kind="show")
    c = svc.upsert_category("Options & Flow", kind="library")
    assert a["sort_order"] < b["sort_order"]
    assert [m["name"] for m in svc.list_category_meta()] == [
        "Live Trading Sessions", "Post-Market Recaps", "Options & Flow"]
    assert c["kind"] == "library"


def test_upsert_category_updates_only_provided_fields(svc):
    svc.upsert_category("Interviews", kind="library", blurb="Guests")
    got = svc.upsert_category("Interviews", sort_order=5)
    assert got["blurb"] == "Guests" and got["sort_order"] == 5 and got["kind"] == "library"


def test_upsert_category_rejects_bad_kind(svc):
    with pytest.raises(ValueError):
        svc.upsert_category("X", kind="playlist")


def test_set_video_tags_roundtrip(svc):
    v = _add(svc, "Risk 101", "Risk & Trade Management")
    svc.set_video_tags(v["id"], ["risk", "starter"])
    assert json.loads(svc.get_video(v["id"])["tags"]) == ["risk", "starter"]


def test_grouped_payload_orders_shows_first_then_library(svc):
    svc.upsert_category("Live Trading Sessions", kind="show")
    svc.upsert_category("Options & Flow", kind="library")
    _add(svc, "Session Jul 24", "Live Trading Sessions", yt="ltsA")
    _add(svc, "Flow basics", "Options & Flow", yt="oafA")
    out = svc.grouped_videos_payload()
    names = [c["name"] for c in out["categories"]]
    assert names == ["Live Trading Sessions", "Options & Flow"]
    assert out["categories"][0]["kind"] == "show"
    assert out["total"] == 2
    assert out["categories"][1]["videos"][0]["tags"] == []


def test_grouped_payload_auto_registers_unknown_category_at_tail(svc):
    svc.upsert_category("Options & Flow", kind="library")
    _add(svc, "Flow basics", "Options & Flow", yt="oafB")
    _add(svc, "Mystery Webinar", "Tonight", yt="mysB")  # no meta row
    out = svc.grouped_videos_payload()
    assert [c["name"] for c in out["categories"]] == ["Options & Flow", "Tonight"]
    meta = {m["name"]: m for m in svc.list_category_meta()}
    assert "Tonight" in meta  # registered so it renders ordered next time


def test_rename_category_moves_rows_and_meta(svc):
    svc.upsert_category("Live Sessions", kind="show")
    svc.upsert_category("Live Trading Sessions", kind="show")
    _add(svc, "Old stream", "Live Sessions", yt="oldC")
    moved = svc.rename_category("Live Sessions", "Live Trading Sessions")
    assert moved == 1
    assert svc.get_video_by_youtube_id("oldC")["category"] == "Live Trading Sessions"
    assert "Live Sessions" not in {m["name"] for m in svc.list_category_meta()}


def test_bulk_apply_taxonomy_transactional(svc):
    v1 = _add(svc, "A", "General", yt="bulkA")
    v2 = _add(svc, "B", "General", yt="bulkB")
    res = svc.bulk_apply_taxonomy(
        categories=[{"name": "Setups & Strategies", "kind": "library",
                     "sort_order": 0, "blurb": "The playbook"}],
        assignments=[{"id": v1["id"], "category": "Setups & Strategies", "tags": ["vcp"]},
                     {"id": v2["id"], "category": "Setups & Strategies", "tags": []},
                     {"id": 99999, "category": "Setups & Strategies", "tags": []}],
    )
    assert res["videos"] == 2 and res["missing_ids"] == [99999]
    assert svc.get_video(v1["id"])["category"] == "Setups & Strategies"
    assert json.loads(svc.get_video(v1["id"])["tags"]) == ["vcp"]
```

- [ ] **Step 2: Run tests, verify they fail** — `python -m pytest tests/test_education_taxonomy.py -v` → FAIL (`upsert_category` not defined).

- [ ] **Step 3: Implement.** In `education_service.py`:

Append to `_SCHEMA` string (inside the triple-quote, after `idx_edu_video_notes_user_vid`):

```sql
CREATE TABLE IF NOT EXISTS edu_categories (
  name        TEXT PRIMARY KEY,
  kind        TEXT NOT NULL DEFAULT 'library',   -- 'show' | 'library'
  sort_order  INTEGER NOT NULL DEFAULT 0,        -- within kind
  blurb       TEXT,
  created_at  INTEGER NOT NULL
);
```

Add `("tags", "TEXT")` to `_EXTRA_COLUMNS` (JSON: `["risk", ...]` — filter chips).

New functions (after `reorder_category`):

```python
# ── Category metadata (Shows + Library taxonomy) ────────────────────────────────

_CATEGORY_KINDS = ("show", "library")


def list_category_meta() -> list[dict]:
    """All category meta rows: shows first, then library, each by sort_order."""
    with contextlib.closing(_connect()) as c:
        rows = c.execute(
            """SELECT name, kind, sort_order, blurb FROM edu_categories
               ORDER BY CASE kind WHEN 'show' THEN 0 ELSE 1 END, sort_order ASC, name ASC"""
        ).fetchall()
        return [dict(r) for r in rows]


def upsert_category(name: str, kind: str | None = None,
                    sort_order: Optional[int] = None,
                    blurb: Optional[str] = None) -> dict:
    """Create or update a category meta row. On create, missing sort_order
    appends at the tail of its kind. On update, only non-None fields change."""
    nm = (name or "").strip()
    if not nm:
        raise ValueError("category name required")
    if kind is not None and kind not in _CATEGORY_KINDS:
        raise ValueError(f"kind must be one of {_CATEGORY_KINDS}")
    with _WRITE_LOCK, contextlib.closing(_connect()) as c:
        row = c.execute("SELECT * FROM edu_categories WHERE name = ?", (nm,)).fetchone()
        if row is None:
            k = kind or "library"
            if sort_order is None:
                mx = c.execute(
                    "SELECT COALESCE(MAX(sort_order), -1) AS m FROM edu_categories WHERE kind = ?",
                    (k,)).fetchone()["m"]
                sort_order = int(mx) + 1
            c.execute(
                "INSERT INTO edu_categories (name, kind, sort_order, blurb, created_at) "
                "VALUES (?, ?, ?, ?, ?)",
                (nm, k, int(sort_order), blurb, int(time.time())))
        else:
            sets, vals = [], []
            for col, val in (("kind", kind), ("sort_order", sort_order), ("blurb", blurb)):
                if val is not None:
                    sets.append(f"{col} = ?"); vals.append(val)
            if sets:
                c.execute(f"UPDATE edu_categories SET {', '.join(sets)} WHERE name = ?",
                          (*vals, nm))
        c.commit()
        return dict(c.execute("SELECT name, kind, sort_order, blurb FROM edu_categories "
                              "WHERE name = ?", (nm,)).fetchone())


def rename_category(old: str, new: str) -> int:
    """Move every video from `old` to `new` + retire the old meta row. If `new`
    has no meta row, the old row's kind/blurb carry over. Returns rows moved."""
    o, n = (old or "").strip(), (new or "").strip()
    if not o or not n or o == n:
        raise ValueError("distinct old and new category names required")
    with _WRITE_LOCK, contextlib.closing(_connect()) as c:
        old_meta = c.execute("SELECT * FROM edu_categories WHERE name = ?", (o,)).fetchone()
        new_meta = c.execute("SELECT * FROM edu_categories WHERE name = ?", (n,)).fetchone()
        if new_meta is None:
            k = old_meta["kind"] if old_meta else "library"
            so = old_meta["sort_order"] if old_meta else 0
            bl = old_meta["blurb"] if old_meta else None
            c.execute("INSERT INTO edu_categories (name, kind, sort_order, blurb, created_at) "
                      "VALUES (?, ?, ?, ?, ?)", (n, k, so, bl, int(time.time())))
        cur = c.execute("UPDATE edu_videos SET category = ?, updated_at = ? WHERE category = ?",
                        (n, int(time.time()), o))
        c.execute("DELETE FROM edu_categories WHERE name = ?", (o,))
        c.commit()
        return cur.rowcount


def set_video_tags(video_id: int, tags: list[str]) -> None:
    clean = [str(t).strip() for t in (tags or []) if str(t).strip()]
    with _WRITE_LOCK, contextlib.closing(_connect()) as c:
        c.execute("UPDATE edu_videos SET tags = ?, updated_at = ? WHERE id = ?",
                  (_json.dumps(clean), int(time.time()), int(video_id)))
        c.commit()


def bulk_apply_taxonomy(categories: list[dict], assignments: list[dict]) -> dict:
    """One-shot taxonomy apply (PUSH_SECRET rail). Upserts category meta, then
    sets category+tags per video id. Missing ids are reported, not fatal."""
    for cat in categories or []:
        upsert_category(cat["name"], kind=cat.get("kind"),
                        sort_order=cat.get("sort_order"), blurb=cat.get("blurb"))
    applied, missing = 0, []
    now = int(time.time())
    with _WRITE_LOCK, contextlib.closing(_connect()) as c:
        for a in assignments or []:
            vid = int(a["id"])
            tags = _json.dumps([str(t).strip() for t in (a.get("tags") or []) if str(t).strip()])
            cur = c.execute(
                "UPDATE edu_videos SET category = ?, tags = ?, updated_at = ? WHERE id = ?",
                ((a["category"] or "General").strip() or "General", tags, now, vid))
            if cur.rowcount == 0:
                missing.append(vid)
            else:
                applied += 1
        c.commit()
    return {"categories": len(categories or []), "videos": applied, "missing_ids": missing}


def grouped_videos_payload() -> dict:
    """The /api/education/videos payload: categories ordered shows-first by
    sort_order, each with its videos (sort_order, id). Categories present on
    videos but missing a meta row are auto-registered at the tail (kind='show'
    when any member is a Zoom session, else 'library') so nothing ever hides."""
    vids = list_videos()
    by_cat: dict[str, list[dict]] = {}
    for v in vids:
        v["tags"] = _parse_json_list(v.get("tags"))
        by_cat.setdefault(v["category"], []).append(v)
    meta = {m["name"]: m for m in list_category_meta()}
    for name, members in by_cat.items():
        if name not in meta:
            kind = "show" if any(m.get("meeting_uuid") for m in members) else "library"
            meta[name] = upsert_category(name, kind=kind)
    ordered = [m for m in list_category_meta() if m["name"] in by_cat]
    return {
        "categories": [{**m, "videos": by_cat[m["name"]]} for m in ordered],
        "total": len(vids),
    }


def _parse_json_list(raw) -> list:
    try:
        v = _json.loads(raw) if raw else []
        return v if isinstance(v, list) else []
    except Exception:
        return []
```

Note: `_json` is already imported mid-module (line ~390); these functions sit AFTER that import. `time`, `contextlib`, `Optional` are already imported.

- [ ] **Step 4: Run tests, verify pass** — `python -m pytest tests/test_education_taxonomy.py -v` → all PASS.
- [ ] **Step 5: Run the existing education suite** — `python -m pytest tests/ -k education -v` → no regressions.
- [ ] **Step 6: Commit**

```bash
git add api/services/education_service.py tests/test_education_taxonomy.py
git commit -m "feat(desk): edu_categories meta table + video tags + grouped taxonomy payload"
```

---

### Task 2: Router — grouped payload, taxonomy-apply, category admin ops

**Files:**
- Modify: `api/routers/education.py` (the `GET /videos` handler + new endpoints near the PUSH_SECRET backfill section)
- Test: `tests/test_education_router_taxonomy.py` (create)

**Interfaces:**
- Consumes: Task 1's `grouped_videos_payload`, `bulk_apply_taxonomy`, `rename_category`, `upsert_category`.
- Produces: `GET /api/education/videos` → `{categories:[{name, kind, sort_order, blurb, videos[]}], total}` (additive fields; `name`/`videos` unchanged). `POST /api/education/taxonomy-apply` (PUSH_SECRET) body `{"categories":[{name,kind,sort_order,blurb}], "assignments":[{id,category,tags}]}` → bulk_apply result. `POST /api/education/categories/rename` (admin) body `{"from_name":..., "to_name":...}` → `{moved: n}`. `PATCH /api/education/categories/{name}` (admin) body `{kind?, sort_order?, blurb?}` → meta row.

- [ ] **Step 1: Write failing tests.** Open `api/routers/education.py` first and copy the auth-override/TestClient pattern from the existing education router tests (`grep -l education tests/` — e.g. `tests/test_education_router.py`); reuse its fixtures for paid/admin/push-secret auth. Cases:

```python
# tests/test_education_router_taxonomy.py  (fixtures per existing education router tests)
def test_videos_payload_carries_kind_and_sort_order(paid_client, svc):
    svc.upsert_category("Live Trading Sessions", kind="show")
    svc.create_video({"youtube_id": "yt1", "title": "S", "category": "Live Trading Sessions"})
    body = paid_client.get("/api/education/videos").json()
    cat = body["categories"][0]
    assert cat["kind"] == "show" and "sort_order" in cat and cat["videos"][0]["tags"] == []

def test_taxonomy_apply_requires_push_secret(client):
    r = client.post("/api/education/taxonomy-apply", json={"categories": [], "assignments": []})
    assert r.status_code in (401, 403)

def test_taxonomy_apply_applies(push_client, svc):
    v = svc.create_video({"youtube_id": "yt2", "title": "A", "category": "General"})
    r = push_client.post("/api/education/taxonomy-apply", json={
        "categories": [{"name": "Options & Flow", "kind": "library", "sort_order": 0}],
        "assignments": [{"id": v["id"], "category": "Options & Flow", "tags": ["options"]}]})
    assert r.status_code == 200 and r.json()["videos"] == 1

def test_rename_is_admin_only(paid_client):
    r = paid_client.post("/api/education/categories/rename",
                         json={"from_name": "A", "to_name": "B"})
    assert r.status_code in (401, 403)

def test_rename_moves_rows(admin_client, svc):
    svc.create_video({"youtube_id": "yt3", "title": "X", "category": "Live Sessions"})
    r = admin_client.post("/api/education/categories/rename",
                          json={"from_name": "Live Sessions", "to_name": "Live Trading Sessions"})
    assert r.status_code == 200 and r.json()["moved"] == 1

def test_patch_category_meta(admin_client, svc):
    svc.upsert_category("Interviews")
    r = admin_client.patch("/api/education/categories/Interviews", json={"blurb": "Guests"})
    assert r.status_code == 200 and r.json()["blurb"] == "Guests"
```

- [ ] **Step 2: Run → FAIL** (404 / missing fields).
- [ ] **Step 3: Implement.** In `education.py`: replace the `GET /videos` handler body with `return education_service.grouped_videos_payload()`. Add Pydantic models + endpoints:

```python
class TaxonomyCategoryIn(BaseModel):
    name: str
    kind: Optional[str] = None
    sort_order: Optional[int] = None
    blurb: Optional[str] = None

class TaxonomyAssignmentIn(BaseModel):
    id: int
    category: str
    tags: list[str] = []

class TaxonomyApplyIn(BaseModel):
    categories: list[TaxonomyCategoryIn] = []
    assignments: list[TaxonomyAssignmentIn] = []

class CategoryRenameIn(BaseModel):
    from_name: str
    to_name: str

class CategoryPatchIn(BaseModel):
    kind: Optional[str] = None
    sort_order: Optional[int] = None
    blurb: Optional[str] = None


@router.post("/taxonomy-apply")
def taxonomy_apply(body: TaxonomyApplyIn, _=Depends(require_push_secret)):
    try:
        return education_service.bulk_apply_taxonomy(
            [c.model_dump() for c in body.categories],
            [a.model_dump() for a in body.assignments])
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.post("/categories/rename")
def category_rename(body: CategoryRenameIn, _admin=Depends(require_admin)):
    try:
        return {"moved": education_service.rename_category(body.from_name, body.to_name)}
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.patch("/categories/{name}")
def category_patch(name: str, body: CategoryPatchIn, _admin=Depends(require_admin)):
    try:
        return education_service.upsert_category(
            name, kind=body.kind, sort_order=body.sort_order, blurb=body.blurb)
    except ValueError as e:
        raise HTTPException(400, str(e))
```

(Reuse the router's existing `require_push_secret` / `require_admin` dependencies — they already exist for the backfill + admin write endpoints; match their exact names when editing.)

- [ ] **Step 4: Run new tests → PASS; run `python -m pytest tests/ -k education -v` → no regressions.**
- [ ] **Step 5: Commit** — `git add api/routers/education.py tests/test_education_router_taxonomy.py && git commit -m "feat(desk): taxonomy-apply + category admin endpoints, grouped /videos payload"`

---

### Task 3: Auto-publish routing hardening + show auto-registration

**Files:**
- Modify: `api/services/desk_daily_session.py:29-60` (`_RULES` / `_route`), the publish call site that runs `education_service.create_video` (in `process_pending_jobs`)
- Test: extend the existing desk session test file (`grep -l "_route" tests/`), or create `tests/test_desk_session_routing.py`

**Interfaces:**
- Consumes: Task 1 `upsert_category`.
- Produces: unchanged `_route(topic) -> (section, title_prefix, eyebrow)` signature; new aliases; publish path calls `education_service.upsert_category(section, kind="show")` before `create_video`.

- [ ] **Step 1: Failing tests**

```python
import pytest
from api.services.desk_daily_session import _route

@pytest.mark.parametrize("topic,section", [
    ("Live Trading Today", "Live Trading Sessions"),
    ("Daily Session", "Live Trading Sessions"),
    ("Thoughts on the Market", "Thoughts on the Market"),
    ("Market thoughts w/ Bracco & BucketHead", "Thoughts on the Market"),
    ("Thoughts on the mkt TSDR", "Thoughts on the Market"),
    ("Post Market Recap", "Post-Market Recaps"),
    ("Post-Market Wrap", "Post-Market Recaps"),
    ("Workshop with Zen", "Workshops & Fireside Chats"),
    ("Evening Update from Bracco", "Evening Update"),
    ("", "Live Trading Sessions"),
    ("Brand New Show", "Brand New Show"),   # auto-derive stays
])
def test_route_aliases(topic, section):
    assert _route(topic)[0] == section
```

- [ ] **Step 2: Run → FAIL** on the new alias cases.
- [ ] **Step 3: Implement.** Replace `_RULES` with (keep tuple shape `(kw, section, prefix, eyebrow)`; first match wins, so keep the more specific `thoughts on the market` before `market thoughts`… order below is safe):

```python
_RULES = [
    ("live trading", "Live Trading Sessions", "Live Trading Session", "LIVE TRADING SESSION"),
    ("daily session", "Live Trading Sessions", "Live Trading Session", "LIVE TRADING SESSION"),
    ("thoughts on the market", "Thoughts on the Market", "Thoughts on the Market", "THOUGHTS ON THE MARKET"),
    ("thoughts on the mkt", "Thoughts on the Market", "Thoughts on the Market", "THOUGHTS ON THE MARKET"),
    ("market thoughts", "Thoughts on the Market", "Thoughts on the Market", "THOUGHTS ON THE MARKET"),
    ("post market", "Post-Market Recaps", "Post-Market Recap", "POST-MARKET RECAP"),
    ("post-market", "Post-Market Recaps", "Post-Market Recap", "POST-MARKET RECAP"),
    ("workshop", "Workshops & Fireside Chats", "Workshop", "WORKSHOP"),
]
```

Note: the "workshop" rule intentionally uses the TOPIC as-is for the title via the existing prefix mechanism? No — keep the tuple's `prefix` ("Workshop") consistent with the other rules; the host name still reaches the title only for Evening Update (existing behavior). In `process_pending_jobs`, immediately before the `education_service.create_video({...})` publish call, add:

```python
try:
    education_service.upsert_category(section, kind="show")
except Exception:
    pass  # never break publish over meta registration
```

(Where `section` is the `_route(...)` result already in scope at the publish site. `_is_test_recording` skip and Evening Update host-aware behavior unchanged.)

- [ ] **Step 4: Run tests → PASS; run whichever existing desk-session test files exist (`python -m pytest tests/ -k desk -v`) → green.**
- [ ] **Step 5: Commit** — `git add api/services/desk_daily_session.py tests/test_desk_session_routing.py && git commit -m "feat(desk): webinar-name alias routing + show auto-registration"`

---

### Task 4: Backend integration check

**Files:** none new — verification gate.

- [ ] **Step 1:** `python -m pytest tests/ -x -q -k "education or desk"` → all pass.
- [ ] **Step 2:** Boot locally (`$env:WORKER_ENABLED="0"; $env:CATALYST_ENGINE_ENABLED="0"; $env:TWITTERAPI_IO_ENABLED="0"; $env:BARS_PREWARM_DISABLED="1"; $env:TICKER_NAMES_PREWARM_DISABLED="1"; python -m uvicorn api.main:app --port 8077`), then `GET http://localhost:8077/api/education/videos` with an admin session cookie (mobile-audit account recipe in CLAUDE.md) → payload has `kind`/`sort_order`/`tags`.
- [ ] **Step 3: Commit any fixes** with explicit paths.

---

### Task 5: Frontend — server-ordered categories, Shows/Library split state

**Files:**
- Modify: `app/src/pages/desk/VideosSection.jsx:24-65` (delete `CATEGORY_ORDER` + `orderRank`; split memo)
- Test: `app/src/pages/EducationalVideos.test.jsx` (update fixtures to carry `kind`/`sort_order`/`tags`)

**Interfaces:**
- Produces: `const categories = data?.categories || []` (server order, NO client re-sort); `const shows = categories.filter(c => c.kind === 'show')`; `const library = categories.filter(c => c.kind !== 'show')`. Downstream consumers (deep link, continueWatching, paths, filtered, allVideoIds) keep using `categories` unchanged.

- [ ] **Step 1: Update tests first.** In `EducationalVideos.test.jsx`, update the mocked `/api/education/videos` fixture to `{categories:[{name:'Live Trading Sessions', kind:'show', sort_order:0, blurb:'', videos:[...]}, {name:'Options & Flow', kind:'library', sort_order:0, blurb:'', videos:[...]}], total:N}` and add a test asserting render order follows payload order (shows section before library section) rather than the old pin list.
- [ ] **Step 2: Run → FAIL** (`cd app && npx vitest run src/pages/EducationalVideos.test.jsx`).
- [ ] **Step 3: Implement** — delete `CATEGORY_ORDER`/`orderRank`, replace the `categories` memo with pass-through, add the `shows`/`library` memos.
- [ ] **Step 4: Run → PASS**, plus `npx vitest run src/pages/desk` → green.
- [ ] **Step 5: Commit** — `git add app/src/pages/desk/VideosSection.jsx app/src/pages/EducationalVideos.test.jsx && git commit -m "feat(desk): render server-ordered categories, drop CATEGORY_ORDER pin list"`

---

### Task 6: Landing components — Hero, ShowRail, LibraryGrid, tag chips

**Files:**
- Create: `app/src/pages/desk/DeskHero.jsx`, `app/src/pages/desk/ShowRail.jsx`, `app/src/pages/desk/LibraryGrid.jsx`, `app/src/pages/desk/VideosSection.module.css`
- Modify: `app/src/pages/desk/VideosSection.jsx` (compose below `<VideoDockSlot/>`)
- Test: `app/src/pages/desk/VideosSection.landing.test.jsx` (create)

**Interfaces:**
- Consumes: `shows`/`library` from Task 5; `playVideo(list, index)`; `progress` store; poster URL = `/api/education/videos/{id}/poster` (404 until generated → `onError` swap to `https://i.ytimg.com/vi/{youtube_id}/hqdefault.jpg`).
- Produces:
  - `<DeskHero video={latest} list={showVideos} index={i} onPlay={playVideo} progress={progress} />` — latest episode of the first show (newest = last by `id` within the category since sessions append chronologically; use `[...videos].sort((a,b)=>b.id-a.id)[0]`).
  - `<ShowRail show={cat} onPlay={playVideo} progress={progress} deskThreads={deskThreads} isAdmin onEdit onDelete />` — horizontal rail, newest-first, "View all" toggles an expanded grid (local state per rail).
  - `<LibraryGrid categories={library} activeTag onPlay ... />` — per-category blocks; tag chips computed as `useMemo` union of `video.tags` across library videos with counts, capped to the 18 most frequent; selecting a tag filters every block; blocks with 0 matches hide.

**Design intent (load the `frontend-design` skill before writing JSX/CSS):** premium streaming feel inside the existing token system. Hero = wide card, poster backdrop with a left-to-right `linear-gradient(90deg, rgba(14,15,13,.92), rgba(14,15,13,.25))` scrim, gold eyebrow (show name), 22px headline (video `headline` || `title`), date line, gold-gradient Play/Resume CTA (Resume when `progress[yt].t >= 8`). Rails = `display:flex; overflow-x:auto; scroll-snap-type:x mandatory; gap:12px` with 240px 16:9 cards (poster/thumb, duration pill, 4px gold progress bar, 2-line title, dim headline subtitle). Library blocks = section header row (UIcon + name + count + blurb) over the existing auto-fill `minmax(260px,1fr)` grid. Tag chips = house pill pattern (999px radius, active = gold tint + glow), horizontal scroll on phone. Breakpoints 640/1024 only; cards keep 44px tap areas.

- [ ] **Step 1: Write failing tests** — render `VideosSection` with a fixture of 2 shows + 2 library categories (one video tagged `risk`): assert (a) hero renders the newest first-show episode title, (b) each show renders as a rail (`role="list"` with `aria-label` = show name), (c) clicking a rail card calls `videoStore.play` with that show's list (mock the module like the existing test does), (d) clicking tag chip `risk` hides untagged library videos, (e) `VideoDockSlot` is still the first rendered child, (f) search still filters across shows + library.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement components + CSS module.** All NEW classes live in `VideosSection.module.css`; import it alongside the legacy stylesheet (`import s from './VideosSection.module.css'`) — do NOT move or rename anything in `EducationalVideos.module.css` (theater-era classes: card, thumbBtn, grid stay usable for the expanded/search views). Poster-first image element:

```jsx
function CardImage({ video }) {
  const [src, setSrc] = useState(`/api/education/videos/${video.id}/poster`)
  return (
    <img className={s.cardImg} src={src} alt="" loading="lazy"
         onError={() => setSrc(`https://i.ytimg.com/vi/${video.youtube_id}/hqdefault.jpg`)} />
  )
}
```

Compose in `VideosSection` (order: `VideoDockSlot` → header/search → `DeskHero` → Continue watching → one `ShowRail` per show → tag chips + `LibraryGrid` → Learning paths). When `query` or `activeCat` is set, keep TODAY'S flat filtered-grid behavior (the existing `filtered` memo + card grid) instead of hero/rails — search results must stay a flat grid.
- [ ] **Step 4: Run → PASS**; full frontend suite `npx vitest run` → green (fix any snapshot/order fallout in Desk tests only).
- [ ] **Step 5: Commit** — explicit paths for the 5 files + tests.

---

### Task 7: Build + polish pass

- [ ] **Step 1:** `cd app && npm run build` → clean build.
- [ ] **Step 2:** Local backend + built app (Task 4 recipe), open `http://localhost:8077/desk?section=videos` as admin in a real browser (Playwright or Chrome tools): verify hero/rails/library render with real-ish data, video opens in theater, scroll-to-theater pins correctly, deep link `?v=` works, admin Add/Edit still works.
- [ ] **Step 3:** Fix visual issues found; commit with explicit paths.

### Task 8: Mobile audit

- [ ] **Step 1:** `python tools/mobile_audit.py --base http://localhost:8077 --auth --routes /desk` (both viewports; admin creds recipe in CLAUDE.md).
- [ ] **Step 2:** Fix every horizontal-overflow + sub-44px finding in the new components (rails must scroll inside their own container).
- [ ] **Step 3:** Re-run audit → clean; commit.

---

### Task 9: Transcript gap-fill script (local, prod-additive)

**Files:**
- Create: `tools/desk_transcript_gapfill.py`
- No repo tests (operational tool; it self-verifies) — but include `--dry-run` and `--limit 1` modes and verify one video end-to-end before the full run.

**Interfaces:**
- Consumes prod endpoints: `GET /api/education/insights-backfill/pending`, `GET /api/education/videos/{id}/transcript-cues` (both PUSH_SECRET), `GET /api/education/videos/{id}/audio` (302 → presigned R2; requires paid cookie — instead download R2 DIRECTLY via `api.services.data_sync` with local env creds, key `desk_audio/{youtube_id}.m4a`), `POST /api/education/videos/{id}/insights-store`.
- Produces: transcripts stored for the ~21-25 gap videos in the exact `[h:mm:ss] text` block format + Opus chapters/headline/summary via `desk_session_insights.generate_insights` (same as `scripts/backfill_video_insights.py`).

Script skeleton (write exactly this structure; run with the repo venv + `pip install faster-whisper` into it, or a scratch venv that also gets `requests python-dotenv`):

```python
"""Gap-fill transcripts for Desk videos with no stored transcript.
Enumerate gaps by sweeping /transcript-cues across ALL ids (the pending endpoint
misses chapters-without-transcript rows). Audio comes straight from R2
(desk_audio/<yt>.m4a — backfilled 7/25); whisper runs locally on CPU.

Usage:  python tools/desk_transcript_gapfill.py [--dry-run] [--limit N] [--ids 60,267]
"""
import argparse, json, os, sys, tempfile, time
import requests
from dotenv import load_dotenv

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
load_dotenv(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env"))

BASE = "https://uctintelligence.com"
HDRS = {"Authorization": f"Bearer {os.environ['PUSH_SECRET']}",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) desk-gapfill"}

def hms(t):  # -> [h:mm:ss]
    t = int(t); return f"[{t//3600}:{(t%3600)//60:02d}:{t%60:02d}]"

def timestamped_block(cues, cap=600_000):
    out, size = [], 0
    for c in cues:
        line = f"{hms(c['t'])} {c['text'].strip()}"
        size += len(line) + 1
        if size > cap: break
        out.append(line)
    return "\n".join(out)

def list_all_video_ids():
    """(id, youtube_id) for every video. Source of truth = the local read-only
    copy at C:\\data\\education.db when present (266+ rows, faithful for the
    id→youtube_id map), unioned with a probe of ids above its MAX(id) up to
    +60 via /transcript-cues (HTTP 404 = no such video)."""
    import sqlite3
    pairs, max_id = [], 0
    local = r"C:\data\education.db"
    if os.path.exists(local):
        con = sqlite3.connect(f"file:{local}?mode=ro", uri=True)
        pairs = con.execute("SELECT id, youtube_id FROM edu_videos ORDER BY id").fetchall()
        con.close()
        max_id = max(i for i, _ in pairs)
    for vid in range(max_id + 1, max_id + 61):
        r = requests.get(f"{BASE}/api/education/videos/{vid}/transcript-cues",
                         headers=HDRS, timeout=30)
        if r.status_code == 404:
            break
        pairs.append((vid, None))  # youtube_id resolved from the dump file later if needed
        time.sleep(0.2)
    return pairs

def gap_ids():
    ids = []
    for vid, yt in list_all_video_ids():
        r = requests.get(f"{BASE}/api/education/videos/{vid}/transcript-cues",
                         headers=HDRS, timeout=30)
        if r.ok and not (r.json().get("cues") or []):
            ids.append((vid, yt))
        time.sleep(0.2)
    return ids

def fetch_audio(yt, dest):
    """Download the backfilled R2 audio. Primary: data_sync's own download helper
    (read api/services/data_sync.py and use its existing get/download function —
    desk_audio_backfill.py shows the exact call). Fallback shown here: presign+GET."""
    from api.services import data_sync
    key = f"desk_audio/{yt}.m4a"
    if not data_sync.object_exists(key):
        return False
    url = data_sync.presigned_get(key, expires=3600)
    with requests.get(url, stream=True, timeout=300) as r:
        r.raise_for_status()
        with open(dest, "wb") as f:
            for chunk in r.iter_content(1 << 20):
                f.write(chunk)
    return True

def transcribe(path):
    from faster_whisper import WhisperModel
    model = WhisperModel("base.en", device="cpu", compute_type="int8")
    segments, _info = model.transcribe(path, word_timestamps=False, vad_filter=True)
    return [{"t": int(seg.start), "text": seg.text.strip()} for seg in segments if seg.text.strip()]

def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--limit", type=int, default=0); ap.add_argument("--ids", default="")
    args = ap.parse_args()
    targets = ([(int(i), None) for i in args.ids.split(",") if i] or gap_ids())
    if args.limit: targets = targets[:args.limit]
    print(f"{len(targets)} gap videos: {[t[0] for t in targets]}")
    if args.dry_run: return
    from api.services.desk_session_insights import generate_insights
    for vid, yt in targets:
        with tempfile.TemporaryDirectory() as td:
            m4a = os.path.join(td, "a.m4a")
            if not fetch_audio(yt, m4a):
                print(f"  id={vid}: NO R2 AUDIO — skip (note for yt-dlp fallback)"); continue
            cues = transcribe(m4a)
            block = timestamped_block(cues)
            ins = generate_insights(cues) or {}
            body = {"transcript": block, "chapters": ins.get("chapters") or [],
                    "headline": ins.get("headline") or "", "summary": ins.get("summary") or []}
            r = requests.post(f"{BASE}/api/education/videos/{vid}/insights-store",
                              headers=HDRS, json=body, timeout=60)
            print(f"  id={vid}: cues={len(cues)} POST={r.status_code}")

if __name__ == "__main__":
    main()
```

- [ ] **Step 1: Write the script**, resolving the two look-up-before-use points: the real `data_sync` download helper name, and `generate_insights`'s exact signature/return keys (read `scripts/backfill_video_insights.py` — mirror how IT calls generate_insights and what it POSTs, including `ticker_moments` if that's part of its flow).
- [ ] **Step 2: `--dry-run`** → prints the definitive gap list (expect ~21-25, incl. ids 60, 267).
- [ ] **Step 3: `--limit 1`** → verify one video end-to-end, then `GET /transcript-cues` for it returns cues.
- [ ] **Step 4: Full run** (background; ~5-15x realtime on CPU). Any video with no R2 audio: fall back to `yt-dlp` audio download (Edge closed for cookies; see uct-clips CLAUDE.md for PATH exports) — expected for at most 1-2 videos.
- [ ] **Step 5: Verify** — re-sweep: zero remaining gap videos. Commit the tool: `git add tools/desk_transcript_gapfill.py && git commit -m "tool(desk): whisper transcript gap-fill from R2 audio"`

---

### Task 10: Full-library dump script

**Files:**
- Create: `tools/desk_taxonomy_dump.py`

**Interfaces:**
- Produces: `tools/taxonomy_out/videos_dump.json` (gitignored dir — add `tools/taxonomy_out/` to `.gitignore`): `[{id, youtube_id, title, description, category, duration, created_at, headline, summary, setups, ticker_moments, chapters, transcript_cues:[{t,text}]}]` for all 295 videos.

- [ ] **Step 1: Write it.** Metadata: one `railway ssh --service web "echo <b64> | base64 -d | /opt/venv/bin/python"` read-only query (mode=ro URI; run from the MAIN repo dir `C:\Users\Patrick\uct-dashboard` where railway is linked — NOT the worktree) selecting all columns EXCEPT transcript, printed as JSON. Transcripts: HTTP sweep of `GET /api/education/videos/{id}/transcript-cues` (PUSH_SECRET + Mozilla UA, 0.2s pacing). Merge and write JSON.
- [ ] **Step 2: Run** after Task 9 completes → all rows have transcript_cues.
- [ ] **Step 3: Commit tool + gitignore line** (explicit paths).

---

### Task 11: Classification workflow → review artifact → OWNER GATE

Run by the orchestrating session (Workflow tool), not a plan subagent. Inputs: `videos_dump.json`. Output: `tools/taxonomy_out/assignments.json` + a private Artifact review page.

- [ ] **Step 1: Classification fan-out.** Batches of ~20 videos/agent. Each agent reads title/description/headline/summary/setups/chapters + first ~2,500 words of transcript and returns per video: `{id, zone: "show"|"library", category, tags: [..], confidence: 0-1, reasoning: "<one line>"}`. Fixed candidate lists in the prompt — Shows: Live Trading Sessions · The Mental Game · Post-Market Recaps · Thoughts on the Market · Evening Update; Library: Mindset & Psychology · Market Analysis & Breadth · Setups & Strategies · Risk & Trade Management · Scanning & Stock Selection · Options & Flow · Interviews · Workshops & Fireside Chats. Agents may propose `category: "OTHER:<suggestion>"` when nothing fits. Tag vocabulary seeded from the firm's setup taxonomy + {starter, intermediate, advanced, lesson, workshop, interview, stream, psychology, risk, breadth, options, scanning}.
- [ ] **Step 2: Adversarial verify** — every assignment with confidence < 0.75 OR whose category differs from the current one gets an independent re-read (fresh agent, sees the proposal + transcript, must CONFIRM or CORRECT with reasoning).
- [ ] **Step 3: Consistency pass** — one agent over the full assignment set: consolidate tag synonyms into ≤25 tags, resolve OTHER: proposals, decide the Technical Analysis & RS merge, check balance (no library category <5 or >60 videos without justification), emit the final `categories` list with kind/sort_order/blurb.
- [ ] **Step 4: Review artifact** — private Artifact page: summary counts, per-category tables (old → new, tags, reasoning, confidence), changed-assignment section highlighted first. Present to owner.
- [ ] **Step 5: OWNER GATE** — wait for explicit approval; fold in any edits and regenerate `assignments.json`.

### Task 12: Apply to production (after Task 11 approval + Task 13 deploy)

**Files:**
- Create: `tools/desk_taxonomy_apply.py`

- [ ] **Step 1: Backup** — `railway ssh --service web "cp /data/education.db /data/education.pre-taxonomy-$(date +%Y%m%d).db && ls -la /data/education*.db"` (from the linked main repo dir).
- [ ] **Step 2: Write + run the apply script** — reads `assignments.json`, POSTs ONE `taxonomy-apply` request `{categories, assignments}` (PUSH_SECRET + Mozilla UA), prints the `{categories, videos, missing_ids}` result; nonzero exit if `missing_ids` is non-empty or videos != expected count.
- [ ] **Step 3: Verify** — `GET /api/education/videos` (authed) shows the new grouping; spot-check 5 videos in the live UI; confirm progress bars/watch history still render (keyed on youtube_id — must be untouched).
- [ ] **Step 4: Commit tool** (explicit path).

### Task 13: Ship code

- [ ] **Step 1:** Full suites: `python -m pytest tests/ -q` and `cd app && npx vitest run && npm run build` → all green.
- [ ] **Step 2:** `grep -c broker_sync api/main.py` ≥ 7 (post-merge invariant), then fetch+rebase+push in ONE command, in the allowed window: `git fetch origin && git rebase origin/master && git push origin feat/desk-taxonomy:master`.
- [ ] **Step 3:** Verify deploy per the Cloudflare playbook (`reference_dashboard_deploy_verify_cloudflare`): confirm the Railway build is the new commit, then verify the live DOM (not the bundle hash) shows the new landing as an admin, desktop + phone.
- [ ] **Step 4:** Run Task 12 (data apply) → final live verification → report to owner with before/after.
