/**
 * The Event Ledger's one colour ruling — framework-free, beside the view, for
 * the same reason `percentileLadder.js` is: a component module that also
 * exports a helper cannot hot-reload as a component, and the ledger's own test
 * imports this to check the accent against every palette.
 *
 * 🔴 THE FIRED ACCENT IS NEUTRAL, AND THAT IS THE WHOLE POINT OF THAT LENS.
 *
 * It reports that a NAMED thing happened; it does not grade the thing. Painting
 * every fired event with the palette's bull colour drew *90% Down Volume Day*,
 * *McClellan Oversold* and *New-Low Washout* green, with a green border — a
 * washout day rendered as good news. Tinting each event by an invented
 * directional opinion would be worse: McClellan oversold, an HVC surge and ATR
 * froth are all genuinely arguable, and those are the owner's calls, not this
 * file's.
 *
 * ⭐ SO THE ACCENT IS `colors.tier.a` — THE PALETTE'S OWN CAUTION TONE.
 *
 * The first fix for the green-washout bug hardcoded the UT gold, which held the
 * neutrality but left `options.palette` INERT in that lens: the Customize
 * control was on screen, offered four choices, and moved nothing. A control
 * that cannot change anything is a lie about the product, and it had to be
 * parked behind an exemption in the palette rail to keep that rail green.
 *
 * `tier.a` keeps the property the neutral ruling was actually protecting — the
 * caution band is the one tone a palette carries that reads as neither bull nor
 * bear — while moving with the palette like every other themed view. The
 * exemption is gone; `viewRegistry.test.jsx` now covers that lens with the
 * rest, and pins that the accent is never the bull or bear colour.
 */
export const firedAccent = (colors) => colors.tier.a
