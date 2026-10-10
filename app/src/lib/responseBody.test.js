import { describe, it, expect } from 'vitest'
import { failureDetail, readSuccessBody } from './responseBody'

const res = (json) => ({ json: async () => (typeof json === 'function' ? json() : json) })
const broken = { json: async () => { throw new SyntaxError('Unexpected token <') } }

describe('failureDetail (TERM-033)', () => {
  it('returns the server sentence', async () => {
    expect(await failureDetail(res({ detail: 'capped at 3' }))).toBe('capped at 3')
  })
  it('an unreadable body is "no explanation", never data', async () => {
    expect(await failureDetail(broken)).toBeNull()
    expect(await failureDetail(undefined)).toBeNull()
  })
  it('a non-string detail is not a sentence', async () => {
    expect(await failureDetail(res({ detail: [{ msg: 'x' }] }))).toBeNull()
    expect(await failureDetail(res({ detail: '' }))).toBeNull()
    expect(await failureDetail(res({}))).toBeNull()
  })
})

describe('readSuccessBody (TERM-033)', () => {
  it('tags a readable body', async () => {
    expect(await readSuccessBody(res({ id: 7 }))).toEqual({ ok: true, body: { id: 7 } })
  })
  it('tags an unreadable body as a failure, carrying the error', async () => {
    const out = await readSuccessBody(broken)
    expect(out.ok).toBe(false)
    expect(out.error).toBeInstanceOf(SyntaxError)
  })
})
