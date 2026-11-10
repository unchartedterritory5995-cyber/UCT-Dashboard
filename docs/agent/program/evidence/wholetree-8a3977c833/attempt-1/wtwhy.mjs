import { readFileSync } from 'node:fs'
const [p, ...pats] = process.argv.slice(2)
const r = JSON.parse(readFileSync(p, 'utf8'))
for (const t of r.testResults.filter(t => t.status === 'failed' && pats.some(x => t.name.includes(x)))) {
  const f = t.assertionResults.filter(a => a.status === 'failed')
  console.log(t.name.split(String.fromCharCode(92)).join('/').replace(/.*\/app\//, ''), 'failed', f.length, '/', t.assertionResults.length, f.length ? '' : 'FILE: ' + String(t.message).slice(0, 200))
  for (const a of f.slice(0, 3)) console.log('   - ' + a.title.slice(0, 90) + ' | ' + String(a.failureMessages[0] || '').split('\n')[0].replace(/[0-9]+\.[0-9]+/g, '#').slice(0, 180))
}
