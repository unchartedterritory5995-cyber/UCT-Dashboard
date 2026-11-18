// app/src/pages/formulas/FormulaReference.jsx
//
// ─── 🔴 EVERYTHING A MEMBER MAY WRITE, ON ONE PAGE ──────────────────────────
//
// The whole point of a custom-indicator platform is that a member can build
// their own. They cannot build with a vocabulary they cannot see — and until
// this page there was nowhere to see it. The 2026-08-28 reachability census
// found 22 frontend modules that READ the manifest and not one reference
// surface; a follow-up derivation found the only complete list of names a member
// could ever reach was inside an ERROR MESSAGE, where `interpret.js` refuses an
// unknown name by joining every key in scope into a ~1,700-character dump of raw
// identifiers, rendered in a red alert chip.
//
// ⭐ NOTHING ON THIS PAGE IS WRITTEN HERE. Every name, signature, sentence,
// reach and exclusion reason is a DECLARATION the engine already carries;
// `vocabulary.js` assembles them and this file lays them out. So a 64th function
// appears here on the day it is declared, with no edit to this file — and the
// page cannot drift from the engine, which matters more than it sounds: a
// reference that is confidently wrong about one entry is worse than none,
// because a member builds on it.
//
// ⛔ AND THE EXCLUSIONS ARE ON THE PAGE ON PURPOSE. Searching for a name we
// deliberately do not have must answer "we decided not to, here is why, here is
// the bounded form we do have" — never nothing, which a member cannot tell apart
// from having typed it wrong. No rival's reference does this; ours can, because
// the manifest already records a reason for all 103 of them.

import { withoutGuardIds } from '../../components/chart/engine/ast/guardIdText'
import { Suspense, lazy, useCallback, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import UIcon from '../../components/ui/UIcon'
import TileCard from '../../components/TileCard'
import { buildVocabulary, searchVocabulary } from '../../components/chart/engine/ast/vocabulary'
import { referenceSentence } from './referenceSentence'
import { buildReferenceText, saveTextFile, reachFor } from './referenceDownload'
import { memberVocabulary } from './memberReason'
import styles from './FormulaReference.module.css'

// Opened on request (see the section below): it imports the engine's refusal families.
// ⛔ The file is `PineNamesSection`, NOT `PineNames`: `pineNames.js` sits beside it, and on a
// case-insensitive disk `./PineNames` resolved to that module, which has no default export.
const PineNames = lazy(() => import('./PineNamesSection'))

function Entry({ item }) {
  const reach = item.kind === 'function' ? reachFor(item) : null
  return (
    <li className={styles.entry} data-kind={item.kind}>
      <code className={styles.sig}>{item.signature}</code>
      <p className={styles.says}>{withoutGuardIds(referenceSentence(item))}</p>
      {reach && <p className={styles.reach}><UIcon name="clock" size={11} /> {reach}</p>}
      {item.traits.map((t) => (
        <p key={t.key} className={styles.trait} data-trait={t.key}>{t.text}</p>
      ))}
    </li>
  )
}

function Excluded({ item }) {
  return (
    <li className={styles.gone} data-excluded={item.name}>
      <code className={styles.goneName}>{item.name}</code>
      <p className={styles.says}>{item.says}</p>
      {/* ⭐⭐ THE MEMBER LEAVES WITH SOMETHING TO PASTE. Seven of the refused
          functions carry their own substitute in the manifest, and every one
          shown here has been through the shipped parser — so a substitute on
          screen is a formula this engine accepts, not a phrase scraped out of
          prose. */}
      {item.instead && (
        <p className={styles.instead} data-instead={item.name}>
          Write <code>{item.instead}</code>
        </p>
      )}
    </li>
  )
}

export default function FormulaReference() {
  // ⭐ The excluded roster AS A MEMBER READS IT (`memberReason.js`): the engine's own notes on why a
  // name is absent are written for its maintainers and are not printed here.
  const vocab = useMemo(() => memberVocabulary(buildVocabulary()), [])
  const [query, setQuery] = useState('')
  const [pineOpen, setPineOpen] = useState(false)
  // ⭐ THE WHOLE REFERENCE AS ONE FILE (2026-11-16), for a member who writes with their own
  // assistant. Built from the objects this page renders, plus the TradingView names, which
  // load on the press. '' | 'busy' | 'done' | 'failed'
  const [download, setDownload] = useState('')
  const downloadReference = useCallback(async () => {
    setDownload('busy')
    let pine = {}
    // The TradingView names are an addition: if they cannot load, the file still carries
    // the whole formula vocabulary rather than failing outright.
    try { pine = (await import('./referencePineData')).pineForDownload() } catch { pine = {} }
    const text = buildReferenceText(vocab, { plain: withoutGuardIds, ...pine })
    setDownload(saveTextFile(text) ? 'done' : 'failed')
  }, [vocab])
  const result = useMemo(() => searchVocabulary(query, vocab), [query, vocab])

  const shown = result.groups.reduce((n, g) => n + g.items.length, 0)
  const searching = !!result.query

  return (
    <div className={styles.page}>
      <TileCard title="Formula reference" icon="library">
        <p className={styles.lede}>
          Every name you can write in a formula, in the engine&rsquo;s own words.
          {' '}Type what you want it to <em>do</em> &mdash; the descriptions are searched too.
        </p>

        <div className={styles.downloadRow}>
          <button type="button" className={styles.pineOpen} data-testid="reference-download"
            disabled={download === 'busy'} onClick={downloadReference}>
            {download === 'busy' ? 'Preparing the file' : 'Download for your assistant'}
          </button>
          <span className={styles.downloadNote} data-testid="reference-download-note" role="status">
            {download === 'done' ? 'Saved as uct-formula-reference.md. Attach it to your assistant, then paste what it writes into “write a formula” (Chart Settings, Indicators, Add indicator).'
              : download === 'failed' ? 'This browser would not save the file. Try another browser.'
                : 'One file with every name on this page, for an assistant that writes formulas with you.'}
          </span>
        </div>

        <div className={styles.searchRow}>
          <UIcon name="search" size={14} />
          <input
            className={styles.search}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="high volume · 52 week · average true range · market cap"
            aria-label="Search the formula vocabulary"
            data-testid="reference-search"
          />
        </div>

        {/* ⛔ THE COUNT IS DERIVED AND IT IS ALWAYS SHOWN. A search that returns
            three of two hundred looks identical to a search that found
            everything, unless the denominator is on screen. */}
        <p className={styles.count} data-testid="reference-count">
          {searching
            ? `${shown} name${shown === 1 ? '' : 's'} match “${result.query}”`
            : `${shown} names`}
          {result.excluded.length > 0
            && ` · ${result.excluded.length} deliberately not available`}
        </p>

        {searching && shown === 0 && result.excluded.length === 0 && (
          <p className={styles.empty} data-testid="reference-empty">
            {/* ⛔ AN EMPTY RESULT MUST SAY WHAT IT SEARCHED. Otherwise a member
                cannot tell "we do not have this" from "you phrased it
                differently than the description does" — and the second is the
                common case, because this matches word beginnings and not word
                forms: “high volume” finds it, “highest volume” does not. */}
            Nothing matches. This searches the <strong>names</strong> and the{' '}
            <strong>descriptions</strong> above, by the start of each word &mdash; so
            try a shorter or plainer word (&ldquo;high volume&rdquo; rather than
            &ldquo;highest volume&rdquo;).
          </p>
        )}

        {result.groups.map((g) => (
          <section key={g.id} className={styles.group} data-group={g.id}>
            <h3 className={styles.groupTitle}>
              {g.title} <span className={styles.groupCount}>{g.items.length}</span>
            </h3>
            <p className={styles.groupBlurb}>{g.blurb}</p>
            <ul className={styles.entries}>
              {g.items.map((it) => <Entry key={`${g.id}-${it.name}`} item={it} />)}
            </ul>
          </section>
        ))}

        {result.excluded.length > 0 && (
          <section className={styles.group} data-group="excluded">
            <h3 className={styles.groupTitle}>
              Deliberately not available{' '}
              <span className={styles.groupCount}>{result.excluded.length}</span>
            </h3>
            <p className={styles.groupBlurb}>
              {/* ⭐ THE SENTENCE THAT MAKES THIS A FEATURE RATHER THAN AN
                  APOLOGY. Each of these is a decision with a reason, and the
                  reason is the engine&rsquo;s own. */}
              These names are absent on purpose. Each says why, and most name what
              to use instead.
            </p>
            <ul className={styles.entries}>
              {result.excluded.map((e) => <Excluded key={`x-${e.name}`} item={e} />)}
            </ul>
          </section>
        )}

        {/* ⭐ TRADINGVIEW (PINE) NAMES. A member who writes or pastes Pine looks up `ta.rsi` and
            sees whether it runs. The answer is the Pine door's own generated coverage file, so
            it is current by construction. Opened on request: it loads the engine's refusal
            families, which the rest of this page does not need. The search box above filters it. */}
        <section className={styles.group} data-group="pine">
          <h3 className={styles.groupTitle}>TradingView names</h3>
          <p className={styles.groupBlurb}>
            Writing or pasting Pine? Look up any TradingView built-in, such as <code>ta.rsi</code> or{' '}
            <code>request.security</code>, and see whether it runs here.
          </p>
          {pineOpen ? (
            <Suspense fallback={<p className={styles.count}>Loading TradingView names</p>}>
              <PineNames query={query} />
            </Suspense>
          ) : (
            <button type="button" className={styles.pineOpen} data-testid="pine-open"
              onClick={() => setPineOpen(true)}>
              {query.trim() ? `Look for “${query.trim()}” in TradingView names` : 'Show TradingView names'}
            </button>
          )}
        </section>

        <p className={styles.footer}>
          <Link to="/charts">Build one on a chart</Link>
          {' · '}
          <Link to="/screener">Scan with one</Link>
        </p>
      </TileCard>
    </div>
  )
}
