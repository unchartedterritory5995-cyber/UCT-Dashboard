---
id: PACKET-AB
title: RG-39 — POST /api/screener/count (preview_count) is fully built, competitor-grounded, and wired to nothing in app/src — pre-implementation gate
role: the packet an approval line must name a checkpoint in
status: PROPOSED, unsigned
date: 2026-09-22
---

# PACKET AB — the screener's already-built live match-count endpoint has no frontend door

## ⛔ APPROVAL — EMPTY, and that is its correct state

```
APPROVED BY:      Patrick (owner)
APPROVED ON:      2026-09-23
APPROVED AT SHA:  bc19457cf
SCOPE APPROVED:   CP1 ONLY — the checkpoint(s) named here and nothing else in the packet.
```

> ⛔⛔ **NOT AUTHORIZED. PROPOSED** — no existing checkpoint governs
> `api/routers/screener.py`'s `/api/screener/count` route or `FilterRail.jsx`'s rail surface.
> **Non-collision:** grepped `docs/terminal-research/12-decisions/gates/` (every `packet-*`
> file — all 26 single letters A–Z taken) and the root `.scopes/` directory (same stems), in
> this worktree, plus every `PACKET-[A-Z]{1,3}` string (case-insensitive) across both this
> worktree's `docs/` and the full `s7-price-level` checkout, immediately before writing this
> file. Per the dispatching instructions, `AA` was already claimed by a concurrent sibling
> agent. Re-verifying independently, this pass also found
> `packet-ac-post-signup-referral-apply-gate.md` (RG-37) and its scope file already present in
> this shared worktree, **uncommitted** (`git status --porcelain` shows both as `??`) — a
> second concurrent sibling mid-flight, already claiming `AC`. Neither `AA` nor `AC` is
> therefore available; `AB` is confirmed free — absent from every gate file, every scope file,
> and every `PACKET-`/`packet-` string found anywhere in either worktree — and is the letter
> used here.

⛔ **ZERO PRODUCT CODE.** No file under `api/**` or `app/**` has been edited to produce this
packet. It proposes exactly one checkpoint (§4); nothing in it authorizes writing product code
beyond that scope. CP1 is **frontend-only** — the backend endpoint it wires already exists,
already works, and is already covered by its own backend test file
(`tests/test_screener_preview_count.py`). No new route, no schema change, no change to
`api/routers/screener.py` or `api/services/screener/query.py`.

---

## 1 · The finding, independently re-verified fresh against current source (2026-09-22, `s7-price-level` HEAD `76ef96c06`)

**The route, read in full** (`api/routers/screener.py:217-229`):

```python
@router.post("/api/screener/count")
def screener_count(spec: ScanSpec, user=Depends(require_paid)):
    """How many rows this spec would return — benchmark metric 450.

    ⛔ Same gate as `/scan` and the same `user_id` source: the spec may carry a
    `list` filter naming the member's own watchlists, so a count route reading
    the id off the body would leak exactly what the scan route refuses to.
    """
    try:
        return scr_query.preview_count(spec.model_dump(),
                                       user_id=(user or {}).get("id"))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
```

`ScanSpec` (`:116-122`) is the exact same Pydantic body `/scan` accepts: `filters: list[dict]`,
`sort: dict|None`, `view: str`, `columns: list[str]|None`, `page: int`, `page_size: int`. Gated
by `require_paid` (`:68-71`) — identically to `/scan`, and the docstring's own reasoning for why
`user_id` must come from the auth dependency rather than the body is the same leak class the
route file's header already documents for `/scan` (`:239-242`): a `{"key":"list"}` filter
resolves a member's own watchlists/flags/tags, so trusting a client-supplied id would let one
member screen another's private lists.

**`preview_count()` genuinely shares the query-plan machinery with `/scan` — confirmed by
reading both call sites, not the docstring's claim alone** (`api/services/screener/query.py`):

```python
def preview_count(spec, user_id=None):                                  # :1202
    spec = spec or {}
    with snapshot_db.connect() as conn:
        plan = build_scan_sql(spec, _overlay(conn), user_id=user_id, conn=conn)   # :1225
        total = conn.execute(
            f"SELECT COUNT(*) FROM {plan['from_sql']}{plan['where']}",
            plan["describe_params"]).fetchone()[0]
    ...
```

```python
def run_scan(spec, user_id=None, user=None):                            # :1241
    ...
    with contention_trace_temp.stage("build_dynamic_plan"):
        plan = build_scan_sql(spec, _overlay(conn), user_id=user_id, conn=conn)   # :1255
    with contention_trace_temp.stage("sql_execute_fetch"):
        rows = conn.execute(plan["sql"], plan["params"]).fetchall()
```

Both functions call the identical `build_scan_sql(...)` — same filters, same joins, same
`WHERE`, same rank-completeness exclusion. `preview_count` then runs `SELECT COUNT(*) FROM
{plan['from_sql']}{plan['where']}` against that plan's own `from_sql`/`where`/`describe_params`;
`run_scan` runs `SELECT ... FROM {plan['sql']}` (the full statement) against the SAME plan
object. This is not a parallel re-implementation that happens to agree today — it is the same
plan, consumed two ways. The route's own docstring benchmark citation (`query.py:1202-1221`)
names Zacks (disables its Run button at zero matches), Trade Ideas (a per-filter histogram) and
thinkorswim (pre-scan match counts) as the precedent this closes, and states the design
intent explicitly: *"a preview that could disagree with the screen it previews is worse than no
preview, because the member would tune against a number that never arrives."*

**Response shape** (`query.py:1230-1238`): `{count: int, empty: bool, top_n: int|None,
scan_joins: [...], list_joins: [...]}`. `empty` is carried as its own named boolean rather than
inferred from `count == 0` by every future consumer — the docstring says so explicitly
(`:1232-1234`).

**Zero frontend callers — confirmed exhaustively, case-insensitive, against the current
`app/src` tree**, all four query forms named in the task, re-run fresh this pass:

```
grep -rni "screener/count"  app/src   → 0 hits
grep -rni "previewCount"    app/src   → 0 hits (only "previewCounts" — an unrelated Notebook
                                                 note-import feature, see §2)
grep -rni "preview_count"   app/src   → 0 hits
grep -rni "matchCount"      app/src   → 0 hits (only "matchCount" in an unrelated Notion-import
                                                 heuristic and the Notebook's in-document find bar,
                                                 see §2)
```

Backend-only hits: `api/services/screener/query.py` (the implementation itself),
`api/routers/screener.py` (the route), `tests/test_screener_preview_count.py` (backend unit
tests — direct calls to `Q.preview_count(...)`, no HTTP layer exercised), and one incidental
match inside `tools/screener_ui_stress.py` discussed in §3 (a DOM-shape check on a *different*
element, not a caller of this endpoint).

## 2 · What the frontend already does today — corrected premise

**The finding as handed to this task assumed a "Run button" that does not exist on `/screener`
today, and that assumption is wrong; the packet corrects it here rather than carrying it
forward silently.**

`app/src/pages/Screener.jsx` (read in full) mounts exactly one thing: `<ScannerShell/>`. Its own
header comment states the reason plainly — *"THIS PAGE IS THE SCANNER NOW — there is no tab
strip, because there is nothing to switch between. The Candidate Board … and Live Scan retired
2026-08-29."* There is no `Run`/`Scan now`/`Apply` button anywhere in `Screener.jsx`, the
`screener/shell/` directory, or `components/chart/builder/` (grepped for `Run scan`, `>Run<`,
`Run screen`, `runScan`, `onRun`, `handleRun` — zero hits across `app/src/pages/screener/`).

Instead, `ScannerShell.jsx` already runs a **live, auto-firing scan**:
`app/src/pages/screener/hooks/useScreenerScan.js` (46 lines, read in full) debounces 300ms and
`POST`s the current filter spec to `/api/screener/scan` on every change, race-guarded by a
sequence counter. `ScannerShell.jsx:102` (`const { result, isLoading, error } =
useScreenerScan(scanSpec)`) feeds `result.total`/`rows.length`/`isLoading` straight into
`ShellToolbar`, whose own status line (`ShellToolbar.jsx:173-175`) already renders exactly the
concept this task set out to add:

```jsx
<span className={styles.statusLine} aria-live="polite">
  {isLoading && !shown ? 'Scanning…' : `${(total ?? 0).toLocaleString()} matches`}
</span>
```

A zero-match spec already renders a dedicated empty state (`ScannerShell.jsx:315-319`, *"No
stocks match the current filters. Remove a chip above or Reset…"*) rather than an empty table —
there is no button to "disable at zero" because there is no button in the first place; the
screen itself already says so.

**`components/chart/builder/{BuilderSheet,ConciergeBox}.jsx` are a different feature, confirmed
by reading their code, not guessed from the task's file list.** They are the Pine/pattern
condition authoring sheet (`ScreensManager.jsx:22,764` mounts `BuilderSheet` lazily for
"New scan," which here means composing a reusable *condition definition*, not tuning the
numeric/threshold filters `FilterRail.jsx` renders). Grepped for `screener/count`,
`previewCount`, `matchCount`, `screener/scan` inside `BuilderSheet.jsx` — no hits relevant to a
scan match count; its own "preview" concept (`PreviewPane.jsx`, `previewDefinition`) is a chart
preview of an indicator/pattern draft, an unrelated use of the word. `FilterRail.jsx` — the
actual filter-editing UI — lives at `app/src/pages/screener/shell/FilterRail.jsx`, not under
`components/chart/builder/`; confirmed by reading the directory rather than the task's assumed
path. It has exactly one importer, `ScannerShell.jsx`, mounted twice: the desktop rail
(`:232-235`) and, verbatim, inside the mobile `FiltersSheet` body (`:376-379`).

**A second, smaller, adjacent finding worth naming precisely so it is not conflated with the
main one:** the mobile `FiltersSheet`'s footer button already reads `Show results (N)`
(`app/src/components/mobile/FiltersSheet.jsx:28-32`), but `N` is `activeCount` —
`Object.keys(s.filters).length`, the count of **active filter fields**, not a match count.
`FiltersSheet.jsx` is a generic, reusable component (its own header comment: *"the canonical
mobile filter pattern"*) with no single importer restricted to the screener, so its `activeCount`
prop is deliberately left alone by this packet (see §4's deferred list) rather than repurposed.

**`matchCount`/`previewCount(s)` hits found and explicitly ruled out as unrelated:**
`app/src/pages/journal-2-0/lib/importer/adapters/notion.js:55-56` (a Notion-import
file-heuristic score), `app/src/pages/journal-2-0/components/notebook/import/ImportWizard.jsx`
(create/update/unchanged counts for a note-import dry-run), and
`app/src/pages/journal-2-0/components/notebook/NoteFindBar.jsx` (an in-document text-search
counter). None of the three touch the screener or either scan endpoint.

## 3 · Why a real, narrow gap still remains

Even though `ScannerShell` already shows a live match count, it is sourced **entirely** from the
heavier `/api/screener/scan` call — never from the purpose-built, already-shipped, already
backend-tested `count`-only endpoint whose own docstring states its whole reason for existing is
to answer the same question faster and cheaper, with a structural guarantee it can never
disagree with the real run (§1). Concretely, today:

- The "N matches" text only updates after **both** the 300ms debounce **and** the full scan's
  round trip resolve — `run_scan` pays for a fully materialized page of rows (`SELECT ... ORDER
  BY ... LIMIT`), the snapshot provenance description (`snapshot_db.describe_rows`), and, on a
  *ranked* screen, **two additional `COUNT(*)` queries** for the rank receipt (`query.py:
  1283-1297`) — strictly more work than `preview_count`'s single `COUNT(*)` — just to report a
  number `preview_count` could answer alone.
- The live count lives in `ShellToolbar`, physically apart from `FilterRail.jsx` — the surface a
  member is actually looking at while dragging a slider or typing a threshold on desktop
  (`railSlot`, rendered to the *left* of `.main`, `ScannerShell.jsx:239-240`) or scrolling a
  bottom sheet on mobile. There is no feedback at all at the point of interaction until the full
  scan lands.
- ⚠️ **A genuine collision this re-verification found, worth recording as a build-time
  constraint rather than discovering it at build time:** `tools/screener_ui_stress.py`
  (`:158-162`, `:295-300`) already reads `document.querySelector('[aria-live="polite"]')` —
  the *first* match in document order — and asserts its text matches `/^[\d,]+\s+matches$/` or
  `"Scanning…"`. `FilterRail`'s rail DOM-renders *before* `ShellToolbar` in `ScannerShell.jsx`'s
  tree (`railSlot` at `:239` precedes `.main` at `:240`), so a new `aria-live="polite"` element
  added inside `FilterRail` would become the FIRST match and silently redirect that harness's
  check away from `ShellToolbar`'s status line — the harness would keep passing, but it would
  no longer be watching what it thinks it is watching. CP1 avoids this by construction (§4).

## 4 · Proposed checkpoint

| CP | scope | strands? | size |
|---|---|---|---|
| **CP1** | One live match-count badge in `FilterRail.jsx` (both the desktop `rail` and mobile `sheet` variants), fed by a new debounced hook calling the already-shipped `POST /api/screener/count` — decoupled from, and never replacing, `ShellToolbar`'s existing full-scan status line. No backend change. | none | **S** — one new hook file + a small addition to one existing component |

### CP1 — exactly what changes, and nothing else

1. **New hook, `useScreenerCount(spec)`**, mirroring `useScreenerScan.js`'s own shape (debounce
   + a `seq` ref guarding out-of-order responses) but `POST`ing to `/api/screener/count` instead
   of `/api/screener/scan`, with a **materially shorter debounce than the existing 300ms**
   (e.g. ~120ms) so the count is felt as the fast signal relative to the heavier call already in
   flight. It takes the **same `scanSpec`** `ScannerShell.jsx` already computes and already
   passes to `useScreenerScan` (`:99-102`) — no second spec-building path, no drift between what
   the two endpoints are asked about. Returns `{count, empty, isLoading, error}`.
2. **`ScannerShell.jsx`** calls the new hook alongside the existing one and passes its result
   down as new props to both `FilterRail` mounts (`:232-235` and `:376-379`) — `matchCount`,
   `matchCountEmpty`, `matchCountLoading`.
3. **`FilterRail.jsx`** renders the badge near the top of the rail, beside the existing
   "Find a filter…" search row (`:42-49`) — the exact point a member's eye is already on while
   editing filters. Text: `"Scanning…"` while pending, `"{count} matches"` / `"0 matches"`
   otherwise — the **same wording** `ShellToolbar`'s line already uses, so the two can never
   read as disagreeing even when one is a beat ahead of the other. Zero-count state gets a
   visually distinct (muted/warning) treatment, echoing the tone of the existing
   `styles.empty` message (`ScannerShell.jsx:316-319`) without importing or restating its copy.
4. **⛔ The new badge does NOT carry `aria-live="polite"`** (§3's named collision) — it is a
   visual affordance, not a second accessibility announcement of the same fact `ShellToolbar`
   already announces. `ShellToolbar.jsx` is untouched by this checkpoint; its status line keeps
   sole ownership of `aria-live="polite"` on this screen, and `tools/screener_ui_stress.py`'s
   existing check keeps watching the element it was written for.

**Explicitly deferred, NOT authorized by this checkpoint:**

- Any change to `api/routers/screener.py`, `api/services/screener/query.py`, or the response
  shape either endpoint returns.
- Any change to `ShellToolbar.jsx`, `useScreenerScan.js`, or `/api/screener/scan`'s call site —
  the existing full-scan-derived count stays the authoritative number for the loaded result set.
- Any change to the generic `components/mobile/FiltersSheet.jsx` component or its `activeCount`
  prop's meaning (§2's second finding) — that component has callers outside the screener and
  repurposing a shared prop's semantics is a separate decision.
- Skipping or short-circuiting the full `/api/screener/scan` call when the new count reads zero.
  The existing empty-state UX (`ScannerShell.jsx:315-319`) already handles a zero-match result
  correctly once the full scan lands; making the count *drive* whether the full scan fires at
  all is a genuine follow-on optimization, not this checkpoint's to authorize.
- Any change to `BuilderSheet.jsx`/`ConciergeBox.jsx` — confirmed unrelated in §2.

## 5 · Risks

| Risk | Impact | Mitigation |
|---|---|---|
| A new `aria-live="polite"` element inside `FilterRail` becomes the first DOM match and silently redirects `tools/screener_ui_stress.py`'s existing status-line check | The harness keeps passing while no longer watching `ShellToolbar`'s line | CP1's badge carries no `aria-live` attribute at all (§4.4) — named explicitly rather than left to be found at build time |
| The new hook's count and the existing scan's total disagree on screen at some instant, read as "the screener is broken" | Member distrust of the number shown | Both derive from the identical `build_scan_sql()` plan (§1) and render identical wording ("N matches"/"Scanning…"), so any visible difference is only ever a timing lead, never a disagreement in value — and the badge is visually secondary to `ShellToolbar`'s line, not a replacement |
| The new hook fires a `/count` request on every keystroke of a text-search filter, adding load beyond what the existing 300ms-debounced `/scan` already costs | Marginal additional backend load per filter edit | `preview_count` is a single `COUNT(*)` against an already-open snapshot connection — materially cheaper per-call than the full scan it runs alongside, and the two share one spec so no new client-side filter-building logic is added |

## 6 · MUST-BUILD, exactly (when and if signed)

1. New file `app/src/pages/screener/hooks/useScreenerCount.js` — debounced (~120ms),
   sequence-guarded `POST /api/screener/count` over the same spec `useScreenerScan` already
   consumes; returns `{count, empty, isLoading, error}`.
2. `ScannerShell.jsx`: call the new hook, pass its result to both `FilterRail` mounts as new
   props. No change to `useScreenerScan`, `ShellToolbar`, or either mount's existing props.
3. `FilterRail.jsx`: render the badge beside the search row, using the props from (2); no
   `aria-live` attribute on the new element.
4. No file under `api/**` touched. No change to `ShellToolbar.jsx`, `FiltersSheet.jsx`,
   `BuilderSheet.jsx`, or `ConciergeBox.jsx`.

Nothing else. Explicitly not this checkpoint: any of the items in §4's deferred list.
