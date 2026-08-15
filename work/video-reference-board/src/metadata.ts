import type { BoardItem, NewItemInput, Platform } from './types'

const PLATFORM_HOSTS: Record<Platform, string[]> = {
  x: ['x.com', 'twitter.com'],
  instagram: ['instagram.com', 'www.instagram.com'],
  threads: ['threads.net', 'www.threads.net'],
  linkedin: ['linkedin.com', 'www.linkedin.com'],
  facebook: ['facebook.com', 'www.facebook.com', 'm.facebook.com', 'fb.watch', 'fb.com'],
}

const PLATFORM_LABELS: Record<Platform, string> = {
  x: 'X',
  instagram: 'Instagram',
  threads: 'Threads',
  linkedin: 'LinkedIn',
  facebook: 'Facebook',
}

const FALLBACK_IMAGES: Record<Platform, string> = {
  x: 'https://images.unsplash.com/photo-1611162618071-b39a2ec055fb?auto=format&fit=crop&w=1200&q=80',
  instagram: 'https://images.unsplash.com/photo-1611262588024-d12430b98920?auto=format&fit=crop&w=1200&q=80',
  threads: 'https://images.unsplash.com/photo-1557804506-669a67965ba0?auto=format&fit=crop&w=1200&q=80',
  linkedin: 'https://images.unsplash.com/photo-1556761175-b413da4baf72?auto=format&fit=crop&w=1200&q=80',
  facebook: 'https://images.unsplash.com/photo-1633675254053-d96c7668c3b8?auto=format&fit=crop&w=1200&q=80',
}

type OEmbedResponse = {
  title?: string
  author_name?: string
  provider_name?: string
  thumbnail_url?: string
  html?: string
}

export function detectPlatform(input: string): Platform {
  const url = new URL(input)
  const host = url.hostname.toLowerCase().replace(/^www\./, '')
  const platform = (Object.keys(PLATFORM_HOSTS) as Platform[]).find((key) =>
    PLATFORM_HOSTS[key].some((candidate) => host === candidate.replace(/^www\./, '')),
  )

  if (!platform) {
    throw new Error('지원하는 URL은 X, Instagram, Threads, LinkedIn, Facebook입니다.')
  }

  return platform
}

export async function createBoardItem(input: NewItemInput): Promise<BoardItem> {
  const normalizedUrl = normalizeUrl(input.url)
  const platform = detectPlatform(normalizedUrl)
  const fallback = getFallbackMetadata(normalizedUrl, platform)
  const embedded = await tryFetchOEmbed(normalizedUrl, platform)

  return {
    id: crypto.randomUUID(),
    url: normalizedUrl,
    platform,
    title: embedded?.title || fallback.title,
    description: fallback.description,
    // URL에서 아이디(@handle)를 뽑을 수 있으면 그걸 우선합니다.
    // (X oEmbed는 아이디가 아닌 표시 이름을 주므로 아이디가 있으면 그게 낫습니다.)
    author: fallback.author.startsWith('@') ? fallback.author : embedded?.author_name || fallback.author,
    imageUrl: input.imageUrl || embedded?.thumbnail_url || fallback.imageUrl,
    ...(embedded?.html ? { embedHtml: embedded.html } : {}),
    embedKind: embedded?.html ? 'iframe' : 'none',
    tags: input.tags,
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

async function tryFetchOEmbed(url: string, platform: Platform): Promise<OEmbedResponse | null> {
  const endpoint = getOEmbedEndpoint(url, platform)
  if (!endpoint) return null

  try {
    const response = await fetch(endpoint)
    if (!response.ok) return null
    return (await response.json()) as OEmbedResponse
  } catch {
    return null
  }
}

function getOEmbedEndpoint(url: string, platform: Platform): string | null {
  if (platform === 'x') {
    return `https://publish.twitter.com/oembed?omit_script=true&dnt=true&url=${encodeURIComponent(url)}`
  }

  return null
}

function getFallbackMetadata(url: string, platform: Platform) {
  const parsed = new URL(url)
  const segments = parsed.pathname.split('/').filter(Boolean)
  const author = getAuthor(platform, segments, parsed.hostname)
  const title = `${PLATFORM_LABELS[platform]} Video Reference`

  return {
    title,
    author,
    description: `${parsed.hostname}${parsed.pathname}`,
    imageUrl: FALLBACK_IMAGES[platform],
  }
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
  return fallback
}
