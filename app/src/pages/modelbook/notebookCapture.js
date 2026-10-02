// G-040 ruling 3 — what "Save to Notebook" stores from the Model Book.
//
// ⭐ A REFERENCE, NOT A COPY: the canonical stock (year + symbol) and, when one is
// selected, the setup — by its row id AND by its canonical identity (type + date),
// so a setup the firm re-saves under a new id still resolves. The captured title is
// kept so a removed entry can still say what it was. The member's optional
// annotation is added by the control at Save time. Pure; `notebookCapture.test.js`.

const setupText = (setup) => [setup?.setup_type, setup?.label_date].filter(Boolean).join(' ')

/** @returns the capture, or null when no stock is on screen. */
export function buildModelBookCapture(stock, setup = null) {
  const year = Number(stock?.year)
  const symbol = typeof stock?.symbol === 'string' ? stock.symbol.trim().toUpperCase() : ''
  if (!Number.isInteger(year) || !symbol) return null
  const base = `${symbol} ${year}`
  if (!setup) return { year, symbol, title: base }
  return {
    year,
    symbol,
    ...(Number.isInteger(setup.id) ? { setupId: setup.id } : {}),
    ...(setup.setup_type ? { setupType: setup.setup_type } : {}),
    ...(setup.label_date ? { setupDate: setup.label_date } : {}),
    title: setupText(setup) ? `${base} — ${setupText(setup)}` : base,
  }
}
