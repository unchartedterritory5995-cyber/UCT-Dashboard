// app/src/components/DesktopBridgeSync.jsx
//
// Null-rendering leaf, mounted at the app root beside <LogoPrewarm /> and only inside the desktop
// app (App.jsx checks isDesktopApp, so a browser never fetches this chunk). The desktop shell's
// messages are handled here rather than in Layout: this file holds its own effects and reads no
// shared context, because a shared render loop froze navigation app-wide for 4.5 hours in September.
export default function DesktopBridgeSync() {
  return null
}
