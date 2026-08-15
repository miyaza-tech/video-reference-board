# Video Reference Board

SNS에 흩어진 영상 레퍼런스를 한 보드에 모아 두는 개인용 웹앱입니다.
X · Instagram · Threads · LinkedIn · Facebook 링크를 붙여 넣으면 플랫폼과 작성자 아이디를 자동으로 인식해 카드로 저장하고, 태그·검색·정렬로 다시 찾아볼 수 있습니다.

데이터는 Google 로그인 계정별로 Firestore에 저장되며, 다른 사용자는 접근할 수 없습니다.

## 주요 기능

- **링크 저장** — URL만 넣으면 플랫폼 판별, `@아이디` 추출, 섬네일 자동 지정 (X는 oEmbed로 제목·섬네일 조회)
- **섬네일 직접 지정** — 이미지를 고르면 720px/JPEG로 압축해 Firebase Storage에 업로드
- **필터** — 플랫폼 / 태그(`real` `3D` `2D` `Original` `Prompt` `Tutorial` + 커스텀) / 좋아요 / 작성자별 모아보기. 한 번에 하나만 적용됩니다
- **검색·정렬** — 제목·작성자·설명·태그·URL 통합 검색, 최신순 / 오래된순 / 제목순 / 플랫폼순 정렬
- **편집** — 제목, 작성자, 설명, 태그, 섬네일 수정
- **Export / Import** — 보드 전체를 JSON으로 내보내고 되돌리기 (가져오기 시 스키마 검증)
- **자동 마이그레이션** — 로드 시 과거 base64 섬네일을 Storage로 이전하고, 태그 이름과 작성자 표기를 최신 규칙으로 맞춥니다

## 기술 스택

React 19 · TypeScript 6 · Vite 8 · Tailwind CSS 4 · zustand · Firebase (Auth / Firestore lite / Storage) · react-masonry-css · lucide-react

## 시작하기

**요구 사항**: Node.js 20.19+ 또는 22.12+ (Vite 8 기준)

```bash
npm install
cp .env.example .env   # 아래 값을 채웁니다
npm run dev
```

`http://localhost:5173` 에서 열립니다. 저장소 루트의 `outputs/start-video-board.bat` 을 쓰면 5174 포트로 서버를 띄우고 브라우저까지 함께 엽니다.

### 환경 변수

Firebase 콘솔 → 프로젝트 설정 → 내 앱(웹)의 SDK 구성 값을 `.env` 에 넣습니다. `.env` 는 커밋되지 않습니다.

```
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_STORAGE_BUCKET=
VITE_FIREBASE_MESSAGING_SENDER_ID=
VITE_FIREBASE_APP_ID=
```

### Firebase 준비

콘솔에서 아래 세 가지를 켜 두어야 합니다.

1. **Authentication** — Google 로그인 제공업체 사용 설정
2. **Firestore Database** — 데이터베이스 생성
3. **Storage** — 버킷 생성 (섬네일 저장용)

보안 규칙은 저장소의 `firestore.rules` / `storage.rules` 를 배포합니다. 둘 다 `users/{uid}` 아래를 본인만 읽고 쓸 수 있게 제한합니다.

```bash
npx firebase deploy --only firestore:rules,storage
```

## 스크립트

| 명령 | 설명 |
| --- | --- |
| `npm run dev` | 개발 서버 (HMR) |
| `npm run build` | 타입 검사(`tsc -b`) 후 `dist/` 로 프로덕션 빌드 |
| `npm run preview` | 빌드 결과 미리보기 |
| `npm run lint` | ESLint |

`node serve-dist.js` 로도 `dist/` 를 127.0.0.1:5174에 띄울 수 있습니다 (SPA 폴백 포함).

## 배포

Firebase Hosting을 사용합니다. `firebase.json` 이 `dist/` 를 퍼블릭 디렉터리로, 모든 경로를 `/index.html` 로 리라이트하도록 설정돼 있습니다.

```bash
npm run build
npx firebase deploy
```

배포 대상 프로젝트는 `.firebaserc` 의 `default` 값입니다.

## 프로젝트 구조

```
src/
├── App.tsx       # 전체 UI — 로그인, 필터바, 카드 그리드, 추가 드로어, 편집 모달
├── store.ts      # zustand 스토어 + Firestore CRUD + 마이그레이션
├── metadata.ts   # URL 정규화, 플랫폼 판별, @아이디 추출, X oEmbed 조회
├── firebase.ts   # Firebase 초기화
├── types.ts      # BoardItem 등 공용 타입
└── index.css     # Tailwind + 공용 컴포넌트 클래스
```

### 데이터 모델

항목은 `users/{uid}/items/{itemId}` 문서 하나에 대응합니다.

```ts
interface BoardItem {
  id: string          // crypto.randomUUID()
  url: string         // 정규화된 원본 URL
  platform: 'x' | 'instagram' | 'threads' | 'linkedin' | 'facebook'
  title: string
  description: string
  author: string      // 가능하면 '@handle', 아니면 호스트명
  imageUrl: string    // Storage 다운로드 URL 또는 외부 이미지 URL
  tags: string[]
  favorite: boolean
  savedAt: string     // ISO 8601
}
```

섬네일 이미지는 문서에 직접 넣지 않고 Storage(`users/{uid}/thumbnails/`)에 올린 뒤 URL만 저장합니다. Firestore 문서 1MB 제한을 피하고 로딩을 빠르게 하기 위해서입니다.

가져오기(Import)는 위 필드만 화이트리스트로 통과시키고 나머지 키는 버립니다. 외부 JSON을 통한 HTML 주입을 막기 위한 조치이므로, 검증 로직을 완화할 때 주의하세요.
