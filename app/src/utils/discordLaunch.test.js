import { describe, it, expect } from 'vitest'
import { isDiscordLaunch, launchContext } from './discordLaunch'

// Discord opens an Activity at the ROOT with its own params. The first launch
// on 2026-08-25 loaded the Coming Soon page instead and died after a white
// frame; this is the check App.jsx uses to serve the Activity at "/".

describe('discordLaunch', () => {
  it('recognises only a real Activity launch (frame + instance)', () => {
    expect(isDiscordLaunch('?instance_id=i-1&channel_id=555&guild_id=g&frame_id=f-1&platform=desktop')).toBe(true)
    expect(isDiscordLaunch('?frame_id=f-1')).toBe(false)
    expect(isDiscordLaunch('?instance_id=i-1')).toBe(false)
    expect(isDiscordLaunch('?utm_source=x')).toBe(false)
    expect(isDiscordLaunch('')).toBe(false)
  })

  it('exposes the ids the page needs', () => {
    expect(launchContext('?instance_id=i1&channel_id=c1&guild_id=g1&frame_id=f1')).toEqual(
      { inDiscord: true, channelId: 'c1', guildId: 'g1', instanceId: 'i1' })
  })
})
