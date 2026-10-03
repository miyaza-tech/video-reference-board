export type Platform = 'x' | 'instagram' | 'threads' | 'linkedin' | 'facebook'

export type FavoriteMode = 'all' | 'favorites'

export interface BoardItem {
  id: string
  url: string
  platform: Platform
  title: string
  description: string
  author: string
  imageUrl: string
  tags: string[]
  favorite: boolean
  savedAt: string
}

export interface NewItemInput {
  url: string
  tags: string[]
  imageUrl?: string
}
