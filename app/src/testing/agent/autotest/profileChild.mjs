// UCT Agent AUTOTEST: the child profileCleanup.check.mjs ends in different ways. Launches one real headless Chrome on a run profile,
// prints the profile path, then: `exit` exits normally, `crash` throws, `hang` waits to be killed hard, `own` uses a per-launch profile.
import { runProfile, launch } from '../../../econHarness/cdp.mjs'
import { claimProfile } from './profileGuard.mjs'

const how = process.argv[2]
const profile = how === 'own' ? null : claimProfile(runProfile())
const b = await launch({ width: 400, height: 300, profile })
await b.evaluate('1 + 1')
console.log(JSON.stringify({ profile, pid: process.pid }))
if (how === 'own') { await b.close(); process.exit(0) }
if (how === 'exit') process.exit(0)
if (how === 'crash') setTimeout(() => { throw new Error('a deliberate crash after Chrome came up') }, 50)
if (how === 'hang') setInterval(() => {}, 1000)
