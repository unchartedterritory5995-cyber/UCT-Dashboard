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

/** The exporter's Markdown for `doc`. Throws with the script's stderr on failure. */
export function exportMarkdown(doc) {
  const script = path.join(REPO_ROOT, 'tools', 'md_export_bridge.py')
  const r = spawnSync('python', [script], { input: JSON.stringify(doc), encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
  if (r.status !== 0) throw new Error(`md_export_bridge.py failed (exit ${r.status}): ${r.stderr}`)
  return JSON.parse(r.stdout).markdown
}

/** What our importer makes of that Markdown: the note's TipTap JSON. */
export function importMarkdown(md) {
  return htmlToNote(mdToHtml(md)).bodyJson
}

/** Lane F's task extractor (note_tasks.extract_tasks) over `doc`: one entry per taskItem. */
export function extractTasks(doc) {
  const script = path.join(REPO_ROOT, 'tools', 'note_tasks_bridge.py')
  const r = spawnSync('python', [script], { input: JSON.stringify(doc), encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
  if (r.status !== 0) throw new Error(`note_tasks_bridge.py failed (exit ${r.status}): ${r.stderr}`)
  return JSON.parse(r.stdout).tasks
}
