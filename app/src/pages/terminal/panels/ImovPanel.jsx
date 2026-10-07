// IMOV — which names are driving a UCT theme's move (feature-gaps-2026-10-06 #4; Bloomberg
// `IMOV`/`MOV`, "what is dragging the group", 06 §movers).
//
//   IMOV              the theme moving most today (or the one you last opened), with a picker
//   IMOV 1W           the same over a week (1D · 1W · 1M · 3M)
//   NVDA IMOV         the UCT theme NVDA belongs to, with NVDA's own share of the move
//   IMOV semiconductors · IMOV "AI / GPU Chips"   a theme BY NAME (case/spacing-insensitive, a
//                     unique prefix opens it; several or none get a visible "did you mean")
//   IMOV THEME SEMIS  the form the panel writes back when you pick a theme, so the pick survives a
//                     reload, the URL and history (one ticker-shaped word alone is a ticker)
//   SPY IMOV          refused: an index moves on cap weights UCT does not hold
//
// ⭐ EQUAL WEIGHT, SAID OUT LOUD. A UCT theme is an equal-weight basket, so each name contributes
// its return ÷ N and the contributions add up to the theme's equal-weight return (imovModel.js).
// The panel shows that sum and the three parts it is made of, so it always reconciles on screen.
//
// ⭐ NO NEW ROUTE, NO VENDOR CALL. It reads `/api/theme-performance`, the cached, live-overlaid
// payload the Theme Tracker tile already polls (same SWR key, so a board with both makes one read).
//
// Clicking a row, or typing its number + Enter, LOADS that name into the linked group and keeps
// every panel's function (the shell's Shift+Enter path). When this panel follows the group too, it
// reopens on the theme it was showing, if that theme holds the new name.
import { useEffect, useMemo, useState } from 'react'
import useMobileSWR from '../../../hooks/useMobileSWR'
import useMarketOpen from '../../../hooks/useMarketOpen'
import jsonFetcher from '../../../utils/jsonFetcher'
import Select from '../../../components/ui/Select'
import { sessionModel } from '../../../components/dashboard/sessionModel'
import { PanelSkeleton, PanelState, useInTerminalPanel, usePanelFreshness } from '../../../components/terminal'
import { formatNumber, formatPercent, formatTimeEt } from '../../../lib/presentation/presentationPrimitives'
import {
  DEFAULT_WINDOW, IMOV_WINDOWS, INDEX_FUNDS, POLL_MS, THEMES_URL, TOP_N,
  biggestMover, contributionRead, imovCommand, matchTheme, normSym, refusalFor, splitRead, themeKey, themesHolding,
  themesOf, trackerDiffers,
} from './imovModel'
import styles from './imovPanel.module.css'

const SWR_OPTS = { refreshInterval: POLL_MS, marketHoursOnly: true, keepPreviousData: true, revalidateOnFocus: false }

/** The theme this tab last showed. A row click reloads the panel on a new name (the shell keys the
 *  body on its security); remembering the theme keeps it on the same basket when that basket holds
 *  the name. Per tab, in memory: nothing is stored. */
let lastThemeKey = null
/** Tests only: forget the remembered theme. */
export function resetImovMemory() { lastThemeKey = null }

/** Percentage points, signed: the unit a contribution is in. */
export function formatPts(v) {
  if (!Number.isFinite(v)) return formatNumber(null)
  const r = Math.abs(v) < 0.005 ? 0 : v
  return `${r > 0 ? '+' : ''}${formatNumber(r, { decimals: 2 })} pts`
}

const tone = (v) => (v > 0 ? styles.up : v < 0 ? styles.down : undefined)

function failureText(err) {
  if (err?.status === 402) return 'Theme performance needs a paid plan.'
  if (err?.timedOut) return 'Theme performance did not answer within 30 seconds.'
  return 'Theme performance could not be read just now.'
}

function ContribTable({ title, rows, start, n, sym, onLoad, testId }) {
  if (!rows.length) return null
  return (
    <div className={styles.tableBox}>
      <table className={styles.table} data-testid={testId}>
        <caption className={styles.caption}>{title}</caption>
        <thead>
          <tr>
            <th scope="col">Symbol</th>
            <th scope="col" title="The name's own return over the window">Return</th>
            <th scope="col" title={`Return ÷ ${n} (equal weight)`}>Contribution</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.sym} data-testid={`terminal-imov-row-${r.sym}`} className={r.sym === sym ? styles.mine : undefined}>
              <td>
                <button type="button" className={styles.rowBtn} onClick={() => onLoad(r.sym)}
                  title={`Load ${r.sym} into the linked panels`}>
                  <span className={styles.rowNum}>{start + i + 1}</span>
                  <span className={styles.sym}>{r.sym}</span>
                </button>
              </td>
              <td className={tone(r.ret)}>{formatPercent(r.ret, { decimals: 2, signed: true })}</td>
              <td className={tone(r.contrib)}>{formatPts(r.contrib)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function ImovPanel({ sym: symProp = null, win: winProp = null, theme: themeQuery = null, onRun, onRows }) {
  const inPanel = useInTerminalPanel()
  const market = useMarketOpen()
  const sym = symProp ? normSym(symProp) : null
  const [win, setWin] = useState(IMOV_WINDOWS[winProp] ? winProp : DEFAULT_WINDOW)
  const [picked, setPicked] = useState(null)

  // An index fund is refused before anything is read: there is nothing to wait for (unless a
  // theme was named, which is a different, answerable question).
  const indexRefusal = sym && INDEX_FUNDS.includes(sym) && !picked && !themeQuery
  const perf = useMobileSWR(indexRefusal ? null : THEMES_URL, jsonFetcher, SWR_OPTS)
  const themes = useMemo(() => themesOf(perf.data), [perf.data])
  const byKey = useMemo(() => new Map(themes.map((t) => [themeKey(t), t])), [themes])
  const holding = useMemo(() => (sym ? themesHolding(themes, sym) : []), [themes, sym])
  // A theme NAMED on the command line (`IMOV semiconductors`), resolved against what was read.
  const named = useMemo(() => (themeQuery && !picked && themes.length ? matchTheme(themes, themeQuery) : null),
    [themeQuery, picked, themes])
  const namedTheme = named?.status === 'ok' ? named.theme : null
  const refusal = sym && !picked && !themeQuery ? refusalFor(themes, sym) : null

  // `defaulted`: nothing was asked and nothing was remembered, so the panel chose the biggest mover
  // and says so. Decided once per mount (the remembered theme is read at mount, not on every render).
  // The default is PINNED once chosen: a window change or the next 30 s poll must never swap the
  // theme under the member because another basket overtook it.
  const [remembered] = useState(() => lastThemeKey)
  const [seedWin] = useState(win)
  const [autoKey, setAutoKey] = useState(null)
  const { theme, defaulted } = useMemo(() => {
    if (picked) return { theme: byKey.get(picked) || null, defaulted: false }
    if (themeQuery) return { theme: namedTheme, defaulted: false }
    if (refusal) return { theme: null, defaulted: false }
    if (sym) return { theme: holding.find((t) => themeKey(t) === remembered) || holding[0] || null, defaulted: false }
    const kept = byKey.get(remembered)
    if (kept) return { theme: kept, defaulted: false }
    return { theme: byKey.get(autoKey) || biggestMover(themes, seedWin), defaulted: true }
  }, [picked, themeQuery, namedTheme, refusal, sym, holding, byKey, themes, remembered, autoKey, seedWin])
  useEffect(() => { if (defaulted && theme && !autoKey) setAutoKey(themeKey(theme)) }, [defaulted, theme, autoKey])

  useEffect(() => { if (theme) lastThemeKey = themeKey(theme) }, [theme])

  const read = useMemo(() => (theme ? contributionRead(theme, win) : null), [theme, win])
  const split = useMemo(() => (read ? splitRead(read) : null), [read])
  const mine = read && sym ? read.rows.find((r) => r.sym === sym) : null
  const mineRank = mine ? [...read.rows].sort((a, b) => b.contrib - a.contrib).indexOf(mine) + 1 : null

  const listed = useMemo(() => (split ? [...split.contributors, ...split.detractors] : []), [split])
  const cmds = useMemo(() => listed.map((r) => `$${r.sym}`), [listed])
  useEffect(() => { onRows?.(cmds) }, [onRows, cmds])

  const asOf = perf.data?.live_as_of || perf.data?.generated_at || null
  const closed = !market.isOpen && !market.isPremarket && !market.isExtended
  usePanelFreshness(asOf && theme
    ? { source: 'UCT theme tracker (Massive prices)', freshnessClass: closed ? 'end_of_day' : 'real_time', asOf, sessionState: sessionModel(market) }
    : null)

  const load = (s) => onRun?.(`$${s}`, { keepFunction: true })
  // A hand-picked theme is written into this panel's own command (`IMOV THEME SEMICONDUCTORS`) so
  // it survives a reload, the URL and Back; the local pick answers at once while that lands.
  const choose = (key) => {
    setPicked(key || null)
    const t = key ? byKey.get(key) : null
    if (t && onRun) onRun(imovCommand({ sym, theme: t, win }), { here: true })
  }
  const themeChips = (list, testPrefix) => (
    <span className={styles.group}>
      {list.map((t) => (
        <button key={themeKey(t)} type="button" className={styles.chip} onClick={() => choose(themeKey(t))}
          data-testid={`${testPrefix}-${themeKey(t)}`}>Open the {t.name} theme</button>
      ))}
    </span>
  )
  const options = useMemo(() => [...themes]
    .sort((a, b) => String(a.name).localeCompare(String(b.name)))
    .map((t) => ({ value: themeKey(t), label: t.name || themeKey(t) })), [themes])

  if (indexRefusal) {
    return (
      <PanelState kind="locked" title={`IMOV does not break down ${sym}.`} testId="terminal-imov-refused">
        {sym} is an index fund. Its move is driven by each holding&apos;s market-cap weight, and UCT does not hold
        index weights, so IMOV will not show an index contribution rather than make one up. IMOV works on UCT&apos;s
        own themes, which are equal-weighted: type <kbd>IMOV</kbd> to pick one.
      </PanelState>
    )
  }
  if (!perf.data && !perf.error) return <PanelSkeleton label="Loading theme returns" testId="terminal-imov-loading" />
  if (!perf.data && perf.error) {
    const locked = perf.error?.status === 402
    return (
      <PanelState kind={locked ? 'locked' : 'error'} title={failureText(perf.error)} testId="terminal-imov-error"
        action={locked ? null : <button type="button" className={styles.chip} onClick={() => perf.mutate()}>Retry</button>}>
        {locked ? null : 'Retry, or run IMOV again.'}
      </PanelState>
    )
  }
  if (!themes.length) {
    return (
      <PanelState kind="empty" title="Theme returns are still being computed." testId="terminal-imov-computing">
        The theme service is building today&apos;s returns. This panel fills in on its own when they land.
      </PanelState>
    )
  }

  const picker = (
    <label className={styles.filter}>
      Theme
      <Select value={theme ? themeKey(theme) : ''} onChange={(e) => choose(e.target.value)} data-testid="terminal-imov-theme"
        options={[...(theme ? [] : [{ value: '', label: 'Pick a theme' }]), ...options]} />
    </label>
  )

  if (refusal) {
    return (
      <div className={styles.wrap} data-testid="terminal-imov">
        <PanelState kind="locked" title={`IMOV does not break down ${refusal.sym}.`} testId="terminal-imov-refused"
          action={refusal.proxies.length ? (
            <span className={styles.group}>
              {refusal.proxies.map((t) => (
                <button key={themeKey(t)} type="button" className={styles.chip} onClick={() => choose(themeKey(t))}
                  data-testid={`terminal-imov-proxy-${themeKey(t)}`}>Open the {t.name} theme</button>
              ))}
            </span>
          ) : null}>
          {refusal.sym} is {refusal.kind === 'index' ? 'an index fund' : 'an ETF'}. Its move is driven by each
          holding&apos;s weight in the fund, and UCT does not hold those weights, so IMOV will not show the
          fund&apos;s contribution rather than make one up.
          {refusal.proxies.length
            ? ` UCT's ${refusal.proxies.map((t) => t.name).join(' and ')} theme uses ${refusal.sym} as its reference; it is UCT's own equal-weight basket, a different question you can open instead.`
            : ' IMOV works on UCT\'s own themes, which are equal-weighted.'}
        </PanelState>
      </div>
    )
  }

  if (!theme && named && named.status !== 'ok') {
    const asked = String(themeQuery).trim()
    const list = named.status === 'ambiguous' ? named.options : named.suggestions || []
    return (
      <div className={`${styles.wrap} ${inPanel ? styles.inPanel : ''}`} data-testid="terminal-imov">
        <div className={styles.toolbar}>{picker}</div>
        <PanelState kind="input" compact role="status"
          testId={named.status === 'ambiguous' ? 'terminal-imov-theme-ambiguous' : 'terminal-imov-theme-unknown'}
          title={named.status === 'ambiguous'
            ? `"${asked}" fits ${list.length} UCT themes. Which one did you mean?`
            : `No UCT theme is called "${asked}".`}
          action={list.length ? themeChips(list, 'terminal-imov-didyoumean') : null}>
          {named.status === 'ambiguous'
            ? 'Type more of the name, or pick one.'
            : list.length ? 'Did you mean one of these? Or pick a theme above.' : 'Pick a theme above, or check the name.'}
        </PanelState>
      </div>
    )
  }

  if (!theme) {
    // One ticker-shaped word is read as a ticker (`IMOV SEMIS`); when no theme holds it but a theme
    // is CALLED that, offer the theme instead of leaving the member on a dead end.
    const byName = sym ? matchTheme(themes, sym) : null
    return (
      <div className={`${styles.wrap} ${inPanel ? styles.inPanel : ''}`} data-testid="terminal-imov">
        <div className={styles.toolbar}>{picker}</div>
        <PanelState kind="input" compact testId="terminal-imov-unheld"
          title={sym ? `No UCT theme holds ${sym}.` : 'Pick a theme.'}
          action={byName?.status === 'ok' ? themeChips([byName.theme], 'terminal-imov-didyoumean') : null}>
          {sym && byName?.status === 'ok'
            ? `Did you mean the ${byName.theme.name} theme? (IMOV THEME ${sym} always reads ${sym} as a theme name.)`
            : sym ? 'Pick a theme above to see what is driving it.' : null}
        </PanelState>
      </div>
    )
  }

  const nTotal = read.n
  return (
    <div className={`${styles.wrap} ${inPanel ? styles.inPanel : ''}`} data-testid="terminal-imov" data-theme-key={themeKey(theme)}>
      <div className={styles.toolbar} role="toolbar" aria-label="IMOV controls">
        {picker}
        <div className={styles.group} role="group" aria-label="Window">
          {Object.keys(IMOV_WINDOWS).map((w) => (
            <button key={w} type="button" className={styles.chip} aria-pressed={w === win} onClick={() => setWin(w)}
              data-testid={`terminal-imov-win-${w}`}>{w}</button>
          ))}
        </div>
      </div>

      {sym && holding.length > 1 && (
        <p className={styles.muted} data-testid="terminal-imov-memberships">
          {sym} is in {holding.length} themes:{' '}
          {holding.map((t) => (
            <button key={themeKey(t)} type="button" className={styles.chip} aria-pressed={t === theme}
              onClick={() => choose(themeKey(t))}>{t.name}</button>
          ))}
        </p>
      )}
      {defaulted && <p className={styles.muted}>Opened on the theme moving most over {seedWin}. Pick another above.</p>}

      {nTotal === 0 ? (
        <PanelState kind="empty" compact testId="terminal-imov-empty" title={`No member of ${theme.name} has a ${win} return yet.`}>
          Try another window.
        </PanelState>
      ) : (
        <>
          <p className={styles.lede} data-testid="terminal-imov-total">
            <span className={styles.badge}>Equal-weighted</span>{' '}
            <strong>{theme.name}</strong> {win}:{' '}
            <span className={tone(read.total)}>{formatPercent(read.total, { decimals: 2, signed: true })}</span>
            {' '}across {nTotal} name{nTotal === 1 ? '' : 's'}. Each name counts its return ÷ {nTotal}.
          </p>

          {mine && (
            <p className={styles.lede} data-testid="terminal-imov-mine">
              {sym}: {formatPercent(mine.ret, { decimals: 2, signed: true })} → <span className={tone(mine.contrib)}>{formatPts(mine.contrib)}</span>
              {' '}of the move, #{mineRank} of {nTotal} by contribution.
            </p>
          )}
          {sym && !mine && theme && read.unpriced.includes(sym) && (
            <p className={styles.muted}>{sym} has no {win} return yet, so it is not counted.</p>
          )}

          <div className={styles.split}>
            <ContribTable title={`Driving it up (top ${TOP_N})`} rows={split.contributors} start={0} n={nTotal} sym={sym}
              onLoad={load} testId="terminal-imov-up" />
            <ContribTable title={`Holding it back (top ${TOP_N})`} rows={split.detractors} start={split.contributors.length}
              n={nTotal} sym={sym} onLoad={load} testId="terminal-imov-down" />
          </div>

          <p className={styles.reconcile} data-testid="terminal-imov-reconcile">
            {formatPts(split.contributors.reduce((s, r) => s + r.contrib, 0))} from the top contributors,{' '}
            {formatPts(split.detractors.reduce((s, r) => s + r.contrib, 0))} from the top detractors
            {split.restCount ? `, ${formatPts(split.restSum)} from the other ${split.restCount}` : ''}
            {' '}= <strong className={tone(read.total)}>{formatPercent(read.total, { decimals: 2, signed: true })}</strong>,
            the theme&apos;s equal-weight return.
          </p>
        </>
      )}

      {trackerDiffers(read) && (
        <p className={styles.note} role="status" data-testid="terminal-imov-tracker">
          The Theme Tracker shows {formatPercent(read.published, { decimals: 2, signed: true })} for {theme.name} over {win}.
          It caps the top tenth of gainers so one outlier cannot carry a theme
          {themeKey(theme) === 'UCT20' ? ', and UCT 20 uses its portfolio record past one day' : ''}; the sum here is the plain
          equal-weight mean, so the two can differ.
        </p>
      )}
      {read.unpriced.length > 0 && (
        <p className={styles.muted} data-testid="terminal-imov-unpriced">
          {read.unpriced.length} member{read.unpriced.length === 1 ? ' has' : 's have'} no {win} return yet and
          {read.unpriced.length === 1 ? ' is' : ' are'} not counted: {read.unpriced.slice(0, 8).join(', ')}{read.unpriced.length > 8 ? ', …' : ''}.
        </p>
      )}
      {read.engine.length > 0 && (
        <p className={styles.muted} data-testid="terminal-imov-engine">
          {read.engine.length} suggested member{read.engine.length === 1 ? ' is' : 's are'} not counted: UCT&apos;s theme
          figures use the curated members only.
        </p>
      )}

      <p className={styles.muted} data-testid="terminal-imov-method">
        Contribution = the name&apos;s return over the window ÷ the number of names with a return, which is what an
        equal-weight basket gives each name. These are not index or ETF weights. 1D is the live move; 1W, 1M and 3M are
        the live price against each name&apos;s close at the start of the window. Click a row, or type its number, to load it
        into the linked panels.
        {asOf ? ` Prices as of ${formatTimeEt(asOf, { zoneSuffix: 'ET', absent: '' })}.` : ''}
      </p>
    </div>
  )
}
