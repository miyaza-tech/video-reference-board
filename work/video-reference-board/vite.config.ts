import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    rollupOptions: {
      output: {
        // 무거운 의존성(특히 Firebase)을 별도 청크로 분리해
        // 병렬 다운로드와 브라우저 캐싱 효율을 높입니다.
        manualChunks(id) {
          if (!id.includes('node_modules')) return
          if (id.includes('@firebase/firestore') || id.includes('firebase/firestore')) return 'firebase-firestore'
          if (id.includes('@firebase/auth') || id.includes('firebase/auth')) return 'firebase-auth'
          if (id.includes('firebase') || id.includes('@firebase')) return 'firebase-core'
          if (id.includes('react')) return 'react'
          return 'vendor'
        },
      },
    },
  },
})
