# Wave 12, lane 12A: the community template gallery

Branch `feat/notebook-w12a` (worktree `C:\Users\Patrick\uct-worktrees\notebook-w12a`), from
master `cf5e38d5d2`. Flag `NOTEBOOK_TEMPLATE_GALLERY_ENABLED`, unset = OFF (an enablement gate,
`docs/feature_flags.json` status `dark`). Contract: `docs/notebook/WAVE-12-PLAN.md` §1 (branch
`feat/notebook-w12-plan`, `ae043b4884`).

## What it is

A member shares a COPY of one of "Your templates" to a community gallery. The copy is PENDING
and visible only to its author and to admins until an admin approves it (the owner's "reviewed
before publishing", `WAVE-11-PLAN.md`:20). Members browse the gallery from the New note dialog,
preview a template read-only and press **Use template**, which copies it into their own Your
templates. "Make a note from it" then hands that copy to the same `onPickMember` door every
member template uses. UCT picks are six firm templates plus anything an admin features. Members
report a listed template; admins approve, reject with a reason, hide and unhide.

| Piece | Where |
|---|---|
| Service | `api/services/journal_two/template_gallery.py` |
| Routes | `api/routers/notebook_template_gallery.py`, `/api/j2/template-gallery/*`, mounted in `api/main.py` with the other Notebook routers |
| Tables (auth.db) | `j2_template_gallery`, `j2_template_gallery_reports`, `j2_template_gallery_uses`, created by `journal_two.db.ensure_schema` through `ensure_gallery_schema` |
| Firm seed | `api/services/journal_two/template_gallery_seed.json` (INSERT OR IGNORE by `seed_key`) |
| Privacy | `public_note_payload.reduce(..., mode="gallery")`, the third mode of the one reducer |
| Client | `lib/templateGallery.js`, `components/notebook/TemplateGallery.jsx`, `GalleryPublishForm.jsx`, `app/src/components/admin/TemplateGalleryReviewPanel.jsx`; a door in `TemplatePicker.jsx` and **Share** in `MemberTemplates.jsx` |
| Rails | `tests/test_notebook_template_gallery.py`, `tests/test_public_note_payload.py` (gallery mode), `TemplateGallery.test.jsx`, `a11y/templateGallery.a11y.test.jsx` |

## What leaves the author's account

The body goes through `public_note_payload.reduce` in `gallery` mode, never a second sanitiser.
That mode keeps the scaffold (headings, text, lists, tables, callouts, toggles, math, external
links and embeds) and:

* drops every image and image-bearing attribute: images, figures and captions, and a link card's
  picture. This includes external images; re-uploading is a later step;
* drops every `askInsert` (writing help included) and every `askCitation`, because both were
  computed from the author's private notes;
* drops attachment chips; turns a `noteLink` into the words "linked note"; turns every
  market-data node (widget, fact, excerpt, trade canvas) into the neutral line, whatever its
  vendor;
* scrubs in-app addresses (as on share/publish) and email addresses, written as text or as a
  `mailto:` link;
* unchecks task items.

The title and description get the same text scrub. Property **values** never travel. Each
property's **definition** does: name and type, plus option labels and colours for a select.

## Decisions for the owner

Each was a product call I could not default with certainty. I took the conservative option and
recorded it here.

1. **Who reviews.** Any account with `role = 'admin'` (the `ADMIN_EMAILS` set) can approve,
   reject, hide, unhide and feature. The plan asks the owner to name the reviewer (WAVE-12-PLAN
   §4.2). If it should be a narrower set, that needs a new role or list.
2. **Publishing needs a paid plan.** Browsing, using and reporting need a session only (member
   templates are free by the wave-6 ruling). Unpublish never needs a plan: a member whose plan
   lapsed can always take a template down.
3. **Unpublish deletes the author's gallery copy**, with its reports and use counts. It is the
   author's own request about their own copy, the same reasoning as account deletion. Copies
   other members already made stay theirs. Admin **hide** never deletes: it sets `hidden = 1`.
4. **Editing sends a template back to review.** Publishing again from the same source template
   updates the one gallery copy, sets it to pending, clears its listing date and unfeatures it.
   A hidden template stays hidden through a resubmission and an approval; only unhide clears it.
5. **No automatic hiding on reports.** Reports wait for an admin. With review before listing,
   the risk window is small. An auto-hide threshold would let a few accounts take a good
   template down.
6. **Property definitions on Use.** A built-in property is already every member's. For each
   custom definition the member gets a property: an existing one with the same name and type is
   reused, a missing one is created, and a same-named one of another type is skipped (never a
   second property with a name they already use). The result is reported by name ("New
   properties: Setup"). Formula and rollup definitions do not travel, because their config names
   the author's own property ids.
7. **Every image is dropped**, including images from external sites, as the plan asks.
8. **Firm picks are a copy.** Six built-ins (Daily Game Plan, Trade Plan, Setup Playbook Entry,
   Earnings Play Plan, Trade Post-Mortem, Weekly Review) were copied once on 2026-10-02 under
   gallery titles (Pre-Market Plan, Trade Plan, Setup Checklist, Earnings Prep, Trade Review,
   Weekly Review). They are not pinned to `lib/notebookTemplates.js`, which lane 12B is editing:
   a later edit there does not change them, as a member's gallery copy does not follow its
   author. **I did not edit `notebookTemplates.js`; I only read it.**
9. **Display name.** The author shows by display name. A blank name, or one that looks like an
   email address, shows "A UCT member". An email or a user id never reaches another member.
10. **Rate limits.** Publish: 10 an hour in-process, plus a durable 10 a day
    (`NOTEBOOK_GALLERY_PUBLISH_DAILY_CAP`). Report: 30 an hour, plus a durable 20 a day
    (`NOTEBOOK_GALLERY_REPORT_DAILY_CAP`). A refused publish or a repeat report gives its daily
    charge back. The hourly half is per process (noted in CLAUDE.md's single-process list).
11. **The review queue lives in the gallery.** Admins get a "Review queue" view inside the
    Notebook's community gallery. It is not mounted on `/admin`: `pages/Admin.jsx` is not in
    12A's file list. Mounting `TemplateGalleryReviewPanel` there is one import and one line if
    wanted.
12. **Reporters are never named to admins.** The queue shows each report's reason and note, not
    who sent it. One report per member per template; a repeat answers "already reported".
13. **Lists are capped at 200 rows** with no paging. That is enough for launch; paging is a
    follow-up if the gallery grows.
14. **Featuring needs approval first.** Only an approved template can become a UCT pick.

## The real-browser walk (reading; the raw records were committed first)

Instrument: `tools/notebook_w12a_gallery_walk.py` (local sandbox through
`scripts/hub_sandbox_boot.py`, Playwright Chromium, its own contexts, ports 8580-8584). Three
runs, every raw record under `docs/notebook/evidence/wave12-12a/`:

| Run | Tip | Raw | What it showed |
|---|---|---|---|
| 1 | `e5c86829db` | `walk-e5c86829db/walk.json` | NOT RUN: setup could not sign the second member up (signup is 3/minute per IP and the harness signed the admin up again per member). Sandbox CLEAN at all four checkpoints. Instrument fixed in `0b80ee9945`. |
| 2 | `0b80ee9945` | `walk-0b80ee9945/walk.json` | G1 FAIL: the stored copy kept `http://127.0.0.1:8580/journal/notebook?note=<id>` (a product defect, fixed in `e22ed6873a`, see below). G4 INCONCLUSIVE: the walk read Use template's message after "Make a note from it" had closed its dialog (an instrument defect; its screenshots show the copy and the new note were made). Every other row PASS. Sandbox CLEAN. |
| 3 | `e22ed6873a` | `walk-e22ed6873a/walk.json` | All ten rows PASS. Sandbox CLEAN at all four checkpoints (62 db files hashed). |

Run 3, row by row (from `walk-e22ed6873a/walk.json`):

* **G0** the payload carries `notebook_template_gallery_enabled: true` for the author, the member
  and the admin; the six firm picks are listed; the member's `viewer.admin` is false.
* **G1** publish by mouse (New note, Templates, Share, Category, Submit for review): the message
  "Submitted … for review." renders; the copy is `pending`; leak list empty; the image is gone;
  the task is unchecked; the stored text reads "Ask email address first", "see linked note",
  "pasted in-app link".
* **G2** before review the member's list does not carry it and its full read answers 404.
* **G3** the admin approves from the Review queue; "Approved … It is listed now." renders and the
  member's list carries it.
* **G4** the member searches, filters by Trade plan, previews (the sheet shows the scrubbed
  body), presses Use this template ("Added … to Your templates."), and "Make a note from it"
  opens a new note of that title (`/journal/notebook?note=8818ee2b…`).
* **G5** report with a reason and a note; the thanks sentence renders; the admin queue carries
  the report and does not name the reporter.
* **G6** the admin hides it: the member's list loses it, the author's row reads
  `{status: approved, hidden: true}`; Unhide restores it to the member's list.
* **G7** keyboard: Enter on the focused door puts focus on the "Community gallery" heading; Tab
  walks Browse, Your submissions, the search box, All; Back to templates returns focus to the
  door; focus never sat on `<body>`.
* **G8** 390 px with touch: no sideways scroll (scrollWidth 390 = clientWidth 390) and no
  gallery control under 44 px.
* **G9** no page error across the walk.

Limits of this walk, stated rather than implied: the desktop rows ran at 1280 x 900, not 1200;
the gate-off state was not walked in a browser (the rails cover it: every route is the one 404,
and the door and Share are absent while the flag is not latched on); G4's `picks` list includes
the section's own "UCT PICKS" heading because the walk read every level-4 heading in it.

## A finding for share and publish (not changed here)

Walk run 2 (`docs/notebook/evidence/wave12-12a/walk-0b80ee9945/walk.json`, row G1) published a
template holding `http://127.0.0.1:8580/journal/notebook?note=<id>` as text, and the gallery
copy kept it, with the other note's id. The reducer's in-app test decides by HOST
(`_internal_href`: only `uctintelligence.com`), so the app reached through any other name passes
as external. In production the usual name is `uctintelligence.com`, which is scrubbed. The
Railway service address (`web-production-05cb6.up.railway.app`, named in CLAUDE.md) is not.

Gallery mode now also scrubs any address with an in-app SHAPE (a `/journal/` or `/api/` path, or
a `note=` query) on any host (`_in_app_shape`), railed by
`test_gallery_mode_scrubs_an_in_app_address_on_ANY_host`. **Share links and published pages
still decide by host** (a control test pins that, so the difference is deliberate and visible).
Whether they should take the same rule is the owner's call: it would also scrub an ordinary
external address that happens to have a `/journal/` path.

## Not done here, on purpose

* No new editor node type, so nothing joins the never-revert list (`docs/notebook/wave5-rollback.md`).
* Two backend rails are red on master before this lane and stay red here, for wave-11 work this
  lane does not own: `tests/test_notebook_route_security_census.py` (the voice-notes and
  ai-actions routes have no census rows) and
  `tests/test_notebook_switch_rehearsal.py::test_every_notebook_gate_is_rehearsed_or_carries_a_reason`
  (the four wave-11 gates have no reason). This lane added its own nine census rows and its own
  rehearsal reason; neither failure names a 12A route or gate.
