import ToolsTab from './ToolsTab'

/** My tools, the Routines tab (spec 5.8, Task 9.18): the member's routines, through the one tool list (ToolsTab).
 *  Wave 11 (Task 11.19) rows: "From template: <settings.fromTemplate>", the library's credit for a copy, "Share to
 *  library" on the member's own routines and "Update from the library" on a copy with a newer listed version; all of it
 *  is ToolsTab's, so the two tabs say the same words. */
export default function RoutinesTab(props) {
  return <ToolsTab {...props} kind="routine" />
}
