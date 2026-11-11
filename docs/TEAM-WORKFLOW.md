# Team workflow: UCT-Dashboard is a PUBLIC repo

For: Patrick, Manrav (Ravi), Bracco. Public since 2026-11-08. Not open source: see `LICENSE`.

## What changed, and what did not

- **Anyone on the internet can READ this repo**: code, full history, PRs, commit messages, Actions logs.
- **Only our account can WRITE.** Nobody outside can push, merge, deploy or touch the site through the
  repo. Deploys still go master -> `master deploy gate` -> `production` -> Railway.
- **Why:** private repos bill every Actions minute and get smaller runners. Public = free CI on bigger
  runners while we build with 0 users.
- **Only this repo is public.** tsdr-ledger, uct-brain, uct-agent-training-data, uct-intelligence(-bot),
  morning-wire, uct-clips, uct-growth, uct-sunday-scan, tx-recap, uct-extras, uct-large-files,
  UCT-Dashboard-evidence and uct-claude-memory stay PRIVATE.

## Never commit (it is public within minutes, and deleting it later does not help)

- API keys, tokens, passwords, `.env` files. **Keys live in Railway variables only.**
- **Raw prod logs or copied pod output.** Every real finding in the pre-flip scan came from ONE pasted
  prod log (a Finviz token inside a URL and a member's email). Redact emails and `?auth=` / `token=` /
  `apiKey=` first, or keep the log out of the repo.
- Member data of any kind: emails, names, alerts, journal entries, broker data, database files.
- Anything from the PRIVATE repos (TSDR ledger, brain DB, agent training data, Discord exports,
  unpublished Substack drafts). Wisdom rule stands: PUBLISHED content only.
- Licensed vendor data dumps (Massive/Polygon, Finviz, UW, FMP exports). Small synthetic fixtures are fine.
- Keys or member info pasted into PR descriptions, comments or commit messages.

## How each of us works

- **Ravi (GitHub web UI, "Add files via upload"):** this path skips local git hooks. GitHub push
  protection is the safety net. Before uploading, open the file and check for keys or emails. If GitHub
  blocks the commit for a secret, **do not click "allow"**: take the key out and put it in Railway.
- **Bracco / Patrick / Claude sessions:** work on a branch, run the focused tests locally, push once per
  finished unit. Every master push runs the full deploy gate and a deploy.

## The guards

1. **GitHub push protection**: rejects pushes containing known key formats (Stripe, OpenAI, Anthropic,
   AWS, Discord, ...), including web-UI commits.
2. **`secret scan` workflow** (`.github/workflows/secret-scan.yml`): gitleaks over each push's / PR's new
   commits, for what push protection does not know (generic tokens, keys inside URLs). Advisory: a red
   does not block deploys, because a key on a public commit is already exposed.
3. **Outside contributors' PRs** need our approval before their workflows run, and never see secrets.

## If a secret lands in the repo

1. **ROTATE IT FIRST**: new key in the vendor dashboard -> Railway variable -> redeploy. Assume bots
   copied it within minutes; deleting the commit does not un-leak it.
2. Then remove it from the current code. History cleanup is optional once the key is dead.
3. Tell Patrick in Discord which key and when.

## Reversibility

Going private again is one setting, but anything already public may have been copied. If cost or speed
ever matters while private, the alternatives are a hosted runner service (one-line `runs-on:` change)
or a rented CI server.
