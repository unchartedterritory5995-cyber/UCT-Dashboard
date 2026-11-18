// The Terminal as the router mounts it (App.jsx, `/terminal` and `/terminal/calendar`): the shell
// inside the ONE read of the member's watchlist names that every list's symbol cell marks from
// (components/terminal/WatchMarksProvider).
//
// ⛔ THIS FILE EXISTS FOR THE FIRST-OPEN BYTE BUDGET. The provider used to be mounted in
// TerminalRoutes.jsx, which is in the app's ENTRY chunk, and that put the watch-mark code on every
// page's first load (tools/notebook_perf_budgets.py: +403 B over the Notebook first-open budget).
// Mounted here it rides the Terminal's own lazy chunk, which only a member who opens the Terminal
// downloads. Do not move the import back into TerminalRoutes.jsx or App.jsx.
import TerminalShell from './TerminalShell'
import WatchMarksProvider from '../../components/terminal/WatchMarksProvider'

export default function TerminalShellRoute() {
  return (
    <WatchMarksProvider>
      <TerminalShell />
    </WatchMarksProvider>
  )
}
