// Slider — the one single-thumb range control. UCT Terminal visual pass 3.
//
// ── WHAT IT OWNS, AND WHAT IT DELIBERATELY DOES NOT ─────────────────────────────
//
// It is a native `<input type="range">`, so the keyboard (arrows, Page Up/Down,
// Home/End), the `slider` role, `aria-valuenow`/`-min`/`-max` and form semantics are
// the browser's — nothing here re-implements them. `type` is consumed and always
// "range"; every other prop (value, min, max, step, onChange, disabled, aria-*,
// data-testid, title, ...) is forwarded untouched.
//
// Unlike Input/Select/Checkbox, it DOES own the look. The browser's default slider
// is the one control a theme cannot reach through `color`/`background`: its track
// and thumb are pseudo-elements, so every surface that used the bare element drew a
// grey-and-blue OS widget on every app theme. Slider.module.css paints the track
// from --bg-hover/--border, the filled part and the thumb from --accent, a
// --focus-ring on keyboard focus, and raises the hit area to --tap-min on touch.
// The caller's `className` is composed after the primitive's, for layout (flex,
// width) — not for re-skinning.
//
// The filled part of the track is the `--slider-fill` percentage, computed from a
// CONTROLLED `value`. An uncontrolled slider (no `value`) shows an unfilled track;
// both current callers are controlled.
import styles from './Slider.module.css'

function fillPercent(value, min, max) {
  const v = Number(value)
  const lo = Number(min)
  const hi = Number(max)
  if (!Number.isFinite(v) || !Number.isFinite(lo) || !Number.isFinite(hi) || hi <= lo) return 0
  return Math.min(100, Math.max(0, ((v - lo) / (hi - lo)) * 100))
}

export default function Slider({
  className,
  style,
  min = 0,
  max = 100,
  value,
  // consumed, never forwarded — a Slider is always a range
  type: _type,
  ...rest
}) {
  const cls = [styles.slider, className].filter(Boolean).join(' ')
  const fill = `${fillPercent(value, min, max)}%`
  return (
    <input
      type="range"
      className={cls}
      min={min}
      max={max}
      value={value}
      style={{ '--slider-fill': fill, ...style }}
      {...rest}
    />
  )
}
