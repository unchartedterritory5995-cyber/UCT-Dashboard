// Whole-row on/off for the widget ⚙ settings menus (UCT Signature, owner 11-15) — the same rule as
// Chart Settings: a click anywhere on a row that carries an on/off switch flips it, while the
// switch itself, a swatch, a dropdown or any other control keeps its own click. Look and reach
// only: the switch's role, label, handler and saved setting are unchanged (it is the switch's own
// click that runs).
const OWN_CLICK = 'button, input, select, textarea, a, [role="switch"], [role="option"], [data-color-swatch]'

/** An onClick for a menu's body: `rowClass` is the CSS-module class of one row. */
export function rowToggleClick(rowClass) {
  return (e) => {
    const row = rowClass && e.target.closest?.(`.${rowClass}`)
    if (!row || e.target.closest(OWN_CLICK)) return
    row.querySelector('[role="switch"]')?.click()
  }
}
