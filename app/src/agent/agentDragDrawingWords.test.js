// #1258 (AUDIT conditions, 2026-11-14): the drawings group's "drag" words. Before the typo rail, "drag the line to 210"
// reached drawings only because correctTypos misread "drag" as "draw"; now a real word is never corrected, so the group names
// it by its own words — ONLY "drag" with a drawing noun (line, arrow, point, trendline, anchor, drawing). A bare "drag" (the
// chart, a widget, a pane divider, a layout tab, drag-and-drop) never adds the group, v1 or v2.
import { describe, it, expect, vi } from 'vitest'
import { registerBuiltins } from './builtins'
import { manifestFor } from './capabilities'
import { wordsSelect, selectGroups, GROUPS } from './routing'
import { selectGroupsV2 } from './nlm1/routingV2'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
registerBuiltins()
const manifest = manifestFor({ surface: 'charts', createIndicator: true, manageIndicators: true })
const v1 = (t) => selectGroups(t).selected
const v2 = (t) => selectGroupsV2(t, { manifest }).selected
// the v1 / v2 selections WITHOUT the drag words (the group as it was before #1258): the same phrase, the same everything else
const DRAWINGS = GROUPS.find(g => g.id === 'drawings')
const DRAG = DRAWINGS.words.find(re => re.source.startsWith(String.raw`\bdrag`))
function withoutDrag(fn) {
  const was = DRAWINGS.words
  DRAWINGS.words = was.filter(re => re !== DRAG)
  try { return fn() } finally { DRAWINGS.words = was }
}

describe('"drag" names the drawings group only with a drawing noun', () => {
  it('the drag words are one regex, found (the before / after below removes exactly it)', () => expect(DRAG).toBeTruthy())
  it.each(['drag the line to 210', "drag the arrow's end point up to 200", 'drag the trendline anchor to march 3', 'drag my drawing up a bit',
    'drag that trend line lower', 'dragged the anchor of the arrow'])('"%s": drawings (v1 and v2)', (t) => {
    expect(wordsSelect('drawings', t)).toBe(true)
    expect(v1(t)).toContain('drawings')
    expect(v2(t)).toContain('drawings')
  })
  it.each(['drag the chart left', 'drag the widget to the right', 'drag the pane divider', 'drag the layout tab', 'drag-and-drop my watchlist',
    'drag', 'drag it over there'])('OVER-CAPTURE "%s": the drag words never fire, and no v1 / v2 routing outcome changes', (t) => {
    expect(wordsSelect('drawings', t)).toBe(false)                        // the new words never fire on it
    const after = { v1: v1(t), v2: v2(t) }, before = withoutDrag(() => ({ v1: v1(t), v2: v2(t) }))
    console.log(`[drag] ${JSON.stringify(t)} before ${JSON.stringify(before)} after ${JSON.stringify(after)}`)
    expect(after).toEqual(before)                                         // no routing outcome changes, v1 or v2
  })
  // AUDIT's five: none of them carries drawings at all (a bare "drag" / "drag it over there" is a message nothing recognises,
  // so v1's own fill sends every group — exactly as before, the equality above shows it)
  it.each(['drag the chart left', 'drag the widget to the right', 'drag the pane divider', 'drag the layout tab', 'drag-and-drop my watchlist'])(
    '"%s": drawings is in neither the v1 nor the v2 selection', (t) => {
      expect(v1(t)).not.toContain('drawings')
      expect(v2(t)).not.toContain('drawings')
    })
})
