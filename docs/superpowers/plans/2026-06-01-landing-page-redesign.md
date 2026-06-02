# Landing Page Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the existing generic-SaaS landing page at `/` with the cartographer-cinematic design from spec `docs/superpowers/specs/2026-06-01-landing-page-redesign-design.md`.

**Architecture:** Drop-in replacement of two files only — `app/src/pages/Landing.jsx` (single React component) and `app/src/pages/Landing.module.css` (CSS Module). All visual effects use pure CSS keyframes + SVG; the animated equity-curve P&L counter runs in a `useEffect` `requestAnimationFrame` loop that mutates SVG attributes directly via refs (no React state churn). No new dependencies, no backend changes, no new routes.

**Tech Stack:** React 18 + Vite + CSS Modules + SVG. Existing routing (`/` → `<PublicOnly><Landing /></PublicOnly>`) is unchanged.

**Reference artifacts:**
- Spec: `docs/superpowers/specs/2026-06-01-landing-page-redesign-design.md`
- Visual reference mockup (full HTML/CSS): `.superpowers/brainstorm/664-1779979175/content/simple-page-v1.html` — implementer can crib styles verbatim and translate to CSS Module class names

---

## Pre-flight

- [ ] **Confirm dev environment is running**

In one terminal, leave Vite running for the duration of the plan:
```bash
cd C:/Users/Patrick/uct-dashboard/app && npm run dev
```
Open `http://localhost:5173/` in a browser **logged out** (use an incognito window if you have a session). The current Landing page should render. Keep this open and refresh between tasks.

- [ ] **Note partner-modified files — do NOT touch**

`git status` will show pending changes in `api/routers/voice.py`, `api/services/voice_openai.py`, `app/src/hooks/useReadAloud.js`, and `tests/test_voice_*.py`. These are partner work-in-progress per `project_partner_collab_branch` memory. Stage and commit ONLY the two landing files at the end.

---

### Task 1: Scaffold new Landing component + CSS Module tokens + sticky nav

**Files:**
- Modify (full rewrite): `app/src/pages/Landing.jsx`
- Modify (full rewrite): `app/src/pages/Landing.module.css`

This task replaces the existing landing page with an empty shell that has correct tokens, the sticky nav, and a placeholder hero section. Subsequent tasks fill in the hero, strip, features, pricing, footer.

- [ ] **Step 1.1: Replace `Landing.jsx` with the scaffold**

```jsx
import { Link } from 'react-router-dom'
import { useEffect, useRef } from 'react'
import styles from './Landing.module.css'

export default function Landing() {
  // Equity-curve animation refs (populated in Task 5)
  const pathRef = useRef(null)
  const drawnRef = useRef(null)
  const fillClipRectRef = useRef(null)
  const markerGroupRef = useRef(null)
  const counterValueRef = useRef(null)
  const counterDeltaRef = useRef(null)
  const counterBgRef = useRef(null)
  const markerRectRef = useRef(null)

  useEffect(() => {
    // Animation loop wired in Task 5
  }, [])

  return (
    <div className={styles.page}>
      {/* Sticky nav */}
      <nav className={styles.nav}>
        <div className={styles.navBrand}>
          <span className={styles.navMark}>⊕</span>
          UCT INTELLIGENCE
        </div>
        <div className={styles.navCta}>
          <Link to="/login" className={styles.navLogin}>Log In</Link>
          <Link to="/signup?plan=pro" className={styles.navSignup}>Begin</Link>
        </div>
      </nav>

      {/* Hero — filled in Task 2 */}
      <section className={styles.hero}>
        <div style={{ padding: 40, color: '#c9a84c' }}>Hero placeholder</div>
      </section>
    </div>
  )
}
```

- [ ] **Step 1.2: Replace `Landing.module.css` with token + nav styles**

```css
/* ============ DESIGN TOKENS ============ */
.page {
  --bg: #06040a;
  --bg2: #0a0604;
  --gold: #c9a84c;
  --gold-dim: #9c8a5a;
  --gold-deep: #9c7d2a;
  --cream: #f5e8c8;
  --green: #4ade80;
  --red: #f87171;
  --ink: #1a1208;
  --text: #d1d5db;
  --text-dim: #9ca3af;
  --text-mute: #6a7a8a;
  --line: rgba(201, 168, 76, 0.15);
  --line2: rgba(201, 168, 76, 0.08);

  margin: 0;
  background: var(--bg);
  color: var(--text);
  font-family: 'Helvetica Neue', Arial, sans-serif;
  -webkit-font-smoothing: antialiased;
  min-height: 100vh;
}

/* ============ NAV ============ */
.nav {
  position: sticky;
  top: 0;
  z-index: 100;
  background: rgba(10, 6, 4, 0.92);
  backdrop-filter: blur(8px);
  border-bottom: 1px solid var(--line);
  padding: 14px 40px;
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.navBrand {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 14px;
  letter-spacing: 3px;
  color: var(--gold);
  font-weight: 600;
}
.navMark {
  width: 24px;
  height: 24px;
  border: 1.5px solid var(--gold);
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
}
.navCta {
  display: flex;
  gap: 12px;
  align-items: center;
}
.navLogin {
  color: var(--gold-dim);
  font-size: 13px;
  text-decoration: none;
}
.navLogin:hover {
  color: var(--gold);
}
.navSignup {
  background: linear-gradient(135deg, var(--gold), var(--gold-deep));
  color: var(--ink);
  padding: 8px 18px;
  border-radius: 4px;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.5px;
  text-decoration: none;
}

/* ============ HERO (skeleton — filled in Task 2) ============ */
.hero {
  position: relative;
  min-height: 640px;
  background: radial-gradient(ellipse at 32% 50%, #1a1208 0%, #0a0604 65%, #06040a 100%);
}
```

- [ ] **Step 1.3: Verify in browser**

Refresh `http://localhost:5173/`. Expected: top nav with `⊕ UCT INTELLIGENCE` on the left, `Log In` + gold `Begin` button on the right. Dark hero stage below with "Hero placeholder" text. No console errors.

- [ ] **Step 1.4: Commit**

```bash
cd C:/Users/Patrick/uct-dashboard
git add app/src/pages/Landing.jsx app/src/pages/Landing.module.css
git commit -m "landing: scaffold cartographer-cinematic redesign

Replaces the prior generic-SaaS landing with the design tokens, sticky nav,
and an empty hero placeholder. Subsequent commits fill in the hero, live
strip, feature grid, pricing, and footer per
docs/superpowers/specs/2026-06-01-landing-page-redesign-design.md.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Hero — static layout (compass, body, corners, cartouche, wax seal)

Build the full hero structure. Static only — no animations yet (those come in Task 3, and the equity curve in Tasks 4–5).

**Files:**
- Modify: `app/src/pages/Landing.jsx` (replace the hero placeholder)
- Modify: `app/src/pages/Landing.module.css` (append hero styles)

- [ ] **Step 2.1: Replace the hero `<section>` in `Landing.jsx`**

Replace the entire `<section className={styles.hero}>...</section>` with:

```jsx
<section className={styles.hero}>
  {/* Cartouche — centered top */}
  <div className={styles.cartouche}>
    Day 1,247 of the voyage · Tue 27 May 2026
  </div>

  {/* Corner annotations */}
  <div className={`${styles.corner} ${styles.cornerTl}`}>
    <span className={styles.flourish}>❦</span> Uncharted Territory
    <small>EST. PREMARKET</small>
  </div>
  <div className={`${styles.corner} ${styles.cornerTr}`}>
    Charting the market <span className={styles.flourish}>❦</span>
    <small>SINCE THE OPENING BELL</small>
  </div>
  <div className={`${styles.corner} ${styles.cornerBl}`}>
    <span className={styles.flourish}>❀</span> From — Pre-Market
    <small>04 : 00 EDT</small>
  </div>
  <div className={`${styles.corner} ${styles.cornerBr}`}>
    To — Closing Bell <span className={styles.flourish}>❀</span>
    <small>16 : 00 EDT</small>
  </div>

  {/* Hero inner content */}
  <div className={styles.heroInner}>
    <div className={styles.compassWrap}>
      <div className={styles.compassShadow} />
      <div className={styles.compassRing} />
      <span className={`${styles.compassCard} ${styles.compassN}`}>N</span>
      <span className={`${styles.compassCard} ${styles.compassE}`}>E</span>
      <span className={`${styles.compassCard} ${styles.compassS}`}>S</span>
      <span className={`${styles.compassCard} ${styles.compassW}`}>W</span>
      <div className={styles.compass}>
        <div className={styles.needle} />
      </div>
    </div>

    <div className={styles.heroBody}>
      <div className={styles.heroGreeting}>
        <span className={styles.greetingDot} />
        Welcome, Trader.
      </div>
      <h1 className={styles.heroH1}>
        UCT Intelligence
        <span className={styles.heroH1Small}>— A product of Uncharted Territory —</span>
      </h1>
      <div className={styles.divider}>
        <span className={styles.dividerLine} />
        <span className={styles.dividerGem}>◆</span>
        <span className={styles.dividerTag}>Navigate the market, effectively.</span>
        <span className={styles.dividerGem}>◆</span>
        <span className={`${styles.dividerLine} ${styles.dividerLineRight}`} />
      </div>
      <div className={styles.pills}>
        <span className={styles.pill}>Morning Wire</span>
        <span className={styles.pill}>UCT 20</span>
        <span className={styles.pill}>AI Compass</span>
        <span className={styles.pill}>Stock Catalysts</span>
        <span className={styles.pill}>Live Breadth</span>
        <span className={styles.pill}>Pattern Engine</span>
        <span className={styles.pill}>Charts Workspace</span>
        <span className={styles.pill}>Voice Assistant</span>
      </div>
      <div className={styles.ctas}>
        <Link to="/signup?plan=pro" className={styles.ctaGold}>
          Step Aboard — $20/mo
        </Link>
        <a href="#intro" className={styles.ctaGhost}>Watch the Intro</a>
        <span className={styles.watch}>2 min</span>
      </div>
    </div>
  </div>

  {/* Wax seal */}
  <div className={styles.sealCurve}>— CHARTING THE MARKET —</div>
  <div className={styles.seal}>UT</div>
</section>
```

- [ ] **Step 2.2: Append hero styles to `Landing.module.css`**

Append (paste after the existing `.hero` rule):

```css
/* Cinematic vignette overlay */
.hero::after {
  content: '';
  position: absolute;
  inset: 0;
  background:
    radial-gradient(ellipse at 32% 50%, transparent 30%, rgba(0, 0, 0, 0.55) 100%),
    radial-gradient(circle at 30% 50%, rgba(201, 168, 76, 0.16) 0%, transparent 45%);
  pointer-events: none;
  z-index: 1;
}
.hero {
  padding: 86px 60px;
  overflow: hidden;
}

/* Cartouche (top-center date badge) */
.cartouche {
  position: absolute;
  top: 18px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 6;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 18px;
  border-top: 1px solid rgba(201, 168, 76, 0.3);
  border-bottom: 1px solid rgba(201, 168, 76, 0.3);
  background: linear-gradient(180deg, rgba(201, 168, 76, 0.06), transparent 50%, rgba(201, 168, 76, 0.06));
  font-family: Georgia, serif;
  font-style: italic;
  font-size: 10px;
  letter-spacing: 2.5px;
  color: var(--gold);
  text-transform: uppercase;
}
.cartouche::before,
.cartouche::after {
  content: '◆';
  color: rgba(201, 168, 76, 0.5);
  font-size: 7px;
}

/* Corner annotations */
.corner {
  position: absolute;
  font-family: Georgia, 'Times New Roman', serif;
  font-style: italic;
  font-size: 11px;
  letter-spacing: 1.5px;
  color: var(--gold-dim);
  text-transform: uppercase;
  z-index: 5;
}
.cornerTl { top: 18px; left: 24px; }
.cornerTr { top: 18px; right: 24px; text-align: right; }
.cornerBl { bottom: 18px; left: 24px; }
.cornerBr { bottom: 18px; right: 24px; text-align: right; }
.corner small {
  display: block;
  font-size: 9px;
  letter-spacing: 2.5px;
  color: #6a5a3a;
  margin-top: 2px;
}
.flourish {
  color: rgba(201, 168, 76, 0.5);
  font-size: 18px;
  margin: 0 4px;
  font-family: Georgia, serif;
  vertical-align: -3px;
}

/* Hero inner layout */
.heroInner {
  display: flex;
  align-items: center;
  gap: 70px;
  max-width: 1100px;
  margin: 0 auto;
  position: relative;
  z-index: 6;
}

/* Compass */
.compassWrap {
  flex: 0 0 220px;
  position: relative;
  width: 220px;
  height: 220px;
}
.compassShadow {
  position: absolute;
  bottom: -28px;
  left: 50%;
  transform: translateX(-50%);
  width: 200px;
  height: 22px;
  background: radial-gradient(ellipse, rgba(201, 168, 76, 0.22), transparent 70%);
  border-radius: 50%;
  z-index: 0;
}
.compassRing {
  position: absolute;
  inset: -20px;
  border-radius: 50%;
  background: repeating-conic-gradient(
    from 0deg,
    rgba(201, 168, 76, 0.5) 0deg 0.6deg,
    transparent 0.6deg 30deg
  );
  -webkit-mask: radial-gradient(circle, transparent 110px, black 111px, black 118px, transparent 119px);
          mask: radial-gradient(circle, transparent 110px, black 111px, black 118px, transparent 119px);
}
.compassCard {
  position: absolute;
  font-family: Georgia, serif;
  font-style: italic;
  font-size: 13px;
  color: var(--gold);
  text-shadow: 0 0 6px rgba(201, 168, 76, 0.6);
}
.compassN { top: -34px; left: 50%; transform: translateX(-50%); }
.compassE { right: -32px; top: 50%; transform: translateY(-50%); }
.compassS { bottom: -34px; left: 50%; transform: translateX(-50%); color: var(--gold-dim); }
.compassW { left: -32px; top: 50%; transform: translateY(-50%); color: var(--gold-dim); }
.compass {
  width: 220px;
  height: 220px;
  border: 2px solid var(--gold);
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 0 80px rgba(201, 168, 76, 0.3), inset 0 0 40px rgba(201, 168, 76, 0.08);
  background: radial-gradient(circle, rgba(201, 168, 76, 0.08), rgba(10, 6, 4, 0.6) 70%);
  position: relative;
  z-index: 1;
}
.compass::before,
.compass::after {
  content: '';
  position: absolute;
  background: rgba(201, 168, 76, 0.3);
}
.compass::before { left: 4%; right: 4%; top: 50%; height: 1px; }
.compass::after  { top: 4%; bottom: 4%; left: 50%; width: 1px; }
.needle {
  width: 5px;
  height: 160px;
  background: linear-gradient(180deg, #ef4444 0%, #ef4444 50%, #4ade80 50%, #4ade80 100%);
  border-radius: 2px;
  box-shadow: 0 0 12px rgba(0, 0, 0, 0.7);
  z-index: 2;
  position: relative;
  transform: rotate(22deg);
  transform-origin: center;
}
.needle::after {
  content: '';
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 14px;
  height: 14px;
  background: var(--gold);
  border-radius: 50%;
  border: 2px solid var(--ink);
}

/* Hero body (right side) */
.heroBody { flex: 1; position: relative; }
.heroGreeting {
  font-family: Georgia, serif;
  font-style: italic;
  font-size: 19px;
  color: var(--gold-dim);
  margin-bottom: 12px;
  letter-spacing: 0.5px;
  display: flex;
  align-items: center;
  gap: 8px;
}
.greetingDot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--green);
  box-shadow: 0 0 8px var(--green);
}
.heroH1 {
  font-size: 60px;
  font-weight: 300;
  line-height: 1.0;
  margin: 0 0 24px;
  background: linear-gradient(90deg, #f5e8c8 0%, #c9a84c 25%, #fff4d6 50%, #c9a84c 75%, #f5e8c8 100%);
  background-size: 200% auto;
  -webkit-background-clip: text;
          background-clip: text;
  color: transparent;
  letter-spacing: -2px;
}
.heroH1Small {
  display: block;
  font-family: Georgia, serif;
  font-style: italic;
  font-size: 18px;
  letter-spacing: 4px;
  font-weight: 400;
  color: var(--gold);
  background: none;
  -webkit-background-clip: unset;
          background-clip: unset;
  margin-top: 4px;
  text-transform: uppercase;
}

.divider {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 6px 0 24px;
  color: var(--gold);
}
.dividerLine {
  flex: 0 0 50px;
  height: 1px;
  background: linear-gradient(90deg, transparent, var(--gold));
}
.dividerLineRight {
  background: linear-gradient(90deg, var(--gold), transparent);
  flex: 1;
}
.dividerGem {
  font-size: 10px;
  color: var(--gold);
}
.dividerTag {
  font-family: Georgia, serif;
  font-style: italic;
  font-size: 17px;
  color: var(--gold);
  white-space: nowrap;
}

.pills {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 30px;
  max-width: 560px;
}
.pill {
  font-size: 9px;
  letter-spacing: 1.8px;
  text-transform: uppercase;
  padding: 5px 11px;
  border-radius: 14px;
  border: 1px solid rgba(201, 168, 76, 0.4);
  color: var(--gold);
  background: rgba(201, 168, 76, 0.04);
  transition: all 0.2s;
}
.pill:hover {
  background: rgba(201, 168, 76, 0.15);
  border-color: var(--gold);
  transform: translateY(-1px);
}

.ctas {
  display: flex;
  gap: 14px;
  align-items: center;
}
.ctaGold {
  background: linear-gradient(135deg, var(--gold), var(--gold-deep));
  color: var(--ink);
  padding: 14px 28px;
  border-radius: 4px;
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.5px;
  box-shadow: 0 4px 24px rgba(201, 168, 76, 0.3);
  position: relative;
  overflow: hidden;
  text-decoration: none;
}
.ctaGold::before {
  content: '';
  position: absolute;
  top: 0;
  left: -100%;
  width: 100%;
  height: 100%;
  background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.4), transparent);
  transition: left 0.6s;
}
.ctaGold:hover::before {
  left: 100%;
}
.ctaGhost {
  border: 1px solid rgba(201, 168, 76, 0.5);
  color: var(--gold);
  padding: 14px 28px;
  border-radius: 4px;
  font-size: 13px;
  text-decoration: none;
}
.watch {
  font-family: Georgia, serif;
  font-style: italic;
  margin-left: 6px;
  font-size: 12px;
  color: #6a5a3a;
}
.watch::before {
  content: '▸ ';
  color: var(--gold);
  font-style: normal;
}

/* Wax seal (bottom-right of hero) */
.seal {
  position: absolute;
  bottom: 32px;
  right: 50px;
  width: 84px;
  height: 84px;
  border: 2.5px solid #8a4520;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(180, 80, 40, 0.45), rgba(120, 40, 20, 0.7));
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--cream);
  font-weight: bold;
  font-size: 22px;
  letter-spacing: 2px;
  font-family: Georgia, serif;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.6),
    inset 0 -3px 8px rgba(80, 20, 10, 0.6),
    inset 0 3px 8px rgba(220, 120, 60, 0.4);
  z-index: 7;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.7);
  transform: rotate(-8deg);
}
.seal::before {
  content: '';
  position: absolute;
  inset: 8px;
  border: 1px solid rgba(245, 232, 200, 0.3);
  border-radius: 50%;
}
.sealCurve {
  position: absolute;
  bottom: 120px;
  right: 12px;
  font-family: Georgia, serif;
  font-style: italic;
  font-size: 9px;
  letter-spacing: 3px;
  color: #8a5a2a;
  text-transform: uppercase;
  z-index: 7;
  transform: rotate(-8deg);
}
```

- [ ] **Step 2.3: Verify in browser**

Refresh `http://localhost:5173/`. Expected: full hero is now visible. Compass on the left with bearing tick ring, needle (static at ~22° angle), N/E/S/W cards. Hero body on the right with "Welcome, Trader." greeting, big "UCT Intelligence" wordmark in gold-shimmer text (static for now, animations come next task), tagline divider with ◆ gems, 8 capability pills, Step Aboard CTA, Watch the Intro ghost button. Wax seal "UT" in the bottom-right. Date cartouche at the top center. Four italic-serif corner annotations.

- [ ] **Step 2.4: Commit**

```bash
git add app/src/pages/Landing.jsx app/src/pages/Landing.module.css
git commit -m "landing: hero static layout — compass, body, corners, seal

Adds the full hero structure: cartographer corner annotations, date
cartouche, compass with bearing ring + N/E/S/W cards + red/green needle,
wordmark with gold gradient text, tagline divider, capability pills, CTAs,
and the UT wax seal in the bottom-right. No animations yet.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Hero animations + constellation

Layer the CSS keyframe animations on top of the static hero: bearing ring slow rotation, needle wobble, wordmark shimmer sweep, greeting pulse, and twinkling constellation stars.

**Files:**
- Modify: `app/src/pages/Landing.jsx` (add the 10 constellation `<div>`s inside the hero)
- Modify: `app/src/pages/Landing.module.css` (add keyframes + animation properties)

- [ ] **Step 3.1: Add the constellation stars in `Landing.jsx`**

Insert immediately after the four corner annotations and before `<div className={styles.heroInner}>`:

```jsx
{/* Constellation */}
<div className={`${styles.star} ${styles.starBright}`} style={{ top: 80, left: '14%', width: 3, height: 3, animationDelay: '0s' }} />
<div className={styles.star} style={{ top: 110, left: '22%', width: 2, height: 2, animationDelay: '1.2s' }} />
<div className={`${styles.star} ${styles.starBright}`} style={{ top: 60, left: '28%', width: 4, height: 4, animationDelay: '2.5s' }} />
<div className={styles.star} style={{ top: 130, left: '36%', width: 2, height: 2, animationDelay: '0.8s' }} />
<div className={styles.star} style={{ top: 75, left: '48%', width: 2, height: 2, animationDelay: '1.6s' }} />
<div className={`${styles.star} ${styles.starBright}`} style={{ top: 95, left: '58%', width: 3, height: 3, animationDelay: '3.2s' }} />
<div className={styles.star} style={{ top: 145, left: '66%', width: 2, height: 2, animationDelay: '0.5s' }} />
<div className={styles.star} style={{ top: 70, left: '76%', width: 2, height: 2, animationDelay: '2.8s' }} />
<div className={`${styles.star} ${styles.starBright}`} style={{ top: 100, left: '86%', width: 3, height: 3, animationDelay: '1.9s' }} />
<div className={styles.star} style={{ top: 50, left: '92%', width: 2, height: 2, animationDelay: '3.5s' }} />
```

- [ ] **Step 3.2: Add keyframes + animation properties in `Landing.module.css`**

Append to the bottom of the file:

```css
/* ============ ANIMATIONS ============ */

/* Star twinkle */
.star {
  position: absolute;
  background: var(--cream);
  border-radius: 50%;
  z-index: 2;
  opacity: 0;
  animation: starTwinkle 4s ease-in-out infinite;
}
.starBright {
  background: var(--gold);
  box-shadow: 0 0 6px rgba(201, 168, 76, 0.8);
}
@keyframes starTwinkle {
  0%, 100% { opacity: 0.15; }
  50%      { opacity: 0.85; }
}

/* Bearing ring slow rotation */
.compassRing {
  animation: ringRotate 90s linear infinite;
}
@keyframes ringRotate {
  from { transform: rotate(0deg); }
  to   { transform: rotate(360deg); }
}

/* Needle wobble */
.needle {
  animation: needleWobble 6s ease-in-out infinite;
}
@keyframes needleWobble {
  0%, 100% { transform: rotate(20deg); }
  25%      { transform: rotate(26deg); }
  50%      { transform: rotate(18deg); }
  75%      { transform: rotate(23deg); }
}

/* Wordmark shimmer sweep */
.heroH1 {
  animation: shimmerSweep 6s ease-in-out infinite;
}
@keyframes shimmerSweep {
  0%, 100% { background-position: 0% center; }
  50%      { background-position: 100% center; }
}

/* Greeting dot pulse */
.greetingDot {
  animation: greetingPulse 2s ease-in-out infinite;
}
@keyframes greetingPulse {
  50% { opacity: 0.35; }
}
```

- [ ] **Step 3.3: Verify in browser**

Refresh. Expected: bearing tick ring around the compass slowly rotates (one full revolution per 90s — barely perceptible, sit with it for a few seconds). Needle subtly wobbles between ~18° and ~26°. Gold shimmer sweeps across "UCT Intelligence" every 6 seconds. The green dot beside "Welcome, Trader." pulses. 10 small stars twinkle in the upper portion of the hero.

- [ ] **Step 3.4: Commit**

```bash
git add app/src/pages/Landing.jsx app/src/pages/Landing.module.css
git commit -m "landing: hero animations + constellation stars

Layers CSS keyframe animations on the static hero: 90s bearing-ring
rotation, 6s needle wobble, 6s wordmark shimmer sweep, 2s greeting-dot
pulse, and 10 twinkling constellation stars in the upper third.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Equity-curve SVG layer (static at final state)

Add the SVG that will host the animated equity curve. In this task, render it in its final state ($36K, fully drawn, marker at top-right) so we can verify the visual before wiring the animation.

**Files:**
- Modify: `app/src/pages/Landing.jsx` (add SVG markup + chart caption inside the hero)
- Modify: `app/src/pages/Landing.module.css` (append equity-curve styles)

- [ ] **Step 4.1: Add the SVG layer in `Landing.jsx`**

Insert immediately after the constellation stars (and before the `heroInner` div):

```jsx
{/* Equity curve background */}
<div className={styles.equity}>
  <svg viewBox="0 0 1200 640" preserveAspectRatio="none">
    <defs>
      <linearGradient id="eqGrad" x1="0%" y1="100%" x2="100%" y2="0%">
        <stop offset="0%" stopColor="#9c7d2a" stopOpacity="0.4" />
        <stop offset="40%" stopColor="#c9a84c" stopOpacity="0.65" />
        <stop offset="100%" stopColor="#4ade80" stopOpacity="0.75" />
      </linearGradient>
      <linearGradient id="eqFillGrad" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stopColor="#c9a84c" stopOpacity="0.16" />
        <stop offset="100%" stopColor="#c9a84c" stopOpacity="0" />
      </linearGradient>
      <radialGradient id="markerGrad" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stopColor="#fff4d6" />
        <stop offset="60%" stopColor="#c9a84c" />
        <stop offset="100%" stopColor="#9c7d2a" />
      </radialGradient>
      <clipPath id="fillClip">
        <rect ref={fillClipRectRef} x="0" y="0" width="1200" height="640" />
      </clipPath>
      <path
        ref={pathRef}
        id="equity-path"
        d="M 90 580 C 150 575, 180 555, 210 540 S 270 510, 310 535 C 350 560, 390 565, 430 525 S 510 460, 560 475 C 610 490, 640 470, 680 430 S 760 370, 810 395 C 860 420, 890 380, 930 320 S 1010 230, 1060 200 C 1095 180, 1115 130, 1130 90"
      />
    </defs>
    <line className={styles.gridLine} x1="60" y1="500" x2="1170" y2="500" />
    <line className={styles.gridLine} x1="60" y1="360" x2="1170" y2="360" />
    <line className={styles.gridLine} x1="60" y1="220" x2="1170" y2="220" />
    <text className={styles.axisLabel} x="1148" y="586" textAnchor="end">$8K</text>
    <text className={styles.axisLabel} x="1148" y="364" textAnchor="end">$18K</text>
    <text className={styles.axisLabel} x="1148" y="224" textAnchor="end">$28K</text>
    <text className={styles.axisLabel} x="1148" y="94" textAnchor="end">$36K</text>
    <use href="#equity-path" className={styles.equityGhost} />
    <g clipPath="url(#fillClip)">
      <path
        className={styles.equityFill}
        d="M 90 580 C 150 575, 180 555, 210 540 S 270 510, 310 535 C 350 560, 390 565, 430 525 S 510 460, 560 475 C 610 490, 640 470, 680 430 S 760 370, 810 395 C 860 420, 890 380, 930 320 S 1010 230, 1060 200 C 1095 180, 1115 130, 1130 90 L 1130 640 L 90 640 Z"
      />
    </g>
    <use href="#equity-path" className={styles.equityCurve} ref={drawnRef} />
    <g ref={markerGroupRef} transform="translate(1130 90)" opacity="1">
      <circle r="5" fill="none" stroke="#c9a84c" strokeWidth="1" opacity="0.5">
        <animate attributeName="r" from="5" to="13" dur="1.8s" repeatCount="indefinite" />
        <animate attributeName="opacity" from="0.6" to="0" dur="1.8s" repeatCount="indefinite" />
      </circle>
      <circle r="9" fill="#4ade80" opacity="0.1" />
      <circle r="6" fill="#c9a84c" opacity="0.28" />
      <rect
        ref={markerRectRef}
        x="-5.5" y="-5.5" width="11" height="11"
        fill="url(#markerGrad)"
        transform="rotate(45)"
        rx="1.5"
      />
      <g transform="translate(12 -44)">
        <rect
          ref={counterBgRef}
          x="0" y="0" width="130" height="46" rx="3"
          fill="rgba(10,6,4,0.78)"
          stroke="rgba(74,222,128,0.3)" strokeWidth="1"
        />
        <text
          x="9" y="14"
          fill="rgba(201,168,76,0.6)"
          fontFamily="'IBM Plex Mono', Consolas, monospace"
          fontSize="7.5" fontWeight="600" letterSpacing="2"
        >ACCOUNT P&amp;L</text>
        <text
          ref={counterValueRef}
          x="9" y="31"
          fill="#4ade80"
          fontFamily="'IBM Plex Mono', Consolas, monospace"
          fontSize="17" fontWeight="700" letterSpacing="-0.3"
          style={{ filter: 'drop-shadow(0 0 3px rgba(74,222,128,0.4))' }}
        >$36,000</text>
        <text
          ref={counterDeltaRef}
          x="9" y="42"
          fill="rgba(74,222,128,0.6)"
          fontFamily="'IBM Plex Mono', Consolas, monospace"
          fontSize="9" letterSpacing="0.2"
        >+$28,000 · 350%</text>
      </g>
    </g>
  </svg>
  <div className={styles.chartLabel}>
    <span className={styles.chartLabelDot} />
    — Account · Year-to-Date —
  </div>
</div>
```

- [ ] **Step 4.2: Append equity-curve styles to `Landing.module.css`**

```css
/* ============ EQUITY CURVE LAYER ============ */
.equity {
  position: absolute;
  inset: 0;
  z-index: 2;
  pointer-events: none;
}
.equity svg {
  width: 100%;
  height: 100%;
  display: block;
}
.gridLine {
  stroke: rgba(201, 168, 76, 0.07);
  stroke-width: 1;
  stroke-dasharray: 2 8;
}
.equityCurve {
  fill: none;
  stroke: url(#eqGrad);
  stroke-width: 1.6;
  stroke-linecap: round;
  filter: drop-shadow(0 0 5px rgba(201, 168, 76, 0.3));
}
.equityGhost {
  fill: none;
  stroke: rgba(201, 168, 76, 0.06);
  stroke-width: 1;
  stroke-dasharray: 3 6;
}
.equityFill {
  fill: url(#eqFillGrad);
  opacity: 0.32;
}
.axisLabel {
  font-family: 'IBM Plex Mono', Consolas, monospace;
  font-size: 10px;
  fill: rgba(201, 168, 76, 0.4);
  letter-spacing: 1px;
  font-weight: 600;
}
.chartLabel {
  position: absolute;
  bottom: 86px;
  left: 78px;
  font-family: Georgia, serif;
  font-style: italic;
  font-size: 11px;
  letter-spacing: 2.5px;
  color: rgba(201, 168, 76, 0.5);
  text-transform: uppercase;
  z-index: 3;
  display: flex;
  align-items: center;
  gap: 8px;
}
.chartLabelDot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--green);
  box-shadow: 0 0 6px var(--green);
  animation: greetingPulse 1.8s ease-in-out infinite;
}
```

- [ ] **Step 4.3: Verify in browser**

Refresh. Expected: the equity curve now shows in the hero background — gold-to-green gradient line climbing from the bottom-left to the top-right, faint dashed "ghost" version of the curve also visible, soft gold filled area below the curve, three dashed horizontal gridlines, monospace `$8K`/`$18K`/`$28K`/`$36K` labels on the right edge. The glowing gold diamond marker with its pulsing ring sits at the top-right of the curve, with the "ACCOUNT P&L · $36,000 · +$28,000 · 350%" counter card floating just above it. Italic-serif "— Account · Year-to-Date —" caption with a green pulse dot in the bottom-left.

- [ ] **Step 4.4: Commit**

```bash
git add app/src/pages/Landing.jsx app/src/pages/Landing.module.css
git commit -m "landing: equity-curve SVG layer (static at peak)

Adds the SVG layer in the hero background — equity curve from \$8K to
\$36K, gridlines, axis labels, ghost path, filled area, drawn curve, gold
diamond marker, and the ACCOUNT P&L counter card. Rendered in its final
state for visual verification; animation loop wired next task.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Equity-curve rAF animation loop

Wire the `useEffect` so the curve draws in over 18 seconds, the marker climbs along the path, the counter ticks $8K → $36K, the filled area expands progressively, and drawdowns flip everything red.

**Files:**
- Modify: `app/src/pages/Landing.jsx` (replace the empty `useEffect`)

- [ ] **Step 5.1: Replace the `useEffect` in `Landing.jsx`**

Replace the empty `useEffect(() => { ... }, [])` with:

```jsx
useEffect(() => {
  const path = pathRef.current
  const drawn = drawnRef.current
  const fillClipRect = fillClipRectRef.current
  const markerGroup = markerGroupRef.current
  const counterVal = counterValueRef.current
  const counterDel = counterDeltaRef.current
  const counterBg = counterBgRef.current
  const markerRect = markerRectRef.current
  if (!path || !drawn || !markerGroup) return

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  if (reduceMotion) {
    // Static final-state render; do not start the rAF loop.
    fillClipRect.setAttribute('width', '1200')
    drawn.style.strokeDasharray = 'none'
    drawn.style.strokeDashoffset = '0'
    markerGroup.setAttribute('transform', 'translate(1130 90)')
    counterVal.textContent = '$36,000'
    counterDel.textContent = '+$28,000 · 350%'
    return
  }

  const START_VAL = 8000
  const END_VAL = 36000
  const RUN_MS = 18000
  const HOLD_MS = 1500
  const RESET_MS = 500
  const TOTAL_MS = RUN_MS + HOLD_MS + RESET_MS

  const pathLen = path.getTotalLength()
  drawn.style.strokeDasharray = `${pathLen} ${pathLen}`
  drawn.style.strokeDashoffset = String(pathLen)

  let startTime = null
  let lastY = null
  let rafId = null

  const fmt = (n) => {
    const rounded = Math.round(n / 10) * 10
    return `$${rounded.toLocaleString('en-US')}`
  }
  const fmtDelta = (delta) => {
    const rounded = Math.round(delta / 10) * 10
    const pct = Math.round((rounded / START_VAL) * 100)
    return `+$${rounded.toLocaleString('en-US')} · ${pct.toLocaleString('en-US')}%`
  }

  const tick = (ts) => {
    if (startTime === null) startTime = ts
    const elapsed = (ts - startTime) % TOTAL_MS

    let progress, opacity
    if (elapsed < RUN_MS) {
      progress = elapsed / RUN_MS
      opacity = 1
    } else if (elapsed < RUN_MS + HOLD_MS) {
      progress = 1
      opacity = 1
    } else {
      progress = 1
      opacity = 0
      drawn.style.strokeDashoffset = String(pathLen)
      fillClipRect.setAttribute('width', '0')
    }

    const drawnLen = pathLen * progress
    drawn.style.strokeDashoffset = String(pathLen - drawnLen)

    const pt = path.getPointAtLength(drawnLen)
    fillClipRect.setAttribute('width', String(Math.max(0, pt.x)))

    const isDrawdown = lastY !== null && pt.y > lastY + 0.4
    lastY = pt.y

    markerGroup.setAttribute('transform', `translate(${pt.x} ${pt.y})`)
    markerGroup.setAttribute('opacity', String(opacity))

    const val = START_VAL + (END_VAL - START_VAL) * progress
    counterVal.textContent = fmt(val)
    counterDel.textContent = fmtDelta(val - START_VAL)

    if (isDrawdown) {
      counterVal.setAttribute('fill', '#f87171')
      counterDel.setAttribute('fill', 'rgba(248,113,113,0.6)')
      counterBg.setAttribute('stroke', 'rgba(248,113,113,0.35)')
      markerRect.setAttribute('fill', '#f87171')
    } else {
      counterVal.setAttribute('fill', '#4ade80')
      counterDel.setAttribute('fill', 'rgba(74,222,128,0.6)')
      counterBg.setAttribute('stroke', 'rgba(74,222,128,0.3)')
      markerRect.setAttribute('fill', 'url(#markerGrad)')
    }

    rafId = requestAnimationFrame(tick)
  }

  const startTimeout = setTimeout(() => {
    rafId = requestAnimationFrame(tick)
  }, 200)

  return () => {
    clearTimeout(startTimeout)
    if (rafId !== null) cancelAnimationFrame(rafId)
  }
}, [])
```

- [ ] **Step 5.2: Initialize the SVG to its starting state**

Edit the JSX from Task 4 — change two attributes so the curve starts hidden, ready to be drawn in by the loop:

- Change the `<rect ref={fillClipRectRef} ... width="1200" ...>` to `width="0"`
- Change the marker group's initial transform from `transform="translate(1130 90)"` to `transform="translate(90 580)"`
- Change the counter's initial text values:
  - `<text ref={counterValueRef} ...>$36,000</text>` → `<text ref={counterValueRef} ...>$8,000</text>`
  - `<text ref={counterDeltaRef} ...>+$28,000 · 350%</text>` → `<text ref={counterDeltaRef} ...>+$0 · 0%</text>`

The reduced-motion branch and the rAF loop both set these to final values; the JSX just needs sensible initial render text so there's no flash of $36K before the loop starts.

- [ ] **Step 5.3: Verify in browser**

Refresh and watch one full cycle (~20 seconds). Expected: the curve starts blank with only the faint ghost and gridlines visible. After ~200ms the marker appears at the bottom-left ($8,000 / +$0 · 0%) and starts climbing. The gold-to-green curve draws in behind it; the filled area below grows in lockstep. The P&L counter ticks up smoothly, rolling to the nearest $10. When the marker passes over a brief drawdown (around the dips in the curve), the marker and counter flash red, then green again. Marker arrives at $36,000 / +$28,000 · 350% after 18 seconds, holds for ~1.5 seconds, then fades and the cycle restarts.

- [ ] **Step 5.4: Commit**

```bash
git add app/src/pages/Landing.jsx
git commit -m "landing: equity-curve animation loop ($8K → $36K, 350%)

Wires the useEffect rAF loop. Curve draws in progressively over 18s as
the gold diamond marker climbs the path; clipPath reveals the filled
area in lockstep; P&L counter card ticks the dollar value and gain
percentage to the nearest \$10. Drawdowns flip marker + counter to red.
Cycle holds 1.5s at the peak then fades and restarts. Reduced-motion
preference short-circuits to the static final state.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Live engine strip

Thin monospace status band directly below the hero.

**Files:**
- Modify: `app/src/pages/Landing.jsx`
- Modify: `app/src/pages/Landing.module.css`

- [ ] **Step 6.1: Add the strip in `Landing.jsx`**

Insert directly after the closing `</section>` of the hero (and before the existing `</div>` that closes `<div className={styles.page}>`):

```jsx
{/* Live engine strip */}
<div className={styles.strip}>
  <span className={styles.stripPulse}>
    <span className={styles.stripDot} />
    ENGINE LIVE
  </span>
  <span className={styles.stripDiv}>|</span>
  <span className={styles.stripStat}>CATALYSTS <span className={styles.stripV}>20</span></span>
  <span className={styles.stripStat}>PATTERNS <span className={styles.stripV}>347</span></span>
  <span className={styles.stripStat}>THEMES <span className={styles.stripV}>99</span></span>
  <span className={styles.stripStat}>UNIVERSE <span className={styles.stripV}>3,685</span></span>
  <span className={styles.stripStat}>EXPOSURE <span className={styles.stripUp}>115</span></span>
  <span className={styles.stripStat}>SPY <span className={styles.stripUp}>+0.42%</span></span>
</div>
```

- [ ] **Step 6.2: Append strip styles**

```css
/* ============ LIVE ENGINE STRIP ============ */
.strip {
  background: #04030a;
  border-bottom: 1px solid var(--line);
  padding: 14px 40px;
  display: flex;
  align-items: center;
  gap: 26px;
  font-family: 'IBM Plex Mono', Consolas, monospace;
  font-size: 11px;
  letter-spacing: 1.5px;
  overflow-x: auto;
  justify-content: center;
  flex-wrap: wrap;
}
.stripPulse {
  display: flex;
  align-items: center;
  gap: 8px;
  color: #6a8a6a;
}
.stripDot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--green);
  box-shadow: 0 0 6px var(--green);
  animation: greetingPulse 2s infinite;
}
.stripStat { color: var(--text-mute); }
.stripV { color: var(--gold); }
.stripUp { color: var(--green); }
.stripDn { color: var(--red); }
.stripDiv { color: rgba(201, 168, 76, 0.2); }
```

- [ ] **Step 6.3: Verify + commit**

Refresh — thin centered band below the hero with the green ENGINE LIVE pulse and stat chips. Then:

```bash
git add app/src/pages/Landing.jsx app/src/pages/Landing.module.css
git commit -m "landing: live engine strip below hero

Thin monospace band: ENGINE LIVE pulse + 6 product-stat chips (CATALYSTS
20, PATTERNS 347, THEMES 99, UNIVERSE 3,685, EXPOSURE 115, SPY +0.42%).
Static text in v1.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Feature grid (8 capability cards)

**Files:**
- Modify: `app/src/pages/Landing.jsx`
- Modify: `app/src/pages/Landing.module.css`

- [ ] **Step 7.1: Add the section to `Landing.jsx`**

Insert after the `</div>` closing the strip:

```jsx
{/* Feature grid */}
<section className={styles.features}>
  <div className={styles.sectionHead}>
    <div className={styles.eyebrow}>Everything aboard</div>
    <h2 className={styles.sectionH2}>One screen. Every signal that matters.</h2>
    <p className={styles.sectionP}>
      Pre-market intelligence, live breadth, an AI coach, pattern detection,
      real-time streaming — the depth of a trading desk without the Bloomberg bill.
    </p>
  </div>
  <div className={styles.grid}>
    <div className={styles.feat}>
      <div className={styles.featIcon}>❧</div>
      <h3 className={styles.featH3}>Morning Wire</h3>
      <p className={styles.featP}>Daily AI brief at 7:35 AM ET. Regime, exposure, top 5 picks with triggers.</p>
    </div>
    <div className={styles.feat}>
      <div className={styles.featIcon}>★</div>
      <h3 className={styles.featH3}>UCT 20</h3>
      <p className={styles.featP}>The 20 highest-conviction leadership stocks with entry/exit signals and live P&amp;L.</p>
    </div>
    <div className={styles.feat}>
      <div className={styles.featIcon}>⊕</div>
      <h3 className={styles.featH3}>AI Compass <span className={styles.featNew}>NEW</span></h3>
      <p className={styles.featP}>Your trading coach — pre-trade verdicts, post-mortems, tilt detection, weekly reviews.</p>
    </div>
    <div className={styles.feat}>
      <div className={styles.featIcon}>◎</div>
      <h3 className={styles.featH3}>Stock Catalysts <span className={styles.featNew}>NEW</span></h3>
      <p className={styles.featP}>20-row pre-market desk, 8 sources synthesized by Opus 4.7 every refresh.</p>
    </div>
    <div className={styles.feat}>
      <div className={styles.featIcon}>≣</div>
      <h3 className={styles.featH3}>Breadth Monitor</h3>
      <p className={styles.featP}>20+ internals, 8-tier heatmap, COT data, 500-day analogue matching.</p>
    </div>
    <div className={styles.feat}>
      <div className={styles.featIcon}>❋</div>
      <h3 className={styles.featH3}>Theme Tracker</h3>
      <p className={styles.featP}>99 themes, 12 sectors, 1,928 stocks, live intraday returns across 6 periods.</p>
    </div>
    <div className={styles.feat}>
      <div className={styles.featIcon}>⊞</div>
      <h3 className={styles.featH3}>Charts Workspace</h3>
      <p className={styles.featP}>TradingView-grade drag-resize layout, 4 color groups, 8 timeframes.</p>
    </div>
    <div className={styles.feat}>
      <div className={styles.featIcon}>♪</div>
      <h3 className={styles.featH3}>Voice Assistant <span className={styles.featNew}>NEW</span></h3>
      <p className={styles.featP}>Ask Compass anything by voice. 88 tools, RAG memory, risk engine.</p>
    </div>
  </div>
</section>
```

- [ ] **Step 7.2: Append feature grid styles**

```css
/* ============ FEATURE GRID ============ */
.features {
  padding: 80px 40px;
  background: #04030a;
  position: relative;
}
.features::before {
  content: '';
  position: absolute;
  inset: 0;
  background-image:
    repeating-linear-gradient(45deg, rgba(201, 168, 76, 0.022) 0 1px, transparent 1px 14px),
    repeating-linear-gradient(-45deg, rgba(201, 168, 76, 0.022) 0 1px, transparent 1px 14px);
  pointer-events: none;
}
.sectionHead {
  max-width: 760px;
  margin: 0 auto 46px;
  text-align: center;
  position: relative;
  z-index: 2;
}
.eyebrow {
  font-size: 11px;
  letter-spacing: 3px;
  color: var(--gold);
  text-transform: uppercase;
  margin-bottom: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
}
.eyebrow::before,
.eyebrow::after {
  content: '';
  width: 26px;
  height: 1px;
  background: var(--gold);
}
.sectionH2 {
  font-size: 34px;
  font-weight: 300;
  line-height: 1.15;
  color: var(--cream);
  margin: 0 0 14px;
  letter-spacing: -0.5px;
}
.sectionP {
  color: var(--text-dim);
  font-size: 14px;
  line-height: 1.6;
}
.grid {
  max-width: 1080px;
  margin: 0 auto;
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 1px;
  background: var(--line);
  border: 1px solid var(--line);
  position: relative;
  z-index: 2;
}
.feat {
  background: var(--bg2);
  padding: 24px 20px;
  transition: background 0.2s;
}
.feat:hover { background: #110a06; }
.featIcon {
  width: 34px;
  height: 34px;
  border: 1px solid rgba(201, 168, 76, 0.4);
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--gold);
  font-size: 15px;
  margin-bottom: 14px;
}
.featH3 {
  color: var(--cream);
  font-size: 14px;
  font-weight: 600;
  margin: 0 0 7px;
  letter-spacing: 0.3px;
}
.featNew {
  display: inline-block;
  font-size: 8px;
  letter-spacing: 1.5px;
  background: var(--gold);
  color: var(--ink);
  padding: 2px 6px;
  border-radius: 3px;
  margin-left: 6px;
  font-weight: 700;
  vertical-align: middle;
}
.featP {
  color: var(--text-mute);
  font-size: 12px;
  line-height: 1.55;
  margin: 0;
}
```

- [ ] **Step 7.3: Verify + commit**

Refresh — feature grid below the strip with section header, 4×2 grid of 8 cards, three with gold "NEW" pills (AI Compass, Stock Catalysts, Voice Assistant). Parchment cross-hatch texture visible behind.

```bash
git add app/src/pages/Landing.jsx app/src/pages/Landing.module.css
git commit -m "landing: feature grid — 8 capability cards

4x2 grid with the eight current product surfaces. NEW pill on AI Compass,
Stock Catalysts, and Voice Assistant. Parchment cross-hatch texture
behind. One-line descriptions, no spotlights.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Pricing section

**Files:**
- Modify: `app/src/pages/Landing.jsx`
- Modify: `app/src/pages/Landing.module.css`

- [ ] **Step 8.1: Add the pricing section to `Landing.jsx`**

Insert after the closing `</section>` of the features:

```jsx
{/* Pricing */}
<section className={styles.price}>
  <div className={styles.sectionHead}>
    <div className={styles.eyebrow}>One price. Everything aboard.</div>
    <h2 className={styles.sectionH2}>$20/month. Cancel anytime.</h2>
  </div>
  <div className={styles.priceCard}>
    <div className={styles.priceBadge}>PRO · ALL ACCESS</div>
    <div className={styles.priceAmt}>$20<span className={styles.pricePer}> /month</span></div>
    <div className={styles.priceTag}>— Less than one bad trade. —</div>
    <ul className={styles.priceUl}>
      <li>Morning Wire — daily AI brief</li>
      <li>UCT 20 portfolio + live signals</li>
      <li>AI Compass — pre-trade, post-trade, weekly</li>
      <li>Stock Catalysts — 20 rows / refresh</li>
      <li>85-detector pattern engine</li>
      <li>99-theme rotation tracker</li>
      <li>Charts Workspace + 8 timeframes</li>
      <li>Voice Assistant + real-time streaming</li>
    </ul>
    <Link to="/signup?plan=pro" className={styles.priceCta}>Begin the Voyage</Link>
    <div className={styles.priceNote}>No contracts. Cancel from your dashboard in 1 click.</div>
  </div>
  <div className={styles.priceFree}>
    <strong>Free forever:</strong> Dashboard, Breadth, Charts, Journal &amp; Options Flow — no card required.
  </div>
</section>
```

- [ ] **Step 8.2: Append pricing styles**

```css
/* ============ PRICING ============ */
.price {
  padding: 84px 40px;
  background: var(--bg2);
  border-top: 1px solid var(--line2);
  position: relative;
}
.priceCard {
  max-width: 440px;
  margin: 46px auto 0;
  background: linear-gradient(180deg, #1a1208, #0a0604);
  border: 1px solid rgba(201, 168, 76, 0.4);
  border-radius: 8px;
  padding: 36px;
  position: relative;
  box-shadow: 0 30px 60px rgba(0, 0, 0, 0.5), 0 0 60px rgba(201, 168, 76, 0.08);
  z-index: 2;
}
.priceBadge {
  display: inline-block;
  background: var(--gold);
  color: var(--ink);
  padding: 4px 10px;
  border-radius: 3px;
  font-size: 10px;
  letter-spacing: 2px;
  font-weight: 700;
  margin-bottom: 22px;
}
.priceAmt {
  font-size: 56px;
  font-weight: 300;
  color: var(--cream);
  line-height: 1;
  margin-bottom: 4px;
  letter-spacing: -2px;
}
.pricePer {
  font-size: 16px;
  color: var(--gold-dim);
  font-weight: 400;
}
.priceTag {
  font-family: Georgia, serif;
  font-style: italic;
  color: var(--gold);
  font-size: 13px;
  margin-bottom: 24px;
}
.priceUl {
  list-style: none;
  padding: 0;
  margin: 0 0 28px;
}
.priceUl li {
  color: var(--text);
  font-size: 13px;
  padding: 6px 0 6px 22px;
  position: relative;
  border-bottom: 1px solid var(--line2);
}
.priceUl li:last-child { border-bottom: none; }
.priceUl li::before {
  content: '✦';
  color: var(--gold);
  position: absolute;
  left: 0;
  font-size: 10px;
  top: 8px;
}
.priceCta {
  display: block;
  text-align: center;
  background: linear-gradient(135deg, var(--gold), var(--gold-deep));
  color: var(--ink);
  padding: 14px;
  border-radius: 4px;
  font-size: 14px;
  font-weight: 700;
  letter-spacing: 0.5px;
  text-decoration: none;
}
.priceNote {
  text-align: center;
  color: var(--text-mute);
  font-size: 11px;
  margin-top: 14px;
}
.priceFree {
  text-align: center;
  color: var(--gold-dim);
  font-size: 12px;
  margin: 24px auto 0;
  max-width: 440px;
  position: relative;
  z-index: 2;
}
.priceFree strong { color: var(--gold); }
```

- [ ] **Step 8.3: Verify + commit**

Refresh — pricing card with PRO · ALL ACCESS badge, big $20, italic-serif tagline, 8 bullet items with ✦ gold pips, gold gradient "Begin the Voyage" CTA, sub-note below. Free-tier callout below the card. Click "Begin the Voyage" — should navigate to `/signup?plan=pro`.

```bash
git add app/src/pages/Landing.jsx app/src/pages/Landing.module.css
git commit -m "landing: pricing card + free tier callout

Single \$20/mo PRO card with the 8 key bundle items, italic-serif
'Less than one bad trade' tagline, and 'Begin the Voyage' CTA routing to
/signup?plan=pro. Free-tier callout (Dashboard, Breadth, Charts, Journal,
Options Flow) below.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: Footer

**Files:**
- Modify: `app/src/pages/Landing.jsx`
- Modify: `app/src/pages/Landing.module.css`

- [ ] **Step 9.1: Add the footer to `Landing.jsx`**

Insert after the pricing section's closing `</section>`:

```jsx
{/* Footer */}
<footer className={styles.foot}>
  <div className={styles.footSeal}>UT</div>
  <div className={styles.footBrand}>
    <span className={styles.footBrandMark}>⊕</span>
    UCT INTELLIGENCE
  </div>
  <div className={styles.footTag}>— A product of Uncharted Territory —</div>
  <div className={styles.footLinks}>
    <Link to="/terms">Terms</Link>
    <Link to="/privacy">Privacy</Link>
    <Link to="/settings">Disclaimers</Link>
    <a href="mailto:contact@uctintelligence.com">Contact</a>
  </div>
  <div className={styles.footAttr}>
    Built on the methodologies of Qullamaggie · Minervini · O'Neil · Kell · Bonde.
    <br />
    Not investment advice. Trade at your own risk.
  </div>
  <div className={styles.footCopy}>&copy; {new Date().getFullYear()} Uncharted Territory</div>
</footer>
```

- [ ] **Step 9.2: Append footer styles**

```css
/* ============ FOOTER ============ */
.foot {
  padding: 54px 40px 30px;
  background: var(--bg);
  border-top: 1px solid var(--line);
  text-align: center;
  position: relative;
}
.footSeal {
  width: 60px;
  height: 60px;
  margin: 0 auto 16px;
  border: 2px solid #8a4520;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(180, 80, 40, 0.35), rgba(120, 40, 20, 0.6));
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--cream);
  font-weight: bold;
  font-size: 17px;
  letter-spacing: 1px;
  font-family: Georgia, serif;
  box-shadow: inset 0 -2px 6px rgba(80, 20, 10, 0.6), inset 0 2px 6px rgba(220, 120, 60, 0.4);
  transform: rotate(-8deg);
}
.footBrand {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  color: var(--gold);
  font-size: 13px;
  letter-spacing: 3px;
  margin-bottom: 12px;
}
.footBrandMark {
  width: 22px;
  height: 22px;
  border: 1px solid var(--gold);
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 9px;
}
.footTag {
  font-family: Georgia, serif;
  font-style: italic;
  color: var(--gold-dim);
  font-size: 13px;
  margin-bottom: 20px;
}
.footLinks {
  display: flex;
  justify-content: center;
  gap: 22px;
  color: var(--text-mute);
  font-size: 11px;
  letter-spacing: 1px;
  margin-bottom: 16px;
}
.footLinks a {
  color: var(--text-mute);
  text-decoration: none;
}
.footLinks a:hover { color: var(--gold); }
.footAttr {
  color: #6a5a3a;
  font-size: 11px;
  line-height: 1.5;
  max-width: 600px;
  margin: 0 auto 10px;
}
.footCopy {
  color: #4a3a2a;
  font-size: 10px;
}
```

- [ ] **Step 9.3: Verify + commit**

Refresh — footer at the bottom with the wax-seal UT medallion, brand mark, italic-serif tagline, four links (Terms, Privacy, Disclaimers, Contact), methodology attribution, and copyright. Click each link — Terms/Privacy should route, Disclaimers should route to `/settings`, Contact should open the system mail client to `contact@uctintelligence.com`.

```bash
git add app/src/pages/Landing.jsx app/src/pages/Landing.module.css
git commit -m "landing: footer with wax seal + methodology attribution

Footer mirrors the hero's wax-seal motif (smaller UT medallion), restates
the brand tagline, links to Terms / Privacy / Disclaimers / Contact, and
credits the Qullamaggie / Minervini / O'Neil / Kell / Bonde methodologies.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: Responsive breakpoints (tablet + mobile)

Add media queries so the layout adapts cleanly at 1024px (tablet) and 640px (mobile).

**Files:**
- Modify: `app/src/pages/Landing.module.css` (append responsive rules)

- [ ] **Step 10.1: Append responsive styles**

```css
/* ============ RESPONSIVE ============ */

/* Tablet: 1024px and below */
@media (max-width: 1024px) {
  .hero { padding: 70px 40px; }
  .heroInner { gap: 40px; }
  .heroH1 { font-size: 48px; }
  .grid { grid-template-columns: repeat(2, 1fr); }
}

/* Mobile: 640px and below */
@media (max-width: 640px) {
  .nav { padding: 12px 20px; }
  .navBrand { font-size: 12px; letter-spacing: 2px; }

  .hero { padding: 60px 20px 80px; min-height: 580px; }
  .heroInner {
    flex-direction: column;
    align-items: center;
    text-align: center;
    gap: 30px;
  }
  .compassWrap {
    flex: 0 0 160px;
    width: 160px;
    height: 160px;
  }
  .compass { width: 160px; height: 160px; }
  .compassRing { inset: -16px; }
  .compassRing {
    -webkit-mask: radial-gradient(circle, transparent 80px, black 81px, black 88px, transparent 89px);
            mask: radial-gradient(circle, transparent 80px, black 81px, black 88px, transparent 89px);
  }
  .needle { height: 116px; }
  .heroH1 { font-size: 40px; letter-spacing: -1.5px; }
  .heroH1Small { font-size: 14px; letter-spacing: 3px; }
  .heroGreeting { font-size: 16px; justify-content: center; }
  .divider { justify-content: center; }
  .dividerLine { flex: 0 0 20px; }
  .dividerTag { font-size: 15px; white-space: normal; text-align: center; }
  .pills { justify-content: center; max-width: 100%; }
  .ctas { flex-wrap: wrap; justify-content: center; }

  /* Hide cartographer ornaments on mobile (too cluttered) */
  .corner, .seal, .sealCurve, .cartouche { display: none; }

  /* Simplify the equity counter card on mobile */
  .chartLabel { left: 20px; bottom: 70px; font-size: 9px; }

  .strip { padding: 12px 20px; gap: 18px; font-size: 10px; }

  .features { padding: 60px 20px; }
  .sectionH2 { font-size: 26px; }
  .grid { grid-template-columns: 1fr; }
  .feat { padding: 20px; }

  .price { padding: 60px 20px; }
  .priceCard { padding: 28px; }
  .priceAmt { font-size: 44px; }

  .foot { padding: 40px 20px 24px; }
  .footLinks { flex-wrap: wrap; gap: 14px 22px; }
}
```

- [ ] **Step 10.2: Verify across widths**

Use browser DevTools device toolbar (Cmd/Ctrl+Shift+M in Chrome). Test:
- **1280×800** (desktop) — should look identical to before
- **768×1024** (tablet) — hero shrinks slightly, feature grid is 2-col
- **375×812** (iPhone) — hero stacks vertically (compass on top, text below center-aligned), corners/cartouche/wax seal hidden, feature grid is 1-col, pricing card pads in tight, footer links wrap to two rows

No horizontal scroll at any width. The equity curve continues to animate at all widths.

- [ ] **Step 10.3: Commit**

```bash
git add app/src/pages/Landing.module.css
git commit -m "landing: responsive breakpoints (tablet 1024px, mobile 640px)

Tablet collapses feature grid to 2-col and shrinks hero gap. Mobile
stacks hero vertically (compass on top, text below center-aligned),
hides cartographer ornaments (corners, cartouche, wax seal) that would
crowd a phone screen, and collapses the feature grid to 1-col.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 11: Reduced motion (CSS side)

The JS side of reduced motion is already wired in Task 5's `useEffect` (it short-circuits to the static final state). This task adds the CSS counterpart that disables all keyframe animations when the user prefers reduced motion.

**Files:**
- Modify: `app/src/pages/Landing.module.css` (append a reduced-motion block)

- [ ] **Step 11.1: Append the reduced-motion media query**

```css
/* ============ REDUCED MOTION ============ */
@media (prefers-reduced-motion: reduce) {
  .star,
  .compassRing,
  .needle,
  .heroH1,
  .greetingDot,
  .stripDot,
  .chartLabelDot {
    animation: none !important;
  }
  .heroH1 {
    background-position: 50% center;
  }
  .needle { transform: rotate(22deg); }
}
```

- [ ] **Step 11.2: Verify reduced-motion fallback**

In Chrome DevTools, open Command Menu (Cmd/Ctrl+Shift+P) → type "Emulate CSS prefers-reduced-motion" → choose "reduce". Refresh the page. Expected: nothing animates — stars are static at mid-opacity, compass needle holds at 22°, bearing ring is stationary, wordmark gradient is static, equity curve renders pre-drawn at $36,000 / 350% with the marker pinned to the top-right.

Toggle reduced-motion back to "No emulation". Refresh. All animations should resume.

- [ ] **Step 11.3: Commit**

```bash
git add app/src/pages/Landing.module.css
git commit -m "landing: respect prefers-reduced-motion

When the user has reduced-motion enabled, disable every CSS keyframe
animation on the page (stars, bearing ring, needle, wordmark shimmer,
greeting/strip/chart pulse dots). JS side already short-circuits the
equity-curve loop to the static final state.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 12: Final build, verify, push to Railway

- [ ] **Step 12.1: Production build**

```bash
cd C:/Users/Patrick/uct-dashboard/app
npm run build
```

Expected: build completes without errors. Per `feedback_vite_manualchunks_object_form` memory, this isn't a `vite.config.js` change but running the build still catches any production-only issues (CSS module class collisions, lazy-import problems, etc.).

If it fails: read the error, fix the file, re-run. Do not push a failing build.

- [ ] **Step 12.2: Final manual checklist**

In a fresh incognito window at `http://localhost:5173/`:

- [ ] Hero animates (compass ring rotates, needle wobbles, wordmark shimmers, stars twinkle, equity curve climbs $8K → $36K with the P&L counter ticking)
- [ ] Nav `Begin` button → `/signup?plan=pro`
- [ ] Hero `Step Aboard — $20/mo` → `/signup?plan=pro`
- [ ] Pricing `Begin the Voyage` → `/signup?plan=pro`
- [ ] Footer `Terms` → `/terms` route renders
- [ ] Footer `Privacy` → `/privacy` route renders
- [ ] Footer `Disclaimers` → `/settings` route renders (settings page; standalone disclaimers page is on the roadmap, see `project_disclaimer_page_planned`)
- [ ] Footer `Contact` → opens default mail client to `contact@uctintelligence.com`
- [ ] No console errors in DevTools
- [ ] Reduced-motion fallback works (emulate it, refresh, confirm nothing animates and the equity curve renders pre-drawn at $36K)
- [ ] Responsive at 375 / 768 / 1280 widths (no horizontal scroll, layout adapts)

- [ ] **Step 12.3: Push to Railway**

```bash
cd C:/Users/Patrick/uct-dashboard
git push origin master
```

Railway auto-deploys from master. Watch the build in the Railway dashboard.

- [ ] **Step 12.4: Smoke-test production**

After Railway reports a successful deploy, open `https://uctintelligence.com/` in an incognito window. Expected: new landing page loads, equity curve animates, all CTAs work. If anything is broken in production but worked locally, the most likely causes are:
- CSS modules name-mangling difference (unlikely — Vite handles this consistently)
- Lazy-load failure (the existing route already lazy-loads Landing — should be fine)
- Missing route — verify `/settings` and `/terms`/`/privacy` still serve

If smoke test passes, the redesign is shipped.

---

## Spec coverage self-review

| Spec section | Covered by |
|---|---|
| Page Structure (nav, hero, strip, features, pricing, footer) | Tasks 1, 2, 6, 7, 8, 9 |
| Hero stage + vignette | Task 2 |
| Constellation | Task 3 |
| Cartographer corner annotations | Task 2 |
| Date cartouche | Task 2 |
| Compass + bearing ring + cardinals + needle | Tasks 2, 3 |
| Hero body (greeting, wordmark, tagline, pills, CTAs) | Tasks 2, 3 |
| Wax seal (hero) | Task 2 |
| Equity curve SVG | Task 4 |
| Equity curve animation loop | Task 5 |
| Live engine strip | Task 6 |
| Feature grid (8 cards) | Task 7 |
| Pricing card + free-tier callout | Task 8 |
| Footer with wax seal + attribution | Task 9 |
| Responsive (tablet + mobile) | Task 10 |
| Reduced motion (CSS + JS) | Tasks 5 (JS branch) + 11 (CSS) |
| Routes wired to CTAs | Tasks 1, 2, 8, 9 + Task 12 verification |
| Acceptance criteria | Task 12 |

No spec requirement is unaddressed. No placeholders. Method signatures and ref names are consistent across tasks (`pathRef`, `drawnRef`, `fillClipRectRef`, `markerGroupRef`, `counterValueRef`, `counterDeltaRef`, `counterBgRef`, `markerRectRef`).

---

## Execution notes

Per the user's session preferences (`feedback_autonomy.md` + `feedback_ship_then_polish.md` + `feedback_review_ceremony.md`), execute inline in this session — no subagent dispatch, no per-task review gauntlet. Run Tasks 1 → 12 sequentially, commit after each task, then build + push at the end. Total estimated time: ~45 minutes if dev server is already running.
