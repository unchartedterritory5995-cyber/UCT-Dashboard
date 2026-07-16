# Floating Orb — Idle Edge-Tuck (2026-07-16)

## Problem

The floating Compass orb (`FloatingOrb.jsx`) permanently overlaps widget content on
viewport-locked pages. Its only auto-hide signal is `useHideOnScroll`, and `/charts`
(plus other locked views) never scrolls — so the orb sits over the AI Search widget's
follow-up chips and anything else in the bottom corner. Minimize and drag exist but
both still leave a floating element over content.

## Decision (owner-approved)

**Idle edge-tuck**: after ~4s without interaction, the orb glides into the nearest
horizontal screen edge leaving a small gold sliver; hovering / tapping / focusing the
sliver glides it back out. Resting state = visible-then-tuck (not tucked-by-default,
not hidden-entirely) so discoverability is preserved.

## Behavior

- **Tuck trigger:** 4s (`IDLE_TUCK_MS`) with no pointer over the cluster, no keyboard
  focus inside it, while not in a live session, not dragging, and the first-run
  coachmark is not showing.
- **Tuck visual:** cluster translates toward the nearest edge (left/right, from the
  persisted drag position's x vs viewport midpoint; default bottom-right → right),
  leaving a ~14px sliver of the orb at reduced opacity. Satellite buttons (Train Me,
  vision, agent picker) do not render while tucked, so the sliver is always the orb
  itself.
- **Untuck:** pointerenter, focus, or tap on the sliver. A tap that lands while tucked
  ONLY expands — it is consumed before the click handler can start/stop a voice
  session (same consume idiom as drag clicks). After untuck, the 4s timer restarts
  once the pointer leaves.
- **Scroll tuck merges:** `hiddenOnScroll` now produces the same sliver visual instead
  of the old full hide (`.hidden` translateY + `pointer-events: none`), so the orb is
  always recoverable without scrolling up. Hover forces untucked regardless of source.
- **Never tucks** during a live session or drag (existing rule), and the
  modal-open full-hide (`scrollLocked`) is unchanged.
- **Reduced motion:** no slide — tucked state is a stationary low-opacity ghost.
- **Minimized dot** composes: the cluster tuck transform applies to the parent, the
  minimize scale to the child; a minimized tucked orb is just a smaller sliver.

## Implementation

All in `FloatingOrb.jsx` + `FloatingOrb.module.css` (no backend, no new deps):

- `hovered` state (pointerenter/leave + focus/blur on the cluster) and `idleTucked`
  state driven by one timer effect: blocked (hovered / in-session / dragging /
  coachmark) → clear timer + untuck; unblocked → arm 4s timer.
- `tucked = (idleTucked || hiddenOnScroll) && !inSession && !dragging && !hovered`.
- `tuckSide` from `pos.x` vs `window.innerWidth / 2` (right when no saved position).
- CSS `.tuckedRight` / `.tuckedLeft` replace `.hidden` (which is removed):
  `translateX(±(100% − 14px))`, `opacity: .7`, pointer events stay ON.
- Tap-while-tucked consumed via a ref stamped in `handlePointerDown`.

## Testing

- `FloatingOrb.test.jsx` (fake timers): tucks after 4s idle; hover prevents/reverses
  tuck; no tuck while in-session; tap on tucked sliver expands and does NOT connect;
  second tap connects.
- Live verify on `/charts` (Sunrise): orb tucks clear of the AI Search widget,
  hover recovers it.
