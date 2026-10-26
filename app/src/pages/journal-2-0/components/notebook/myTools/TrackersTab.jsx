import ToolsTab from './ToolsTab'

/** My tools, the Trackers tab (spec 5.8, Task 9.18): the member's trackers, the two check-in trackers first and
 *  read-only, through the one tool list (ToolsTab). Wave 11 (Task 11.19): the credit line, "Share to library" (never
 *  on a check-in tracker) and "Update from the library" are ToolsTab's, shared with the Routines tab. */
export default function TrackersTab(props) {
  return <ToolsTab {...props} kind="tracker" />
}
