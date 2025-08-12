import 'dotenv/config'
import fs from 'fs'
import path from 'path'

// Fetch VIRTUALS→USD daily prices using either Coingecko (preferred) or GeckoTerminal (fallback/premium)
// Env:
// - RUN_ID: run folder under data/
// - SOURCE: 'coingecko' | 'geckoterminal' (default: coingecko)
// - VIRTUAL_ADDR: Virtual token contract on Base (for Coingecko)
// - COINGECKO_API_KEY: optional (header x-cg-demo-api-key)
// - V3_POOL: Uniswap V3 pool address (VIRTUALS/USDC) on Base (for GeckoTerminal)
// - GECKO_KEY: optional GeckoTerminal API key (header x-api-key)
// - TIMEFRAME: day (default) for GeckoTerminal

const RUN_ID = process.env.RUN_ID || ''
const SOURCE = (process.env.SOURCE || 'coingecko').toLowerCase()
const VIRTUAL_ADDR = (process.env.VIRTUAL_ADDR || '').toLowerCase()
const COINGECKO_ID = (process.env.COINGECKO_ID || '').toLowerCase()
const COINGECKO_API_KEY = process.env.COINGECKO_API_KEY || process.env.COINGECKO_KEY || process.env.CG_KEY || process.env.GECKO_KEY || ''
const V3_POOL = (process.env.V3_POOL || '').toLowerCase()
const GECKO_KEY = process.env.GECKO_KEY || ''
const TIMEFRAME = process.env.TIMEFRAME || 'day'

if (!RUN_ID) { console.error('RUN_ID is required'); process.exit(1) }

const runDir = path.join('data', RUN_ID)
fs.mkdirSync(runDir, {recursive: true})
fs.mkdirSync('data', {recursive: true})

async function fetchJson(url: string, headers: Record<string,string> = {}) {
  const res = await fetch(url, {headers: {'accept': 'application/json', ...headers}})
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  return res.json() as any
}

async function fetchFromCoingecko(contract: string): Promise<[number, number][]> {
  const headers: Record<string,string> = {}
  if (COINGECKO_API_KEY) headers['x-cg-demo-api-key'] = COINGECKO_API_KEY
  let id = COINGECKO_ID
  if (!id) {
    if (!/^0x[a-f0-9]{40}$/.test(contract)) throw new Error('Provide COINGECKO_ID or a valid VIRTUAL_ADDR for discovery')
    // Discover coin id by matching contract on Base
    const listUrl = 'https://api.coingecko.com/api/v3/coins/list?include_platform=true'
    const list = await fetchJson(listUrl, headers)
    id = (list as any[]).find((c: any) => {
      const plat = c?.platforms || {}
      const baseAddr = (plat['base'] || '').toLowerCase()
      return baseAddr === contract
    })?.id
    if (!id) throw new Error('Coingecko id not found for provided contract on Base; set COINGECKO_ID explicitly')
  }
  const url = `https://api.coingecko.com/api/v3/coins/${id}/market_chart?vs_currency=usd&days=max&interval=daily&precision=full`
  const j = await fetchJson(url, headers)
  const prices = (j?.prices as [number, number][] | undefined) || []
  return prices // [ts_ms, price]
}

async function fetchFromGeckoTerminal(pool: string): Promise<[number, number][]> {
  if (!/^0x[a-f0-9]{40}$/.test(pool)) throw new Error('V3_POOL must be a valid address (VIRTUALS-USDC)')
  const rows: [number, number, number, number, number, number][] = []
  let before = Math.floor(Date.now() / 1000)
  const LIMIT = 1000
  for (;;) {
    const url = `https://api.geckoterminal.com/api/v2/networks/base/pools/${pool}/ohlcv/${TIMEFRAME}?aggregate=1&limit=${LIMIT}&before_timestamp=${before}`
    const headers: Record<string,string> = {}
    if (GECKO_KEY) headers['x-api-key'] = GECKO_KEY
    const j = await fetchJson(url, headers)
    const batch = j?.data?.attributes?.ohlcv_list as typeof rows | undefined
    if (!batch || batch.length === 0) break
    rows.push(...batch)
    if (batch.length < LIMIT) break
    before = batch[batch.length - 1][0] - 1
    await new Promise((r) => setTimeout(r, 3200))
  }
  // map to [ts_sec, close]
  return rows.map(([ts, _o, _h, _l, close]) => [ts * 1000, close])
}

;(async () => {
  let series: [number, number][] = []
  if (SOURCE === 'coingecko') {
    series = await fetchFromCoingecko(VIRTUAL_ADDR)
  } else {
    series = await fetchFromGeckoTerminal(V3_POOL)
  }
  const out = ['ts,virt_usd']
  for (const [ts, price] of series) {
    const tsMs = ts > 10_000_000_000 ? ts : ts * 1000
    out.push(`${tsMs},${price}`)
  }
  const outRunPath = path.join(runDir, 'virtual_usd_daily.csv')
  fs.writeFileSync(outRunPath, out.join('\n'))
  const outGlobalPath = path.join('data', 'virtual_usd_daily.csv')
  fs.writeFileSync(outGlobalPath, out.join('\n'))
  console.log(`wrote ${series.length} rows to ${outRunPath} and ${outGlobalPath}`)
})().catch((e) => { console.error(e); process.exit(1) })


