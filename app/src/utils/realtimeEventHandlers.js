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

    // User speech transcript — same event name on both the beta and GA APIs.
    case 'conversation.item.input_audio_transcription.completed':
      return { kind: 'user_transcript', text: (evt.transcript || '').trim() }

    // Assistant spoken-response transcript. The GA Realtime API renamed these
    // with an `output_` prefix (beta: response.audio_transcript.* ). We accept
    // BOTH so the parser keeps working across the beta→GA migration and can't
    // silently break again on the next rename.
    case 'response.audio_transcript.delta':
    case 'response.output_audio_transcript.delta':
      return { kind: 'assistant_transcript_delta', delta: evt.delta || '' }

    case 'response.audio_transcript.done':
    case 'response.output_audio_transcript.done':
      return { kind: 'assistant_transcript_done', text: (evt.transcript || '').trim() }

    // Function (tool) call finished. Depending on API version the completed
    // call arrives either as `response.function_call_arguments.done` (carries
    // call_id/name/arguments directly) and/or as a finished output item on
    // `response.output_item.done` (item.type === 'function_call'). We recognize
    // both; the consumer de-dupes by call_id so handling both never double-fires.
    case 'response.function_call_arguments.done':
      return {
        kind: 'function_call',
        call_id: evt.call_id,
        name: evt.name,
        arguments_json: evt.arguments || '{}',
      }

    case 'response.output_item.done':
      if (evt.item?.type === 'function_call') {
        return {
          kind: 'function_call',
          call_id: evt.item.call_id,
          name: evt.item.name,
          arguments_json: evt.item.arguments || '{}',
        }
      }
      return { kind: 'unknown' }

    case 'error':
      return { kind: 'error', message: evt.error?.message || 'realtime error' }

    default:
      return { kind: 'unknown', type: t }
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
