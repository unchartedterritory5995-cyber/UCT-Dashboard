// UCT Agent AUTOTEST: the BROWSER-MOCK-MODEL context for run.mjs. Free: the scripted relay answers every turn, no key is
// read (any in the environment is removed first), and /api goes nowhere. Unless BA_BASE names a server already running, the dev
// server is this process's own (selectionServe.mjs): it starts here and dies with the process.
import { pathToFileURL } from 'node:url'

export async function startMock({ port = 5303, cache = '' } = {}) {
  for (const k of ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'PERPLEXITY_API_KEY', 'UCT_AGENT_EVAL_API_KEY']) delete process.env[k]
  let routing = process.env.BA_ROUTING
  let server = null
  if (!process.env.BA_BASE) {
    if (!cache) throw new Error('--cache: a scratch folder of this run\'s own (the dev server cache and routing bundle live there)')
    const { startServer } = await import('./selectionServe.mjs')
    server = await startServer({ port, cacheDir: cache })
    process.env.BA_BASE = server.base
    routing = server.routing
  }
  if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(process.env.BA_BASE)) throw new Error(`BROWSER-MOCK-MODEL runs on loopback only, not ${process.env.BA_BASE}`)
  const { startRelay } = await import('../acceptance/lib.mjs')
  const { groupOfAction } = await import(pathToFileURL(routing).href)
  return { ctx: { R: await startRelay({ groupOfAction }), mock: true }, server }
}
