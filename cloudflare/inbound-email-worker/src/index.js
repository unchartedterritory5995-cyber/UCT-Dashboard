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
        'X-UCT-Timestamp': timestamp,
        'X-UCT-Signature': signature,
      },
      body,
    })
    // UCT answers 202 for every message it accepted — including one addressed to
    // nobody, which it drops without saying so. Anything else is a failure worth
    // seeing in the worker's logs (a 401 means the two secrets disagree; a 404
    // means NOTEBOOK_INBOUND_EMAIL_ENABLED is off on UCT).
    if (res.status !== 202) {
      throw new Error(`UCT refused the message: HTTP ${res.status}`)
    }
  },
}
