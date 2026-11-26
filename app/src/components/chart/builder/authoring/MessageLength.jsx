// ⭐ 2026-11-25 -- the composer's count of a message against the server's limit (`converseClient.messageLengthNote`).
// Shown from 80% of the limit; over it, an alert. It shortens nothing: the message is sent whole and the server says
// why it is refused.
import React from 'react'
import { messageLengthNote } from './converseClient'

export default function MessageLength({ message, testId = 'message-length', className, style }) {
  const note = messageLengthNote(message)
  if (!note) return null
  return (
    <p className={className} data-testid={testId} data-over={note.over ? 'true' : 'false'}
      role={note.over ? 'alert' : undefined} aria-live="polite"
      style={{ margin: '4px 0 0', fontSize: 11.5,
        color: note.over ? 'var(--color-danger, #f0525a)' : 'var(--menu-text-faint, #93939a)', ...style }}>
      {note.text}
    </p>
  )
}
