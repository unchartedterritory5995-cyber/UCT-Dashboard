// Calls the REAL editorStateDiscardsUnsentWork / discardsUnsentWork from the tree it is run in.
import { editorStateDiscardsUnsentWork, discardsUnsentWork } from '/src/pages/journal-2-0/lib/offline/recoverLocalState.js'
const para = (...c) => ({ type: 'paragraph', content: c })
const t = (text) => ({ type: 'text', text })
const chip = (date) => ({ type: 'dateMention', attrs: { date } })
const doc = (...p) => ({ type: 'doc', content: p })
const task = (...c) => ({ type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: false }, content: [para(...c)] }] })
const rec = (bodyJson, dirty = 1) => ({ title: 'Walk', subtitle: '', bodyJson, dirty })
const cases = {
  'typed more at the end (prev "Follow up @" -> "Follow up @x")': [doc(para(t('Walk')), task(t('Follow up @'))), doc(para(t('Walk')), task(t('Follow up @x')))],
  'chip replaces the "@" (prev "Follow up @" -> "Follow up " + chip + " ")': [doc(para(t('Walk')), task(t('Follow up @'))), doc(para(t('Walk')), task(t('Follow up '), chip('2026-10-15'), t(' ')))],
  'chip replaces "@" when prev is "Follow up " (the "@" never persisted)': [doc(para(t('Walk')), task(t('Follow up '))), doc(para(t('Walk')), task(t('Follow up '), chip('2026-10-15'), t(' ')))],
  'insert in the MIDDLE of a later paragraph ("ab" -> "aXb")': [doc(para(t('Walk')), para(t('ab'))), doc(para(t('Walk')), para(t('aXb')))],
  'insert BEFORE existing text ("Reminder" -> "Follow up Reminder")': [doc(para(t('Walk')), para(t('Reminder'))), doc(para(t('Walk')), para(t('Follow up Reminder')))],
  'backspace one char ("abc" -> "ab")': [doc(para(t('Walk')), para(t('abc'))), doc(para(t('Walk')), para(t('ab')))],
}
for (const [name, [a, b]] of Object.entries(cases)) {
  console.log(JSON.stringify({ case: name, editorStateDiscardsUnsentWork: editorStateDiscardsUnsentWork(rec(a), rec(b)), discardsUnsentWork: discardsUnsentWork(rec(a), rec(b)) }))
}
