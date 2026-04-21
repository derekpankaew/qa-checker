/**
 * Adapts a Web-standard handler `(Request) => Response|Promise<Response>`
 * into Vercel's Node.js runtime signature `(req, res)`.
 *
 * Tests invoke the web handler directly with a `Request`. Vercel invokes the
 * default export with `(req, res)`. This adapter bridges the gap without
 * duplicating handler logic.
 */

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

async function toWebRequest(req) {
  const host = req.headers.host || 'localhost'
  const proto = req.headers['x-forwarded-proto'] || 'https'
  const url = `${proto}://${host}${req.url}`
  const init = { method: req.method || 'GET', headers: req.headers }
  if (!['GET', 'HEAD'].includes(init.method.toUpperCase())) {
    const body = await readBody(req)
    if (body.length) init.body = body
  }
  return new Request(url, init)
}

async function sendResponse(res, response) {
  res.statusCode = response.status
  response.headers.forEach((value, key) => {
    res.setHeader(key, value)
  })
  if (!response.body) {
    res.end()
    return
  }
  const reader = response.body.getReader()
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    res.write(Buffer.from(value))
  }
  res.end()
}

export function toNodeHandler(webHandler) {
  return async function nodeHandler(req, res) {
    try {
      const request = await toWebRequest(req)
      const response = await webHandler(request)
      await sendResponse(res, response)
    } catch (err) {
      console.error('nodeAdapter error:', err)
      if (!res.headersSent) {
        res.statusCode = 500
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify({ error: 'Internal Server Error' }))
      } else {
        res.end()
      }
    }
  }
}
