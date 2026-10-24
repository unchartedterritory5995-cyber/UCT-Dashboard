// The emoji shortcode shape, on its own so the eager Notebook menu can build its `:name:` rule
// without importing the emoji data (loaded on the first `:`, lib/emojiLoader.js).

/**
 * What a shortcode is made of -- ONE authority. The picker's query test below
 * and the typed-whole `:name:` rule (EmojiMenu's SHORTCODE_FIND) are both
 * built from it, and both read it without regard to case (searchEmoji and
 * emojiByName lower-case), so `:Rocket` in the menu and `:Rocket:` typed whole
 * agree. Two hand-written copies had already diverged on exactly that.
 */
export const SHORTCODE_BODY = '[a-z0-9_+-]{1,32}'
export const EMOJI_QUERY_RE = new RegExp(`^${SHORTCODE_BODY}$`, 'i')
