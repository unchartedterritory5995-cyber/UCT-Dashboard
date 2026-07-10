import StarterKit from '@tiptap/starter-kit'
import Image from '@tiptap/extension-image'
import Link from '@tiptap/extension-link'
import Placeholder from '@tiptap/extension-placeholder'

export function buildCommunityExtensions(placeholder = 'Share your thinking…') {
  return [
    StarterKit.configure({ heading: { levels: [2, 3] } }),
    Image.configure({ inline: false, allowBase64: false }),
    Link.configure({
      openOnClick: false,
      autolink: true,
      protocols: ['https'],
      HTMLAttributes: { rel: 'noreferrer', target: '_blank' },
    }),
    Placeholder.configure({ placeholder }),
  ]
}
