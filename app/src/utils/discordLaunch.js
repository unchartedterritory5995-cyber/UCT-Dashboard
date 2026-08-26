// Discord opens an Activity at the ROOT of the app's URL mapping - never at a
// path - and appends its own parameters: instance_id, channel_id, guild_id,
// frame_id, platform. Recognising that launch is how the SPA knows to render
// the Activity page instead of whatever "/" normally is (pre-launch: the
// Coming Soon holding page, which never calls the Embedded App SDK's ready()
// and got the first launch on 2026-08-25 killed after a white frame).
//
// Deliberately a leaf module: App.jsx reads it at boot and DiscordActivity.jsx
// is lazy - importing this from both must not drag ChartPane into the shell.

export function launchContext(search) {
  const sp = new URLSearchParams(search || '')
  return {
    inDiscord: sp.has('frame_id'),
    channelId: sp.get('channel_id') || '',
    guildId: sp.get('guild_id') || '',
    instanceId: sp.get('instance_id') || '',
  }
}

/** True only for Discord's own Activity launch (frame + instance both present). */
export function isDiscordLaunch(search) {
  const sp = new URLSearchParams(search || '')
  return sp.has('frame_id') && sp.has('instance_id')
}
