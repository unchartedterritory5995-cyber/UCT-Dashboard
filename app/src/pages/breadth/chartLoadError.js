/**
 * What a member reads when the breadth history call fails.
 *
 * 🔴 THE DEFECT (audit A-01, P0): the tab's own fetcher parsed ANY body as data,
 * so a 401, 402 or 500 answered with JSON rendered "No data in selected range." —
 * a confident claim that the market was quiet. `utils/jsonFetcher` throws on a
 * non-OK answer and carries `status`; this turns the status into a sentence the
 * member can act on. Copy: `docs/breadth/02-design.md` §6 (D-026).
 */
const SIGN_IN = Object.freeze({ label: 'Sign in', href: '/login' })
const SEE_PLANS = Object.freeze({ label: 'See plans', href: '/pricing' })
const RETRY = Object.freeze({ label: 'Retry', retry: true })

function classify(error) {
  const status = error?.status
  if (status === 401) return 'signin'
  if (status === 402) return 'plan'
  // A status means the server answered; a SyntaxError means it answered with a
  // body that was not JSON. Only no answer at all is the connection.
  if (typeof status === 'number' || error instanceof SyntaxError) return 'server'
  return 'network'
}

export function describeLoadError(error) {
  switch (classify(error)) {
    case 'signin':
      return { kind: 'signin', title: 'Your session has ended.', body: 'Sign in again to load breadth history.', action: { ...SIGN_IN } }
    case 'plan':
      return { kind: 'plan', title: 'Data Charts is part of the UCT plan.', body: 'Choose a plan to chart breadth history.', action: { ...SEE_PLANS } }
    case 'server':
      return { kind: 'server', title: "Breadth history didn't load.", body: 'The server returned an error.', action: { ...RETRY } }
    default:
      return { kind: 'network', title: "Breadth history didn't load.", body: 'Check your connection, then retry.', action: { ...RETRY } }
  }
}

/** A failure while a chart is already on screen: the chart stays and the notice says it is the last loaded data. */
export function describeRefreshError(error) {
  const base = describeLoadError(error)
  if (base.kind === 'signin' || base.kind === 'plan') return base
  return { kind: base.kind, title: "Couldn't refresh breadth history.", body: 'Showing the last loaded data.', action: { ...RETRY } }
}

/** An ended session or a lapsed plan is not fixed by asking again; retrying only repeats the failure. */
export function shouldRetryLoad(error) {
  const kind = classify(error)
  return kind !== 'signin' && kind !== 'plan'
}
