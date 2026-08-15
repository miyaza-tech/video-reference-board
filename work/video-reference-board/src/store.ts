import { create } from 'zustand'
import {
  collection,
  doc,
  getDocs,
  setDoc,
  deleteDoc,
  updateDoc,
} from 'firebase/firestore/lite'
import { ref, uploadString, getDownloadURL } from 'firebase/storage'
import { firestore, storage } from './firebase'
import { createBoardItem, deriveHandle, normalizeUrl } from './metadata'
import type { BoardItem, EmbedKind, FavoriteMode, NewItemInput, Platform, SortMode } from './types'

const VALID_PLATFORMS: Platform[] = ['x', 'instagram', 'threads', 'linkedin', 'facebook']
const VALID_EMBED_KINDS: EmbedKind[] = ['iframe', 'none']

function validateAndSanitize(raw: unknown): BoardItem[] {
  if (!Array.isArray(raw)) throw new Error('유효하지 않은 파일입니다.')
  return raw.map((item: unknown, i: number) => {
    if (typeof item !== 'object' || item === null) throw new Error(`항목 ${i + 1}: 올바르지 않은 형식입니다.`)
    const r = item as Record<string, unknown>
    if (typeof r.id !== 'string' || !r.id) throw new Error(`항목 ${i + 1}: id가 올바르지 않습니다.`)
    if (typeof r.url !== 'string' || !r.url) throw new Error(`항목 ${i + 1}: url이 올바르지 않습니다.`)
    if (!VALID_PLATFORMS.includes(r.platform as Platform)) throw new Error(`항목 ${i + 1}: 지원하지 않는 플랫폼입니다.`)
    if (typeof r.title !== 'string') throw new Error(`항목 ${i + 1}: title이 올바르지 않습니다.`)
    if (typeof r.savedAt !== 'string') throw new Error(`항목 ${i + 1}: savedAt이 올바르지 않습니다.`)
    const embedKind = VALID_EMBED_KINDS.includes(r.embedKind as EmbedKind) ? (r.embedKind as EmbedKind) : 'none'
    // embedHtml은 외부 JSON에서 XSS가 유입될 수 있으므로 제거합니다.
    return {
      id: r.id as string,
      url: r.url as string,
      platform: r.platform as Platform,
      title: r.title as string,
      description: typeof r.description === 'string' ? r.description : '',
      author: typeof r.author === 'string' ? r.author : '',
      imageUrl: typeof r.imageUrl === 'string' ? r.imageUrl : '',
      embedKind,
      tags: Array.isArray(r.tags) ? (r.tags as unknown[]).filter((t): t is string => typeof t === 'string') : [],
      favorite: r.favorite === true,
      savedAt: r.savedAt as string,
    } satisfies BoardItem
  })
}

const MAX_IMAGE_BYTES = 1_000_000

function dataUrlByteLength(dataUrl: string): number {
  const base64 = dataUrl.split(',')[1] ?? ''
  return Math.floor((base64.length * 3) / 4)
}

// base64 데이터 URL이면 Storage에 업로드하고 다운로드 URL로 교체합니다.
// 이미 http(s) URL이면 그대로 둡니다.
async function moveImageToStorage(uid: string, item: BoardItem): Promise<BoardItem> {
  if (!item.imageUrl.startsWith('data:image')) {
    return item
  }
  try {
    const storageRef = ref(storage, `users/${uid}/thumbnails/${item.id}`)
    await uploadString(storageRef, item.imageUrl, 'data_url')
    const url = await getDownloadURL(storageRef)
    return { ...item, imageUrl: url }
  } catch {
    // 업로드 실패 시 큰 base64는 버리고(1MB 초과 방지) 항목은 저장합니다.
    return { ...item, imageUrl: dataUrlByteLength(item.imageUrl) > MAX_IMAGE_BYTES ? '' : item.imageUrl }
  }
}

// Firestore에 base64로 저장된 오래된 이미지를 Storage로 옮겨 문서 크기를 줄입니다.
// 한 번 실행되면 이후 로딩 속도가 크게 개선됩니다.
async function migrateLegacyImages(
  uid: string,
  items: BoardItem[],
  set: (partial: Partial<BoardState>) => void,
  get: () => BoardState,
): Promise<void> {
  const legacy = items.filter((item) => item.imageUrl.startsWith('data:image'))
  if (legacy.length === 0) return
  for (const item of legacy) {
    const migrated = await moveImageToStorage(uid, item)
    if (migrated.imageUrl === item.imageUrl) continue
    try {
      await updateDoc(itemDoc(uid, item.id), { imageUrl: migrated.imageUrl })
      set({ items: get().items.map((it) => (it.id === item.id ? { ...it, imageUrl: migrated.imageUrl } : it)) })
    } catch {
      // 개별 항목 실패는 무시하고 계속 진행합니다.
    }
  }
}

// 일회성 태그 이름 변경. [기존 이름, 새 이름] 쌍을 나열합니다.
// 모든 항목이 새 이름으로 옮겨지면 이 마이그레이션은 자동으로 아무 일도 하지 않습니다.
const TAG_RENAMES: Array<[string, string]> = [
  ['etc', 'Tutorial'],
  ['튜토리얼', 'Tutorial'],
]

async function migrateTagNames(
  uid: string,
  items: BoardItem[],
  set: (partial: Partial<BoardState>) => void,
  get: () => BoardState,
): Promise<void> {
  const affected = items.filter((item) => TAG_RENAMES.some(([from]) => item.tags.includes(from)))
  if (affected.length === 0) return
  for (const item of affected) {
    let tags = item.tags
    for (const [from, to] of TAG_RENAMES) {
      if (tags.includes(from)) tags = tags.map((t) => (t === from ? to : t))
    }
    // 이미 새 이름이 있던 항목의 중복 태그를 제거합니다.
    tags = Array.from(new Set(tags))
    try {
      await updateDoc(itemDoc(uid, item.id), { tags })
      set({ items: get().items.map((it) => (it.id === item.id ? { ...it, tags } : it)) })
    } catch {
      // 개별 항목 실패는 무시하고 계속 진행합니다.
    }
  }
}

// 기존 항목의 author를 URL 기준 아이디(@handle)로 채웁니다.
// 이미 아이디(@로 시작)인 항목은 건드리지 않습니다.
async function migrateAuthors(
  uid: string,
  items: BoardItem[],
  set: (partial: Partial<BoardState>) => void,
  get: () => BoardState,
): Promise<void> {
  const targets = items
    .filter((item) => !item.author.startsWith('@'))
    .map((item) => ({ item, handle: deriveHandle(item.url) }))
    .filter((t) => t.handle !== '')
  if (targets.length === 0) return
  for (const { item, handle } of targets) {
    try {
      await updateDoc(itemDoc(uid, item.id), { author: handle })
      set({ items: get().items.map((it) => (it.id === item.id ? { ...it, author: handle } : it)) })
    } catch {
      // 개별 항목 실패는 무시하고 계속 진행합니다.
    }
  }
}

interface BoardState {
  uid: string | null
  items: BoardItem[]
  search: string
  platform: 'all' | Platform
  favoriteMode: FavoriteMode
  sortMode: SortMode
  loading: boolean
  error: string
  setUid: (uid: string | null) => Promise<void>
  load: () => Promise<void>
  addItem: (input: NewItemInput) => Promise<void>
  removeItem: (id: string) => Promise<void>
  toggleFavorite: (id: string) => Promise<void>
  updateTags: (id: string, tags: string[]) => Promise<void>
  updateThumbnail: (id: string, imageUrl: string) => Promise<void>
  updateItem: (id: string, patch: Partial<Pick<BoardItem, 'title' | 'author' | 'description' | 'tags' | 'imageUrl'>>) => Promise<void>
  importItems: (raw: unknown) => Promise<void>
  setSearch: (search: string) => void
  setPlatform: (platform: 'all' | Platform) => void
  setFavoriteMode: (mode: FavoriteMode) => void
  setSortMode: (mode: SortMode) => void
  clearError: () => void
}

function itemsCol(uid: string) {
  return collection(firestore, 'users', uid, 'items')
}

function itemDoc(uid: string, id: string) {
  return doc(firestore, 'users', uid, 'items', id)
}

export const useBoardStore = create<BoardState>((set, get) => ({
  uid: null,
  items: [],
  search: '',
  platform: 'all',
  favoriteMode: 'all',
  sortMode: 'newest',
  loading: false,
  error: '',
  setUid: async (uid) => {
    set({ uid, items: [] })
    if (!uid) return
    const snap = await getDocs(itemsCol(uid))
    const items = snap.docs.map((d) => d.data() as BoardItem)
    set({ items })
    void migrateLegacyImages(uid, items, set, get)
    void migrateTagNames(uid, items, set, get)
    void migrateAuthors(uid, items, set, get)
  },
  load: async () => {
    const { uid } = get()
    if (!uid) return
    const snap = await getDocs(itemsCol(uid))
    const items = snap.docs.map((d) => d.data() as BoardItem)
    set({ items })
    void migrateLegacyImages(uid, items, set, get)
    void migrateTagNames(uid, items, set, get)
    void migrateAuthors(uid, items, set, get)
  },
  addItem: async (input) => {
    const { uid } = get()
    if (!uid) return
    set({ loading: true, error: '' })
    try {
      const normalizedUrl = normalizeUrl(input.url)
      const existing = get().items.find((item) => item.url === normalizedUrl)
      if (existing) {
        throw new Error('이미 저장된 URL입니다.')
      }
      const item = await createBoardItem(input)
      await setDoc(itemDoc(uid, item.id), item)
      set({ items: [item, ...get().items], loading: false })
    } catch (error) {
      set({ error: error instanceof Error ? error.message : '저장하지 못했습니다.', loading: false })
    }
  },
  removeItem: async (id) => {
    const { uid } = get()
    if (!uid) return
    await deleteDoc(itemDoc(uid, id))
    set({ items: get().items.filter((item) => item.id !== id) })
  },
  toggleFavorite: async (id) => {
    const { uid } = get()
    if (!uid) return
    const item = get().items.find((candidate) => candidate.id === id)
    if (!item) return
    const favorite = !item.favorite
    await updateDoc(itemDoc(uid, id), { favorite })
    set({ items: get().items.map((candidate) => (candidate.id === id ? { ...candidate, favorite } : candidate)) })
  },
  updateTags: async (id, tags) => {
    const { uid } = get()
    if (!uid) return
    await updateDoc(itemDoc(uid, id), { tags })
    set({ items: get().items.map((item) => (item.id === id ? { ...item, tags } : item)) })
  },
  updateThumbnail: async (id, imageUrl) => {
    const { uid } = get()
    if (!uid) return
    await updateDoc(itemDoc(uid, id), { imageUrl })
    set({ items: get().items.map((item) => (item.id === id ? { ...item, imageUrl } : item)) })
  },
  updateItem: async (id, patch) => {
    const { uid } = get()
    if (!uid) return
    await updateDoc(itemDoc(uid, id), patch)
    set({ items: get().items.map((item) => (item.id === id ? { ...item, ...patch } : item)) })
  },
  importItems: async (raw) => {
    const { uid } = get()
    if (!uid) return
    set({ loading: true, error: '' })
    try {
      const items = validateAndSanitize(raw)
      // base64 섬네일은 Storage로 업로드하고 URL만 Firestore에 저장합니다.
      const prepared = await Promise.all(items.map((item) => moveImageToStorage(uid, item)))
      const chunkSize = 20
      let failed = 0
      for (let i = 0; i < prepared.length; i += chunkSize) {
        const chunk = prepared.slice(i, i + chunkSize)
        // 한 항목이 실패해도 나머지는 계속 저장합니다.
        const results = await Promise.allSettled(chunk.map((item) => setDoc(itemDoc(uid, item.id), item)))
        failed += results.filter((r) => r.status === 'rejected').length
      }
      await get().load()
      set({ loading: false, error: failed > 0 ? `${failed}개 항목을 저장하지 못했습니다.` : '' })
    } catch (err) {
      set({ error: err instanceof Error ? err.message : '가져오기에 실패했습니다.', loading: false })
    }
  },
  setSearch: (search) => set({ search }),
  setPlatform: (platform) => set({ platform }),
  setFavoriteMode: (favoriteMode) => set({ favoriteMode }),
  setSortMode: (sortMode) => set({ sortMode }),
  clearError: () => set({ error: '' }),
}))
