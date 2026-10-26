import ToolsTab from './ToolsTab'

/** My tools, the Trackers tab (spec 5.8, Task 9.18): the member's trackers, the two check-in trackers first and
 *  read-only, through the one tool list (ToolsTab). */
export default function TrackersTab(props) {
  return <ToolsTab {...props} kind="tracker" />
}
