// A headless Chrome profile is about 0.13 GB, and a rig that makes one and leaves it fills the disk (942 folders, 120 GB,
// 2026-11-05). So exactly one file may create one: cdp.mjs, which removes them on close, exit, signal and crash.
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const rigs = [...readdirSync(here).filter(f => /\.mjs$/.test(f)).map(f => join(here, f)), resolve(here, '../../../docs/economic-data/integration/tools/probe.mjs')]

describe('Chrome temp profiles', () => {
  it('only cdp.mjs creates one', () => {
    for (const f of rigs) if (!f.endsWith('cdp.mjs')) expect(readFileSync(f, 'utf8'), f).not.toMatch(/mkdtempSync/)
  })
  it('cdp.mjs removes them on close and on every way out', () => {
    const s = readFileSync(join(here, 'cdp.mjs'), 'utf8')
    for (const way of ["process.on('exit'", 'SIGINT', 'SIGTERM', 'uncaughtException', 'unhandledRejection', 'rmSync', 'maxRetries', 'taskkill']) expect(s, way).toContain(way)
  })
})
