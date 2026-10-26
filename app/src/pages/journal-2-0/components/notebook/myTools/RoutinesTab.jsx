import ToolsTab from './ToolsTab'

/** My tools, the Routines tab (spec 5.8, Task 9.18): the member's routines, through the one tool list (ToolsTab). */
export default function RoutinesTab(props) {
  return <ToolsTab {...props} kind="routine" />
}
