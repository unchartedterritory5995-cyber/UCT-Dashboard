// Lane FIN-A11Y round 3: five screens scrolled sideways on a phone, and one control was
// under the 44px floor. Measured in a real browser at 390 px (raw rows:
// docs/notebook/evidence/fin-a11y/before/walk.json; tool tools/notebook_fin_a11y_overflow_walk.py):
//
//   research workspace   763 px in a 390 px page (transcript capture and the other header
//                        buttons on): `.headerActions` was a no-wrap row that could not shrink
//   closed trades        534 px: `.toolbarRight` was a no-wrap row of four buttons
//   trade page           470 px: the header's action group was an inline-styled no-wrap span
//   Help                 406 px: the header's negative margin (28 px) was wider than the page's
//                        phone padding (12 px), because the phone rule changed the padding and
//                        not the variable the header's margin is derived from
//   the saved "why" Edit 21.8 x 44 px (the floor is 44 x 44)
//
// jsdom lays nothing out, so it cannot see overflow. What a unit test CAN hold is the rule
// that fixed each one: a row that wraps, a margin that matches its padding, a floor that has
// both dimensions. The browser walk is the measurement; this is the regression rail.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const SRC = join(process.cwd(), 'src')
const read = (rel) => readFileSync(join(SRC, rel), 'utf8')
const css = (rel) => read(rel).replace(/\/\*[\s\S]*?\*\//g, '')

/** The declarations of the LAST top-level rule for `selector` outside any @media block. */
function baseRule(text, selector) {
  const top = text.replace(/@media[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '')
  const re = new RegExp('(?:^|[\\n}])\\s*' + selector.replace('.', '\\.') + '\\s*\\{([^}]*)\\}', 'g')
  let m
  let last = null
  while ((m = re.exec(top))) last = m[1]
  return last
}

/** Every `@media (max-width: Npx)` block's body, joined. */
function mediaBlocks(text, px) {
  const out = []
  const re = new RegExp('@media\\s*\\(max-width:\\s*' + px + 'px\\)\\s*\\{((?:[^{}]*\\{[^{}]*\\})*[^{}]*)\\}', 'g')
  let m
  while ((m = re.exec(text))) out.push(m[1])
  return out.join('\n')
}
const ruleIn = (block, selector) => {
  const m = new RegExp('(?:^|[\\n},])\\s*' + selector.replace('.', '\\.') + '\\s*\\{([^}]*)\\}').exec(block)
  return m ? m[1] : null
}

describe('a row of buttons wraps instead of pushing the page sideways', () => {
  it('research workspace: the header actions wrap and may shrink', () => {
    const rule = baseRule(css('pages/journal-2-0/components/notebook/TickerResearchWorkspace.module.css'), '.headerActions')
    expect(rule).toMatch(/flex-wrap:\s*wrap/)
    expect(rule).not.toMatch(/flex-shrink:\s*0/)
    expect(rule).toMatch(/min-width:\s*0/)
  })

  it('closed trades: the right-hand toolbar wraps', () => {
    const text = css('pages/journal-2-0/tabs/TradeJournalTab.module.css')
    const phone = ruleIn(mediaBlocks(text, 640), '.toolbarRight')
    expect(phone, 'a .toolbarRight rule at 640px and under').not.toBeNull()
    expect(phone).toMatch(/flex-wrap:\s*wrap/)
  })

  it('trade page: the header actions are a class that wraps, not an inline no-wrap style', () => {
    const jsx = read('pages/journal-2-0/components/trade/TradeDetailPage.jsx')
    expect(jsx).not.toMatch(/<span style=\{\{ marginLeft: 'auto', display: 'inline-flex'/)
    expect(jsx).toMatch(/className=\{styles\.headActions\}/)
    const rule = baseRule(css('pages/journal-2-0/components/trade/TradeDetailPage.module.css'), '.headActions')
    expect(rule).toMatch(/flex-wrap:\s*wrap/)
    expect(rule).toMatch(/margin-left:\s*auto/)
  })
})

describe('Help: the header bleeds exactly as far as the page is padded', () => {
  const text = css('pages/Support.module.css')

  it('the header margin is derived from the page padding variables', () => {
    expect(baseRule(text, '.header')).toMatch(/margin:\s*calc\(-1 \* var\(--page-pad-top[^)]*\)\)\s*calc\(-1 \* var\(--page-pad-x/)
  })

  it('at 640px and under the variables move WITH the padding', () => {
    const phone = ruleIn(mediaBlocks(text, 640), '.page')
    expect(phone, 'a .page rule at 640px and under').not.toBeNull()
    const pad = /padding:\s*(\d+)px\s+(\d+)px/.exec(phone)
    expect(pad, 'the phone padding').not.toBeNull()
    expect(/--page-pad-top:\s*(\d+)px/.exec(phone)?.[1]).toBe(pad[1])
    expect(/--page-pad-x:\s*(\d+)px/.exec(phone)?.[1]).toBe(pad[2])
  })

  it('and on desktop they already agree (the control for the check above)', () => {
    const desktop = baseRule(text, '.page')
    const pad = /padding:\s*(\d+)px\s+(\d+)px/.exec(desktop)
    expect(/--page-pad-top:\s*(\d+)px/.exec(desktop)[1]).toBe(pad[1])
    expect(/--page-pad-x:\s*(\d+)px/.exec(desktop)[1]).toBe(pad[2])
  })
})

describe('the saved "why" Edit control meets the floor in both dimensions', () => {
  it('at 1024px and under it is at least 44 wide and 44 tall', () => {
    const touch = ruleIn(mediaBlocks(css('pages/journal-2-0/components/WhyPrompt.module.css'), 1024), '.linkBtn')
    expect(touch, 'a .linkBtn rule at 1024px and under').not.toBeNull()
    expect(touch).toMatch(/min-height:\s*var\(--tap-min/)
    expect(touch).toMatch(/min-width:\s*var\(--tap-min/)
  })
})

describe('only the canonical widths are used in the files this round touched', () => {
  for (const rel of [
    'pages/journal-2-0/components/notebook/TickerResearchWorkspace.module.css',
    'pages/journal-2-0/tabs/TradeJournalTab.module.css',
    'pages/journal-2-0/components/trade/TradeDetailPage.module.css',
    'pages/journal-2-0/components/WhyPrompt.module.css',
  ]) {
    it(rel, () => {
      const widths = [...css(rel).matchAll(/@media[^{]*?(?:max|min)-width:\s*(\d+)px/g)].map((m) => m[1])
      expect(widths.length).toBeGreaterThan(0)
      expect(widths.filter((w) => !['640', '641', '1024', '1025'].includes(w))).toEqual([])
    })
  }
})
