import type { BoardItem, NewItemInput, Platform } from './types'

// 'etc'는 아래 어느 도메인에도 해당하지 않는 일반 사이트입니다.
const PLATFORM_HOSTS: Record<Exclude<Platform, 'etc'>, string[]> = {
  x: ['x.com', 'twitter.com'],
  instagram: ['instagram.com', 'www.instagram.com'],
  // Threads는 threads.com으로 옮겨갔습니다. 예전에 저장한 링크를 위해 .net도 남겨둡니다.
  threads: ['threads.com', 'www.threads.com', 'threads.net', 'www.threads.net'],
  linkedin: ['linkedin.com', 'www.linkedin.com'],
  facebook: ['facebook.com', 'www.facebook.com', 'm.facebook.com', 'fb.watch', 'fb.com'],
  youtube: ['youtube.com', 'youtu.be', 'youtube-nocookie.com'],
}

const PLATFORM_LABELS: Record<Platform, string> = {
  x: 'X',
  instagram: 'Instagram',
  threads: 'Threads',
  linkedin: 'LinkedIn',
  facebook: 'Facebook',
  youtube: 'YouTube',
  etc: 'ETC',
}

const FALLBACK_IMAGES: Record<Exclude<Platform, 'youtube' | 'etc'>, string> = {
  x: 'https://images.unsplash.com/photo-1611162618071-b39a2ec055fb?auto=format&fit=crop&w=1200&q=80',
  instagram: 'https://images.unsplash.com/photo-1611262588024-d12430b98920?auto=format&fit=crop&w=1200&q=80',
  threads: 'https://images.unsplash.com/photo-1557804506-669a67965ba0?auto=format&fit=crop&w=1200&q=80',
  linkedin: 'https://images.unsplash.com/photo-1556761175-b413da4baf72?auto=format&fit=crop&w=1200&q=80',
  facebook: 'https://images.unsplash.com/photo-1633675254053-d96c7668c3b8?auto=format&fit=crop&w=1200&q=80',
}

// 외부 메타데이터 조회가 늦어도 저장이 멈춰 있지 않게 끊는 시간입니다.
const FETCH_TIMEOUT_MS = 8000

type FetchedMetadata = {
  title?: string
  author_name?: string
  thumbnail_url?: string
}

export function detectPlatform(input: string): Platform {
  const url = new URL(input)
  const host = url.hostname.toLowerCase().replace(/^www\./, '')
  // m.instagram.com, mobile.twitter.com 같은 하위 도메인도 같은 플랫폼으로 봅니다.
  const platform = (Object.keys(PLATFORM_HOSTS) as Array<keyof typeof PLATFORM_HOSTS>).find((key) =>
    PLATFORM_HOSTS[key].some((candidate) => {
      const base = candidate.replace(/^www\./, '')
      return host === base || host.endsWith(`.${base}`)
    }),
  )

  return platform ?? 'etc'
}

export async function createBoardItem(input: NewItemInput): Promise<BoardItem> {
  const normalizedUrl = normalizeUrl(input.url)
  const platform = detectPlatform(normalizedUrl)
  const fallback = getFallbackMetadata(normalizedUrl, platform)
  const embedded = await tryFetchMetadata(normalizedUrl, platform)

  return {
    id: crypto.randomUUID(),
    url: normalizedUrl,
    platform,
    title: embedded?.title || fallback.title,
    // URL에서 아이디(@handle)를 뽑을 수 있으면 그걸 우선합니다.
    // (X oEmbed는 아이디가 아닌 표시 이름을 주므로 아이디가 있으면 그게 낫습니다.)
    author: fallback.author.startsWith('@') ? fallback.author : embedded?.author_name || fallback.author,
    imageUrl: input.imageUrl || embedded?.thumbnail_url || fallback.imageUrl,
    tags: input.tags,
    note: input.note?.trim() || '',
    favorite: false,
    savedAt: new Date().toISOString(),
  }
}

export function getPlatformLabel(platform: Platform): string {
  return PLATFORM_LABELS[platform]
}

// URL에서 아이디(@handle)를 추출합니다. 뽑을 수 없으면 빈 문자열을 반환합니다.
export function deriveHandle(url: string): string {
  try {
    const parsed = new URL(url)
    const platform = detectPlatform(url)
    const segments = parsed.pathname.split('/').filter(Boolean)
    const author = getAuthor(platform, segments, parsed.hostname)
    return author.startsWith('@') ? author : ''
  } catch {
    return ''
  }
}

export function normalizeUrl(input: string): string {
  const trimmed = input.trim()
  const url = new URL(trimmed.startsWith('http') ? trimmed : `https://${trimmed}`)
  return url.toString()
}

async function tryFetchMetadata(url: string, platform: Platform): Promise<FetchedMetadata | null> {
  if (platform === 'etc') return tryFetchSiteMetadata(url)

  const endpoint = getOEmbedEndpoint(url, platform)
  if (!endpoint) return null
  return fetchJson<FetchedMetadata>(endpoint)
}

function getOEmbedEndpoint(url: string, platform: Platform): string | null {
  if (platform === 'x') {
    return `https://publish.twitter.com/oembed?omit_script=true&dnt=true&url=${encodeURIComponent(url)}`
  }
  if (platform === 'youtube') {
    return `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}`
  }

  return null
}

type MicrolinkResponse = {
  status?: string
  data?: {
    title?: string | null
    author?: string | null
    publisher?: string | null
    image?: { url?: string } | null
  }
}

// 일반 사이트의 og:title / og:image는 서버를 거쳐야 읽을 수 있어(CORS) microlink 공개 API를 씁니다.
// 키 없이 쓰는 무료 한도(하루 50회)를 넘기면 실패하고, 그때는 스크린샷으로 대신합니다.
async function tryFetchSiteMetadata(url: string): Promise<FetchedMetadata | null> {
  const json = await fetchJson<MicrolinkResponse>(`https://api.microlink.io/?url=${encodeURIComponent(url)}`)
  if (json?.status !== 'success' || !json.data) return null
  const { title, author, publisher, image } = json.data
  return {
    title: title || undefined,
    author_name: author || publisher || undefined,
    thumbnail_url: image?.url && /^https?:/.test(image.url) ? image.url : undefined,
  }
}

async function fetchJson<T>(endpoint: string): Promise<T | null> {
  try {
    const response = await fetch(endpoint, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
    if (!response.ok) return null
    return (await response.json()) as T
  } catch {
    return null
  }
}

function getFallbackMetadata(url: string, platform: Platform) {
  const parsed = new URL(url)
  const segments = parsed.pathname.split('/').filter(Boolean)
  const author = getAuthor(platform, segments, parsed.hostname)

  if (platform === 'etc') {
    return { title: parsed.hostname.replace(/^www\./, ''), author, imageUrl: getScreenshotUrl(url) }
  }

  if (platform === 'youtube') {
    const videoId = getYouTubeVideoId(parsed)
    return {
      title: `${PLATFORM_LABELS[platform]} Video Reference`,
      author,
      // 메타데이터 조회가 실패해도 영상 ID만 있으면 섬네일은 정해진 주소로 받을 수 있습니다.
      imageUrl: videoId ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : getScreenshotUrl(url),
    }
  }

  return {
    title: `${PLATFORM_LABELS[platform]} Video Reference`,
    author,
    imageUrl: FALLBACK_IMAGES[platform],
  }
}

// og:image가 없는 사이트는 페이지 스크린샷을 섬네일로 씁니다.
function getScreenshotUrl(url: string): string {
  return `https://image.thum.io/get/width/1200/crop/750/${url}`
}

function getYouTubeVideoId(url: URL): string | null {
  const segments = url.pathname.split('/').filter(Boolean)
  const id = url.hostname.endsWith('youtu.be')
    ? segments[0]
    : (url.searchParams.get('v') ?? (['shorts', 'embed', 'live', 'v'].includes(segments[0]) ? segments[1] : undefined))
  return id && /^[\w-]{6,}$/.test(id) ? id : null
}

// URL 경로에서 아이디로 볼 수 없는 세그먼트(게시물 타입/특수 경로)
const NON_HANDLE_SEGMENTS = ['reel', 'reels', 'p', 'tv', 'status', 'watch', 'share', 'stories', 'i', 'intent', 'home', 'posts', 'feed']

function getAuthor(platform: Platform, segments: string[], hostname: string): string {
  const first = segments[0]?.replace(/^@/, '')
  const fallback = hostname.replace(/^www\./, '')
  if (!first || NON_HANDLE_SEGMENTS.includes(first.toLowerCase())) return fallback

  // X / Instagram / Threads는 첫 경로 세그먼트가 사용자 아이디인 경우가 많습니다.
  if (platform === 'x' || platform === 'instagram' || platform === 'threads') {
    return `@${first}`
  }
  // YouTube는 채널 주소(youtube.com/@handle)일 때만 아이디로 봅니다.
  if (platform === 'youtube' && segments[0].startsWith('@')) {
    return segments[0]
  }
  return fallback
}
