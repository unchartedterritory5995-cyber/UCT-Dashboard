// ── PENDING TASK CONTINUITY (hotfix 2026-11-13) ─────────────────────────────────────────────────────────────────────────
//
// Live: "Change my chart layout to a 2-by-2 grid, keeping SPY and NVDA" → the Agent (the model) asked which two tickers to
// add → "Add AAPL and MSFT as the other two charts" was read as a NEW request (useAgent.isNewRequest: an action verb + its own
// tickers the question never offered), the question was set aside, and the instant path ran the reply ALONE (chartGrid.set
// re-symbolling both kept charts). A reply to the Agent's OWN open question must continue the pending task.
//
// WHERE THE PENDING STATE LIVES (useAgent, this chat only, never stored):
//   askedForRef        the member's words the model's open question is about (set on a model `clarify`; the original
//                      request, plus any earlier answer that led to another question)
//   lastQuestionRef    the question item shown (its text and choices; `at` = when it was asked)
//   askedGroupsRef     the routing groups the question was asked with (legacy routed request)
//   pendingQuestionRef NL-1: the question sent back to the model as pending_question
// HOW IT IS ATTACHED TO THE NEXT TURN: send() reads it once (askedForRef is cleared at the start of every send). An ANSWER
//   keeps it: the message goes to the MODEL — never through the instant readers — with the conversation that holds the
//   question, the question's groups, and (railWordsRef) the original request's words for the chart rail.
// WHAT CLEARS IT: an answer (consumed by that turn; the model may ask again), a NEW unrelated request (set aside: the
//   question is withdrawn and the model is told — LT-5 / LT-6), Cancel / never mind, and age (QUESTION_TTL_MS: an older
//   question is withdrawn; the reply is then read on its own — and the chart rail still guards it).
//
// replyRelation(text, question, askedFor) → 'answer' | 'new' | 'unclear'
//   answer   isNewRequest says it is not a request of its own; or it points back at the pending task ("the other two",
//            "the rest", "as well"…); or the question asked for tickers and the reply gives only tickers
//   unclear  a request of its own form, but the pending task is about the BOARD'S CHARTS (a grid / layout / chart count)
//            and the reply names tickers — it could fill that task or replace charts: ASKED again, never run alone
//   new      anything else isNewRequest reads as a complete request of its own (set aside, as before)
import { tickersIn } from './multiChart'

export const QUESTION_TTL_MS = 10 * 60 * 1000
// points back at the task the question is about
const CONTINUES = /\b(?:the other(?:s| ones?| (?:two|three|four|five|\d))?|other (?:two|three|four|five|\d)|the rest|remaining|as well|too|also|in addition|additional|extra|for (?:the|that|this) (?:grid|layout|board|request)|to (?:fill|finish|complete) (?:it|the (?:grid|layout|board)))\b/i
// the question asks the member for tickers / symbols
const ASKS_TICKERS = /\b(?:which|what)\b[^?]*\b(?:tickers?|symbols?|stocks?|names|charts?)\b|\b(?:tickers?|symbols?)\b[^?]*\?/i
// a tool / indicator the reply brings of its own (then it is not "only tickers")
const OWN_TOOL = /\b(?:trend ?lines?|avwap|vwap|fib\w*|rays?|rectangles?|alerts?|watch ?lists?|screens?|scans?|rsi|macd|bollinger|ema|sma|moving averages?|indicators?|drawings?)\b/i
// the pending task is about the board's charts
const BOARD_TASK = /\b(?:grid|layout|board|workspace|panels?|quad|side[\s-]by[\s-]side|stacked|\d\s*(?:x|×|by|-by-)\s*\d|(?:two|three|four|five|six|\d)\s+charts?|charts? (?:for|of))\b/i

export function replyRelation(text, question, askedFor, isNewRequest) {
  const t = String(text || '').trim()
  if (!t) return 'answer'
  if (!isNewRequest(t, question)) return 'answer'
  if (!askedFor) return 'new'                                      // a LOCAL question: the existing rule, unchanged
  if (CONTINUES.test(t)) return 'answer'
  const syms = tickersIn(t)
  if (syms.length && ASKS_TICKERS.test(String(question?.text || '')) && !OWN_TOOL.test(t)) return 'answer'
  if (syms.length && BOARD_TASK.test(String(askedFor)) && !OWN_TOOL.test(t)) return 'unclear'
  return 'new'
}

export const CONTINUE_CHOICES = [
  { ref: 'pending:continue', label: 'Yes — use it to finish that request' },
  { ref: 'pending:new', label: 'No — it’s a new request' },
]
export const continueQuestion = (askedFor) => {
  const req = String(askedFor || '').trim().replace(/\s+/g, ' ')
  const short = req.length > 90 ? `${req.slice(0, 87)}…` : req
  return `Is that your answer to my question about “${short}”? Nothing has changed yet.`
}
