/**
 * A tag's identity, pinned on both sides — review S3. The sidebar computes
 * `tagKey` to match a tag it was handed as TEXT to the server's tree nodes;
 * `notes.py::tag_key` decides those nodes. ONE table, tests/fixtures_tag_keys.json,
 * both must reproduce — the server half is tests/test_tag_key_parity.py.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { tagKey } from './tagTree'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '../../../../..')
const { rows: ROWS } = JSON.parse(fs.readFileSync(path.join(REPO, 'tests/fixtures_tag_keys.json'), 'utf8'))

describe('tagKey ⇄ notes.py tag_key', () => {
  it.each(ROWS.map((r) => [JSON.stringify(r.raw), r]))('%s', (_name, r) => {
    expect(tagKey(r.raw)).toBe(r.key)
  })

  it('the table holds the rows that split the two languages', () => {
    const raws = new Set(ROWS.map((r) => r.raw))
    for (const needle of ['\u0085nel', '﻿bom', 'Élan', 'Q3 / Q4', 'İstanbul']) {
      expect(raws.has(needle), JSON.stringify(needle)).toBe(true)
    }
  })
})
