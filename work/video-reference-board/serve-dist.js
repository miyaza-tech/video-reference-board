import http from 'node:http'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const root = path.join(__dirname, 'dist')
const host = '127.0.0.1'
const port = 5174

const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
}

const server = http.createServer(async (req, res) => {
  try {
    const requestUrl = new URL(req.url ?? '/', `http://${host}:${port}`)
    const requestPath = requestUrl.pathname === '/' ? '/index.html' : requestUrl.pathname
    const filePath = path.normalize(path.join(root, decodeURIComponent(requestPath)))

    if (!filePath.startsWith(root)) {
      res.writeHead(403)
      res.end('Forbidden')
      return
    }

    try {
      const data = await readFile(filePath)
      const ext = path.extname(filePath).toLowerCase()
      res.writeHead(200, { 'Content-Type': mimeTypes[ext] ?? 'application/octet-stream' })
      res.end(data)
    } catch {
      const indexHtml = await readFile(path.join(root, 'index.html'))
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(indexHtml)
    }
  } catch {
    res.writeHead(500)
    res.end('Server error')
  }
})

server.listen(port, host, () => {
  console.log(`Static server ready at http://${host}:${port}/`)
})
