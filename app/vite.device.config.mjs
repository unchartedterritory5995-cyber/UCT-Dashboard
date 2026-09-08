// Dev-server config for ON-DEVICE validation. Not used by any build.
//
// Three deviations from the app config, all learned on hardware or in this
// environment:
//
//  • host 127.0.0.1 + `allowedHosts` for bs-local.com — the BrowserStack Local
//    tunnel presents that Host header, and vite refuses an unknown one.
//
//  • NO `/api` proxy. Pointing it at the local sandbox is what put a login form
//    in front of the phone; the harness answers fetch in-page instead, which
//    removes any backend from the picture entirely.
//
//  • ⛔ NO `@vitejs/plugin-react`, and esbuild's own JSX transform instead.
//    `@babel/core` is absent from the node_modules this worktree shares with
//    `uct-dashboard-mobile-research`, so the React plugin cannot load — and that
//    tree is shared with other sessions, so repairing it from here would be
//    mutating somebody else's environment to run a harness. esbuild's automatic
//    runtime produces the same output for our purposes; the only thing given up
//    is Fast Refresh, which a device harness does not use.
export default {
  server: {
    host: '127.0.0.1',
    port: 8093,
    strictPort: true,
    allowedHosts: ['bs-local.com', '.bs-local.com', 'localhost', '127.0.0.1'],
    proxy: {},
  },
  esbuild: { jsx: 'automatic' },
}
