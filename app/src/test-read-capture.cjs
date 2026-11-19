'use strict'
// ─── READ CAPTURE: which files does each test FILE read? (CI instrument, inert unless asked) ──────────────
//
// WHY (2026-11-17). Some engine tests read files OUTSIDE app/src/components/chart/engine/ (memberPaneGate
// walks the import graph from src/main.jsx; suiteCoverage lists the test folders under components/chart).
// They ran only in pine heavy, which triggers on engine paths, so #1662 and #1670 merged green while
// breaking them. tools/ci_whole_app_rails.py turns what this records into the list of "whole-app" rails
// and fails when a rail that reads outside pine heavy's trigger paths is missing from
// tools/whole_app_engine_rails.txt (the list the `whole-app engine rails` workflow runs).
//
// HOW. Active ONLY when UCT_READ_CAPTURE_DIR is set (pine heavy's legs set it; vite.config.js adds
// src/test-read-capture.js to setupFiles only then). It wraps the node:fs read doors (readFileSync,
// readdirSync, existsSync, statSync, lstatSync, accessSync, opendirSync, createReadStream, readFile,
// readdir, stat and their fs.promises twins) once per process, re-syncs the ESM named exports
// (`import { readFileSync } from 'node:fs'` sees the wrapper), and records every path a call names
// against the test file running now. A node child process the test spawns inherits the capture through
// NODE_OPTIONS (--require this file) and UCT_READ_CAPTURE_TEST, so a rail that runs a tool is charged with
// what the tool reads.
//
// ⛔ WRITTEN AS IT HAPPENS, NEVER AT THE END. Each (process, test file) gets one JSON-lines file in
// UCT_READ_CAPTURE_DIR: a header line {schema, file, kind, pid}, then one JSON string per NEW path, written
// with writeSync the moment it is first seen. Measured 2026-11-17: an isolated fork whose every test is
// skipped never runs afterAll and is killed rather than exited, so a record written "at the end" was
// missing for 28 of 30 skipped files. Here the header lands when the file begins, whatever happens next.
//
// ⛔ It RECORDS, it never changes a result: every wrapper calls the original with the original arguments
// and returns or throws exactly what the original did. A path the recorder cannot read is skipped, and a
// record it cannot write leaves `--check` to report that file as uncaptured.
// Rails: tests/test_ci_whole_app_rails.py (executes this under node, and the classifier, both ways).
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { fileURLToPath } = require('node:url')

const KEY = Symbol.for('uct.readCapture')
// the recorder's own fs calls go through the ORIGINAL doors, so they are never charged to a test
const ORIG = {
  statSync: fs.statSync, mkdirSync: fs.mkdirSync, openSync: fs.openSync, writeSync: fs.writeSync,
  closeSync: fs.closeSync,
}
const SCHEMA = 'uct.read-capture/v1'

function toPath(p) {
  try {
    if (typeof p === 'string') return path.resolve(p)
    if (p instanceof URL) return p.protocol === 'file:' ? fileURLToPath(p) : null
    if (Buffer.isBuffer(p)) return path.resolve(p.toString('utf8'))
  } catch { /* an unreadable argument is the original's business, not the recorder's */ }
  return null
}

function state() {
  if (!globalThis[KEY]) {
    globalThis[KEY] = { installed: false, current: null, seen: null, fd: null, dir: null, kind: 'worker' }
  }
  return globalThis[KEY]
}

function writeLine(s, value) {
  if (s.fd === null) return
  try { ORIG.writeSync(s.fd, JSON.stringify(value) + '\n') } catch { /* see the header: uncaptured, not wrong */ }
}

function note(p) {
  const s = state()
  if (!s.current) return
  const abs = toPath(p)
  if (!abs || s.seen.has(abs)) return
  s.seen.add(abs)
  writeLine(s, abs)
}

/** Start the record of `file` in this process (closing the previous one). */
function open(file) {
  const s = state()
  close()
  s.current = file
  s.seen = new Set()
  try {
    ORIG.mkdirSync(s.dir, { recursive: true })
    const id = crypto.createHash('sha1').update(`${file}\0${s.kind}\0${process.pid}\0${Date.now()}\0${Math.random()}`)
      .digest('hex').slice(0, 16)
    s.fd = ORIG.openSync(path.join(s.dir, `${s.kind}-${id}.jsonl`), 'w')
    writeLine(s, { schema: SCHEMA, file, kind: s.kind, pid: process.pid, cwd: process.cwd() })
  } catch { s.fd = null }
}

function close() {
  const s = state()
  if (s.fd !== null) { try { ORIG.closeSync(s.fd) } catch { /* already gone */ } }
  s.fd = null
  s.current = null
  s.seen = null
}

const FS_DOORS = ['readFileSync', 'readdirSync', 'existsSync', 'statSync', 'lstatSync', 'accessSync',
  'opendirSync', 'createReadStream', 'readFile', 'readdir', 'stat', 'lstat', 'access', 'opendir', 'exists']
const PROMISE_DOORS = ['readFile', 'readdir', 'stat', 'lstat', 'access', 'opendir']

function copyProps(from, to) {
  // keep util.promisify(fs.exists / fs.readFile) and friends behaving as before
  for (const k of Reflect.ownKeys(from)) {
    if (k === 'length' || k === 'name' || k === 'prototype') continue
    try { Object.defineProperty(to, k, Object.getOwnPropertyDescriptor(from, k)) } catch { /* non-configurable */ }
  }
  to[KEY] = true
}

function wrap(obj, name) {
  const orig = obj[name]
  if (typeof orig !== 'function' || orig[KEY]) return
  const wrapped = function (p, ...rest) {
    note(p)
    return orig.call(this, p, ...rest)
  }
  copyProps(orig, wrapped)
  obj[name] = wrapped
}

const NODE_OPTION = `--require=${__filename}`

function quoteOpt(o) { return /\s/.test(o) ? `"${o.replace(/"/g, '\\"')}"` : o }

function childEnv(env) {
  const s = state()
  const base = env || process.env
  const opts = base.NODE_OPTIONS || ''
  return {
    ...base,
    UCT_READ_CAPTURE_DIR: s.dir,
    UCT_READ_CAPTURE_TEST: s.current || '',
    NODE_OPTIONS: opts.includes(__filename) ? opts : `${opts} ${quoteOpt(NODE_OPTION)}`.trim(),
  }
}

function wrapChildProcess() {
  const cp = require('node:child_process')
  // the spawned program's own file (a node script, a python file) is a read too
  const noteArgs = (file, args) => {
    for (const a of [file, ...(Array.isArray(args) ? args : [])]) {
      if (typeof a !== 'string' || a.startsWith('-') || a.length > 4096) continue
      const abs = toPath(a)
      try { if (abs && ORIG.statSync(abs).isFile()) note(abs) } catch { /* not a path */ }
    }
  }
  const withEnv = (opts) => {
    if (!state().current) return opts
    if (opts && typeof opts === 'object' && !Array.isArray(opts)) return { ...opts, env: childEnv(opts.env) }
    return { env: childEnv(null) }
  }
  for (const name of ['spawn', 'spawnSync', 'execFile', 'execFileSync', 'fork']) {
    const orig = cp[name]
    if (typeof orig !== 'function' || orig[KEY]) continue
    const wrapped = function (file, args, opts, ...rest) {
      if (Array.isArray(args)) {
        noteArgs(file, args)
        if (typeof opts === 'function') return orig.call(this, file, args, withEnv(undefined), opts, ...rest)
        return orig.call(this, file, args, withEnv(opts), ...rest)
      }
      noteArgs(file, [])
      if (typeof args === 'function') return orig.call(this, file, withEnv(undefined), args, opts, ...rest)
      return orig.call(this, file, withEnv(args), opts, ...rest)
    }
    copyProps(orig, wrapped)
    cp[name] = wrapped
  }
  for (const name of ['exec', 'execSync']) {
    const orig = cp[name]
    if (typeof orig !== 'function' || orig[KEY]) continue
    const wrapped = function (command, opts, ...rest) {
      if (typeof opts === 'function') return orig.call(this, command, withEnv(undefined), opts, ...rest)
      return orig.call(this, command, withEnv(opts), ...rest)
    }
    copyProps(orig, wrapped)
    cp[name] = wrapped
  }
}

function install(dir, kind) {
  const s = state()
  s.dir = path.resolve(dir)   // absolute: a child process may run in another directory
  s.kind = kind
  if (s.installed) return s
  for (const name of FS_DOORS) wrap(fs, name)
  for (const name of PROMISE_DOORS) wrap(fs.promises, name)
  wrapChildProcess()
  require('node:module').syncBuiltinESMExports()
  process.on('exit', close)
  s.installed = true
  return s
}

/** The vitest side: called by src/test-read-capture.js once per test file. */
function beginTestFile(dir, file) {
  install(dir, 'worker')
  open(file)
}

function endTestFile(file) {
  if (state().current === file) close()
}

module.exports = { beginTestFile, endTestFile, SCHEMA, __state: state }

// ── a child process started by a test (NODE_OPTIONS=--require this file) ──
if (require.main !== module && process.env.UCT_READ_CAPTURE_DIR && process.env.UCT_READ_CAPTURE_TEST
    && !state().installed && !process.env.VITEST_WORKER_ID && !process.env.VITEST_POOL_ID) {
  install(process.env.UCT_READ_CAPTURE_DIR, 'child')
  open(process.env.UCT_READ_CAPTURE_TEST)
}
