// FlowIcon — Options Flow's inline icon, and the emoji it replaced.
//
// WHY THIS FILE EXISTS
// --------------------
// CLAUDE.md makes UIcon the single source of truth for iconography and says
// plainly: do not use generic/system emoji as decorative icons. Every sibling
// page follows that — DarkPool reaches for UIcon 11 times, Model Book 15,
// Breadth 10. OptionsFlow.jsx used it ZERO times and carried 99 rendered emoji
// across 25 distinct glyphs. That single fact is most of why the page reads as
// "other" next to the rest of the app: a system emoji is full-colour, renders
// differently on every OS, ignores the surface's colour, and sits on the text
// baseline instead of the optical centre.
//
// TWO THINGS UIcon NEEDS AT EVERY CALL SITE HERE, so they live in one place:
//
//  1. VERTICAL ALIGNMENT. UIcon returns a bare <svg>, which is an inline
//     element and therefore sits on the BASELINE — noticeably low beside text.
//     Every one of these sites is an icon next to a word, so the nudge is the
//     norm, not the exception. (In a flex row `vertical-align` is simply
//     ignored and `alignItems` wins, so this is safe in both layouts.)
//
//  2. THE GOLD DECISION. UIcon's `gold` defaults to TRUE — the brand's
//     embossed metallic treatment, right for a NAMING icon (a chart, a folder,
//     a camera). It is wrong for a SEMANTIC one: a warning that renders gold
//     instead of red, or a check that renders gold instead of green, has lost
//     the meaning the colour was carrying. UIcon's own docstring says to pass
//     `gold={false}` there so the glyph inherits its surface's colour, which on
//     these sites is already set to the right semantic value.
//
// ⛔ DEFAULT SIZE IS 11, NOT UIcon's 18. This page's chrome runs at fontSize
// 10-11; an 18px icon beside 10px text is a badge, not an icon.

import UIcon from '../../components/ui/UIcon'

/**
 * The emoji each glyph replaced, and whether it is semantic.
 *
 * Kept as DATA rather than spread across ~90 call sites so the mapping can be
 * reviewed in one place, and so a test can assert every name here is a real
 * glyph — UIcon renders NULL for an unknown name and only warns to the console,
 * which on a page this size would be a silently missing icon nobody notices.
 *
 * `semantic: true` means the colour carries meaning, so the icon must inherit
 * `currentColor` instead of taking the gold treatment.
 */
export const REPLACED_EMOJI = {
  // Naming icons — gold brand treatment is correct.
  bolt: { emoji: '⚡', semantic: false },      // ⚡ live-fetch actions
  chart: { emoji: '\u{1F4C8}', semantic: false },  // 📈 / 📊 chart + data actions
  camera: { emoji: '\u{1F4F8}', semantic: false }, // 📸 screenshot / preview
  calendar: { emoji: '\u{1F4C5}', semantic: false }, // 📅 date picker
  library: { emoji: '\u{1F4C1}', semantic: false }, // 📁 theme group
  factory: { emoji: '\u{1F3E2}', semantic: false }, // 🏢 sector group
  document: { emoji: '\u{1F4CB}', semantic: false }, // 📋 batch / scanner list
  upload: { emoji: '\u{1F4E4}', semantic: false },  // 📤 push to Discord
  sparkle: { emoji: '\u{1F52E}', semantic: false }, // 🔮 generate summary
  pin: { emoji: '\u{1F4CC}', semantic: false },     // 📌 verdict marker
  flame: { emoji: '\u{1F525}', semantic: false },   // 🔥 active position

  // Semantic icons — the colour is the message, so they inherit currentColor.
  warning: { emoji: '⚠', semantic: true },     // ⚠ risk / low coverage
  x: { emoji: '✕', semantic: true },           // ✕ / ❌ close, remove, failure
  check: { emoji: '✅', semantic: true },       // ✅ / ✓ holding, confirmed
  trash: { emoji: '\u{1F5D1}', semantic: true },    // 🗑 destructive clear
  noEntry: { emoji: '⛔', semantic: true },     // ⛔ blocked
  chevronDown: { emoji: '\u{1F53B}', semantic: true }, // 🔻 exiting / fading
}

/**
 * An icon sized and aligned for this page's chrome.
 *
 * `semantic` is a convenience over UIcon's `gold` so call sites read in terms
 * of what the icon MEANS rather than how it is painted; an explicit `gold`
 * still wins if a surface needs to override.
 */
export default function FlowIcon({ name, size = 11, semantic, gold, style, ...rest }) {
  const isSemantic = semantic !== undefined
    ? semantic
    : !!(REPLACED_EMOJI[name] && REPLACED_EMOJI[name].semantic)
  return (
    <UIcon
      name={name}
      size={size}
      gold={gold !== undefined ? gold : !isSemantic}
      style={{ verticalAlign: '-1.5px', flexShrink: 0, ...style }}
      {...rest}
    />
  )
}
