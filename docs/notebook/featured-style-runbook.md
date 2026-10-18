# Featured style: the owner's weekly steps

Once a week the owner picks one approved community style and makes it a UCT pick. **Nothing posts automatically.** Marking a pick changes where the style is listed in the library and sends nothing to Discord, email or any channel. The post in step 4 is typed by the owner, in the channel the owner chooses.

Before you start: you are signed in as yourself (an admin), and these switches are on for `web`: `NOTEBOOK_JOURNAL_STYLES_ENABLED`, `NOTEBOOK_TEMPLATE_GALLERY_ENABLED`, `NOTEBOOK_STYLE_LIBRARY_ENABLED`. With the library switch off, no style is listed at all (`template_gallery.list_gallery`), so there is nothing to feature.

## 1. Open the admin queue

Journal, then Notebook, then **Styles**, then **Community**. The community library opens on Browse. As an admin you also see a **Review queue** tab (`TemplateGallery.jsx`, admins only).

Open **Review queue** and clear what is waiting: **Approve** what is fit to list, **Reject** with a reason for the author. Only an approved style can be a pick; the server refuses the rest ("Approve a template before featuring it.").

## 2. Pick one approved community style

Go back to **Browse** and look under the **Community** heading. Those are the approved member styles that are not picks yet. The **UCT picks** heading above it holds the current picks, including the 15 firm styles that ship in the starter packs. Pick a member's style, not a firm one.

Open **Preview** before you choose. Note its exact title and author.

## 3. Mark it a UCT pick

The featured control is the review action `feature`, the same one behind the **Feature** button on template cards. **A style card has no Feature button today**: under the library switch, style rows render as `StyleLibraryCard`, which carries no admin controls (`TemplateGallery.jsx`, the `card` function). Until that button exists, send the same action from the browser console, signed in as yourself on uctintelligence.com:

```js
// List the approved community styles that are not picks yet: id, title, author.
const r = await fetch('/api/j2/template-gallery?type=style&section=all', { credentials: 'include' })
const { templates } = await r.json()
console.table(templates.filter((t) => t.featured === false && t.firm === false).map((t) => ({ id: t.id, title: t.title, author: t.author })))
```

```js
// Make one a UCT pick. Paste the id from the table above.
const id = 'PASTE-THE-ID'
const res = await fetch(`/api/j2/template-gallery/admin/items/${encodeURIComponent(id)}`, {
  method: 'PATCH', credentials: 'include',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ action: 'feature' }),
})
console.log(res.status, (await res.json()).template?.featured)   // expect: 200 true
```

Close and reopen the library: the style now sits under **UCT picks**.

## 4. Post the two lines

Copy, fill in the title and the author, and post in the channel you choose:

```
This week's UCT pick: {Style title} by {author}.
Find it in the Notebook under Styles, then Community, in UCT picks. Adopt it and it becomes your own copy.
```

No em dash, no en dash, no exclamation mark, no claim about results.

## Taking a pick down

Every lever here is a visibility state. **Never delete a style or any member data to take a pick down.**

- **No longer a pick:** send `{ action: 'unfeature' }` to the same address as step 3. The style stays listed under Community.
- **Should not be listed at all:** send `{ action: 'hide' }`. It leaves the library for everyone and stays in the Review queue under **Hidden**, where **Unhide** brings it back (`{ action: 'unhide' }`). Hiding also closes its open reports.
- Members who already adopted it keep their own copy unchanged. An adopt writes a separate style row for the member (`template_gallery.adopt_style`), and neither action touches it.

## Where each step was checked

| Step | Code |
|---|---|
| Review queue tab, admins only | `app/src/pages/journal-2-0/components/notebook/TemplateGallery.jsx` (`isAdmin ? [['review', 'Review queue']]`) |
| Approve, Reject, Hidden, Unhide | `app/src/components/admin/TemplateGalleryReviewPanel.jsx` |
| UCT picks and Community headings | `TemplateGallery.jsx` (the `picks` section is the featured rows; `community` is every listed row that is not featured) |
| No Feature button on style cards | `TemplateGallery.jsx` `card()` renders `StyleLibraryCard` for style rows; `StyleLibraryCard.jsx` has no admin action |
| The `feature` action and its refusal | `api/services/journal_two/template_gallery.py` `admin_act`; route `PATCH /api/j2/template-gallery/admin/items/{gallery_id}` in `api/routers/notebook_template_gallery.py` (`require_admin`) |
| List fields `id`, `title`, `author`, `featured`, `firm` | `template_gallery.py` `_summary` |
| Feature sends no post | `admin_act` writes `featured` and, for a style, re-tries only update notices still owed to members watching a newer version (`_ring_update_watchers`); it calls no Discord or email path |
