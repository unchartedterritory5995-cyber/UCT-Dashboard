# "Hide joystick" was a one-way door — the fix

**Status: built, tested, awaiting merge.** Ships as its own commit ahead of Phase 3.

---

## What was wrong

Phase 2.5 Step 1 shipped a **Hide joystick** entry in the Actions sheet. It wrote
`joystick_hub.enabled = false` to the member's stored preference. The Settings toggle that
would turn it back on was scheduled for **Phase 4**.

So between shipping and Phase 4, the documented ways back were:

1. an admin edits that member's row in `user_preferences`, or
2. the member pastes a `fetch()` into a devtools console.

Neither is a path a member has. The owner hit it on the live admin preview, on production, the
day it shipped — as an **admin**, with the most access anyone has.

> ⛔ **A control that can be dismissed and not recovered is a defect regardless of how good the
> toast copy is.** The toast said *"Hidden. Re-enable in Settings soon."* It was honest, it was
> friendly, and it described a Settings screen that did not exist. Copy cannot patch a missing
> capability.

There is a second lesson underneath the first. The gap **was known and was written down** —
`45-phase2.5-plan.md` carried a ⚠️ block titled *"Until Phase 4, a hidden hub is re-enabled two
ways, and BOTH must be documented for support"*. Documenting a workaround made the hole feel
handled. **A recorded workaround is not a recovery path; it is a record of one being missing.**

---

## What shipped instead — three parts, and each needs the other two

### 1. Hiding is session-only by default

`hideForSession()` sets module state and **writes nothing** — no `localStorage`, no preference.
Toast: **"Hidden for now. Reload to bring it back."**

The promise in that sentence is only true because nothing persists, so the test that matters is
the one asserting **no write happens**, not the one asserting the hub disappeared.

### 2. Settings → Joystick — the Phase 4 toggle, pulled forward

`app/src/pages/settings/JoystickSettingsCard.jsx`, mounted in the `charts` section of Settings.
Label: **"Joystick shortcuts (preview)"**.

This is the **only** control that writes a persistent hide. That is the trade: a persistent hide
is allowed to exist *because* a real re-enable path now sits beside it. The rest of the Phase 4
settings UI stays in Phase 4.

⭐ It calls `clearSessionOverride()` **before** writing. Without that, a member who session-hid
and then switched it ON here would see nothing happen — the override would outrank the
preference and the toggle would look broken.

### 3. A glass edge tab — the way back from a *persistent* hide

`HubEdgeTab.jsx`: a 12×36px sliver at the hub's own resting position, inside a 44px tap target,
`aria-label="Show joystick"`. It appears for a session hide and a stored hide alike — a member
who cannot find their way back does not care which kind it was.

12px wide on purpose: it has to be findable without becoming a second floating control competing
with the one the member just dismissed. WCAG 2.5.5 is about the touch area, not the paint.

---

## The decision table

`resolveVisible(storedEnabled, sessionOverride)` is the one authority:

| stored `enabled` | session override | hub | edge tab |
|---|---|---|---|
| `true` | none | ✅ shows | — |
| `false` | none | hidden | ✅ |
| `true` | `hidden` | hidden | ✅ |
| `false` | `hidden` | hidden | ✅ |
| `true` | `shown` | ✅ shows | — |
| `false` | `shown` | ✅ shows | — |

Above all of it: **`HUB_PREVIEW_ENABLED=false` removes the hub AND the tab.** A restore tab
surviving the kill switch would be a live door into a feature that is supposed to be gone, and
it would promise a Settings toggle the member would then find does nothing.

---

## Two defects found while building this, both invisible to structural tests

**1. The toast was rendered with the wrong prop name.** `JournalToast` reads `msg`; it was
passed `message`, and the component renders `''` for anything else. The restore copy — the only
sentence naming where the permanent switch lives — was blank.

**2. Both toasts were owned by the branch their own action destroys.** Every message this
feature shows is set by an action that flips the visible/hidden branch: "Hide joystick" unmounts
`HubShell`, tapping the tab unmounts the hidden branch. A toast owned by either branch is
destroyed in the same commit that fills it, so it renders for **zero frames**.

The toast state now lives in `HubRoot`, above the branch, and both branches render it. The
hidden branch anchors it explicitly, because `.toast` is `position: absolute` — inside
`hub-root` it resolves against the hub's 84px box, but out there the nearest positioned ancestor
is the page, which would pin it to the top of the document.

> ⭐ **Both bugs left every structural assertion green.** The hide worked, the tab worked, the
> hub came back. What was broken was the only part that *talks to the member*. That is why
> `hubHideRestore.test.jsx` has a **copy contract** section that asserts the rendered text, not
> just the state transition: in this fix, the copy *is* the feature.

---

## Files

| File | Role |
|---|---|
| `app/src/hub/hubSessionVisibility.js` | The session override store + `resolveVisible`. Module-level, because `App.jsx:207` calls `useHubActive()` outside `<HubProvider>`. |
| `app/src/hub/HubEdgeTab.jsx` | The restore tab + `restoreToast(persistent)`. |
| `app/src/hub/HubRoot.jsx` | Owns the toast; branches between `HubShell` and the tab. |
| `app/src/hub/useHubActive.js` | Split into `useHubEligible()` (capabilities + kill switch) and `useHubActive()` (eligible **and** visible). |
| `app/src/pages/settings/JoystickSettingsCard.jsx` | The permanent switch. |
| `app/src/hub/hubHideRestore.test.jsx` | 27 tests: the store, the decision table, the tab, Settings, the copy contract. |

## Support answer, in one sentence

> Reload the page, or tap the small sliver on the right edge — and **Settings → Joystick** turns
> it off for good.

The console fallback (for a member on a build older than this fix) is in
`46-preview-production-check.md`, and it is **read-modify-write**: `POST /api/auth/preferences`
takes `{key, value}` and REPLACES the whole value, so a naive write wipes `handedness` and
`coachMarkSeen`.
