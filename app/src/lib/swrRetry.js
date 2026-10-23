// The app-wide SWR retry rule, in its own module so a hook that adds to it
// (useStudy) calls THIS function instead of keeping a copy that can drift.
// App.jsx's SWR_CONFIG uses it as `shouldRetryOnError`.
//
// A 4xx answers the same way on every retry (signed out, not paid, not
// allowed, not there), so retrying only repeats it. 408 and 429 still retry.
// Fetchers that throw without a `status` still retry as before.
export function shouldRetryOnErrorAppWide(err) {
  return !(err && err.status >= 400 && err.status < 500 && err.status !== 408 && err.status !== 429)
}
