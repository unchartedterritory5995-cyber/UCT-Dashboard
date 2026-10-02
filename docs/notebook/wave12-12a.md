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
