// app/src/components/chart/memberDefaultCopy.js
//
// ⭐ VA2 (UCT RS §17.8) — the words the "Save as my default" controls print, ONE
// copy for the desktop dialog and the phone sheet. The state is
// `engine/instanceControls.memberDefaultState`.

export const SAVE_DEFAULT_LABEL = 'Save as my default'
export const RESET_DEFAULT_LABEL = 'Reset to UCT default'

/** What a NEW copy of this indicator will start with, in one line. */
export function memberDefaultNote(state) {
  if (!state || !state.available) return ''
  if (state.saved && state.matches) return 'New copies of this indicator start with these settings.'
  if (state.saved) return 'New copies start with your saved default, not these settings.'
  return 'New copies start with UCT\'s settings.'
}

/** Would "Save as my default" change nothing? (These settings are already what a new copy gets.) */
export function saveDefaultIsNoop(state) {
  return !!state && state.matches && (state.saved || state.atUct)
}
