import { useEffect, useMemo, useRef, useState } from 'react'
import Masonry from 'react-masonry-css'
import {
  Download,
  Heart,
  ImagePlus,
  Import,
  Link,
  ListFilter,
  LogOut,
  MessageSquare,
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
import type { BoardItem, Platform } from './types'
import './index.css'

const platforms: Array<'all' | Platform> = ['all', 'x', 'instagram', 'threads', 'linkedin', 'facebook', 'youtube', 'etc']
const presetTags = ['Prompt', 'Tutorial']
// 필터바 태그 그룹. 나머지는 전부 사용자가 만든 태그로 묶입니다.
const purposeTags = ['Prompt', 'Tutorial']

const masonryBreakpoints = {
  default: 6,
  2040: 5,
  1640: 4,
  1340: 3,
  720: 2,
  460: 1,
}

// 검색어는 작성자·메모·태그에서만 찾습니다.
function matchesQuery(item: BoardItem, query: string) {
  return (
    item.author.toLowerCase().includes(query) ||
    (item.note ?? '').toLowerCase().includes(query) ||
    item.tags.some((tag) => tag.toLowerCase().includes(query))
  )
}

// 보드는 항상 최신순으로 봅니다.
const byNewest = (a: BoardItem, b: BoardItem) => Date.parse(b.savedAt) - Date.parse(a.savedAt)

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

// 클릭하면 Tags 입력창에 태그를 채워 넣는 버튼 묶음입니다.
// label은 두 묶음(프리셋 / 내 태그)이 함께 보일 때만 붙입니다.
// onDelete를 주면 태그마다 삭제(×) 버튼이 붙습니다.
function TagPickRow({
  label,
  tags,
  onPick,
  onDelete,
}: {
  label?: string
  tags: string[]
  onPick: (tag: string) => void
  onDelete?: (tag: string) => void
}) {
  if (tags.length === 0) return null
  return (
    <div className="flex flex-col gap-2">
      {label ? <span className="text-[11px] font-bold text-zinc-500">{label}</span> : null}
      <div className="flex flex-wrap gap-2">
        {tags.map((tag) =>
          onDelete ? (
            // 버튼 중첩은 안 되므로 span으로 감싸고 안에 버튼 두 개를 둡니다.
            // (.tag-preset은 레이어 밖 CSS라 유틸리티로 못 덮으므로 여기선 쓰지 않습니다.)
            <span key={tag} className="inline-flex items-center overflow-hidden rounded-md border border-white/10 bg-white/[0.08]">
              <button
                type="button"
                className="flex min-h-[30px] items-center pr-1.5 pl-2.5 text-xs font-semibold text-zinc-100 transition hover:bg-white/10"
                onClick={() => onPick(tag)}
              >
                #{tag}
              </button>
              <button
                type="button"
                className="flex min-h-[30px] items-center pr-2 pl-0.5 text-zinc-500 transition hover:bg-white/10 hover:text-red-300"
                title={`#${tag} 태그 지우기 (이 태그뿐인 게시물은 함께 삭제)`}
                aria-label={`${tag} 태그 지우기`}
                onClick={() => onDelete(tag)}
              >
                <XIcon size={13} />
              </button>
            </span>
          ) : (
            <button key={tag} type="button" className="tag-preset" onClick={() => onPick(tag)}>
              #{tag}
            </button>
          ),
        )}
      </div>
    </div>
  )
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
    loading,
    error,
    setUid,
    addItem,
    removeItem,
    toggleFavorite,
    updateItem,
    removeTag,
    importItems,
    setPlatform,
    setFavoriteMode,
    clearError,
  } = useBoardStore()
  const [activeTag, setActiveTag] = useState<string | null>(null)
  const [activeAuthor, setActiveAuthor] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [url, setUrl] = useState('')
  const [tagText, setTagText] = useState('')
  const [note, setNote] = useState('')
  const [editingItem, setEditingItem] = useState<BoardItem | null>(null)
  const [isDrawerOpen, setIsDrawerOpen] = useState(false)
  const [isFilterOpen, setIsFilterOpen] = useState(false)
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
      .sort(byNewest)
  }, [activeAuthor, activeTag, favoriteMode, items, platform, search])

  const allTags = useMemo(
    () => Array.from(new Set([...presetTags, ...items.flatMap((item) => item.tags)])).sort(),
    [items],
  )

  // 정해진 그룹(프롬프트/튜토리얼)에 속하지 않는 커스텀 태그
  const otherTags = useMemo(() => allTags.filter((tag) => !purposeTags.includes(tag)), [allTags])

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
    setIsFilterOpen(false)
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
    setIsFilterOpen(false)
    setPlatform(option)
    setActiveTag(null)
    setActiveAuthor(null)
    setFavoriteMode('all')
  }

  function toggleFavorites() {
    setIsFilterOpen(false)
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

  function pickTag(tag: string) {
    setTagText((current) => addTagToText(current, tag))
  }

  // 커스텀 태그 삭제. 다른 태그가 남는 게시물은 태그만 떼고,
  // 이 태그뿐이라 남는 태그가 없는 게시물은 함께 삭제합니다.
  // 되돌릴 수 없으므로 두 개수를 나눠 보여주고 확인받습니다.
  async function deleteTag(tag: string) {
    const affected = items.filter((item) => item.tags.includes(tag))
    if (affected.length === 0) return
    const deleted = affected.filter((item) => item.tags.length === 1).length
    const kept = affected.length - deleted
    const message = [
      `#${tag} 태그를 지웁니다.`,
      '',
      `· 태그만 떼기: ${kept}개 (다른 태그가 남아 있음)`,
      `· 게시물 삭제: ${deleted}개 (남는 태그가 없음)`,
      '',
      '삭제한 게시물은 되돌릴 수 없습니다. 계속할까요?',
    ].join('\n')
    if (!window.confirm(message)) return
    if (activeTag === tag) setActiveTag(null)
    setTagText((current) => parseTags(current).filter((t) => t !== tag).join(', '))
    await removeTag(tag)
  }

  function renderTag(tag: string) {
    return (
      <button
        key={tag}
        type="button"
        className={`sidebar-row ${activeTag === tag ? 'sidebar-row-active' : ''}`}
        onClick={() => selectTag(tag)}
      >
        <span className="sidebar-row-label">#{tag}</span>
        <span className="filter-count">{tagCounts.get(tag) ?? 0}</span>
      </button>
    )
  }

  if (authLoading) return <div className="min-h-screen bg-zinc-950" />
  if (!user) return <LoginScreen />

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    await addItem({ url, tags: parseTags(tagText), note, imageUrl: thumbnail.imageUrl || undefined })
    if (!useBoardStore.getState().error) {
      setUrl('')
      setTagText('')
      setNote('')
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
      <div className="lg:flex">
        {/* 모바일에서 필터 시트를 열었을 때 뒤를 덮습니다. */}
        <div
          className={`drawer-overlay hide-at-lg ${isFilterOpen ? 'open' : ''}`}
          onClick={() => setIsFilterOpen(false)}
        />

        {/* 필터 사이드바. lg 이상에서는 왼쪽에 고정되고, 그 아래에서는 오프캔버스로 열립니다. */}
        <aside className={`sidebar ${isFilterOpen ? 'open' : ''}`} aria-label="필터">
          <div className="flex items-center justify-between border-b border-white/10 px-4 py-3 lg:hidden">
            <h2 className="text-sm font-semibold text-white">필터</h2>
            <button className="icon-button h-8 w-8" type="button" onClick={() => setIsFilterOpen(false)} title="닫기">
              <XIcon size={16} />
            </button>
          </div>

          <div className="sidebar-scroll">
            {/* 검색은 아래 필터와 겹쳐 걸립니다(둘 다 만족하는 카드만 보임). */}
            <div className="input-shell mb-2 min-h-9 shrink-0">
              <Search size={16} className="shrink-0 text-zinc-500" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="작성자·메모·태그 검색"
                className="field text-sm"
                aria-label="검색"
              />
              {search ? (
                <button type="button" className="shrink-0 text-zinc-500 hover:text-zinc-200" title="검색어 지우기" onClick={() => setSearch('')}>
                  <XIcon size={15} />
                </button>
              ) : null}
            </div>

            {/* 좋아요 */}
            <button
              className={`sidebar-row ${favoriteMode === 'favorites' ? 'sidebar-row-active' : ''}`}
              type="button"
              onClick={toggleFavorites}
            >
              <Heart size={15} fill={favoriteMode === 'favorites' ? 'currentColor' : 'none'} />
              <span className="sidebar-row-label">좋아요</span>
            </button>

            {/* 활성 작성자 필터 (카드의 @아이디 클릭 시) */}
            {activeAuthor ? (
              <button
                className="sidebar-row sidebar-row-active"
                type="button"
                title="작성자 필터 해제"
                onClick={() => setActiveAuthor(null)}
              >
                <span className="sidebar-row-label">{activeAuthor}</span>
                <XIcon size={14} />
              </button>
            ) : null}

            {/* 출처: 플랫폼 */}
            <p className="sidebar-section">출처</p>
            {platforms.map((option) => {
              const active = option === 'all' ? noFilter : platform === option
              return (
                <button
                  key={option}
                  className={`sidebar-row ${active ? 'sidebar-row-active' : ''}`}
                  type="button"
                  onClick={() => selectPlatform(option)}
                >
                  <span className="sidebar-row-label">{option === 'all' ? 'All' : getPlatformLabel(option)}</span>
                  <span className="filter-count">{platformCounts.get(option) ?? 0}</span>
                </button>
              )
            })}

            {/* 프롬프트 / 튜토리얼 */}
            <p className="sidebar-section">프롬프트 / 튜토리얼</p>
            {purposeTags.map(renderTag)}

            {/* 기타 커스텀 태그 */}
            {otherTags.length > 0 ? (
              <>
                <p className="sidebar-section">내 태그</p>
                {otherTags.map(renderTag)}
              </>
            ) : null}
          </div>
        </aside>

        <div className="min-w-0 flex-1">
          <section className="sticky top-0 z-30 border-b border-white/10 bg-zinc-950/92 backdrop-blur">
            <div className="mx-auto flex max-w-[1880px] flex-col gap-3 px-4 py-3 sm:px-6 lg:px-8">
              <div className="flex flex-wrap items-center gap-2">
                {/* 사이드바가 접히는 폭에서만 보이는 토글. 필터나 검색어가 걸려 있으면 강조합니다. */}
                <button
                  className={`chip hide-at-lg ${noFilter && !search.trim() ? '' : 'chip-active'}`}
                  type="button"
                  onClick={() => setIsFilterOpen(true)}
                >
                  <ListFilter size={15} />
                  필터
                </button>

                <div className="ml-auto flex flex-wrap items-center gap-2">
                  {/* 좁은 폭에서는 라벨을 숨기고 아이콘만 남깁니다. */}
                  <button className="chip" type="button" onClick={exportJson} title="Export">
                    <Download size={15} />
                    <span className="hidden sm:inline">Export</span>
                  </button>
                  <button className="chip" type="button" onClick={() => fileInputRef.current?.click()} title="Import">
                    <Import size={15} />
                    <span className="hidden sm:inline">Import</span>
                  </button>
                  <input ref={fileInputRef} className="hidden" type="file" accept="application/json" onChange={handleImport} />
                  <button className="add-button" type="button" onClick={() => setIsDrawerOpen(true)}>
                    <Plus size={17} />
                    Add
                  </button>
                  <button className="chip" type="button" onClick={() => void signOut(auth)} title={user.email ?? 'Sign out'}>
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
        </div>
      </div>

      <div className={`drawer-overlay ${isDrawerOpen ? 'open' : ''}`} onClick={() => setIsDrawerOpen(false)} />
      <aside className={`drawer ${isDrawerOpen ? 'open' : ''}`} aria-hidden={!isDrawerOpen}>
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
          <h2 className="text-base font-semibold text-white">Add Reference</h2>
          <button className="icon-button h-8 w-8" type="button" onClick={() => setIsDrawerOpen(false)} title="Close">
            <XIcon size={17} />
          </button>
        </div>

        <form className="flex flex-col gap-4 overflow-y-auto p-5" onSubmit={handleSubmit}>
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

          <label className="drawer-field">
            <span>Note</span>
            <div className="input-shell">
              <MessageSquare size={18} className="text-zinc-500" />
              <input
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="카드에 마우스를 올리면 보일 메모"
                className="field"
              />
            </div>
          </label>

          {/* 프리셋 + 보드에서 이미 쓰고 있는 커스텀 태그. 새 태그는 위 입력창에 직접 적습니다. */}
          <div className="flex flex-col gap-3">
            <TagPickRow label={otherTags.length > 0 ? '프리셋' : undefined} tags={presetTags} onPick={pickTag} />
            <TagPickRow label="내 태그" tags={otherTags} onPick={pickTag} onDelete={(tag) => void deleteTag(tag)} />
          </div>

          <ThumbnailField picker={thumbnail} label="Thumbnail" />

          <button className="primary-button mt-2" type="submit" disabled={loading || thumbnail.uploading}>
            {loading ? 'Saving' : 'Save'}
          </button>
        </form>

        <div className="mt-auto border-t border-white/10" />
      </aside>

      {editingItem ? (
        <EditModal
          item={editingItem}
          onClose={() => setEditingItem(null)}
          onSave={async (patch) => {
            await updateItem(editingItem.id, patch)
            // URL이 잘못됐거나 중복이면 에러만 남고 저장은 안 됩니다. 그때는 닫지 않습니다.
            if (!useBoardStore.getState().error) setEditingItem(null)
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
        {/* 호버했을 때만 뜨는 메모. 아래쪽 액션 버튼 위에 자리를 잡습니다. */}
        {item.note ? (
          <div className="card-note">
            <p>{item.note}</p>
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
  onSave: (patch: Partial<Pick<BoardItem, 'url' | 'author' | 'tags' | 'note' | 'imageUrl'>>) => Promise<void>
}) {
  const [url, setUrl] = useState(item.url)
  const [author, setAuthor] = useState(item.author)
  const [note, setNote] = useState(item.note ?? '')
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
      url: url.trim() || item.url,
      author: author.trim(),
      note: note.trim(),
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
            <span>URL</span>
            <div className="input-shell">
              <Link size={18} className="text-zinc-500" />
              <input value={url} onChange={(e) => setUrl(e.target.value)} className="field" />
            </div>
          </label>

          <label className="drawer-field">
            <span>Author</span>
            <div className="input-shell">
              <input value={author} onChange={(e) => setAuthor(e.target.value)} className="field" />
            </div>
          </label>

          <label className="drawer-field">
            <span>Note</span>
            <div className="input-shell">
              <MessageSquare size={18} className="text-zinc-500" />
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="카드에 마우스를 올리면 보일 메모"
                className="field"
              />
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

// filtered=true면 저장된 항목은 있는데 현재 필터에 걸리는 게 없는 상태입니다.
function EmptyState({ filtered }: { filtered: boolean }) {
  return (
    <div className="grid min-h-[52vh] place-items-center rounded-lg border border-dashed border-white/15 bg-zinc-900/40 px-6 text-center">
      <div className="max-w-md">
        <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-lg bg-white text-zinc-950">
          {filtered ? <ListFilter size={22} /> : <Link size={22} />}
        </div>
        <h2 className="text-lg font-semibold text-white">
          {filtered ? 'No matching references' : 'No links saved yet'}
        </h2>
        {filtered ? <p className="mt-1 text-sm text-zinc-400">검색어를 바꾸거나 왼쪽에서 다른 필터를 골라 보세요.</p> : null}
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
