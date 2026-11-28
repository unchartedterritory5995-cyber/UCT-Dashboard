// bars-edge-router (worker.js, origins rewritten to loopback) under workerd via Miniflare, for the replay.
import { createRequire } from "node:module";
// MINIFLARE_DIR: a node_modules holding miniflare 3 (e.g. an npx cache dir); never installed into the repo
if (!process.env.MINIFLARE_DIR) { console.error("set MINIFLARE_DIR to a node_modules dir holding miniflare 3"); process.exit(2); }
const require = createRequire(process.env.MINIFLARE_DIR + "/");
const { Miniflare } = require("miniflare");
const here = new URL(".", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const port = Number(process.argv[2] || 18180);
const mf = new Miniflare({
  modules: true,
  modulesRules: [{ type: "ESModule", include: ["**/*.js"] }],
  scriptPath: here + "entry.js",
  compatibilityDate: "2024-09-23",
  port, host: "127.0.0.1",
  r2Buckets: ["HISTORY", "SEED"],
  r2Persist: here + "r2",
});
await mf.ready;
console.log("edge ready on", port);
process.on("SIGTERM", async () => { await mf.dispose(); process.exit(0); });
