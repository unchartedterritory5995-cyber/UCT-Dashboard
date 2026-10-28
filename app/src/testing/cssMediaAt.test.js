import { test, expect } from 'vitest'
import { queryApplies, mediaApplies, mediaBodiesOn } from './cssMediaAt'

const TOUCH = { width: 1194, pointer: 'coarse' }
const MOUSE = { width: 1200, pointer: 'fine' }

test('widths and pointer', () => {
  expect(mediaApplies('(max-width: 1024px), (pointer: coarse)', TOUCH)).toBe(true)
  expect(mediaApplies('(max-width: 1024px), (pointer: coarse)', MOUSE)).toBe(false)
  expect(queryApplies('(pointer: coarse) and (max-width: 640px)', { width: 390, pointer: 'coarse' })).toBe(true)
})

test('`only` and the screen/all types are understood; `not`, `print` and unknown features never apply', () => {
  expect(queryApplies('only screen and (max-width: 1024px)', { width: 800 })).toBe(true)
  expect(queryApplies('screen and (max-width: 1024px)', { width: 800 })).toBe(true)
  expect(queryApplies('screen', { width: 800 })).toBe(true)
  expect(queryApplies('not screen and (max-width: 1024px)', { width: 800 })).toBe(false)
  expect(queryApplies('not all and (pointer: coarse)', MOUSE)).toBe(false)
  expect(queryApplies('print and (max-width: 1024px)', { width: 800 })).toBe(false)
  expect(queryApplies('(hover: none)', TOUCH)).toBe(false)
  expect(queryApplies('(orientation: landscape)', TOUCH)).toBe(false)
})

test('a nested @media counts only when its parent applies too, and only once', () => {
  const css = '@media (max-width: 1024px) { .a { x: 1; } @media (pointer: coarse) { .b { y: 2; } } }'
  const onTouch = mediaBodiesOn(css, { width: 820, pointer: 'coarse' })
  expect(onTouch.match(/\.b \{/g)).toHaveLength(1)
  expect(onTouch.match(/\.a \{/g)).toHaveLength(1)
  // parent applies, child does not: the child's rule is NOT in the parent's body
  const onMouse = mediaBodiesOn(css, { width: 820, pointer: 'fine' })
  expect(onMouse).toMatch(/\.a \{/)
  expect(onMouse).not.toMatch(/\.b \{/)
  // parent does not apply: neither
  expect(mediaBodiesOn(css, { width: 1300, pointer: 'coarse' })).toBe('')
})
