import { describe, it, expect } from 'vitest'
import {
  toCsv,
  PRE_MATCHED_TEMPLATE_HEADERS,
} from './csvTemplates'

describe('toCsv', () => {
  it('simple headers + rows', () => {
    const out = toCsv(['a', 'b'], [['1', '2'], ['3', '4']])
    expect(out).toBe('a,b\n1,2\n3,4\n')
  })

  it('quotes cells with commas', () => {
    const out = toCsv(['note'], [['a, b, c']])
    expect(out).toBe('note\n"a, b, c"\n')
  })

  it('escapes double-quotes by doubling them', () => {
    const out = toCsv(['note'], [['she said "hi"']])
    expect(out).toBe('note\n"she said ""hi"""\n')
  })

  it('quotes cells with newlines', () => {
    const out = toCsv(['note'], [['line1\nline2']])
    expect(out).toBe('note\n"line1\nline2"\n')
  })

  it('empty cells become empty fields', () => {
    const out = toCsv(['a', 'b', 'c'], [['', '', '']])
    expect(out).toBe('a,b,c\n,,\n')
  })
})

describe('PRE_MATCHED_TEMPLATE_HEADERS', () => {
  it('includes all required pre-matched columns in order', () => {
    const required = ['symbol', 'side', 'shares', 'entry_price', 'entry_date',
                      'exit_price', 'exit_date']
    expect(PRE_MATCHED_TEMPLATE_HEADERS.slice(0, 7)).toEqual(required)
  })

  it('includes optional columns', () => {
    expect(PRE_MATCHED_TEMPLATE_HEADERS).toContain('setup')
    expect(PRE_MATCHED_TEMPLATE_HEADERS).toContain('notes')
    expect(PRE_MATCHED_TEMPLATE_HEADERS).toContain('original_stop')
  })
})
