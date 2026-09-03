// The Floor (forum v2) data layer. SWR reads + apiCall writes against the real
// /api/community/floor/* backend, with adapters that map the snake_case API into
// the shape the prototype components already consume (camelCase: votes/myVote/
// saved/answerId/comments/reactions[{emoji,count,reacted}]/chart/createdAt-ms).
import useSWR, { mutate as globalMutate } from 'swr'
import { fetcher, apiCall } from '../../pages/community/hooks/useCommunity'

export { fetcher, apiCall }

const BASE = '/api/community/floor'

// ---- adapters: API (snake_case, seconds) → component shape (camelCase, ms) ----

// A flat post row → the comment-node shape (replies filled in by the tree builder).
function adaptComment(p) {
  return {
    id: p.id,
    author: p.author_id,
    authorInfo: p.author || null,
    parentId: p.parent_post_id,
    body: p.body,
    chart: p.chart || null,
    votes: p.score ?? 0,
    myVote: p.my_vote ?? 0,
    reactions: (p.reactions || []).map((r) => ({ ...r })),
    mentorHighlight: !!p.mentor_highlight,
    deleted: !!p.deleted,
    createdAt: (p.created_at || 0) * 1000,
    replies: [],
  }
}

// Build the nested comment tree from the backend's flat, chronological post list.
function buildTree(posts) {
  const nodes = new Map()
  posts.forEach((p) => nodes.set(p.id, adaptComment(p)))
  const roots = []
  nodes.forEach((node) => {
    if (node.parentId && nodes.has(node.parentId)) {
      nodes.get(node.parentId).replies.push(node)
    } else {
      roots.push(node)
    }
  })
  return roots
}

function adaptThread(t) {
  return {
    id: t.id,
    author: t.author_id,
    authorInfo: t.author || null,
    flair: t.flair || 'Discussion',
    title: t.title,
    // body is a TipTap doc JSON string; components render it via renderBodyHTML.
    body: t.body || '',
    tickers: t.tickers || [],
    chart: t.chart || null,
    votes: t.score ?? 0,
    myVote: t.my_vote ?? 0,
    saved: !!t.bookmarked,
    pinned: !!t.pinned,
    answerId: t.answer_post_id || null,
    reactions: (t.reactions || []).map((r) => ({ ...r })),
    commentCount: t.comment_count ?? 0,
    createdAt: (t.created_at || 0) * 1000,
    lastActivityAt: (t.last_activity_at || t.created_at || 0) * 1000,
  }
}

// Full thread detail: thread fields + nested comments.
function adaptThreadDetail(t) {
  const base = adaptThread(t)
  base.comments = buildTree(t.posts || [])
  return base
}

function adaptNotification(n) {
  return {
    id: n.id,
    kind: n.kind,
    actor: n.actor?.name || 'Someone',
    actorId: n.actor_id,
    emoji: n.emoji || null,
    threadId: n.thread_id,
    postId: n.post_id,
    postTitle: n.thread_title || '',
    createdAt: (n.created_at || 0) * 1000,
    seen: !!n.seen,
  }
}

function adaptActivity(e) {
  return {
    id: e.id,
    kind: e.kind,
    actor: e.actor?.name || 'Someone',
    actorId: e.actor_id,
    emoji: e.emoji || null,
    threadId: e.thread_id,
    postTitle: e.thread_title || '',
    createdAt: (e.created_at || 0) * 1000,
  }
}

// ---- SWR read hooks ---------------------------------------------------------

const feedKey = (flair, sort, filter) => {
  const p = new URLSearchParams()
  if (flair) p.set('flair', flair)
  if (sort) p.set('sort', sort)
  if (filter && filter !== 'all') p.set('filter', filter)
  const qs = p.toString()
  return `${BASE}/feed${qs ? `?${qs}` : ''}`
}

export function useFeed(flair, sort = 'hot', filter = 'all') {
  const key = feedKey(flair, sort, filter)
  const { data, error, isLoading, mutate } = useSWR(key, fetcher, { refreshInterval: 30_000 })
  return {
    posts: (data?.threads || []).map(adaptThread),
    error, isLoading, mutate, key,
  }
}

export function useFloorThread(threadId) {
  const key = threadId ? `${BASE}/threads/${threadId}` : null
  const { data, error, isLoading, mutate } = useSWR(key, fetcher, { refreshInterval: 20_000 })
  return { post: data ? adaptThreadDetail(data) : null, error, isLoading, mutate, key }
}

export function useFloorStatus() {
  return useSWR('/api/community/status', fetcher, { refreshInterval: 30_000 })
}

export function useSearch(query) {
  const q = (query || '').trim()
  const key = q ? `${BASE}/search?q=${encodeURIComponent(q)}` : null
  const { data, error, isLoading, mutate } = useSWR(key, fetcher, { keepPreviousData: true })
  return { posts: (data?.threads || []).map(adaptThread), error, isLoading, mutate, active: !!q }
}

export function useNotifications(enabled = true) {
  const { data, error, mutate } = useSWR(
    enabled ? `${BASE}/notifications` : null, fetcher, { refreshInterval: 30_000 })
  return {
    notifications: (data?.notifications || []).map(adaptNotification),
    unseen: data?.unseen ?? 0,
    error, mutate,
  }
}

export function useActivity(enabled = true) {
  const { data, error, mutate } = useSWR(
    enabled ? `${BASE}/activity` : null, fetcher, { refreshInterval: 10_000 })
  return { activity: (data?.activity || []).map(adaptActivity), error, mutate }
}

// ---- write actions (optimistic where instant feedback matters) --------------

// Revalidate every feed variant + the open thread after a structural change.
function revalidateFeeds() {
  globalMutate((key) => typeof key === 'string' && key.startsWith(`${BASE}/feed`), undefined, { revalidate: true })
}

export async function vote(target_type, target_id, dir) {
  const r = await apiCall(`${BASE}/votes`, { target_type, target_id, dir })
  return r // { score, my_vote }
}

export async function react(target_type, target_id, emoji) {
  const r = await apiCall(`${BASE}/reactions`, { target_type, target_id, emoji })
  return r // { on }
}

export async function bookmark(thread_id) {
  const r = await apiCall(`${BASE}/bookmarks/${thread_id}`)
  return r // { on }
}

export async function createThread({ title, body, flair, tickers, chart }) {
  const r = await apiCall(`${BASE}/threads`, {
    title, body, flair, ticker_tags: tickers || [], chart: chart || null,
  })
  revalidateFeeds()
  return r.id
}

export async function createComment(threadId, { body, parentId, chart }) {
  const r = await apiCall(`${BASE}/threads/${threadId}/posts`, {
    body, parent_post_id: parentId || null, chart: chart || null,
  })
  return r.id
}

export async function setAnswer(threadId, postId) {
  const r = await apiCall(`${BASE}/threads/${threadId}/answer`, { post_id: postId })
  return r.answer_post_id
}

export async function deleteThread(threadId) {
  await apiCall(`${BASE}/threads/${threadId}`, undefined, 'DELETE')
  revalidateFeeds()
}

export async function deletePost(postId) {
  await apiCall(`${BASE}/posts/${postId}`, undefined, 'DELETE')
}

export async function markNotificationsRead() {
  await apiCall(`${BASE}/notifications/read`)
}

// Upload an image (reuses the existing community image endpoint) → returns url.
export async function uploadImage(file) {
  const fd = new FormData()
  fd.append('file', file)
  const r = await apiCall('/api/community/images', fd)
  return r // { url, width, height }
}

// ---- optimistic local mutators over a feed/thread SWR cache ------------------
// Pure helpers the components apply via mutate(...optimisticData) so a vote/react/
// bookmark updates instantly and rolls back on error.

// ---- TipTap doc builders (bodies are stored as TipTap doc JSON strings) ------

const textParagraph = (text) => (text
  ? { type: 'paragraph', content: [{ type: 'text', text }] }
  : { type: 'paragraph' })

// Plain multi-paragraph text (blank line separates paragraphs) → doc JSON string.
export function textToDoc(text) {
  const paras = String(text || '').split(/\n{2,}/).map((s) => s.trim()).filter(Boolean)
  const content = (paras.length ? paras : ['']).map(textParagraph)
  return JSON.stringify({ type: 'doc', content })
}

// Paragraphs + community-hosted image urls → doc JSON string.
export function buildDoc(text, imageUrls = []) {
  const paras = String(text || '').split(/\n{2,}/).map((s) => s.trim()).filter(Boolean)
  const content = paras.map(textParagraph)
  imageUrls.forEach((src) => { if (src) content.push({ type: 'image', attrs: { src } }) })
  if (!content.length) content.push({ type: 'paragraph' })
  return JSON.stringify({ type: 'doc', content })
}

export function applyVoteLocal(item, dir) {
  const my = item.myVote || 0
  if (my === dir) return { ...item, votes: item.votes - dir, myVote: 0 }
  return { ...item, votes: item.votes + dir - my, myVote: dir }
}

export function toggleReactionLocal(reactions, emoji) {
  const found = (reactions || []).find((r) => r.emoji === emoji)
  if (found) {
    return reactions.map((r) => (r.emoji === emoji
      ? { ...r, reacted: !r.reacted, count: r.count + (r.reacted ? -1 : 1) }
      : r)).filter((r) => r.count > 0)
  }
  return [...(reactions || []), { emoji, count: 1, reacted: true }]
}
