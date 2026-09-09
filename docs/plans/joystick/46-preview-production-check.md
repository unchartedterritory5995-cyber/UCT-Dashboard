# Phase 2.5 Step 1 — production check (manual, BrowserStack Live)

**Environment: PRODUCTION — `https://uctintelligence.com`.** Live members are using this site
while you run these steps.

⛔ **READ-ONLY, with exactly two exceptions**, both scoped to the admin account you sign in as:
its own `joystick_hub` preference blob (step 8b toggles it in Settings, and you set it back) and
its own coach-mark flag (step 3 dismisses it once, permanently, for that account).
⭐ Step 8a writes NOTHING at all any more — hiding from the sheet is session-only.
**Nothing else may be created, edited or deleted.** No test tickets beyond step 7's draft — do
**not** submit it. No writes to any member's data.

Shipped as: `2d8373449` · deployment `ae03a0c7` · `HUB_PREVIEW_ENABLED=true`.

**Accounts:** an **admin** account (sees the hub) and a **member** account (must not).
**Devices:** iPhone 15 Pro / iOS 17 Safari, and Google Pixel 8 / Android 14 Chrome.

> ⚠️ If a step's expected result does not happen, write FAIL and **keep going** — the later
> steps are independent, and a full picture is worth more than a clean stop.

---

## Block A — iPhone 15 Pro · iOS 17 · Safari

| # | Do this | Expect | P/F |
|---|---|---|---|
| A1 | Open `https://uctintelligence.com`, sign in as the **admin** account. | Dashboard loads, signed in as admin. | ☐ |
| A2 | Look at the bottom-right corner at rest. | A glass circle ~84px, sitting **clear of the home indicator** — at least a finger's width above the very bottom of the screen. Nothing overlaps it. | ☐ |
| A3 | Look for a one-time hint above the pad. Then **drag the pad** once. | Hint reads **"Drag for shortcuts · hold to go home"**, appears **once**, and is **gone after the first drag**. Reload: it does **not** come back. | ☐ |
| A4 | Drag the pad and release on each fan bubble in turn. Return to Dashboard between each. | Seven navigations, each landing on its own page: | |
| A4a | → Screener | `/screener` | ☐ |
| A4b | → Charts | `/charts` | ☐ |
| A4c | → Flow | `/options-flow` | ☐ |
| A4d | → Breadth | `/breadth` | ☐ |
| A4e | → Journal | `/journal/trades` | ☐ |
| A4f | → Notebook | `/journal/notebook` | ☐ |
| A4g | → Wire | `/morning-wire` | ☐ |
| A4h | → **Voice** (inner ring) | The **voice orb session opens** — this is the one action that does something rather than going somewhere. Page does **not** navigate. | ☐ |
| A5 | From **three different** pages (say `/screener`, `/charts`, `/journal/trades`), press and **hold the pad for ~0.5 s** without dragging. | Each time: back to `/dashboard`. | ☐ |
| A6 | Go to `/charts`. Wait for the chart to draw. Drag the pad open. Then close it, **pan the chart ~100px sideways**, and drag the pad open again. | Fan opens **upper-left**; the scrim dims the page but **leaves the volume band at the bottom of the chart visible**; and the pad **still responds after the pan**. | ☐ |
| A7 | Tap the **Actions** button beside the pad → **Feedback**. | Lands on `/support` with a new ticket whose subject is prefilled **`[joystick preview]`**. ⛔ **Do not submit it** — read it and go back. | ☐ |
| A8a | Actions → **Hide joystick**. Read the toast. Then **reload the page**. | Toast reads **"Hidden for now. Reload to bring it back."**; the hub disappears immediately; a **12px glass sliver** appears at the hub's resting position on the right edge; **the reload brings the hub back on its own.** ⛔ This is the load-bearing one — the hide must not survive a reload. | ☐ |
| A8b | Hide it again, then **tap the edge sliver** instead of reloading. | The hub returns immediately. | ☐ |
| A8c | **Settings → Joystick**, switch **"Joystick shortcuts (preview)"** OFF. Reload. | Hub gone, **and still gone after the reload** — this is the persistent hide. The edge sliver is still there, and tapping it brings the hub back for the session with a toast naming **Settings → Joystick**. | ☐ |
| A8d | Switch it back ON in Settings. Reload. | Hub is back and stays back. ⭐ Leave the account in this state. | ☐ |
| A9 | Sign out. Sign in as the **member** account on the same device. | **No hub anywhere.** No coach mark. The old voice orb and feedback button behave as they always did. | ☐ |
| A10 | Ask Patrick to set `HUB_PREVIEW_ENABLED=false` in Railway (web service). Wait ~30 s, sign back in as **admin**, reload. Then set it back to `true` and reload again. | `false` → **no hub for the admin either, and no edge sliver** (the kill switch takes the way back with it — otherwise it would be a live door into a feature that is supposed to be gone). `true` → hub returns. | ☐ |

## Block B — Google Pixel 8 · Android 14 · Chrome

Identical steps. Two differences to watch for:

| # | Do this | Expect | P/F |
|---|---|---|---|
| B1–B10 | Repeat A1–A10 on the Pixel 8. | Same expected results. | ☐ |
| B6′ | On `/charts`, additionally use the **system back-swipe from the right edge** while the hub is at rest. | The **system back gesture wins** — the hub must **not** open a fan or fire an action from an edge swipe. | ☐ |
| B10′ | Note the frame rate feel while dragging with the fan open on `/charts`. | Smooth. ⚠️ A Galaxy S24 renders this page at ~30 fps *with the hub idle*, so on some Android hardware "not 60" is the device, not the hub. | ☐ |

---

## Re-enabling a hidden hub (needed by step 8)

⚰️ **This section used to say "the Settings toggle does not exist yet; it ships in Phase 4",
and the console snippet below it was WRONG.** Both are fixed, and the fix is a product change,
not a doc change: a control that can be dismissed and not recovered is a defect. See
`47-hide-recovery.md`.

**There are now three ways back, in the order support should offer them:**

1. **Reload the page.** "Hide joystick" is SESSION-ONLY — it writes nothing. This is what the
   toast ("Hidden for now. Reload to bring it back.") promises, and it is the whole answer for
   the overwhelmingly common case.
2. **Tap the edge tab.** Even after a *persistent* hide, a 12×36px glass sliver sits at the
   hub's resting position (44px tap target, `aria-label="Show joystick"`). Tapping it restores
   the hub for the session and points at the permanent switch.
3. **Settings → Joystick → "Joystick shortcuts (preview)".** The permanent switch. This is the
   only control that writes a persistent hide, and the only one needed to undo it.

### The console fallback — only if the member is on a build older than the fix

⛔ **The snippet that was here was wrong and would have silently destroyed data.** It posted
`{joystick_hub: {enabled: true}}` and called it "a JSON-patch **merge**". It is neither:
`SetPreferenceRequest` is `{key: str, value: str}`, so that body fails validation outright —
and the shape it was reaching for, `{key: 'joystick_hub', value: '{"enabled":true}'}`, does a
whole-value **REPLACE** (`set_user_preference` writes one TEXT column), which would have wiped
the member's `handedness` and re-shown the coach mark they had already dismissed.

**Recovery must be read-modify-write.** Signed in, in the devtools console:

```js
await (async () => {
  const p = await (await fetch('/api/auth/preferences', { credentials: 'include' })).json()
  const cur = (() => { try { return JSON.parse(p.joystick_hub ?? '{}') } catch { return {} } })()
  cur.enabled = true
  await fetch('/api/auth/preferences', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ key: 'joystick_hub', value: JSON.stringify(cur) }),
  })
  location.reload()
})()
```

Verify (should print a JSON string containing `"enabled":true`):

```js
fetch('/api/auth/preferences', { credentials: 'include' })
  .then(r => r.json()).then(p => console.log(p.joystick_hub))
```

An admin can do the same for a member by editing that user's `joystick_hub` row in
`user_preferences` — again, read the existing JSON and change one field, never replace it.

---

## VoiceOver — iPhone 15 Pro (manual, unrun)

⛔ **Not covered by any automated row.** The suite checks the Actions button's *accessible name*
and that it reaches `/support` — that says the label exists, **not** that a screen-reader user
can operate the hub.

**Enable:** BrowserStack Live left toolbar → device **settings / gear** → **Accessibility** →
**VoiceOver** → On. (If the toolbar has no Accessibility entry, use the device: **Settings →
Accessibility → VoiceOver → On**.)

| # | Step | Expect | P/F |
|---|---|---|---|
| V1 | Swipe right repeatedly from the top of `/dashboard` until focus reaches the hub. **Record the swipe count.** | Reachable without exhausting the page. | ☐ |
| V2 | Listen to the Actions button's announcement. | **"&lt;mode&gt; actions"** (e.g. "Home actions"), announced as a **button**. | ☐ |
| V3 | Double-tap to activate. | Sheet opens and VoiceOver focus moves **into** it. | ☐ |
| V4 | Swipe through the sheet. | **Every action announces its label**; a disabled action announces as **dimmed/unavailable** (a CSS-only dim would be silent — that is the bug `aria-disabled` exists to prevent). | ☐ |
| V5 | Find **Feedback**, double-tap. | Lands on `/support`. | ☐ |
| V6 | Two-finger Z scrub (escape). | Sheet closes; focus returns somewhere sensible, **not** the top of the page. | ☐ |
| V7 | Sweep over the pad itself. | It is **not** presented as a control inviting a double-tap — it is a gesture surface, and the sheet is the accessible door (spec §C2 / WCAG 2.5.1). | ☐ |
| V8 | Turn VoiceOver **off** before ending the session. | — | ☐ |

## TalkBack — Google Pixel 8 (manual, unrun)

**Enable:** device **Settings → Accessibility → TalkBack → On** (the gear in the Live toolbar
opens the Settings app).

| # | Step | Expect | P/F |
|---|---|---|---|
| T1 | Swipe right repeatedly on `/dashboard` until focus reaches the hub. **Record the swipe count.** | Reachable. | ☐ |
| T2 | Listen to the Actions button. | **"&lt;mode&gt; actions", button**. | ☐ |
| T3 | Double-tap. | Sheet opens; focus moves into it. | ☐ |
| T4 | Swipe through. | Every action announces its label; a disabled one announces as **disabled**. | ☐ |
| T5 | **Feedback** → double-tap. | `/support`. | ☐ |
| T6 | Back gesture (swipe down-then-left). | Sheet closes; focus not lost to the top. | ☐ |
| T7 | Sweep over the pad. | Not presented as a double-tappable control. | ☐ |
| T8 | Turn TalkBack **off**. | — | ☐ |

---

## Recording the result

Fill the P/F boxes in place, with the device and OS version and the date. ⚠️ **A step you did
not run is left blank, never a pass** — the whole reason this file exists is that the automated
rows cannot speak for it.
