// The read-aloud plans: what to fetch, and how to turn it into the text that
// gets spoken, for each kind of content the voice assistant can read out.
//
// This module imports nothing, on purpose. `useRealtimeSession` is the only
// caller in the app, but the request-shape rail runs these plans in plain Node
// against the real server routes, and it can only do that if loading the file
// does not pull in React.

function stripHtml(html) {
  if (!html) return ''
  const tmp = document.createElement('div')
  tmp.innerHTML = html
  return (tmp.textContent || tmp.innerText || '').trim()
}

// Map a normalized content key (from voice_client_action_tools) to a
// fetch-and-narrate plan. Each entry returns { trackId, label, textProvider }.
//
// `sessionId` is the live voice session's id. The two briefings are voice
// TOOLS, so their text comes from the tool door (`POST /api/voice/exec`), which
// answers `{ ok, tool, result: { narration, sections } }` for a session the
// member owns. A plan is only ever built from inside a live session (the
// model's `read_aloud` call), so the id is there; without one a briefing reads
// nothing rather than sending a request the door must refuse.
export function buildReadAloudPlan(contentKey, { sessionId = null } = {}) {
  const key = (contentKey || '').toLowerCase()

  // Morning Wire (rundown HTML)
  if (key.includes('wire') || key.includes('rundown') || key === 'morning wire') {
    return {
      trackId: 'voice-morning-wire',
      label: 'Morning Wire',
      textProvider: async () => {
        const r = await fetch('/api/rundown', { credentials: 'include' })
        if (!r.ok) return ''
        const data = await r.json()
        return stripHtml(data.html || data.rundown_html || '')
      },
    }
  }

  // UCT 20 picks
  if (key.includes('uct') || key.includes('leadership') || key.includes('picks')) {
    return {
      trackId: 'voice-uct20-picks',
      label: 'UCT 20 Picks',
      textProvider: async () => {
        const r = await fetch('/api/leadership', { credentials: 'include' })
        if (!r.ok) return ''
        const rows = await r.json()
        if (!Array.isArray(rows) || rows.length === 0) {
          return "There are no UCT 20 picks loaded right now."
        }
        const parts = rows.slice(0, 10).map((p, i) =>
          `${i + 1}. ${p.sym || p.symbol || '?'} — ${p.company || p.name || ''}. ${p.thesis || ''}`.trim()
        )
        return parts.join('. ')
      },
    }
  }

  // Daily note (today)
  if (key.includes('daily note') || key.includes("today's note") || key === 'my note') {
    return {
      trackId: 'voice-daily-note',
      label: "Today's Daily Note",
      textProvider: async () => {
        const today = new Date().toISOString().slice(0, 10)
        const r = await fetch(`/api/journal/daily/${today}`, { credentials: 'include' })
        if (!r.ok) return ''
        const d = await r.json()
        const fields = [
          ['Premarket thesis', d.premarket_thesis],
          ['Focus list', d.focus_list],
          ['Risk plan', d.risk_plan],
          ['Emotional state', d.emotional_state],
          ['Midday notes', d.midday_notes],
          ['EOD recap', d.eod_recap],
          ['What I did well', d.did_well],
          ['What I did poorly', d.did_poorly],
          ['Learned', d.learned],
          ['Tomorrow focus', d.tomorrow_focus],
        ].filter(([, v]) => v && String(v).trim())
        if (fields.length === 0) return "Your daily note is empty for today."
        return fields.map(([l, v]) => `${l}: ${v}.`).join(' ')
      },
    }
  }

  // Weekly review
  if (key.includes('weekly') || key.includes('week recap')) {
    return {
      trackId: 'voice-weekly-review',
      label: 'Weekly Review',
      textProvider: async () => {
        const today = new Date()
        const day = today.getDay()
        const monday = new Date(today)
        monday.setDate(today.getDate() - ((day + 6) % 7))
        const weekStart = monday.toISOString().slice(0, 10)
        const r = await fetch(`/api/journal/weekly/${weekStart}`, { credentials: 'include' })
        if (!r.ok) return ''
        const d = await r.json()
        const parts = [
          d.reflection, d.key_lessons, d.next_week_focus,
        ].filter(v => v && String(v).trim())
        return parts.length ? parts.join('. ') : "Your weekly review is empty."
      },
    }
  }

  // Morning briefing / closing briefing: run the voice briefing tool and narrate
  // its result. These asked `POST /api/voice/oneshot` for it until 2026-10-06,
  // with a JSON `{transcript}` body. That door takes a microphone recording as a
  // multipart form and answers with an MP3 stream, so every request was a 422
  // and the briefing never played. `tests/test_voice_client_request_shapes.py`
  // holds every request built in this app against the route it is sent to.
  if (key.includes('morning brief') || key.includes('brief me')) {
    return {
      trackId: 'voice-morning-brief',
      label: 'Morning Briefing',
      textProvider: async () => {
        if (!sessionId) return ''
        const r = await fetch('/api/voice/exec', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ session_id: sessionId, tool: 'morning_briefing', args: {} }),
        })
        if (!r.ok) return ''
        const j = await r.json()
        return j?.result?.narration || ''
      },
    }
  }
  if (key.includes('closing brief') || key.includes('eod recap') || key.includes('closing recap')) {
    return {
      trackId: 'voice-closing-brief',
      label: 'Closing Briefing',
      textProvider: async () => {
        if (!sessionId) return ''
        const r = await fetch('/api/voice/exec', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ session_id: sessionId, tool: 'closing_briefing', args: {} }),
        })
        if (!r.ok) return ''
        const j = await r.json()
        return j?.result?.narration || ''
      },
    }
  }

  return null
}
