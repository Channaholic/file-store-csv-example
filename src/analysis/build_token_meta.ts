import fs from 'fs'
import path from 'path'

// Build token metadata per pair by calling token0/token1 and ERC20 decimals on Base
// Env:
// - RUN_ID: run folder under data/
// - VIRTUAL_ADDR: Virtual token address (lower/anycase)
// - BASE_RPC: Base RPC endpoint (default https://mainnet.base.org)

const RUN_ID = process.env.RUN_ID || ''
const VIRTUAL_ADDR = (process.env.VIRTUAL_ADDR || '').toLowerCase()
const BASE_RPC = process.env.BASE_RPC || 'https://mainnet.base.org'

if (!RUN_ID) {
  console.error('RUN_ID is required')
  process.exit(1)
}
if (!/^0x[a-fA-F0-9]{40}$/.test(VIRTUAL_ADDR)) {
  console.error('VIRTUAL_ADDR must be an address')
  process.exit(1)
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

async function rpcCall(to: string, data: string): Promise<string> {
  const body = {
    jsonrpc: '2.0', id: 1, method: 'eth_call',
    params: [ { to, data }, 'latest' ]
  }
  const res = await fetch(BASE_RPC, { method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(body) })
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  const j = await res.json() as any
  if (j.error) throw new Error(j.error.message || 'eth_call error')
  return j.result as string
}

function hexToAddress(out: string): string {
  // eth_call returns 32-byte ABI encoded address
  if (out?.startsWith('0x') && out.length >= 66) {
    return '0x' + out.slice(-40)
  }
  return '0x'
}

function hexToNumber(out: string): number {
  if (!out || !out.startsWith('0x')) return NaN
  return Number(BigInt(out))
}

async function getPairTokens(pair: string): Promise<{t0: string, t1: string} | null> {
  try {
    const t0 = hexToAddress(await rpcCall(pair, '0x0dfe1681'))
    const t1 = hexToAddress(await rpcCall(pair, '0xd21220a7'))
    if (!/^0x[a-fA-F0-9]{40}$/.test(t0) || !/^0x[a-fA-F0-9]{40}$/.test(t1)) return null
    return {t0: t0.toLowerCase(), t1: t1.toLowerCase()}
  } catch {
    return null
  }
}

async function getDecimals(token: string): Promise<number | null> {
  try {
    const out = await rpcCall(token, '0x313ce567')
    const n = hexToNumber(out)
    return Number.isFinite(n) ? n : null
  } catch {
    return null
  }
}

(async () => {
  const pairs = new Set<string>()
  for (const f of listFiles(runDir, 'v2_swaps.csv')) {
    const lines = fs.readFileSync(f, 'utf8').trim().split(/\r?\n/)
    lines.shift()
    for (const line of lines) {
      const parts = line.split(',')
      const pair = (parts[3] || '').toLowerCase()
      if (/^0x[a-f0-9]{40}$/.test(pair)) pairs.add(pair)
    }
  }

  const header = 'pair,token0,token1,decimals0,decimals1,agent,agent_decimals,virtual,virtual_decimals'
  const out: string[] = [header]
  let processed = 0
  for (const pair of pairs) {
    const toks = await getPairTokens(pair)
    if (!toks) continue
    const {t0, t1} = toks
    const d0 = await getDecimals(t0)
    const d1 = await getDecimals(t1)
    const virtualSide = t0 === VIRTUAL_ADDR ? 0 : t1 === VIRTUAL_ADDR ? 1 : -1
    if (virtualSide === -1) continue
    const agent = virtualSide === 0 ? t1 : t0
    const agentDec = virtualSide === 0 ? d1 : d0
    const virtualDec = virtualSide === 0 ? d0 : d1
    out.push([
      pair,
      t0,
      t1,
      String(d0 ?? ''),
      String(d1 ?? ''),
      agent,
      String(agentDec ?? ''),
      VIRTUAL_ADDR,
      String(virtualDec ?? '')
    ].join(','))
    processed++
  }

  const outPath = path.join(runDir, 'token_meta.csv')
  fs.writeFileSync(outPath, out.join('\n'))
  console.log(`wrote ${processed} rows to ${outPath}`)
})().catch((e) => { console.error(e); process.exit(1) })


