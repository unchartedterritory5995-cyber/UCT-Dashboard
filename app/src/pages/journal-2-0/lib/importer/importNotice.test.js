import { describe, it, expect } from 'vitest'
import { NOTICE_REASONS as COPY_REASONS, MEDIA_RETRY_MAX_ATTEMPTS, importNoticeText } from '../importNoticeText'
import { NOTICE_REASONS, importNoticeNode, reasonForUploadFailure, noticeReasonFor } from './importNotice'

describe('importNotice (file importer)', () => {
  it('every reason the importer can write is in the pinned copy table (R2: one vocabulary)', () => {
    const fromStatus = [400, 413, 415, 429, 500, 507].map((s) => reasonForUploadFailure(s, null))
    const written = [...Object.values(NOTICE_REASONS), ...fromStatus].map(noticeReasonFor)
    for (const r of written) expect(COPY_REASONS).toContain(r)
  })

  it('a notice is final: attempts is the retry ceiling, so fetch_failed never promises a retry (R3)', () => {
    const n = importNoticeNode({ reason: 'fetch_failed', name: 'a.png', ref: 'r' })
    expect(n).toEqual({ type: 'importNotice', attrs: { reason: 'fetch_failed', name: 'a.png', sourceUrl: null, ref: 'r', attempts: MEDIA_RETRY_MAX_ATTEMPTS } })
    expect(importNoticeText(n.attrs)).not.toMatch(/retrying/)
  })

  it('a storage_limit from a door is written as storage_full; other reasons pass through', () => {
    expect(importNoticeNode({ reason: 'storage_limit' }).attrs.reason).toBe('storage_full')
    expect(importNoticeNode({ reason: 'unsafe' }).attrs.reason).toBe('unsafe')
    expect(importNoticeNode({}).attrs.reason).toBe('missing_resource')
  })

  it('reasonForUploadFailure: a server reason passes through unchanged, else the status decides', () => {
    expect(reasonForUploadFailure(400, { detail: 'x', reason: 'unsupported' })).toBe('unsupported')
    expect(reasonForUploadFailure(400, { reason: 'some_future_code' })).toBe('some_future_code')
    expect(reasonForUploadFailure(413, null)).toBe('too_large')
    expect(reasonForUploadFailure(400, { detail: 'MIME not allowed' })).toBe('type_refused')
    expect(reasonForUploadFailure(415, {})).toBe('type_refused')
    expect(reasonForUploadFailure(507, null)).toBe('storage_limit')
    expect(reasonForUploadFailure(500, null)).toBe('upload_failed')
    expect(reasonForUploadFailure(429, { reason: '' })).toBe('upload_failed')
  })
})
