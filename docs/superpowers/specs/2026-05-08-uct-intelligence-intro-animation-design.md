# UCT Intelligence — Intro Animation

**Date:** 2026-05-08
**Status:** Approved (brainstorm phase)
**Brainstorm artifacts:** `.superpowers/brainstorm/3680-1778293420/content/07-mark-welcome-v5.html`

## Goal

Build a ~8-second cinematic intro animation that plays the first time a user lands on the public page or signs into the dashboard. The intro reveals the **Uncharted Territory** brand and welcomes the user *to* **UCT Intelligence** (the dashboard product within that brand). It functions as a brand sizzle, a personalized greeting, and a hint at the breadth of the suite — all before the dashboard renders.

## Brand language locked in

- **Parent brand:** Uncharted Territory
- **Product:** UCT Intelligence (the dashboard)
- **Tagline:** *Navigate the market, effectively.*
- **Color palette:** gold `#c9a84c` (primary brand) / `#f5d97a` (highlight) / `#0e0f0d` (dark base) / `#050505` (deep black) / red+green of compass mark
- **Typography:** Instrument Sans for product/UI text. Italic serif (Georgia / Times New Roman) **only for cartographer/map decoration** — explicit exception to the font-unification rule because these elements are graphic decoration, not UI text.
- **Mark:** the red/green compass (`uct-mark.jpg`) is the primary intro logo. The full Gold Logo (`Gold logo.png`) and the parchment version (`logo 2.png`) appear as supporting brand artifacts.

## Narrative — three acts in 7.4 seconds

### Act 1 — Cartographer (0.0 → 3.8s)

The opening act. Sets the "Uncharted Territory" world.

| Time | Element | Behavior |
|------|---------|----------|
| 0.0–0.4s | Vignette | Radial darkening breathes in |
| 0.4–1.0s | Coordinate hatches | Four corners fade in (`N 40°42'46"`, `W 74°00'21"`, `UNCHARTED`, `TERRITORY`) |
| 0.7–2.5s | Drifting candle ghosts | 6 faint candles drift upward — atmosphere only |
| 1.4–2.0s | Parchment world | Aged-paper background fades in (warm cross-hatch grid + foxing stains + diagonal crease line) |
| 1.5–3.3s | Parchment compass mark | Inks itself in via mask-position sweep (1.8s diagonal draw) |
| 1.5–3.3s | Compass-rose backdrop | 8 radiating gold lines + 2 concentric circles draw from center via stroke-dashoffset |
| 1.7–3.1s | Bearing tick ring | Rotates -180°→-90° into place around the compass; "needle finds north" wobble settles 3.05–3.65s. N · E · S · W in serif gold + degree readouts (045°, 135°, 225°, 315°) |
| 1.9–4.1s | Journey path | Dotted gold curve strokes corner-to-corner; glowing **ship marker** rides along via SMIL `animateMotion` |
| 2.0–3.8s | Italic-serif map labels (4) | Stagger-fade in: top center `UCT INTELLIGENCE` · top-left `From — Premarket` · bottom-right `To — Closing Bell` · bottom center `Navigate the market, effectively.` |
| 2.6–3.4s | Wax seal medallion | Stamps in (bottom-right) with bouncy scale; gold scalloped seal with serif **UT** monogram + arched `CHARTING THE MARKET` text |
| 3.3–3.8s | Hold | Atmosphere settles. Compass pulses softly with gold glow |

### Act 1.5 — Ignition (3.8 → 4.0s)

A 600ms gold-light flash explodes from the compass center. Parchment, rose backdrop, bearing ring, journey path, map labels, and wax seal all burn away (opacity 0, slight scale-up, brightness boost). The cartographer world transitions into the brand world.

### Act 2 — Welcome (4.0 → 5.4s)

The personalized greeting moment.

| Time | Element | Behavior |
|------|---------|----------|
| 4.0–4.5s | Welcome veil | Radial dark veil rises with subtle blur backdrop |
| 4.2–4.9s | Mini compass icon | Small (28px) red/green compass fades in above the welcome line |
| 4.3–5.2s | "Welcome, {firstName}." | Bold white 48px line with gold-shimmered name. Subtle scale-up entrance |
| 4.3s | Hairline rule | Gold-fading-to-transparent rule beneath welcome line |
| 4.3s | Tagline | *Navigate the market, **effectively.*** italic serif gold-toned beneath the rule |
| 5.4–5.9s | Welcome fades out | Veil + welcome + mini compass all fade |

### Act 3 — Brand Finale (5.7 → 8.1s)

Arrival at the destination. The brand asserts.

| Time | Element | Behavior |
|------|---------|----------|
| 5.7–6.2s | Reveal scene | Dark gradient with central radial gold halo fades in |
| 5.9–6.9s | Compass mark | The red/green compass pops in with rotate(-30deg→0) + scale(0.7→1.05→1) bounce |
| 5.9–6.9s | UCT INTELLIGENCE wordmark | Big gold-gradient-shimmered Instrument Sans 800/40px/7px tracking |
| 6.5–7.1s | "— Uncharted Territory —" label | Italic serif gold subtitle with em-dash flourishes, *above* the pills |
| 6.9–8.1s | 8 capability pills | 4×2 grid, equal-width tabs with centered text, cascade 100ms apart (last pill lands ~8.1s) |
| 8.1s | Hold | Final frame holds ~600ms for emotional landing before fade-out / handoff |

**Pills (4×2 grid, in order):**

| Row 1 | Row 2 |
|-------|-------|
| Morning Wire | Theme Tracker |
| UCT 20 | Trade Journal |
| AI Intelligence | Setup Library |
| Live Breadth | Real-Time Stream |

## Personalization

```jsx
const { user } = useAuth();
const greetingName = user?.name?.split(' ')[0] || 'traveler';
// "Welcome, {greetingName}."
```

- **Logged in:** first name from `useAuth().user.name` → *"Welcome, Sarah."*
- **Logged out** (Landing page visitor): fallback → *"Welcome, traveler."*
- **No name set:** *"Welcome, traveler."*

## Where it plays

The intro plays **once per session** based on `localStorage`:

- **Landing page (`/`):** plays for unauthenticated visitors arriving fresh
- **Dashboard (`/dashboard`):** plays for authenticated users on first dashboard visit per session
- **Both contexts share the same component**, with the welcome name pulled from auth state

Storage key: `uct_intro_seen_v1`. Set on completion. Cleared on logout (so next login replays).

## Skip behavior

| Action | Result |
|--------|--------|
| **ESC** key | Skip immediately, mark seen |
| **Click anywhere** | Skip immediately, mark seen |
| **Animation completes** | Mark seen, fade out, hand off |
| **`prefers-reduced-motion`** detected | Skip the cinematic; show a 600ms fade-in of the brand finale only (no parchment/welcome/compass animations) |

## Technical approach

### Implementation choice

- **Pure CSS keyframes + SVG animations** for all motion. No new animation library bundle.
- **SMIL `animateMotion`** for the ship marker traveling along the journey path (already a hard requirement; no JS substitution needed).
- **No GSAP, no Framer Motion, no Lottie, no Three.js.** Bundle stays at zero added cost.
- The brainstorm preview's data-URI inlining is **brainstorm-only**. Production loads assets normally.

### Component structure

```
app/src/components/intro/
├── IntroAnimation.jsx        # main component, controls play/skip/reduced-motion
├── IntroAnimation.module.css # all keyframes + scene styling
└── assets/
    ├── compass-mark.png      # red/green transparent (Pillow-processed)
    ├── parchment-mark.png    # logo-2.png (parchment compass)
    └── (Gold logo NOT used in intro — replaced by text wordmark)
```

`IntroAnimation` is mounted at root level in `App.jsx` above the routed content, behind a `<Suspense>` boundary. It renders nothing if `shouldPlay()` returns false (intro already seen this session, or `prefers-reduced-motion` is set).

### Asset preparation

Three assets need to land in `app/src/components/intro/assets/`:

1. **`compass-mark.png`** — generated via Python/Pillow from `UCT FINAL LOGO.jpg`. White background → transparent (threshold > 235 RGB → alpha 0). Same script used in brainstorm:
   ```python
   from PIL import Image
   img = Image.open('UCT FINAL LOGO.jpg').convert('RGBA')
   data = list(img.getdata())
   new_data = [(255,255,255,0) if (r > 235 and g > 235 and b > 235) else (r,g,b,a)
               for r,g,b,a in data]
   img.putdata(new_data)
   img.save('compass-mark.png', 'PNG')
   ```

2. **`parchment-mark.png`** — copy `logo 2.png` directly. No processing needed.

3. **(no clean Gold Logo required)** — the brand finale renders "UCT INTELLIGENCE" as Instrument Sans text, so the Gold Logo PNG with social handles is not used.

### State machine

```
idle → playing → completing → done
            ↓
         skipped (via ESC/click) → done
```

`done` writes `uct_intro_seen_v1` to localStorage and unmounts the overlay.

### Mobile considerations

- The intro plays at viewport-fit (full screen, 16:9 aspect logic adapts to portrait by maintaining vertical centering).
- Compass mark scales down to 96px on screens < 640px wide.
- Wordmark scales to `font-size: 28px` (from 40px) on mobile.
- Pill grid collapses to 2×4 on screens < 540px wide.
- Wax seal medallion hides on screens < 480px wide (would crowd the compass).

### Performance constraints

- Total CSS for the intro: ~6KB minified.
- Image assets: compass-mark.png (~30KB transparent) + parchment-mark.png (~134KB) = ~164KB total.
- Lazy-loaded behind `<Suspense>` so the dashboard can render in parallel.
- Animations use `transform` and `opacity` only — no layout thrashing, full GPU compositing.
- `will-change` applied judiciously to elements that animate.

### Reduced-motion fallback

When `(prefers-reduced-motion: reduce)` is detected:

- Skip Acts 1 and 2 entirely.
- Render only the brand finale frame statically.
- Fade in over 600ms, hold 1s, fade out.
- Total duration: 1.6s instead of 7.4s.

## Open product decisions (to confirm before implementation)

1. **Replay path:** when a user logs out and back in same session, do they see the intro again? Default: **yes** (cleared on logout). Alternative: never replay within 24h.

2. **Mobile play-or-skip:** play full animation on mobile, or auto-skip to reduced-motion fallback for performance? Default: **play full animation; skip only on `prefers-reduced-motion`**.

3. **Skip-on-click area:** does clicking *anywhere* in the viewport skip, or only a dedicated "Skip" button in the corner? Default: **anywhere**, with no visible button (cleaner aesthetic).

4. **Intro on every cold start vs. once per session:** localStorage handles "once per session." Confirm this is desired behavior vs. e.g. once per week, once per major release, or always.

## Out of scope (for v1)

- Music/sound — no audio. Silent intro only.
- Variable greetings beyond first name (no "Good morning, {name}" with time-of-day awareness — possible v2).
- Personalized capability pills (e.g. showing only the user's most-used features). Static for v1.
- Theme variations (light mode etc.) — dark only.
- Customizable intro content for admin users / different subscription tiers.
- "Hide intro forever" preference in settings — possible v2.

## Files that will change

- **New:** `app/src/components/intro/IntroAnimation.jsx`
- **New:** `app/src/components/intro/IntroAnimation.module.css`
- **New:** `app/src/components/intro/assets/compass-mark.png`
- **New:** `app/src/components/intro/assets/parchment-mark.png`
- **New:** `app/src/utils/introStorage.js` (or hook `useIntroState`)
- **Edit:** `app/src/App.jsx` — mount `<IntroAnimation />` at root inside `<AuthProvider>`
- **Edit:** `app/src/context/AuthContext.jsx` — clear intro localStorage on logout

No backend changes required. Pure frontend feature.

## Memory references

- `feedback_brand_tagline.md` — tagline locked at "Navigate the market, effectively"
- `feedback_autonomy.md` — autonomous mode (no permission prompts during implementation)
- `feedback_always_push.md` — commit + Railway push after merging
