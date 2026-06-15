export default async function handler(req: any, res: any) {
    const rawUrl = req.url || ''
    const path = rawUrl.replace(/^\/api\/coingecko/, '') || '/'

    const API_BASE = 'https://api.coingecko.com/api/v3'
    const targetUrl = `${API_BASE}${path}`

    try {
        const headers: Record<string, string> = {}
        const env = (globalThis as any)?.process?.env ?? (globalThis as any)?.__ENV ?? {}
        const apiKey = env?.COINGECKO_API_KEY || env?.VITE_COINGECKO_API_KEY
        if (apiKey) {
            headers['x-cg-pro-api-key'] = apiKey
        }

        const resp = await fetch(targetUrl, { headers })
        const text = await resp.text()

        res.status(resp.status)
        res.setHeader('Content-Type', 'application/json')
        res.send(text)
    } catch (err: any) {
        res.status(500).json({ error: err?.message || 'Proxy request failed' })
    }
}
