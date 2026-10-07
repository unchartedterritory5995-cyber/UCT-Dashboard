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
| M-1 dark routes can be told apart | Verified, NOT fixed: reported and accepted as is | none | measured, see below |
| Round 2: a takedown is never paywalled | Ruling applied | `26124b23f5` | `tests/test_paywall_gate_free_tier.py`, `test_a_TAKEDOWN_is_never_paywalled_but_still_needs_a_session` |
| Round 2: share links and published pages kept every attribute | Verified on the rendered page, fixed | `4b8a5a68cd` | `tests/test_notebook_fin_sec_public_attrs.py`, `public/ReadOnlyNote.hostile.test.jsx` |
| Round 2: the editor rendered a stored font value as CSS | Verified, fixed | `756484b787` | `lib/tiptap.textStyleGuard.test.js` |

Round 2 (2026-10-07) is at the end of this file. It reverses one decision of round 1
(unpublish is session-only again) and closes two items round 1 left open (the public pages
and the editor).

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

**Left open in round 1, closed in round 2** (see the end of this file): the client guard,
and the same pass-through on share links and published pages.

**Still true.** No rail derives the attribute list from the client schema. An attribute the
table does not name is dropped, so a new attribute fails closed: it does not travel until
someone adds a row.

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

- gallery: browse, preview, use, report (unpublish too in round 1; reversed in round 2)
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

**Unpublish.** Round 1 applied the ruling as written, which made taking a template down
paid. The owner ruled on 2026-10-07 that a member can always take their own content down.
Round 2 reversed it; see the end of this file.

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
another lane's file (lane DATA has it). The note save path caps depth at create and import but not on the PUT
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

# Round 2 (2026-10-07)

Three items from the controller after round 1. Same method: test first, one commit each.

## A member can always take their own content down

**Ruling** (owner, 2026-10-07): a member must always be able to take their own content down,
whatever their plan. Publishing, browsing and using stay paid.

Each of the nineteen routes the paywall change closed was checked against it:

| Route | What it does | Verdict |
|---|---|---|
| `DELETE /api/j2/template-gallery/{gallery_id}` | removes the caller's own published copy, nothing else | **session-only again** |
| gallery browse, preview | reads other members' templates | stays paid |
| gallery use | copies a template into the caller's templates | stays paid |
| gallery report | writes a report about someone else's template | stays paid |
| plan grades: trade read, status, discipline | computed grades over the caller's trades | stays paid |
| plan grades: re-link | writes a plan link | stays paid |
| my playbook, the three review drafts, the setups board, before and after | computed features | stays paid |
| chart plan: size, benchmarks, alerts | sizing, market reads, arming an alert | stays paid |
| tour-state write | stores a preference | stays paid |

None of the other eighteen removes or hides the caller's content, and none is an export or
deletion read of data they created. The member's own notes, trades and export routes are
older than this diff and were never made paid by it.

`tests/test_paywall_gate_free_tier.py` pins unpublish in `NOTEBOOK_NOT_PAID` with the takedown
reason. A new test asserts a takedown is never paywalled, still needs a session, and answers a
member with no paid plan. `tests/test_notebook_template_gallery.py` drives it: an author with
a free plan is refused the gallery list (402) and can still unpublish (200).

## Share links and published pages

**Established first, on the rendered page.** A share link and a published page are public and
served from our own domain. The page is the app shell; the browser fetches the reduced note
as JSON (`GET /api/j2/shared/{token}`, `GET /api/j2/published/{slug}`) and renders it with the
real editor extensions, read-only (`public/ReadOnlyNote.jsx`). There is no server-rendered
HTML of the note; the HTML a visitor's browser ends up with is what that component builds.

A note was stored with hostile values, put through both reducers, and the result rendered on
that component (jsdom). Before the fix, for both modes:

| Stored | Served by the reducer | HTML in the visitor's browser |
|---|---|---|
| `fontFamily: "x; position:fixed; inset:0; opacity:0.01; background-image:url(https://evil.example/p)"` | unchanged | `<span style="font-family: x; position: fixed; inset: 0px; opacity: 0.01; background-image: url(&quot;https://evil.example/p&quot;);">` |
| `fontSize: "12px; position:fixed; top:0"` | unchanged | `<span style="font-size: 12px; position: fixed; top: 0px;">` |
| `textColor.color: "red; position:fixed"` | unchanged | `<span>`. The editor already drops a colour that is not a palette name. |
| `highlight.color` with a quote break | unchanged | `<mark class="uct-hl">`. Already narrowed. |
| link with `class: "uct-overlay modal-backdrop"`, `target: "_self"`, `rel: "opener"`, `title` | unchanged | `<a target="_self" rel="opener" class="uct-overlay modal-backdrop" href="https://evil.example/go" title="t">` |
| link with `href: "javascript:alert(1)"` | the link is removed, the words stay | plain text |

So an author could put an invisible full-screen box over their own public page and make every
visitor's browser fetch an address of the author's choosing, and could give a link any class
the app's stylesheet defines, with `rel="opener"`. Script injection was not possible by this
path: `javascript:` links were already refused, and a style attribute cannot run script.

**What changed.** The gallery's attribute table now applies to share and publish too, through
`PUBLIC_ATTR_POLICY`. It differs from the gallery's only where a member's own page carries
more:

- a checked task stays checked;
- an image keeps its address (already checked by the reducer), alt, title, width, height and
  alignment, and nothing else;
- a link may be `http`, `https` or `mailto`; its `target` and `rel` are set to `_blank` and
  `noreferrer`, never copied; no class and no title;
- colours: a palette name or a hex colour. The editor stores and renders palette names only,
  so a hex value passes the server and is then dropped by the editor's own narrowing;
- fonts and sizes: every value the Font picker offers, or any value of a strict shape that
  cannot hold a second CSS declaration (none of `; : ( ) { } \ / < > ! @` can match). Sizes
  are `px`, `pt`, `em`, `rem` or `%` within bounds, or a CSS size keyword. The shape rule is
  there so a font or size that arrived by paste or import (Word's `Calibri`, `11pt`), which
  the member sees in their own editor, is not stripped from their public page. The gallery
  keeps the stricter fixed list, because a template is copied into other members' notebooks.

After the fix the same note renders as plain spans, plus a link with `target="_blank"` and
`rel="noreferrer"` and no class.

**Tests on the final rendered output.** `tests/fixtures/notebook_public_hostile.json` holds a
hostile note and the reducer's current share and publish output for it. A Python test
rewrites the file and fails when it is out of date. `public/ReadOnlyNote.hostile.test.jsx`
renders that file on the real public page component and asserts that the only inline style
left is the author's legitimate `font-family: Georgia, serif` and `font-size: 18px`. The
Python side also drives twelve hostile values through both reducers and six through the real
public routes.

**The public page's Content-Security-Policy.** There is none. Checked in the code:

- The page itself is `index.html` from `spa_index_response` in `api/main.py`. On a public
  note path it adds `X-Robots-Tag: noindex, nofollow` and `Referrer-Policy: no-referrer`, plus
  `Cache-Control`. No `Content-Security-Policy`, and none in `app/index.html`.
- The two JSON routes carry `Cache-Control: no-store, private`, `X-Robots-Tag`,
  `Referrer-Policy` and `X-Content-Type-Options: nosniff`. No CSP.
- Only the public image routes carry one: `default-src 'none'`.
- A search of `api/` finds no other place that sets the header. Whether Cloudflare adds one
  at the edge was not checked.

So nothing at the browser level limits inline styles, outside images or outside frames on a
public note page. Everything rests on the reducer and the editor guard. A policy for the two
public paths (for example `style-src` without `unsafe-inline` is not possible while TipTap
writes inline styles, but `img-src`, `frame-src`, `connect-src` and `base-uri` could be
narrowed) is recommended as its own task. It needs a real browser pass, because the app shell
is shared with every other page.

## The editor's own guard

**Verified** (round 1 measured it; round 2 fixed it). TipTap's stock FontFamily and FontSize
render the stored value into an inline style with no check, and content loaded as JSON never
passes `parseHTML`.

**What changed, in `lib/tiptap.js` only.** The Notebook's extension setup registers guarded
copies of the two extensions (`FontFamily.extend`, `FontSize.extend`, so the names, options
and commands are unchanged). A value is checked on the way in (`parseHTML`) and again on the
way out (`renderHTML`), the way `lib/textColor.js` does for colours. The stored value is never
rewritten; only what reaches the DOM is checked.

The rule is the public reducer's: every value the Font picker offers (`FONT_OPTIONS`), or the
strict shape described above. Both guards are tested against one case table,
`tests/fixtures/notebook_text_style_cases.json`, so the server's and the editor's cannot drift.

**No existing formatting is stripped.** `lib/tiptap.textStyleGuard.test.js` runs on the real
extension list and derives the legitimate values rather than retyping them:

- all 22 Font picker values, from `utils/fontFamilies.js` `FONT_OPTIONS`;
- all 17 Size picker values, read out of `NoteEditorPage.jsx`'s own `FONT_SIZES` array (a
  private const, so the test reads the source and also checks the picker still writes
  `${s}px` from it);
- pasted and imported forms from the shared case table.

Each renders exactly as before. Each hostile case renders no style at all.

**Paste and import.** Both call the same guard:

- Paste goes through the editor's `parseHTML`, which is the guarded one.
- The file importer builds its JSON with `generateJSON(html, buildExtensions())`
  (`lib/importer/convert.js`), the same extension list. Tested.
- One import path does not parse HTML: a note from our own JSON export is taken as its stored
  body (`heldBody`). That body is still checked when it is rendered.

**Limits, stated plainly.**
- A font name with non-Latin letters (for example a Japanese font name) does not match the
  shape and is not rendered as a font. The text itself is untouched.
- The Link mark still renders any `class` and `title` a stored link carries. The public
  reducers and the gallery now remove both before they are served, so this only affects a
  member's own notes in their own editor. Narrowing it means reconfiguring the Link
  extension; not done here.
- The Notebook's first-open byte budget was not measured. This adds about 3 KB of source to
  `lib/tiptap.js` and no new dependency. A build was not run (disk space). The byte check is a
  promotion gate, so it needs one run before this lands.

## Round 2 tests

| Command | Totals line |
|---|---|
| `python -m pytest` on the share, publish, public-payload, gallery, paywall, route-census and capture-auth-boundary suites, by name (16 files) | 963 passed, 1 skipped |
| `npx vitest run lib/tiptap.textStyleGuard.test.js public/ReadOnlyNote.hostile.test.jsx` | 130 passed |
| `npx vitest run` on the 58 Notebook test files that use the extension config, plus the two public page tests and the gallery test (61 files) | 1342 passed |

Mutation checks, all red: 1 for the takedown, 7 for the public reducers, 6 for the editor guard.

One round 1 test was replaced: the gallery attribute test's control read share mode to show
the hostile fixture really carried the value. Share mode now filters it, so the control counts
the value in the fixture itself.
