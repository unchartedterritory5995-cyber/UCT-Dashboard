// Owner 11-14: the widget Float button (⧉, float a widget on top of another) is switched
// off for now. The feature itself stays (handleFloatWidget, FloatingWidget, the header's
// button): flip this back to true to offer it again.
//
// ONE source for the switch: ChartsWorkspace (the header button) and the UCT Agent
// (boardDetach.float, its discovery / guide wording) both read it from here.
export const FLOAT_BUTTON_ON = false
