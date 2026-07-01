import { describe, it, expect } from 'vitest'
import {
  parseRealtimeEvent,
  functionCallOutputEvent,
  responseCreateEvent,
} from './realtimeEventHandlers'

describe('parseRealtimeEvent', () => {
  it('returns unknown for invalid input', () => {
    expect(parseRealtimeEvent('not-json').kind).toBe('unknown')
    expect(parseRealtimeEvent({}).kind).toBe('unknown')
  })

  it('parses session.created', () => {
    const out = parseRealtimeEvent({ type: 'session.created', session: { id: 'sess_1' } })
    expect(out.kind).toBe('session_created')
    expect(out.session.id).toBe('sess_1')
  })

  it('parses user transcription completed', () => {
    const out = parseRealtimeEvent({
      type: 'conversation.item.input_audio_transcription.completed',
      transcript: '  what is NVDA  ',
    })
    expect(out.kind).toBe('user_transcript')
    expect(out.text).toBe('what is NVDA')
  })

  it('parses assistant transcript delta and done', () => {
    expect(parseRealtimeEvent({ type: 'response.audio_transcript.delta', delta: 'NVDA' }))
      .toEqual({ kind: 'assistant_transcript_delta', delta: 'NVDA' })
    expect(parseRealtimeEvent({ type: 'response.audio_transcript.done', transcript: 'NVDA is at 487' }))
      .toEqual({ kind: 'assistant_transcript_done', text: 'NVDA is at 487' })
  })

  it('parses function_call', () => {
    const out = parseRealtimeEvent({
      type: 'response.function_call_arguments.done',
      call_id: 'call_42',
      name: 'get_quote',
      arguments: '{"symbol":"NVDA"}',
    })
    expect(out).toEqual({
      kind: 'function_call', call_id: 'call_42', name: 'get_quote', arguments_json: '{"symbol":"NVDA"}',
    })
  })

  it('parses error', () => {
    const out = parseRealtimeEvent({ type: 'error', error: { message: 'rate limit' } })
    expect(out).toEqual({ kind: 'error', message: 'rate limit' })
  })

  // --- GA (general-availability) Realtime API compatibility -----------------
  // The GA API renamed the assistant transcript events with an `output_`
  // prefix and can deliver a finished tool call as an output item. The parser
  // must accept BOTH the beta and GA shapes so the beta→GA migration (which
  // silently broke voice) can never recur.

  it('parses GA assistant transcript delta/done (output_ prefix)', () => {
    expect(parseRealtimeEvent({ type: 'response.output_audio_transcript.delta', delta: 'NVDA' }))
      .toEqual({ kind: 'assistant_transcript_delta', delta: 'NVDA' })
    expect(parseRealtimeEvent({ type: 'response.output_audio_transcript.done', transcript: 'NVDA is at 487' }))
      .toEqual({ kind: 'assistant_transcript_done', text: 'NVDA is at 487' })
  })

  it('parses a function_call delivered via response.output_item.done', () => {
    const out = parseRealtimeEvent({
      type: 'response.output_item.done',
      item: { type: 'function_call', call_id: 'call_7', name: 'get_breadth', arguments: '{}' },
    })
    expect(out).toEqual({
      kind: 'function_call', call_id: 'call_7', name: 'get_breadth', arguments_json: '{}',
    })
  })

  it('ignores a non-function output item', () => {
    expect(parseRealtimeEvent({
      type: 'response.output_item.done', item: { type: 'message', role: 'assistant' },
    }).kind).toBe('unknown')
  })

  it('returns the raw type on unknown events so they can be logged', () => {
    expect(parseRealtimeEvent({ type: 'response.output_audio.delta' }))
      .toEqual({ kind: 'unknown', type: 'response.output_audio.delta' })
  })
})

describe('functionCallOutputEvent', () => {
  it('returns conversation.item.create with stringified output', () => {
    const out = functionCallOutputEvent({ call_id: 'c1', output: { ok: true, last: 487 } })
    expect(out.type).toBe('conversation.item.create')
    expect(out.item.type).toBe('function_call_output')
    expect(out.item.call_id).toBe('c1')
    expect(JSON.parse(out.item.output).last).toBe(487)
  })
})

describe('responseCreateEvent', () => {
  it('returns response.create', () => {
    expect(responseCreateEvent()).toEqual({ type: 'response.create' })
  })
})
