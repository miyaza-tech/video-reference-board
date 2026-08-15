export type Platform = 'x' | 'instagram' | 'threads' | 'linkedin' | 'facebook'

export type SortMode = 'newest' | 'oldest' | 'title' | 'platform'

export type FavoriteMode = 'all' | 'favorites'

export type EmbedKind = 'iframe' | 'none'

export interface BoardItem {
  id: string
  url: string
  platform: Platform
  title: string
  description: string
  author: string
  imageUrl: string
  embedHtml?: string
  embedKind: EmbedKind
  tags: string[]
  favorite: boolean
  savedAt: string
}

export interface NewItemInput {
  url: string
  tags: string[]
  imageUrl?: string
}
