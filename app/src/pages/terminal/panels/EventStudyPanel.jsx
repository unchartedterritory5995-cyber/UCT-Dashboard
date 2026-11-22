// EVST: "What happened next", a member's own historical study. `EVST`, or `NVDA EVST` to measure NVDA.
//
//   Every time <a condition on a series>, what did <a symbol> do afterwards?
//
// The series come from the server's menu (market breadth, technical indicators over UCT's stored
// closes, CFTC futures positioning), grouped by category; the threshold and condition; the symbol
// measured afterwards (SPY, or the shell's ticker); up to four windows (1, 3 and 6 months to start);
// how episodes are counted and where they are entered (the engine's own defaults). Run. The answer:
// per window, the episodes, the share that were up, the average and median, the worst and best, and
// the same windows from every session as the comparison; then every episode newest first; then the
// engine's own method in words. Two or three ready-made studies are one click away.
//
// TWO reads through the shared reader (paid): the menu `GET /api/research/event-study/series`, and the
// study `GET /api/research/event-study?...` (api/routers/event_study.py). The server never computes on
// the request: a new study says it is being worked out and this panel asks again every few seconds
// (SWR's refresh, which pauses while the app is hidden). The pure half is eventStudyModel.js.
//
// The member's last study is kept in this browser (localStorage, in try/catch, as SIZE keeps its
// account): it opens on it next time.
//
// ⛔ A MISSING NUMBER IS NEVER 0: a window with no completed outcome says "too little history", a study
// with no episode says so, a return not known yet is "open".
// ⛔ A RECORD, NOT A FORECAST. Green and red mark the sign of a return only.
//
// WIDTH. The form is a grid that folds to one column in a narrow panel and on a phone; the window
// table is four columns of two-line cells; the episode list is the date with its value, then one
// short column per window (four at most). Nothing folds away; cells wrap between words.
import { Fragment, useId, useMemo, useState } from 'react'
import { PanelSkeleton, PanelState, PanelSymbol, panelAsOf, useInTerminalPanel, usePanelFreshness } from '../../../components/terminal'
import Checkbox from '../../../components/ui/Checkbox'
import FieldError from '../../../components/ui/FieldError'
import Input from '../../../components/ui/Input'
import Select from '../../../components/ui/Select'
import { WARMING_TITLE, canRetry, failureKind, failureText, useMarketRead } from './marketRead'
import {
  ENTRY_WORDS, EPISODE_WORDS, EVST_CODE, EVST_MENU_WHAT, EVST_SERIES_URL, EVST_WHAT, OPS, OP_WORDS, WINDOWS,
  baselineRow, checkSpec, countText, coverageText, episodeCell, episodesHeading, leadParts, noEpisodesText,
  loadStoredSpec, normSpec, normWindows, pollFor, readMenu, readStudy, readySpec, saveStoredSpec, seriesMeasure, startSpec, studyUrl, switchKind,
  thresholdHint, valueText, windowRow, windowShort,
} from './eventStudyModel'
import { dayText } from './ratesModel'
import styles from './marketPanels.module.css'
import own from './eventStudyPanel.module.css'

export { EVST_CODE, EVST_SERIES_URL, EVST_STORE_KEY } from './eventStudyModel'

const signClass = (sign) => (sign === 'up' ? styles.up : sign === 'down' ? styles.down : undefined)
const OP_OPTIONS = OPS.map((o) => ({ value: o, label: OP_WORDS[o] }))
const EPISODE_OPTIONS = Object.entries(EPISODE_WORDS).map(([value, label]) => ({ value, label }))
const ENTRY_OPTIONS = Object.entries(ENTRY_WORDS).map(([value, label]) => ({ value, label }))

/** One field: its label and control (written at the call, so each label names its control's own id),
 *  the hint under it and the error the checks found. */
function Field({ id, error, hint, children }) {
  return (
    <div className={own.field}>
      {children}
      {hint ? <span className={own.hint} id={`${id}-hint`}>{hint}</span> : null}
      <FieldError forId={id} className={own.error}>{error}</FieldError>
    </div>
  )
}

function StudyForm({ menu, draft, setDraft, errors, onRun, dirty }) {
  const uid = useId()
  const id = (k) => `${uid}-${k}`
  const set = (patch) => setDraft({ ...draft, ...patch })
  const measure = seriesMeasure(menu, draft)
  const period = draft.kind === 'technical' ? measure?.period : null
  const windows = menu.windows.length ? menu.windows : Object.keys(WINDOWS)
  const picked = normWindows(draft.horizons)
  const full = picked.length >= menu.maxWindows
  const toggle = (t) => set({ horizons: picked.includes(t) ? picked.filter((x) => x !== t) : normWindows([...picked, t]) })
  return (
    <form className={own.form} onSubmit={(e) => { e.preventDefault(); onRun() }} aria-label="Build your own study" data-testid="terminal-evst-form" noValidate>
      <Field id={id('kind')} error={errors.kind}>
        <label className={own.label} htmlFor={id('kind')}>Series</label>
        <Select id={id('kind')} className={own.control} value={draft.kind} options={menu.kinds}
          onChange={(e) => setDraft(switchKind(draft, e.target.value))} data-testid="terminal-evst-kind" />
      </Field>
      {draft.kind === 'breadth' ? (
        <>
          <Field id={id('universe')}>
            <label className={own.label} htmlFor={id('universe')}>Stocks</label>
            <Select id={id('universe')} className={own.control} value={draft.universe} options={menu.universes}
              onChange={(e) => set({ universe: e.target.value })} data-testid="terminal-evst-universe" />
          </Field>
          <Field id={id('metric')}>
            <label className={own.label} htmlFor={id('metric')}>Measure</label>
            <Select id={id('metric')} className={own.control} value={draft.metric} options={menu.metrics.map(({ value, label }) => ({ value, label }))}
              onChange={(e) => set({ metric: e.target.value })} data-testid="terminal-evst-metric" />
          </Field>
        </>
      ) : null}
      {draft.kind === 'technical' ? (
        <>
          <Field id={id('series')} error={errors.series}>
            <label className={own.label} htmlFor={id('series')}>Ticker measured</label>
            <Input id={id('series')} className={own.control} value={draft.series} error={errors.series} autoComplete="off" spellCheck={false}
              onChange={(e) => set({ series: e.target.value.toUpperCase() })} data-testid="terminal-evst-series" />
          </Field>
          <Field id={id('indicator')}>
            <label className={own.label} htmlFor={id('indicator')}>Indicator</label>
            <Select id={id('indicator')} className={own.control} value={draft.indicator}
              options={menu.indicators.map(({ value, label }) => ({ value, label }))}
              onChange={(e) => {
                const next = menu.indicators.find((i) => i.value === e.target.value)
                set({ indicator: e.target.value, period: next?.period?.def != null ? String(next.period.def) : '' })
              }} data-testid="terminal-evst-indicator" />
          </Field>
          {period ? (
            <Field id={id('period')} error={errors.period} hint={`From ${period.min} to ${period.max}.`}>
              <label className={own.label} htmlFor={id('period')}>Period (sessions)</label>
              <Input id={id('period')} className={own.control} type="number" inputMode="numeric" min={period.min} max={period.max}
                value={draft.period} error={errors.period} aria-describedby={`${id('period')}-hint`}
                onChange={(e) => set({ period: e.target.value })} data-testid="terminal-evst-period" />
            </Field>
          ) : null}
        </>
      ) : null}
      {draft.kind === 'cot' ? (
        <>
          <Field id={id('market')}>
            <label className={own.label} htmlFor={id('market')}>Futures market</label>
            <Select id={id('market')} className={own.control} value={draft.market} options={menu.markets}
              onChange={(e) => set({ market: e.target.value })} data-testid="terminal-evst-market" />
          </Field>
          <Field id={id('group')}>
            <label className={own.label} htmlFor={id('group')}>Traders (net contracts)</label>
            <Select id={id('group')} className={own.control} value={draft.group} options={menu.groups}
              onChange={(e) => set({ group: e.target.value })} data-testid="terminal-evst-group" />
          </Field>
        </>
      ) : null}
      <Field id={id('op')}>
        <label className={own.label} htmlFor={id('op')}>Condition</label>
        <Select id={id('op')} className={own.control} value={draft.op} options={OP_OPTIONS}
          onChange={(e) => set({ op: e.target.value })} data-testid="terminal-evst-op" />
      </Field>
      <Field id={id('threshold')} error={errors.threshold} hint={thresholdHint(measure)}>
        <label className={own.label} htmlFor={id('threshold')}>Threshold</label>
        <Input id={id('threshold')} className={own.control} value={draft.threshold} inputMode="decimal" autoComplete="off"
          error={errors.threshold} aria-describedby={`${id('threshold')}-hint`}
          onChange={(e) => set({ threshold: e.target.value })} data-testid="terminal-evst-threshold" />
      </Field>
      <Field id={id('symbol')} error={errors.symbol} hint="The ticker whose return is measured afterwards.">
        <label className={own.label} htmlFor={id('symbol')}>Then measure</label>
        <Input id={id('symbol')} className={own.control} value={draft.symbol} autoComplete="off" spellCheck={false}
          error={errors.symbol} aria-describedby={`${id('symbol')}-hint`}
          onChange={(e) => set({ symbol: e.target.value.toUpperCase() })} data-testid="terminal-evst-symbol" />
      </Field>
      <fieldset className={own.windows} data-testid="terminal-evst-windows" aria-describedby={errors.horizons ? `${id('windows')}-error` : undefined}>
        <legend className={own.label}>{`Windows (up to ${menu.maxWindows})`}</legend>
        <div className={own.checks}>
          {windows.map((t) => (
            <label key={t} className={own.check}>
              <Checkbox checked={picked.includes(t)} disabled={!picked.includes(t) && full} onChange={() => toggle(t)}
                data-testid={`terminal-evst-window-${t}`} />
              <span>{WINDOWS[t].name}</span>
            </label>
          ))}
        </div>
        <FieldError forId={id('windows')} className={own.error}>{errors.horizons}</FieldError>
      </fieldset>
      <Field id={id('episodes')}>
        <label className={own.label} htmlFor={id('episodes')}>Count</label>
        <Select id={id('episodes')} className={own.control} value={draft.episodes} options={EPISODE_OPTIONS}
          onChange={(e) => set({ episodes: e.target.value })} data-testid="terminal-evst-episodes" />
      </Field>
      <Field id={id('entry')}>
        <label className={own.label} htmlFor={id('entry')}>Measure from</label>
        <Select id={id('entry')} className={own.control} value={draft.entry} options={ENTRY_OPTIONS}
          onChange={(e) => set({ entry: e.target.value })} data-testid="terminal-evst-entry" />
      </Field>
      <div className={own.actions}>
        <button type="submit" className={`${styles.chip} ${own.run}`} data-testid="terminal-evst-run">Run the study</button>
        {dirty ? <span className={own.hint} role="status" data-testid="terminal-evst-dirty">Run to see this study.</span> : null}
      </div>
    </form>
  )
}

function WindowTable({ view }) {
  return (
    <div className={styles.tableBox}>
      <table className={styles.table} data-testid="terminal-evst-windows-table"
        aria-label={`What ${view.spec?.symbol || 'the symbol'} did after each episode, per window, against all sessions`}>
        <thead>
          <tr>
            <th scope="col">After</th>
            <th scope="col" title="The share of episodes after which the return was above zero">Up</th>
            <th scope="col">Average, median</th>
            <th scope="col">Worst, best</th>
          </tr>
        </thead>
        <tbody>
          {view.horizons.map((h, i) => {
            const row = windowRow(view, h)
            const base = baselineRow(view, h.token)
            return (
              <Fragment key={h.token || i}>
                <tr data-testid="terminal-evst-window" data-token={h.token} data-kind={row.kind}>
                  <td className={styles.phoneWrap}>
                    <span className={own.strong}>{row.name}</span>
                    {row.kind === 'value' ? <><br /><span className={styles.muted}>{row.episodes}</span></> : null}
                  </td>
                  {row.kind === 'value' ? (
                    <>
                      <td className={styles.phoneWrap}>{row.rate}<br /><span className={styles.muted}>{row.upOf}</span></td>
                      <td className={styles.phoneWrap}>
                        <span className={signClass(row.meanSign)}>{row.mean}</span><br />
                        <span className={styles.muted}>median </span><span className={signClass(row.medianSign)}>{row.median}</span>
                      </td>
                      <td className={styles.phoneWrap}>
                        <span className={signClass(row.worstSign)}>{row.worst}</span>
                        {row.worstDate ? <span className={`${styles.muted} ${styles.phoneHide}`}>{` (${dayText(row.worstDate)})`}</span> : null}<br />
                        <span className={signClass(row.bestSign)}>{row.best}</span>
                        {row.bestDate ? <span className={`${styles.muted} ${styles.phoneHide}`}>{` (${dayText(row.bestDate)})`}</span> : null}
                      </td>
                    </>
                  ) : (
                    <td colSpan={3} className={`${styles.phoneWrap} ${own.wordCell}`} data-testid="terminal-evst-window-missing">{row.text}</td>
                  )}
                </tr>
                {base ? (
                  <tr className={own.baseRow} data-testid="terminal-evst-baseline" data-token={h.token}>
                    <td className={styles.phoneWrap}><span className={styles.muted}>All sessions</span><br /><span className={styles.muted}>{base.sessions}</span></td>
                    <td className={styles.phoneWrap}><span className={styles.muted}>{base.rate}</span></td>
                    <td className={styles.phoneWrap}>
                      <span className={signClass(base.meanSign)}>{base.mean}</span><br />
                      <span className={styles.muted}>median </span><span className={signClass(base.medianSign)}>{base.median}</span>
                    </td>
                    <td><span className={styles.muted}>n/a</span></td>
                  </tr>
                ) : null}
                {row.kind === 'value' && (row.open || row.missing) ? (
                  <tr>
                    <td colSpan={4} className={`${styles.phoneWrap} ${own.wordCell}`} data-testid="terminal-evst-window-open">
                      <span className={styles.muted}>
                        {row.open ? `${row.open} more ${row.open === 1 ? 'episode is' : 'episodes are'} still open for ${row.name}. ` : ''}
                        {row.missing ? `${row.missing} without a stored close on the exit day.` : ''}
                      </span>
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function EpisodeTable({ view }) {
  const tokens = view.tokens
  return (
    <>
      <h4 className={own.blockTitle} data-testid="terminal-evst-episodes-heading">{episodesHeading(view)}</h4>
      <div className={styles.tableBox}>
        <table className={styles.table} data-testid="terminal-evst-episodes" aria-label="Every episode, newest first, with the return over each window">
          <thead>
            <tr>
              <th scope="col">Episode</th>
              {tokens.map((t) => <th scope="col" key={t} title={WINDOWS[t].name}>{windowShort(t)}</th>)}
            </tr>
          </thead>
          <tbody>
            {view.events.map((ep) => (
              <tr key={ep.date} data-testid="terminal-evst-episode" data-date={ep.date}>
                <td className={styles.phoneWrap}>
                  {dayText(ep.date)}<br />
                  <span className={styles.muted}>{`at ${valueText(ep.value, view.series.unit)}`}</span>
                </td>
                {tokens.map((t) => {
                  const c = episodeCell(ep, t)
                  return (
                    <td key={t} data-kind={c.kind}>
                      {c.kind === 'value' ? <span className={signClass(c.sign)}>{c.text}</span> : <span className={styles.muted} title={c.title}>{c.text}</span>}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

function StudyAnswer({ url, code }) {
  const [pace, setPace] = useState(0)
  const read = useMarketRead(url, { refreshInterval: pace })
  const view = useMemo(() => readStudy(read.body), [read.body])
  const want = read.body ? pollFor(view) : 0
  if (want !== pace) setPace(want)
  const ok = !read.loading && view.state === 'ok'
  usePanelFreshness(ok ? panelAsOf(view.source, view.coverage.priceLast) : null)

  const box = (state, body) => <section className={own.answer} data-testid="terminal-evst-answer" data-state={state} aria-label="The study">{body}</section>
  if (read.loading) return box('loading', <PanelSkeleton label="Working out the study" testId="terminal-evst-loading" />)
  if (!read.body || view.state === 'failed') {
    const err = read.body ? null : read.error
    if (err?.status === 422) {
      return box('refused', (
        <PanelState kind="error" testId="terminal-evst-refused" title="The server could not take that study.">
          Check the series, the threshold and the windows, then run it again.
        </PanelState>
      ))
    }
    const locked = err ? !canRetry(err) : false
    return box('error', (
      <PanelState kind={err ? failureKind(err) : 'error'} testId="terminal-evst-error"
        title={err ? failureText(err, EVST_WHAT) : `${EVST_WHAT} could not be read just now.`}
        action={locked ? null : <button type="button" className={styles.chip} onClick={read.retry}>Retry</button>}>
        {locked ? null : `Retry, or run ${code} again.`}
      </PanelState>
    ))
  }
  if (view.state === 'computing') {
    return box('computing', (
      <PanelState kind="empty" role="status" testId="terminal-evst-computing" title={WARMING_TITLE}>
        The server is working this study out over the whole history it holds. It fills in on its own.
      </PanelState>
    ))
  }
  if (view.state === 'busy') {
    return box('busy', (
      <PanelState kind="empty" role="status" testId="terminal-evst-busy" title={view.detail || 'The server is busy. This study runs again in a moment.'}
        action={<button type="button" className={styles.chip} onClick={read.retry}>Retry</button>}>
        This panel asks again on its own.
      </PanelState>
    ))
  }
  if (view.state === 'unavailable') {
    return box('unavailable', (
      <PanelState kind="empty" role="status" testId="terminal-evst-unavailable" title={view.detail || 'This study cannot be worked out from the history held.'}>
        {view.reason === 'not_enough_history' || view.reason === 'no_overlap'
          ? 'Too little history for this study: try a longer-lived series, another symbol or shorter windows.'
          : 'Change the series, the symbol or the windows and run it again.'}
      </PanelState>
    ))
  }

  const sym = view.spec?.symbol
  const lead = leadParts(view)
  const counted = countText(view)
  const cov = coverageText(view)
  return box('ok', (
    <>
      {read.error ? <p className={styles.note} role="status" data-testid="terminal-evst-stale-read">{failureText(read.error, EVST_WHAT)} Showing the last read.</p> : null}
      <p className={styles.lede} data-testid="terminal-evst-lead">
        {view.counts.used ? lead.head : noEpisodesText(view)}
        {view.counts.used && sym ? <>{' '}<PanelSymbol sym={sym} className={styles.sym} />{` ${lead.tail}`}</> : null}
      </p>
      {counted ? <p className={styles.muted} data-testid="terminal-evst-counted">{counted}</p> : null}
      {view.counts.used ? (
        <>
          {view.caveats.map((c) => <p key={c} className={styles.note} role="note" data-testid="terminal-evst-caveat">{c}</p>)}
          <WindowTable view={view} />
          <EpisodeTable view={view} />
        </>
      ) : (
        <PanelState kind="empty" role="status" testId="terminal-evst-none" title="No episodes in the history held.">
          That is a result, not an error: loosen the threshold or pick another condition to find some.
        </PanelState>
      )}
      {view.notes.length ? (
        <ul className={own.notes} data-testid="terminal-evst-notes">
          {view.notes.map((n) => <li key={n} className={styles.muted}>{n}</li>)}
        </ul>
      ) : null}
      {cov ? <p className={styles.muted} data-testid="terminal-evst-coverage">{cov}</p> : null}
      <h4 className={own.blockTitle}>How it is counted</h4>
      <ul className={own.notes} data-testid="terminal-evst-method">
        {view.method.map((m) => <li key={m} className={styles.muted}>{m}</li>)}
      </ul>
      <p className={styles.muted} data-testid="terminal-evst-source">
        {`${view.source}. Green and red mark the sign of a return only. A record of what happened, not a forecast.`}
      </p>
    </>
  ))
}

function EventStudyBody({ sym, code }) {
  const menuRead = useMarketRead(EVST_SERIES_URL)
  const menu = useMemo(() => readMenu(menuRead.body), [menuRead.body])
  const [stored] = useState(() => loadStoredSpec())
  const [applied, setApplied] = useState(() => startSpec(stored, sym))
  const [draft, setDraft] = useState(applied)
  const [errors, setErrors] = useState({})
  const [open, setOpen] = useState(() => !stored)
  const url = studyUrl(applied)

  const apply = (spec) => {
    setApplied(spec)
    setDraft(spec)
    setErrors({})
    saveStoredSpec(spec)
  }
  const run = () => {
    const ready = readySpec(draft, menu)
    const errs = checkSpec(ready, menu)
    if (Object.keys(errs).length) { setErrors(errs); return }
    apply(ready)
  }
  const pickExample = (ex) => apply(normSpec(ex.spec))
  const dirty = studyUrl(readySpec(draft, menu)) !== url
  const appliedKey = url

  const menuState = menuRead.loading ? 'loading' : menu.state
  return (
    <div className={own.stack}>
      <p className={styles.muted} data-testid="terminal-evst-intro">
        Every time a condition held on a series, what did a stock or fund do next? Pick a ready-made study or build your own from
        market breadth, technical indicators or futures positioning.
      </p>
      {menuState === 'ok' && menu.examples.length ? (
        <ul className={own.examples} aria-label="Ready-made studies" data-testid="terminal-evst-examples">
          {menu.examples.map((ex) => {
            const on = studyUrl(ex.spec) === appliedKey
            return (
              <li key={ex.id}>
                <button type="button" className={`${styles.chip} ${own.example}`} aria-pressed={on} onClick={() => pickExample(ex)}
                  data-testid={`terminal-evst-example-${ex.id}`}>{ex.name}</button>
              </li>
            )
          })}
        </ul>
      ) : null}
      <div className={own.yours}>
        <button type="button" className={`${styles.chip} ${own.toggle}`} aria-expanded={open} onClick={() => setOpen(!open)} data-testid="terminal-evst-edit">
          {open ? 'Hide the form' : 'Change the study'}
        </button>
      </div>
      {open ? (
        menuState === 'loading' ? <PanelSkeleton label="Loading the list of series" testId="terminal-evst-menu-loading" />
          : menuState === 'ok' ? <StudyForm menu={menu} draft={draft} setDraft={setDraft} errors={errors} onRun={run} dirty={dirty} />
            : (
              <PanelState kind={menuRead.error ? failureKind(menuRead.error) : 'error'} testId="terminal-evst-menu-error"
                title={menuRead.error ? failureText(menuRead.error, EVST_MENU_WHAT) : `${EVST_MENU_WHAT} could not be read just now.`}
                action={menuRead.error && !canRetry(menuRead.error) ? null : <button type="button" className={styles.chip} onClick={menuRead.retry}>Retry</button>}>
                {menuRead.error && !canRetry(menuRead.error) ? null : 'The study below still stands.'}
              </PanelState>
            )
      ) : null}
      {menuState === 'ok' && menu.notOffered.length && open ? (
        <p className={styles.muted} data-testid="terminal-evst-not-offered">
          {`Not offered yet: ${menu.notOffered.map((x) => `${x.name.toLowerCase()} (${x.why.replace(/\.$/, '').toLowerCase()})`).join('; ')}.`}
        </p>
      ) : null}
      {url ? <StudyAnswer key={url} url={url} code={code} /> : null}
    </div>
  )
}

export default function EventStudyPanel({ sym }) {
  const inPanel = useInTerminalPanel()
  const code = inPanel?.code || EVST_CODE
  const s = String(sym || '').trim().toUpperCase() || null
  return (
    <div className={`${styles.wrap} ${inPanel ? styles.inPanel : ''}`} data-testid="terminal-evst" data-sym={s || undefined}>
      <EventStudyBody key={s || 'market'} sym={s} code={code} />
    </div>
  )
}
