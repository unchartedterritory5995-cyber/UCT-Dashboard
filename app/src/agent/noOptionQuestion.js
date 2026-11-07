// ── A QUESTION IS SOMETHING THE MEMBER CAN ANSWER ────────────────────────────────────────────────────────────
//
// ⛔ REAL-MODEL VERIFICATION 2026-11-05, Multi Chart, "add a news widget here": "Which one do you mean?" with no options and nothing
// to pick from. So a question reaches the panel only with its options:
//   • the server's "which one?" for a plan it could not place (turn.py `unplaced_actions`) is said as what it is: on the grid
//     the refusal that action gets by name (gridMode), elsewhere that nothing changed and what to say instead;
//   • any other question without options is the model asking for a detail, so it is said as a plain line that tells the
//     member to answer in their next message (useAgent `push`).
import { screenGridOps } from './gridMode'

const WHICH_ONE = 'Which one do you mean?'          // turn.py: the fixed sentence with nothing behind it
export const NO_TARGET = 'I didn’t change anything: I couldn’t tell which one you meant. Say it by name, like the chart’s ticker or the widget, and ask again.'

/** A clarify with no options and no real question → the sentence said instead; null when it is a real question. */
export function noOptionRefusal(env, host, choices) {
  if (choices.length || (env?.question?.text || env?.reply) !== WHICH_ONE) return null
  const planned = (Array.isArray(env.unplaced_actions) ? env.unplaced_actions : []).map(action => ({ action }))
  const named = host?.multiChart ? screenGridOps(planned, host)?.refuse : null
  return named ? `I didn’t change anything: ${named}` : NO_TARGET
}

/** A question with nothing to pick, as the plain line it really is. Authoring has its own buttons. */
export const withOptionsOrPlain = (item) => (item?.role === 'question' && !item.authoring && !item.choices?.length
  ? { ...item, role: 'agent', text: `${item.text} Tell me in your next message; nothing has changed yet.` }
  : item)
