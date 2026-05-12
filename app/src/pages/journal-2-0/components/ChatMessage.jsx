/**
 * Per-role message renderer.
 *
 * Props:
 *   message: { id, role, content, tool_calls?, tool_results?, metadata? }
 *   toolResults?: object   // { [tool_call_id]: {tool_call_id, result} }
 *   toolSummaries?: object // { [tool_call_id]: string }
 */
import { renderMarkdown } from '../lib/coachMarkdown'
import ChatToolChip from './ChatToolChip'

export default function ChatMessage({ message, toolResults = {}, toolSummaries = {} }) {
  const role = message.role
  if (role === 'tool') return null   // tool rows render inside the assistant message via chips
  if (role === 'summary') {
    return (
      <div style={{
        margin: '10px 0', padding: '8px 14px', fontSize: 12, fontStyle: 'italic',
        background: 'rgba(255,255,255,0.03)', borderLeft: '3px solid var(--border)',
        color: 'var(--text-muted)',
      }}>
        Compass's memory of earlier: {message.content}
      </div>
    )
  }

  const alignment = role === 'user' ? 'flex-end' : 'flex-start'
  const bg = role === 'user' ? 'rgba(255,255,255,0.04)' : 'rgba(201,168,76,0.05)'
  const flagged = message.metadata?.audit_passed === false
  return (
    <div style={{ display: 'flex', justifyContent: alignment, margin: '8px 0' }}>
      <div style={{
        maxWidth: '80%',
        padding: '10px 14px',
        background: bg,
        border: `1px solid ${role === 'user' ? 'var(--border)' : 'rgba(201,168,76,0.3)'}`,
        borderRadius: 8,
        lineHeight: 1.55,
        fontSize: 13,
      }}>
        {role === 'assistant' && (
          <div style={{ fontSize: 10, color: 'var(--ut-gold, #c9a84c)', marginBottom: 4 }}>
            🧭 Compass {flagged && <span title="Some claims unverified" style={{ color: 'var(--loss, #ef4444)' }}>⚠</span>}
          </div>
        )}
        {message.content && (
          <div>{renderMarkdown(message.content)}</div>
        )}
        {Array.isArray(message.tool_calls) && message.tool_calls.length > 0 && (
          <div style={{ marginTop: 6 }}>
            {message.tool_calls.map((tc) => (
              <ChatToolChip
                key={tc.id}
                toolCall={tc}
                toolResult={toolResults[tc.id]}
                summary={toolSummaries[tc.id]}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
