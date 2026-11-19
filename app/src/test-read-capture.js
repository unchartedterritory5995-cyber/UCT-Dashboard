// The vitest half of src/test-read-capture.cjs (read that file's header). vite.config.js adds this file to
// `setupFiles` ONLY when UCT_READ_CAPTURE_DIR is set, so an ordinary run never loads it.
// The recorder is required NATIVELY (createRequire), never through vite: one instance per process, so the
// fs doors are wrapped once however many test files the process runs.
import { createRequire } from 'node:module'
import { afterAll, expect } from 'vitest'

const capture = createRequire(import.meta.url)('./test-read-capture.cjs')
const dir = process.env.UCT_READ_CAPTURE_DIR
const file = expect.getState().testPath

if (dir && file) {
  capture.beginTestFile(dir, file)
  afterAll(() => capture.endTestFile(file))
}
