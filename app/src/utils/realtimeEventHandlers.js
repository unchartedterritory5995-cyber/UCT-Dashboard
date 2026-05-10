/**
 * Pure parsers for OpenAI Realtime data-channel events.
 *
 * Returns one of:
 *  { kind: 'session_created', session: {...} }
 *  { kind: 'user_transcript', text: string }
 *  { kind: 'assistant_transcript_delta', delta: string }
 *  { kind: 'assistant_transcript_done', text: string }
 *  { kind: 'function_call', call_id, name, arguments_json }
 *  { kind: 'error', message: string }
 *  { kind: 'unknown' }
 *
 * Other events (audio chunks, tool-call deltas) are intentionally ignored.
 */

export function parseRealtimeEvent(raw) {
  let evt
  try {
    evt = typeof raw === 'string' ? JSON.parse(raw) : raw
  } catch {
    return { kind: 'unknown' }
  }
  const t = evt?.type
  if (!t) return { kind: 'unknown' }

  switch (t) {
    case 'session.created':
      return { kind: 'session_created', session: evt.session }

    case 'conversation.item.input_audio_transcription.completed':
      return { kind: 'user_transcript', text: (evt.transcript || '').trim() }

    case 'response.audio_transcript.delta':
      return { kind: 'assistant_transcript_delta', delta: evt.delta || '' }

    case 'response.audio_transcript.done':
      return { kind: 'assistant_transcript_done', text: (evt.transcript || '').trim() }

    case 'response.function_call_arguments.done':
      return {
        kind: 'function_call',
        call_id: evt.call_id,
        name: evt.name,
        arguments_json: evt.arguments || '{}',
      }

    case 'error':
      return { kind: 'error', message: evt.error?.message || 'realtime error' }

    default:
      return { kind: 'unknown' }
  }
}


/**
 * Build the data-channel message that delivers a tool result back to the model.
 */
export function functionCallOutputEvent({ call_id, output }) {
  return {
    type: 'conversation.item.create',
    item: {
      type: 'function_call_output',
      call_id,
      output: JSON.stringify(output),
    },
  }
}


/**
 * Asks the model to continue speaking after a function output (or proactively).
 */
export function responseCreateEvent() {
  return { type: 'response.create' }
}
