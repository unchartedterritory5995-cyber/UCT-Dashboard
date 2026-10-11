// Wave 14 lane W14-A (plan 4.1, default D1): what the first-run welcome says the Notebook
// can do, as DATA -- one plain line per capability, each tied to the capability's OWN flag.
//
// ⛔ A line shows only while its flag is armed for this member (`notebookFlag(flag) === true`,
// the latched answer of lib/offline/notebookFlags.js). The welcome never promises a feature
// that is still dark, and it never names one in hidden text either.
// ⛔ Static text only. Nothing here fetches, renders a member's data, or calls a model
// (risk R6): a member who has written nothing has spent nothing.
// ⛔ Every `flag` must be a key of FLAG_FALLBACKS that falls back to OFF; capabilityList
// .test.js holds the list to that, so a typo cannot hide a line for ever.
//
// Order is a trader's order: the trade loop first (plan, chart, grade, review), then the
// research doors. Copy is written for traders: short, plain, no em dashes.
import { notebookFlag } from '../../../lib/offline/notebookFlags'
import { SAMPLE_COPY } from './sampleNotebook'
// The voice-note gate's ONE flag name lives with the door it opens.
import { VOICE_NOTE_FLAG } from '../../../lib/voiceNote'

export const CAPABILITY_PREVIEW = Object.freeze([
  {
    id: 'chart-plan',
    flag: 'notebook_chart_plan_enabled',
    label: 'Chart plans',
    line: 'Draw entry, stop and target on a chart in a note. It works out your size and can alert you at those levels.',
  },
  {
    id: 'plan-grading',
    flag: 'notebook_plan_grading_enabled',
    label: 'Plan versus execution',
    line: 'Every closed trade is checked against your plan: entry, stop, size and target.',
  },
  {
    id: 'entry-context',
    flag: 'notebook_entry_context_enabled',
    label: 'Entry context',
    line: 'The market at the moment you filled, saved with the trade: regime, days to earnings, RS rank.',
  },
  {
    id: 'review-drafts',
    flag: 'notebook_review_drafts_enabled',
    label: 'Reviews that write themselves',
    line: 'One click drafts your daily, weekly or monthly review from your own trades.',
  },
  {
    id: 'playbook',
    flag: 'notebook_playbook_enabled',
    label: 'My Playbook',
    line: 'Your setups side by side, each with how it has actually worked for you.',
  },
  {
    id: 'setups-board',
    flag: 'notebook_setups_board_enabled',
    label: 'Active setups board',
    line: 'Every setup you are watching on one board, sorted by how close it is to your entry.',
  },
  {
    id: 'earnings-prep',
    flag: 'notebook_earnings_prep_enabled',
    label: 'Reporting soon',
    line: 'Names you follow that report in the next week, with a prep note one click away.',
  },
  {
    id: 'passed-setups',
    flag: 'notebook_passed_setups_enabled',
    label: 'Passed setups',
    line: 'The trades you chose not to take, scored later against what the stock did.',
  },
  {
    id: 'writing-help',
    flag: 'notebook_writing_help_enabled',
    label: 'Writing help',
    line: 'Ask for a tighter or shorter version of what you wrote. Nothing changes until you accept it.',
  },
  {
    id: 'voice-notes',
    flag: VOICE_NOTE_FLAG,
    label: 'Voice notes',
    line: 'Record or upload a voice memo, or pick a Desk session. You get a transcript, and a short summary when one can be made.',
  },
  // Task 14b (ruling R16): the last two live features with no door in the Notebook. Both lines are
  // held to what the code does (capabilityList.test.js pins them word for word).
  //   * TERM-056 (lib/terminalCommandPaste.js, lib/linkClickOpen.js): a pasted line that is
  //     unmistakably a Terminal command (a function code and a ticker, a board or saved-item
  //     address) becomes a link to /terminal?cmd=...; in the editor it opens on Ctrl or Cmd+click.
  //   * Compass's `search_my_notes` tool (api/services/journal_two/coach_chat_tools.py): TEXT chat
  //     only (the voice registration is deliberately not built), so the line says "in chat".
  //     Compass is a primary item of the Journal's navigation (JournalLayout PRIMARY_NAV).
  {
    id: 'terminal-links',
    flag: 'notebook_terminal_links_enabled',
    label: 'Terminal commands in notes',
    line: 'Paste a Terminal command such as NVDA GRADE into a note. It becomes a link, and Ctrl or Cmd+click opens the Terminal.',
  },
  {
    id: 'compass-notes',
    flag: 'compass_notes_tool_enabled',
    label: 'Compass can read your notes',
    line: 'Ask Compass in chat about something you wrote and it searches your notes. Find Compass in the Journal navigation.',
  },
])

export const PREVIEW_COPY = Object.freeze({
  heading: 'What your Notebook can do',
  sampleLead: 'Want to try it first?',
  // ⛔ The sample button's label has ONE authority (SAMPLE_COPY.add); the promotion names it.
  sampleButton: SAMPLE_COPY.add,
  // ⛔ Truthful about what the click adds (wave 14 integration round 2): example notes in their
  // own folder, one example passed setup and one example notice, and NO trade -- a sample trade
  // would land in the member's P&L and stats. tests/test_sample_notebook_trade_exclusion.py
  // reads this line.
  sampleTail: 'puts example notes in their own folder, plus one example passed setup and one example notice. It adds no trades. You can remove it all in one click.',
})

/** The lines armed for this member, in list order. `flag` is injectable for rails only. */
export function armedCapabilities(flag = notebookFlag) {
  return CAPABILITY_PREVIEW.filter((c) => flag(c.flag) === true)
}
