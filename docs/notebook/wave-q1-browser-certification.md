# Wave Q1 — browser certification (§32)

> **STATUS: OPEN. Q1 CANNOT CLOSE.**
> Safari/iOS is not measured. §32 makes this a HARD certification / merge gate
> and the directive is explicit: *"Safari/iOS missing: Q1 cannot close."*
>
> The Wave Q1 offline layer is therefore merged **DARK**.
> `OFFLINE_DEFAULT_ON` in `app/src/pages/journal-2-0/lib/offline/offlineFlag.js`
> is `false`, so on production today the Notebook opens no database, writes no
> durable copy, queues nothing and elects no leader. That is not an assumption —
> it is measured below, on the deployed build.
>
> Per-browser opt-in for certification:
> `localStorage.setItem('uct.j2.offline.enabled', '1')` — the
> `uct.barsPush.enabled` idiom, deliberately not a `VITE_` build variable, so
> certification runs against the real production build rather than a sandbox.

Measured 2026-09-09, **Chrome 152.0.0.0 / Windows 11**, against
`https://uctintelligence.com` (production, commit `edb1b4022`), signed in as the
owner account `7a6d0299…`.

---

## The matrix §32 asks for

| Environment | IDB | persistence | quota / headroom | Web Locks | multi-tab versionchange | reload durability | tab-close durability | degraded / private |
|---|---|---|---|---|---|---|---|---|
| **Chrome desktop** 152 / Win 11 | ✅ available | ✅ `persisted() === true` (already granted on this origin) | ✅ quota 10.54 GB, usage 549 MB → **9.99 GB headroom** | ✅ available **and granted** (exclusive, cross-tab) | ✅ upgrades in **1 ms** with the handler; **blocked past 3,000 ms** without it | ✅ working copy + outbox survive a reload | ✅ survive a real tab close | ✅ degrades truthfully with no IDB (rail, not a browser run) |
| **Safari / iOS** | ⛔ NOT MEASURED | ⛔ | ⛔ | ⛔ | ⛔ | ⛔ | ⛔ | ⛔ |
| **Firefox desktop** | ⛔ NOT MEASURED | ⛔ | ⛔ | ⛔ | ⛔ | ⛔ | ⛔ | ⛔ |
| **Fresh profile** | ⛔ NOT MEASURED | ⛔ | ⛔ | ⛔ | ⛔ | ⛔ | ⛔ | ⛔ |
| **Private / incognito** | ⛔ NOT MEASURED | ⛔ | ⛔ | ⛔ | ⛔ | ⛔ | ⛔ | ⛔ |

⛔ **No Chrome-first rationalization.** A row is filled in by a run on that
browser or it stays ⛔. The two empty desktop rows are not "probably fine"; the
private/incognito and fresh-profile rows are unmeasured for a specific reason,
recorded below rather than glossed.

**Why fresh-profile and private are still empty:** both would mean either
clearing this origin's real storage in the owner's own browser — which would
destroy live preferences (chart settings, saved drawings, the bars-push
override, dismissed hints) for a test — or driving an incognito window, which
this automation cannot attach to. Neither is a reason to guess. They need a
throwaway Chrome profile.

---

## What was actually run

### 0 · Dark by default, on the deployed build

Flag unset, one keystroke into a new note:

| | at +450 ms | at +2,250 ms (after the server save) |
|---|---|---|
| IndexedDB `notes` | **0** | **0** |
| IndexedDB `outbox` | **0** | **0** |
| localStorage draft | present, with the typed title | cleared by the successful save |

⭐ That is the pre-Wave-Q1 Notebook exactly: synchronous draft, ~800 ms PUT,
draft retired on success. **Nothing is written to IndexedDB at all.** This is
also the build check — the previous build had no flag and would have written.

### 1 · The pipeline (flag on)

One keystroke, read at +400 ms:

- localStorage draft written, carrying its `sessionId`
- `notes`: `dirty: 1`, `generation: 1`, `baseUpdatedAt` = the note's real server revision
- `outbox`: one entry, same baseline, `permanent: false`

Then the ~800 ms PUT lands → the record goes clean and the outbox empties.

### 2 · Server unreachable (note PUTs rejected at `fetch`)

- `notes`: `dirty: 1`, `generation: 3`
- `outbox`: one entry holding the newest words
- header shows **"Reconnecting…"** *and* **"Saved on this device — not yet synced to UCT"**

⭐ Both sentences at once, which is the point: the device has it, UCT does not.

### 3 · Reload durability

After a full page reload with the server still unreachable:

- working copy survived (`dirty: 1`, generation 3), outbox entry survived
- the editor shows the **server's** last-saved title, and the newer local
  version is **offered** by the recovery banner — never auto-applied

### 4 · Reconnect — the Q1 flagship happy path (§31)

Closing the note hands it to the sweep. The leader drained it:

- `outbox` → empty, `notes.dirty` → 0, `conflicts` → 0
- the server now holds the offline text, at a new revision the durable copy
  adopted as its baseline

Full chain, end to end, in production: online base → unreachable server → edit →
crash buffer → debounced durable copy → durable outbox → reload → recover →
reconnect → CAS → synced, with no duplicate history.

### 5 · Reconnect — the conflict path (§31)

Set up deliberately: local work queued against revision `13:42:02`, then the
server advanced to `13:43:02` by a different writer ("EDITED ON ANOTHER DEVICE").
On reconnect:

- the stale compare-and-set was **rejected** — the server's version is
  byte-unchanged at `13:43:02`
- the local work was preserved as a real note, `… (conflicted copy)`, tagged
  **`sync-conflict`**
- the durable copy adopted the server's version, clean; outbox empty

⭐ **Both versions survived. Nothing was overwritten.**

### 6 · Multi-tab leadership

Second tab open on the same account, `navigator.locks.query()`:

- the sync lock `uct.nb.sync.<account>` is **held, exclusive** (tab 1 leads)
- the second tab **could not take it** → it is a follower
- `pending: 1` — the follower has exactly one queued request waiting for
  handover. It waits; it does not poll, and it does not race.

### 7 · Cross-tab `versionchange` — the measurement that justifies the design

Two probe databases held open at v1 in tab 1, a v2 upgrade requested from tab 2:

| probe | `blocked` fired | outcome |
|---|---|---|
| **with** `onversionchange → close()` (what `notebookDb` installs, from v1) | no | **upgraded in 1 ms** |
| **without** a handler (the `barsIDB` shape) | yes | **still blocked at 3,000 ms** |

⚰️ This is the cross-tab confirmation of the correction in `notebookDb.js`:
`barsIDB` froze `DB_VERSION` at 2 because "the v3 bump caused a deadlock", and
the lesson was written down as *version bumps are dangerous*. The deadlock is a
**missing handler**. Bumps are survivable — but only if every connection already
in the wild closes when asked, which is why the handler goes on from v1.
(Probe databases were created and deleted by this run; the notebook database was
never deleted.)

### 8 · Tab-close durability

Typed with the server unreachable, waited for the durable write, then closed the
tab outright. Read from the other tab: working copy (`dirty: 1`) and outbox entry
both intact, server untouched. Unblocking the leader then drained it to the
server and settled the record clean.

---

## Known behaviour worth stating

- **The open note is not the sweep's.** `useOutboxDrain` skips the note the
  editor currently has open — two writers on one note is the last-write-wins this
  wave forbids. A consequence, seen in step 3: after a reload with work still
  queued for the note you are looking at, that entry waits until you accept the
  recovery banner, edit again, or navigate away. It is never lost, and closing
  the note drains it (step 4). If this proves confusing in use, the fix is a
  one-shot drain of the editor's own note on mount — not removing the exclusion.
- **Settle lags the PUT slightly.** Sampled 4 s after the drain's request the
  record still read `dirty: 1`; the settling transaction had not committed. It
  was clean on the next read. Timing, not a defect.
- **`persisted() === true` on this origin** — a grant that was already there.
  ⛔ Correctness does not depend on it and nothing in the code requires it; it is
  recorded, never required.

---

## What has to happen before Q1 can close

1. **Safari / iOS** — the hard blocker. IDB availability, persistence behaviour,
   quota, Web Locks (a real risk: if Web Locks is missing, every Safari tab is
   READ-ONLY FOR SYNC by design and nothing drains there), multi-tab
   versionchange, reload and tab-close durability, private-mode behaviour.
2. **Firefox desktop** — same list.
3. **Fresh Chrome profile** and **private/incognito** — needs a throwaway profile.
4. Only then is flipping `OFFLINE_DEFAULT_ON` a decision anyone may make, and it
   is a measurement decision, not a cleanup task.
