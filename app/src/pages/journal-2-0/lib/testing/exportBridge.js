// Test-only: run a TipTap document through the REAL Markdown exporter
// (tools/md_export_bridge.py -> notes_export.tiptap_to_markdown) and read it
// back through the REAL importer (generic.js mdToHtml -> convert.js
// htmlToNote). Shared by the wave-6 editor rails so each new block's export
// round trip is measured end to end, never against a hand-typed string.
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { mdToHtml } from '../importer/adapters/generic'
import { htmlToNote } from '../importer/convert'

export const REPO_ROOT = (() => {
  let dir = process.cwd()
  for (let i = 0; i < 8; i += 1) {
    if (fs.existsSync(path.join(dir, 'api')) && fs.existsSync(path.join(dir, 'tools'))) return dir
    const up = path.dirname(dir)
    if (up === dir) break
    dir = up
  }
  throw new Error(`exportBridge: could not find the repo root from ${process.cwd()}`)
})()

export function pythonAvailable() {
  try {
    return spawnSync('python', ['--version'], { encoding: 'utf8' }).status === 0
  } catch {
    return false
  }
}

/**
 * The exporter's Markdown for EVERY document in `docs`, in order, from ONE spawn.
 * (The single-document `exportMarkdown(doc)` wrapper that stood here had no caller
 * once every rail batched -- wave 7 lane J nit N-1 -- and is gone; the Python
 * bridge's single-document form is still railed in test_notebook_bridges_pin_the_root.py.)
 *
 * ⛔ Wave 7 lane J, fix round 1 (review I-1): every bridge spawn imports the repo-root
 * conftest (the census + tripwire, J1), ~7 s. Paid once PER TEST it ran each test against
 * vitest's 15 s `testTimeout`; a rail file calls this ONCE, in a `beforeAll` with its own
 * budget (the `exportSelection` precedent in selectionExport.roundtrip.test.js).
 */
export function exportMarkdownMany(docs) {
  const script = path.join(REPO_ROOT, 'tools', 'md_export_bridge.py')
  const r = spawnSync('python', [script], { input: JSON.stringify(docs), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  if (r.status !== 0) throw new Error(`md_export_bridge.py failed (exit ${r.status}): ${r.stderr}`)
  const { markdowns } = JSON.parse(r.stdout)
  if (!Array.isArray(markdowns) || markdowns.length !== docs.length) {
    throw new Error(`md_export_bridge.py answered ${Array.isArray(markdowns) ? markdowns.length : 'no list'} for ${docs.length} documents`)
  }
  return markdowns
}

/** What our importer makes of that Markdown: the note's TipTap JSON. */
export function importMarkdown(md) {
  return htmlToNote(mdToHtml(md)).bodyJson
}

/**
 * The REAL selection export (tools/selection_export_bridge.py ->
 * notes_export.build_selection_export_to_tempfile) of a small library:
 * `{ files: {name: text}, exported, skipped }`. The bridge prints its answer as
 * its LAST line (a module it imports may print a line of its own first).
 */
export function exportSelection(library) {
  const script = path.join(REPO_ROOT, 'tools', 'selection_export_bridge.py')
  const r = spawnSync('python', [script], { input: JSON.stringify(library), encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
  if (r.status !== 0) throw new Error(`selection_export_bridge.py failed (exit ${r.status}): ${r.stderr}`)
  const last = r.stdout.trim().split(/\r?\n/).pop()
  return JSON.parse(last)
}

/** Lane F's task extractor (note_tasks.extract_tasks) over `doc`: one entry per taskItem. */
export function extractTasks(doc) {
  const script = path.join(REPO_ROOT, 'tools', 'note_tasks_bridge.py')
  const r = spawnSync('python', [script], { input: JSON.stringify(doc), encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
  if (r.status !== 0) throw new Error(`note_tasks_bridge.py failed (exit ${r.status}): ${r.stderr}`)
  return JSON.parse(r.stdout).tasks
}
