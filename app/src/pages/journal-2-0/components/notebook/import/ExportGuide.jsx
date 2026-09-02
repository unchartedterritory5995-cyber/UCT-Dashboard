// "How do I get my export file?" — the step upstream of the importer itself.
// A member has to produce an export file from Notion/Obsidian/Evernote before
// any of the auto-detect/preview/re-import machinery can help them, and
// nothing else in the product says how. This is that "how".
//
// Every click-path, format choice and gotcha below was checked against each
// vendor's OWN current help docs (not written from memory) — see the sources
// named in .superpowers/sdd/2026-09-02-transfer-gap/task-1-report.md, since a
// vendor UI can move and this file won't notice.
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

const PLATFORMS = [
  {
    id: 'notion',
    label: 'Notion',
    icon: 'document',
    where: [
      'Whole workspace: Settings → General (under Workspace) → Export all workspace content.',
      'Just one page: open it, then the ••• menu at the top → Export.',
    ],
    format: 'Choose "Markdown & CSV" — it converts the cleanest here. Skip "HTML".',
    watch:
      "Notion emails you a download link instead of starting the download right away — for a big workspace that can take a while, and it may split into several zip files. Grab every part before you import, or you'll be missing notes with no warning that anything's gone. Also: any database/table over 50 rows won't come across — split it or trim it first.",
  },
  {
    id: 'obsidian',
    label: 'Obsidian',
    icon: 'library',
    where: [
      "Good news: there's no export step. Your vault is already a plain folder of Markdown files sitting on your computer.",
    ],
    format: "Nothing to pick — it's already Markdown.",
    watch:
      'Use "Choose a folder" below and point it at the top of the vault, not a subfolder, so nothing gets left out. A hidden ".obsidian" folder comes along for the ride — that\'s fine, we skip it automatically.',
  },
  {
    id: 'evernote',
    label: 'Evernote',
    icon: 'book',
    where: [
      'Open the Evernote app on a Mac or PC (not evernote.com in a browser) — right-click a notebook (or select up to 100 notes) → Export…',
    ],
    format: 'Choose ENEX (.enex) — the only format we read, and it\'s Evernote\'s own native one, so nothing is lost.',
    watch:
      "Evernote exports one notebook at a time, so several notebooks means several .enex files — that's fine, drop them all in together and we treat it as one import. Exporting only works from the desktop app, not the web version.",
  },
]

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
