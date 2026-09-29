// app/src/components/chart/engine/ast/stringEscapes.test.js
//
// ─── ⭐⭐ `\n` IN A PINE STRING IS A NEWLINE ─────────────────────────────────
//
// The lexer kept whatever character followed a backslash, which is right for
// `\\`, `\"` and `\'` and wrong for `\n` — the escape the corpus writes most
// (380 of the 389 backslash sequences in the 2026-09-28 vendor batch).
//
// ⚰️ MEASURED against TradingView (2026-09-28, NYSE:RDDT 1D):
// `position-size-calculator` builds a label from `"\n Account Balance : " + …`;
// the vendor's label text carries real line breaks and ours read
// `n Account Balance : 1000n Risk % : 2…`. `heat-map-seasons` wrote the same
// `n` into a table cell. See `docs/pine/vendor-harness/objects-triage-2026-09-28.md`, C5.
import { describe, it, expect } from 'vitest'
import { lexPine, translatePine } from './pine.js'

const BS = String.fromCharCode(92) // one backslash, spelled so no reader has to count them
const strings = (src) => lexPine(src).tokens.filter((t) => t.kind === 'string').map((t) => t.value)

describe('⭐⭐ string escapes', () => {
  it('`\\n` is ONE newline character', () => {
    const [v] = strings(`x = "a${BS}nb"`)
    expect(v).toBe('a\nb')
    expect(v).toHaveLength(3)
  })

  it('⛔ CONTROL — the escapes that always worked still mean themselves', () => {
    expect(strings(`x = "a${BS}${BS}b"`)).toEqual([`a${BS}b`])
    expect(strings(`x = 'it${BS}'s'`)).toEqual(["it's"])
    expect(strings(`x = "say ${BS}"hi${BS}""`)).toEqual(['say "hi"'])
  })

  it('⛔ an ESCAPED `n` is not a source line break — the line counter does not move', () => {
    const toks = lexPine(`x = "a${BS}nb"\ny = 1`).tokens
    const y = toks.find((t) => t.kind === 'ident' && t.value === 'y')
    expect(y.line).toBe(2)
  })

  it('reaches a drawing: a label built from `"\\n…"` carries the line break', () => {
    const t = translatePine(
      `//@version=5\nindicator("t", overlay=true)\nlabel.new(bar_index, close, "a${BS}nb")\n`,
      { mode: 'host' },
    )
    const create = (t.objects && t.objects.ops || []).find((o) => o.k === 'create')
    expect(create).toBeTruthy()
    expect(create.props.text).toEqual({ v: 'text', node: { t: 'lit', s: 'a\nb' } })
  })
})
