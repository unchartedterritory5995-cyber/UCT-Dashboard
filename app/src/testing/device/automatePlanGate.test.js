// @vitest-environment node
/* Rails for the CI device job's funding gate.
 *
 * ⛔⛔ WHAT THIS FILE IS ACTUALLY FOR — CLAUDE.md rule 14, "An empty result is a failed
 * invocation until proven otherwise". Every case here is a way the gate could report a
 * clean green skip while measuring nothing, and one of them (`scripts/deploy_watch.py`
 * v1: forty `FileNotFoundError`s, exit 0) has already shipped in this repo.
 *
 * The gate's whole value is that FOUR different facts stay four different outcomes:
 *
 *     no HTTP response at all      →  FAIL_UNREACHABLE   (red)
 *     401/403 from BrowserStack    →  FAIL_AUTH          (red)
 *     a parsed plan saying "Free"  →  SKIP_NOT_FUNDED    (green skip)
 *     a parsed paid plan           →  RUN
 *
 * A `try { … } catch { skip }` gate maps ALL of those onto one green skip and looks
 * completely reasonable in review. §"the gate can be shown to fail" below builds exactly
 * that implementation and watches it collapse, so the assertion above it is proved to
 * DISCRIMINATE rather than merely to pass.
 *
 * ⭐ The live non-vacuity control — a real call to api.browserstack.com — is NOT here and
 * is NOT opt-in. It is `--self-check`, and `.github/workflows/joystick-device.yml` runs
 * it as a mandatory step before it will believe the gate. A rail whose important half
 * needs an env var to run gets read as "verified" when it silently skipped.
 */
import { Buffer } from 'node:buffer'
import { describe, it, expect, vi } from 'vitest'
import {
  OUTCOME, SKIP_LINE, PLAN_URL, CREDENTIAL_VARS,
  classifyResponse, classifyPlanDocument, credentialsPresent, decide, isSkip, isFail,
} from './automatePlanGate'

/* The exact bytes this endpoint returned to this machine on 2026-09-10, both with no
 * credentials and with wrong ones — see the measured block in automatePlanGate.js.
 * Written as a fixture so the classifier is tested against the REAL answer, not an
 * imagined JSON error envelope. */
const LIVE_401 = Object.freeze({
  status: 401,
  contentType: 'text/html; charset=utf-8',
  body: 'HTTP Basic: Access denied.\n',
  transportError: null,
})

/* The Free-plan body recorded for this account in 40-phase2-device.md §"RUN 4", the run
 * that lost three of four devices to `Automate testing time expired.` */
const FREE_PLAN = Object.freeze({
  status: 200,
  contentType: 'application/json',
  body: JSON.stringify({
    automate_plan: 'Free',
    parallel_sessions_running: 0,
    parallel_sessions_max_allowed: 1,
    queued_sessions: 0,
  }),
  transportError: null,
})

const PAID_PLAN = Object.freeze({
  status: 200,
  contentType: 'application/json',
  body: JSON.stringify({
    automate_plan: 'Automate Mobile',
    parallel_sessions_running: 0,
    parallel_sessions_max_allowed: 5,
    queued_sessions: 0,
  }),
  transportError: null,
})

const UNREACHABLE = Object.freeze({
  status: null,
  contentType: '',
  body: null,
  transportError: 'getaddrinfo ENOTFOUND api.browserstack.com',
})

const stubFetch = ({ status, contentType, body }) => vi.fn(async () => ({
  status,
  headers: { get: (h) => (h.toLowerCase() === 'content-type' ? contentType : null) },
  text: async () => body,
}))

const CREDS = { BROWSERSTACK_USERNAME: 'someone', BROWSERSTACK_ACCESS_KEY: 'a-key' }

/* ═══════════════════════════════════════════════════════════════════════════════════ */

describe('the four facts stay four outcomes', () => {
  it('⛔⛔ unreachable · auth-rejected · unfunded · funded land on FOUR DISTINCT outcomes', () => {
    const got = [UNREACHABLE, LIVE_401, FREE_PLAN, PAID_PLAN].map((r) => classifyResponse(r).outcome)

    expect(got).toEqual([
      OUTCOME.FAIL_UNREACHABLE,
      OUTCOME.FAIL_AUTH,
      OUTCOME.SKIP_NOT_FUNDED,
      OUTCOME.RUN,
    ])
    expect(new Set(got).size, 'two of these collapsed into one outcome').toBe(4)
  })

  it('⛔ "could not reach BrowserStack" is RED — it is not evidence about funding', () => {
    const v = classifyResponse(UNREACHABLE)
    expect(isFail(v.outcome)).toBe(true)
    expect(isSkip(v.outcome)).toBe(false)
    // And it says so in words, because a run log is read by a person at 3am.
    expect(v.detail).toMatch(/no HTTP response/i)
  })

  it('⛔ a 401 is RED — the secrets are set and were REJECTED, which is a defect', () => {
    const v = classifyResponse(LIVE_401)
    expect(v.outcome).toBe(OUTCOME.FAIL_AUTH)
    expect(isSkip(v.outcome)).toBe(false)
    expect(v.detail).toMatch(/not an unfunded plan/i)
  })

  it('a 5xx is unreachable, not unfunded — BrowserStack answered, but not with an answer', () => {
    const v = classifyResponse({ status: 502, contentType: 'text/html', body: '<html>bad gateway' })
    expect(v.outcome).toBe(OUTCOME.FAIL_UNREACHABLE)
  })

  it('a 404 is unparseable, not unfunded — the endpoint moved, we learned nothing', () => {
    const v = classifyResponse({ status: 404, contentType: 'application/json', body: '{}' })
    expect(v.outcome).toBe(OUTCOME.FAIL_UNPARSEABLE)
    expect(v.detail).toContain(PLAN_URL)
  })
})

describe('the body is only read once the status has earned it', () => {
  it('⚰️ THE MEASURED 401 IS text/html, NOT JSON — parsing it first would throw into a skip', () => {
    // This is the real defect this ordering prevents: `JSON.parse('HTTP Basic: Access
    // denied.')` throws, and a catch-all around the whole classification would file that
    // throw as "not funded". Prove the fixture really is unparseable JSON first, so this
    // test is about the ORDERING and not about a fixture that happens to parse.
    expect(() => JSON.parse(LIVE_401.body)).toThrow()
    expect(classifyResponse(LIVE_401).outcome).toBe(OUTCOME.FAIL_AUTH)
  })

  it('a 200 that is not JSON is unparseable — a proxy or captive portal is not a plan', () => {
    const v = classifyResponse({ status: 200, contentType: 'text/html', body: '<html>sign in</html>' })
    expect(v.outcome).toBe(OUTCOME.FAIL_UNPARSEABLE)
    expect(v.detail).toMatch(/not JSON/i)
  })

  it('a 200 whose JSON carries no `automate_plan` is unparseable, NOT unfunded', () => {
    // A response-shape change must surface as a red build, not as a permanent skip.
    const v = classifyResponse({ status: 200, contentType: 'application/json', body: '{"ok":true}' })
    expect(v.outcome).toBe(OUTCOME.FAIL_UNPARSEABLE)
    expect(v.detail).toMatch(/response shape changed/i)
  })

  it('a 200 with an unreadable body keeps its status and is unparseable, not unreachable', () => {
    const v = classifyResponse({ status: 200, contentType: 'application/json', body: null })
    expect(v.outcome).toBe(OUTCOME.FAIL_UNPARSEABLE)
  })
})

describe('what counts as funded', () => {
  it('"Free" is not funded', () => {
    expect(classifyPlanDocument({ automate_plan: 'Free', parallel_sessions_max_allowed: 1 }).outcome)
      .toBe(OUTCOME.SKIP_NOT_FUNDED)
  })

  it('⛔ "Automate Mobile" is FUNDED — the unfunded match is word-bounded, not a substring', () => {
    // A bare /free/i would be fine here, but /trial/ inside a plan name like
    // "Industrial" would not; the boundary is what stops a paid plan being skipped
    // forever by a coincidence of spelling.
    for (const name of ['Automate Mobile', 'Automate Pro', 'Enterprise', 'Industrial Automate']) {
      expect(classifyPlanDocument({ automate_plan: name }).outcome, name).toBe(OUTCOME.RUN)
    }
  })

  it('zero parallel sessions is not funded, whatever the plan is called', () => {
    expect(classifyPlanDocument({ automate_plan: 'Automate Mobile', parallel_sessions_max_allowed: 0 }).outcome)
      .toBe(OUTCOME.SKIP_NOT_FUNDED)
  })

  it('⛔ an ABSENT parallel-session field is not zero — a missing field must not mean "skip forever"', () => {
    expect(classifyPlanDocument({ automate_plan: 'Automate Mobile' }).outcome).toBe(OUTCOME.RUN)
  })

  it('⭐ an UNRECOGNISED plan RUNS — the loud error beats the silent one', () => {
    // If this ever flips to SKIP, a paid plan under a new name stops running devices and
    // nothing goes red to say so. That is the failure mode this whole file is about.
    const v = classifyPlanDocument({ automate_plan: 'Some Plan Name Nobody Has Seen' })
    expect(v.outcome).toBe(OUTCOME.RUN)
  })

  it('a plan document that is not an object is unparseable', () => {
    for (const bad of [null, 'Free', 42, ['Free']]) {
      expect(classifyPlanDocument(bad).outcome).toBe(OUTCOME.FAIL_UNPARSEABLE)
    }
  })
})

describe('the secrets question is answered locally, because the wire cannot answer it', () => {
  it('⚰️ MEASURED: no credentials and WRONG credentials give a byte-identical 401', () => {
    // Both measured 2026-09-10: `HTTP/1.1 401`, `text/html; charset=utf-8`,
    // `HTTP Basic: Access denied.`. So a 401 can never be attributed to absent secrets,
    // and "are they present" has to be asked of the environment before the call.
    expect(classifyResponse(LIVE_401).outcome).toBe(OUTCOME.FAIL_AUTH)
    expect(classifyResponse(LIVE_401).outcome).not.toBe(OUTCOME.SKIP_NO_SECRETS)
  })

  it('⛔ absent secrets skip WITHOUT making a call at all', async () => {
    const fetchImpl = stubFetch({ status: 200, contentType: 'application/json', body: '{}' })
    const v = await decide({ env: {}, fetchImpl })
    expect(v.outcome).toBe(OUTCOME.SKIP_NO_SECRETS)
    expect(fetchImpl, 'a call was made with no credentials to send').not.toHaveBeenCalled()
  })

  it('an EMPTY secret counts as absent — GitHub materialises an unset secret as ""', async () => {
    for (const env of [
      { BROWSERSTACK_USERNAME: '', BROWSERSTACK_ACCESS_KEY: 'k' },
      { BROWSERSTACK_USERNAME: '   ', BROWSERSTACK_ACCESS_KEY: 'k' },
      { BROWSERSTACK_USERNAME: 'u' },
    ]) {
      expect((await decide({ env, fetchImpl: stubFetch(FREE_PLAN) })).outcome)
        .toBe(OUTCOME.SKIP_NO_SECRETS)
    }
    expect(credentialsPresent(CREDS).present).toBe(true)
    expect(credentialsPresent({}).missing).toEqual(CREDENTIAL_VARS)
  })

  it('⛔ no credential VALUE reaches the verdict, and the header is Basic-encoded', async () => {
    let sentAuth = null
    const fetchImpl = vi.fn(async (_url, init) => {
      sentAuth = init.headers.Authorization
      return {
        status: 200,
        headers: { get: () => 'application/json' },
        text: async () => FREE_PLAN.body,
      }
    })
    const env = { BROWSERSTACK_USERNAME: 'realuser1', BROWSERSTACK_ACCESS_KEY: 'sUp3rSecretKey' }
    const v = await decide({ env, fetchImpl })

    expect(sentAuth).toBe('Basic ' + Buffer.from('realuser1:sUp3rSecretKey').toString('base64'))
    const printed = JSON.stringify(v)
    expect(printed).not.toContain('sUp3rSecretKey')
    expect(printed).not.toContain('realuser1')
    expect(printed).not.toContain(Buffer.from('realuser1:sUp3rSecretKey').toString('base64'))
  })
})

describe('decide() over a real transport', () => {
  it('a fetch that throws becomes FAIL_UNREACHABLE, never a skip', async () => {
    const fetchImpl = vi.fn(async () => { throw new Error('getaddrinfo ENOTFOUND api.browserstack.com') })
    const v = await decide({ env: CREDS, fetchImpl })
    expect(v.outcome).toBe(OUTCOME.FAIL_UNREACHABLE)
    expect(v.detail).toContain('ENOTFOUND')
  })

  it('a timeout becomes FAIL_UNREACHABLE, never a skip', async () => {
    const fetchImpl = vi.fn(async () => { throw Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' }) })
    const v = await decide({ env: CREDS, fetchImpl })
    expect(v.outcome).toBe(OUTCOME.FAIL_UNREACHABLE)
  })

  it('the live 401, delivered through the real transport path, is FAIL_AUTH', async () => {
    const v = await decide({ env: CREDS, fetchImpl: stubFetch(LIVE_401) })
    expect(v.outcome).toBe(OUTCOME.FAIL_AUTH)
    expect(v.status).toBe(401)
  })

  it('the Free plan, delivered through the real transport path, is a SKIP', async () => {
    const v = await decide({ env: CREDS, fetchImpl: stubFetch(FREE_PLAN) })
    expect(v.outcome).toBe(OUTCOME.SKIP_NOT_FUNDED)
    expect(isSkip(v.outcome)).toBe(true)
    expect(v.plan).toBe('Free')
  })
})

describe('this module refuses to collapse two facts itself', () => {
  it('⛔ a caller reporting BOTH a status and a transport error is refused, not resolved', () => {
    expect(() => classifyResponse({ status: 401, transportError: 'ENOTFOUND' }))
      .toThrow(/cannot both be true/i)
  })

  it('neither a status nor an error is a failed invocation, not a skip', () => {
    expect(classifyResponse({}).outcome).toBe(OUTCOME.FAIL_UNREACHABLE)
    expect(classifyResponse({ status: undefined, transportError: null }).outcome)
      .toBe(OUTCOME.FAIL_UNREACHABLE)
  })
})

describe('the skip line', () => {
  it('⛔ is EXACTLY the specified sentence — the workflow greps for it', () => {
    expect(SKIP_LINE).toBe('device job skipped: Automate not funded.')
  })
})

/* ═══════════════════════════════════════════════════════════════════════════════════
 * THE GATE CAN BE SHOWN TO FAIL.
 *
 * A gate nobody has watched fail is not a gate. The four-outcome assertion at the top
 * of this file would pass just as happily if `classifyResponse` were correct by
 * accident, so here is the implementation it exists to refuse — the one that reads as
 * perfectly sensible in a diff — measured collapsing the same four inputs.
 * ═══════════════════════════════════════════════════════════════════════════════════ */
describe('the control: the implementation this gate refuses', () => {
  /** ⚰️ NEVER. The `scripts/deploy_watch.py` defect, wearing a network costume. */
  const collapsingGate = ({ body, transportError }) => {
    try {
      if (transportError) throw new Error(transportError)
      const plan = JSON.parse(body)
      return /free/i.test(plan.automate_plan) ? 'SKIP' : 'RUN'
    } catch {
      return 'SKIP'
    }
  }

  it('⚰️ the catch-all gate maps unreachable, rejected AND unfunded onto ONE green skip', () => {
    const got = [UNREACHABLE, LIVE_401, FREE_PLAN, PAID_PLAN].map(collapsingGate)

    // Three separate facts, one answer. A dead access key, a DNS outage and a genuinely
    // exhausted plan all print "device job skipped" and exit 0 — forever.
    expect(got).toEqual(['SKIP', 'SKIP', 'SKIP', 'RUN'])
    expect(new Set(got).size).toBe(2)

    // ⭐ AND THAT IS THE POINT: the assertion this file opens with FAILS against this
    // implementation and PASSES against the shipped one. It discriminates.
    const shipped = [UNREACHABLE, LIVE_401, FREE_PLAN, PAID_PLAN].map((r) => classifyResponse(r).outcome)
    expect(new Set(shipped).size).toBe(4)
    expect(new Set(got).size).not.toBe(new Set(shipped).size)
  })

  /** ⚰️ The OTHER plausible wrong line, and the quieter one: a defensive `!plan.x ||`
   *  that treats a missing field as "not funded". This is the exact shape of
   *  `classifyPlanDocument`'s `automate_plan` branch — written the obvious way. */
  const defensiveGate = ({ body, transportError }) => {
    try {
      if (transportError) throw new Error(transportError)
      const plan = JSON.parse(body)
      if (!plan.automate_plan || /free/i.test(plan.automate_plan)) return 'SKIP'
      return 'RUN'
    } catch {
      return 'SKIP'
    }
  }

  it('⚰️ and the defensive variant skips on a SUCCESSFUL call it simply could not read', () => {
    // The quietest version of all: BrowserStack is up, authenticated, answering 200 —
    // and a renamed field turns the device job off with a green tick, permanently.
    // ⭐ MEASURED HERE, NOT ASSUMED: this case was first written against
    // `collapsingGate` and the rail went RED, because `/free/i.test(undefined)` is
    // false and that gate RUNS. The defect needed the `!plan.automate_plan ||` line to
    // appear, which is itself the finding — a catch-all is not the only way to lose a
    // fact, and the two wrong implementations fail on DIFFERENT inputs.
    const shapeChanged = { status: 200, contentType: 'application/json', body: '{"plan":"Automate Mobile"}' }

    expect(defensiveGate(shapeChanged)).toBe('SKIP')
    expect(collapsingGate(shapeChanged)).toBe('RUN')
    expect(classifyResponse(shapeChanged).outcome).toBe(OUTCOME.FAIL_UNPARSEABLE)

    // Non-vacuity for this control: the same two gates agree with the shipped one on a
    // plan they CAN read, so the disagreement above is about the shape change and not
    // about the fixtures being unreadable in general.
    expect(defensiveGate(PAID_PLAN)).toBe('RUN')
    expect(collapsingGate(PAID_PLAN)).toBe('RUN')
    expect(classifyResponse(PAID_PLAN).outcome).toBe(OUTCOME.RUN)
  })
})
