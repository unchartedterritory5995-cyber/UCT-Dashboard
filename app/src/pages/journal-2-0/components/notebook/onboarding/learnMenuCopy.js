// What the Learn BUTTON needs, in a file of its own (residual round, ruling R25). The button is on
// Research Home's first-open path; the menu behind it (LearnMenuPanel.jsx, learnTours.js,
// capabilityList.js, the sample notebook client) is a chunk fetched on the first press. So the words
// of the button, the Help address and the one "is the menu offered at all" rule are here, and
// learnTours.js RE-EXPORTS them: there is still one authority for each, and every existing import
// from learnTours keeps working.
import { checklistEnabled } from './gettingStartedPref'

/** Help > Walkthroughs (Support.jsx `WALKTHROUGHS_ID`; arriving with this hash focuses it).
 *  learnTours.test.js holds the two together, so a rename there cannot strand this link. */
export const HELP_WALKTHROUGHS_HREF = '/support#walkthroughs'

/** Every word the menu shows. */
export const LEARN_COPY = Object.freeze({
  button: 'Learn',
  buttonTitle: 'Walkthroughs of what the Notebook can do',
  menuLabel: 'Learn: walkthroughs',
  tour: (title) => `${title} tour`,
  help: 'All walkthroughs in Help',
  // P0.15: the sample notebook, offered here to a member with NO notes yet (the server refuses it to
  // anyone who has one, active, archived or trashed: D-C6, so the menu does not offer what it will
  // refuse). The words the member reads while it adds, or when it cannot, are SAMPLE_COPY's.
  sample: 'Add the sample notebook',
})

/** Whether the menu is offered at all: the wave-14 switch on (see learnTours.js's header). */
export function learnMenuEnabled(flag) {
  return typeof flag === 'function' && checklistEnabled(flag)
}
