// scratch: node vfail.mjs <vitest json> <tag> -> totals + failing files (relative to app/)
import { readFileSync } from 'node:fs'
const [p, tag] = process.argv.slice(2)
const r = JSON.parse(readFileSync(p, 'utf8'))
const norm = (n) => n.split(String.fromCharCode(92)).join('/').replace(/.*\/app\//, '')
const f = r.testResults.filter(t => t.status !== 'passed').map(t => norm(t.name))
console.log(tag, `files ${r.numFailedTestSuites} failed | ${r.numPassedTestSuites} passed (${r.numTotalTestSuites}); tests ${r.numFailedTests} failed | ${r.numPassedTests} passed | ${r.numPendingTests + r.numTodoTests} skipped (${r.numTotalTests})`)
for (const x of f.sort()) console.log('  ' + x)
