/**
 * Wave 5 — the emoji picker's list: a curated set, in-house, as TEXT.
 *
 * ⛔ WHY NOT @tiptap/extension-emoji. It stores every emoji as an `emoji`
 * NODE (an inline atom with a `name` attribute) and ships a dataset of
 * thousands of entries. A node would need its own row in both citation tables,
 * its own Markdown export and share handling, would read as an atom rather
 * than as text in search, Ask and a copy into another app — and would still
 * render the same character. An emoji inserted here is plain Unicode TEXT: it
 * saves, searches, exports, pastes and cites exactly like a letter, and the
 * citation walkers already count astral characters in UTF-16 units.
 *
 * ⛔ CURATED, NOT EXHAUSTIVE. Faces and hands a note uses, and the markers a
 * trader writes with (charts, money, direction, status, calendar, risk). The
 * operating system's own emoji keyboard remains the door to everything else.
 * `name` is the Slack/GitHub shortcode (what `:name:` types); `keywords` are
 * extra words the picker matches.
 */
export const EMOJI = Object.freeze([
  // ── markets & money ──
  { char: '📈', name: 'chart_with_upwards_trend', keywords: ['up', 'gain', 'rally', 'bull', 'chart'] },
  { char: '📉', name: 'chart_with_downwards_trend', keywords: ['down', 'loss', 'selloff', 'bear', 'chart'] },
  { char: '📊', name: 'bar_chart', keywords: ['chart', 'stats', 'data'] },
  { char: '💹', name: 'chart', keywords: ['yen', 'market', 'up'] },
  { char: '🚀', name: 'rocket', keywords: ['moon', 'launch', 'breakout'] },
  { char: '🐂', name: 'ox', keywords: ['bull', 'bullish'] },
  { char: '🐻', name: 'bear', keywords: ['bearish'] },
  { char: '💰', name: 'moneybag', keywords: ['money', 'profit', 'cash'] },
  { char: '💵', name: 'dollar', keywords: ['money', 'cash', 'usd'] },
  { char: '💸', name: 'money_with_wings', keywords: ['loss', 'spend', 'money'] },
  { char: '🤑', name: 'money_mouth_face', keywords: ['rich', 'profit'] },
  { char: '🪙', name: 'coin', keywords: ['crypto', 'money'] },
  { char: '💎', name: 'gem', keywords: ['diamond', 'hands', 'hold'] },
  { char: '🏦', name: 'bank', keywords: ['fed', 'finance'] },
  { char: '🧾', name: 'receipt', keywords: ['fill', 'order', 'invoice'] },
  { char: '🛢️', name: 'oil_drum', keywords: ['oil', 'energy', 'crude'] },
  { char: '⛽', name: 'fuelpump', keywords: ['gas', 'energy', 'oil'] },
  { char: '🏭', name: 'factory', keywords: ['industry', 'manufacturing'] },
  { char: '🐳', name: 'whale', keywords: ['big', 'flow', 'size'] },
  { char: '🎯', name: 'dart', keywords: ['target', 'goal', 'bullseye'] },
  { char: '🧮', name: 'abacus', keywords: ['math', 'calculate'] },
  // ── direction & status ──
  { char: '⬆️', name: 'arrow_up', keywords: ['up', 'higher'] },
  { char: '⬇️', name: 'arrow_down', keywords: ['down', 'lower'] },
  { char: '↗️', name: 'arrow_upper_right', keywords: ['up', 'rising'] },
  { char: '↘️', name: 'arrow_lower_right', keywords: ['down', 'falling'] },
  { char: '➡️', name: 'arrow_right', keywords: ['next', 'flat'] },
  { char: '🔺', name: 'small_red_triangle', keywords: ['up', 'increase'] },
  { char: '🔻', name: 'small_red_triangle_down', keywords: ['down', 'decrease'] },
  { char: '🟢', name: 'green_circle', keywords: ['go', 'buy', 'long', 'ok'] },
  { char: '🟡', name: 'yellow_circle', keywords: ['caution', 'wait', 'hold'] },
  { char: '🔴', name: 'red_circle', keywords: ['stop', 'sell', 'short'] },
  { char: '✅', name: 'white_check_mark', keywords: ['done', 'yes', 'check', 'ok'] },
  { char: '☑️', name: 'ballot_box_with_check', keywords: ['done', 'check'] },
  { char: '❌', name: 'x', keywords: ['no', 'wrong', 'cancel'] },
  { char: '⚠️', name: 'warning', keywords: ['caution', 'risk', 'alert'] },
  { char: '🚨', name: 'rotating_light', keywords: ['alert', 'alarm', 'urgent'] },
  { char: '🛑', name: 'stop_sign', keywords: ['stop', 'halt'] },
  { char: '⛔', name: 'no_entry', keywords: ['stop', 'forbidden'] },
  { char: '❓', name: 'question', keywords: ['why', 'unknown'] },
  { char: '❗', name: 'exclamation', keywords: ['important', 'alert'] },
  { char: '➕', name: 'heavy_plus_sign', keywords: ['add', 'plus'] },
  { char: '➖', name: 'heavy_minus_sign', keywords: ['remove', 'minus'] },
  { char: '💯', name: '100', keywords: ['perfect', 'hundred'] },
  { char: '⭐', name: 'star', keywords: ['favorite', 'important'] },
  { char: '🔥', name: 'fire', keywords: ['hot', 'momentum', 'lit'] },
  { char: '⚡', name: 'zap', keywords: ['fast', 'lightning', 'power'] },
  { char: '🧊', name: 'ice_cube', keywords: ['cold', 'frozen'] },
  { char: '🌊', name: 'ocean', keywords: ['wave', 'water', 'flow'] },
  { char: '🧨', name: 'firecracker', keywords: ['catalyst', 'explosive'] },
  { char: '💥', name: 'boom', keywords: ['explosion', 'crash'] },
  { char: '🎢', name: 'roller_coaster', keywords: ['volatile', 'volatility'] },
  { char: '🏁', name: 'checkered_flag', keywords: ['finish', 'done'] },
  { char: '🔔', name: 'bell', keywords: ['alert', 'notification'] },
  { char: '🔒', name: 'lock', keywords: ['locked', 'secure'] },
  { char: '🔑', name: 'key', keywords: ['important', 'unlock'] },
  // ── notes, time & work ──
  { char: '📌', name: 'pushpin', keywords: ['pin', 'important'] },
  { char: '📍', name: 'round_pushpin', keywords: ['location', 'pin'] },
  { char: '📝', name: 'memo', keywords: ['note', 'write'] },
  { char: '✏️', name: 'pencil2', keywords: ['edit', 'write'] },
  { char: '📎', name: 'paperclip', keywords: ['attach'] },
  { char: '📚', name: 'books', keywords: ['study', 'read', 'learn'] },
  { char: '📰', name: 'newspaper', keywords: ['news', 'headline'] },
  { char: '🔍', name: 'mag', keywords: ['search', 'look', 'research'] },
  { char: '💡', name: 'bulb', keywords: ['idea', 'insight'] },
  { char: '🧠', name: 'brain', keywords: ['think', 'smart'] },
  { char: '👀', name: 'eyes', keywords: ['watch', 'look', 'watchlist'] },
  { char: '📅', name: 'date', keywords: ['calendar', 'day'] },
  { char: '🗓️', name: 'spiral_calendar', keywords: ['calendar', 'schedule'] },
  { char: '⏰', name: 'alarm_clock', keywords: ['time', 'reminder'] },
  { char: '⏳', name: 'hourglass_flowing_sand', keywords: ['wait', 'time', 'pending'] },
  { char: '🕐', name: 'clock1', keywords: ['time'] },
  { char: '🧭', name: 'compass', keywords: ['direction', 'plan'] },
  { char: '🗺️', name: 'world_map', keywords: ['map', 'plan'] },
  { char: '🌍', name: 'earth_africa', keywords: ['world', 'global', 'macro'] },
  { char: '💻', name: 'computer', keywords: ['laptop', 'tech'] },
  { char: '📱', name: 'iphone', keywords: ['phone', 'mobile'] },
  { char: '🤖', name: 'robot', keywords: ['ai', 'bot', 'algo'] },
  { char: '📦', name: 'package', keywords: ['box', 'shipping'] },
  { char: '🗑️', name: 'wastebasket', keywords: ['trash', 'delete'] },
  { char: '🎲', name: 'game_die', keywords: ['gamble', 'luck', 'odds'] },
  { char: '🍀', name: 'four_leaf_clover', keywords: ['luck', 'lucky'] },
  { char: '🏆', name: 'trophy', keywords: ['win', 'winner', 'best'] },
  { char: '🥇', name: '1st_place_medal', keywords: ['first', 'gold', 'winner'] },
  { char: '🎉', name: 'tada', keywords: ['party', 'celebrate', 'win'] },
  { char: '🍾', name: 'champagne', keywords: ['celebrate'] },
  { char: '☕', name: 'coffee', keywords: ['morning', 'premarket'] },
  { char: '🌅', name: 'sunrise', keywords: ['morning', 'premarket', 'open'] },
  { char: '🌙', name: 'crescent_moon', keywords: ['night', 'overnight', 'afterhours'] },
  { char: '☀️', name: 'sunny', keywords: ['day', 'sun'] },
  { char: '💤', name: 'zzz', keywords: ['sleep', 'quiet', 'boring'] },
  // ── faces ──
  { char: '😀', name: 'grinning', keywords: ['happy', 'smile'] },
  { char: '😃', name: 'smiley', keywords: ['happy', 'smile'] },
  { char: '😄', name: 'smile', keywords: ['happy', 'joy'] },
  { char: '😁', name: 'grin', keywords: ['happy'] },
  { char: '😅', name: 'sweat_smile', keywords: ['relief', 'phew'] },
  { char: '😂', name: 'joy', keywords: ['laugh', 'lol'] },
  { char: '🙂', name: 'slightly_smiling_face', keywords: ['smile', 'ok'] },
  { char: '🙃', name: 'upside_down_face', keywords: ['silly', 'irony'] },
  { char: '😉', name: 'wink', keywords: ['flirt'] },
  { char: '😊', name: 'blush', keywords: ['happy', 'smile'] },
  { char: '😍', name: 'heart_eyes', keywords: ['love'] },
  { char: '😎', name: 'sunglasses', keywords: ['cool'] },
  { char: '🤔', name: 'thinking', keywords: ['hmm', 'think', 'consider'] },
  { char: '🤨', name: 'raised_eyebrow', keywords: ['skeptical', 'doubt'] },
  { char: '😐', name: 'neutral_face', keywords: ['meh', 'flat'] },
  { char: '😑', name: 'expressionless', keywords: ['meh'] },
  { char: '🙄', name: 'roll_eyes', keywords: ['annoyed'] },
  { char: '😬', name: 'grimacing', keywords: ['awkward', 'yikes'] },
  { char: '😮', name: 'open_mouth', keywords: ['surprise', 'wow'] },
  { char: '😲', name: 'astonished', keywords: ['shock', 'wow'] },
  { char: '😱', name: 'scream', keywords: ['fear', 'panic'] },
  { char: '🤯', name: 'exploding_head', keywords: ['mind', 'blown'] },
  { char: '😳', name: 'flushed', keywords: ['embarrassed'] },
  { char: '🥶', name: 'cold_face', keywords: ['cold', 'freeze'] },
  { char: '🥵', name: 'hot_face', keywords: ['hot'] },
  { char: '😴', name: 'sleeping', keywords: ['tired', 'sleep'] },
  { char: '😢', name: 'cry', keywords: ['sad', 'tear'] },
  { char: '😭', name: 'sob', keywords: ['sad', 'cry'] },
  { char: '😤', name: 'triumph', keywords: ['frustrated', 'steam'] },
  { char: '😡', name: 'rage', keywords: ['angry', 'mad'] },
  { char: '🤬', name: 'cursing_face', keywords: ['angry', 'swear'] },
  { char: '🥳', name: 'partying_face', keywords: ['party', 'celebrate'] },
  { char: '🤡', name: 'clown_face', keywords: ['clown', 'fool'] },
  { char: '💀', name: 'skull', keywords: ['dead', 'rip'] },
  { char: '🤝', name: 'handshake', keywords: ['deal', 'agree'] },
  // ── hands & gestures ──
  { char: '👍', name: '+1', keywords: ['thumbsup', 'yes', 'good', 'like'] },
  { char: '👎', name: '-1', keywords: ['thumbsdown', 'no', 'bad'] },
  { char: '👏', name: 'clap', keywords: ['applause', 'bravo'] },
  { char: '🙌', name: 'raised_hands', keywords: ['hooray', 'yes'] },
  { char: '🙏', name: 'pray', keywords: ['please', 'thanks', 'hope'] },
  { char: '💪', name: 'muscle', keywords: ['strong', 'strength'] },
  { char: '👋', name: 'wave', keywords: ['hello', 'bye'] },
  { char: '👉', name: 'point_right', keywords: ['right', 'next'] },
  { char: '👆', name: 'point_up_2', keywords: ['up', 'above'] },
  { char: '👇', name: 'point_down', keywords: ['down', 'below'] },
  { char: '✌️', name: 'v', keywords: ['peace', 'victory'] },
  { char: '🤞', name: 'crossed_fingers', keywords: ['luck', 'hope'] },
  { char: '🤷', name: 'shrug', keywords: ['dunno', 'whatever'] },
  { char: '🤦', name: 'facepalm', keywords: ['mistake', 'doh'] },
  // ── hearts & symbols ──
  { char: '❤️', name: 'heart', keywords: ['love', 'like'] },
  { char: '💔', name: 'broken_heart', keywords: ['sad', 'loss'] },
  { char: '💚', name: 'green_heart', keywords: ['love', 'green'] },
  { char: '✨', name: 'sparkles', keywords: ['new', 'shiny', 'clean'] },
  { char: '🌟', name: 'star2', keywords: ['glow', 'star'] },
  { char: '🦄', name: 'unicorn', keywords: ['rare', 'magic'] },
  { char: '🐍', name: 'snake', keywords: ['python', 'sneaky'] },
  { char: '🪤', name: 'mouse_trap', keywords: ['trap', 'bulltrap', 'beartrap'] },
  { char: '🎪', name: 'circus_tent', keywords: ['circus', 'chaos'] },
  // ── flags a macro note reaches for ──
  { char: '🇺🇸', name: 'us', keywords: ['usa', 'america', 'flag'] },
  { char: '🇪🇺', name: 'eu', keywords: ['europe', 'flag'] },
  { char: '🇬🇧', name: 'gb', keywords: ['uk', 'britain', 'flag'] },
  { char: '🇨🇳', name: 'cn', keywords: ['china', 'flag'] },
  { char: '🇯🇵', name: 'jp', keywords: ['japan', 'flag'] },
].map(Object.freeze))

const BY_NAME = new Map(EMOJI.map((e) => [e.name, e]))

/** The emoji a `:name:` shortcode names, or null. */
export function emojiByName(name) {
  return BY_NAME.get(String(name || '').toLowerCase()) || null
}

/**
 * What a shortcode is made of -- ONE authority. The picker's query test below
 * and the typed-whole `:name:` rule (EmojiMenu's SHORTCODE_FIND) are both
 * built from it, and both read it without regard to case (searchEmoji and
 * emojiByName lower-case), so `:Rocket` in the menu and `:Rocket:` typed whole
 * agree. Two hand-written copies had already diverged on exactly that.
 */
export const SHORTCODE_BODY = '[a-z0-9_+-]{1,32}'
export const EMOJI_QUERY_RE = new RegExp(`^${SHORTCODE_BODY}$`, 'i')

/**
 * The picker's matches for what was typed after `:`, best first, at most
 * `limit`: a shortcode that STARTS with the query, then one containing it,
 * then a keyword that starts with it. Anything that is not a shortcode-shaped
 * query (":)", ": ", a time's "30") matches nothing, so the menu stays shut.
 */
export function searchEmoji(query, limit = 8) {
  const q = String(query || '').toLowerCase()
  if (!EMOJI_QUERY_RE.test(q)) return []
  const tiers = [[], [], []]
  for (const e of EMOJI) {
    if (e.name.startsWith(q)) tiers[0].push(e)
    else if (e.name.includes(q)) tiers[1].push(e)
    else if (e.keywords.some((k) => k.startsWith(q))) tiers[2].push(e)
  }
  return tiers.flat().slice(0, limit)
}
