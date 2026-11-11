// W5-T5: the Node half of the cross-engine probe. Evaluates tools/pine_cross_engine_probe.js verbatim over the
// runtime's own clockFns.js.   node tools/pine_cross_engine_probe.mjs --out <file>
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PROBE = join(HERE, 'pine_cross_engine_probe.js')
const CLOCK = join(HERE, '..', 'app', 'src', 'components', 'chart', 'engine', 'runtime', 'clockFns.js')

const i = process.argv.indexOf('--out')
if (i < 0) { console.error('usage: node pine_cross_engine_probe.mjs --out <file>'); process.exit(2) }
const clockSource = readFileSync(CLOCK, 'utf8').replace(/^export /gm, '')
const result = (0, eval)(readFileSync(PROBE, 'utf8'))(clockSource)
result.host = { engine: 'node', node: process.version, v8: process.versions.v8, icu: process.versions.icu, tz: process.versions.tz }
writeFileSync(process.argv[i + 1], JSON.stringify(result))
console.log(`node ${process.version} v8 ${process.versions.v8} icu ${process.versions.icu} tz ${process.versions.tz}: probe written`)
