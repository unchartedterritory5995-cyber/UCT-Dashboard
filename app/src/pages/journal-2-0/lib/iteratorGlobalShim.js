/**
 * Defines the `Iterator` global where the engine does not, for `pdfjs-dist`'s benefit.
 *
 * ⛔⛔ THIS IS A SEPARATE MODULE FOR ONE REASON: **ES IMPORTS ARE HOISTED.** Written as a top-level
 * `if` above the `import * as pdfjsLib from 'pdfjs-dist/…'` line in `pdfjs.js`, this code would
 * look like it runs first and would in fact run *after* pdf.js had already been evaluated — and
 * crashed. A side-effect import placed before the pdfjs import is the only ordering the module
 * system actually honours, because sibling imports evaluate depth-first in source order.
 *
 * ⚰️ WHAT IT FIXES. 2026-09-12, real iPhone 15 Pro / iOS Safari 17.5 against production:
 * `/journal/notebook` rendered its route-level error boundary instead of the page —
 * `ReferenceError: Can't find variable: Iterator`. `pdfjs-dist@6` carries, at module top level in
 * BOTH its modern and legacy builds:
 *
 *     if (typeof Iterator.prototype.join !== "function") { Iterator.prototype.join = … }
 *
 * ⭐ That is pdf.js's own feature-detect for Iterator Helpers, written so that it throws on exactly
 * the engines it is detecting for — `typeof X.prototype` still evaluates `X`, and the `Iterator`
 * global did not ship until Safari 18.4.
 *
 * ⭐ WHY THIS IS FOUR LINES AND NOT A POLYFILL. `%IteratorPrototype%` really does exist in every
 * engine we support; it simply is not reachable under the name `Iterator` before 18.4. Taking it
 * off a built-in iterator and hanging it on a constructor named `Iterator` gives pdf.js's shim the
 * genuine object it was trying to reach, so `join` lands on the prototype every iterator in the
 * realm already inherits from. Nothing here re-implements a single iterator helper.
 *
 * ⛔ NO NEW DEPENDENCY. `core-js` is absent from this project's `package.json` and lockfile
 * (checked), and adding it to reach one method would be a far larger surface than this.
 *
 * ⚠️ SCOPE. This is imported by `lib/pdfjs.js` only, which lives behind the PDF viewer's own lazy
 * boundary — so it is evaluated when a member opens a document preview and never on app start.
 * It is deliberately NOT a global entry-point polyfill: the app does not otherwise use Iterator
 * Helpers, and a shim that loads for everyone to serve one dependency is how a polyfill bundle
 * starts growing without anyone deciding to.
 */
if (typeof globalThis.Iterator === 'undefined') {
  const iteratorPrototype = Object.getPrototypeOf(Object.getPrototypeOf([][Symbol.iterator]()))
  // Constructing it must throw, as the real abstract `Iterator` does — nothing should be able to
  // `new Iterator()` and receive an object the engine would never have produced itself.
  const IteratorShim = function Iterator() {
    throw new TypeError('Iterator is abstract')
  }
  IteratorShim.prototype = iteratorPrototype
  globalThis.Iterator = IteratorShim
}

/**
 * `Promise.withResolvers` — Safari **17.4**, and our declared floor is iOS 16.
 *
 * ⭐ FOUND BY THE RAIL, NOT BY THE DEVICE. The iPhone this was debugged on runs iOS 17.5, which
 * HAS `Promise.withResolvers`, so it never threw there — `iteratorGlobalFloor.test.js` reading the
 * built chunk against the declared floor is the only reason we know `pdfjs-dist` also uses it. On
 * iOS 16.0–17.3 the PDF viewer would have died the same way the Notebook route did, and the next
 * real-device session would have had to be on an older phone to see it.
 *
 * The semantics are three lines and unambiguous (tc39/proposal-promise-with-resolvers): hand back
 * the promise together with the settle functions the executor is given.
 */
if (typeof Promise.withResolvers !== 'function') {
  Promise.withResolvers = function withResolvers() {
    let resolve
    let reject
    const promise = new this((res, rej) => { resolve = res; reject = rej })
    return { promise, resolve, reject }
  }
}
