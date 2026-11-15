import base from 'file:///C:/Users/Patrick/uct-worktrees/train-1/app/vite.config.js'
const S = 'C:/Users/Patrick/AppData/Local/Temp/claude/6c61ec7db4c79b74/269630a0-d11b-41f6-8959-ec8ae95a9506/scratchpad/TRAIN1'
const b = typeof base === 'function' ? base({ mode: 'test', command: 'serve' }) : base
export default {
  ...b,
  root: 'C:/Users/Patrick/uct-worktrees/train-1/app',
  server: { ...(b.server || {}), fs: { allow: ['C:/Users/Patrick'] } },
  test: { ...b.test, include: [S + '/census.train.test.js'], dir: S, testTimeout: 7200000, hookTimeout: 600000 },
}
