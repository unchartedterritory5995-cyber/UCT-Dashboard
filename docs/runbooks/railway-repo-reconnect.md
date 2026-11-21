# Railway: reconnecting a service to the repo after the org move

**Read this before the next deploy of `flow-worker`, `breadth-v2-runner`, `econ-ingest`,
`fundamentals-v5-runner` or `trade-exchange-news-receiver`.**

## What happened (2026-11-21)

The repo moved from `unchartedterritory5995-cyber/UCT-Dashboard` to
`northstar-quarry/UCT-Dashboard`. GitHub redirects the old address. Railway does not follow the
move: every service kept running its current deployment, but its link to the repo went dead.
A dead link reads, in the dashboard under Settings → Source: the OLD repo name, **"Auto deploy
unavailable"** and **"Could not load branches"**.

| Reconnected on 2026-11-21 | Still on the dead link (reconnect at their next planned deploy) |
|---|---|
| `bars-api`, `web-front`, `stream-edge`, `stream-ingest`, `web`, `terminal-next-monitor`, `chart-renderer`, `worker` | `flow-worker`, `breadth-v2-runner`, `econ-ingest`, `fundamentals-v5-runner`, `trade-exchange-news-receiver` |

`tx-recap` has no repo and is not affected. To read the current state without the dashboard:

```sh
railway status --json   # environments[].serviceInstances[].source.repo, per service
```

## The reconnect IS a deploy

Applying the repo change deploys the HEAD of the service's connected branch at once. The apply
menu offers only Deploy or Discard; there is no apply-without-deploy (rehearsed 2026-11-18, seen
8 of 8 times on 2026-11-21). So treat a reconnect exactly like a deploy of that service: its
deploy window, its pre-checks, its post-checks, from its own runbook
(`worker-deploys.md`, `flow-worker-deploys-and-flow-db.md`, `trade-exchange-news-deploy.md`).

## Steps

1. Before: note the service's Settings (branch, auto deploy, watch paths, config file, start
   command) and the commit it runs. Check master/branch HEAD is the commit you mean to ship.
2. Settings → Source → the **pencil (Edit)** next to Source Repo. **Not Disconnect**: Edit keeps
   the settings.
3. Type `northstar-quarry/UCT-Dashboard` in full and press Enter. Picking it from the list did
   not stick in the rehearsal; typing it did.
4. A bar appears, "Apply 1 change". Open **Details**. It must list exactly ONE setting, **Repo**.
   ⛔ Railway can stage a second change by itself, **Branch → master** (seen on services connected
   to `production`). If a Branch row is there, remove it with its `x` before deploying, or the
   service moves to master. This matters most for `econ-ingest` (`econ/service`),
   `fundamentals-v5-runner` (`fundamentals/v5-runner`) and `trade-exchange-news-receiver`
   (`production`).
5. **Deploy Changes.** The button can stay grey for a few seconds.
6. ⛔ **Straight away, read Settings → Source → the auto deploy line.** On `worker` the reconnect
   turned auto deploy **ON** ("Auto deploys when pushed to GitHub") although it had been off since
   2026-11-13; before the reconnect the line only read "unavailable". It was switched off again
   about 65 seconds later (Disable), and no push landed in between. For a service whose auto
   deploy must be off (`worker`, `flow-worker`): click **Disable**, reload the page, and confirm it
   reads **"Auto deploy is disabled"**. A master push while it is on restarts the service.
7. After: the new deployment shows the commit you meant and the new repo name; the rest of
   Settings equals what you noted in step 1; then the service's own post-checks.

Rollback: Railway → the service → Deployments → Redeploy on the previous deployment.

## Other facts worth knowing

- The Railway GitHub App is installed on the org with "Only select repositories" =
  `UCT-Dashboard`. Railway did not list the repo until it was selected there.
- Never create a repo named `UCT-Dashboard` on the old personal account: that ends GitHub's
  redirect of the old address for everyone (old clones, old links, anything not yet updated).
