// UCT inbound-email worker (wave 7, lane G, G3).
//
// Cloudflare Email Routing hands every message for `notes+*@<domain>` to this
// worker. It parses the MIME (postal-mime), builds the payload, signs it with
// the shared secret and POSTs it to UCT, which turns it into a note in the
// member's Inbox folder. The worker decides NOTHING about who the member is:
// UCT reads that from the address alone.
//
// Setup, secrets and the flip order: docs/notebook/email-in-setup.md.

import PostalMime from 'postal-mime'
import { buildPayload, signBody, unixSeconds } from './sign.js'

// The worker names itself, so Cloudflare's Security -> Events can tell its
// requests apart (whole-branch review I-1). ⛔ This does NOT get it past the
// zone's Browser Integrity Check -- a non-browser user agent is exactly what
// that check refuses. The skip rule in docs/notebook/email-in-setup.md §5a is
// what does, and it is an owner step, not verified on the live account.
const USER_AGENT = 'uct-inbound-email/1 (+https://uctintelligence.com)'

export default {
  async email(message, env) {
    const parsed = await PostalMime.parse(message.raw, { attachmentEncoding: 'base64' })
    const body = JSON.stringify(buildPayload({ to: message.to, from: message.from }, parsed))
    const timestamp = unixSeconds()
    const signature = await signBody(env.NOTEBOOK_INBOUND_EMAIL_SECRET, timestamp, body)
    const res = await fetch(env.INBOUND_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': USER_AGENT,
        'X-UCT-Timestamp': timestamp,
        'X-UCT-Signature': signature,
      },
      body,
    })
    // UCT answers 202 for every message it accepted — including one addressed to
    // nobody, which it drops without saying so. Anything else is a failure worth
    // seeing in the worker's logs (a 401 means the two secrets disagree; a 403
    // means Cloudflare's own edge refused the request before UCT saw it --
    // Browser Integrity Check, error 1010 -- see email-in-setup.md §5a; a 404
    // means the request reached UCT and NOTEBOOK_INBOUND_EMAIL_ENABLED is off).
    if (res.status !== 202) {
      throw new Error(`UCT refused the message: HTTP ${res.status}`)
    }
  },
}
