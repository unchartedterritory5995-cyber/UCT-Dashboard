// Plan E Task 10: the Evernote tile's member-facing copy, in ONE place. The Settings card, the
// wizard's compact tiles and the plan-refusal notice all read these; none restates them.

// Shown as a list in the consent panel, above the checkbox.
export const EVERNOTE_CONNECT_NOTES = [
  'Live sync needs a paid Evernote plan (Personal or above). Evernote does not allow it on the Free plan.',
  "Beta: Evernote's connection for apps is in beta, so things may change.",
  'Notes you imported earlier from an .enex file are matched by title and created time and kept up to date, never duplicated. Notes you have edited here are never overwritten.',
]

// The line under the consent panel: the `.enex` import is the product a Free member can use today.
export const EVERNOTE_ENEX_OFFER = 'On Evernote Free? Import an .enex export instead.'

// The OAuth return with `reason=evernote_plan` (the server's EVERNOTE_PLAN_REASON): never the raw reason.
export const EVERNOTE_PLAN_RETURN =
  'Evernote did not let us read this account. Live sync needs a paid Evernote plan. You can import an .enex export instead.'

// Opens the Notebook's import wizard once (NotebookTab strips the param).
export const ENEX_IMPORT_HREF = '/journal/notebook?import=evernote'

// Per-provider notes for `ConnectConsentPanel`'s `notes` prop. Only Evernote has any.
export const PROVIDER_CONNECT_NOTES = { evernote: EVERNOTE_CONNECT_NOTES }
