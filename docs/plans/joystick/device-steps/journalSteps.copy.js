// ⛔ A CHECKED-IN COPY, NOT THE RUNNER.
//
// The joystick device suite is OPERATOR TOOLING at C:\tools\hub-devicetests — deliberately not a
// repo dependency (it appears in no package.json and no requirements.txt). But a step definition
// that lives ONLY there is invisible to review, so the B3/B5 journal steps are mirrored here.
//
// ⚠️ THE RUNNER IS THE ONE AT C:\tools\hub-devicetests\tests\hubSuite.js. This copy is evidence
// of what was run, not a second authority on it — if they ever disagree, that file is right and
// this one is stale. Copied 2026-09-09 from the spliced hubSuite.js.


// ─────────────────────────────────────────────────────────────────────────────────────────────
// 3.4 JOURNAL — B3/B5 device steps (D1-D5). Added 2026-09-09.
//
// ⛔ WHAT THESE EXIST TO SEE. B3 changed journal.moveStop / journal.breakeven / journal.close from
// kind:'confirm' to kind:'run', because each already opens its own sheet and a `confirm` stacked
// HubConfirmSheet in FRONT of it — two sheets on one gesture. The unit rail
// (`app/src/hub/journalSheetStacking.test.jsx`) proves that through the real HubRoot in jsdom.
// What jsdom CANNOT answer is D4: whether a real touch surface honours `flickable:false` on
// journal.close. A gesture engine that behaves under a synthetic pointer can misfire on glass, and
// Close firing instead of fanning on a phone is the failure that matters.
//
// PRECONDITION: three seeded open positions (two real stops, one broker placeholder). Without a
// position every one of these actions is `requires:['position']` and renders DISABLED.
// ─────────────────────────────────────────────────────────────────────────────────────────────

const JOURNAL_ROUTE = '/journal/trades'

/** Everything D1-D3 need to judge a sheet, in ONE round trip. */
async function sheetProbe(driver) {
  return driver.executeScript(
    `const dialogs = Array.from(document.querySelectorAll('[role="dialog"]'));
     const stop = document.querySelector('[data-testid="hub-stop-primary"]');
     const hubConfirm = document.querySelector('[data-testid="hub-confirm-primary"]');
     const labels = Array.from(document.querySelectorAll('[role="dialog"] label'))
       .map(l => (l.textContent || '').trim().toLowerCase());
     const controls = document.querySelectorAll('[role="dialog"] input, [role="dialog"] select, [role="dialog"] textarea');
     return {
       dialogCount: dialogs.length,
       stopPrimaryText: stop ? (stop.textContent || '').trim() : null,
       stopPrimaryDisabled: stop ? !!stop.disabled : null,
       hubConfirmPresent: !!hubConfirm,
       dialogLabels: labels,
       dialogControls: controls.length,
     };`
  )
}

/** Put the cursor on a position, then open the fan. Returns the rendered bubble offsets. */
async function journalReady(driver) {
  await goto(driver, JOURNAL_ROUTE)
  const rows = await driver.executeScript(
    `return document.querySelectorAll('[data-hub-pos]').length;`
  )
  if (!rows) throw new Error('no [data-hub-pos] rows — the sandbox has no seeded positions')
  const c = await padCentre(driver)
  // One tap lands the cursor on a row (the fan's requires:['position'] actions need it).
  await driver.actions({ async: false })
    .move({ origin: Origin.VIEWPORT, x: c.x, y: c.y }).press().release().perform()
  await sleep(700)
  await openFanSticky(driver)
  return { offsets: await fanOffsets(driver), rows }
}

/** D1/D2 — a deliberate selection opens EXACTLY ONE sheet, and it is the section's own. */
async function stepJournalOneSheet(driver, actionId) {
  const { offsets } = await journalReady(driver)
  await clearLastAction(driver)
  await fireAction(driver, actionId, offsets)
  await sleep(700)
  const p = await sheetProbe(driver)

  const expectLabel = actionId === 'journal.moveStop' || actionId === 'journal.breakeven'
  const labelOk = !expectLabel || (p.stopPrimaryText && /^Set stop \d+\.\d{2}$/.test(p.stopPrimaryText))
  const pass = p.dialogCount === 1 && !p.hubConfirmPresent && labelOk

  return {
    name: `${actionId} opens EXACTLY ONE sheet, the section's own`,
    pass,
    detail: `dialogs=${p.dialogCount} hubConfirmSheet=${p.hubConfirmPresent} `
          + `primary=${JSON.stringify(p.stopPrimaryText)} disabled=${p.stopPrimaryDisabled}`,
  }
}

/** D3 — Close opens ClosePositionModal DIRECTLY, with its own fields, and no hub sheet in front. */
async function stepJournalClose(driver) {
  const { offsets } = await journalReady(driver)
  await clearLastAction(driver)
  await fireAction(driver, 'journal.close', offsets)
  await sleep(900)
  const p = await sheetProbe(driver)
  const wanted = ['shares', 'exit price', 'exit date']
  const found = wanted.filter(w => p.dialogLabels.some(l => l.includes(w)))
  const pass = p.dialogCount === 1 && !p.hubConfirmPresent && found.length === wanted.length

  return {
    name: 'journal.close opens ClosePositionModal directly, no hub sheet in front',
    pass,
    detail: `dialogs=${p.dialogCount} hubConfirmSheet=${p.hubConfirmPresent} `
          + `labelsFound=[${found.join('|')}] controls=${p.dialogControls}`,
  }
}

/**
 * D4 — THE ONE THAT MATTERS. A flick at Close must OPEN THE FAN and fire nothing.
 *
 * `journal.close` is `flickable:false` (registry.js), and `useJoystick.js:396` gates on
 * `flickable !== false` with NO kind check — so B3 moving it to kind:'run' did not touch this
 * guard. That is the claim, and this is the only instrument that can test it on glass.
 */
async function stepJournalCloseFlickGuard(driver) {
  const first = await journalReady(driver)
  const off = first.offsets && first.offsets['journal.close']
  if (!off) return { name: 'D4 journal.close flick guard', pass: false, detail: 'no rendered Close bubble' }

  let fired = 0
  let modals = 0
  let fanned = 0
  for (let i = 0; i < 5; i++) {
    await journalReady(driver)
    await dismissFan(driver)
    await clearLastAction(driver)
    const c = await padCentre(driver)
    await driver.actions({ async: false })
      .move({ origin: Origin.VIEWPORT, x: c.x, y: c.y })
      .press()
      .move({ origin: Origin.VIEWPORT, x: Math.round(c.x + off.dx / 2), y: Math.round(c.y + off.dy / 2), duration: 30 })
      .move({ origin: Origin.VIEWPORT, x: Math.round(c.x + off.dx), y: Math.round(c.y + off.dy), duration: 40 })
      .release()
      .perform()
    await sleep(600)
    if ((await lastAction(driver)) === 'journal.close') fired++
    const p = await sheetProbe(driver)
    if (p.dialogCount > 0) modals++
    if (await fanIsOpen(driver)) fanned++
  }

  return {
    name: 'D4 — a FLICK at journal.close opens the fan and fires NOTHING (flickable:false)',
    pass: fired === 0 && modals === 0,
    detail: `over 5 flicks: fired=${fired} modalsOpened=${modals} fanOpened=${fanned} (want fired=0 modals=0)`,
  }
}

/**
 * D5 — a flick at moveStop / breakeven FIRES, because neither carries `flickable`.
 *
 * ⭐ EXPECTATION RECORDED BEFORE THE RUN: both actions had NO `flickable` key before B3 and still
 * have none, so `flickable !== false` is true and a flick fires them — opening StopConfirmSheet
 * directly. B3 changed WHICH sheet that is, never whether a flick fires.
 */
async function stepJournalFlickFires(driver, actionId) {
  const first = await journalReady(driver)
  const off = first.offsets && first.offsets[actionId]
  if (!off) return { name: `D5 ${actionId} flick`, pass: false, detail: 'no rendered bubble' }

  let fired = 0
  for (let i = 0; i < 5; i++) {
    await journalReady(driver)
    await dismissFan(driver)
    await clearLastAction(driver)
    const c = await padCentre(driver)
    await driver.actions({ async: false })
      .move({ origin: Origin.VIEWPORT, x: c.x, y: c.y })
      .press()
      .move({ origin: Origin.VIEWPORT, x: Math.round(c.x + off.dx / 2), y: Math.round(c.y + off.dy / 2), duration: 30 })
      .move({ origin: Origin.VIEWPORT, x: Math.round(c.x + off.dx), y: Math.round(c.y + off.dy), duration: 40 })
      .release()
      .perform()
    await sleep(600)
    const p = await sheetProbe(driver)
    if ((await lastAction(driver)) === actionId || p.dialogCount === 1) fired++
  }

  return {
    name: `D5 — a flick at ${actionId} FIRES (no flickable key, pre-edit behaviour preserved)`,
    pass: fired >= 4,
    detail: `${fired}/5 flicks fired (expectation stated before the run: it fires)`,
  }
}

