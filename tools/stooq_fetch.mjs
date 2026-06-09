// Fetch a Stooq daily OHLCV CSV, solving its SHA-256 proof-of-work anti-bot wall.
// Usage: node stooq_fetch.mjs <symbol>   e.g. node stooq_fetch.mjs kde.us
import crypto from 'node:crypto'

const sym = process.argv[2] || 'kde.us'
const url = `https://stooq.com/q/d/l/?s=${sym}&i=d`
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36'

const jar = new Map()
const cookieHeader = () => [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ')
function stash(res) {
  for (const sc of res.headers.getSetCookie?.() ?? []) {
    const [kv] = sc.split(';'); const i = kv.indexOf('=')
    jar.set(kv.slice(0, i).trim(), kv.slice(i + 1).trim())
  }
}

function solve(c, d) {
  const prefix = '0'.repeat(d)
  let n = 0
  for (;;) {
    const h = crypto.createHash('sha256').update(c + n).digest('hex')
    if (h.startsWith(prefix)) return n
    n++
  }
}

async function get() {
  const res = await fetch(url, { headers: { 'User-Agent': UA, 'Cookie': cookieHeader() } })
  stash(res)
  return await res.text()
}

let body = await get()
if (body.includes('crypto.subtle.digest')) {
  const c = body.match(/c="([^"]+)"/)[1]
  const d = Number(body.match(/d=(\d+)/)[1])
  process.stderr.write(`PoW challenge: d=${d}, solving…\n`)
  const t0 = Date.now()
  const n = solve(c, d)
  process.stderr.write(`solved n=${n} in ${Date.now() - t0}ms\n`)
  const v = await fetch('https://stooq.com/__verify', {
    method: 'POST',
    headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded', 'Cookie': cookieHeader() },
    body: `c=${encodeURIComponent(c)}&n=${n}`,
  })
  stash(v)
  process.stderr.write(`/__verify -> ${v.status}\n`)
  body = await get()
}

process.stdout.write(body)
