# Notebook finish program: the security lane

Branch `feat/notebook-fin-sec`, from `72715e8001`. Source: the read-only security review of
`git diff origin/master...72715e8001 -- api` (R1-SECURITY), plus one item from the flags review
(R5, finding I4).

The review was traced from code and never run. So each finding below was checked against the
code and reproduced with a failing test before anything changed. Each fix was then broken on
purpose to see its test go red (a mutation check), and the original bytes written back.

Nothing here turns a feature on. Every route named is still dark behind its flag.

## Summary

| Finding | Verdict | Commit | The test that pins it |
|---|---|---|---|
| I-3 long write transactions | Verified, fixed | `f5afc7b542` | `tests/test_notebook_fin_sec_catchup.py` |
| R5 I4 thesis chips on a fresh database | Verified, fixed | `ce23ddf5f1` | `tests/test_notebook_fin_sec_fresh_db.py` |
| I-4 gallery attribute pass-through, and M-8 | Verified, fixed on the server | `a695f83d3f` | `tests/test_notebook_fin_sec_gallery_attrs.py` |
| I-6 gallery approve race | Verified, fixed | `0cee0950c4` | `tests/test_notebook_fin_sec_gallery_approve.py` |
| I-7 uneven paywall | Verified, ruling applied | `6c694e3527` | `tests/test_paywall_gate_free_tier.py`, section 7 |
| M-3 malformed fingerprint answers 500 | Verified, fixed | `98c8b149e7` | `tests/test_notebook_fin_sec_minors.py` |
| M-4 deep note body answers 500 | Verified, fixed (one walker left, see below) | `98c8b149e7` | same file |
| M-5 exception text returned to the client | Verified, fixed | `98c8b149e7` | same file |
| M-6 gallery list parses every body | Verified, fixed | `87e72f7df5` | `tests/test_notebook_fin_sec_gallery_minors.py` |
| M-7 purge leaves orphan reports | Verified, fixed | `87e72f7df5` | same file |
| M-1 dark routes can be told apart | Verified, NOT fixed: reported | none | measured, see below |

Not assigned to this lane and not touched: I-1, I-2, I-5, M-2, and the third part of I-3
(`passed_setups.refresh`).

## I-3. Long and per-request write transactions on the session database

**Verified.** auth.db is the session database. Its connections wait three seconds for a lock
(`api/services/auth_db.py`, `get_connection`), and one process serves every member.

- `note_levels.catch_up_all` ran one transaction across up to 150 notes. Inside it,
  `project_note` issued its DELETE before scanning up to 200 stored versions of the note.
- `chart_blocks.catch_up` ran an unconditional DELETE and a commit on every fingerprint and
  visual-playbook read, and held one transaction across every stale note.

Reproduced with a second connection, not by inspecting the first. While the code under test
was parsing, another connection asked for the write lock with a short wait. Before the fix
the lock was held on 6 of 6 note parses, and a chart read with nothing stale failed with
"database is locked" while another connection was writing.

**What changed.**
- `note_levels.project_note` does every read and parse first and writes last.
  `catch_up_all` commits each note on its own. Removals commit together, with no parsing.
- `chart_blocks.catch_up` writes nothing when nothing is stale. The cleanup of frozen rows for
  a hard-deleted note now runs only when a read finds one. Each stale note commits on its own.
- Neither runs on the event loop. That was already true (the scan is a scheduler-thread job,
  the routes are plain `def`), and a test now holds it.

**Proof the read path performs zero writes when nothing is stale:**
`test_a_chart_read_with_nothing_stale_performs_zero_writes`. It traces every statement the
connection runs, checks `total_changes` did not move, and runs the read while another
connection holds the write lock. A control test shows the same trace does see a write when
there is work to do.

## R5 I4. Thesis chips on a database with no level index

**Verified.** `thesis_chips.batch_chips` reads `j2_note_levels`. Only its owner,
`note_levels.ensure_schema`, creates that table, and on a running pod only the resurfacing
pass calls it. Turning on thesis chips before one resurfacing scan had run answered 500 on
every call ("no such table: j2_note_levels"). The older chips tests could not see this
because their connection helper created the table itself.

**What changed.** A missing table means no levels were ever projected, so the read answers an
empty result. It does not create the table: this is a read path, and the existing "exactly one
execute" rail stays true.

**Other readers of the same shape.** I listed every table created outside `db.py` by a file in
the diff, and every module that names each one:

- `j2_note_levels`: read by `thesis_chips` (fixed here). No other reader outside its owner.
- `j2_note_resurface_fires`: read by `review_drafts._resurfaced_notes`, which already catches
  the missing-table error and answers an empty list. Safe.
- `j2_chart_blocks`, `j2_chart_fingerprints`: read by `similar_matches` and `visual_playbook`
  through `chart_blocks` functions, each of which ensures the schema first. Safe.
- `j2_entry_context`, `j2_passed_setups`, `j2_similar_matches`, the three gallery tables: read
  only through their owner's functions, which ensure the schema. Safe.

No second instance was found.

## I-4. The gallery kept every attribute, and M-8

**Verified, in two places.**

On the server: twelve hostile values all reached the stored template, among them
`x;position:fixed;inset:0`, `url(...)`, `expression(`, `</style>`, a 5,400 character string,
CSS and unicode escapes, and `javascript:` and `data:` addresses.

In the editor (jsdom, the real extension list from `lib/tiptap.js`), with a hostile value
already stored:

| Stored attribute | What the editor rendered |
|---|---|
| `textStyle.fontFamily = "x; position:fixed; inset:0; background-image:url(https://evil.example/p)"` | `<span style="font-family: x; position: fixed; inset: 0px; background-image: url(...)">`. Position is fixed and the image is requested. |
| `textStyle.fontSize = "12px; position:fixed"` | `<span style="font-size: 12px; position: fixed;">` |
| `textColor.color = "red; position:fixed"` | `<span>`, no class, no style. Already narrowed by `lib/textColor.js`. |
| `highlight.color` with a quote break | `<mark class="uct-hl">`. Already narrowed. |
| `link.class = "uct-overlay"` | the class is rendered as given. Any class name passes. |
| `link.href = "javascript:alert(1)"` | `href=""`. Already refused by the Link extension. |

So the review's claim holds for font family and font size, and a link can also carry any
class name.

**What changed, on the server.** `public_note_payload.py` gains `GALLERY_ATTR_POLICY`, used in
gallery mode only:

- A node keeps `type`, `attrs`, `content`, `marks` and `text`. No other key.
- A mark keeps `type` and `attrs`. No other key.
- An attribute travels only when its type has a row, the row names it, and its value passes.
  A type with no row carries no attributes at all.
- Font family: one of the toolbar's own 22 values. Font size: a whole number of pixels from
  8 to 96. Colours: a palette name (the editor stores names, not hex). Addresses: `http` or
  `https` only, at most 2,048 characters. A link's `target` and `rel` are set, never copied.
  An embed needs a known provider and an id of that provider's shape.
- A formula that names a KaTeX link, file or HTML command does not travel.
- M-8: text inside attributes (a link card's title, description and domain, a formula) gets
  the same email and in-app address scrub as body text.

It is applied three times: at publish time (the one reducer), when a stored template is
served for preview, and when it is copied into a member's templates. A test writes a hostile
row straight into the gallery table and shows it cleaned on the way out both ways.

The value lists are the client's. The test parses the client's font table, colour palette,
callout styles and embed providers and holds the server's lists equal. The six firm seed
templates sanitize to exactly what they did before.

**One existing test changed.** `tests/test_public_note_payload.py` used
`{"color": "#fff"}` on a `textStyle` mark. The editor's `textStyle` mark has no `color`
attribute, so in gallery mode that mark now styles nothing and is dropped. The fixture now
uses a value the toolbar writes.

**Not changed, and why.**

- The client. A guard there is not one line: it means replacing TipTap's `FontFamily` and
  `FontSize` with narrowed copies in the Notebook's extension list, which touches every note
  a member opens. Recommended follow-up: narrow both in `renderHTML` the way
  `lib/textColor.js` does, and drop `class` from the Link mark. Until then the server filter
  is the only guard, which is why it runs at use time as well as at publish time.
- Share links and published pages. They use the same reducer in `share` and `publish` mode,
  and those modes still keep every attribute. They predate the reviewed diff and the review
  did not cover them. A published page is rendered read-only, not copied into another
  member's editor, but the same inline style would reach a stranger's browser. This is an
  open item for an owner decision.
- No rail derives the attribute list from the client schema. An attribute the table does not
  name is dropped, so a new attribute fails closed: it does not travel until someone adds a
  row.

## I-6. An approved template could be swapped for unreviewed content

**Verified.** Publishing again replaces the same gallery row's body and sends it back to
pending. Approval checked neither the status nor a version. Reproduced through the route: an
approval sent for the first version answered 200 and listed the second body.

**What changed.** An approval carries `reviewedUpdatedAt`, the `updatedAt` of the template as
the reviewer saw it. The UPDATE is conditional on it in its own WHERE clause, so there is no
gap between the check and the write. A mismatch, or an approval that names no version,
answers 409 with: "This template changed after you opened it. Nothing was listed. Look at it
again, then approve." Reject, hide, unhide, feature and unfeature are unchanged.

Client: the admin review panel remembers the version of each template the admin previewed
(otherwise the queue row's) and sends it. On a 409 it shows the sentence and reloads the queue.

## I-7. The paywall was applied unevenly

**Verified.** Nineteen member routes new in waves 12 to 15 checked a session and not a plan.

**Ruling applied** (owner, 2026-10-02: no free tier, everything is paywall). Each now takes
its own router's `require_paid`, the same gate its paid siblings use:

- gallery: browse, preview, use, report, unpublish
- plan grades: the trade read, re-link, status, discipline
- my playbook
- review drafts: daily, weekly, monthly
- the setups board
- before and after
- chart plan: size, benchmarks, alerts
- the tour-state write

Plan grades, My Playbook, review drafts and chart plans gained a gate of their own, each with
its own sentence. The body-reading dependencies sit behind the paid gate, so a refused
member's body is never read.

**The rail.** `tests/test_paywall_gate_free_tier.py`, section 7. The set is derived: every
route the real app serves from an `api.routers.notebook_*` module is classified from its
dependency tree and must be paid, admin-only, or named in `NOTEBOOK_NOT_PAID` with a reason.
A Notebook route added later with only a session check fails by name. The nineteen are also
named one by one, driven as a free member (402) and anonymously (401) with the flags on, with
a control that the same requests answer the dark 404 with the flags off.

`NOTEBOOK_NOT_PAID` holds 28 older routes, none of them new in this diff: the public share and
publish pages, the bearer-token personal API, the mail webhook, and 18 session-only member
routes from earlier waves. Those 18 are candidates for a later paid pass and are now pinned so
that cannot change by accident.

**Existing tests rewritten to the new rule, by name:**
- gallery: "publishing needs a paid plan and nothing else does" is now "every member route
  needs a paid plan"
- visual playbook: "the grid needs a paid plan and before-after a session" is now "the grid
  and before-after both need a paid plan"
- chart plan: a free member's sizing call is now refused at the route
- suites that faked a member with no plan now fake a paid one (plan grades, my playbook,
  review drafts, setups board, tour state, chart-plan benchmarks)

`docs/notebook/security-review-notebook-routes.md` has its paid column updated for the
nineteen rows, and its own rail passes.

**How each client caller handles a 402.** Since 2026-10-02 `AuthGuard` sends any member
without a paid plan to `/subscribe` before a member page mounts, so a 402 from these routes
is reached only when a plan lapses in an open tab. None of the callers crashes or shows an
error screen. None sends the member to the upgrade page on its own either:

| Caller | On a 402 |
|---|---|
| `lib/templateGallery.js` | shows the server's sentence in place |
| `hooks/usePlanGrade.js` | "Plan grade request failed (402)" as the hook's error |
| `components/insights/MyPlaybook.jsx` | its load-failed state |
| `lib/reviewDrafts.js` | "Review draft request failed (402)" as the caller's error |
| `components/notebook/SetupsBoard.jsx` | its load-failed block with Retry |
| `components/trade/TradeBeforeAfter.jsx` | the SWR error state |
| `components/notebook/ChartPlanPanel.jsx` (size) | "The plan could not be sized." |
| `components/notebook/ChartPlanPanel.jsx` (alerts) | shows the server's sentence |
| `components/notebook/SlashMenu.jsx` (benchmarks) | inserts nothing |
| `onboarding/tourSeenState.js` | the write is not stored; the tour state stays in this browser only |

Worth a follow-up: these could send a lapsed member to `/subscribe` the way the page guard does.

**Open decision: unpublish.** The ruling was applied as written, so taking a template down is
now paid too. A member whose plan lapsed can no longer withdraw their own published template
themselves. An admin can hide it, and deleting the account removes it. The gallery's original
rule said the opposite on purpose ("a member whose plan lapsed can always take their template
down"). If the owner wants that back, it is one line: give `unpublish_endpoint` the session
dependency and add the route to `NOTEBOOK_NOT_PAID` with the reason.

## The MINOR findings

**M-5, verified, fixed.** `chart_plan.compass_size` returned the text of whatever exception the
sizing call raised. It now returns "Compass could not size this right now." and logs the detail.

**M-3, verified, fixed.** A chart block's fingerprint is copied out of the member's own note.
Seven malformed shapes were driven through the real routers; each answered 500 on the
fingerprint, visual-playbook, setups-board and find-similar reads. Now a note fingerprint is
checked (`tech_fingerprint.well_formed`) before it is trusted. One that fails is not a
fingerprint, so the block is frozen from bars like any other. The reader also tolerates a bad
row already in the index. In each test the member's other, well-formed chart is still listed.

**M-4, verified, fixed in the files this lane owns.** The chart-block walkers recursed once per
level of nesting, so a note nested 3,000 deep answered 500 for its owner. The walk is now one
loop (`chart_blocks.iter_chart_attrs`), shared by `extract_blocks` and the visual playbook so
the two cannot disagree on document order. A body too deep for the JSON parser itself (about
50,000 levels on this Python: it raises RecursionError, which is not a ValueError) reads as a
note with no charts. **Left:** `passed_setups._walk_scan_embeds` has the same recursion and is
another lane's file. The note save path caps depth at create and import but not on the PUT
save, so such a body can be stored.

**M-6, verified, fixed.** The gallery list parsed every row's full body on every request. The
preview is now stored in a new nullable column, `preview_json`, when a template is published
or seeded. The list and the review queue read an explicit column list that leaves the body
out. A database whose table predates the column gets the column, and its rows filled, at the
next schema pass. Once filled, that pass is one read and no write.

**M-7, verified, fixed.** Deleting an author's account left other members' reports and use
records about that author's templates in the table. The purge now deletes them through the
template they key off, before the direct deletes. `docs/account-deletion-manifest.md` was
regenerated by its own tool.

**M-1, verified, not fixed.** Measured on the real app as an anonymous caller:

| Request | Answer |
|---|---|
| a path no router serves | 404, `{"detail":"Not Found"}`, no extra headers |
| a dark route in ten of the new routers (gallery shown) | 404, `{"detail":"Not found"}`, four extra headers |
| a dark route in plan grades, my playbook, review drafts, onboarding | 404, `{"detail":"Not Found"}`, no extra headers |
| the gallery with its flag on | 401, `{"detail":"Not authenticated"}` |

That was measured in this worktree, which has no built frontend. With one (production), the
catch-all at `api/main.py` answers an unknown GET with `index.html` and 200, and an unknown
POST with 405. That part is from reading the code, not a measurement.

So a dark route can be told from a missing one, and whether a flag is on can be read without
an account. It cannot be fixed in a shared gate dependency:

- There is no shared gate. Each router has its own `_require_enabled`. The one shared piece,
  `public.not_found()`, is also the answer for a real miss (an unknown share token), which
  must stay a 404.
- A dependency can only raise a status and a JSON body. To answer like an unknown route it
  would have to return the frontend's `index.html` for a GET and a 405 for a POST. That needs
  an application-level handler in `main.py` and a change in about fourteen routers, and the
  many tests that assert "404 while dark".
- The second half cannot be fixed by the gate at all. With a flag on, an anonymous caller
  gets 401. Hiding that means the gate reading the session, which is the opposite of the
  design (the gate runs before the session), or answering anonymous callers with a page
  instead of 401, which breaks the client's sign-in handling.

What leaks is that a route exists in the build and whether its flag is on. No feature and no
data. Recommended as its own small task if the owner wants it closed.

## Tests

Run by named file, totals read from a log:

| Command (each `python -m pytest ... -q -p no:cacheprovider`) | Totals line |
|---|---|
| `tests/test_notebook_fin_sec_catchup.py` with the note-level, chart-block, visual-playbook, similar-matches, sample-notebook and thesis-chips suites | 142 passed |
| `tests/test_notebook_fin_sec_fresh_db.py tests/test_notebook_thesis_chips.py` | 16 passed |
| the gallery, public-payload, public-headers, share-label, citation-text and rollback-chain suites | 992 passed, 1 skipped, 1 failed, then `tests/test_public_note_payload.py` alone after its fixture fix: 382 passed |
| `tests/test_share_publish_authorization.py tests/test_note_publish.py` | 250 passed |
| the paywall rail with the fourteen affected router suites | 431 passed, 1 failed (pre-existing, below) |
| `tests/test_notebook_route_security_census.py` | 9 passed |
| the flag, preference-key, capture-auth-boundary, upload-door, census and wire-paywall suites | 499 passed, 1 xfailed, 1 failed (pre-existing, below) |
| `tests/test_notebook_fin_sec_minors.py` with the chart, playbook, board, similar-matches and fingerprint suites | 196 passed |
| the gallery and account-purge suites after M-6 and M-7 | 190 passed |
| vitest `TemplateGallery.test.jsx`, `freePages.paywallAll.test.jsx` | 19 passed |

**Two failures that this branch did not cause:**

- `tests/test_user_definitions_auth.py::test_require_paid_is_defined_PER_ROUTER_and_this_task_invented_no_shared_one`.
  Three older routers (`screener.py`, `screener_nl.py`, `screen_promote.py`) refuse with the
  same sentence. It failed the same way before any change here (81 distinct of 83, now 85 of
  87). The four sentences added on this branch are distinct.
- `tests/test_notebook_flag_parse.py::test_every_flag_on_call_names_a_payload_flag`. It names
  `tools/runtime_pane_smoke.py`, which this branch does not touch (the branch changes nothing
  under `tools/`).

## Mutation checks

Each fix was broken on purpose with the original bytes captured first and written back after,
checked by sha256 and by `git status`. Every mutation went red: 4 for I-3, 1 for the chips
read, 10 for I-4, 4 for I-6, 5 for I-7, 5 for M-3 to M-5, 5 for M-6 and M-7.

One mutation did not go red on the first try: removing the RecursionError catch at the body
parse. The test body (3,000 levels) parsed fine, so the catch was unproved. A test at 60,000
levels, with a control that `json.loads` really does refuse it, was added and the mutation
then went red.

## One process note

While reading a test log I ran `git stash` by mistake, which the lane rules forbid. It took
the uncommitted paywall work off the tree. I restored it from the stash's own commit, checked
the working tree against that commit (no difference), and removed only that entry, so the
shared stash list is as it was before. Nothing was lost and no other entry was touched.
