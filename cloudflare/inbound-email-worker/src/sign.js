// UCT inbound-email worker — the two pure halves, kept free of any dependency so
// the repo's Python tests can run them under Node and hold them to the server:
//
//   * signBody     — must produce EXACTLY what the server's
//                    `inbound_email.expected_signature` expects.
//   * buildPayload — must produce EXACTLY the shape `inbound_email.ingest` reads.
//
// tests/test_notebook_inbound_email.py imports this file through `node` and
// compares both answers with Python's. Change either side and that rail fails.

const encoder = new TextEncoder()

function toHex(buffer) {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Hex HMAC-SHA256 over `<timestamp>.<body>`.
 *
 * The timestamp is INSIDE the signed bytes: a captured request replayed with a
 * fresh `X-UCT-Timestamp` no longer verifies, and the server refuses anything
 * older than five minutes.
 */
export async function signBody(secret, timestamp, body) {
  if (!secret) throw new Error('NOTEBOOK_INBOUND_EMAIL_SECRET is not set on this worker')
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  )
  const mac = await crypto.subtle.sign('HMAC', key, encoder.encode(`${timestamp}.${body}`))
  return toHex(mac)
}

/**
 * The JSON the server ingests, from the envelope and a postal-mime result
 * parsed with `attachmentEncoding: 'base64'`.
 *
 * ⛔ `to` is the ENVELOPE recipient (`message.to`), never the To: header — the
 * header is whatever the sender typed, the envelope is where Cloudflare actually
 * delivered it, and only the address picks the member.
 */
export function buildPayload(envelope, parsed) {
  const p = parsed || {}
  return {
    to: String(envelope?.to || ''),
    from: String(envelope?.from || ''),
    subject: typeof p.subject === 'string' ? p.subject : '',
    text: typeof p.text === 'string' ? p.text : '',
    html: typeof p.html === 'string' ? p.html : '',
    attachments: (Array.isArray(p.attachments) ? p.attachments : []).map((a) => ({
      name: a?.filename || 'attachment',
      content_type: a?.mimeType || 'application/octet-stream',
      base64: typeof a?.content === 'string' ? a.content : '',
    })),
  }
}

export function unixSeconds(nowMs = Date.now()) {
  return String(Math.floor(nowMs / 1000))
}
