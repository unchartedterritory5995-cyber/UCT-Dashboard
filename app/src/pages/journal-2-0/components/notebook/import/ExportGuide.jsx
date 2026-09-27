// "How do I get my export file?" — the step upstream of the importer itself.
// A member has to produce an export file from Notion/Obsidian/Evernote before
// any of the auto-detect/preview/re-import machinery can help them, and
// nothing else in the product says how. This is that "how".
//
// Every click-path, format choice and gotcha for Notion / Obsidian / Evernote
// was checked against each vendor's OWN current help docs (not written from
// memory) — see the sources named in
// .superpowers/sdd/2026-09-02-transfer-gap/task-1-report.md, since a vendor UI
// can move and this file won't notice. ⚠️ The seven tools wave 10 added
// (R-18) name their sources in `lib/importer/census.js`, and NOT all of those
// are the vendor's own pages — that file says which are third-party.
//
// ⛔⛔ The "one-time import, not an ongoing connection" line on Evernote is a
// DECISION, re-verified 2026-09-04 against Evernote's live developer docs
// (not inherited from an earlier session's "reopened" conclusion): the
// hosted MCP server + OAuth Dynamic Client Registration are real and do
// remove the old manual app-approval queue, but as of that date
// dev.evernote.com/mcp/faq still reads "It's in beta while we refine it,"
// is restricted to paid Personal/Business/Teams plans ("Free (Basic)
// accounts aren't included"), publishes no parameter-level docs for
// enumerating/cursoring a full note library, and independent reviews
// (usecarly.com, 2026-07-11) describe it as working only "inside a
// conversation you start," with "no background syncing... or automatic
// listing of all notes." None of that resolves the live-probe gate
// `docs/superpowers/specs/2026-09-01-notebook-migration-program-design.md`
// §6.1 already required before building a connector — it still needs a
// real Evernote account this product does not have. See
// `docs/superpowers/phase-reports/2026-09-04-evernote-decision-and-plugin-readiness.md`
// for the full evidence trail. Do not silently upgrade this copy to imply a
// sync connector exists until that probe actually runs and passes.
//
// Format picks were made by reading the adapters this feeds
// (`lib/importer/adapters/{notion,evernote,obsidian}.js`), not guessed:
//  - Notion: recommend "Markdown & CSV" over "HTML". Both are parsed, but the
//    .md path runs through `mdToHtml` — the same clean, semantic-HTML
//    converter the Obsidian adapter uses, which TipTap's `generateJSON`
//    reliably maps. The raw ".html" path is a near-verbatim passthrough of
//    Notion's own export markup (div/style-heavy, not semantic), so more of
//    it gets flattened going into the editor. The one real cost of Markdown &
//    CSV — a database/table over 50 rows imports as nothing, with only a
//    warning (`notion.js`'s `CSV_MAX_ROWS`) — is called out below.
//  - Evernote: only `.enex` is read at all (`evernote.js`'s `detect()`) — no
//    real choice, so the copy just names it and explains why.
//  - Obsidian: the adapter reads a plain folder of `.md` files and already
//    skips `.obsidian`/`.trash` (`obsidian.js`'s `SKIP_DIR_RE`) — there is no
//    export format to pick because there is no export step.
import { useState } from 'react'
import UIcon from '../../../../../components/ui/UIcon'
import styles from './ExportGuide.module.css'
import { IMPORT_CENSUS } from '../../../lib/importer/census'

// Wave 10 (R-18): the platforms are the import census -- one list, read by
// this guide AND by `lib/importer/census.test.js`, which imports each tool's
// fixture through the real pipeline. The copy for the seven wave-10 tools and
// its sources live beside the list in `census.js`.
const PLATFORMS = IMPORT_CENSUS

export default function ExportGuide() {
  const [openId, setOpenId] = useState(null)

  return (
    <div className={styles.wrap}>
      <div className={styles.tabs}>
        {PLATFORMS.map((p) => {
          const active = openId === p.id
          return (
            <button
              key={p.id}
              type="button"
              className={`${styles.tab} ${active ? styles.tabActive : ''}`}
              aria-expanded={active}
              onClick={() => setOpenId(active ? null : p.id)}
            >
              <UIcon name={p.icon} size={14} gold={false} />
              {p.label}
            </button>
          )
        })}
      </div>
      {PLATFORMS.filter((p) => p.id === openId).map((p) => (
        <div key={p.id} className={styles.detail}>
          {p.where.map((line) => (
            <p key={line} className={styles.line}>{line}</p>
          ))}
          <p className={styles.line}>
            <strong>Format:</strong> {p.format}
          </p>
          <p className={styles.lineWarn}>
            <UIcon name="warning" size={13} gold={false} />
            <span>{p.watch}</span>
          </p>
        </div>
      ))}
    </div>
  )
}
