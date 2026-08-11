import { unzipSync } from 'fflate'

/**
 * @typedef {Object} VFile
 * @property {string} path - '/'-separated, no leading '/'
 * @property {number} size
 * @property {number|null} lastModified
 * @property {() => Promise<Uint8Array>} bytes
 */

export class ImportLimitError extends Error {
  constructor(message) {
    super(message)
    this.name = 'ImportLimitError'
  }
}

const DEFAULT_LIMITS = {
  maxTotalBytes: 2_147_483_648, // 2GB
  maxEntries: 20_000,
  maxArchiveBytes: 4_294_967_295, // 4GB - 1
}

const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04] // 'PK\x03\x04'

function looksLikeZip(vfile, bytes) {
  if (/\.zip$/i.test(vfile.path)) return true
  if (!bytes || bytes.length < 4) return false
  return bytes[0] === ZIP_MAGIC[0] && bytes[1] === ZIP_MAGIC[1] && bytes[2] === ZIP_MAGIC[2] && bytes[3] === ZIP_MAGIC[3]
}

function isJunkEntry(name) {
  if (name.endsWith('/')) return true // directory entry
  if (name.startsWith('__MACOSX/') || name.includes('/__MACOSX/')) return true
  if (name === '.DS_Store' || name.endsWith('/.DS_Store')) return true
  return false
}

/**
 * Expands `.zip` VFiles (by extension or magic bytes) into their member VFiles,
 * recursing into nested zips. Enforces limits DURING expansion.
 * @param {VFile[]} vfiles
 * @param {{limits?: Partial<typeof DEFAULT_LIMITS>}} [opts]
 * @returns {Promise<{files: VFile[], warnings: string[]}>}
 */
export async function expandArchives(vfiles, opts = {}) {
  const limits = { ...DEFAULT_LIMITS, ...(opts.limits || {}) }
  const warnings = []
  const out = []
  // counters shared across the whole expansion (including nested zips)
  const counters = { entries: 0, totalBytes: 0 }

  function countEntry(size) {
    counters.entries += 1
    if (counters.entries > limits.maxEntries) {
      throw new ImportLimitError(
        `This import has more than ${limits.maxEntries.toLocaleString()} files. Split it into smaller batches and try again.`
      )
    }
    counters.totalBytes += size
    if (counters.totalBytes > limits.maxTotalBytes) {
      throw new ImportLimitError(
        `This import is larger than ${formatBytes(limits.maxTotalBytes)}. Split it into smaller batches and try again.`
      )
    }
  }

  async function expandOne(vfile) {
    const bytes = await vfile.bytes()
    if (!looksLikeZip(vfile, bytes)) {
      countEntry(vfile.size)
      out.push(vfile)
      return
    }

    if (bytes.length > limits.maxArchiveBytes) {
      throw new ImportLimitError(
        `"${vfile.path}" is larger than ${formatBytes(limits.maxArchiveBytes)} and can't be imported as a single zip.`
      )
    }

    let entries
    try {
      entries = unzipSync(bytes)
    } catch (err) {
      warnings.push(`Could not open "${vfile.path}" as a zip: ${err?.message || err}`)
      countEntry(vfile.size)
      out.push(vfile)
      return
    }

    for (const [name, data] of Object.entries(entries)) {
      if (isJunkEntry(name)) continue
      const memberPath = name
      const memberVfile = {
        path: memberPath,
        size: data.length,
        lastModified: vfile.lastModified ?? null,
        bytes: async () => data,
      }
      if (/\.zip$/i.test(memberPath)) {
        // nested zip: recurse, prefixing member paths with this entry's name
        await expandNested(memberVfile, memberPath)
      } else {
        countEntry(memberVfile.size)
        out.push(memberVfile)
      }
    }
  }

  // Handles a nested zip found inside another zip. `prefix` is the path (within
  // the parent) of this nested zip's own entry name — member paths get prefixed
  // with `${prefix}/`.
  async function expandNested(zipVfile, prefix) {
    const bytes = await zipVfile.bytes()
    if (bytes.length > limits.maxArchiveBytes) {
      throw new ImportLimitError(
        `"${zipVfile.path}" is larger than ${formatBytes(limits.maxArchiveBytes)} and can't be imported as a single zip.`
      )
    }
    let entries
    try {
      entries = unzipSync(bytes)
    } catch (err) {
      warnings.push(`Could not open "${zipVfile.path}" as a zip: ${err?.message || err}`)
      return
    }
    for (const [name, data] of Object.entries(entries)) {
      if (isJunkEntry(name)) continue
      const memberPath = `${prefix}/${name}`
      const memberVfile = {
        path: memberPath,
        size: data.length,
        lastModified: zipVfile.lastModified ?? null,
        bytes: async () => data,
      }
      if (/\.zip$/i.test(memberPath)) {
        await expandNested(memberVfile, memberPath)
      } else {
        countEntry(memberVfile.size)
        out.push(memberVfile)
      }
    }
  }

  for (const vfile of vfiles) {
    await expandOne(vfile)
  }

  return { files: out, warnings }
}

function formatBytes(n) {
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(1)}GB`
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(1)}MB`
  if (n >= 1024) return `${(n / 1024).toFixed(1)}KB`
  return `${n}B`
}

function fileToVFile(file, path) {
  return {
    path,
    size: file.size,
    lastModified: file.lastModified ?? null,
    bytes: async () => new Uint8Array(await file.arrayBuffer()),
  }
}

function entryFileAsync(entry) {
  return new Promise((resolve, reject) => entry.file(resolve, reject))
}

function readAllEntries(reader) {
  return new Promise((resolve, reject) => {
    const all = []
    function readBatch() {
      reader.readEntries((batch) => {
        if (!batch.length) {
          resolve(all)
          return
        }
        all.push(...batch)
        readBatch() // Chromium pages 100 entries per call — loop until empty
      }, reject)
    }
    readBatch()
  })
}

async function walkEntry(entry, pathPrefix, out) {
  if (entry.isFile) {
    const file = await entryFileAsync(entry)
    const path = pathPrefix ? `${pathPrefix}/${entry.name}` : entry.name
    out.push(fileToVFile(file, path))
  } else if (entry.isDirectory) {
    const reader = entry.createReader()
    const children = await readAllEntries(reader)
    const nextPrefix = pathPrefix ? `${pathPrefix}/${entry.name}` : entry.name
    for (const child of children) {
      await walkEntry(child, nextPrefix, out)
    }
  }
}

/**
 * Walks a drop's `DataTransfer`, expanding directories via the
 * webkitGetAsEntry() API. Falls back to plain `dataTransfer.files` when entries
 * are unavailable (e.g. non-Chromium browsers, or a drop with no entry support).
 * @param {DataTransfer} dataTransfer
 * @returns {Promise<VFile[]>}
 */
export async function collectDropped(dataTransfer) {
  // MUST snapshot synchronously, before any await — dataTransfer.items is
  // neutered after the first microtask.
  const entries = [...dataTransfer.items].map((item) => item.webkitGetAsEntry?.())

  const usableEntries = entries.filter(Boolean)
  if (usableEntries.length === 0) {
    return fromFileList(dataTransfer.files)
  }

  const out = []
  for (const entry of usableEntries) {
    await walkEntry(entry, '', out)
  }
  return out
}

/**
 * Converts a FileList (e.g. from an `<input webkitdirectory>` fallback) into
 * VFiles, preferring `webkitRelativePath` when present.
 * @param {FileList|File[]} fileList
 * @returns {VFile[]}
 */
export function fromFileList(fileList) {
  return [...fileList].map((file) => fileToVFile(file, file.webkitRelativePath || file.name))
}
