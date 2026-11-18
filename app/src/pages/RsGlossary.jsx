// The public Relative Strength glossary (RS Phase 4, unit 4-06; engineering map D15).
//
// A static page that a member, Compass, support and a search engine can all point to:
// the terms UCT's RS indicators use, the common misconceptions, the formulas the
// server actually computes, and three outside references. Public, the same class as
// /methodology/measured-edge: no member data, no live numbers, no API call.
//
// ⛔ THE WORDS ARE NOT RETYPED. The glossary and misconceptions come from
// `content/rs/teachingData.js`, the engine-free half of the 4-02 teaching source
// (the same copy `api/data/rs_teaching.json` exports to Python). Never import
// `teaching.js` here: it reads cards off the chart definition and would pull the
// whole chart engine into a public page.
//
// ⛔ THE FORMULA NUMBERS ARE PINNED. `RS_METHOD` below restates the server's defaults
// (`api/services/rs_weighted_return.py` IBD_TERMS, `api/services/relative_strength.py`
// DEFAULT_*, `api/services/signature/rs_provider.py` _RS_RATING_MA); `RsGlossary.test.jsx`
// parses those Python files and fails if either side moves alone. The rotation lengths
// are read from the Terminal's own `RRG_METHOD`.
//
// ⭐ RS SPLIT (U9, 2026-11-09). One indicator became four (map §(a)): UCT RS Line,
// UCT RS Rating, UCT RS Phases and UCT RS vs 21 EMA, behind the build flag
// `VITE_RS_SPLIT_ENABLED`. This page must be true under BOTH builds:
//   · the "RS indicators" section and the Phases / vs-21-EMA formulas render only when
//     the split ships (`rsSplitEnabled()`, read from `lib/rsSplitFlag.js`, engine-free);
//   · Mansfield, Rotation, Clenow and VARS are described as what they ARE and where
//     UCT computes them (screener columns, the Terminal's rotation graph), never as a
//     chart Reading: true today, when they are also Readings of UCT Relative Strength,
//     and true once the slim RS Line draws none of them.
// The indicator names and the RS Line sentence are pinned to `nativeRegistry.js` by
// the test (parsed from the source, never imported).
//
// Voice (plan v4 §3): plain English, declarative, no emoji, no "buy" or "sell", no
// "guarantee". Everything here is Relative Strength (RS); RSI is named only in the
// misconception that says RS is not RSI.
import { Link } from 'react-router-dom'
import { GLOSSARY, MISCONCEPTIONS } from '../content/rs/teachingData'
import { RRG_METHOD } from './terminal/panels/relativeMath'
import { RS_LEARN_VIDEOS, learnHref } from '../lib/deskVideoHref'
import { rsSplitEnabled } from '../lib/rsSplitFlag'
import { NOT_ADVICE } from '../constants/disclaimer'
import styles from './RsGlossary.module.css'

export const RS_GLOSSARY_PATH = '/methodology/relative-strength'

/** The server's defaults, as printed below. Pinned to the Python constants by the test. */
export const RS_METHOD = Object.freeze({
  /** IBD-style rating terms: [bars back, weight], newest quarter first (IBD_TERMS). */
  ratingTerms: Object.freeze([[63, 0.4], [126, 0.2], [189, 0.2], [252, 0.2]]),
  ratingMax: 99,
  newHighLookback: 252,
  mansfieldLength: 200,
  rotationRatioLen: RRG_METHOD.ratioLen,
  rotationMomLen: RRG_METHOD.momLen,
  clenowWindow: 90,
  clenowYear: 252,
  clenowGapPct: 15,
  atrLength: 20,
  varsLookback: 60,
  varsMaLength: 50,
  // U9: the split's indicators. UCT RS Rating (`rs_provider._RS_RATING_MA`, the
  // `ratingGuides` plot), UCT RS Phases (`relative_strength.DEFAULT_PHASES_*`,
  // `PHASES_SIGMA_WINDOW`, `PHASES_Z_CLAMP`) and UCT RS vs 21 EMA
  // (`DEFAULT_VS_EMA_LENGTH` = the RS line's own `DEFAULT_MA_LENGTH`, `DEFAULT_VS_EMA_FAST/SLOW`).
  ratingMaLength: 21,
  ratingGuides: Object.freeze([80, 90]),
  phasesShort: 3,
  phasesLong: 10,
  phasesSigmaWindow: 63,
  phasesZClamp: 3,
  vsEmaLength: 21,
  vsEmaFast: 3,
  vsEmaSlow: 13,
  // 2026-11-12, UCT RS Exit Warnings: the auto lengths (`relative_strength.EXIT_AUTO_LENGTHS`).
  exitDailyFast: 21,
  exitDailySlow: 50,
  exitWeeklyFast: 8,
  exitWeeklySlow: 21,
})

/**
 * The five RS indicators (U9, and RS Exit Warnings 2026-11-12), shown only when the split ships. `name` is each
 * definition's `meta.name` and the RS Line's `what` is its `meta.description`
 * (`nativeRegistry.js`; the test pins both to the source). The other three take
 * their `what` from the glossary entry authored for them in `teachingData.js`,
 * so the page and the export say the same thing. `lesson` is a `RS_LEARN_VIDEOS`
 * key the definition's `meta.learn` names, or null.
 */
const glossaryDefinition = (key) => GLOSSARY.find((t) => t.key === key)?.definition ?? ''
export const RS_INDICATORS = Object.freeze([
  Object.freeze({
    id: 'rsLine', name: 'UCT RS Line', lesson: 'rsLine',
    what: 'The stock against a benchmark, drawn under the price bars: blue dots on RS new highs, gold when the RS line leads price, and the RS Rating at the line\'s end.',
    more: 'Its average and the shading against it are a switch, off by default; Display in moves the line to a pane of its own.',
  }),
  Object.freeze({ id: 'rsRating', name: 'UCT RS Rating', lesson: null, what: glossaryDefinition('uctRsRating'), more: 'Daily charts only: the rating is a once-a-day rank.' }),
  Object.freeze({ id: 'rsPhases', name: 'UCT RS Phases', lesson: 'rsLine', what: glossaryDefinition('uctRsPhases'), more: null }),
  Object.freeze({ id: 'rsVsEma', name: 'UCT RS vs 21 EMA', lesson: 'phase', what: glossaryDefinition('uctRsVsEma'), more: null }),
  Object.freeze({
    id: 'rsExit', name: 'UCT RS Exit Warnings', lesson: null, what: glossaryDefinition('uctRsExit'),
    more: 'Daily and weekly charts only. The names and meanings are Mike Webster\'s; the exact rules are UCT\'s reading of them.',
  }),
])

/** Glossary terms that have a Desk lesson (keys of `RS_LEARN_VIDEOS`). */
const TERM_LESSON = Object.freeze({
  rsLine: 'rsLine',
  rsNewHigh: 'newHigh',
  rsNewHighBeforePrice: 'beforePrice',
  uctRsVsEma: 'phase',
})

/** The Desk lessons listed under Further reading, one per distinct video moment. */
const LESSON_KEYS = Object.freeze(['rsLine', 'newHigh', 'beforePrice', 'redDay', 'fourChecks'])

export const MEMBERS_LESSON_LABEL = 'Members: watch the lesson'

/** The three outside references (plan v3 §6.11), as plain links. */
export const FURTHER_READING = Object.freeze([
  Object.freeze({
    key: 'chartschool',
    title: 'Price Relative / Relative Strength',
    source: 'StockCharts ChartSchool',
    href: 'https://chartschool.stockcharts.com/table-of-contents/technical-indicators-and-overlays/technical-indicators/price-relative-relative-strength',
    note: 'The plain ratio of one security to another, how it is drawn and how it is read.',
  }),
  Object.freeze({
    key: 'ibd',
    title: 'Use the Relative Strength Line to Identify Emerging Leadership',
    source: "Investor's Business Daily (2015, via Yahoo Finance)",
    href: 'https://finance.yahoo.com/news/relative-strength-line-identify-emerging-210700981.html',
    note: 'IBD on the RS line under the price bars, its slope and its new highs.',
  }),
  Object.freeze({
    key: 'stageanalysis',
    title: 'How to create the Mansfield Relative Performance indicator',
    source: 'Stage Analysis',
    href: 'https://stageanalysis.net/blog/4266/how-to-create-the-mansfield-relative-performance-indicator',
    note: "The Mansfield calculation behind Stan Weinstein's stage analysis.",
  }),
])

const pct = (w) => `${Math.round(w * 100)}%`
const months = (bars) => Math.round(bars / 21)

function Formula({ children, testId }) {
  return <p className={styles.formula} data-testid={testId}>{children}</p>
}

function MethodBlock({ id, title, formula, testId, children }) {
  return (
    <div className={styles.method} aria-labelledby={id} data-testid={testId}>
      <h3 className={styles.h3} id={id}>{title}</h3>
      {formula}
      {children}
    </div>
  )
}

function LessonLink({ lessonKey }) {
  const href = learnHref(lessonKey)
  if (!href) return null
  return (
    <Link className={styles.lesson} to={href} data-testid={`rs-lesson-${lessonKey}`}>
      {MEMBERS_LESSON_LABEL}
    </Link>
  )
}

/** U9: the five indicators, one block each. Rendered only when the split ships. */
function IndicatorsSection() {
  return (
    <section className={styles.section} aria-labelledby="rs-indicators" data-testid="rs-indicators">
      <h2 className={styles.h2} id="rs-indicators">The RS indicators on the chart</h2>
      <p className={styles.body}>
        Relative strength is five indicators in the chart library, each drawing one thing. Add the ones you read;
        every one of them compares the stock with the same benchmark, the S&amp;P 500 unless you pick another.
      </p>
      {RS_INDICATORS.map((ind) => (
        <div className={styles.method} key={ind.id} aria-labelledby={`rs-ind-${ind.id}`} data-testid={`rs-indicator-${ind.id}`}>
          <h3 className={styles.h3} id={`rs-ind-${ind.id}`}>{ind.name}</h3>
          <p className={styles.body}>{ind.what}</p>
          {ind.more ? <p className={styles.body}>{ind.more}</p> : null}
          {ind.lesson ? <LessonLink lessonKey={ind.lesson} /> : null}
        </div>
      ))}
    </section>
  )
}

/** U9: the two formulas the split added, next to the line and the rating. Rendered only when the split ships. */
function SplitFormulas({ m }) {
  return (
    <>
      <MethodBlock
        id="rs-m-phases" title="RS Phases" testId="rs-method-phases"
        formula={(
          <Formula testId="rs-formula-phases">
            RS trend = {m.phasesShort}-bar EMA of the RS line ÷ its {m.phasesLong}-bar EMA − 1
            <br />
            Market trend = the same on the benchmark&rsquo;s close
            <br />
            Divergence = (RS trend − market trend) ÷ its {m.phasesSigmaWindow}-bar standard deviation, capped at {m.phasesZClamp}
          </Formula>
        )}
      >
        <p className={styles.body}>
          A bar is shaded blue when the RS trend is above zero while the market trend is below it, and red for the
          reverse; every other bar is left unpainted. The divergence histogram is the gap between the two trends
          measured against its own recent spread, so a quiet stock and a volatile one read on the same scale.
        </p>
      </MethodBlock>

      <MethodBlock
        id="rs-m-vs-ema" title="RS vs 21 EMA" testId="rs-method-vs-ema"
        formula={(
          <Formula testId="rs-formula-vs-ema">
            Distance = 100 × (RS line ÷ its {m.vsEmaLength}-bar EMA − 1), in percent
            <br />
            Fast = {m.vsEmaFast}-bar EMA of the distance; slow = {m.vsEmaSlow}-bar EMA of the distance
          </Formula>
        )}
      >
        <p className={styles.body}>
          The {m.vsEmaLength}-bar EMA is the RS line&rsquo;s own average, the one the RS Line indicator can draw, so
          the two never disagree. Above zero the RS line is above its average; the two EMAs of the distance smooth
          its path.
        </p>
      </MethodBlock>

      <MethodBlock
        id="rs-m-exit" title="RS Exit Warnings" testId="rs-method-exit"
        formula={(
          <Formula testId="rs-formula-exit">
            Fast and slow average = simple averages of the RS line: {m.exitDailyFast} and {m.exitDailySlow} bars on a
            daily chart, {m.exitWeeklyFast} and {m.exitWeeklySlow} on a weekly one
            <br />
            Quick Break = the RS line closes below its fast average after closing at or above it
            <br />
            Quicksand = after a Quick Break, the first close below the RS value at that break
            <br />
            Grateful Dead Break = the RS line closes below its slow average after closing at or above it
          </Formula>
        )}
      >
        <p className={styles.body}>
          A Quick Break and the Quicksand that follows it belong to one cycle. The cycle ends when the RS line closes
          back at or above its fast average, and the next fall below it is a new Quick Break. Each warning fires once
          per event, on a closed bar. The names and one-line meanings are Mike Webster&rsquo;s; the exact rules here
          are UCT&rsquo;s reading of them, because the published description leaves them open. A warning is a prompt
          to review the position. No published hit rate exists for these signals and UCT has not measured one yet.
        </p>
      </MethodBlock>
    </>
  )
}

export default function RsGlossary() {
  const m = RS_METHOD
  const split = rsSplitEnabled()
  const ratingFormula = m.ratingTerms
    .map(([bars, w]) => `${pct(w)} × (close ÷ close ${bars} bars ago)`)
    .join(' + ')
  const ratingMonths = m.ratingTerms.map(([bars]) => months(bars)).join(', ')

  return (
    <div className={styles.page} data-testid="rs-glossary-page">
      <h1 className={styles.title}>Relative Strength (RS)</h1>
      <p className={styles.lede}>
        Relative Strength compares a stock with the market. A stock can rise and still trail the market, or fall
        and still hold up better than it. This page defines the words UCT uses for relative strength, corrects the
        common mix-ups, and shows exactly how each reading is calculated.
      </p>

      <nav className={styles.toc} aria-label="On this page">
        <a href="#rs-glossary">Glossary</a>
        <a href="#rs-misconceptions">Common misconceptions</a>
        {split ? <a href="#rs-indicators">The RS indicators</a> : null}
        <a href="#rs-method">How UCT computes it</a>
        <a href="#rs-reading">Further reading</a>
      </nav>

      <section className={styles.section} aria-labelledby="rs-glossary" data-testid="rs-glossary-terms">
        <h2 className={styles.h2} id="rs-glossary">Glossary</h2>
        <dl className={styles.terms}>
          {GLOSSARY.map((t) => (
            <div className={styles.term} key={t.key} id={`rs-term-${t.key}`} data-testid={`rs-term-${t.key}`}>
              <dt className={styles.termName}>{t.term}</dt>
              <dd className={styles.termBody}>
                <p className={styles.body}>{t.definition}</p>
                {t.aliases?.length ? (
                  <p className={styles.aliases}>Also called: {t.aliases.join(', ')}</p>
                ) : null}
                {TERM_LESSON[t.key] ? <LessonLink lessonKey={TERM_LESSON[t.key]} /> : null}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <section className={styles.section} aria-labelledby="rs-misconceptions" data-testid="rs-misconceptions">
        <h2 className={styles.h2} id="rs-misconceptions">Common misconceptions</h2>
        <ul className={styles.myths}>
          {MISCONCEPTIONS.map((mc) => (
            <li className={styles.myth} key={mc.key} data-testid={`rs-myth-${mc.key}`}>
              <p className={styles.mythClaim}>
                <span className={styles.mythTag}>Myth</span>
                {mc.myth}
              </p>
              <p className={styles.body}>{mc.truth}</p>
            </li>
          ))}
        </ul>
      </section>

      {split ? <IndicatorsSection /> : null}

      <section className={styles.section} aria-labelledby="rs-method" data-testid="rs-method">
        <h2 className={styles.h2} id="rs-method">How UCT computes it</h2>
        <p className={styles.body}>
          These are the calculations UCT&rsquo;s servers run, with their default settings. A bar is one session on a
          daily chart. Where the benchmark has no bar for a date, that date is skipped, never counted as zero.
        </p>

        <MethodBlock
          id="rs-m-line" title="RS line" testId="rs-method-line"
          formula={<Formula testId="rs-formula-line">RS line = stock close ÷ benchmark close</Formula>}
        >
          <p className={styles.body}>
            Each close is divided by the benchmark&rsquo;s close on the same date. The benchmark is the S&amp;P 500
            unless you pick another. An RS new high is a close of the line at or above its highest value of the
            previous {m.newHighLookback} bars, about one year.
          </p>
        </MethodBlock>

        <MethodBlock
          id="rs-m-rating" title="RS Rating (IBD-style)" testId="rs-method-rating"
          formula={<Formula testId="rs-formula-rating">Score = {ratingFormula}</Formula>}
        >
          <p className={styles.body}>
            {m.ratingTerms.map(([bars]) => bars).join(', ')} bars are roughly {ratingMonths} months, so the most
            recent quarter counts double. Every stock UCT rates is scored, the scores are ranked, and the rank is
            scaled from 1 to {m.ratingMax}: a rating of 90 beat 90% of them. A stock with less than{' '}
            {m.ratingTerms[0][0]} bars of history has no rating; one missing an older quarter is scored on the
            quarters it has, reweighted. IBD does not publish its own formula; this follows the one public
            description of it, so the two can differ.
          </p>
          <p className={styles.body} data-testid="rs-method-rating-history">
            The rating is ranked once a day, so its history is one value per session; its {m.ratingMaLength}-session
            simple average and the {m.ratingGuides.join(' and ')} guides are the ones the RS Rating indicator draws.
          </p>
        </MethodBlock>

        {split ? <SplitFormulas m={m} /> : null}

        <h3 className={styles.h3} id="rs-m-screener" data-testid="rs-method-screener">Readings in the screener</h3>
        <p className={styles.body}>
          The four readings below are computed by the nightly screener build from the same RS line. Each is a
          screener column; the rotation quadrant is also what the Terminal&rsquo;s rotation graph draws.
        </p>

        <MethodBlock
          id="rs-m-mansfield" title="Mansfield RS" testId="rs-method-mansfield"
          formula={(
            <Formula testId="rs-formula-mansfield">
              Mansfield RS = (RS line ÷ its {m.mansfieldLength}-bar simple average − 1) × 100
            </Formula>
          )}
        >
          <p className={styles.body}>
            Zero is the RS line&rsquo;s own long-run trend. Above zero means the stock is outperforming that trend
            against the benchmark; below zero means it is underperforming it. Weinstein used 52 bars on weekly
            charts; UCT&rsquo;s Mansfield RS column reads {m.mansfieldLength} daily bars.
          </p>
        </MethodBlock>

        <MethodBlock
          id="rs-m-rotation" title="Rotation (RRG-style)" testId="rs-method-rotation"
          formula={(
            <Formula testId="rs-formula-rotation">
              RS = 100 × stock close ÷ benchmark close
              <br />
              RS-Ratio = 100 × RS ÷ {m.rotationRatioLen}-bar simple average of RS
              <br />
              RS-Momentum = 100 × RS-Ratio ÷ {m.rotationMomLen}-bar simple average of RS-Ratio
            </Formula>
          )}
        >
          <p className={styles.body}>
            Both readings centre on 100. The quadrant comes from which side of 100 each one sits: Leading (RS-Ratio
            and RS-Momentum both 100 or more), Weakening (RS-Ratio 100 or more, RS-Momentum under 100), Lagging (both
            under 100) and Improving (RS-Ratio under 100, RS-Momentum 100 or more). The Terminal&rsquo;s rotation
            graph and the screener&rsquo;s weekly Rotation Quadrant column both use it. The name follows Relative
            Rotation Graphs, whose own normalisation is proprietary; this is UCT&rsquo;s simpler formula in the same
            spirit, not that calculation.
          </p>
        </MethodBlock>

        <MethodBlock
          id="rs-m-quality" title="Quality (Clenow)" testId="rs-method-quality"
          formula={(
            <Formula testId="rs-formula-quality">
              Quality = ((1 + b)<sup>{m.clenowYear}</sup> − 1) × R²
            </Formula>
          )}
        >
          <p className={styles.body}>
            A straight line is fitted to the natural log of the last {m.clenowWindow} closes, a common choice for
            this measure; b is that line&rsquo;s slope per bar, so (1 + b)<sup>{m.clenowYear}</sup> − 1 is the
            slope annualised over a {m.clenowYear}-session year. R², from 0 to 1, is how closely the closes follow
            the line. A steady climb scores higher than a jumpy one with the same gain. Any single-bar move larger
            than {m.clenowGapPct}% inside the window is flagged. This reading describes the stock&rsquo;s own trend;
            it does not use the benchmark. It is the screener&rsquo;s Clenow Trend Score column.
          </p>
        </MethodBlock>

        <MethodBlock
          id="rs-m-vars" title="VARS (volatility-adjusted RS)" testId="rs-method-vars"
          formula={(
            <Formula testId="rs-formula-vars">
              Each bar: d = stock&rsquo;s close change ÷ its {m.atrLength}-bar ATR − benchmark&rsquo;s close change ÷
              its {m.atrLength}-bar ATR
              <br />
              VARS = sum of d over the last {m.varsLookback} bars, read against its {m.varsMaLength}-bar simple
              average
            </Formula>
          )}
        >
          <p className={styles.body}>
            ATR, the average true range, is a series&rsquo; typical bar-to-bar range. Dividing each move by it puts a
            volatile stock and a quiet index on the same scale. Above zero, the stock has outperformed in those
            terms; above its average, it is gaining. That gives four states: strong and gaining, strong but fading,
            weak but improving, and weak. They are the screener&rsquo;s Volatility-Adjusted RS State column.
          </p>
        </MethodBlock>
      </section>

      <section className={styles.section} aria-labelledby="rs-reading" data-testid="rs-further-reading">
        <h2 className={styles.h2} id="rs-reading">Further reading</h2>
        <ul className={styles.links}>
          {FURTHER_READING.map((r) => (
            <li className={styles.linkItem} key={r.key}>
              <a
                className={styles.extLink} href={r.href} target="_blank" rel="noopener noreferrer"
                data-testid={`rs-ref-${r.key}`}
              >
                {r.title}
              </a>
              <span className={styles.source}>{r.source}</span>
              <p className={styles.body}>{r.note}</p>
            </li>
          ))}
        </ul>

        <h3 className={styles.h3}>Lessons on the Desk</h3>
        <p className={styles.body}>The Desk is part of the UCT membership; these lessons open there.</p>
        <ul className={styles.links} data-testid="rs-lessons">
          {LESSON_KEYS.map((k) => (
            <li className={styles.linkItem} key={k}>
              <span className={styles.lessonTitle}>{RS_LEARN_VIDEOS[k].label}</span>
              <LessonLink lessonKey={k} />
            </li>
          ))}
        </ul>
      </section>

      <p className={styles.notAdvice} data-testid="rs-glossary-not-advice">{NOT_ADVICE}</p>
    </div>
  )
}
