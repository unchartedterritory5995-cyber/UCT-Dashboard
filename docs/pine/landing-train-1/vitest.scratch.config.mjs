import base from 'file:///C:/Users/Patrick/uct-worktrees/train-1/app/vite.config.js'
const S = 'C:/Users/Patrick/AppData/Local/Temp/claude/6c61ec7db4c79b74/07178e6c-7af0-41a1-b915-7a5db939d0d5/scratchpad/TRAIN1'
const b = typeof base === 'function' ? base({ mode: 'test', command: 'serve' }) : base
export default {
  ...b,
  root: 'C:/Users/Patrick/uct-worktrees/train-1/app',
  server: { ...(b.server || {}), fs: { allow: ['C:/Users/Patrick'] } },
  test: { ...b.test, include: [S + '/' + process.env.TRAIN_TEST], dir: S, testTimeout: 7200000, hookTimeout: 600000 },
}
