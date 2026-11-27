// TEMPORARY probe (deleted before hand-off): routing of the failing phrasings, under a given kinds list.
import { it } from 'vitest'
import fs from 'node:fs'
import { registerCatalog, PROD_KINDS } from './qa/capabilityRegression/testing/registry'
import { routedNames } from './qa/capabilityRegression/testing/route'
import { panelHost } from './qa/capabilityRegression/testing/harness'
import { pinClock } from './qa/capabilityRegression/testing/clock'
import { groupOfAction, wordsSelect, GROUPS } from './routing'
import { manifestFor } from './capabilities'

pinClock()
const PHRASES = (process.env.ARM_PHRASES || '').split('||').filter(Boolean)
const BOARD = process.env.ARM_BOARD || 'ONE'
const KINDS = process.env.ARM_KINDS ? process.env.ARM_KINDS.split(',') : PROD_KINDS

it('probe', async () => {
  await registerCatalog(KINDS)
  const full = manifestFor({ surface: 'charts', createIndicator: true, manageIndicators: true })
  const sizes = {}
  for (const c of full) { const g = groupOfAction(c.name); sizes[g] = (sizes[g] || 0) + 1 }
  const dataMembers = full.filter(c => groupOfAction(c.name) === 'data').map(c => c.name)
  const out = [{ total: full.length, sizes, dataMembers }]
  for (const text of PHRASES) {
    const v1 = routedNames(text, { host: panelHost(BOARD) })
    const matched = GROUPS.filter(g => wordsSelect(g.id, text)).map(g => g.id)
    out.push({ text, matched, sel: v1.routing?.selected, over: v1.overBudget, n: v1.names.length })
  }
  fs.writeFileSync(process.env.ARM_OUT, JSON.stringify(out, null, 1))
})
