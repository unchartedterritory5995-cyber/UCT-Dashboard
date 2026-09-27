---
id: PACKET-U
title: RG-35 — education.py's 4-route category-management cluster is fully built, admin-tested, and wired to nothing in app/src — pre-implementation gate
role: the packet an approval line must name a checkpoint in
status: PROPOSED, unsigned
date: 2026-09-22
---

# PACKET U — four already-built admin routes with no admin door

## ⛔ APPROVAL — EMPTY, and that is its correct state

```
APPROVED BY:      Patrick (owner)
APPROVED ON:      2026-09-23
APPROVED AT SHA:  877d092c0
SCOPE APPROVED:   CP1 ONLY — the checkpoint(s) named here and nothing else in the packet.
```

> ⛔⛔ **NOT AUTHORIZED. PROPOSED** — no existing checkpoint governs
> `api/routers/education.py`'s category-management cluster or `VideosSection.jsx`'s admin
> surface. **Non-collision:** grepped `docs/terminal-research/12-decisions/gates/*.md`
> (22 letters taken: A,B,C,D,E,F,G,H,I,J,K,L,M,N,O,P,Q,R,S,T,V,W,Z), the root `.scopes/`
> directory (same stems, no `packet-u-*`), and every `PACKET-` string (case-insensitive)
> anywhere in the `s7-price-level` worktree — immediately before writing this file. `U` is
> unused; `X` and `Y` are also free but not needed here.

⛔ **ZERO PRODUCT CODE.** No file under `api/**` or `app/**` has been edited to produce this
packet. It proposes exactly one checkpoint (§4); nothing in it authorizes writing product code
beyond that scope, and it wires **existing, already-shipped, already-tested** backend routes —
it adds no new endpoint, no new database column, no schema change.

---

## 1 · The finding, independently re-verified fresh against current source (2026-09-22)

**As handed to this task:** `api/routers/education.py` has a 4-route "category management"
cluster — `GET /categories`, `POST /reorder`, `POST /categories/rename`, `PATCH
/categories/{name}` — fully built, `require_admin`-gated, covered by
`tests/test_education_router_taxonomy.py`, with **zero frontend callers anywhere in
`app/src`**.

**Re-verified, and two corrections to that premise are worth recording plainly rather than
carried forward silently:**

| route | line(s) | auth dependency (read from the decorator, not assumed) |
|---|---|---|
| `GET /api/education/categories` | `api/routers/education.py:246-248` | `require_paid` — **not `require_admin`.** It is a read, gated the same way `GET /videos` already is (any paid member or admin), not an admin-only route. The three WRITE routes below are the ones actually admin-gated. |
| `POST /api/education/reorder` | `:457-460` | `require_admin` |
| `POST /api/education/categories/rename` | `:475-480` | `require_admin` |
| `PATCH /api/education/categories/{name}` | `:489-495` | `require_admin` |

The finding's "fully built, correctly `require_admin`-gated" is true of three of the four
routes as literally worded; the fourth is correctly gated, just not the gate named — a read
route open to every paid member, not restricted to admins, which is the right shape for a
read and not itself a defect.

**Second correction — test coverage is genuinely HTTP-level for three routes, not four.**
`tests/test_education_router_taxonomy.py` was read in full:

- `test_get_categories_still_works_alongside_new_routes` (via `paid_client`) — exercises
  `GET /categories` through the real FastAPI `TestClient`.
- `test_rename_is_admin_only`, `test_rename_moves_rows`, `test_rename_same_name_returns_400`,
  `test_rename_route_not_shadowed_by_patch_category` — exercise `POST /categories/rename`
  through the real router, including its `require_admin` dependency (via `admin_client`) and a
  `paid_client` 401/403 negative case.
- `test_patch_category_meta_is_admin_only`, `test_patch_category_meta` — same, for
  `PATCH /categories/{name}`.

**`POST /reorder` has no HTTP-level test anywhere in the suite.** A grep for
`/api/education/reorder` and `/reorder` across `tests/**` finds exactly one hit outside this
router's own test file, and it is unrelated (`test_desk_session_insights.py`, a comment about
chapter ordering). The only test that exercises `reorder` at all is
`tests/test_education.py:80::test_reorder_category`, which calls
`svc.reorder_category("Charting", [...])` **directly against the service layer** — no
`TestClient`, no HTTP request, no `require_admin` dependency exercised. The service logic is
genuinely tested; the route's own auth gate and request/response shape are not. This does not
change the finding's headline (the route is real, admin-gated by inspection of the decorator,
and functionally correct) — it is recorded here because "covered by backend HTTP tests" was
one of the three routes' actual state, not all four's, and a future CP2 closing that gap is
named in §6 rather than silently assumed done.

**Zero frontend callers — confirmed exhaustively, case-insensitive, against the current
`app/src` tree** (not the finding's own prior grep, re-run fresh this pass):

```
grep -rni "categories/rename"        app/src   → 0 hits
grep -rni "/api/education/reorder"   app/src   → 0 hits
grep -rni "/api/education/categories" app/src  → 0 hits
```

All three return empty. `app/src/pages/desk/VideosSection.jsx` (1,480 lines, read in full) is
the only admin surface for this library, and it calls exactly `POST /api/education/videos`,
`PATCH /api/education/videos/{id}` and `DELETE /api/education/videos/{id}` — one video at a
time (`VideoForm`'s `submit()`, `:1213-1235`; `handleDelete`, `:593-603`). Its `category` field
(`:1253-1267`) is a free-text `<input list="edu-categories">` backed by a `<datalist>` populated
from `knownCategories` — which the component derives as `categories.map(c => c.name)`
(`:1101`), itself sourced entirely from the `GET /api/education/videos` response's embedded
`categories[]` array (`:222`), never from the dedicated `GET /categories` endpoint. There is no
drag-to-reorder-within-a-category control, no rename-a-category control, and no category-meta
(`kind`/`sort_order`/`blurb`) editor anywhere in the file or anywhere else in `app/src`.

**The four backend functions behind the routes are genuinely implemented, not stubs**
(`api/services/education_service.py`): `list_categories` (`:238-244`, distinct category names
with at least one video), `reorder_category` (`:333-341`, sets `sort_order` on the given video
ids within one category to match the passed order), `rename_category` (`:602-621`, moves every
video from `old` to `new` and retires the old meta row — **renaming onto an EXISTING category
name is a deliberate MERGE, not a conflict**, carrying the old row's `kind`/`blurb` forward only
if the target has no meta row of its own), `upsert_category` (`:571-580`, create-or-patch a
category's `kind`/`sort_order`/`blurb`; `kind` is validated to one of exactly
`("show", "library")`, `:514`).

## 2 · `VideosSection.jsx`'s current admin wiring — read in full

The whole admin surface is: an "Add video" button (header, `:677-681`) and, per video card, an
edit/delete pencil pair routed through `YTCard`/`Shelf` into the same `VideoForm` (`:1199-1298`)
— one video at a time, three fields plus the free-text category input described above. Category
chips (`:691-779`) are a pure **read** filter (`?cat=` in the URL, `:275-297`) — clicking one
narrows the view; nothing there writes anything. The only OTHER admin-only affordances already
in this file are the "New course" and "Delete path" pills inside the Learning Paths section
header (`:976-994`, `s.shelfAdminActions`), each opening a `Sheet`-based form
(`NewPathSheet`/`DeletePathsSheet`, `:1305-1480`) that follows the same shape: local `form`
state, `busy`/`err` state, a `fetch` + `credentials:'include'` + JSON body, inline error text,
and a callback into the parent's SWR `mutate()`. **This is the exact idiom §4 reuses** — it is
already the file's own convention for "a small admin management panel that isn't per-video,"
not a pattern imported from elsewhere.

## 3 · The two named idioms — confirmed to exist exactly as described

**`Watchlists.jsx`'s native HTML5 drag-and-drop column reorder** (`app/src/pages/Watchlists.jsx`):
a `dragColRef` (`useRef(null)`, `:1599`) holds the key of the column being dragged; the header
cell's drag props (`headerDragProps`, `:1985-1991`) wire the standard four-handler idiom —
`draggable`, `onDragStart` sets `dataTransfer.effectAllowed` and writes the ref, `onDragOver`
calls `preventDefault()` (required for `onDrop` to fire at all), `onDrop` calls `preventDefault()`
then `moveColumn(dragColRef.current, key)` and clears the ref, `onDragEnd` clears the ref as a
safety net. No library, no state during the drag other than the ref — confirmed present at
these exact lines, not paraphrased from memory.

**`useChartLayouts.js`'s inline-rename pattern** (`app/src/hooks/useChartLayouts.js`,
`renameLayout`, `:65-90`): captures the pre-write SWR cache (`before = data`), applies the new
name to the matching row in BOTH `global` and `mine` lists immediately (`mutate(cur => ...,
{revalidate:false})`) so the new name is on screen before the network round-trip returns, then
`PATCH`es the server; on success it reconciles the optimistic row with the server's authoritative
returned row (again `mutate(cur => withRow(cur, saved), {revalidate:false})`); on any non-OK
response or thrown error it rolls the ENTIRE cache back to `before` and rethrows. Confirmed
present verbatim at these lines. (§4 borrows the *shape* — optimistic apply, reconcile-with-
server-truth, whole-state rollback on failure — not a literal 409 case, since `rename_category`
treats a rename onto an existing name as a merge rather than a rejection; see §1's note.)

## 4 · Proposed checkpoint

| CP | scope | strands? | size |
|---|---|---|---|
| **CP1** | One admin-only "Manage Categories" panel in `VideosSection.jsx`, wired to the three admin-write routes plus the one paid read route already described in §1 — no new backend route, no schema change. | none | **S** — one new component + one new trigger button in an existing file |

### CP1 — exactly what changes, and nothing else

**Trigger — one new button, one existing location.** A `isAdmin`-only pill button, "Manage
Categories," added inside the existing chip-bar row (`app/src/pages/desk/VideosSection.jsx`,
the `s.chipBar` block at `:691-779`) — the same row the category chips and the existing
`Filters` toggle already live in, and the row that is already conditionally rendered only when
`!isLoading && total > 0 && categories.length > 1 && !activePath && !pathPending`. It opens a
new `<ManageCategoriesSheet>` component. No new top-level page, no new route in `App.jsx`, no
change to the chip bar's existing filter behavior.

**`ManageCategoriesSheet` — one new component, modeled directly on this file's own
`NewPathSheet`/`DeletePathsSheet` idiom** (`Sheet` wrapper, local `busy`/`err` state, inline
error text, no new global state):

1. **List (wires `GET /api/education/categories`).** The sheet's own `useSWR('/api/education/
   categories', fetcher)` call is the previously-uncalled read route — it becomes the sheet's
   list of category names, re-`mutate()`-d after every write made inside the sheet. Per-category
   `kind`/`sort_order`/`blurb` for the meta editor below are read from `VideosSection`'s
   already-loaded `categories` prop (the `/videos` payload already carries all three per
   category, per its own docstring) — no second, redundant fetch of the same three fields.
2. **Rename (wires `POST /categories/rename`).** One inline text field per row + "Save." Applies
   the new name to the local list immediately, reconciles or rolls back on the response, in the
   shape described in §3. When the typed target already matches an existing category name, the
   Save button's confirm copy states plainly that this **merges** every video from the old
   category into the existing one (matching `rename_category`'s own documented behavior,
   `:602-604`) — never presented as an ordinary rename.
3. **Category meta (wires `PATCH /categories/{name}`).** Three small inputs per row —
   `kind` (a `<select>` of the two real values, `show` / `library`), `sort_order` (number),
   `blurb` (text) — pre-filled from the parent's already-loaded category object, one "Save meta"
   button per row, `PATCH`ing only the fields the admin actually changed.
4. **Per-category video reorder (wires `POST /reorder`).** A "Reorder videos" toggle per row
   expands that category's videos (from the parent's already-loaded, unfiltered
   `categories[i].videos`, sorted by the server's own `sort_order` — never the search- or
   tag-filtered view) as a native-HTML5 drag list using the **exact** four-handler idiom named
   in §3 (`draggable` / `onDragStart` sets a ref / `onDragOver` prevents default / `onDrop` calls
   a reorder function then clears the ref / `onDragEnd` clears the ref as a safety net). On drop,
   computes the new `ordered_ids` array for that one category and calls `POST /reorder
   {category, ordered_ids}`.
5. **Parent refresh.** Every successful write inside the sheet also calls
   `VideosSection`'s own existing `mutate()` (the same `/api/education/videos` SWR handle
   `handleDelete` and `VideoForm.onSaved` already use, `:600`, `:1099`) so the chip bar and every
   shelf — which already render in server `sort_order` with "no client re-sort" by the file's own
   comment at `:220-222` — pick up a rename, meta change, or reorder without a manual page
   reload.

**Explicitly DEFERRED, NOT authorized by this checkpoint:**

- Any change to `api/routers/education.py` or `api/services/education_service.py` — CP1 reads
  and writes them exactly as they exist today; no new parameter, no changed response shape.
- **Creating a brand-new, empty category.** No dedicated "create category" route exists —
  `upsert_category` can create one implicitly via a PATCH to a not-yet-existing name, and a
  category otherwise comes into being the first time a video is filed under it. Adding a
  "+ New Category" affordance is a follow-on decision, not this one.
- **Deleting a category.** No dedicated delete-category route exists (only "rename it away" or
  "remove every video in it" reach that state today); adding one is out of scope.
- **Reordering the categories themselves as a group.** The only tested backend capability is
  reordering the VIDEOS inside one fixed category (`ReorderIn.category` is a single string) —
  there is no category-level ordering field or route today, and CP1 does not invent one.
- Any change to `VideoForm`'s free-text `category` input or its `<datalist>` wiring — untouched.
- An HTTP-level `require_admin`/shape test for `POST /reorder` (the gap named in §1). Worth
  doing, not this packet's to authorize building product code for; named here so it is not lost.

## 5 · Risks

| Risk | Impact | Mitigation |
|---|---|---|
| An admin renames a category onto an existing DIFFERENT category, not realizing `rename_category` merges rather than renaming | Videos silently move under an unintended category | CP1's Save-rename copy states the merge explicitly whenever the typed target matches an existing name (§4.2) — this is `rename_category`'s own already-tested, already-shipped behavior; CP1 surfaces it, does not change it |
| The reorder sub-panel computes `ordered_ids` against a search- or tag-filtered subset instead of the full category | A drop would silently drop videos out of the category's `sort_order` sequence entirely | The reorder list is built from the parent's unfiltered `categories[i].videos`, never from `filtered`/`libraryShelves` (§4.4) |
| The `Manage Categories` panel becomes reachable by a non-admin session | A paid, non-admin member could see or attempt category writes | The trigger button and the sheet are both gated on the same `isAdmin` boolean this file already computes (`user?.role === 'admin'`, `:203`) and used for every other admin affordance in this file; the three write routes stay `require_admin` at the backend regardless (unchanged by this checkpoint) |

## 6 · MUST-BUILD, exactly (when and if signed)

1. One `isAdmin`-only "Manage Categories" button in the existing chip-bar block of
   `VideosSection.jsx`.
2. One new `ManageCategoriesSheet` component, in the same file, following the
   `NewPathSheet`/`DeletePathsSheet` shape, implementing the four numbered behaviors in §4
   exactly, wired to `GET /api/education/categories`, `POST /api/education/categories/rename`,
   `PATCH /api/education/categories/{name}`, and `POST /api/education/reorder` — no other route.
3. A parent-`mutate()` call after every successful write inside the sheet, as in §4.5.
4. No file under `api/**` touched. No new database table or column. No new nav entry, no new
   top-level route.

Nothing else. Explicitly not this checkpoint: any of the five deferred items in §4, or the
HTTP-level `/reorder` test gap named in §1.
