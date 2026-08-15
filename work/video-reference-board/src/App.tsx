import { useEffect, useMemo, useRef, useState } from 'react'
import Masonry from 'react-masonry-css'
import {
  Download,
  Heart,
  ImagePlus,
  Import,
  Link,
  LogOut,
  Pencil,
  Plus,
  Search,
  Tag,
  Trash2,
  X as XIcon,
} from 'lucide-react'
import { onAuthStateChanged, signInWithPopup, signOut, type User } from 'firebase/auth'
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage'
import { auth, googleProvider, storage } from './firebase'
import { getPlatformLabel } from './metadata'
import { useBoardStore } from './store'
import type { BoardItem, Platform, SortMode } from './types'
import './index.css'

const platforms: Array<'all' | Platform> = ['all', 'x', 'instagram', 'threads', 'linkedin', 'facebook']
const presetTags = ['real', '3D', '2D', 'Tutorial', 'Original', 'Prompt']
// 필터바 태그 그룹. 종류(Type)와 프롬프트/튜토리얼로 나눕니다.
const typeTags = ['real', '3D', '2D', 'Original']
const purposeTags = ['Prompt', 'Tutorial']

const masonryBreakpoints = {
  default: 6,
  1800: 5,
  1400: 4,
  1000: 3,
  720: 2,
  460: 1,
}

const sortLabels: Record<SortMode, string> = {
  newest: '최신순',
  oldest: '오래된순',
  title: '제목순',
  platform: '플랫폼순',
}

const sorters: Record<SortMode, (a: BoardItem, b: BoardItem) => number> = {
  newest: (a, b) => Date.parse(b.savedAt) - Date.parse(a.savedAt),
  oldest: (a, b) => Date.parse(a.savedAt) - Date.parse(b.savedAt),
  title: (a, b) => a.title.localeCompare(b.title, 'ko'),
  // 같은 플랫폼끼리 묶고, 그 안에서는 최신순으로 둡니다.
  platform: (a, b) => a.platform.localeCompare(b.platform) || Date.parse(b.savedAt) - Date.parse(a.savedAt),
}

// 검색어는 제목·작성자·설명·태그·URL 전체에서 찾습니다.
function matchesQuery(item: BoardItem, query: string) {
  return (
    item.title.toLowerCase().includes(query) ||
    item.author.toLowerCase().includes(query) ||
    item.description.toLowerCase().includes(query) ||
    item.url.toLowerCase().includes(query) ||
    item.tags.some((tag) => tag.toLowerCase().includes(query))
  )
}

function parseTags(value: string) {
  return value
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean)
}

function addTagToText(value: string, tag: string) {
  const tags = parseTags(value)
  if (!tags.includes(tag)) {
    tags.push(tag)
  }
  return tags.join(', ')
}

function compressImageToBlob(file: File, maxWidth = 720, quality = 0.8): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const objectUrl = URL.createObjectURL(file)
    img.onload = () => {
      URL.revokeObjectURL(objectUrl)
      const scale = Math.min(1, maxWidth / img.width)
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(img.width * scale)
      canvas.height = Math.round(img.height * scale)
      canvas.getContext('2d')?.drawImage(img, 0, 0, canvas.width, canvas.height)
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('이미지 변환 실패'))), 'image/jpeg', quality)
    }
    img.onerror = () => { URL.revokeObjectURL(objectUrl); reject(new Error('이미지를 읽을 수 없습니다.')) }
    img.src = objectUrl
  })
}

async function uploadThumbnail(uid: string, file: File): Promise<string> {
  const blob = await compressImageToBlob(file)
  const storageRef = ref(storage, `users/${uid}/thumbnails/${Date.now()}-${crypto.randomUUID()}.jpg`)
  await uploadBytes(storageRef, blob, { contentType: 'image/jpeg' })
  return getDownloadURL(storageRef)
}

// 섬네일 선택 → 압축 → Storage 업로드까지의 상태를 한곳에서 관리합니다.
// 실패는 삼키지 않고 error로 노출해 폼 안에 그대로 표시합니다.
function useThumbnailPicker() {
  const [imageUrl, setImageUrl] = useState('')
  const [name, setName] = useState('')
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  async function pick(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    const uid = useBoardStore.getState().uid
    if (!uid) return
    setUploading(true)
    setError('')
    try {
      const url = await uploadThumbnail(uid, file)
      setImageUrl(url)
      setName(file.name)
    } catch (err) {
      console.error('thumbnail upload failed', err)
      setError(err instanceof Error && err.message ? err.message : '섬네일 업로드에 실패했습니다.')
      // 같은 파일을 다시 고를 수 있도록 input을 비웁니다.
      event.target.value = ''
    } finally {
      setUploading(false)
    }
  }

  function reset() {
    setImageUrl('')
    setName('')
    setError('')
    if (inputRef.current) inputRef.current.value = ''
  }

  return { imageUrl, name, uploading, error, inputRef, pick, reset }
}

// 섬네일 선택 버튼 + 숨은 file input + 에러 표시를 묶은 공용 UI입니다.
function ThumbnailField({ picker, label }: { picker: ReturnType<typeof useThumbnailPicker>; label: string }) {
  const { inputRef, uploading, name, error, pick } = picker
  return (
    <>
      <button
        className="secondary-button w-full max-w-none"
        type="button"
        disabled={uploading}
        onClick={() => inputRef.current?.click()}
      >
        <ImagePlus size={17} />
        {uploading ? 'Uploading' : name || label}
      </button>
      <input ref={inputRef} className="hidden" type="file" accept="image/*" onChange={(e) => void pick(e)} />
      {error ? <p className="-mt-2 text-xs text-red-300">{error}</p> : null}
    </>
  )
}

function App() {
  const {
    items,
    platform,
    favoriteMode,
    search,
    sortMode,
    loading,
    error,
    setUid,
    addItem,
    removeItem,
    toggleFavorite,
    updateItem,
    importItems,
    setPlatform,
    setFavoriteMode,
    setSearch,
    setSortMode,
    clearError,
  } = useBoardStore()
  const [activeTag, setActiveTag] = useState<string | null>(null)
  const [activeAuthor, setActiveAuthor] = useState<string | null>(null)
  const [url, setUrl] = useState('')
  const [tagText, setTagText] = useState('')
  const [editingItem, setEditingItem] = useState<BoardItem | null>(null)
  const [isDrawerOpen, setIsDrawerOpen] = useState(false)
  const [user, setUser] = useState<User | null>(null)
  const [authLoading, setAuthLoading] = useState(true)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const thumbnail = useThumbnailPicker()

  useEffect(() => {
    return onAuthStateChanged(auth, (u) => {
      setUser(u)
      void setUid(u?.uid ?? null)
      setAuthLoading(false)
    })
  }, [setUid])

  const visibleItems = useMemo(() => {
    const query = search.trim().toLowerCase()
    return items
      .filter((item) => platform === 'all' || item.platform === platform)
      .filter((item) => favoriteMode === 'all' || item.favorite)
      .filter((item) => !activeTag || item.tags.includes(activeTag))
      .filter((item) => !activeAuthor || item.author === activeAuthor)
      .filter((item) => !query || matchesQuery(item, query))
      .sort(sorters[sortMode])
  }, [activeAuthor, activeTag, favoriteMode, items, platform, search, sortMode])

  const allTags = useMemo(
    () => Array.from(new Set([...presetTags, ...items.flatMap((item) => item.tags)])).sort(),
    [items],
  )

  // 정해진 그룹(종류·프롬프트/튜토리얼)에 속하지 않는 커스텀 태그
  const otherTags = useMemo(
    () => allTags.filter((tag) => !typeTags.includes(tag) && !purposeTags.includes(tag)),
    [allTags],
  )

  // 태그별 게시물 수
  const tagCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const item of items) {
      for (const tag of item.tags) {
        counts.set(tag, (counts.get(tag) ?? 0) + 1)
      }
    }
    return counts
  }, [items])

  // 플랫폼별 게시물 수 ('all'은 전체)
  const platformCounts = useMemo(() => {
    const counts = new Map<'all' | Platform, number>([['all', items.length]])
    for (const item of items) {
      counts.set(item.platform, (counts.get(item.platform) ?? 0) + 1)
    }
    return counts
  }, [items])

  // 필터바 전체에서 한 번에 하나만 활성화합니다.
  // 아무것도 안 걸렸을 때만 'All'이 활성으로 보입니다.
  const noFilter = platform === 'all' && !activeTag && !activeAuthor && favoriteMode === 'all'

  function selectTag(tag: string) {
    if (activeTag === tag) {
      setActiveTag(null)
      return
    }
    setActiveTag(tag)
    setActiveAuthor(null)
    setPlatform('all')
    setFavoriteMode('all')
  }

  function selectPlatform(option: 'all' | Platform) {
    setPlatform(option)
    setActiveTag(null)
    setActiveAuthor(null)
    setFavoriteMode('all')
  }

  function toggleFavorites() {
    if (favoriteMode === 'favorites') {
      setFavoriteMode('all')
      return
    }
    setFavoriteMode('favorites')
    setPlatform('all')
    setActiveTag(null)
    setActiveAuthor(null)
  }

  function selectAuthor(author: string) {
    if (activeAuthor === author) {
      setActiveAuthor(null)
      return
    }
    setActiveAuthor(author)
    setActiveTag(null)
    setPlatform('all')
    setFavoriteMode('all')
  }

  function renderTag(tag: string) {
    return (
      <button
        key={tag}
        type="button"
        className={`filter-tag ${activeTag === tag ? 'filter-tag-active' : ''}`}
        onClick={() => selectTag(tag)}
      >
        #{tag}
        <span className="filter-count">{tagCounts.get(tag) ?? 0}</span>
      </button>
    )
  }

  if (authLoading) return <div className="min-h-screen bg-zinc-950" />
  if (!user) return <LoginScreen />

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    await addItem({ url, tags: parseTags(tagText), imageUrl: thumbnail.imageUrl || undefined })
    if (!useBoardStore.getState().error) {
      setUrl('')
      setTagText('')
      thumbnail.reset()
      setIsDrawerOpen(false)
    }
  }

  function exportJson() {
    const blob = new Blob([JSON.stringify(items, null, 2)], { type: 'application/json' })
    const href = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = href
    anchor.download = `video-reference-board-${new Date().toISOString().slice(0, 10)}.json`
    anchor.click()
    URL.revokeObjectURL(href)
  }

  async function handleImport(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    try {
      const text = await file.text()
      const parsed: unknown = JSON.parse(text)
      await importItems(parsed)
    } catch (err) {
      if (err instanceof SyntaxError) {
        useBoardStore.setState({ error: 'JSON 파일을 읽을 수 없습니다.' })
      }
    } finally {
      event.target.value = ''
    }
  }

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <section className="sticky top-0 z-30 border-b border-white/10 bg-zinc-950/92 backdrop-blur">
        <div className="mx-auto flex max-w-[1880px] flex-col gap-3 px-4 py-3 sm:px-6 lg:px-8">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="order-2 flex flex-wrap items-center gap-x-3 gap-y-2 sm:order-1">
              {/* 좋아요 */}
              <button
                className={`chip ${favoriteMode === 'favorites' ? 'chip-active' : ''}`}
                type="button"
                title="좋아요"
                onClick={toggleFavorites}
              >
                <Heart size={15} fill={favoriteMode === 'favorites' ? 'currentColor' : 'none'} />
              </button>

              {/* 활성 작성자 필터 (카드의 @아이디 클릭 시) */}
              {activeAuthor ? (
                <button
                  className="chip chip-active"
                  type="button"
                  title="작성자 필터 해제"
                  onClick={() => setActiveAuthor(null)}
                >
                  {activeAuthor}
                  <XIcon size={14} />
                </button>
              ) : null}

              {/* 출처: 플랫폼 */}
              <div className="filter-group">
                {platforms.map((option) => {
                  const active = option === 'all' ? noFilter : platform === option
                  return (
                    <button
                      key={option}
                      className={`chip ${active ? 'chip-active' : ''}`}
                      type="button"
                      onClick={() => selectPlatform(option)}
                    >
                      {option === 'all' ? 'All' : getPlatformLabel(option)}
                      <span className="filter-count">{platformCounts.get(option) ?? 0}</span>
                    </button>
                  )
                })}
              </div>

              {/* 종류 */}
              <div className="filter-group">{typeTags.map(renderTag)}</div>

              {/* 프롬프트 / 튜토리얼 */}
              <div className="filter-group">{purposeTags.map(renderTag)}</div>

              {/* 기타 커스텀 태그 */}
              {otherTags.length > 0 ? <div className="filter-group">{otherTags.map(renderTag)}</div> : null}
            </div>
            <div className="order-1 flex flex-wrap items-center gap-2 sm:order-2 sm:shrink-0">
              <div className="input-shell w-full min-h-9 sm:w-52">
                <Search size={16} className="shrink-0 text-zinc-500" />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="검색"
                  className="field text-sm"
                  aria-label="검색"
                />
                {search ? (
                  <button type="button" className="shrink-0 text-zinc-500 hover:text-zinc-200" title="검색어 지우기" onClick={() => setSearch('')}>
                    <XIcon size={15} />
                  </button>
                ) : null}
              </div>
              <select
                className="select"
                value={sortMode}
                onChange={(event) => setSortMode(event.target.value as SortMode)}
                aria-label="정렬"
              >
                {(Object.keys(sortLabels) as SortMode[]).map((mode) => (
                  <option key={mode} value={mode}>
                    {sortLabels[mode]}
                  </option>
                ))}
              </select>
              <button className="chip" type="button" onClick={exportJson}>
                <Download size={15} />
                Export
              </button>
              <button className="chip" type="button" onClick={() => fileInputRef.current?.click()}>
                <Import size={15} />
                Import
              </button>
              <input ref={fileInputRef} className="hidden" type="file" accept="application/json" onChange={handleImport} />
              <button className="add-button" type="button" onClick={() => setIsDrawerOpen(true)}>
                <Plus size={17} />
                Add
              </button>
              <button className="chip ml-auto sm:ml-0" type="button" onClick={() => void signOut(auth)} title={user.email ?? 'Sign out'}>
                <LogOut size={15} />
              </button>
            </div>
          </div>

          {error ? (
            <button className="rounded-md border border-red-400/30 bg-red-950/50 px-3 py-2 text-left text-sm text-red-100" onClick={clearError}>
              {error}
            </button>
          ) : null}
        </div>
      </section>

      <div className={`drawer-overlay ${isDrawerOpen ? 'open' : ''}`} onClick={() => setIsDrawerOpen(false)} />
      <aside className={`drawer ${isDrawerOpen ? 'open' : ''}`} aria-hidden={!isDrawerOpen}>
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
          <h2 className="text-base font-semibold text-white">Add Reference</h2>
          <button className="icon-button h-8 w-8" type="button" onClick={() => setIsDrawerOpen(false)} title="Close">
            <XIcon size={17} />
          </button>
        </div>

        <form className="flex flex-col gap-4 p-5" onSubmit={handleSubmit}>
          <label className="drawer-field">
            <span>URL</span>
            <div className="input-shell">
              <Link size={18} className="text-zinc-500" />
              <input
                required
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder="https://www.instagram.com/reel/..."
                className="field"
              />
            </div>
          </label>

          <label className="drawer-field">
            <span>Tags</span>
            <div className="input-shell">
              <Tag size={18} className="text-zinc-500" />
              <input value={tagText} onChange={(event) => setTagText(event.target.value)} placeholder="real, 3D, 2D" className="field" />
            </div>
          </label>

          <div className="flex flex-wrap gap-2">
            {presetTags.map((tag) => (
              <button key={tag} type="button" className="tag-preset" onClick={() => setTagText((current) => addTagToText(current, tag))}>
                #{tag}
              </button>
            ))}
          </div>

          <ThumbnailField picker={thumbnail} label="Thumbnail" />

          <button className="primary-button mt-2" type="submit" disabled={loading || thumbnail.uploading}>
            {loading ? 'Saving' : 'Save'}
          </button>
        </form>

        <div className="mt-auto border-t border-white/10" />
      </aside>

      <section className="mx-auto max-w-[1880px] px-4 py-6 sm:px-6 lg:px-8">
        {visibleItems.length === 0 ? (
          <EmptyState filtered={items.length > 0} />
        ) : (
          <Masonry breakpointCols={masonryBreakpoints} className="masonry-grid" columnClassName="masonry-column">
            {visibleItems.map((item) => (
              <VideoCard
                key={item.id}
                item={item}
                onFavorite={() => void toggleFavorite(item.id)}
                onRemove={() => void removeItem(item.id)}
                onEdit={() => setEditingItem(item)}
                onSelectAuthor={selectAuthor}
              />
            ))}
          </Masonry>
        )}
      </section>

      {editingItem ? (
        <EditModal
          item={editingItem}
          onClose={() => setEditingItem(null)}
          onSave={async (patch) => {
            await updateItem(editingItem.id, patch)
            setEditingItem(null)
          }}
        />
      ) : null}
    </main>
  )
}

function VideoCard({
  item,
  onFavorite,
  onRemove,
  onEdit,
  onSelectAuthor,
}: {
  item: BoardItem
  onFavorite: () => void
  onRemove: () => void
  onEdit: () => void
  onSelectAuthor: (author: string) => void
}) {

  function openOriginal() {
    window.open(item.url, '_blank', 'noopener,noreferrer')
  }

  return (
    <article className="group mb-5 overflow-hidden rounded-lg border border-white/10 bg-zinc-900 shadow-2xl shadow-black/20">
      <div className="relative">
        <button className="block w-full text-left" type="button" onClick={openOriginal}>
          <div className="relative aspect-[4/5] overflow-hidden bg-zinc-800">
            <img src={item.imageUrl} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]" />
            <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/10 to-transparent" />
          </div>
        </button>

        {/* 좌상단: 출처 + 아이디 (아이디 클릭 시 같은 작성자만 모아보기) */}
        <div className="pointer-events-none absolute left-3 top-3 flex max-w-[calc(100%-24px)] items-center gap-1.5">
          <span className="flex h-6 shrink-0 items-center rounded-md bg-black/70 px-2 text-xs font-medium text-white backdrop-blur">
            {getPlatformLabel(item.platform)}
          </span>
          {item.author.startsWith('@') ? (
            <button
              type="button"
              className="pointer-events-auto flex h-6 min-w-0 items-center rounded-md bg-black/70 px-2 text-xs font-medium text-white backdrop-blur transition hover:bg-black/85"
              title={`${item.author} 모아보기`}
              onClick={() => onSelectAuthor(item.author)}
            >
              <span className="truncate">{item.author}</span>
            </button>
          ) : null}
        </div>

        {/* 하단: 태그 */}
        {item.tags.length > 0 ? (
          <div className="pointer-events-none absolute inset-x-3 bottom-3 flex flex-wrap gap-1.5 transition-opacity duration-150 group-hover:opacity-0">
            {item.tags.map((tag) => (
              <span key={tag} className="rounded-md bg-black/70 px-2 py-0.5 text-[11px] font-medium text-white backdrop-blur">
                #{tag}
              </span>
            ))}
          </div>
        ) : null}
        <div className="card-hover-actions">
          <button className="hover-action-button" type="button" onClick={onEdit} title="Edit">
            <Pencil size={15} />
          </button>
          <button className="hover-action-button" type="button" onClick={onFavorite} title="Favorite">
            <Heart size={16} fill={item.favorite ? 'currentColor' : 'none'} className={item.favorite ? 'text-red-400' : ''} />
          </button>
          <button className="hover-action-button" type="button" onClick={onRemove} title="Delete">
            <Trash2 size={16} />
          </button>
        </div>
      </div>
    </article>
  )
}

function EditModal({
  item,
  onClose,
  onSave,
}: {
  item: BoardItem
  onClose: () => void
  onSave: (patch: Partial<Pick<BoardItem, 'title' | 'author' | 'description' | 'tags' | 'imageUrl'>>) => Promise<void>
}) {
  const [title, setTitle] = useState(item.title)
  const [author, setAuthor] = useState(item.author)
  const [description, setDescription] = useState(item.description)
  const [tagText, setTagText] = useState(item.tags.join(', '))
  const [saving, setSaving] = useState(false)
  const thumbnail = useThumbnailPicker()

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  async function handleSave(event: React.FormEvent) {
    event.preventDefault()
    setSaving(true)
    await onSave({
      title: title.trim() || item.title,
      author: author.trim(),
      description: description.trim(),
      tags: parseTags(tagText),
      ...(thumbnail.imageUrl ? { imageUrl: thumbnail.imageUrl } : {}),
    })
    setSaving(false)
  }

  return (
    <>
      <div className="modal-overlay" onClick={onClose} />
      <div className="modal" role="dialog" aria-modal="true" aria-label="Edit Reference">
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
          <h2 className="text-base font-semibold text-white">Edit Reference</h2>
          <button className="icon-button h-8 w-8" type="button" onClick={onClose} title="Close">
            <XIcon size={17} />
          </button>
        </div>

        <form className="flex flex-col gap-4 overflow-y-auto p-5" onSubmit={handleSave}>
          <label className="drawer-field">
            <span>Title</span>
            <div className="input-shell">
              <input value={title} onChange={(e) => setTitle(e.target.value)} className="field" />
            </div>
          </label>

          <label className="drawer-field">
            <span>Author</span>
            <div className="input-shell">
              <input value={author} onChange={(e) => setAuthor(e.target.value)} className="field" />
            </div>
          </label>

          <label className="drawer-field">
            <span>Description</span>
            <div className="input-shell">
              <input value={description} onChange={(e) => setDescription(e.target.value)} className="field" />
            </div>
          </label>

          <label className="drawer-field">
            <span>Tags</span>
            <div className="input-shell">
              <Tag size={18} className="text-zinc-500" />
              <input value={tagText} onChange={(e) => setTagText(e.target.value)} placeholder="real, 3D, 2D" className="field" />
            </div>
          </label>

          <div className="flex flex-wrap gap-2">
            {presetTags.map((tag) => (
              <button key={tag} type="button" className="tag-preset" onClick={() => setTagText((cur) => addTagToText(cur, tag))}>
                #{tag}
              </button>
            ))}
          </div>

          <ThumbnailField picker={thumbnail} label="Change Thumbnail" />

          <div className="flex gap-2 pt-1">
            <button className="secondary-button flex-1 max-w-none" type="button" onClick={onClose}>
              Cancel
            </button>
            <button className="primary-button flex-1" type="submit" disabled={saving || thumbnail.uploading}>
              {saving ? 'Saving' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </>
  )
}

// filtered=true면 저장된 항목은 있는데 현재 검색·필터에 걸리는 게 없는 상태입니다.
function EmptyState({ filtered }: { filtered: boolean }) {
  return (
    <div className="grid min-h-[52vh] place-items-center rounded-lg border border-dashed border-white/15 bg-zinc-900/40 px-6 text-center">
      <div className="max-w-md">
        <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-lg bg-white text-zinc-950">
          {filtered ? <Search size={22} /> : <Link size={22} />}
        </div>
        <h2 className="text-lg font-semibold text-white">
          {filtered ? 'No matching references' : 'No links saved yet'}
        </h2>
        {filtered ? <p className="mt-1 text-sm text-zinc-400">검색어나 필터를 바꿔 보세요.</p> : null}
      </div>
    </div>
  )
}

export default App

function LoginScreen() {
  async function handleLogin() {
    await signInWithPopup(auth, googleProvider)
  }

  return (
    <main className="grid min-h-screen place-items-center bg-zinc-950">
      <div className="flex flex-col items-center gap-6 text-center">
        <div className="grid h-16 w-16 place-items-center rounded-xl bg-white text-zinc-950">
          <Link size={28} />
        </div>
        <div>
          <h1 className="text-xl font-bold text-white">Video Reference Board</h1>
          <p className="mt-1 text-sm text-zinc-400">레퍼런스를 저장하고 관리하세요</p>
        </div>
        <button
          className="add-button px-6"
          style={{ minHeight: 44, fontSize: 15 }}
          type="button"
          onClick={() => void handleLogin()}
        >
          Google로 시작하기
        </button>
      </div>
    </main>
  )
}
