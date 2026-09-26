// Wave 5 fix round 1 (S7 + N2) — the Notebook's ONE answer to "is this a Mac?",
// and the chords that depend on it.
import { describe, it, expect, afterEach } from 'vitest'
import { altKeyLabel, chordText, homeEndKeys, isMacPlatform, isReplaceChord, modKeyLabel, replaceChordKeys } from './platform'

const setPlatform = (value) => Object.defineProperty(navigator, 'platform', { value, configurable: true })
afterEach(() => { delete navigator.platform })

describe('isMacPlatform', () => {
  it.each([
    ['MacIntel', true], ['iPhone', true], ['iPad', true], ['iPod touch', true],
    ['Win32', false], ['Linux x86_64', false], ['', false],
  ])('%j -> %s', (platform, mac) => {
    setPlatform(platform)
    expect(isMacPlatform()).toBe(mac)
  })
})

describe('labels a member reads', () => {
  it('on a Mac: Cmd, Option, and Cmd+Option+F for replace', () => {
    setPlatform('MacIntel')
    expect([modKeyLabel(), altKeyLabel()]).toEqual(['Cmd', 'Option'])
    expect(replaceChordKeys()).toEqual(['Cmd', 'Option', 'F'])
    expect(chordText(replaceChordKeys())).toBe('Cmd+Option+F')
  })

  it('elsewhere: Ctrl, Alt, and Ctrl+H for replace', () => {
    setPlatform('Win32')
    expect([modKeyLabel(), altKeyLabel()]).toEqual(['Ctrl', 'Alt'])
    expect(chordText(replaceChordKeys())).toBe('Ctrl+H')
  })
})

describe('homeEndKeys (wave 8, lane 8A): Home and End as the member presses them', () => {
  it('on a Mac, which has neither key: Fn with the left and right arrows', () => {
    setPlatform('MacIntel')
    expect(homeEndKeys()).toEqual({ home: ['Fn', '←'], end: ['Fn', '→'] })
  })

  it('elsewhere: the keys themselves', () => {
    setPlatform('Win32')
    expect(homeEndKeys()).toEqual({ home: ['Home'], end: ['End'] })
  })
})

describe('isReplaceChord answers for the platform it runs on', () => {
  it('on a Mac, Cmd+Option+F is the chord -- and Ctrl+H (delete-backward there) is NOT', () => {
    setPlatform('MacIntel')
    expect(isReplaceChord({ metaKey: true, altKey: true, code: 'KeyF', key: 'ƒ' })).toBe(true)
    expect(isReplaceChord({ ctrlKey: true, key: 'h', code: 'KeyH' })).toBe(false)
    expect(isReplaceChord({ metaKey: true, key: 'h', code: 'KeyH' })).toBe(false)
  })

  it('elsewhere, Ctrl+H is the chord; Ctrl+Alt+H and Cmd+Option+F are not', () => {
    setPlatform('Win32')
    expect(isReplaceChord({ ctrlKey: true, key: 'h', code: 'KeyH' })).toBe(true)
    expect(isReplaceChord({ ctrlKey: true, key: 'H', code: 'KeyH' })).toBe(true)
    expect(isReplaceChord({ ctrlKey: true, altKey: true, key: 'h', code: 'KeyH' })).toBe(false)
    expect(isReplaceChord({ metaKey: true, altKey: true, code: 'KeyF', key: 'f' })).toBe(false)
  })
})

// N2 (wave-5 review): Mac detection was written in two files. It lives in ONE
// now, and this sweep keeps it that way for every Notebook source file.
describe('one Mac test in the Notebook', () => {
  it('no Notebook source file but lib/platform.js reads navigator.platform', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const root = path.resolve(process.cwd(), 'src/pages/journal-2-0')
    const files = []
    const walk = (dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name)
        if (e.isDirectory()) walk(p)
        else if (/\.(js|jsx)$/.test(e.name) && !/\.test\.(js|jsx)$/.test(e.name)) files.push(p)
      }
    }
    walk(root)
    expect(files.length).toBeGreaterThan(100) // non-vacuity: the sweep saw the tree
    const readers = files
      .filter((f) => fs.readFileSync(f, 'utf8').includes('navigator.platform'))
      .map((f) => path.relative(root, f).split(path.sep).join('/'))
    expect(readers).toEqual(['lib/platform.js'])
  })
})
