/**
 * StrategyIcon — small (40×32 default) SVG payoff-diagram glyph for
 * each strategy type. Used in the StrategyPicker grid (Step 4) and
 * optionally next to strategy labels in tables.
 *
 * Each diagram is a simplified P&L curve drawn on a fixed 40×32 viewBox.
 * Green strokes = the "positive" regions, red = loss, grey = break-even.
 */

const VIEW = '0 0 40 32'

const baseLine = (color = 'var(--border)') => (
  <line x1="0" y1="16" x2="40" y2="16" stroke={color} strokeWidth="0.5" strokeDasharray="2,2" />
)

function LongCallIcon() {
  return (
    <svg viewBox={VIEW} fill="none" role="img" aria-label="Long call">
      {baseLine()}
      <polyline points="0,24 20,24 40,4" stroke="var(--gain)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}

function LongPutIcon() {
  return (
    <svg viewBox={VIEW} fill="none" role="img" aria-label="Long put">
      {baseLine()}
      <polyline points="0,4 20,24 40,24" stroke="var(--gain)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}

function ShortCallIcon() {
  return (
    <svg viewBox={VIEW} fill="none" role="img" aria-label="Short call">
      {baseLine()}
      <polyline points="0,8 20,8 40,28" stroke="var(--loss)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}

function ShortPutIcon() {
  return (
    <svg viewBox={VIEW} fill="none" role="img" aria-label="Short put">
      {baseLine()}
      <polyline points="0,28 20,8 40,8" stroke="var(--loss)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}

function CallDebitSpreadIcon() {
  return (
    <svg viewBox={VIEW} fill="none" role="img" aria-label="Call debit spread">
      {baseLine()}
      <polyline points="0,22 14,22 26,8 40,8" stroke="var(--gain)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}

function CallCreditSpreadIcon() {
  return (
    <svg viewBox={VIEW} fill="none" role="img" aria-label="Call credit spread">
      {baseLine()}
      <polyline points="0,10 14,10 26,24 40,24" stroke="var(--loss)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}

function PutDebitSpreadIcon() {
  return (
    <svg viewBox={VIEW} fill="none" role="img" aria-label="Put debit spread">
      {baseLine()}
      <polyline points="0,8 14,8 26,22 40,22" stroke="var(--gain)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}

function PutCreditSpreadIcon() {
  return (
    <svg viewBox={VIEW} fill="none" role="img" aria-label="Put credit spread">
      {baseLine()}
      <polyline points="0,24 14,24 26,10 40,10" stroke="var(--loss)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}

function StraddleIcon() {
  return (
    <svg viewBox={VIEW} fill="none" role="img" aria-label="Long straddle">
      {baseLine()}
      <polyline points="0,4 20,24 40,4" stroke="var(--gain)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}

function StrangleIcon() {
  return (
    <svg viewBox={VIEW} fill="none" role="img" aria-label="Long strangle">
      {baseLine()}
      <polyline points="0,4 14,22 26,22 40,4" stroke="var(--gain)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}

function CalendarIcon() {
  return (
    <svg viewBox={VIEW} fill="none" role="img" aria-label="Calendar spread">
      {baseLine()}
      <path d="M2,20 Q20,2 38,20" stroke="var(--gain)" strokeWidth="2" fill="none" strokeLinecap="round" />
    </svg>
  )
}

function DiagonalIcon() {
  return (
    <svg viewBox={VIEW} fill="none" role="img" aria-label="Diagonal spread">
      {baseLine()}
      <path d="M2,22 Q16,6 32,10 L40,6" stroke="var(--gain)" strokeWidth="2" fill="none" strokeLinecap="round" />
    </svg>
  )
}

function IronCondorIcon() {
  return (
    <svg viewBox={VIEW} fill="none" role="img" aria-label="Iron condor">
      {baseLine()}
      <polyline points="0,24 8,24 14,10 26,10 32,24 40,24" stroke="var(--gain)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}

function IronButterflyIcon() {
  return (
    <svg viewBox={VIEW} fill="none" role="img" aria-label="Iron butterfly">
      {baseLine()}
      <polyline points="0,24 16,24 20,6 24,24 40,24" stroke="var(--gain)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}

function CallButterflyIcon() {
  return (
    <svg viewBox={VIEW} fill="none" role="img" aria-label="Call butterfly">
      {baseLine()}
      <polyline points="0,22 12,22 20,6 28,22 40,22" stroke="var(--gain)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}

function PutButterflyIcon() {
  return (
    <svg viewBox={VIEW} fill="none" role="img" aria-label="Put butterfly">
      {baseLine()}
      <polyline points="0,22 12,22 20,6 28,22 40,22" stroke="var(--gain)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}

function CustomIcon() {
  return (
    <svg viewBox={VIEW} fill="none" role="img" aria-label="Custom">
      {baseLine()}
      <path d="M2,20 Q10,4 20,12 Q30,20 38,8" stroke="var(--text-muted)" strokeWidth="2" fill="none" strokeLinecap="round" strokeDasharray="3,2" />
    </svg>
  )
}

const ICONS = {
  long_call: LongCallIcon,
  long_put: LongPutIcon,
  short_call: ShortCallIcon,
  short_put: ShortPutIcon,
  vertical_debit_call: CallDebitSpreadIcon,
  vertical_credit_call: CallCreditSpreadIcon,
  vertical_debit_put: PutDebitSpreadIcon,
  vertical_credit_put: PutCreditSpreadIcon,
  straddle: StraddleIcon,
  strangle: StrangleIcon,
  calendar: CalendarIcon,
  diagonal: DiagonalIcon,
  iron_condor: IronCondorIcon,
  iron_butterfly: IronButterflyIcon,
  call_butterfly: CallButterflyIcon,
  put_butterfly: PutButterflyIcon,
  custom: CustomIcon,
}

/** Named glyph for a strategy type. Falls back to Custom for unknown keys. */
export default function StrategyIcon({ type, size = 32, className = '' }) {
  const Glyph = ICONS[type] || CustomIcon
  const w = Math.round((size * 40) / 32)
  return (
    <span
      className={className}
      style={{
        display: 'inline-flex',
        width: w,
        height: size,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Glyph />
    </span>
  )
}
