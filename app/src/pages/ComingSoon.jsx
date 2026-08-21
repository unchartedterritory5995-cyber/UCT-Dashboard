import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import UTMark from '../components/brand/UTMark'
import { track } from '../utils/landingTrack'
import styles from './ComingSoon.module.css'

// The firm's public Substack. What is actually PUBLISHED there is the weekly
// Sunday Scans (the Morning Wire stages as a draft), so the copy says Sunday
// Scans — linking "today's Morning Wire" would send people somewhere it isn't.
const SUBSTACK_URL = 'https://unchartedterritoryy.substack.com'

// Launch target: Sat Sep 19 2026, 9am ET (owner's date — pushed back 2 weeks
// from the original Sep 5 target). Deliberately NOT labelled "opening bell"
// anywhere — Sep 19 is a Saturday, so there is no session that morning;
// members onboard over the weekend and the first live Morning Wire lands
// Mon Sep 21.
// Override without a code change via VITE_LAUNCH_DATE (ISO-8601 with offset).
const FALLBACK_LAUNCH = '2026-09-19T09:00:00-04:00'
const LAUNCH_ISO = import.meta.env.VITE_LAUNCH_DATE || FALLBACK_LAUNCH

function launchDate() {
  const d = new Date(LAUNCH_ISO)
  return Number.isNaN(d.getTime()) ? new Date(FALLBACK_LAUNCH) : d
}

// Short "SEP 5" label for the terminus annotation on the curve.
function terminusLabel(d) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', month: 'short', day: 'numeric',
  }).format(d).toUpperCase()
}

function remaining(target, now) {
  const ms = target.getTime() - now
  if (ms <= 0) return null
  return {
    days:  Math.floor(ms / 86400000),
    hours: Math.floor(ms / 3600000) % 24,
    mins:  Math.floor(ms / 60000) % 60,
  }
}

/** What the countdown slot says once the launch moment has passed.
 *
 *  Without this the countdown simply vanishes and the page sits there saying
 *  COMING SOON beside a date that has already gone — for however long it takes
 *  a human to flip the env vars. The flags are deliberately NOT auto-cleared:
 *  that would open signups and Stripe billing unattended, which is a decision
 *  a person should make.
 */
function passedLabel(target, now) {
  const dayOf = (d) => new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d)
  return dayOf(new Date(now)) === dayOf(target)
    ? 'Doors open today.'
    : 'Opening imminently.'
}

const prefersReducedMotion = () =>
  typeof window !== 'undefined'
  && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

/* ── The curve ──────────────────────────────────────────────────────────────
   One equity curve, two states. Solid gold for what's built; dotted for the
   six weeks ahead. The markers sit on the seam and at the terminus.

   The SVG stretches with `preserveAspectRatio="none"` so nothing is ever
   cropped at any window shape. That makes every viewBox coordinate map to a
   fixed PERCENTAGE of the box, which is why the two labels are HTML
   positioned from the same numbers (VB below) instead of SVG <text>: they
   land exactly on the curve without inheriting the non-uniform stretch that
   would skew type. Change a coordinate here and the label follows. */

const VB = { w: 1600, h: 800 }

// Terminus: the launch itself, at the end of the path.
const END = { x: 1450, y: 176 }

// How far along the path the "you are here" seam may travel. NOT 0→1: the
// product is largely built, so the solid portion always dominates, and the
// seam has to stay clear of the copy block on the left and of the terminus
// label on the right. Verified at both ends in a browser.
const SEAM_MIN = 0.56
const SEAM_MAX = 0.74

// Where the seam sits if the browser can't measure the path (jsdom, ancient
// engines). Roughly the SEAM_MIN point — the marker shows in a sane place
// rather than disappearing.
const SEAM_FALLBACK = { x: 1010, y: 470 }

// The countdown window the seam maps onto — how long the page has been up.
// Anchored, not open-ended, so the seam advances at a steady, honest rate.
const JOURNEY_START = new Date('2026-07-25T00:00:00-04:00')

/** Fraction of the path that is "already travelled", from real elapsed time.
 *  This is what makes the marker mean something: it is the actual position
 *  between the day the page went up and the day the doors open. */
function seamFraction(target, now) {
  const span = target.getTime() - JOURNEY_START.getTime()
  if (span <= 0) return SEAM_MAX
  const elapsed = now - JOURNEY_START.getTime()
  const t = Math.min(1, Math.max(0, elapsed / span))
  return SEAM_MIN + (SEAM_MAX - SEAM_MIN) * t
}

// ONE continuous path from the start of the journey to the launch. Rendering
// it once (dotted) with a second solid copy on top — dash-clipped to the seam
// fraction — is what lets the shipped/ahead split move with real time instead
// of being frozen at a hardcoded point.
//
// Deliberately shallow on the left: the copy block occupies roughly the first
// 46% of the frame, so the curve stays under it and does the climbing out in
// the open space on the right.
const FULL_D =
  'M -30 776 C 96 772, 196 764, 292 758 S 424 748, 500 762 ' +
  'C 570 774, 646 744, 726 710 C 806 676, 856 616, 916 556 ' +
  'S 1016 462, 1068 430 C 1106 408, 1122 368, 1140 330 ' +
  `C 1214 276, 1268 268, 1338 224 S 1418 190, ${END.x} ${END.y}`

const FILL_D = `${FULL_D} L ${END.x} ${VB.h} L -30 ${VB.h} Z`

const pct = (v, total) => `${(v / total) * 100}%`

function Curve({ still, seam, pathRef }) {
  return (
    <svg
      className={`${styles.curve} ${still ? styles.curveStill : ''}`}
      viewBox={`0 0 ${VB.w} ${VB.h}`}
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id="cs-fill" x1="0" y1="1" x2="0" y2="0">
          <stop offset="0%"   stopColor="#c9a84c" stopOpacity="0" />
          <stop offset="100%" stopColor="#c9a84c" stopOpacity="0.11" />
        </linearGradient>
        {/* The fill's closing edge would otherwise draw a hard vertical wall
            down to the floor at the end of the path, so it fades out well
            before then — and before SEAM_MIN, so it never competes with the
            travelling marker either. */}
        <linearGradient id="cs-fade" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%"  stopColor="#fff" stopOpacity="0" />
          <stop offset="14%" stopColor="#fff" stopOpacity="1" />
          <stop offset="44%" stopColor="#fff" stopOpacity="1" />
          <stop offset="66%" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        <mask id="cs-fill-mask">
          <rect x="0" y="0" width={VB.w} height={VB.h} fill="url(#cs-fade)" />
        </mask>
      </defs>

      <path
        className={styles.fill}
        d={FILL_D}
        fill="url(#cs-fill)"
        mask="url(#cs-fill-mask)"
      />

      {/* The whole journey, dotted. The solid layer below covers the part
          already travelled, so this only ever reads as "what's ahead". */}
      <path
        className={styles.ahead}
        d={FULL_D}
        pathLength="1"
        fill="none"
        stroke="#c9a84c"
        strokeWidth="1.5"
        strokeLinecap="round"
        // Tuned against the FULL path length, not the ahead segment: these are
        // fractions of the whole journey (pathLength=1), so the old values —
        // sized for the short ahead-only path — rendered as long dashes here.
        strokeDasharray="0.003 0.004"
      />

      {/* Travelled. `dasharray: seam, (1 - seam)` with pathLength=1 draws one
          solid run from the start to exactly the seam, then nothing — so the
          split follows real elapsed time. The draw-in animation is a separate
          dashoffset on top (see .past), which is why this is inline. */}
      <path
        ref={pathRef}
        className={styles.past}
        d={FULL_D}
        pathLength="1"
        fill="none"
        stroke="#c9a84c"
        strokeWidth="2"
        strokeLinecap="round"
        style={{
          strokeDasharray: `${seam} ${1 - seam}`,
          // Offset by the seam hides the run entirely; the `draw` keyframe
          // brings it to 0, so the line strokes on from the left to exactly
          // today's position. Inline because both numbers are time-derived —
          // and inline beats the class rule, so reduced motion must be
          // resolved here too rather than by a `.still` override.
          strokeDashoffset: still ? 0 : seam,
        }}
      />
    </svg>
  )
}

/* The two annotations on the curve. Plain HTML so the type stays true while
   the curve beneath it stretches. Coordinates come from the same constants
   the path is drawn from. */
function CurveMarks({ still, terminus, herePoint }) {
  return (
    <div className={`${styles.marks} ${still ? styles.marksStill : ''}`} aria-hidden="true">
      <div
        className={styles.here}
        style={{ left: pct(herePoint.x, VB.w), top: pct(herePoint.y, VB.h) }}
      >
        <span className={styles.dot} />
        <span className={styles.halo} />
        <span className={styles.hereLead} />
        <span className={styles.hereLabel}>You are here</span>
      </div>

      <div
        className={styles.end}
        style={{ left: pct(END.x, VB.w), top: pct(END.y, VB.h) }}
      >
        <span className={styles.diamond} />
        <span className={styles.endLead} />
        <span className={styles.endLabel}>
          <span className={styles.endDate}>{terminus}</span>
          {/* NOT "opening bell" — the launch date is a Saturday. */}
          <span className={styles.endSub}>Doors open</span>
        </span>
      </div>
    </div>
  )
}

/* ── Founder access ─────────────────────────────────────────────────────────
   The high-intent path, deliberately placed AFTER the waitlist: the email
   field is the low-friction default, this is for people who want in now.
   The diamond rhymes with the curve's terminus marker — same shape for
   "where this is going" and "what you get for coming early". */

// No "X:" / "Email:" / "Phone:" prefixes — an @handle, an address and a phone
// number each already say what they are, and the labels cost a line each.
const CONTACTS = [
  { label: '@TSDR_Trading', href: 'https://x.com/TSDR_Trading', channel: 'x-tsdr' },
  { label: '@Braczyy',      href: 'https://x.com/Braczyy',      channel: 'x-bracco' },
  { label: 'unchartedterritory5995@gmail.com',
    href: 'mailto:unchartedterritory5995@gmail.com',            channel: 'email' },
  { label: '(612) 730-0632', href: 'tel:+16127300632',          channel: 'phone' },
]

function FounderAccess() {
  return (
    <section className={styles.founder} aria-labelledby="cs-founder">
      <h2 className={styles.founderHead} id="cs-founder">
        <span className={styles.founderDia} aria-hidden="true" />
        Founder access
      </h2>
      <p className={styles.founderCopy}>
        Open now, at a rate locked for as long as you stay. To claim it, reach out:
      </p>
      <ul className={styles.contacts}>
        {CONTACTS.map(({ label, href, channel }) => (
          <li key={href} className={styles.contact}>
            <a
              className={styles.contactLink}
              href={href}
              onClick={() => track('founder_contact_click', { channel })}
              {...(href.startsWith('http')
                ? { target: '_blank', rel: 'noopener noreferrer' }
                : {})}
            >
              {label}
            </a>
          </li>
        ))}
      </ul>
    </section>
  )
}

/* ── Waitlist ───────────────────────────────────────────────────────────── */

function Waitlist() {
  const [email, setEmail]   = useState('')
  const [state, setState]   = useState('idle') // idle | sending | done | error
  const [message, setMessage] = useState('')
  const liveRef = useRef(null)

  const submit = async (e) => {
    e.preventDefault()
    if (state === 'sending') return
    const value = email.trim()
    if (!value) {
      setState('error')
      setMessage('Enter an email address.')
      return
    }
    setState('sending')
    setMessage('')
    track('waitlist_submit')
    try {
      const res = await fetch('/api/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: value }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setState('error')
        setMessage(body.detail || 'That did not go through. Try again in a moment.')
        return
      }
      setState('done')
      setMessage(body.already ? "You're already on the list." : "You're on the list.")
      // Only a genuinely new row counts as a conversion.
      if (!body.already) track('waitlist_joined')
    } catch {
      setState('error')
      setMessage('No connection. Try again in a moment.')
    }
  }

  if (state === 'done') {
    return (
      <div className={styles.done} role="status">
        <span className={styles.doneTick} aria-hidden="true">✓</span>
        <div>
          <p className={styles.doneTitle}>{message}</p>
          <p className={styles.doneSub}>We'll email you the morning the desk opens.</p>
        </div>
      </div>
    )
  }

  return (
    <form className={styles.form} onSubmit={submit} noValidate>
      <div className={styles.field}>
        <label className={styles.srOnly} htmlFor="cs-email">Email address</label>
        <input
          id="cs-email"
          className={styles.input}
          type="email"
          name="email"
          inputMode="email"
          autoComplete="email"
          placeholder="you@email.com"
          value={email}
          onChange={(e) => { setEmail(e.target.value); if (state === 'error') setState('idle') }}
          aria-invalid={state === 'error' || undefined}
          aria-describedby={message ? 'cs-msg' : undefined}
        />
        <button className={styles.submit} type="submit" disabled={state === 'sending'}>
          {state === 'sending' ? 'Adding…' : 'Notify me'}
        </button>
      </div>
      <p
        id="cs-msg"
        ref={liveRef}
        className={`${styles.msg} ${state === 'error' ? styles.msgError : ''}`}
        role={state === 'error' ? 'alert' : undefined}
      >
        {/* Deliberately NOT "one email, nothing else" — people sign up under
            whatever this says, so promising total silence would make any
            build-up email over the next six weeks a bait-and-switch. */}
        {message || 'Launch news and the occasional update. Nothing else.'}
      </p>
    </form>
  )
}

/* ── Page ───────────────────────────────────────────────────────────────── */

export default function ComingSoon() {
  const target = useMemo(launchDate, [])
  const [now, setNow] = useState(() => Date.now())
  const still = useMemo(prefersReducedMotion, [])
  const pathRef = useRef(null)
  const [herePoint, setHerePoint] = useState(SEAM_FALLBACK)

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(id)
  }, [])

  // One view event per mount, so join-rate has a denominator.
  useEffect(() => { track('coming_soon_view') }, [])

  const left = remaining(target, now)
  const terminus = useMemo(() => terminusLabel(target), [target])
  const seam = seamFraction(target, now)

  // Ask the rendered path where the seam actually falls, rather than keeping a
  // second hardcoded copy of the geometry in sync by hand. getPointAtLength
  // returns viewBox units, which map straight to a percentage of the box
  // because the SVG uses preserveAspectRatio="none".
  useEffect(() => {
    const el = pathRef.current
    if (!el) return
    try {
      const p = el.getPointAtLength(el.getTotalLength() * seam)
      if (Number.isFinite(p?.x) && Number.isFinite(p?.y)) setHerePoint({ x: p.x, y: p.y })
    } catch {
      /* no path metrics (jsdom, ancient engines) — keep SEAM_FALLBACK */
    }
  }, [seam])

  return (
    <div className={`${styles.page} ${still ? styles.still : ''}`}>
      <div className={styles.grid} aria-hidden="true" />
      <Curve still={still} seam={seam} pathRef={pathRef} />

      {/* The compass rose, where a chart puts one: bottom-right, bled off the
          corner, under the plotted course. The page was already a cartographer's
          sheet (cross-hatch ground, a course, a "you are here", a waypoint) with
          the one instrument that makes it legible missing. This is the brand
          mark doing the job it was drawn for rather than a logo parked on top. */}
      <div className={styles.rose} aria-hidden="true">
        <UTMark tone="gold" spin={!still} className={styles.roseMark} />
      </div>

      <div className={styles.vignette} aria-hidden="true" />
      <CurveMarks still={still} terminus={terminus} herePoint={herePoint} />

      <header className={styles.top}>
        {/* Stacked two-up, the way the real lockup sets it. The mark carries the
            accessible name so the wordmark beside it isn't read out twice. */}
        <div className={styles.brand}>
          <UTMark size={27} title="Uncharted Territory" className={styles.brandMark} />
          <span className={styles.wordmark} aria-hidden="true">
            <span className={styles.wordTop}>Uncharted</span>
            <span className={styles.wordBot}>Territory</span>
          </span>
        </div>
        <Link
          to="/login"
          className={styles.login}
          onClick={() => track('coming_soon_login_click')}
        >Log in</Link>
      </header>

      <main className={styles.center}>
        <p className={styles.eyebrow}>UCT Intelligence</p>

        {/* aria-label: the two lines are separate spans so they can stagger
            in, but their text nodes concatenate to "ComingSoon" for a screen
            reader without it. */}
        <h1 className={styles.monument} aria-label="Coming soon">
          <span className={styles.monumentLine} aria-hidden="true">Coming</span>
          <span className={styles.monumentLine} aria-hidden="true">Soon</span>
        </h1>

        <p className={styles.tagline}>Navigate the market, effectively.</p>

        <p className={styles.blurb}>
          The Trading Brain you need as a companion.
        </p>

        {/* Proof, not a claim. A stranger arriving from social has no reason to
            believe any of the above — this is already-published work they can
            go read before handing over an email or making a call. */}
        <a
          className={styles.proof}
          href={SUBSTACK_URL}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => track('substack_click')}
        >
          Already publishing weekly — read the Sunday Scans
          <span className={styles.proofArrow} aria-hidden="true">→</span>
        </a>

        {!left && (
          <p className={styles.opening} role="status">{passedLabel(target, now)}</p>
        )}

        {left && (
          <div className={styles.clock} aria-label="Time until launch">
            <div className={styles.unit}>
              <span className={styles.num}>{left.days}</span>
              <span className={styles.lab}>{left.days === 1 ? 'day' : 'days'}</span>
            </div>
            <span className={styles.sep} aria-hidden="true" />
            <div className={styles.unit}>
              <span className={styles.num}>{String(left.hours).padStart(2, '0')}</span>
              <span className={styles.lab}>hrs</span>
            </div>
            <span className={styles.sep} aria-hidden="true" />
            <div className={styles.unit}>
              <span className={styles.num}>{String(left.mins).padStart(2, '0')}</span>
              <span className={styles.lab}>min</span>
            </div>
          </div>
        )}

        <Waitlist />
        <FounderAccess />
      </main>

      <footer className={styles.foot}>
        <span className={styles.copy}>© {new Date().getFullYear()} Uncharted Territory</span>
        <nav className={styles.footLinks}>
          <Link to="/terms">Terms</Link>
          <Link to="/privacy">Privacy</Link>
        </nav>
      </footer>
    </div>
  )
}
