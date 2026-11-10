import { readFileSync } from 'node:fs'
const r = JSON.parse(readFileSync(process.argv[2], 'utf8'))
for (const t of r.testResults.filter(t => t.status !== 'passed')) {
  const fails = t.assertionResults.filter(a => a.status === 'failed')
  console.log(t.name.split(String.fromCharCode(92)).join('/').replace(/.*\/app\//, ''), 'failedTests=' + fails.length, fails.length ? '' : 'FILE-LEVEL: ' + String(t.message).replace(/\s+/g, ' ').slice(0, 220))
  for (const a of fails) console.log('   - ' + a.fullName.slice(0, 160), '|', String(a.failureMessages[0] || '').replace(/\s+/g, ' ').replace(/[0-9]+\.[0-9]+/g, '#').slice(0, 200))
}
