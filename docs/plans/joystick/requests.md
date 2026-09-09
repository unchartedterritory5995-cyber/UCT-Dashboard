# Joystick Hub — requests to outside owners

Filed rather than acted on. Nobody on this build edits the files below.

---

## R-01 — Options Flow: `of-tip` className hook no longer exists (Ravi)

**Status:** open · **Owner:** Options Flow collaborator · **Blocking the hub:** no

`CLAUDE.md` documents a rebase-safe className hook on `OptionsFlow.jsx`:

> `of-tip` (theme-help ⓘ, tap-toggled via a `data-pin` flag so the touch mouseenter→click ordering
> doesn't cancel it)

Measured on `origin/master@42daef020`:

- `className="of-tip"` does **not** appear anywhere in `app/src/pages/OptionsFlow.jsx`.
- `data-pin` appears nowhere in the source tree — only inside a comment in
  `components/research-kit/InfoTip.jsx:17-18`.
- The actual theme-help ⓘ wrapper (`OptionsFlow.jsx:7426-7430`) is hover-only: `onMouseEnter` /
  `onMouseLeave`, no `onClick`, no `className`.
- Consequently the `.of-mroot .of-tip` rule in `OptionsFlow.mobile.css:172-175` is a live no-op, and
  **the tooltip has no tap-toggle on touch** — on a phone there is no way to open it.

**The ask:** either restore the `of-tip` hook and the `data-pin` tap-toggle, or confirm the tooltip is
intentionally hover-only now so the dead CSS rule and the `CLAUDE.md` line can be removed.

**Proceeding on the assumption of approval** for the documentation correction only. No Options Flow
source is touched by this build; Flow mode is navigate-only with the fan `[Voice, Home]`.

---

## R-02 — Voice orb mount condition on touch viewports (no outside owner — informational)

**Status:** resolved, no request needed

The gate decision asked for a request to be filed if the orb cluster is owned by someone other than
Patrick. It is not: `app/src/components/voice/` is in-house. Only Options Flow
(`OptionsFlow.jsx`, `schwab_router.py`, `live_massive_router.py`) is collaborator-owned.

Recorded so the assumption is not silently inherited: the hub changes **where the orb mounts on touch**
(a media query) and nothing about how it works. `FloatingOrb.jsx`'s internals and its desktop rendering
are untouched, and the hub's "Voice" action calls the orb's own handler,
`useRealtimeSession().connect(context)`.
