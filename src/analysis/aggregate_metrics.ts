import fs from 'fs'
import path from 'path'

// Aggregate per-pair metrics from v2_swaps and pairs_meta
// Inputs under data/<RUN_ID>/
// - v2_swaps.csv chunks
// - pairs_meta.csv (latest reserves per pair)
// Env:
// - VIRTUAL_PRICE_USD: price of the Virtual token in USD (float)
// - SUPPLY: total supply per agent token (default 1e9)

const RUN_ID = process.env.RUN_ID || ''
if (!RUN_ID) {
  console.error('RUN_ID is required')
  process.exit(1)
}

const VIRTUAL_PRICE_USD = Number(process.env.VIRTUAL_PRICE_USD || '0')
if (!Number.isFinite(VIRTUAL_PRICE_USD) || VIRTUAL_PRICE_USD <= 0) {
  console.error('VIRTUAL_PRICE_USD is required and must be > 0')
  process.exit(1)
}

const SUPPLY = Number(process.env.SUPPLY || '1000000000')

const runDir = path.join('data', RUN_ID)

function listFiles(dir: string, name: string): string[] {
  const out: string[] = []
  if (!fs.existsSync(dir)) return out
  for (const d of fs.readdirSync(dir)) {
    const sub = path.join(dir, d)
    if (fs.statSync(sub).isDirectory()) {
      const p = path.join(sub, name)
      if (fs.existsSync(p)) out.push(p)
    }
  }
  return out
}

// Load latest reserves per pair if available (optional)
const metaPath = path.join(runDir, 'pairs_meta.csv')
const reserves = new Map<string, {r0: number; r1: number}>()
if (fs.existsSync(metaPath)) {
  const lines = fs.readFileSync(metaPath, 'utf8').trim().split(/\r?\n/)
  for (const line of lines.slice(1)) {
    const [pair,reserve0,reserve1] = line.split(',')
    if (pair) reserves.set(pair, {r0: Number(reserve0), r1: Number(reserve1)})
  }
}

// Aggregate swaps by pair: count, unique traders, volume proxy (sum of absolute amounts)
type Agg = {count: number; unique: Set<string>; notionalVirtual: number; sum0: number; sum1: number}
const aggByPair = new Map<string, Agg>()

for (const f of listFiles(runDir, 'v2_swaps.csv')) {
  const lines = fs.readFileSync(f, 'utf8').trim().split(/\r?\n/)
  lines.shift()
  for (const line of lines) {
    const [blockNumber,timestamp,eventId,pair,sender,to,amount0In,amount1In,amount0Out,amount1Out] = line.split(',')
    const a0in = Number(amount0In), a1in = Number(amount1In), a0out = Number(amount0Out), a1out = Number(amount1Out)
    const a = aggByPair.get(pair) || {count: 0, unique: new Set<string>(), notionalVirtual: 0, sum0: 0, sum1: 0}
    a.count += 1
    a.unique.add(sender)
    a.unique.add(to)
    // volume proxy in "token1 units" (assuming Virtual is token1). Without token mapping we approximate by using max of sides in token1
    const volSide = Math.max(a1in, a1out)
    a.notionalVirtual += volSide
    a.sum0 += Math.max(a0in, a0out)
    a.sum1 += Math.max(a1in, a1out)
    aggByPair.set(pair, a)
  }
}

// Build per pair price proxy and marketcap in USD: priceAgentUSD ≈ (reserve1 / reserve0) * VIRTUAL_PRICE_USD
// marketcap ≈ supply * priceAgentUSD
const outLines = ['pair,swaps,unique_traders,volume_virtual,price_agent_in_virtual,price_agent_usd,marketcap_usd']
for (const [pair, agg] of aggByPair) {
  const r = reserves.get(pair)
  let priceVirtual = 0
  if (r && r.r0 > 0 && r.r1 > 0) {
    priceVirtual = r.r1 / r.r0
  } else if (agg.sum0 > 0 && agg.sum1 > 0) {
    priceVirtual = agg.sum1 / agg.sum0
  }
  const priceUsd = priceVirtual * VIRTUAL_PRICE_USD
  const marketcap = SUPPLY * priceUsd
  outLines.push([
    pair,
    String(agg.count),
    String(agg.unique.size),
    String(agg.notionalVirtual),
    String(priceVirtual),
    String(priceUsd),
    String(marketcap)
  ].join(','))
}

const outPath = path.join(runDir, 'pair_metrics.csv')
fs.writeFileSync(outPath, outLines.join('\n'))
console.log(`wrote ${aggByPair.size} rows to ${outPath}`)


