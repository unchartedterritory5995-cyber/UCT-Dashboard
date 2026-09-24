// Wave 5 fix round 1 (S7 + N2) — the Notebook's ONE answer to "is this a Mac?",
// and the chords that depend on it.
import { describe, it, expect, afterEach } from 'vitest'
import { altKeyLabel, chordText, isMacPlatform, isReplaceChord, modKeyLabel, replaceChordKeys } from './platform'

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
