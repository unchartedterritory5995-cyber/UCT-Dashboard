import { useState, useCallback, useRef, useEffect } from 'react'
import './styles.css'
import { useAuth } from '../context/AuthContext'
import { CATEGORIES } from './data'
import {
  useFeed, useSearch, useFloorThread, useNotifications, useActivity,
  vote, react, bookmark, createThread, createComment, setAnswer, deleteThread,
  markNotificationsRead, textToDoc,
} from './hooks/useFloor'
import Header from './Header'
import Sidebar from './Sidebar'
import Feed from './Feed'
import PostDetail from './PostDetail'
import RightRail from './RightRail'
import Composer from './Composer'
import Notifications from './Notifications'
import TickerHover from './TickerHover'

// ---- raw-cache mutators (SWR caches hold the raw API JSON) -------------------
function rawVote(node, dir) {
  const my = node.my_vote || 0
  return my === dir
    ? { score: (node.score || 0) - dir, my_vote: 0 }
    : { score: (node.score || 0) + dir - my, my_vote: dir }
}
function rawReact(reactions, emoji) {
  const list = reactions || []
  const found = list.find((r) => r.emoji === emoji)
  if (found) {
    return list.map((r) => (r.emoji === emoji
      ? { ...r, reacted: !r.reacted, count: r.count + (r.reacted ? -1 : 1) } : r))
      .filter((r) => r.count > 0)
  }
  return [...list, { emoji, count: 1, reacted: true }]
}
const patchFeedItem = (m, id, patch) =>
  m((cur) => (cur ? { ...cur, threads: cur.threads.map((t) => (t.id === id ? { ...t, ...patch(t) } : t)) } : cur), { revalidate: false })
const removeFeedItem = (m, id) =>
  m((cur) => (cur ? { ...cur, threads: cur.threads.filter((t) => t.id !== id) } : cur), { revalidate: false })
const patchThreadTop = (m, patch) =>
  m((cur) => (cur ? { ...cur, ...patch(cur) } : cur), { revalidate: false })
const patchThreadPost = (m, pid, patch) =>
  m((cur) => (cur ? { ...cur, posts: cur.posts.map((p) => (p.id === pid ? { ...p, ...patch(p) } : p)) } : cur), { revalidate: false })

const catFlair = (key) => CATEGORIES.find((c) => c.key === key)?.flair || null

export default function Floor2({ embedded = false }) {
  const { user } = useAuth()
  const myId = user?.id
  const isMentor = user?.role === 'admin'
  const me = { id: myId, name: user?.display_name || (user?.email || 'You').split('@')[0], is_mentor: isMentor }

  const [view, setView] = useState('feed')       // 'feed' | 'detail'
  const [activeId, setActiveId] = useState(null)
  const [category, setCategory] = useState('all') // category key | myposts | bookmarks | notifications
  const [sort, setSort] = useState('hot')
  const [query, setQuery] = useState('')
  const [composerOpen, setComposerOpen] = useState(false)

  const searching = query.trim().length > 0
  const isNotifView = category === 'notifications'
  const specialFilter = category === 'myposts' ? 'myposts'
    : category === 'bookmarks' ? 'bookmarks' : 'all'
  const flair = (specialFilter === 'all' && !isNotifView) ? catFlair(category) : null

  const feedHook = useFeed(flair, sort, specialFilter)
  const searchHook = useSearch(query)
  const threadHook = useFloorThread(view === 'detail' ? activeId : null)
  const notifHook = useNotifications(true)
  const actHook = useActivity(true)
  const railQuestions = useFeed('Question', 'new', 'all')

  const listPosts = searching ? searchHook.posts : feedHook.posts
  const listMutate = searching ? searchHook.mutate : feedHook.mutate

  // Wheel should only ever SCROLL this page, never zoom it (some mice emit
  // ctrl+wheel). Redirect to the scrollable under the pointer, else the middle.
  const rootRef = useRef(null)
  useEffect(() => {
    const el = rootRef.current
    if (!el) return
    const onWheel = (e) => {
      const mid = el.querySelector('.main')
      if (!mid) return
      const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY
      let node = e.target; let inner = null
      while (node && node !== el) {
        const s = getComputedStyle(node)
        if (/(auto|scroll)/.test(s.overflowY) && node.scrollHeight > node.clientHeight) { inner = node; break }
        node = node.parentElement
      }
      if (e.ctrlKey) { e.preventDefault(); (inner || mid).scrollTop += delta; return }
      if (inner) return
      e.preventDefault(); mid.scrollTop += delta
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  const openPost = useCallback((id) => { setActiveId(id); setView('detail'); const m = rootRef.current?.querySelector('.main'); if (m) m.scrollTop = 0 }, [])
  const goFeed = useCallback(() => { setView('feed'); setActiveId(null) }, [])
  const handleQuery = useCallback((q) => { setQuery(q); if (q.trim()) { setView('feed'); setActiveId(null) } }, [])

  // Opening Notifications clears the unread badge.
  useEffect(() => {
    if (isNotifView && notifHook.unseen > 0) {
      markNotificationsRead().then(() => notifHook.mutate()).catch(() => {})
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isNotifView, notifHook.unseen])

  // ---- feed dispatch (feed cards) -------------------------------------------
  const feedDispatch = useCallback((a) => {
    switch (a.type) {
      case 'VOTE_POST':
        patchFeedItem(listMutate, a.postId, (t) => rawVote(t, a.dir))
        vote('thread', a.postId, a.dir).catch(() => listMutate())
        break
      case 'REACT_POST':
        patchFeedItem(listMutate, a.postId, (t) => ({ reactions: rawReact(t.reactions, a.emoji) }))
        react('thread', a.postId, a.emoji).catch(() => listMutate())
        break
      case 'SAVE_POST': {
        const cur = listPosts.find((p) => p.id === a.postId)
        const willBe = !cur?.saved
        patchFeedItem(listMutate, a.postId, () => ({ bookmarked: willBe }))
        bookmark(a.postId).then(() => { if (specialFilter === 'bookmarks') listMutate() }).catch(() => listMutate())
        break
      }
      case 'DELETE_POST':
        removeFeedItem(listMutate, a.postId)
        deleteThread(a.postId).catch(() => listMutate())
        break
      default: break
    }
  }, [listMutate, listPosts, specialFilter])

  // ---- detail dispatch (open thread + its comments) -------------------------
  const detailDispatch = useCallback((a) => {
    const tm = threadHook.mutate
    switch (a.type) {
      case 'VOTE_POST':
        patchThreadTop(tm, (t) => rawVote(t, a.dir))
        vote('thread', a.postId, a.dir).catch(() => tm())
        break
      case 'REACT_POST':
        patchThreadTop(tm, (t) => ({ reactions: rawReact(t.reactions, a.emoji) }))
        react('thread', a.postId, a.emoji).catch(() => tm())
        break
      case 'SAVE_POST': {
        const willBe = !threadHook.post?.saved
        patchThreadTop(tm, () => ({ bookmarked: willBe }))
        bookmark(a.postId).catch(() => tm())
        break
      }
      case 'VOTE_COMMENT':
        patchThreadPost(tm, a.commentId, (p) => rawVote(p, a.dir))
        vote('post', a.commentId, a.dir).catch(() => tm())
        break
      case 'REACT_COMMENT':
        patchThreadPost(tm, a.commentId, (p) => ({ reactions: rawReact(p.reactions, a.emoji) }))
        react('post', a.commentId, a.emoji).catch(() => tm())
        break
      case 'ADD_COMMENT': {
        const text = (a.body || '').trim()
        const chart = a.chart || null
        const body = text ? textToDoc(text) : textToDoc(chart ? `$${chart.ticker}` : '')
        createComment(a.postId, { body, parentId: a.parentId, chart })
          .then(() => { tm(); feedHook.mutate(); railQuestions.mutate() })
          .catch((e) => alert(e.message || 'Failed to reply'))
        break
      }
      case 'MARK_ANSWER':
        setAnswer(a.postId, a.commentId)
          .then(() => { tm(); feedHook.mutate(); railQuestions.mutate() })
          .catch((e) => alert(e.message || 'Not allowed'))
        break
      default: break
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadHook.mutate, threadHook.post])

  const submitPost = useCallback(async (payload) => {
    try {
      await createThread({
        title: payload.title, body: payload.body, flair: payload.flair,
        tickers: payload.tickers, chart: payload.chart,
      })
      setComposerOpen(false); setCategory('all'); setSort('new'); setQuery(''); setView('feed')
      feedHook.mutate()
    } catch (e) { alert(e.message || 'Failed to post') }
  }, [feedHook])

  const activePost = threadHook.post

  return (
    <div ref={rootRef} className={`floorx ${embedded ? 'embedded' : 'standalone'}`}>
      <Header
        embedded={embedded} me={me}
        query={query} setQuery={handleQuery}
        notifUnread={notifHook.unseen}
        onNav={(k) => { setCategory(k); setQuery(''); goFeed() }}
        onBrand={() => { goFeed(); setCategory('all'); setQuery('') }}
        onNew={() => setComposerOpen(true)}
      />
      <div className="shell">
        <Sidebar
          view={category} me={me} notifUnread={notifHook.unseen}
          onPick={(k) => { setCategory(k); setQuery(''); goFeed() }}
        />
        <main className="main">
          {view === 'detail' ? (
            activePost ? (
              <PostDetail
                post={activePost} dispatch={detailDispatch} onBack={goFeed} me={me}
                canAnswer={activePost.author === myId || isMentor}
              />
            ) : (
              <div className="empty"><h3>{threadHook.error ? 'Post not found' : 'Loading…'}</h3></div>
            )
          ) : isNotifView ? (
            <Notifications
              notifications={notifHook.notifications}
              onOpen={openPost}
              onMarkAll={() => markNotificationsRead().then(() => notifHook.mutate())}
            />
          ) : (
            <Feed
              posts={listPosts} sort={sort} setSort={setSort}
              searching={searching} query={query} myId={myId}
              loading={searching ? searchHook.isLoading : feedHook.isLoading}
              onOpen={openPost} dispatch={feedDispatch}
              showSort={specialFilter === 'all' && !searching}
            />
          )}
        </main>
        <RightRail questions={railQuestions.posts} activity={actHook.activity} onOpen={openPost} />
      </div>
      <TickerHover rootRef={rootRef} />
      {composerOpen && (
        <Composer onClose={() => setComposerOpen(false)} onSubmit={submitPost} />
      )}
    </div>
  )
}
