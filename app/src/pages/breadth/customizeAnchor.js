/**
 * The one name for "the element that holds a Customize trigger AND its panel".
 *
 * ⛔ IT IS A MODULE OF ITS OWN because it is shared by three files — the panel
 * that reads it (`BreadthViewsCustomizePanel`), the header that renders one
 * (`BreadthViews`), and the five panes that render one each (`CompareGrid`) —
 * and a string spelled by hand in four places is how a dismissal zone silently
 * stops matching. Exporting it from the panel component would put a constant in
 * a component module, which `react-refresh/only-export-components` refuses for
 * a real reason: the file stops hot-reloading as a component.
 *
 * `anchorProps` exists so a call site never types the attribute at all.
 */
export const DISMISS_ZONE = 'data-customize-anchor'

export const anchorProps = () => ({ [DISMISS_ZONE]: '' })
