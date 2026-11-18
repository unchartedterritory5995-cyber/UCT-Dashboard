/**
 * Import a tweet -- the flag check and the event name (dark behind `notebook_tweet_import_enabled`).
 *
 * ⛔ This module is on the Notebook's first open (SlashMenu reads both), so nothing else goes here:
 * the fetch calls and text helpers are `tweetImportHelpers.js`, loaded with the sheet and the card
 * (`docs/notebook/perf-budgets.json`).
 */
import { notebookFlag } from './offline/notebookFlags'

export const TWEET_IMPORT_FLAG = 'notebook_tweet_import_enabled'

/** The editor's "/tweet" and its toolbar button ask THIS editor's host to open the sheet --
 *  dispatched on the editor's own DOM root, never `window` (the I5 rule SlashMenu's events follow). */
export const TWEET_EVENT = 'uct-notebook:tweet-import'

// The app's own tweet kill switch, the rule MoversSidebar, TapeFeed, MorningWire and TwtPanel read:
// default on, "0" hides. Restated rather than imported from TwtPanel, because this module is on the
// Notebook's first open and that file would pull the terminal's panel code into the Notebook chunk.
const twitterUiEnabled = () => (import.meta.env.VITE_TWITTER_UI_ENABLED ?? '1') !== '0'

export function tweetImportEnabled() {
  return twitterUiEnabled() && notebookFlag(TWEET_IMPORT_FLAG) === true
}
