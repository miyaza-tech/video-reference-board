export type Platform = 'x' | 'instagram' | 'threads' | 'linkedin' | 'facebook'

export type FavoriteMode = 'all' | 'favorites'

export interface BoardItem {
  id: string
  url: string
  platform: Platform
  title: string
  author: string
  imageUrl: string
  tags: string[]
  // 사용자가 직접 적는 한 줄 메모. 카드에 마우스를 올리면 보입니다.
  // 나중에 추가한 필드라 그 전에 저장된 문서에는 없습니다.
  note?: string
  favorite: boolean
  savedAt: string
}

export interface NewItemInput {
  url: string
  tags: string[]
  note?: string
  imageUrl?: string
}
