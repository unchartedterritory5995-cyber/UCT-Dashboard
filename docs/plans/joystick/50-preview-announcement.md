# Preview announcement — draft for the owner to post

**Audience: all members** (Step 2). There is no founder channel and no founder tier — one
product, one price. For Step 1 (admins only) nothing is posted; the two admins already know.

**Post it only after Step 2 ships**, i.e. once `hub.enabled` defaults on for every
authenticated user. Announcing during Step 1 would tell ~750 people about a control they
cannot see.

---

## The note (three sentences, plain English)

> **New on mobile: a joystick for getting around.** There's now a small glass control in the
> bottom-right corner on phones — drag it and a fan of shortcuts opens (Screener, Charts,
> Journal, and the rest), or hold it to jump straight back to the dashboard.
>
> It's a preview, so it navigates for now and more lands over the next few weeks.
>
> If you'd rather not have it, tap the button beside it and choose **Hide joystick** — that
> hides it until you reload, and you can turn it off for good in **Settings → Joystick**. If
> you have thoughts, the same menu has **Feedback**, which goes straight to us.

---

## Notes for the owner, not for the post

- **The Settings toggle EXISTS — name it.** ⚰️ This said *"do not promise a Settings toggle;
  it ships in Phase 4"*, and the recovery paths it told support to learn were an admin editing
  the database or the member running a `fetch()` in a devtools console. That gap was a defect,
  not a documentation problem, and it was closed: hiding from the sheet is now session-only,
  **Settings → Joystick** is the permanent switch, and a hidden hub always leaves a small glass
  tab on the right edge to bring it back. Support needs one sentence, not two paths:
  *"Reload, or tap the sliver on the right edge — and Settings → Joystick turns it off for good."*
- **Do not name a date.** Phase 3 is scoped but not scheduled.
- **It is mobile-only** — phones and tablets, not desktop. Expect at least one "I don't see
  it" from someone on a laptop; that is correct behaviour, not a bug.
- If the response is bad, the rollback is `HUB_PREVIEW_ENABLED=false` in Railway, which takes
  effect without a redeploy. You do not have to defend it in the channel while deciding.
