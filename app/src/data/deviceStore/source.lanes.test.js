// @vitest-environment node
// The BarStore's device source hands a read's lane on to the client (client.js, TWO LANES): `urgent` when the
// caller said so, nothing at all otherwise (a warm's read is the client's default, the background lane).
import { describe, it, expect, vi } from 'vitest'
import { createDeviceSource } from './source'

const COLS = { t: new Float64Array([1, 2]), o: new Float64Array([1, 1]), h: new Float64Array([1, 1]), l: new Float64Array([1, 1]),
  c: new Float64Array([1, 1]), v: new Float64Array([1, 1]), build: '20261121T2359Z' }

function sourceOver() {
  const client = { peekBars: vi.fn(() => null), getBars: vi.fn(async () => COLS) }
  return { client, src: createDeviceSource({ load: async () => client, current: () => client }) }
}

describe('the device source and a read\'s lane', () => {
  it('an urgent read reaches the client as urgent', async () => {
    const { client, src } = sourceOver()
    const got = await src.read('AAA', 'D', { urgent: true })
    expect(got.rows).toHaveLength(2)
    expect(client.getBars.mock.calls).toEqual([['AAA', 'D', { urgent: true }]])
  })

  it('a read with no lane, or one that is not exactly `urgent: true`, reaches the client with no lane', async () => {
    const { client, src } = sourceOver()
    await src.read('AAA', 'D')
    await src.read('BBB', '30', {})
    await src.read('CCC', 'D', { urgent: 1 })
    expect(client.getBars.mock.calls).toEqual([['AAA', 'D'], ['BBB', '30'], ['CCC', 'D']])
  })

  it('a key the seed does not hold asks nothing, urgent or not', async () => {
    const { client, src } = sourceOver()
    expect(await src.read('AAA', '60e', { urgent: true })).toBeNull()
    expect(client.getBars).not.toHaveBeenCalled()
  })
})
