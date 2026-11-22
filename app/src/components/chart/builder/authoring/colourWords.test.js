// app/src/components/chart/builder/authoring/colourWords.test.js
//
// One file names colours for both halves of plain-English authoring: the value the
// assistant is told to write for a word, and the word the read-back shows for a value.
// Measured 2026-11-14 without it: a requested green came back teal.

import { describe, it, expect } from 'vitest'
import COLOUR_WORDS from './colourWords.json'
import { colourWords } from './readback'
import { LINE_COLORS } from './applyPatch'

describe('the colours a new line is given', () => {
  it('are each read back by a name, never as a hex code (it read "#4ade80 line" beside "UCT gold line")', () => {
    const words = LINE_COLORS.map(colourWords)
    expect(words).toEqual(['UCT gold', 'green', 'pink', 'blue', 'orange'])
    for (const w of words) expect(w).not.toMatch(/#/)
    expect(new Set(words).size).toBe(words.length)                  // a member can tell the lines apart by name
    // CONTROL: a value nobody named is still shown exactly as stored, never guessed at
    expect(colourWords('#123456')).toBe('#123456')
  })
})

describe('colourWords.json', () => {
  it('every word a member can say is written with a value the read-back names that same word', () => {
    const entries = Object.entries(COLOUR_WORDS.words)
    expect(entries.length).toBeGreaterThan(8)
    for (const [word, value] of entries) {
      expect(value, word).toMatch(/^#[0-9A-F]{6}$/)
      expect(colourWords(value), `${word} -> ${value}`).toBe(word)
    }
  })

  it('the measured defect: green is its own value, and the old answer still reads as teal', () => {
    expect(COLOUR_WORDS.words.green).not.toBe('#26A69A')
    expect(colourWords(COLOUR_WORDS.words.green)).toBe('green')
    expect(colourWords('#26A69A')).toBe('teal')
  })

  it('the read-back still names every value it named before the map moved here', () => {
    // A sample across the old literal table: exact values, lower case, and 8-digit opaque.
    expect(colourWords('#F23645')).toBe('red')
    expect(colourWords('#ffd700')).toBe('gold')
    expect(colourWords('#2962FFFF')).toBe('blue')
    expect(colourWords('#C9A84C')).toBe('UCT gold')
    expect(Object.keys(COLOUR_WORDS.names).length).toBe(48)
  })

  it('a value nobody named is shown as itself, never as a nearest guess', () => {
    expect(colourWords('#123456')).toBe('#123456')
    expect(colourWords('#08998080')).toBe('#08998080')     // not fully opaque: not the named colour
  })
})
