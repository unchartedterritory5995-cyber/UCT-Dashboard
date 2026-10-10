// @vitest-environment jsdom
/* FT-032: alerts on the long/short POSITION drawing.
 *
 * A position is three horizontal levels stored as points `[entry, stop, target]`.
 * Each alert on it is an ordinary bound `line` alert whose bound id carries the
 * point index (`<id>#1` is the stop), the same seam a Fib level uses, so the
 * existing resync (useBoundDrawingAlerts) moves it when the level is dragged and
 * deletes it when the drawing is deleted. These tests pin each link of that path.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import {
  alertKindFor, anchorsForDrawing, boundIdFor, parseBoundId, geometrySignature,
  POSITION_LEVELS, positionSide, positionLevelDirection,
} from './drawingAlertAnchors'
import { sectionsFor } from './drawingSettingsSchema'
import { DrawingContextMenu } from './ChartDrawingOverlay'

const LONG = { id: 'p1', type: 'position', color: '#c9a84c', points: [{ price: 100 }, { price: 95 }, { price: 115 }] }
const SHORT = { id: 'p2', type: 'position', color: '#c9a84c', points: [{ price: 100 }, { price: 106 }, { price: 88 }] }
const BAD = { id: 'p3', type: 'position', color: '#c9a84c', points: [{ price: 100 }, { price: 105 }, { price: 110 }] }

describe('FT-032: alertKindFor + anchors', () => {
  it('a position carries line alerts', () => {
    expect(alertKindFor('position')).toBe('line')
  })

  it('each level resolves to its own stored price', () => {
    expect(anchorsForDrawing(LONG, { level: 0 })).toEqual({ alert_type: 'line', target_price: 100 })
    expect(anchorsForDrawing(LONG, { level: 1 })).toEqual({ alert_type: 'line', target_price: 95 })
    expect(anchorsForDrawing(LONG, { level: 2 })).toEqual({ alert_type: 'line', target_price: 115 })
  })

  it('no level (or an unknown one) is no alert, never a guessed level', () => {
    expect(anchorsForDrawing(LONG, {})).toBeNull()
    expect(anchorsForDrawing(LONG, { level: 3 })).toBeNull()
    expect(anchorsForDrawing({ ...LONG, points: [{ price: 100 }] }, { level: 2 })).toBeNull()
  })

  it('the level survives the bound id round trip, and a drag changes the signature', () => {
    const id = boundIdFor(LONG.id, 1)
    expect(id).toBe('p1#1')
    expect(parseBoundId(id)).toEqual({ drawingId: 'p1', level: 1 })
    const before = geometrySignature(anchorsForDrawing(LONG, { level: 1 }))
    const dragged = { ...LONG, points: [LONG.points[0], { price: 96.5 }, LONG.points[2]] }
    const after = geometrySignature(anchorsForDrawing(dragged, { level: 1 }))
    expect(after).not.toBe(before)
    // The other two levels did not move, so their alerts are not re-pushed.
    expect(geometrySignature(anchorsForDrawing(dragged, { level: 2 })))
      .toBe(geometrySignature(anchorsForDrawing(LONG, { level: 2 })))
  })
})

describe('FT-032: side and direction', () => {
  it('long, short, invalid', () => {
    expect(positionSide(LONG)).toBe('long')
    expect(positionSide(SHORT)).toBe('short')
    expect(positionSide(BAD)).toBeNull()
  })

  it('stop is the loss side and target the profit side', () => {
    expect(positionLevelDirection(LONG, 1)).toBe('below')
    expect(positionLevelDirection(LONG, 2)).toBe('above')
    expect(positionLevelDirection(SHORT, 1)).toBe('above')
    expect(positionLevelDirection(SHORT, 2)).toBe('below')
  })

  it('entry points toward the level from the last price', () => {
    expect(positionLevelDirection(LONG, 0, 104)).toBe('below')
    expect(positionLevelDirection(LONG, 0, 97)).toBe('above')
    // No last price: a long enters on strength, a short on weakness.
    expect(positionLevelDirection(LONG, 0)).toBe('above')
    expect(positionLevelDirection(SHORT, 0)).toBe('below')
  })

  it('an invalid position has no direction', () => {
    expect(positionLevelDirection(BAD, 1)).toBeNull()
    expect(positionLevelDirection(LONG, null)).toBeNull()
  })
})

describe('FT-032: the menu offers it', () => {
  const ids = (drawing, handlers) => sectionsFor({ drawing, points: drawing.points, handlers })
    .flatMap((s) => s.items.map((i) => i.id))
  const H = { onDelete: () => {}, onToggleLock: () => {}, onToggleHide: () => {} }

  it('only with a level-alert handler and a valid side', () => {
    expect(ids(LONG, { ...H, onSetLevelAlert: () => {} })).toContain('positionAlerts')
    expect(ids(LONG, H)).not.toContain('positionAlerts')
    expect(ids(BAD, { ...H, onSetLevelAlert: () => {} })).not.toContain('positionAlerts')
  })

  it('the retirement holds: still no Duplicate or Save as default', () => {
    const got = ids(LONG, { ...H, onSetLevelAlert: () => {}, onDuplicate: () => {}, onSaveDefaults: () => {} })
    expect(got).not.toContain('duplicate')
    expect(got).not.toContain('saveDefault')
  })
})

describe('FT-032: the rendered menu sends the right alerts', () => {
  afterEach(cleanup)
  const openMenu = (drawing, levelAlerts = null) => {
    const onSetLevelAlert = vi.fn()
    render(
      <DrawingContextMenu x={10} y={10} drawing={drawing} onClose={() => {}}
        onDelete={() => {}} onSetLevelAlert={onSetLevelAlert} levelAlerts={levelAlerts} />,
    )
    return onSetLevelAlert
  }

  it('each bell sends its level and its side', () => {
    const fn = openMenu(LONG)
    fireEvent.click(screen.getByRole('button', { name: 'Alert on stop' }))
    expect(fn).toHaveBeenLastCalledWith(1, 'below')
    fireEvent.click(screen.getByRole('button', { name: 'Alert on target' }))
    expect(fn).toHaveBeenLastCalledWith(2, 'above')
    fireEvent.click(screen.getByRole('button', { name: 'Alert on entry' }))
    expect(fn).toHaveBeenLastCalledWith(0, 'above')
  })

  it('All three sets every level that has no alert yet', () => {
    const fn = openMenu(SHORT, new Set(['1']))
    expect(screen.getByRole('button', { name: 'Alert on stop' }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: 'All three' }))
    expect(fn.mock.calls).toEqual([[0, 'below'], [2, 'below']])
  })

  it('names the three levels in order', () => {
    openMenu(LONG)
    expect(POSITION_LEVELS.map((l) => l.label)).toEqual(['Entry', 'Stop', 'Target'])
    expect(screen.getByText('Alerts (long)')).toBeTruthy()
  })
})
