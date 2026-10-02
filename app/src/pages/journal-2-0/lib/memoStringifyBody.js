/**
 * Wave 10 (lane TY5 -- "typing busy time < 16 ms/char up to 2,000 paragraphs,
 * read on `typing_busy_per_char`", ruling D24).
 *
 * `perf-budgets.md`/TY5's own CPU profile named the next cost after lane
 * TY2's `memoDocJSON`: `captureLocalState` already returns a tree where every
 * UNCHANGED paragraph's JSON object is the exact same object reference as the
 * keystroke before (`memoDocJSON.js`) -- but `saveDraftLocally` still calls
 * plain `JSON.stringify()` on that tree before writing it to localStorage,
 * and `JSON.stringify` does not know or care that most of the tree is
 * unchanged: it walks and re-emits EVERY character of EVERY node's string
 * form on EVERY call, regardless of object identity. Profiled (lane TY5,
 * `docs/notebook/perf-runs/ty5/`): `saveDraftLocally`'s own self time grows
 * from ~0 to ~1.5 ms/key between a 1-paragraph and a 2,000-paragraph note --
 * the single largest size-scaling cost found, ahead of ProseMirror's own
 * transaction-apply machinery.
 *
 * This is a memoized drop-in for `JSON.stringify(bodyJson)`, caching the
 * STRING form of each node keyed on the node's JSON OBJECT (the object
 * `memoDocJSON`'s `toJSON()` already produces and already reuses by
 * reference for an untouched subtree) -- a second cache layer over the
 * first, same mechanism one level up: object identity in, string reuse out.
 * It changes ONLY when the string is computed, never what the string
 * contains -- `memoStringifyBody.test.js` proves byte-identical output
 * against plain `JSON.stringify()` on the same tree `memoDocJSON.test.js`
 * exercises, including the saveDraftLocally WRAPPER object (title/
 * subtitle/bodyJson/savedAt/sessionId/baseUpdatedAt/writtenSchema) this
 * module's second export reconstructs by hand.
 *
 * ⛔⛔ THE NODE SERIALIZER (`stringifyNode`) MUST STAY IN LOCKSTEP WITH
 * `memoDocJSON.js`'s `toJSON()` -- same key order (`type`, `attrs`,
 * `content`, `marks`, `text`, each present only when `toJSON()` would add
 * it), because this function trusts that order rather than re-deriving it.
 * `attrs`/`marks` are handed to the NATIVE `JSON.stringify` unchanged (they
 * are small, per-node, and do not scale with document length -- there is no
 * memoization win there worth the reimplementation risk, the same call
 * `memoDocJSON.js` itself makes about marks).
 *
 * ⛔⛔ `stringifyDraftPayload` MUST STAY IN LOCKSTEP WITH `saveDraftLocally`'s
 * object literal in NoteEditorPage.jsx (the exact field list and order). It
 * reconstructs that object's JSON form field by field so `bodyJson` can be
 * the pre-computed, memoized string rather than a plain value every call
 * re-stringifies from scratch. Every field it touches is guaranteed never
 * `undefined` at that call site (title/subtitle are refs seeded `''`,
 * `savedAt`/`sessionId` are always-present scalars, `usableBaseline()`
 * always returns `string | null`, `writtenSchema` is always an integer) --
 * `JSON.stringify(undefined)` would silently OMIT a key, the one failure
 * mode hand-rolled field-by-field construction does not catch for you, and
 * `memoStringifyBody.test.js` asserts byte-equality against the native path
 * on the exact field set in use today specifically so a future field added
 * to one side and not the other is caught immediately rather than drifting.
 */

/** A memoized `JSON.stringify()` for a `memoDocJSON`-shaped node tree. One
 *  instance per editor lifetime, same convention as `createMemoDocJSON()`. */
export function createMemoStringify() {
  const cache = new WeakMap()
  function stringifyNode(obj) {
    if (obj === null) return 'null'
    const hit = cache.get(obj)
    if (hit !== undefined) return hit
    let s = `{"type":${JSON.stringify(obj.type)}`
    if ('attrs' in obj) s += `,"attrs":${JSON.stringify(obj.attrs)}`
    if ('content' in obj) {
      s += ',"content":'
      s += obj.content === null ? 'null' : `[${obj.content.map(stringifyNode).join(',')}]`
    }
    if ('marks' in obj) s += `,"marks":${JSON.stringify(obj.marks)}`
    if ('text' in obj) s += `,"text":${JSON.stringify(obj.text)}`
    s += '}'
    cache.set(obj, s)
    return s
  }
  return stringifyNode
}

/**
 * Byte-identical to:
 *   JSON.stringify({ title, subtitle, bodyJson, savedAt, sessionId, baseUpdatedAt, writtenSchema })
 * with `bodyJsonStr` already the memoized stringify of `bodyJson` (this
 * module's `createMemoStringify()`, or any producer of the same bytes
 * `JSON.stringify(bodyJson)` would produce).
 */
export function stringifyDraftPayload({ title, subtitle, bodyJsonStr, savedAt, sessionId, baseUpdatedAt, writtenSchema }) {
  return `{"title":${JSON.stringify(title)}` +
    `,"subtitle":${JSON.stringify(subtitle)}` +
    `,"bodyJson":${bodyJsonStr}` +
    `,"savedAt":${JSON.stringify(savedAt)}` +
    `,"sessionId":${JSON.stringify(sessionId)}` +
    `,"baseUpdatedAt":${JSON.stringify(baseUpdatedAt)}` +
    `,"writtenSchema":${JSON.stringify(writtenSchema)}}`
}
