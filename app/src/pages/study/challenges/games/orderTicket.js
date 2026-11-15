// ORDER TICKET, the pure logic (docs/study/GAMES.md, kind `ticket`). Eight trade situations a run; each one is a short
// situation, a practice quote (bid, ask, last and the level the situation names) and a ticket to fill: the side, the
// order type and the price. All three right scores. Every number here is computed from a seed, in whole cents, so the
// same seed deals the same run and no price is ever a float.
//
// The order rules are the standard ones, as the SEC's Investor.gov and FINRA define them and as course units F10.01
// (market and limit) and F10.02 (stop and stop-limit) teach them, in plain words:
//   market      fills now at the best price available; it sets no price (a buy at or near the ask, a sell near the bid)
//   limit       fills at your price or better, or not at all (a buy limit at or under, a sell limit at or over)
//   stop        waits until the stock reaches the stop price, then becomes a market order (a buy stop sits over the
//               market, a sell stop under it), so on a gap it can fill well past the stop
//   stop-limit  waits for the stop price, then becomes a limit order, so it may not fill at all
// and our house entry: a MARKET order once the stock trades through the trigger (the account rulebook,
// docs/study/sizing_rule.md §9 E57: "i market order everything"), the trigger being the level itself (the Kicker's
// "11.05 over THE previous day high"). A buy stop a cent over the high is the order that does that job automatically
// when you cannot watch; the game teaches it as the order type, not as our entry. Under a level is a cent under it,
// over a level a cent over it.
//
// The situations are made up (the card says so). No ticker, no real quote: a game never invents a market fact.

export const TICKET_TOTAL = 8
export const TICKET_HEARTS = 3
export const TICKET_BEST_KEY = 'study.ticket.best'
export const SIDES = ['Buy', 'Sell', 'Sell short', 'Buy to cover']
export const TYPES = ['Market', 'Limit', 'Stop', 'Stop-limit']
export const NO_PRICE = 'No price'
export const FIELDS = ['side', 'type', 'price']

const SEC = "order types as the SEC's Investor.gov defines them"
export const SOURCES = {
  'F10.01': `Course F10.01, market and limit orders · ${SEC}`,
  'F10.02': `Course F10.02, stop and stop-limit orders · ${SEC} · FINRA on stop orders`,
}
export const HOUSE_ENTRY = 'Our entries are market orders once it trades through the trigger (UCT rulebook E57). A buy stop a cent over does the same job when you cannot watch.'

/** A small seeded generator (mulberry32): the same seed gives the same numbers, every time. */
export function rng(seed) {
  let a = (Math.floor(Math.abs(Number(seed) || 0)) % 4294967296) >>> 0
  if (!a) a = 0x9e3779b9
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export const randInt = (r, lo, hi) => lo + Math.floor(r() * (hi - lo + 1))

export function shuffle(r, list) {
  const a = [...list]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1))
    const t = a[i]; a[i] = a[j]; a[j] = t
  }
  return a
}

/** Whole cents to a price, exactly: 5001 -> "50.01" (never through a float). */
export function fmt(cents) {
  const c = Math.round(Number(cents))
  const sign = c < 0 ? '-' : ''
  const v = Math.abs(c)
  return `${sign}${Math.floor(v / 100)}.${String(v % 100).padStart(2, '0')}`
}

export const up10 = (c) => Math.ceil(c / 10) * 10
export const down10 = (c) => Math.floor(c / 10) * 10
const pctOf = (r, lo, hi) => randInt(r, Math.round(lo * 10), Math.round(hi * 10)) / 1000   // lo..hi percent, in 0.1 steps

/** A level a few percent over a price, on a 10-cent line, at least 10 cents clear of it. */
export function levelAbove(r, cents, lo, hi) { return up10(cents + Math.max(10, Math.round(cents * pctOf(r, lo, hi)))) }
/** A level a few percent under a price, on a 10-cent line, at least 10 cents clear of it. */
export function levelBelow(r, cents, lo, hi) { return down10(cents - Math.max(10, Math.round(cents * pctOf(r, lo, hi)))) }
/** A price between two others, 30% to 70% of the way. */
export function between(r, lo, hi) { return lo + Math.round((hi - lo) * randInt(r, 30, 70) / 100) }

/** The practice quote: a bid between 15.00 and 240.00, the ask `spread` cents over it, the last trade inside them. */
export function makeQuote(r, spreadMax = 3) {
  const bid = randInt(r, 1500, 24000)
  const spread = spreadMax <= 1 ? 1 : randInt(r, 1, spreadMax)
  const ask = bid + spread
  const last = spread === 1 ? (r() < 0.5 ? bid : ask) : randInt(r, bid, ask)
  return { bid, ask, last, spread }
}

const LIQUID = 'It trades millions of shares a day, a cent wide, so the fill matters more than the last cent.'
const pair = (stop, limit) => `${fmt(stop)} stop · ${fmt(limit)} limit`

// The intent decides the side: what each side does, said to the member who picked it.
export const SIDE_WHY = {
  'open-long': {
    Buy: 'Buy opens a long. You have no shares and want to own it.',
    Sell: 'Sell closes shares you own. You own none.',
    'Sell short': 'Sell short opens a short, a bet it falls. You want to own it.',
    'Buy to cover': 'Buy to cover closes a short. You have no short.',
  },
  'close-long': {
    Sell: 'Sell closes shares you own. That is how a long comes off.',
    Buy: 'Buy adds to the long. You want out.',
    'Sell short': 'Sell short opens a new short on borrowed shares. Sell is the side that closes shares you own.',
    'Buy to cover': 'Buy to cover closes a short. You are long.',
  },
  'open-short': {
    'Sell short': 'Sell short sells borrowed shares to open a short. You have no position.',
    Buy: 'Buy opens a long, a bet it rises. You want it to fall.',
    Sell: 'Sell closes shares you own. You own none, so the side that opens a short is Sell short.',
    'Buy to cover': 'Buy to cover closes a short. You have none yet.',
  },
  'close-short': {
    'Buy to cover': 'Buy to cover buys the shares back and closes the short.',
    Buy: 'Plain Buy is for shares you want to own. Buy to cover is the side that closes a short.',
    Sell: 'Sell closes shares you own. You are short, so you buy them back.',
    'Sell short': 'Sell short adds to the short. You want out.',
  },
}
const INTENT_SIDE = { 'open-long': 'Buy', 'close-long': 'Sell', 'open-short': 'Sell short', 'close-short': 'Buy to cover' }

// THE TEMPLATES. Each takes the generator and returns its situation: the two sentences, the quote, the levels the card
// shows, the right side and type, three prices (the right one first here, shuffled when dealt), why each side, type and
// price is right or wrong, the rule and the course unit it comes from. Every wrong price is a named mistake.
export const TEMPLATES = {
  'buy-market': (r) => {
    const q = makeQuote(r, 1)
    return {
      title: 'Buy it now', intent: 'open-long', type: 'Market', unit: 'F10.01', quote: q,
      text: ['Your setup just triggered and you want in right now.', LIQUID],
      levels: [{ key: 'spread', label: 'Spread', cents: q.spread, ladder: false }],
      prices: [
        { label: NO_PRICE, cents: null, ok: true, why: `A market order carries no price. It buys now, at or near the ${fmt(q.ask)} ask.` },
        { label: fmt(q.ask), cents: q.ask, why: `${fmt(q.ask)} is the ask. A market order takes no price; a price is what makes it a limit.` },
        { label: fmt(q.bid), cents: q.bid, why: `${fmt(q.bid)} is the bid. A buy there is a limit that may sit unfilled, and you wanted in now.` },
      ],
      typeWhy: {
        Market: `Market fills now at the best price available. A cent wide, that is at or near the ${fmt(q.ask)} ask.`,
        Limit: 'A limit sets your price and can sit unfilled. You said the fill matters more than the cent.',
        Stop: 'A stop waits for a price to trade first. You wanted in now.',
        'Stop-limit': 'A stop-limit waits for a price, then may not fill at all. You wanted in now.',
      },
      rule: 'A market order fills now at the best price available, not a set price. A buy fills at or near the ask.',
    }
  },
  'sell-market': (r) => {
    const q = makeQuote(r, 1)
    const entry = levelAbove(r, q.ask, 2, 5)
    return {
      title: 'Get out now', intent: 'close-long', type: 'Market', unit: 'F10.01', quote: q, entry,
      text: [`You're long from ${fmt(entry)} and the trade is not working, so you want out now.`, LIQUID],
      levels: [{ key: 'spread', label: 'Spread', cents: q.spread, ladder: false }],
      prices: [
        { label: NO_PRICE, cents: null, ok: true, why: `A market order carries no price. It sells now, at or near the ${fmt(q.bid)} bid.` },
        { label: fmt(q.bid), cents: q.bid, why: `${fmt(q.bid)} is the bid. A market order takes no price; a price is what makes it a limit.` },
        { label: fmt(q.ask), cents: q.ask, why: `${fmt(q.ask)} is the ask. A sell there is a limit that may sit unfilled, and you wanted out now.` },
      ],
      typeWhy: {
        Market: `Market fills now at the best price available. A cent wide, that is at or near the ${fmt(q.bid)} bid.`,
        Limit: 'A limit sets your price and can sit unfilled. You said the fill matters more than the cent.',
        Stop: 'A stop waits for a price to trade first. You wanted out now.',
        'Stop-limit': 'A stop-limit waits for a price, then may not fill at all. You wanted out now.',
      },
      rule: 'A market order fills now at the best price available, not a set price. A sell fills at or near the bid.',
    }
  },
  'buy-stop': (r) => {
    const q = makeQuote(r, 3)
    const v = levelAbove(r, q.ask, 0.5, 3)
    return {
      title: 'Buy the breakout', intent: 'open-long', type: 'Stop', unit: 'F10.02', quote: q, house: HOUSE_ENTRY,
      text: [`It has tightened under the ${fmt(v)} high all week, and you have no position.`, 'Buy it only if it trades over that high, and get filled when it does.'],
      levels: [{ key: 'level', label: 'The high', cents: v }],
      prices: [
        { label: fmt(v + 1), cents: v + 1, ok: true, why: `A cent over the ${fmt(v)} high. It has to trade over the high; a stop a cent over fires only once it has.` },
        { label: fmt(v), cents: v, why: `${fmt(v)} is the high itself. A stop there fires when it touches the high, before it trades over it.` },
        { label: NO_PRICE, cents: null, why: `No price is a market order, and that buys now near the ${fmt(q.ask)} ask, before the break.` },
      ],
      typeWhy: {
        Stop: `A buy stop sits over the market and waits. When it trades at ${fmt(v + 1)}, it becomes a market order and buys the break.`,
        Market: `Market buys now, near the ${fmt(q.ask)} ask, before it trades over ${fmt(v)}.`,
        Limit: `A buy limit at ${fmt(v + 1)} buys now. A limit fills at your price or better, and the ${fmt(q.ask)} ask is better.`,
        'Stop-limit': 'A stop-limit becomes a limit once it triggers, and a fast break can run past the limit and leave you out. You wanted the fill.',
      },
      rule: 'A buy stop sits over the market. Once the stock reaches the stop price, it becomes a market order.',
    }
  },
  'buy-limit': (r) => {
    const q = makeQuote(r, 3)
    const p = levelBelow(r, q.bid, 2, 6)
    return {
      title: 'Buy the pullback', intent: 'open-long', type: 'Limit', unit: 'F10.01', quote: q,
      text: ["It ran hard this week and you won't chase it here.", `You'll pay ${fmt(p)} or less on a pullback, never a cent more.`],
      levels: [{ key: 'level', label: 'Your price', cents: p }],
      prices: [
        { label: fmt(p), cents: p, ok: true, why: `${fmt(p)} is your price. A buy limit fills at ${fmt(p)} or lower, never higher.` },
        { label: fmt(p + 1), cents: p + 1, why: `${fmt(p + 1)} is a cent more than you'd pay. The cent over is for a buy stop on a break; a limit goes at your price.` },
        { label: fmt(q.ask), cents: q.ask, why: `${fmt(q.ask)} is the ask, where it trades now. That is the chase you said you won't make.` },
      ],
      typeWhy: {
        Limit: `A buy limit sits under the market and waits. It fills at ${fmt(p)} or lower, or not at all.`,
        Market: `Market buys now, near the ${fmt(q.ask)} ask. That is the chase.`,
        Stop: `A buy stop goes over the market and buys strength. ${fmt(p)} is under the market, and that is a limit's job.`,
        'Stop-limit': `A buy stop-limit also starts over the market. ${fmt(p)} is under the market, and that is a limit's job.`,
      },
      rule: 'A buy limit sits under the market. It fills at your price or lower, never higher.',
    }
  },
  'sell-stop': (r) => {
    const q = makeQuote(r, 3)
    const v = levelBelow(r, q.bid, 1.5, 5)
    const entry = between(r, v, q.bid)
    const floor = down10(v - 1 - Math.max(20, Math.round(v * 0.01)))
    return {
      title: 'Protect the long', intent: 'close-long', type: 'Stop', unit: 'F10.02', quote: q, entry,
      text: [`You're long from ${fmt(entry)} and it's holding above the ${fmt(v)} low.`, "You're out if it trades under that low, whatever the fill."],
      levels: [{ key: 'level', label: 'The low', cents: v }],
      prices: [
        { label: fmt(v - 1), cents: v - 1, ok: true, why: `A cent under the ${fmt(v)} low. Under the low means it broke.` },
        { label: fmt(v), cents: v, why: `${fmt(v)} is the low itself. A stop there fires when it touches the low, before it breaks it.` },
        { label: pair(v - 1, floor), cents: v - 1, limit: floor, why: `A limit under the stop is a floor on the sale. If it gaps under ${fmt(floor)}, you are still in, and you said whatever the fill.` },
      ],
      typeWhy: {
        Stop: `A sell stop sits under the market and waits. When it trades at ${fmt(v - 1)}, it becomes a market order and gets you out.`,
        Market: `Market sells now, near the ${fmt(q.bid)} bid. It has not broken ${fmt(v)}.`,
        Limit: `A sell limit at ${fmt(v - 1)} sells now. A limit fills at your price or better, and the ${fmt(q.bid)} bid is better.`,
        'Stop-limit': 'A stop-limit becomes a limit once it triggers, so a gap can leave it unfilled. You said whatever the fill.',
      },
      rule: 'A sell stop sits under the market. Once the stock reaches the stop price, it becomes a market order, so on a gap it can fill well under the stop.',
    }
  },
  'sell-limit': (r) => {
    const q = makeQuote(r, 3)
    const t = levelAbove(r, q.ask, 3, 10)
    const entry = levelBelow(r, q.bid, 4, 10)
    return {
      title: 'Sell at the target', intent: 'close-long', type: 'Limit', unit: 'F10.01', quote: q, entry,
      text: [`You're long from ${fmt(entry)} and it's running toward your ${fmt(t)} target.`, 'Sell it there or higher, not a cent below.'],
      levels: [{ key: 'level', label: 'Your target', cents: t }],
      prices: [
        { label: fmt(t), cents: t, ok: true, why: `${fmt(t)} is the target. A sell limit fills at ${fmt(t)} or higher.` },
        { label: fmt(t - 1), cents: t - 1, why: `${fmt(t - 1)} is a cent under your target, and you said not a cent below. The cent off is for a stop.` },
        { label: fmt(q.bid), cents: q.bid, why: `${fmt(q.bid)} is the bid, where it sells now. The target is higher.` },
      ],
      typeWhy: {
        Limit: `A sell limit sits over the market and waits. It fills at ${fmt(t)} or higher, or not at all.`,
        Market: `Market sells now, near the ${fmt(q.bid)} bid, under your target.`,
        Stop: 'A sell stop goes under the market, to get you out on weakness. A target over the market is a limit.',
        'Stop-limit': 'A sell stop-limit also starts under the market, on weakness. A target over the market is a limit.',
      },
      rule: 'A sell limit sits over the market. It fills at your price or higher, never lower.',
    }
  },
  'short-stop': (r) => {
    const q = makeQuote(r, 3)
    const v = levelBelow(r, q.bid, 0.5, 3)
    return {
      title: 'Short the breakdown', intent: 'open-short', type: 'Stop', unit: 'F10.02', quote: q,
      text: ['It keeps failing at its 20-day average, and you have no position.', `Short it only if it trades under the ${fmt(v)} low, and get filled when it does.`],
      levels: [{ key: 'level', label: 'The low', cents: v }],
      prices: [
        { label: fmt(v - 1), cents: v - 1, ok: true, why: `A cent under the ${fmt(v)} low. It has to trade under the low.` },
        { label: fmt(v), cents: v, why: `${fmt(v)} is the low itself. A stop there fires when it touches the low, before it breaks it.` },
        { label: NO_PRICE, cents: null, why: `No price is a market order, and that shorts now near the ${fmt(q.bid)} bid, before the break.` },
      ],
      typeWhy: {
        Stop: `A sell short stop sits under the market and waits. When it trades at ${fmt(v - 1)}, it becomes a market order and opens the short.`,
        Market: `Market shorts now, near the ${fmt(q.bid)} bid, before it trades under ${fmt(v)}.`,
        Limit: `A sell short limit at ${fmt(v - 1)} shorts now. A limit sells at your price or higher, and the ${fmt(q.bid)} bid is higher.`,
        'Stop-limit': 'A stop-limit becomes a limit once it triggers, and a fast break can run past the limit and leave you out. You wanted the fill.',
      },
      rule: 'A sell short stop sits under the market. Once the stock reaches the stop price, it becomes a market order and opens the short.',
    }
  },
  'short-limit': (r) => {
    const q = makeQuote(r, 3)
    const p = levelAbove(r, q.ask, 2, 6)
    return {
      title: 'Short the bounce', intent: 'open-short', type: 'Limit', unit: 'F10.01', quote: q,
      text: ["It's in a downtrend and you have no position.", `Short it on a bounce to ${fmt(p)} or higher, never a cent lower.`],
      levels: [{ key: 'level', label: 'Your price', cents: p }],
      prices: [
        { label: fmt(p), cents: p, ok: true, why: `${fmt(p)} is your price. A sell short limit fills at ${fmt(p)} or higher.` },
        { label: fmt(p - 1), cents: p - 1, why: `${fmt(p - 1)} is a cent under your price, and you said never a cent lower. The cent under is for a stop on a break.` },
        { label: fmt(q.bid), cents: q.bid, why: `${fmt(q.bid)} is the bid, where it shorts now. You wanted it higher.` },
      ],
      typeWhy: {
        Limit: `A sell short limit sits over the market and waits. It fills at ${fmt(p)} or higher, or not at all.`,
        Market: `Market shorts now, near the ${fmt(q.bid)} bid, under your price.`,
        Stop: `A sell stop goes under the market, to catch a break. ${fmt(p)} is over the market, and that is a limit's job.`,
        'Stop-limit': `A sell stop-limit also starts under the market. ${fmt(p)} is over the market, and that is a limit's job.`,
      },
      rule: 'A sell short limit sits over the market. It fills at your price or higher, never lower.',
    }
  },
  'cover-stop': (r) => {
    const q = makeQuote(r, 3)
    const v = levelAbove(r, q.ask, 1.5, 5)
    const entry = between(r, q.ask, v)
    const cap = up10(v + 1 + Math.max(20, Math.round(v * 0.01)))
    return {
      title: 'Cover on a breakout', intent: 'close-short', type: 'Stop', unit: 'F10.02', quote: q, entry,
      text: [`You're short from ${fmt(entry)} and it's holding under the ${fmt(v)} high.`, "You're out if it trades over that high, whatever the fill."],
      levels: [{ key: 'level', label: 'The high', cents: v }],
      prices: [
        { label: fmt(v + 1), cents: v + 1, ok: true, why: `A cent over the ${fmt(v)} high. Over the high means it broke out.` },
        { label: fmt(v), cents: v, why: `${fmt(v)} is the high itself. A stop there fires when it touches the high, before it trades over it.` },
        { label: pair(v + 1, cap), cents: v + 1, limit: cap, why: `A limit over the stop caps what you'll pay. If it gaps over ${fmt(cap)}, you are still short, and you said whatever the fill.` },
      ],
      typeWhy: {
        Stop: `A buy to cover stop sits over the market and waits. When it trades at ${fmt(v + 1)}, it becomes a market order and gets you out.`,
        Market: `Market covers now, near the ${fmt(q.ask)} ask. It has not traded over ${fmt(v)}.`,
        Limit: `A buy limit at ${fmt(v + 1)} covers now. A limit fills at your price or better, and the ${fmt(q.ask)} ask is better.`,
        'Stop-limit': 'A stop-limit becomes a limit once it triggers, so a gap can leave it unfilled and you still short. You said whatever the fill.',
      },
      rule: 'A buy to cover stop sits over the market. Once the stock reaches the stop price, it becomes a market order, so on a gap it can fill well over the stop.',
    }
  },
  'cover-limit': (r) => {
    const q = makeQuote(r, 3)
    const t = levelBelow(r, q.bid, 3, 10)
    const entry = levelAbove(r, q.ask, 4, 10)
    return {
      title: 'Cover at the target', intent: 'close-short', type: 'Limit', unit: 'F10.01', quote: q, entry,
      text: [`You're short from ${fmt(entry)} and it's falling toward your ${fmt(t)} target.`, 'Cover there or lower, not a cent above.'],
      levels: [{ key: 'level', label: 'Your target', cents: t }],
      prices: [
        { label: fmt(t), cents: t, ok: true, why: `${fmt(t)} is the target. A buy to cover limit fills at ${fmt(t)} or lower.` },
        { label: fmt(t + 1), cents: t + 1, why: `${fmt(t + 1)} is a cent over your target, and you said not a cent above. The cent off is for a stop.` },
        { label: fmt(q.ask), cents: q.ask, why: `${fmt(q.ask)} is the ask, where it covers now. The target is lower.` },
      ],
      typeWhy: {
        Limit: `A buy to cover limit sits under the market and waits. It fills at ${fmt(t)} or lower, or not at all.`,
        Market: `Market covers now, near the ${fmt(q.ask)} ask, over your target.`,
        Stop: 'A buy stop goes over the market, to get you out on strength. A target under the market is a limit.',
        'Stop-limit': 'A buy stop-limit also starts over the market, on strength. A target under the market is a limit.',
      },
      rule: 'A buy to cover limit sits under the market. It fills at your price or lower, never higher.',
    }
  },
  'sell-stoplimit': (r) => {
    const q = makeQuote(r, 3)
    const v = levelBelow(r, q.bid, 2, 5)
    const entry = between(r, v, q.bid)
    const floor = down10(v - Math.max(20, Math.round(v * pctOf(r, 0.8, 1.5))))
    return {
      title: 'A stop with a floor', intent: 'close-long', type: 'Stop-limit', unit: 'F10.02', quote: q, entry,
      text: [`You're long from ${fmt(entry)} into earnings tonight, with your stop under the ${fmt(v)} low.`, `If it gaps through, you'll sell no lower than ${fmt(floor)}, never under it.`],
      levels: [{ key: 'level', label: 'The low', cents: v }, { key: 'limit', label: 'Your floor', cents: floor }],
      prices: [
        { label: pair(v - 1, floor), cents: v - 1, limit: floor, ok: true, why: `The stop a cent under the ${fmt(v)} low starts the order. The limit is your floor: it sells at ${fmt(floor)} or higher, or not at all.` },
        { label: fmt(v - 1), cents: v - 1, why: `${fmt(v - 1)} alone is a plain stop. It becomes a market order, and on a gap it can sell far under ${fmt(floor)}.` },
        { label: pair(floor, v - 1), cents: floor, limit: v - 1, why: `Swapped. The stop is the trigger, a cent under the low at ${fmt(v - 1)}. The limit is the floor, ${fmt(floor)}.` },
      ],
      typeWhy: {
        'Stop-limit': `A stop-limit waits for the stop price, then becomes a limit order. It never sells under ${fmt(floor)}, so on a gap through it, it may not fill at all.`,
        Stop: `A plain stop becomes a market order. On a gap it can fill far under ${fmt(floor)}, the floor you set.`,
        Market: `Market sells now, near the ${fmt(q.bid)} bid. You only want out if it breaks ${fmt(v)}.`,
        Limit: `A sell limit under the market sells now. You only want out if it breaks ${fmt(v)}.`,
      },
      rule: 'A stop-limit becomes a limit order once the stop price trades. It will not sell under your limit, so if it gaps under the limit, it may not fill at all and you still hold it.',
    }
  },
  'cover-stoplimit': (r) => {
    const q = makeQuote(r, 3)
    const v = levelAbove(r, q.ask, 2, 5)
    const entry = between(r, q.ask, v)
    const cap = up10(v + Math.max(20, Math.round(v * pctOf(r, 0.8, 1.5))))
    return {
      title: 'A stop with a cap', intent: 'close-short', type: 'Stop-limit', unit: 'F10.02', quote: q, entry,
      text: [`You're short from ${fmt(entry)} into earnings tonight, with your stop over the ${fmt(v)} high.`, `If it gaps through, you'll pay no more than ${fmt(cap)} to cover, never over it.`],
      levels: [{ key: 'level', label: 'The high', cents: v }, { key: 'limit', label: 'Your cap', cents: cap }],
      prices: [
        { label: pair(v + 1, cap), cents: v + 1, limit: cap, ok: true, why: `The stop a cent over the ${fmt(v)} high starts the order. The limit is your cap: it covers at ${fmt(cap)} or lower, or not at all.` },
        { label: fmt(v + 1), cents: v + 1, why: `${fmt(v + 1)} alone is a plain stop. It becomes a market order, and on a gap it can cover far over ${fmt(cap)}.` },
        { label: pair(cap, v + 1), cents: cap, limit: v + 1, why: `Swapped. The stop is the trigger, a cent over the high at ${fmt(v + 1)}. The limit is the cap, ${fmt(cap)}.` },
      ],
      typeWhy: {
        'Stop-limit': `A stop-limit waits for the stop price, then becomes a limit order. It never pays over ${fmt(cap)}, so on a gap through it, it may not fill at all.`,
        Stop: `A plain stop becomes a market order. On a gap it can fill far over ${fmt(cap)}, the cap you set.`,
        Market: `Market covers now, near the ${fmt(q.ask)} ask. You only want out if it breaks ${fmt(v)}.`,
        Limit: `A buy limit over the market covers now. You only want out if it breaks ${fmt(v)}.`,
      },
      rule: 'A stop-limit becomes a limit order once the stop price trades. It will not pay over your limit, so if it gaps over the limit, it may not fill at all and you are still short.',
    }
  },
}

/** One run covers every rule: one situation from each family, the variant and the order by the seed. Across a run all
 *  four sides and all four order types come up. */
export const FAMILIES = [
  ['buy-market', 'sell-market'],
  ['buy-stop'],
  ['buy-limit', 'short-limit'],
  ['sell-stop'],
  ['sell-limit', 'cover-limit'],
  ['short-stop'],
  ['cover-stop'],
  ['sell-stoplimit', 'cover-stoplimit'],
]

/** One situation, dealt from its template with its own seed: the prices shuffled, the answer's index kept. */
export function buildSituation(id, seed) {
  const make = TEMPLATES[id]
  if (!make) throw new Error(`unknown order ticket template ${id}`)
  const r = rng(seed)
  const t = make(r)
  const prices = shuffle(r, t.prices.map((p) => ({ ...p, ok: !!p.ok })))
  const side = INTENT_SIDE[t.intent]
  return {
    id, seed, title: t.title, intent: t.intent, side, type: t.type, unit: t.unit, house: t.house || null,
    text: t.text, quote: t.quote, levels: t.levels, entry: t.entry ?? null,
    prices, price: prices.findIndex((p) => p.ok),
    sideWhy: SIDE_WHY[t.intent], typeWhy: t.typeWhy, rule: t.rule, source: SOURCES[t.unit],
  }
}

/** The run: TICKET_TOTAL situations, one per family, in a seeded order. */
export function buildRun(seed, total = TICKET_TOTAL) {
  const r = rng(seed)
  const picks = FAMILIES.map((f) => f[randInt(r, 0, f.length - 1)])
  const order = shuffle(r, picks)
  return order.slice(0, total).map((id, i) => buildSituation(id, (Math.floor(Math.abs(Number(seed) || 0)) + (i + 1) * 7919) % 4294967296))
}

/** A ticket is scored field by field; it counts only when all three are right. `pick` = {side, type, price (index)}. */
export function scoreTicket(sit, pick) {
  const side = pick?.side === sit.side
  const type = pick?.type === sit.type
  const price = pick?.price === sit.price
  return { side, type, price, ok: side && type && price }
}

/** The ticket said out loud: "Buy · Stop · 50.01"; a market ticket with no price is just "Buy · Market". */
export function ticketText(side, type, priceLabel) {
  const parts = [side || 'No side', type || 'No type']
  if (!(type === 'Market' && priceLabel === NO_PRICE)) parts.push(priceLabel || 'No price')
  return parts.join(' · ')
}
export const rightTicket = (sit) => ticketText(sit.side, sit.type, sit.prices[sit.price].label)
export const saidTicket = (sit, pick) => ticketText(pick?.side, pick?.type, pick?.price == null ? null : sit.prices[pick.price]?.label)

/** THE WORKING: the right ticket, then each field with why the right answer is right and, on a miss, why the member's
 *  pick is not. Every line is the template's own. */
export function working(sit, pick) {
  const sc = scoreTicket(sit, pick)
  const said = sit.prices[pick?.price] || null
  const right = sit.prices[sit.price]
  const rows = [
    { field: 'side', label: 'Side', right: sit.side, said: pick?.side ?? null, ok: sc.side, why: sit.sideWhy[sit.side], saidWhy: sc.side ? null : (sit.sideWhy[pick?.side] || null) },
    { field: 'type', label: 'Order type', right: sit.type, said: pick?.type ?? null, ok: sc.type, why: sit.typeWhy[sit.type], saidWhy: sc.type ? null : (sit.typeWhy[pick?.type] || null) },
    { field: 'price', label: 'Price', right: right.label, said: said ? said.label : null, ok: sc.price, why: right.why, saidWhy: sc.price ? null : (said ? said.why : null) },
  ]
  return { ok: sc.ok, ticket: rightTicket(sit), said: saidTicket(sit, pick), rows, rule: sit.rule, house: sit.house, source: sit.source }
}

/** The first field the member got wrong, said in one line for the verdict: "You said Limit. A buy limit ... ". */
export function missLine(work) {
  const r = work.rows.find((x) => !x.ok)
  if (!r) return null
  return r.said ? `You said ${r.said}. ${r.saidWhy || r.why}` : `No ${r.label.toLowerCase()} picked. ${r.why}`
}

/** What the verdict says on a miss, kept short so it always fits a phone's screen (the takeover cannot scroll): each
 *  field right or wrong, then the first wrong field's lesson in one line. The full working is in the review under it. */
export function verdictMiss(work) {
  const first = work.rows.find((x) => !x.ok) || null
  return { marks: work.rows.map((r) => ({ field: r.field, label: r.label, ok: r.ok })), field: first ? first.label : null, line: missLine(work) }
}

/** Where a label hangs from its point: from the left edge it runs right, from the right edge it runs left. */
export const anchorOf = (x) => (x < 0.38 ? 'start' : x > 0.62 ? 'end' : 'middle')

/** A label's width as a fraction of the ladder. Before the card is measured (and in tests) a fixed guess: a character of
 *  12px type is about 0.022 of a phone card and 0.012 of a wide one, plus 0.04 for the pill, a label hangs 0.02 past
 *  its point and two on a row keep 0.01 apart. Once the card is measured, labelFit(px) gives the real fractions. */
export const LABEL_CHAR_W = 0.022
export const LABEL_CHAR_W_WIDE = 0.012
/** The pixels the ladder's labels take (OrderTicketGame.module.css): 12px type at weight 800 to 850 is at most about
 *  7.2px a character, digits and capitals included; a flag's pill adds 18px of padding, 2px of border and 4px of air;
 *  a label under the line adds 4px of air; each hangs 8px past its point; two on a row keep 6px apart. */
export const LABEL_PX = { char: 7.2, flag: 24, under: 4, hang: 8, gap: 6 }

/** The label metrics for a ladder this many pixels wide, as fractions of it (the flags over the line and, in `under`,
 *  the plain labels under it). */
export function labelFit(widthPx) {
  const w = Math.max(160, Number(widthPx) || 0)
  const base = { charW: LABEL_PX.char / w, nudge: LABEL_PX.hang / w, gap: LABEL_PX.gap / w }
  return { ...base, pad: LABEL_PX.flag / w, under: { ...base, pad: LABEL_PX.under / w } }
}

/** A fit as {charW, pad, nudge, gap}: a measured one as it is, a bare number as the fixed guess above. */
function fitOf(fit) {
  if (fit && typeof fit === 'object') return fit
  return { charW: typeof fit === 'number' ? fit : LABEL_CHAR_W, pad: 0.04, nudge: 0.02, gap: 0.01 }
}
const underOf = (fit) => (fit && typeof fit === 'object' && fit.under ? fit.under : fit)

/** The span a label covers, from its point, the side it hangs from and any slide that keeps it on the card. */
export function labelSpan(it, fit = LABEL_CHAR_W, anchor = it.anchor || anchorOf(it.x)) {
  const f = fitOf(fit)
  const w = String(it.text || '').length * f.charW + f.pad
  const x = it.x + (Number(it.shift) || 0)
  return anchor === 'start' ? [x - f.nudge, x - f.nudge + w] : anchor === 'end' ? [x + f.nudge - w, x + f.nudge] : [x - w / 2, x + w / 2]
}

/** The side a label hangs from: the natural one for its point when the label fits on the card that way, else the one
 *  that keeps it on the card (a long label near the middle of a narrow phone card), else the one that spills least. */
export function anchorFor(it, fit = LABEL_CHAR_W) {
  const pref = anchorOf(it.x)
  const order = [pref, ...(it.x < 0.5 ? ['start', 'middle', 'end'] : ['end', 'middle', 'start']).filter((a) => a !== pref)]
  let best = pref
  let least = Infinity
  for (const a of order) {
    const [lo, hi] = labelSpan(it, fit, a)
    const spill = Math.max(0, -lo) + Math.max(0, hi - 1)
    if (spill <= 1e-9) return a
    if (spill < least) { least = spill; best = a }
  }
  return best
}

/** Labels on one side of the ladder, each hung from a side that keeps it on the card (and, on a card too narrow for any
 *  side, slid along by `shift`, a fraction of the card, until it fits; its pin stays on its price), then put on the
 *  lowest row where its span overlaps no label already there, so two never sit on top of each other. */
export function stackRows(items, fit = LABEL_CHAR_W) {
  const f = fitOf(fit)
  const rows = []
  const at = new Map()
  for (const it of [...items].sort((p, q) => p.x - q.x)) {
    const anchor = anchorFor(it, f)
    let [a, b] = labelSpan({ ...it, shift: 0 }, f, anchor)
    const shift = a < 0 || b - a >= 1 ? -a : b > 1 ? 1 - b : 0
    a += shift; b += shift
    let row = 0
    while (rows[row] && rows[row].some(([c, d]) => a < d + f.gap && c < b + f.gap)) row += 1
    if (!rows[row]) rows[row] = []
    rows[row].push([a, b])
    at.set(it.key, { row, anchor, shift })
  }
  return items.map((it) => ({ ...it, ...at.get(it.key) }))
}

/** THE LADDER on the quote card: where the market, the level and the orders sit, as fractions of the card's width
 *  (0 is the lowest price shown, 1 the highest), with 15% of the span as room at each end. Under the line: the market
 *  and the levels the situation names, stacked so no two labels collide. `fit` is labelFit(the ladder's width), or the
 *  fixed guess before it is measured. */
export function ladderOf(sit, fit = LABEL_CHAR_W) {
  const pts = [sit.quote.bid, sit.quote.ask]
  for (const l of sit.levels) if (l.ladder !== false) pts.push(l.cents)
  for (const p of sit.prices) { if (p.cents != null) pts.push(p.cents); if (p.limit != null) pts.push(p.limit) }
  const lo = Math.min(...pts), hi = Math.max(...pts)
  const pad = Math.max(5, Math.round((hi - lo) * 0.15))
  const a = lo - pad, b = hi + pad
  const x = (c) => (c - a) / (b - a)
  const market = { from: x(sit.quote.bid), to: x(sit.quote.ask) }
  const below = stackRows([
    { key: 'market', kind: 'market', text: 'Market now', x: (market.from + market.to) / 2 },
    ...sit.levels.filter((l) => l.ladder !== false).map((l) => ({ key: l.key, kind: 'level', text: `${l.label} ${fmt(l.cents)}`, x: x(l.cents) })),
  ], underOf(fit))
  return { lo: a, hi: b, market, below, rowsBelow: 1 + Math.max(0, ...below.map((r) => r.row)), x }
}

const typeWord = (t) => (t === 'Stop-limit' ? 'stop-limit' : t.toLowerCase())

/** The orders drawn on the ladder after Check: the right ticket in green (a stop-limit's stop and limit both), and the
 *  member's own prices in red where they differ from the right ones. A market order has no price: it marks where it
 *  fills. */
export function orderMarks(sit, pick, fit = LABEL_CHAR_W) {
  const lad = ladderOf(sit, fit)
  const right = sit.prices[sit.price]
  const out = []
  const taken = new Set()
  if (right.cents != null) {
    if (right.limit != null) {
      out.push({ key: 'right-stop', tone: 'right', cents: right.cents, x: lad.x(right.cents), text: `Stop ${fmt(right.cents)}` })
      out.push({ key: 'right-limit', tone: 'right', cents: right.limit, x: lad.x(right.limit), text: `Limit ${fmt(right.limit)}` })
      taken.add(right.cents); taken.add(right.limit)
    } else {
      out.push({ key: 'right', tone: 'right', cents: right.cents, x: lad.x(right.cents), text: `${sit.side} ${typeWord(sit.type)} ${fmt(right.cents)}` })
      taken.add(right.cents)
    }
  } else if (sit.type === 'Market') {
    // a market order sets no price: it fills at or near the ask for a buy, the bid for a sell (Investor.gov)
    const buy = sit.side === 'Buy' || sit.side === 'Buy to cover'
    const near = buy ? sit.quote.ask : sit.quote.bid
    out.push({ key: 'right', tone: 'right', cents: near, x: lad.x(near), text: `Fills near ${fmt(near)}` })
    taken.add(near)
  }
  const said = pick?.price == null ? null : sit.prices[pick.price]
  if (said && !said.ok && said.cents != null) {
    const mine = said.limit != null
      ? [{ key: 'said-stop', cents: said.cents, text: `Your stop ${fmt(said.cents)}` }, { key: 'said-limit', cents: said.limit, text: `Your limit ${fmt(said.limit)}` }]
      : [{ key: 'said', cents: said.cents, text: `Yours ${fmt(said.cents)}` }]
    for (const m of mine) if (!taken.has(m.cents)) out.push({ ...m, tone: 'said', x: lad.x(m.cents) })
  }
  return stackRows(out, fit)
}

/** Hearts left after these results (a miss costs one). */
export const heartsLeft = (results, hearts = TICKET_HEARTS) => Math.max(0, hearts - results.filter((r) => r === false).length)

/** The run is over when every situation is played or the hearts are gone. */
export const runOver = (results, total = TICKET_TOTAL, hearts = TICKET_HEARTS) => results.length >= total || heartsLeft(results, hearts) === 0

/** What the run is worth on the server (POST /api/study/game-runs): the tickets played and the tickets right. */
export const runPost = (runId, results) => ({ kind: 'ticket', run_id: runId, right: results.filter((r) => r === true).length, total: results.length })
