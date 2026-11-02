/**
 * Obsidian link and embed resolution for the client file importer (connector fidelity
 * Plan B Task 8: I-9, O-5, O-8, O-11). ONE resolver for wikilinks, embeds, relative
 * markdown links and images, built once per `parse()`.
 *
 * `makeObsidianResolver(vfiles)` -> `{root, resolve(linkpath, sourcePath, {decode})}`.
 *  - `root`: the folder holding `.obsidian/` (`''` when the drop has none; the shallowest
 *    when it has several). Only files under it are ever a link's target, so a link never
 *    climbs out of the vault into something else dropped beside it.
 *  - `attachmentFolderPath` comes from `<root>/.obsidian/app.json`; missing or unreadable
 *    reads `'/'` (the vault root), as Obsidian does.
 *
 * `resolve` drops `#…` and `|…`, removes ONE trailing `\` (a wikilink's pipe escaped
 * inside a table cell, `[[Note\|alias]]`, O-8), and percent-decodes ONCE only when
 * `decode` is set (a markdown href or image src; never a wikilink, whose `%20` is part of
 * a name as written). Then, in order:
 *   1. a leading `/` -> root-relative exact;
 *   2. a path holding `/` -> beside the source note, then from the root, each as written
 *      and then with `.md` appended (unless it already ends `.md`) (a `..` that climbs above the root is never a target);
 *   3. by name -> every file whose basename is the target (or the target + `.md`), any
 *      case; ties go to the source note's own folder, then the attachment folder, then
 *      the fewest folders, then the shorter path, then lexicographic order;
 *   4. a path holding `/` with no exact hit -> a `/`-boundary suffix match, same ties.
 * Exact matches prefer the path as cased, then any case (the server's `by_lower`).
 *
 * The server lane (`providers/obsidian.py::_resolve_in` / `_resolve_relative`) agrees on
 * every parity fixture; it ties a bare name by folder, then depth, then first seen, and has
 * no attachment-folder step (it has no `.obsidian/app.json`).
 */

const CONFIG_RE = /(^|\/)\.obsidian\//i
const SKIP_DIR_RE = /(^|\/)\.(obsidian|trash)\//i

export async function makeObsidianResolver(vfiles) {
  const root = findRoot(vfiles)
  const attachmentFolder = await readAttachmentFolder(vfiles, root)
  const prefix = root ? `${root}/` : ''
  const paths = vfiles
    .map((v) => v.path)
    .filter((p) => (!prefix || p.startsWith(prefix)) && !SKIP_DIR_RE.test(p))

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

  function rank(candidates, sourcePath) {
    if (candidates.length <= 1) return candidates[0] ?? null
    const here = dirOf(sourcePath).toLowerCase()
    const attach = attachmentDir(attachmentFolder, root, sourcePath).toLowerCase()
    const score = (p) => {
      const d = dirOf(p).toLowerCase()
      return [d === here ? 0 : 1, d === attach ? 0 : 1, p.split('/').length, p.length]
    }
    return [...candidates].sort((a, b) => {
      const sa = score(a)
      const sb = score(b)
      for (let i = 0; i < sa.length; i++) if (sa[i] !== sb[i]) return sa[i] - sb[i]
      return a < b ? -1 : a > b ? 1 : 0
    })[0]
  }

  function resolve(linkpath, sourcePath, opts = {}) {
    let target = String(linkpath ?? '')
    if (opts.decode) {
      try {
        target = decodeURIComponent(target)
      } catch {
        // a malformed escape: the href as written
      }
      target = target.split('?')[0]
    }
    target = target.split('#')[0].split('|')[0]
    if (target.endsWith('\\')) target = target.slice(0, -1)
    target = target.trim()
    if (!target) return null

    if (target.startsWith('/')) {
      const rooted = normalize(target.replace(/^\/+/, ''), root)
      return rooted === null ? null : lookupWithMd(rooted)
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
    const candidates = [...(byName.get(name) || []), ...(isNote(name) ? [] : byName.get(`${name}.md`) || [])]
    return rank(candidates, sourcePath)
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

  return { root, resolve }
}

function findRoot(vfiles) {
  let best = null
  const depth = (p) => (p ? p.split('/').length : 0)
  for (const v of vfiles) {
    const m = CONFIG_RE.exec(v.path)
    if (!m) continue
    const root = v.path.slice(0, m.index).replace(/\/$/, '')
    if (best === null || depth(root) < depth(best)) best = root
  }
  return best ?? ''
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
