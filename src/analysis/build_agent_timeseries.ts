import fs from 'fs'
import path from 'path'

// Build per-agent daily time series with timestamps (epoch ms) and:
// price_usd, volume_usd, unique_traders_cum, swaps_cum, marketcap_usd
// Env:
// - RUN_ID: run folder under data/
// - VIRT_USD_CSV: path to CSV with columns: ts,virt_usd
// - SUPPLY: total supply for agent token (default 1e9)

const RUN_ID = process.env.RUN_ID || ''
let VIRT_USD_CSV = process.env.VIRT_USD_CSV || ''
const SUPPLY = Number(process.env.SUPPLY || '1000000000')

if (!RUN_ID) { console.error('RUN_ID is required'); process.exit(1) }
if (!VIRT_USD_CSV) {
  const fallback = path.join('data', 'virtual-usd-max.csv')
  if (fs.existsSync(fallback)) {
    VIRT_USD_CSV = fallback
  } else {
    console.error('VIRT_USD_CSV is required and data/virtual-usd-max.csv was not found')
    process.exit(1)
  }
}

const runDir = path.join('data', RUN_ID)
const metricsDir = path.join('data', 'metrics')
fs.mkdirSync(metricsDir, {recursive: true})

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

function toDayTs(tsMs: number): number {
  const DAY = 86_400_000
  return Math.floor(tsMs / DAY) * DAY
}

// Load Virtual→USD daily mapping
const virtUsdByDay = new Map<number, number>()
{
  const txt = fs.readFileSync(VIRT_USD_CSV, 'utf8').trim()
  const lines = txt.split(/\r?\n/)
  const header = (lines.shift() || '').split(',').map((s) => s.trim().toLowerCase())
  const findIdx = (names: string[]) => names.map((n) => header.indexOf(n)).find((i) => i >= 0) ?? -1
  let tsIdx = findIdx(['ts','timestamp','time','date'])
  let usdIdx = findIdx(['virt_usd','usd','price','close'])
  if (tsIdx < 0 && header.length >= 2) tsIdx = 0
  if (usdIdx < 0 && header.length >= 2) usdIdx = 1
  for (const line of lines) {
    const parts = line.split(',')
    const tsRaw = parts[tsIdx]
    const usdRaw = parts[usdIdx]
    if (tsRaw == null || usdRaw == null) continue
    let tsNum = Number(tsRaw)
    if (!Number.isFinite(tsNum)) {
      const dt = Date.parse(tsRaw)
      if (Number.isFinite(dt)) tsNum = dt
    }
    const usd = Number(usdRaw)
    if (!Number.isFinite(tsNum) || !Number.isFinite(usd)) continue
    const tsMs = tsNum > 10_000_000_000 ? tsNum : tsNum * 1000
    virtUsdByDay.set(toDayTs(tsMs), usd)
  }
}

// Load token meta mapping pair -> agent and decimals
const tokenMetaPath = path.join(runDir, 'token_meta.csv')
if (!fs.existsSync(tokenMetaPath)) { console.error(`Missing ${tokenMetaPath}. Run build_token_meta first.`); process.exit(1) }
type Meta = { agent: string; agentDec: number; virtual: string; virtualDec: number; token0: string; token1: string }
const pairToMeta = new Map<string, Meta>()
{
  const lines = fs.readFileSync(tokenMetaPath, 'utf8').trim().split(/\r?\n/)
  lines.shift()
  for (const line of lines) {
    const [pair,token0,token1,decimals0,decimals1,agent,agent_decimals,virtual,virtual_decimals] = line.split(',')
    pairToMeta.set(pair.toLowerCase(), {
      agent: agent.toLowerCase(), agentDec: Number(agent_decimals),
      virtual: virtual.toLowerCase(), virtualDec: Number(virtual_decimals),
      token0: token0.toLowerCase(), token1: token1.toLowerCase()
    })
  }
}

type DayAgg = { swaps: number; unique: Set<string>; sumAgent: number; sumVirtual: number; volVirtual: number }
const perAgentDay = new Map<string, Map<number, DayAgg>>()

for (const f of listFiles(runDir, 'v2_swaps.csv')) {
  const lines = fs.readFileSync(f, 'utf8').trim().split(/\r?\n/)
  lines.shift()
  for (const line of lines) {
    const [blockNumber,timestamp,eventId,pair,sender,to,a0in,a1in,a0out,a1out] = line.split(',')
    const meta = pairToMeta.get((pair || '').toLowerCase())
    if (!meta) continue
    const tsMs = Number(timestamp)
    if (!Number.isFinite(tsMs)) continue
    const dayTs = toDayTs(tsMs)
    const m = perAgentDay.get(meta.agent) || new Map<number, DayAgg>()
    const a = m.get(dayTs) || {swaps: 0, unique: new Set<string>(), sumAgent: 0, sumVirtual: 0, volVirtual: 0}
    a.swaps += 1
    a.unique.add(sender)
    a.unique.add(to)
    const nA0in = Number(a0in), nA1in = Number(a1in), nA0out = Number(a0out), nA1out = Number(a1out)
    // Normalize by decimals
    const scale0 = 10 ** (meta.token0 === meta.agent ? meta.agentDec : meta.virtualDec)
    const scale1 = 10 ** (meta.token1 === meta.agent ? meta.agentDec : meta.virtualDec)
    const t0Agent = meta.token0 === meta.agent
    const agentAmt = t0Agent ? Math.max(nA0in || 0, nA0out || 0) / scale0 : Math.max(nA1in || 0, nA1out || 0) / scale1
    const virtAmt  = t0Agent ? Math.max(nA1in || 0, nA1out || 0) / scale1 : Math.max(nA0in || 0, nA0out || 0) / scale0
    a.sumAgent += agentAmt
    a.sumVirtual += virtAmt
    a.volVirtual += virtAmt
    m.set(dayTs, a)
    perAgentDay.set(meta.agent, m)
  }
}

// Emit per agent CSV with cumulative metrics
for (const [agent, byDay] of perAgentDay) {
  const days = Array.from(byDay.keys()).sort((a,b) => a-b)
  const out: string[] = ['ts,price_usd,volume_usd,unique_traders_cum,swaps_cum,marketcap_usd']
  const seen = new Set<string>()
  let swapsCum = 0
  for (const d of days) {
    const rec = byDay.get(d)!
    swapsCum += rec.swaps
    rec.unique.forEach((u) => seen.add(u))
    const vwap = rec.sumAgent > 0 ? rec.sumVirtual / rec.sumAgent : 0
    const virtUsd = virtUsdByDay.get(d) || 0
    const priceUsd = vwap * virtUsd
    const mcap = SUPPLY * priceUsd
    const volUsd = rec.volVirtual * virtUsd
    out.push([String(d), String(priceUsd), String(volUsd), String(seen.size), String(swapsCum), String(mcap)].join(','))
  }
  const outPath = path.join(metricsDir, `${agent}.csv`)
  fs.writeFileSync(outPath, out.join('\n'))
  console.log(`wrote ${days.length} rows -> ${outPath}`)
}


