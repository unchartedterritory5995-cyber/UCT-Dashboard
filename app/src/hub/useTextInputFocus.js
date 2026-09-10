// app/src/hub/useTextInputFocus.js — is the member typing right now?
//
// Master spec §8: "Auto-hide while a text input is focused."
//
// ⛔ WHY THIS EXISTS BESIDE `useKeyboardVisible` RATHER THAN INSTEAD OF IT. That hook infers a
// keyboard from a visualViewport height drop of >150px — a PROXY for typing, and it misses three
// cases the spec's sentence covers:
//
//   * `visualViewport` absent -> the hook returns early and NEVER reports true, so on any browser
//     without it the pad sits over the field the member is filling in.
//   * a hardware keyboard, or a phone-sized viewport under desktop emulation -> focus lands in the
//     field, nothing resizes, the pad stays put.
//   * a focused `contenteditable` that does not raise a soft keyboard on that platform.
//
// The artifact the spec names is FOCUS. This hook reads that directly; the viewport hook stays,
// because a soft keyboard can also cover the pad when focus is somewhere this hook cannot see
// (a cross-origin iframe). The two are OR-ed, and neither is a substitute for the other.
//
// ⚠️ IT WRITES NOTHING. Auto-hide is transient and must never touch `hubSessionVisibility` or the
// stored preference — a member who tapped a search box has not asked to hide the hub, and a hide
// they did not request must not outlive the focus that caused it.
import { useState, useEffect } from 'react'

/** INPUT types that are not text entry. Hiding the pad because someone tapped a checkbox would be
 *  a worse bug than not hiding it at all. */
const NON_TEXT_INPUT_TYPES = new Set([
  'button', 'checkbox', 'color', 'file', 'hidden', 'image', 'radio', 'range', 'reset', 'submit',
]);

/**
 * Is this element one the member types into?
 *
 * ⭐ The rule reads the element KIND, not its transient state: a `readonly` text field still takes
 * a caret and a selection UI on touch platforms, and a rule that also consulted `readonly`,
 * `disabled` and `inputMode` would have four ways to disagree with itself.
 *
 * @param {Element|null|undefined} el
 * @returns {boolean}
 */
export function isTextEntry(el) {
  if (!el || el.nodeType !== 1) return false;
  // ⛔ BOTH THE PROPERTY AND THE ATTRIBUTE. `isContentEditable` is the right question in a browser
  // — it accounts for editability INHERITED from an ancestor — but jsdom does not implement it, so
  // a property-only check reports false for the Notebook's editor in every test that will ever run
  // here. `closest('[contenteditable]')` covers the attribute and the inherited case in both.
  if (el.isContentEditable) return true;
  const editableHost = el.closest?.('[contenteditable]');
  if (editableHost) {
    const value = (editableHost.getAttribute('contenteditable') || '').toLowerCase();
    // `contenteditable=""` and `contenteditable="true"` are both editable; only "false" is not.
    if (value !== 'false') return true;
  }
  const tag = el.tagName;
  if (tag === 'TEXTAREA') return true;
  if (tag !== 'INPUT') return false;
  // A missing `type` attribute is `text` by HTML default, and `getAttribute` returns null for it.
  const type = (el.getAttribute('type') || 'text').toLowerCase();
  return !NON_TEXT_INPUT_TYPES.has(type);
}

/**
 * True while focus sits in a text-entry element anywhere in this document.
 *
 * Listens to `focusin` / `focusout`, which bubble — unlike `focus` / `blur` — so one pair of
 * document-level listeners covers every field on the page, including ones mounted later.
 *
 * @returns {boolean}
 */
export default function useTextInputFocus() {
  // ⛔ SEEDED FROM THE LIVE `activeElement`, not `false`. The hub can mount while a field is
  // already focused (a route change with an autofocused search box), and a hook that started false
  // would leave the pad over it until the member blurred and re-focused.
  const [typing, setTyping] = useState(
    () => (typeof document !== 'undefined' ? isTextEntry(document.activeElement) : false),
  );

  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    // Both handlers re-read `document.activeElement` rather than trusting `e.target`: focusout
    // fires BEFORE the next element takes focus, so `e.target` on the way out says nothing about
    // where focus is going. Tabbing from one input to the next must stay `true` throughout.
    const sync = () => setTyping(isTextEntry(document.activeElement));
    document.addEventListener('focusin', sync);
    document.addEventListener('focusout', sync);
    return () => {
      document.removeEventListener('focusin', sync);
      document.removeEventListener('focusout', sync);
    };
  }, []);

  return typing;
}

export { useTextInputFocus };
