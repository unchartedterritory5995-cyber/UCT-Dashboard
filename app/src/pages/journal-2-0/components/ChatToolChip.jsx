/**
 * Compact tool-call chip. Click to expand args + result JSON.
 *
 * Props:
 *   toolCall: { id, name, args, status }
 *   toolResult?: { tool_call_id, result }
 *   summary?: string   // optional 1-line summary for display
 */
import { useState } from 'react'
import UIcon from '../../../components/ui/UIcon'

const TOOL_ICONS = {
  list_recent_trades: 'search', get_aggregates: 'breadth', get_open_positions: 'equity',
  get_trader_profile: 'user', get_recent_recaps: 'document', get_account_settings: 'gear',
  get_setup_stats: 'patterns', find_arcs: 'refresh',
  analyze_time_of_day: 'clock', analyze_day_of_week: 'calendar',
  analyze_hold_duration: 'clock', analyze_sequence: 'refresh',
  analyze_sizing_curve: 'ruler', analyze_correlation: 'link', compare_setups: 'scale',
  tag_trade: 'tag', set_weekly_focus: 'compass', mute_setup: 'volumeOff', unmute_setup: 'volume',
  set_a_plus_setups: 'star', update_discipline_setting: 'shield',
  schedule_paper_only_day: 'edit',
}

export default function ChatToolChip({ toolCall, toolResult, summary }) {
  const [open, setOpen] = useState(false)
  const icon = TOOL_ICONS[toolCall.name] || 'wrench'
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
        <UIcon name={icon} size={12} style={{ verticalAlign: '-1px', marginRight: 4 }} />{label}
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
