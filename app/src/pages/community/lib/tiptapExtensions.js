import StarterKit from '@tiptap/starter-kit'
import Image from '@tiptap/extension-image'
import Link from '@tiptap/extension-link'
import Placeholder from '@tiptap/extension-placeholder'
import { TickerMention } from './tickerMention'
import { UserMention } from './userMention'

// opts.mentions — include the @-user-mention node. On for the chat composer and
// for renderBody (so stored chat mentions render); off for the forum composer
// (forum posts don't notify, so no misleading @-autocomplete there).
export function buildCommunityExtensions(placeholder = 'Share your thinking…', opts = {}) {
  const ext = [
    StarterKit.configure({ heading: { levels: [2, 3] } }),
    Image.configure({ inline: false, allowBase64: false }),
    Link.configure({
      openOnClick: false,
      autolink: true,
      protocols: ['https'],
      HTMLAttributes: { rel: 'noreferrer', target: '_blank' },
    }),
    Placeholder.configure({ placeholder }),
    TickerMention,
  ]
  if (opts.mentions) ext.push(UserMention)
  return ext
}
