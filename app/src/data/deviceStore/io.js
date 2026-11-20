// app/src/data/deviceStore/io.js — the device store's file I/O, behind one small interface so the
// worker's logic (engine.js) runs unchanged against OPFS in a browser and against memory in tests.
//
//   io.list()                     → Promise<string[]>   names in the store's directory
//   io.open(name, {create})       → Promise<Handle>     ONE handle per file (OPFS sync access handles
//                                                       are exclusive; the memory one enforces it too)
//   io.remove(name)               → Promise<void>       (a missing file is not an error)
//   Handle (all SYNCHRONOUS — the read path is a sync positioned read):
//     read(u8, at) → bytes read · write(u8, at) → bytes written · size() · truncate(n) · flush() · close()
//
// OPFS needs a secure context (https, or localhost) and FileSystemSyncAccessHandle, which exists only
// in a dedicated worker. `opfsIO()` resolves null where either is missing (the store then stays off).

export const STORE_DIR = 'uct-device-store'

export class FileBusyError extends Error {
  constructor(name) { super(`file is open elsewhere: ${name}`); this.name = 'NoModificationAllowedError' }
}

/** In-memory files. `shared` lets several "tabs" (tests) see one disk, like one origin's OPFS. */
export function memoryIO(shared = new Map()) {
  const files = shared                  // name → { buf: Uint8Array, size: number, open: boolean }
  const io = {
    files,
    async list() { return [...files.keys()] },
    async open(name, { create = false } = {}) {
      let f = files.get(name)
      if (!f) {
        if (!create) { const e = new Error(`not found: ${name}`); e.name = 'NotFoundError'; throw e }
        f = { buf: new Uint8Array(0), size: 0, open: false }
        files.set(name, f)
      }
      if (f.open) throw new FileBusyError(name)
      f.open = true
      let closed = false
      const live = () => { if (closed) throw new Error(`handle closed: ${name}`) }
      return {
        read(u8, at = 0) {
          live()
          const n = Math.max(0, Math.min(u8.length, f.size - at))
          if (n) u8.set(f.buf.subarray(at, at + n), 0)
          return n
        },
        write(u8, at = 0) {
          live()
          const need = at + u8.length
          if (need > f.buf.length) {
            const grown = new Uint8Array(Math.max(need, f.buf.length * 2, 1024))
            grown.set(f.buf.subarray(0, f.size), 0)
            f.buf = grown
          }
          f.buf.set(u8, at)
          if (need > f.size) f.size = need
          return u8.length
        },
        size() { live(); return f.size },
        truncate(n) { live(); f.size = Math.min(n, f.size); if (n > f.size) { io._grow(f, n) } },
        flush() { live() },
        close() { if (!closed) { closed = true; f.open = false } },
      }
    },
    _grow(f, n) {
      if (n > f.buf.length) { const g = new Uint8Array(n); g.set(f.buf.subarray(0, f.size)); f.buf = g }
      f.buf.fill(0, f.size, n)
      f.size = n
    },
    async remove(name) {
      const f = files.get(name)
      if (!f) return
      if (f.open) throw new FileBusyError(name)
      files.delete(name)
    },
  }
  return io
}

/** OPFS (worker only). Resolves null where OPFS sync access handles are not available. */
export async function opfsIO() {
  try {
    if (typeof navigator === 'undefined' || !navigator.storage?.getDirectory) return null
    if (typeof FileSystemFileHandle === 'undefined' || !('createSyncAccessHandle' in FileSystemFileHandle.prototype)) return null
    const root = await navigator.storage.getDirectory()
    const dir = await root.getDirectoryHandle(STORE_DIR, { create: true })
    return {
      async list() {
        const out = []
        for await (const name of dir.keys()) out.push(name)
        return out
      },
      async open(name, { create = false } = {}) {
        const fh = await dir.getFileHandle(name, { create })
        const h = await fh.createSyncAccessHandle()
        // Safari before 16.4 shipped these methods ASYNC (promises): the store's read path is synchronous
        // by design, so there it stays off (every read null) rather than half-working.
        if (typeof h.getSize() !== 'number') { try { h.close() } catch { /* closing */ } throw new Error('opfs: sync access handle is not synchronous here') }
        return {
          read: (u8, at = 0) => h.read(u8, { at }),
          write: (u8, at = 0) => h.write(u8, { at }),
          size: () => h.getSize(),
          truncate: (n) => h.truncate(n),
          flush: () => h.flush(),
          close: () => { try { h.close() } catch { /* already closed */ } },
        }
      },
      async remove(name) {
        try { await dir.removeEntry(name) } catch (e) { if (e?.name !== 'NotFoundError') throw e }
      },
    }
  } catch {
    return null
  }
}
