# Featured style: the owner's weekly steps

Once a week the owner picks one approved community style and makes it a UCT pick. **Nothing posts automatically.** Marking a pick changes where the style is listed in the library and sends nothing to Discord, email or any channel. The post in step 4 is typed by the owner, in the channel the owner chooses.

Before you start: you are signed in as yourself (an admin), and these switches are on for `web`: `NOTEBOOK_JOURNAL_STYLES_ENABLED`, `NOTEBOOK_TEMPLATE_GALLERY_ENABLED`, `NOTEBOOK_STYLE_LIBRARY_ENABLED`. With the library switch off, no style is listed at all (`template_gallery.list_gallery`), so there is nothing to feature. The 15 firm styles from the starter packs are listed only while `NOTEBOOK_STARTER_PACKS_ENABLED` is on as well (ruling P5-AUD-1); with it off you see member styles only, which is all this weekly step needs.

## 1. Open the admin queue

Journal, then Notebook, then **Styles**, then **Community**. The community library opens on Browse. As an admin you also see a **Review queue** tab (`TemplateGallery.jsx`, admins only).

Open **Review queue** and clear what is waiting: **Approve** what is fit to list, **Reject** with a reason for the author. Only an approved style can be a pick; the server refuses the rest ("Approve a template before featuring it.").

## 2. Pick one approved community style

Go back to **Browse** and look under the **Community** heading. Those are the approved member styles that are not picks yet. The **UCT picks** heading above it holds the current picks, including the 15 firm styles that ship in the starter packs once that switch is on. Pick a member's style, not a firm one.

Open **Preview** before you choose. Note its exact title and author.

## 3. Mark it a UCT pick

On that style's card, press **Feature**. As an admin you see two extra buttons on every card, after Preview, Adopt, Helpful and Report: **Feature** (or **Unfeature** on a card that is already a pick) and **Hide**. Members never see them.

The gallery answers "“{title}” is now a UCT pick." and reloads its lists, so the style moves up under **UCT picks**. If the sentence does not appear, nothing changed: the card shows the server's reason instead (for example "Approve a template before featuring it.").

## 4. Post the two lines

Copy, fill in the title and the author, and post in the channel you choose:

```
This week's UCT pick: {Style title} by {author}.
Find it in the Notebook under Styles, then Community, in UCT picks. Adopt it and it becomes your own copy.
```

No em dash, no en dash, no exclamation mark, no claim about results.

## Taking a pick down

Every lever here is a visibility state. **Never delete a style or any member data to take a pick down.**

- **No longer a pick:** press **Unfeature** on its card under **UCT picks**. The gallery answers "“{title}” is no longer a UCT pick." and the style stays listed under **Community**.
- **Should not be listed at all:** press **Hide** on its card. The gallery answers "Hid “{title}”. It is still in the Review queue." It leaves the library for everyone and waits in **Review queue** under **Hidden**, where **Unhide** brings it back. Hiding also closes its open reports.
- Members who already adopted it keep their own copy unchanged. An adopt writes a separate style row for the member (`template_gallery.adopt_style`), and neither button touches it.

## Where each step was checked

| Step | Code |
|---|---|
| Review queue tab, admins only | `app/src/pages/journal-2-0/components/notebook/TemplateGallery.jsx` (`isAdmin ? [['review', 'Review queue']]`) |
| Approve, Reject, Hidden, Unhide | `app/src/components/admin/TemplateGalleryReviewPanel.jsx` |
| UCT picks and Community headings | `TemplateGallery.jsx` (the `picks` section is the featured rows; `community` is every listed row that is not featured) |
| Feature / Unfeature and Hide on style cards, admins only | `app/src/pages/journal-2-0/components/notebook/GalleryAdminActions.jsx`, rendered by `StyleLibraryCard.jsx` (and by outline cards in `TemplateGallery.jsx`) when the viewer is an admin; rails in `StyleLibrary.test.jsx` |
| The sentences after each press | `GalleryAdminActions.jsx` |
| The `feature` action and its refusal | `api/services/journal_two/template_gallery.py` `admin_act`; route `PATCH /api/j2/template-gallery/admin/items/{gallery_id}` in `api/routers/notebook_template_gallery.py` (`require_admin`) |
| Feature sends no post | `admin_act` writes `featured` and, for a style, re-tries only update notices still owed to members watching a newer version (`_ring_update_watchers`); it calls no Discord or email path |
