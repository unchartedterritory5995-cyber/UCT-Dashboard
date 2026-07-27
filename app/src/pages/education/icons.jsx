// app/src/pages/education/icons.jsx
// Custom on-brand gold SVG icons for the Educational Videos tab. Per the
// no-generic-emoji rule, these replace stock emoji everywhere on the surface.
// All draw in the brand gold (#c9a84c) with a subtle gradient.

const GOLD = '#c9a84c'
const GOLD_BRIGHT = '#e6cf86'

function GoldDefs({ id }) {
  return (
    <defs>
      <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stopColor={GOLD_BRIGHT} />
        <stop offset="100%" stopColor={GOLD} />
      </linearGradient>
    </defs>
  )
}

// Mortarboard / graduation cap — the "education" mark.
export function GraduationIcon({ size = 24 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" role="img" aria-hidden="true">
      <GoldDefs id="edu-grad" />
      <path
        d="M12 3 1.5 8 12 13l8.5-4.05V14.5"
        stroke="url(#edu-grad)"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <path
        d="M5.5 10.7v3.9c0 1.2 2.9 2.9 6.5 2.9s6.5-1.7 6.5-2.9v-3.9"
        stroke="url(#edu-grad)"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  )
}

// Stacked syllabus — the Courses section: an open outline with lesson rows.
export function CourseIcon({ size = 22 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" role="img" aria-hidden="true">
      <GoldDefs id="edu-course" />
      <rect
        x="4" y="3.5" width="16" height="17" rx="2.2"
        stroke="url(#edu-course)"
        strokeWidth="1.6"
        fill="none"
      />
      <path
        d="M8 8.2h8M8 12h8M8 15.8h5"
        stroke="url(#edu-course)"
        strokeWidth="1.6"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  )
}

// Play triangle inside a soft ring — the watch affordance.
export function PlayIcon({ size = 22 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" role="img" aria-hidden="true">
      <GoldDefs id="edu-play" />
      <circle cx="12" cy="12" r="10.4" fill="url(#edu-play)" opacity="0.95" />
      <path d="M9.7 8.2 16 12l-6.3 3.8z" fill="#0e0f0d" />
    </svg>
  )
}

export function PlusIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" role="img" aria-hidden="true">
      <GoldDefs id="edu-plus" />
      <path
        d="M12 5v14M5 12h14"
        stroke="url(#edu-plus)"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  )
}

export function SearchIcon({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" role="img" aria-hidden="true">
      <circle cx="10.5" cy="10.5" r="6.2" stroke={GOLD} strokeWidth="1.7" fill="none" />
      <path d="m15.5 15.5 4 4" stroke={GOLD} strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  )
}

// Article / newsletter — the Substack section mark.
export function ArticleIcon({ size = 22 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" role="img" aria-hidden="true">
      <GoldDefs id="edu-article" />
      <rect x="4" y="3.5" width="16" height="17" rx="2" stroke="url(#edu-article)" strokeWidth="1.6" />
      <path d="M7.5 8h9M7.5 11.5h9M7.5 15h5.5" stroke="url(#edu-article)" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

// Post / chat bubble — the Twitter "Posts" section mark.
export function PostIcon({ size = 22 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" role="img" aria-hidden="true">
      <GoldDefs id="edu-post" />
      <path d="M20.5 11.2a7.4 7.4 0 0 1-10.7 6.6L4.5 19l1.3-4.8A7.4 7.4 0 1 1 20.5 11.2z"
            stroke="url(#edu-post)" strokeWidth="1.6" strokeLinejoin="round" fill="none" />
    </svg>
  )
}

// Team — two figures.
export function TeamIcon({ size = 22 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" role="img" aria-hidden="true">
      <GoldDefs id="edu-team" />
      <circle cx="9" cy="8" r="3.2" stroke="url(#edu-team)" strokeWidth="1.6" />
      <path d="M3.5 19a5.5 5.5 0 0 1 11 0" stroke="url(#edu-team)" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M16 5.4a3.2 3.2 0 0 1 0 5.2M17.5 19a5.5 5.5 0 0 0-3-4.9"
            stroke="url(#edu-team)" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}
