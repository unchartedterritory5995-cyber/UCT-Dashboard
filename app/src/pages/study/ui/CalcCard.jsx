// THE PICTURE CARD FOR A COMPUTED QUESTION (VISUALS_PLAN.md step 3; the logic and its why: ../calcCard.js). Before the
// answer it shows what the question gives (a price ruler with the entry and stop, the two numbers of a move, the size
// inputs); the answer's own slot reads "?". After the answer, once the verdict screen has closed (`settled`), the slot
// fills in and the picture completes (the R steps, the level asked for, the part of a move, the payoff line), with the
// working line under it. A computed question with no card still gets the working line after the answer.
// Every number on it is the question's own or the server's scored result; nothing is invented. Finite motion only.
import { itemHasChart } from '../drills/types'
import { answerText, cardOf, ladderLayout, priceFormat, resultOf, valueText, workingOf } from '../calcCard'
import c from './calcCard.module.css'

const TITLE = {
  ladder: 'The levels', move: 'The move', recover: 'Back to even', size: 'The size', range: 'The bar', quote: 'The quote',
  share: 'The ceiling', expectancy: 'The record', payoff: 'At expiry',
}

function Ladder({ card, result }) {
  const done = result != null
  const fmt = priceFormat([...card.levels.map((l) => l.price), ...(done && card.find?.as === 'price' ? [result] : [])])
  const { rows, ticks } = ladderLayout(card, result)
  return (
    <>
    <div className={c.ladder} data-testid="calc-ladder">
      {ticks.map((t) => (
        <span key={`t${t.r}`} className={c.tick} style={{ top: `${t.top}%` }} data-tick={t.r}>
          {`${t.r < 0 ? '−' : ''}${Math.abs(t.r)}R`}
        </span>
      ))}
      {rows.map((r) => (
        <div key={r.key} className={`${c.level} ${c[r.tone] || ''}`} style={{ top: `${r.labelTop}%` }} data-level={r.key}>
          <span className={c.levelName}>{r.label}</span>
          <span className={c.levelLine} />
          <span className={c.levelPrice}>{fmt(r.price)}</span>
        </div>
      ))}
    </div>
    {sharesNote(card)}
    </>
  )
}

function Move({ card, result }) {
  const done = result != null
  const a = card.from.value, b = card.to.value
  const max = Math.max(a, b) || 1
  // prices read to the cent alike ("40.00", "44.00"); a volume multiple reads as the words write it ("2", "5.5")
  const fmt = card.find?.as === 'times' ? (v) => v.toLocaleString('en-US', { maximumFractionDigits: 4 }) : priceFormat([a, b])
  const up = b > a
  const lowH = (Math.min(a, b) / max) * 100
  const col = (v, label, which) => (
    <Column key={which} h={(v / max) * 100} value={fmt(v)} label={label} which={which}>
      {done && v === max && a !== b ? (
        <span className={`${c.colPart} ${up ? c.partUp : c.partDown}`} style={{ height: `${100 - lowH}%` }} data-testid="calc-move-part" />
      ) : null}
    </Column>
  )
  return (
    <div className={c.cols} data-testid="calc-move">
      {col(a, card.from.label, 'from')}
      <span className={c.colArrow} aria-hidden="true">{up ? '↗' : '↘'}</span>
      {col(b, card.to.label, 'to')}
    </div>
  )
}

/** One column: its value rides just above its own bar (a short bar's value sat 95 px above it when the tracks were
 *  aligned by their tops, 2026-11-15 screen check), the bars share one base, the label sits under the base. */
const BAR_ROOM = 0.8   // the tallest bar fills 80% of the track; the rest is room for its value
function Column({ h, value, label, which = null, cls = '', children = null }) {
  return (
    <div className={c.col} data-col={which || undefined}>
      <div className={c.colTrack}>
        <div className={`${c.colBar} ${cls}`} style={{ height: `${h * BAR_ROOM}%` }}>{children}</div>
        <span className={c.colValue} style={{ bottom: `calc(${h * BAR_ROOM}% + 6px)` }}>{value}</span>
      </div>
      <span className={c.colLabel}>{label || ' '}</span>
    </div>
  )
}

function Recover({ card, result }) {
  const done = result != null
  const after = 100 - card.loss_pct
  const bar = (h, label, value, extra = null, cls = '') => <Column h={h} value={value} label={label} cls={cls}>{extra}</Column>
  return (
    <div className={c.cols} data-testid="calc-recover">
      {bar(100, 'Before', '100')}
      {bar(after, `After a ${card.loss_pct}% fall`, `${+after.toFixed(4)}`, null, c.colDown)}
      {bar(100, 'Back to even', '100', done
        ? <span className={`${c.colPart} ${c.partUp}`} style={{ height: `${100 - after}%` }} data-testid="calc-move-part" />
        : null, done ? '' : c.colGhost)}
    </div>
  )
}

function Size({ card }) {
  return (
    <div className={c.tiles} data-testid="calc-size">
      {card.rows.map((r) => (
        <div key={r.key} className={c.tile}>
          <span className={c.tileLabel}>{r.label}</span>
          <span className={c.tileValue}>{valueText(r)}</span>
        </div>
      ))}
    </div>
  )
}

function Range({ card, result }) {
  const done = result != null
  const { high, low, close } = card
  const fmt = priceFormat([high, low, close])
  const at = (v) => ((high - v) / (high - low)) * 100
  const unit = card.find?.as === 'pct' ? ['0%', '100%'] : ['0', '1']
  return (
    <div className={c.range} data-testid="calc-range">
      <div className={c.rangeScale}><span>{unit[1]}</span><span>{unit[0]}</span></div>
      <div className={c.rangeBar}>
        {done ? <span className={c.rangeFill} style={{ top: `${at(close)}%` }} data-testid="calc-range-fill" /> : null}
        <span className={c.rangeClose} style={{ top: `${at(close)}%` }} />
      </div>
      <div className={c.rangeLabels}>
        <span className={c.rangeLabel} style={{ top: '0%' }}><b>High</b> {fmt(high)}</span>
        <span className={`${c.rangeLabel} ${c.gold}`} style={{ top: `${Math.min(84, Math.max(16, at(close)))}%` }}><b>{card.value_label || 'Close'}</b> {fmt(close)}</span>
        <span className={c.rangeLabel} style={{ top: '100%' }}><b>Low</b> {fmt(low)}</span>
      </div>
    </div>
  )
}

function Quote({ card, result }) {
  const done = result != null
  const fmt = priceFormat([card.bid, card.ask])
  return (
    <div className={c.quote} data-testid="calc-quote">
      <div className={`${c.quoteSide} ${c.bidSide}`}><span className={c.tileLabel}>Bid</span><span className={c.tileValue}>{fmt(card.bid)}</span></div>
      <div className={`${c.quoteGap} ${done ? c.quoteGapOn : ''}`} aria-hidden="true"><span /></div>
      <div className={`${c.quoteSide} ${c.askSide}`}><span className={c.tileLabel}>Ask</span><span className={c.tileValue}>{fmt(card.ask)}</span></div>
      {Number.isFinite(card.shares) ? <div className={c.quoteNote}>{sharesNote(card)}</div> : null}
    </div>
  )
}

function Share({ card, result }) {
  const done = result != null
  if (card.part) {
    // the part is given and its percent is asked: the slice would show the answer, so it draws only after it
    const frac = Math.min(1, card.part.value / card.whole.value)
    return (
      <div className={c.share} data-testid="calc-share">
        <div className={c.shareBar}>
          {done ? <span className={`${c.shareSlice} ${c.shareSliceOn} ${c.sliceIn}`} style={{ width: `max(6px, ${frac * 100}%)` }} data-frac={frac.toFixed(4)} data-testid="calc-share-slice" /> : null}
        </div>
        <div className={c.shareLegend}>
          <span>{card.part.label}: <b className={c.gold}>{valueText(card.part)}</b></span>
          <span>{card.whole.label}: <b>{valueText(card.whole)}</b></span>
        </div>
      </div>
    )
  }
  return (
    <div className={c.share} data-testid="calc-share">
      <div className={c.shareBar}>
        <span className={`${c.shareSlice} ${done ? c.shareSliceOn : ''}`} style={{ width: `max(6px, ${card.pct}%)` }} />
      </div>
      <div className={c.shareLegend}>
        <span><b className={c.gold}>{card.pct}%</b> of it</span>
        <span>{card.whole.label}: <b>{Math.round(card.whole.value).toLocaleString('en-US')}</b> shares</span>
      </div>
    </div>
  )
}

/** The share count a dollar card multiplies by ("500 shares"), under its picture. */
const sharesNote = (card) => (Number.isFinite(card.shares)
  ? <p className={c.note} data-testid="calc-shares">{card.shares.toLocaleString('en-US')} shares</p> : null)

function Expectancy({ card }) {
  const w = card.win_pct, l = +(100 - w).toFixed(6)
  return (
    <div className={c.share} data-testid="calc-expectancy">
      <div className={c.splitBar}>
        <span className={c.splitWin} style={{ width: `${w}%` }} />
        <span className={c.splitLoss} style={{ width: `${l}%` }} />
      </div>
      <div className={c.shareLegend}>
        <span><b className={c.green}>{w}%</b> win, about <b className={c.green}>+{card.avg_win_r}R</b> each</span>
        <span><b className={c.red}>{l}%</b> lose, about <b className={c.red}>−{card.avg_loss_r}R</b> each</span>
      </div>
    </div>
  )
}

/** The value at expiry, per share, of the card's position at stock price `s`. */
function payoffAt(card, s) {
  const intr = (k, kind = card.option) => Math.max(0, kind === 'call' ? s - k : k - s)
  // a spread: each leg by its own side (a bought leg adds its value at expiry, a sold one subtracts it), less the net
  // debit (a credit is a negative debit), whatever order the legs are written in (2026-11-15: the curve assumed the
  // first leg was the bought one, so a credit spread written sold-leg-first drew upside down)
  if (Array.isArray(card.legs)) {
    return card.legs.reduce((v, l) => v + (l.side === 'short' ? -1 : 1) * intr(l.strike), 0) - (card.net_debit || 0)
  }
  const prem = Number.isFinite(card.premium) ? card.premium : 0
  return card.side === 'short' ? prem - intr(card.strike) : intr(card.strike) - prem
}

function Payoff({ card, result }) {
  const done = result != null
  const strikes = Array.isArray(card.legs) ? card.legs.map((l) => l.strike) : [card.strike]
  const xs = [...strikes, ...(Number.isFinite(card.underlying) ? [card.underlying] : [])]
  if (done && card.find?.as === 'price') xs.push(result)
  const span = Math.max(...strikes) * 0.12 + (Number.isFinite(card.premium) ? card.premium * 1.5 : 0)
  const x0 = Math.max(0, Math.min(...xs) - span), x1 = Math.max(...xs) + span
  // the labels live in their own bands, above the plot (the strikes, one line each) and under it (the stock), so the
  // payoff line never runs through a word (it crossed "Bought 100" and "Stock 72" on the 2026-11-15 screen check)
  const W = 300, P = 12
  const TOP = 16 + strikes.length * 14, BAND = 22
  const H = TOP + 96 + BAND
  const N = 48
  const pts = Array.from({ length: N + 1 }, (_, i) => x0 + ((x1 - x0) * i) / N)
  const ys = pts.map((s) => payoffAt(card, s))
  const yMin = Math.min(0, ...ys), yMax = Math.max(0, ...ys)
  const sx = (s) => P + ((s - x0) / (x1 - x0)) * (W - 2 * P)
  const plotTop = TOP + 4, plotBottom = H - BAND - 4
  const sy = (y) => (yMax === yMin ? (plotTop + plotBottom) / 2 : plotTop + ((yMax - y) / (yMax - yMin)) * (plotBottom - plotTop))
  const fmt = priceFormat(xs)
  // a label near the right edge reads leftward from its line, so it never leaves the drawing
  const labelAt = (x) => (x > W - 90 ? { x: x - 4, textAnchor: 'end' } : { x: x + 4, textAnchor: 'start' })
  const path = pts.map((s, i) => `${i ? 'L' : 'M'}${sx(s).toFixed(1)},${sy(ys[i]).toFixed(1)}`).join(' ')
  return (
    <div className={c.payoff} data-testid="calc-payoff">
      <svg viewBox={`0 0 ${W} ${H}`} className={c.payoffSvg} role="img" aria-label={`${card.option} payoff at expiry`}>
        <line x1={P} x2={W - P} y1={sy(0)} y2={sy(0)} className={c.axis} />
        {strikes.map((k, i) => (
          <g key={`k${i}`}>
            <line x1={sx(k)} x2={sx(k)} y1={TOP - 2} y2={H - BAND + 2} className={c.strikeLine} />
            {/* a spread's two strike labels sit on two lines, so close strikes never print over each other */}
            <text {...labelAt(sx(k))} y={14 + i * 14} className={c.svgLabel} data-label="strike">{`${strikes.length > 1 ? (card.legs[i].side === 'long' ? 'Bought ' : 'Sold ') : 'Strike '}${fmt(k)}`}</text>
          </g>
        ))}
        {Number.isFinite(card.underlying) ? (
          <g>
            <line x1={sx(card.underlying)} x2={sx(card.underlying)} y1={TOP - 2} y2={H - BAND + 2} className={c.stockLine} />
            <text {...labelAt(sx(card.underlying))} y={H - 6} className={`${c.svgLabel} ${c.svgGold}`} data-label="stock">{`Stock ${fmt(card.underlying)}`}</text>
          </g>
        ) : null}
        {done ? <path d={path} className={c.payoffPath} data-testid="calc-payoff-line" /> : null}
        {done && card.find?.as === 'price' ? <circle cx={sx(result)} cy={sy(0)} r={4.5} className={c.payoffDot} /> : null}
        {done && card.find?.as === 'dollars' && Number.isFinite(card.underlying)
          ? <circle cx={sx(card.underlying)} cy={sy(payoffAt(card, card.underlying))} r={4.5} className={c.payoffDot} /> : null}
      </svg>
      <div className={c.shareLegend}>
        <span>{card.side === 'short' ? 'Sold' : 'Bought'} a <b>{card.option}</b>{Array.isArray(card.legs) ? ' spread' : ''}</span>
        {/* the premium in its own format: the strikes' whole numbers printed a 1.50 premium as "2" */}
        {Number.isFinite(card.premium) ? <span>Premium <b>{priceFormat([card.premium])(card.premium)}</b></span> : null}
        {Number.isFinite(card.net_debit) ? <span>{card.net_debit < 0 ? 'Credit' : 'Debit'} <b>{priceFormat([card.net_debit])(Math.abs(card.net_debit))}</b></span> : null}
      </div>
    </div>
  )
}

const DRAW = { ladder: Ladder, move: Move, recover: Recover, size: Size, range: Range, quote: Quote, share: Share, expectancy: Expectancy, payoff: Payoff }

export default function CalcCard({ item, reveal = null, settled = true, testId = 'calc-card' }) {
  if (!item || itemHasChart(item)) return null
  const card = cardOf(item)
  const scored = reveal ? resultOf(reveal) : null
  const result = scored != null && settled ? scored : null
  const working = result != null ? workingOf(reveal, card) : null
  // the slot and the working line end on the same words as the key the member chose ("$57.50", "0.70")
  const answer = result != null ? answerText(card, item, reveal, result) : ''
  const workingText = working ? `${working.filled} = ${answer || working.result}` : ''
  if (!card) {
    // no picture for this one: the working alone, after the answer
    if (!working) return null
    return (
      <section className={`${c.card} ${c.mathOnly}`} data-testid={testId} data-kind="math">
        <span className={c.eyebrow}>The math</span>
        <p className={c.working} data-testid="calc-working">{workingText}</p>
      </section>
    )
  }
  const Draw = DRAW[card.kind]
  // a hand-written card may name itself ("The base", "The market cap"); a built one is titled by its kind
  const own = typeof card.title === 'string' && card.title.trim() ? card.title.trim() : ''
  const title = own || (card.kind === 'share' && card.part ? 'The share' : card.find?.as === 'times' ? 'The volume' : TITLE[card.kind])
  return (
    <section className={`${c.card} ${result != null ? c.done : ''}`} data-testid={testId} data-kind={card.kind} aria-label={title}>
      <span className={c.eyebrow}>{title}</span>
      <Draw card={card} result={result} />
      <div className={c.find}>
        <span className={c.findLabel}>{card.find.label}</span>
        {result != null
          ? <span className={c.answer} data-testid="calc-answer">{answer}</span>
          : <span className={c.ask} data-testid="calc-ask" aria-label="the answer">?</span>}
      </div>
      {working ? <p className={c.working} data-testid="calc-working">{workingText}</p> : null}
    </section>
  )
}
