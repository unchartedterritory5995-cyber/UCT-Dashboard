// app/src/pages/screener/shell/scanErrorText.js
//
// Its own module (not useScreenerScan.js) because the shell's tests mock that hook's module
// wholesale, and a named export from a mocked module is undefined.
/** The scan failure in plain words, from its HTTP status. The server's own detail (a raw
 *  ValueError, or FastAPI's validation array) is never shown to a member. */
export function scanErrorText(error) {
  const s = error?.status
  if (s === 400 || s === 422) return "This scan couldn't run as set. One of the filters can't be applied. Remove the last chip you added, or Reset."
  if (s === 401 || s === 403) return 'Sign in again to run scans.'
  if (s === 402) return 'Running scans requires a paid plan.'
  if (s === 429) return 'Too many scans at once. Wait a few seconds, then Retry.'
  return "The screener couldn't run this scan right now."
}
