/**
 * Obsidian link and embed resolution for the client file importer (connector fidelity
 * Plan B Task 8: I-9, O-5, O-8, O-11). ONE resolver for wikilinks, embeds, relative
 * markdown links and images, built once per `parse()`.
 *
 * `makeObsidianResolver(vfiles)` -> `{roots, rootOf(sourcePath), resolve(linkpath,
 * sourcePath, {decode})}`.
 *  - `roots`: every folder holding `.obsidian/`. A drop may hold several vaults (an
 *    `Obsidian/` folder with `Work/` and `Personal/`), or one vault beside loose notes.
 *  - `rootOf(sourcePath)`: the note's vault, its NEAREST ancestor root; `''` (the drop top)
 *    for a note in no vault. A link resolves against ITS note's vault only -- one index per
 *    root, built once -- so `[[Plan]]` in `Work/` never opens `Personal/Plan.md`, and a
 *    link never climbs out of its vault into something dropped beside it. The drop top
 *    indexes the whole drop, so a loose note's links resolve as before.
 *  - `attachmentFolderPath` comes from `<root>/.obsidian/app.json`; missing or unreadable
 *    reads `'/'` (the vault root), as Obsidian does.
 *
 * `resolve` drops `|…`, removes ONE trailing `\` (a wikilink's pipe escaped inside a
 * table cell, `[[Note\|alias]]`, O-8), and works in one of two modes:
 *
 * A wikilink, embed or deep-link `file` (no `decode`): THE wikilink rule of the server
 * lane, `providers/obsidian.py::_resolve_in`, step for step (merge of Plan B with D1/D2:
 * one resolver, one rule):
 *   - a target holding `#` that EXACTLY names a vault file opens that file (`my chart #1
 *     (v2).png` is a name); only otherwise is the `#anchor` split off;
 *   - then the exact NOTE the target names (`[[Dr.Smith]]` -> `Dr.Smith.md`,
 *     `[[report.pdf]]` -> `report.pdf.md`), always first; then a file whose full name IS
 *     the target. Never an extension-stripped form (no stem rule);
 *   - a target holding `/` matches the end of each path at a folder boundary; a bare one
 *     the file name; a leading `/` names the path from the vault root, the exact note
 *     first, then as written (the server's `_resolve_rooted`, post-merge fix 1).
 *
 * A markdown href or image src (`decode`): percent-decoded ONCE, after splitting off
 * `#`/`?` (an encoded `%23` stays in the name). Then, in order:
 *   1. a leading `/` -> root-relative exact;
 *   2. a path holding `/` -> beside the source note, then from the root, each as written
 *      and then with `.md` appended (unless it already ends `.md`) (a `..` that climbs
 *      above the root is never a target);
 *   3. by name -> the target + `.md` first, else the target, any case;
 *   4. a path holding `/` with no exact hit -> a `/`-boundary suffix match.
 * Exact matches prefer the path as cased, then any case (the server's `by_lower`).
 *
 * Ties, both modes (`rank`): the source note's own folder (bare names only), then the
 * attachment folder, then the fewest folders, then lexicographic order -- the server's
 * `_pick` plus the client-only attachment step, which agrees with it when the vault has no
 * `.obsidian/app.json` setting.
 */

const CONFIG_RE = /(^|\/)\.obsidian\//i
const SKIP_DIR_RE = /(^|\/)\.(obsidian|trash)\//i

export async function makeObsidianResolver(vfiles) {
  const roots = findRoots(vfiles)
  const allPaths = vfiles.map((v) => v.path).filter((p) => !SKIP_DIR_RE.test(p))
  // One index per vault, built once; the drop top (`''`) indexes the whole drop and serves
  // every note that sits in no vault.
  const vaults = new Map()
  for (const root of new Set(['', ...roots])) {
    vaults.set(root, await makeVaultIndex(root, allPaths, vfiles))
  }
  /** The vault a note belongs to: its NEAREST ancestor folder holding `.obsidian/`. */
  const rootOf = (sourcePath) => {
    let best = ''
    for (const root of roots) {
      if (String(sourcePath || '').startsWith(`${root}/`) && root.length > best.length) best = root
    }
    return best
  }
  const resolve = (linkpath, sourcePath, opts = {}) =>
    vaults.get(rootOf(sourcePath)).resolve(linkpath, sourcePath, opts)
  return { roots, rootOf, resolve }
}

async function makeVaultIndex(root, allPaths, vfiles) {
  const attachmentFolder = await readAttachmentFolder(vfiles, root)
  const prefix = root ? `${root}/` : ''
  const paths = allPaths.filter((p) => !prefix || p.startsWith(prefix))

  const exact = new Map()
  const exactLower = new Map()
  const byName = new Map()
  for (const p of paths) {
    exact.set(p, p)
    if (!exactLower.has(p.toLowerCase())) exactLower.set(p.toLowerCase(), p)
    const name = basename(p).toLowerCase()
    if (!byName.has(name)) byName.set(name, [])
    byName.get(name).push(p)
  }

  const lookup = (path) => exact.get(path) ?? exactLower.get(path.toLowerCase()) ?? null
  const lookupWithMd = (path) => lookup(path) ?? (isNote(path) ? null : lookup(`${path}.md`))

  // THE tie-break among same-named paths (`providers/obsidian.py::_pick` is the server's;
  // the 68-case resolution harness and the parity fixtures pin both): the one in the
  // source note's own folder (bare names only, `near`), then the attachment folder, then
  // the fewest folders, then the lexicographically first path, so the answer never depends
  // on listing order. The attachment step is the client's alone (the server has no
  // `.obsidian/app.json`); with none, the attachment folder is the vault root, whose files
  // already have the fewest folders, so the two lanes agree. ⚰️ Plan B Task 8 ranked a
  // same-depth tie by the SHORTER path before sort order, which the server never did
  // (merge with D1/D2, one tie-break).
  function rank(candidates, sourcePath, near = true) {
    if (candidates.length <= 1) return candidates[0] ?? null
    const here = near ? dirOf(sourcePath).toLowerCase() : null
    const attach = attachmentDir(attachmentFolder, root, sourcePath).toLowerCase()
    const score = (p) => {
      const d = dirOf(p).toLowerCase()
      return [d === here ? 0 : 1, d === attach ? 0 : 1, p.split('/').length]
    }
    return [...candidates].sort((a, b) => {
      const sa = score(a)
      const sb = score(b)
      for (let i = 0; i < sa.length; i++) if (sa[i] !== sb[i]) return sa[i] - sb[i]
      return a < b ? -1 : a > b ? 1 : 0
    })[0]
  }

  // The two name steps of the wikilink rule (`providers/obsidian.py::_resolve_steps`): the
  // exact NOTE the target names (`noteFileOf`) always first, then a file whose full name
  // IS the target. Never an extension-stripped form (no stem rule: `[[chart]]` names
  // `chart.md` only). `exactFileOnly`: the second step alone.
  function nameSteps(target, sourcePath, exactFileOnly) {
    const lower = target.toLowerCase()
    const pathQualified = lower.includes('/')
    const wants = exactFileOnly ? [lower] : [noteFileOf(lower), lower]
    for (const want of wants) {
      const hits = pathQualified
        ? paths.filter((p) => endsAt(p.toLowerCase(), want))
        : byName.get(want) || []
      if (hits.length) return rank(hits, sourcePath, !pathQualified)
    }
    return null
  }

  function resolve(linkpath, sourcePath, opts = {}) {
    let target = String(linkpath ?? '')
    if (opts.decode) {
      // Split BEFORE the one decode: an encoded `%23`/`%3F` is part of the name.
      target = target.split('#')[0].split('?')[0]
      try {
        target = decodeURIComponent(target)
      } catch {
        // a malformed escape: the href as written
      }
    }
    target = target.split('|')[0]
    if (target.endsWith('\\')) target = target.slice(0, -1)
    target = target.trim()
    if (!opts.decode) {
      // A wikilink, embed or deep-link `file`: THE wikilink rule of the server
      // (`providers/obsidian.py::_resolve_in`), step for step. First, a target holding a
      // `#` (an anchor, or part of a NAME: `my chart #1 (v2).png`) that EXACTLY names a
      // vault file opens that file; only otherwise is the anchor split off (Plan C Task 4
      // fix round 1). A target with a `/` matches the end of each path at a folder
      // boundary; a bare one the file name.
      if (target.includes('#') && !target.startsWith('/')) {
        const hit = nameSteps(target, sourcePath, true)
        if (hit) return hit
      }
      target = target.split('#')[0].trim()
      if (!target) return null
      if (!target.startsWith('/')) return nameSteps(target, sourcePath, false)
    }
    if (!target) return null

    if (target.startsWith('/')) {
      const rooted = normalize(target.replace(/^\/+/, ''), root)
      if (rooted === null || rooted === root) return null
      // A wikilink: the exact note first, as every wikilink step takes it (the server's
      // `_resolve_rooted`). A markdown href names a file: as written first.
      return opts.decode ? lookupWithMd(rooted) : lookup(noteFileOf(rooted)) ?? lookup(rooted)
    }
    if (target.includes('/')) {
      for (const candidate of [normalize(target, dirOf(sourcePath)), normalize(target, root)]) {
        if (candidate === null) continue
        const hit = lookupWithMd(candidate)
        if (hit) return hit
      }
      const lower = target.toLowerCase()
      const suffixHits = paths.filter((p) => {
        const pl = p.toLowerCase()
        return pl.endsWith(`/${lower}`) || (!isNote(lower) && pl.endsWith(`/${lower}.md`))
      })
      return rank(suffixHits, sourcePath)
    }
    const name = target.toLowerCase()
    const notes = isNote(name) ? [] : byName.get(`${name}.md`) || []
    return rank(notes.length ? notes : byName.get(name) || [], sourcePath)
  }

  /** `rel` joined onto the folder `base`, `.`/`..` folded; null when a `..` climbs above
   *  the top of the drop (the server's `_escapes_root`). */
  function normalize(rel, base) {
    const stack = base ? base.split('/') : []
    for (const part of rel.split('/')) {
      if (part === '' || part === '.') continue
      if (part === '..') {
        if (!stack.length) return null
        stack.pop()
        continue
      }
      stack.push(part)
    }
    // A path that climbs out of `root` but stays in the drop names nothing: `paths` holds
    // only the vault's files, so the lookup misses it.
    return stack.join('/')
  }

  return { resolve }
}

/** Every folder holding a `.obsidian/` (`''` for one at the top of the drop). */
function findRoots(vfiles) {
  const roots = new Set()
  for (const v of vfiles) {
    const m = CONFIG_RE.exec(v.path)
    if (m) roots.add(v.path.slice(0, m.index).replace(/\/$/, ''))
  }
  return [...roots]
}

async function readAttachmentFolder(vfiles, root) {
  const configPath = `${root ? `${root}/` : ''}.obsidian/app.json`
  const config = vfiles.find((v) => v.path === configPath)
  if (!config) return '/'
  try {
    const parsed = JSON.parse(new TextDecoder('utf-8').decode(await config.bytes()))
    const value = parsed?.attachmentFolderPath
    return typeof value === 'string' && value.trim() ? value.trim() : '/'
  } catch {
    return '/'
  }
}

/** The folder Obsidian puts new attachments in, as a drop path. */
function attachmentDir(setting, root, sourcePath) {
  if (setting === '/') return root
  if (setting === '.' || setting === './') return dirOf(sourcePath)
  if (setting.startsWith('./')) {
    const here = dirOf(sourcePath)
    const sub = setting.slice(2).replace(/\/+$/, '')
    return here ? `${here}/${sub}` : sub
  }
  const sub = setting.replace(/^\/+|\/+$/g, '')
  return root ? `${root}/${sub}` : sub
}

function basename(path) {
  return path.split('/').pop()
}

function dirOf(path) {
  const idx = String(path || '').lastIndexOf('/')
  return idx === -1 ? '' : path.slice(0, idx)
}

/** A name already ending `.md` is tried as written only; any other also with `.md` added
 *  (`[[v1.2]]` names `v1.2.md`, where an "has an extension" test would not). */
function isNote(path) {
  return /\.md$/i.test(path)
}

/** The note file a wikilink target names, lowercased: `<target>.md`, or the target itself
 *  when it already ends in `.md`. Every dot is part of the note's name: `[[Dr.Smith]]`,
 *  `[[Q3.Review]]` and even `[[Brief.txt]]` name `Dr.Smith.md`, `Q3.Review.md` and
 *  `Brief.txt.md`. `providers/obsidian.py::_note_file_of`. */
function noteFileOf(lower) {
  return isNote(lower) ? lower : `${lower}.md`
}

/** `form` is `want`, or ends in it at a folder boundary (`providers/obsidian.py::_ends_at`). */
function endsAt(form, want) {
  return form === want || form.endsWith(`/${want}`)
}
