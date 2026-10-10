// app/src/lib/responseBody.js
//
// TERM-033: the two body reads that used to be written `res.json().catch(() => null)`.
//
// That idiom is the census's target (`swallowedFetch.census.test.js`): a failure folded
// into the same `null` an empty answer would be. These two helpers keep the failure
// NAMED at the call site instead:
//
//   failureDetail(res)   the server's explanation on a response whose STATUS already
//                        said it failed. The failure is decided by the status, never by
//                        this read; an unreadable body only means "no explanation", and
//                        the caller supplies its own sentence. It cannot turn a failure
//                        into data.
//
//   readSuccessBody(res) the JSON of a response whose status said yes, as a tagged
//                        outcome: `{ ok: true, body }`, or `{ ok: false, error }` when the
//                        body could not be read. The caller decides, in code, what an
//                        unreadable success means (usually "revalidate and read the truth").

/** The `detail` string of a FAILED response, or `null` when the body has none, is not JSON,
 *  or carries a non-string detail (a 422's validation array is not a sentence to show). */
export async function failureDetail(res) {
  let body
  try {
    body = await res.json()
  } catch {
    return null // no readable explanation; the status already carries the failure
  }
  const detail = body?.detail
  return typeof detail === 'string' && detail !== '' ? detail : null
}

/** The JSON body of a SUCCESSFUL response, tagged so an unreadable body stays a stated outcome. */
export async function readSuccessBody(res) {
  try {
    return { ok: true, body: await res.json() }
  } catch (error) {
    return { ok: false, error }
  }
}
