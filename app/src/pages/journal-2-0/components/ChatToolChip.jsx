/**
 * Compact tool-call chip. Click to expand args + result JSON.
 *
 * Props:
 *   toolCall: { id, name, args, status }
 *   toolResult?: { tool_call_id, result }
 *   summary?: string   // optional 1-line summary for display
 */
import { useState } from 'react'

const TOOL_ICONS = {
  list_recent_trades: '🔍', get_aggregates: '📊', get_open_positions: '📈',
  get_trader_profile: '👤', get_recent_recaps: '📜', get_account_settings: '⚙',
  get_setup_stats: '🎯', find_arcs: '🌀',
  analyze_time_of_day: '⏰', analyze_day_of_week: '📅',
  analyze_hold_duration: '⏱', analyze_sequence: '🔁',
  analyze_sizing_curve: '📏', analyze_correlation: '🔗', compare_setups: '⚖',
  tag_trade: '🏷', set_weekly_focus: '🧭', mute_setup: '🔇', unmute_setup: '🔊',
  set_a_plus_setups: '⭐', update_discipline_setting: '🛡',
  schedule_paper_only_day: '📝',
}

export default function ChatToolChip({ toolCall, toolResult, summary }) {
  const [open, setOpen] = useState(false)
  const icon = TOOL_ICONS[toolCall.name] || '🔧'
  const label = summary || toolCall.name
  return (
    <div style={{ display: 'inline-block', margin: '4px 4px 4px 0' }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          fontSize: 11, padding: '3px 8px', borderRadius: 999,
          background: 'rgba(201,168,76,0.08)',
          border: '1px solid rgba(201,168,76,0.4)',
          color: 'var(--text-bright)', cursor: 'pointer',
        }}
      >
        {icon} {label}
      </button>
      {open && (
        <pre style={{
          marginTop: 4, padding: 8, fontSize: 10, lineHeight: 1.4,
          background: 'rgba(0,0,0,0.4)', border: '1px solid var(--border)',
          borderRadius: 6, maxWidth: 600, overflow: 'auto',
        }}>
          {JSON.stringify({ args: toolCall.args, result: toolResult?.result }, null, 2)}
        </pre>
      )}
    </div>
  )
}
