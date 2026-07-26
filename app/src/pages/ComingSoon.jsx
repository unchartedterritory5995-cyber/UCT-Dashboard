import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import styles from './ComingSoon.module.css'

// Launch target: Sat Sep 5 2026, 9am ET (owner's date). Deliberately NOT
// labelled "opening bell" anywhere — Sep 5 is a Saturday, so there is no
// session that morning; members onboard over the long weekend (Sep 7 is Labor
// Day) and the first live Morning Wire lands Tue Sep 8.
// Override without a code change via VITE_LAUNCH_DATE (ISO-8601 with offset).
const FALLBACK_LAUNCH = '2026-09-05T09:00:00-04:00'
const LAUNCH_ISO = import.meta.env.VITE_LAUNCH_DATE || FALLBACK_LAUNCH

function launchDate() {
  const d = new Date(LAUNCH_ISO)
  return Number.isNaN(d.getTime()) ? new Date(FALLBACK_LAUNCH) : d
}

// Short "SEP 8" label for the terminus annotation on the curve.
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

// Seam between shipped and ahead, and the terminus at the opening bell.
const HERE = { x: 1140, y: 330 }
const END  = { x: 1450, y: 176 }

// Deliberately shallow on the left: the copy block occupies roughly the first
// 46% of the frame, so the curve stays under it and does the climbing out in
// the open space on the right.
const PAST_D =
  'M -30 776 C 96 772, 196 764, 292 758 S 424 748, 500 762 ' +
  'C 570 774, 646 744, 726 710 C 806 676, 856 616, 916 556 ' +
  `S 1016 462, 1068 430 C 1106 408, 1122 368, ${HERE.x} ${HERE.y}`

const PAST_FILL_D = `${PAST_D} L ${HERE.x} ${VB.h} L -30 ${VB.h} Z`

const AHEAD_D =
  `M ${HERE.x} ${HERE.y} C 1214 276, 1268 268, 1338 224 S 1418 190, ${END.x} ${END.y}`

const pct = (v, total) => `${(v / total) * 100}%`

function Curve({ still }) {
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
        {/* The fill has to be fully transparent BEFORE the seam, or the path's
            closing edge draws a hard vertical wall down to the floor at
            HERE.x. Hence the fade completing at 66% — comfortably left of the
            seam at 71%. */}
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
        d={PAST_FILL_D}
        fill="url(#cs-fill)"
        mask="url(#cs-fill-mask)"
      />

      <path
        className={styles.past}
        d={PAST_D}
        pathLength="1"
        fill="none"
        stroke="#c9a84c"
        strokeWidth="2"
        strokeLinecap="round"
      />

      <path
        className={styles.ahead}
        d={AHEAD_D}
        pathLength="1"
        fill="none"
        stroke="#c9a84c"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeDasharray="0.016 0.021"
      />
    </svg>
  )
}

/* The two annotations on the curve. Plain HTML so the type stays true while
   the curve beneath it stretches. Coordinates come from the same constants
   the path is drawn from. */
function CurveMarks({ still, terminus }) {
  return (
    <div className={`${styles.marks} ${still ? styles.marksStill : ''}`} aria-hidden="true">
      <div
        className={styles.here}
        style={{ left: pct(HERE.x, VB.w), top: pct(HERE.y, VB.h) }}
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
  { label: '@TSDR_Trading', href: 'https://x.com/TSDR_Trading' },
  { label: '@Braczyy',      href: 'https://x.com/Braczyy' },
  { label: 'unchartedterritory5995@gmail.com',
    href: 'mailto:unchartedterritory5995@gmail.com' },
  { label: '(612) 730-0632', href: 'tel:+16127300632' },
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
        {CONTACTS.map(({ label, href }) => (
          <li key={href} className={styles.contact}>
            <a
              className={styles.contactLink}
              href={href}
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
        {message || 'One email when we open. Nothing else.'}
      </p>
    </form>
  )
}

/* ── Page ───────────────────────────────────────────────────────────────── */

export default function ComingSoon() {
  const target = useMemo(launchDate, [])
  const [now, setNow] = useState(() => Date.now())
  const still = useMemo(prefersReducedMotion, [])

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(id)
  }, [])

  const left = remaining(target, now)
  const terminus = useMemo(() => terminusLabel(target), [target])

  return (
    <div className={`${styles.page} ${still ? styles.still : ''}`}>
      <div className={styles.grid} aria-hidden="true" />
      <Curve still={still} />
      <div className={styles.vignette} aria-hidden="true" />
      <CurveMarks still={still} terminus={terminus} />

      <header className={styles.top}>
        <div className={styles.brand}>
          <span className={styles.brandMark} aria-hidden="true">⊕</span>
          <span className={styles.brandName}>Uncharted Territory</span>
        </div>
        <Link to="/login" className={styles.login}>Log in</Link>
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
          A daily intelligence desk for traders. The Morning Wire at 7:35, the
          UCT&nbsp;20, live market breadth, and a coach that reviews every trade
          you take.
        </p>

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
