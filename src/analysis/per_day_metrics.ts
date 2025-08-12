import fs from 'fs'
import path from 'path'

// Per-day metrics per pair using V2 swaps and a Virtual→USD daily timeseries
// Env:
// - RUN_ID: run folder under data/
// - VIRT_USD_CSV: path to CSV with columns: ts,virt_usd (daily epoch seconds or ms)
// - SUPPLY: total supply for agent token (default 1e9)

const RUN_ID = process.env.RUN_ID || ''
let VIRT_USD_CSV = process.env.VIRT_USD_CSV || ''
const SUPPLY = Number(process.env.SUPPLY || '1000000000')

if (!RUN_ID) {
  console.error('RUN_ID is required')
  process.exit(1)
}
// Fallback to global file if not provided
if (!VIRT_USD_CSV) {
  const fallback = path.join('data', 'virtual-usd-max.csv')
  if (fs.existsSync(fallback)) {
    VIRT_USD_CSV = fallback
  } else {
    console.error('VIRT_USD_CSV is required (CSV with columns like ts,virt_usd) and data/virtual-usd-max.csv was not found')
    process.exit(1)
  }
}

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

// Aggregation per pair/day
// We compute a VWAP-like price_agent_in_virtual = sum(virtual_amount) / sum(agent_amount)
// using swap legs.

type DayAgg = {
  swaps: number
  unique: Set<string>
  volVirtual: number
  sumVirtual: number
  sumAgent: number
}

const agg = new Map<string, DayAgg>() // key: `${pair}|${dayTs}`

for (const f of listFiles(runDir, 'v2_swaps.csv')) {
  const lines = fs.readFileSync(f, 'utf8').trim().split(/\r?\n/)
  const header = lines.shift() || ''
  for (const line of lines) {
    const [blockNumber,timestamp,eventId,pair,sender,to,a0in,a1in,a0out,a1out] = line.split(',')
    const tsMs = Number(timestamp)
    if (!Number.isFinite(tsMs)) continue
    const dayTs = toDayTs(tsMs)
    const key = `${pair}|${dayTs}`
    const a = agg.get(key) || {swaps: 0, unique: new Set<string>(), volVirtual: 0, sumVirtual: 0, sumAgent: 0}
    a.swaps += 1
    a.unique.add(sender)
    a.unique.add(to)
    const nA0in = Number(a0in), nA1in = Number(a1in), nA0out = Number(a0out), nA1out = Number(a1out)
    if (Number.isFinite(nA1in) && Number.isFinite(nA0out) && nA1in > 0 && nA0out > 0) {
      a.sumVirtual += nA1in
      a.sumAgent += nA0out
    } else if (Number.isFinite(nA1out) && Number.isFinite(nA0in) && nA1out > 0 && nA0in > 0) {
      a.sumVirtual += nA1out
      a.sumAgent += nA0in
    }
    // volume proxy in virtual units
    a.volVirtual += Math.max(nA1in || 0, nA1out || 0)
    agg.set(key, a)
  }
}

// Optional token metadata to apply decimals and orientation
const tokenMetaPath = path.join(runDir, 'token_meta.csv')
const meta = new Map<string, {agent: string; agentDec: number; virtual: string; virtualDec: number; token0?: string; token1?: string; dec0?: number; dec1?: number}>()
if (fs.existsSync(tokenMetaPath)) {
  const lines = fs.readFileSync(tokenMetaPath, 'utf8').trim().split(/\r?\n/)
  lines.shift()
  for (const line of lines) {
    const [pair,token0,token1,decimals0,decimals1,agent,agent_decimals,virtual,virtual_decimals] = line.split(',')
    meta.set(pair.toLowerCase(), {
      agent: agent.toLowerCase(),
      agentDec: Number(agent_decimals),
      virtual: virtual.toLowerCase(),
      virtualDec: Number(virtual_decimals),
      token0: token0.toLowerCase(), token1: token1.toLowerCase(), dec0: Number(decimals0), dec1: Number(decimals1)
    })
  }
}

const outLines = ['day_ts,pair,swaps,unique_traders,volume_virtual,price_agent_in_virtual,virt_usd,price_agent_usd,marketcap_usd']
for (const [key, a] of agg) {
  const [pair, dayTsStr] = key.split('|')
  const dayTs = Number(dayTsStr)
  // Apply decimals if token meta is available
  const m = meta.get(pair)
  let vwap = a.sumAgent > 0 ? a.sumVirtual / a.sumAgent : 0
  if (m && Number.isFinite(m.agentDec) && Number.isFinite(m.virtualDec) && vwap > 0) {
    // amounts above were raw; normalize to token units
    // sumVirtual (token1 units), sumAgent (token0 units) if agent is token0; otherwise inverse
    if (m.token0 && m.agent === m.token0) {
      vwap = (a.sumVirtual / 10**(m.virtualDec || 0)) / (a.sumAgent / 10**(m.agentDec || 0))
    } else {
      // when agent is token1, vwap computed as virtual/agent; still fine with decimals applied
      vwap = (a.sumVirtual / 10**(m.virtualDec || 0)) / (a.sumAgent / 10**(m.agentDec || 0))
    }
  }
  const virtUsd = virtUsdByDay.get(dayTs) || 0
  const priceUsd = vwap * virtUsd
  const mcap = SUPPLY * priceUsd
  outLines.push([
    dayTsStr,
    pair,
    String(a.swaps),
    String(a.unique.size),
    String(a.volVirtual),
    String(vwap),
    String(virtUsd),
    String(priceUsd),
    String(mcap)
  ].join(','))
}

const outPath = path.join(runDir, 'pair_day_metrics.csv')
fs.writeFileSync(outPath, outLines.join('\n'))
console.log(`wrote ${agg.size} rows to ${outPath}`)


