// On-brand gold SVG controls for the persistent video player. Matches the
// gradient + stroke language of pages/education/icons.jsx. No generic emoji.
const GOLD = '#c9a84c'
const GOLD_BRIGHT = '#e6cf86'

function Defs({ id }) {
  return (
    <defs>
      <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stopColor={GOLD_BRIGHT} />
        <stop offset="100%" stopColor={GOLD} />
      </linearGradient>
    </defs>
  )
}

export function PauseIcon({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" role="img" aria-hidden="true">
      <Defs id="vid-pause" />
      <rect x="6.5" y="5" width="3.4" height="14" rx="1" fill="url(#vid-pause)" />
      <rect x="14.1" y="5" width="3.4" height="14" rx="1" fill="url(#vid-pause)" />
    </svg>
  )
}

export function CloseIcon({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" role="img" aria-hidden="true">
      <Defs id="vid-close" />
      <path d="M6 6l12 12M18 6L6 18" stroke="url(#vid-close)" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

export function MinimizeIcon({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" role="img" aria-hidden="true">
      <Defs id="vid-min" />
      {/* arrows collapsing inward to a corner */}
      <path d="M10 4v6H4M14 20v-6h6" stroke="url(#vid-min)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function ExpandIcon({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" role="img" aria-hidden="true">
      <Defs id="vid-exp" />
      <path d="M4 9V4h5M20 15v5h-5M20 9V4h-5M4 15v5h5" stroke="url(#vid-exp)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function NextIcon({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" role="img" aria-hidden="true">
      <Defs id="vid-next" />
      <path d="M6 5l9 7-9 7z" fill="url(#vid-next)" />
      <rect x="16.5" y="5" width="2.4" height="14" rx="1" fill="url(#vid-next)" />
    </svg>
  )
}

export function DragIcon({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" role="img" aria-hidden="true">
      <g fill={GOLD}>
        <circle cx="9" cy="6" r="1.4" /><circle cx="15" cy="6" r="1.4" />
        <circle cx="9" cy="12" r="1.4" /><circle cx="15" cy="12" r="1.4" />
        <circle cx="9" cy="18" r="1.4" /><circle cx="15" cy="18" r="1.4" />
      </g>
    </svg>
  )
}

// Rewind: a counter-clockwise arrow with a "15" label.
export function SkipBackIcon({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" role="img" aria-hidden="true">
      <path d="M12 7a6 6 0 1 0 6 6" stroke={GOLD} strokeWidth="1.7" strokeLinecap="round" fill="none" />
      <path d="M12 3.5 8.5 7 12 10.5z" fill={GOLD} />
      <text x="12.5" y="15.5" fontSize="7.5" fontWeight="700" textAnchor="middle" fill={GOLD}>15</text>
    </svg>
  )
}

// Fast-forward: a clockwise arrow with a "15" label.
export function SkipFwdIcon({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" role="img" aria-hidden="true">
      <path d="M12 7a6 6 0 1 1 -6 6" stroke={GOLD} strokeWidth="1.7" strokeLinecap="round" fill="none" />
      <path d="M12 3.5 15.5 7 12 10.5z" fill={GOLD} />
      <text x="11.5" y="15.5" fontSize="7.5" fontWeight="700" textAnchor="middle" fill={GOLD}>15</text>
    </svg>
  )
}

export function FullscreenIcon({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" role="img" aria-hidden="true">
      <path d="M4 9V5a1 1 0 0 1 1-1h4M20 9V5a1 1 0 0 0-1-1h-4M4 15v4a1 1 0 0 0 1 1h4M20 15v4a1 1 0 0 1-1 1h-4"
            stroke={GOLD} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function VolumeIcon({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" role="img" aria-hidden="true">
      <path d="M4 9v6h3l5 4V5L7 9z" fill={GOLD} />
      <path d="M16 8.5a4 4 0 0 1 0 7M18.5 6a7 7 0 0 1 0 12" stroke={GOLD} strokeWidth="1.6" strokeLinecap="round" fill="none" />
    </svg>
  )
}

export function MuteIcon({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" role="img" aria-hidden="true">
      <path d="M4 9v6h3l5 4V5L7 9z" fill={GOLD} />
      <path d="M16 9.5l5 5M21 9.5l-5 5" stroke={GOLD} strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}

// Pop-out: a window with an up-right arrow (open in a separate window).
export function PopOutIcon({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" role="img" aria-hidden="true">
      <path d="M13 4h7v7" stroke={GOLD} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M20 4l-8 8" stroke={GOLD} strokeWidth="1.7" strokeLinecap="round" />
      <path d="M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4"
            stroke={GOLD} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

// Closed-captions: "CC" inside a rounded rectangle.
export function CcIcon({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" role="img" aria-hidden="true">
      <rect x="3" y="6" width="18" height="12" rx="2.5" stroke={GOLD} strokeWidth="1.5" />
      <text x="12" y="15.5" fontSize="7.5" fontWeight="800" textAnchor="middle" fill={GOLD}>CC</text>
    </svg>
  )
}
