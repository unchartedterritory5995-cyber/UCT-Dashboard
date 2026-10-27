// Notebook widgets phase 2, wave 11 (Task 11.14): the eager names of a style's blocks. The six wave 10 kinds a
// template may hold are named by the server's KIND_TITLE (railed on the server side by
// tests/test_journal_styles_store.py and tests/test_journal_styles_compose.py, which read this file), and a template
// slot id is named by its family.
import { describe, it, expect } from 'vitest'
import { SNAPSHOT_BLOCK_LABELS, blockLabel } from './journalBlocks'

describe('blockLabel', () => {
  it('family_ids_label_and_six_new_slot_labels', () => {
    expect(SNAPSHOT_BLOCK_LABELS).toMatchObject({
      myRiskLeftToday: 'Risk left today',
      myGamePlan: 'Pre-market game plan',
      myTiltCheck: 'Tilt check',
      myRevengeClean: 'Revenge trades',
      myPropFirm: 'Prop-firm rules',
      myAlertsFired: 'Alerts that fired',
    })
    expect(Object.keys(SNAPSHOT_BLOCK_LABELS)).toHaveLength(12)
    for (const [id, label] of Object.entries(SNAPSHOT_BLOCK_LABELS)) expect(blockLabel(id)).toBe(label)

    expect(blockLabel('built_a')).toBe('Widget')
    expect(blockLabel('built_7z')).toBe('Widget')
    expect(blockLabel('routine_1')).toBe('Routine')
    expect(blockLabel('tracker_ab')).toBe('Tracker')
    // The grammar's edges: 1-2 lowercase letters or digits, nothing else, and only the three families.
    for (const id of ['built_', 'built_abc', 'built_A', 'built-a', 'routine_a_', 'tracker_a ', 'widget_a', 'xbuilt_a']) {
      expect(blockLabel(id)).toBe(`A block from a newer version (${id})`)
    }
    // Controls: the catalog, the tool blocks and an unknown id keep their answers.
    expect(blockLabel('chart')).toBe('Chart of the note’s ticker')
    expect(blockLabel('routine')).toBe('Routine')
    expect(blockLabel('myPnlStats')).toBe('My P&L and stats')
    expect(blockLabel('zzNew')).toBe('A block from a newer version (zzNew)')
  })
})
