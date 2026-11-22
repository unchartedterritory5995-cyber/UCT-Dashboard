// The vitest shard plan, computed by vitest's OWN sequencer — never re-implemented here.
//
// ⛔ `npx vitest list --shard=i/n --filesOnly` IS NOT A SHARD LIST in vitest 4. Read in
// node_modules/vitest/dist/chunks/cac.*.js: `list --filesOnly` prints
// `getRelevantTestSpecifications()` and returns; `--shard` is applied only inside the pool's
// `executeTests` (`sequencer.shard(specs)`), i.e. at RUN time. So every `list --shard=i/4`
// prints the WHOLE suite, and a "proof" built on it would compare four copies of one list.
//
// ⭐ So this asks vitest for the same two things the run uses: the relevant specifications
// (the exact call `list --filesOnly` makes) and the configured sequencer class
// (`config.sequence.sequencer`, the one `vitest run --shard=i/n` instantiates), and calls
// that class's `shard()` once per index. The PROOF is `tools/vitest_shards.py --prove`,
// which reads the JSON this writes; this script only reports.
//
// Usage (from app/):  node scripts/vitest-shard-plan.mjs <count> <out.json>
import { writeFileSync } from 'node:fs'
import { relative } from 'node:path'
import { createVitest } from 'vitest/node'

const count = Number(process.argv[2] || 4)
const out = process.argv[3] || '../vitest-shard-plan.json'
if (!Number.isInteger(count) || count < 1) {
  console.error(`bad shard count: ${process.argv[2]}`)
  process.exit(2)
}

const ctx = await createVitest('test', { watch: false, run: true })
let code = 0
try {
  const specs = await ctx.getRelevantTestSpecifications([])
  const name = (s) => relative(ctx.config.root, s.moduleId).replace(/\\/g, '/')
  const Sequencer = ctx.config.sequence.sequencer
  const shards = {}
  for (let index = 1; index <= count; index++) {
    // The sequencer reads `config.shard` exactly as `--shard=index/count` would set it.
    ctx.config.shard = { index, count }
    const part = await new Sequencer(ctx).shard(Array.from(specs))
    shards[String(index)] = part.map(name)
  }
  ctx.config.shard = undefined
  const plan = {
    vitest_version: ctx.version,
    sequencer: Sequencer.name || 'anonymous',
    count,
    full: specs.map(name),
    shards,
  }
  writeFileSync(out, JSON.stringify(plan, null, 2) + '\n')
  console.log(`vitest ${plan.vitest_version} · sequencer ${plan.sequencer} · ` +
    `${plan.full.length} files -> ` +
    Object.entries(shards).map(([i, f]) => `${i}/${count}: ${f.length}`).join(', '))
} catch (e) {
  console.error(e)
  code = 1
} finally {
  await ctx.close()
}
process.exit(code)
