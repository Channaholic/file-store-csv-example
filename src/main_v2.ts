import {Database, LocalDest} from '@subsquid/file-store'
import {EvmBatchProcessor} from '@subsquid/evm-processor'
import {tables} from './tables'
import * as v2 from './abi/uniswapV2Pair'
import * as v2factory from './abi/uniswapV2Factory'
import 'dotenv/config'

function getEnvArray(name: string): string[] {
  const v = process.env[name]
  return v ? v.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean) : []
}
function splitCsvLine(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      // handle escaped quotes
      if (inQuotes && line[i + 1] === '"') { cur += '"'; i++; continue }
      inQuotes = !inQuotes
    } else if (ch === ',' && !inQuotes) {
      out.push(cur)
      cur = ''
    } else {
      cur += ch
    }
  }
  out.push(cur)
  return out
}

function parseCsvRows(content: string): string[][] {
  const rows: string[][] = []
  let cur: string[] = []
  let field = ''
  let inQuotes = false
  for (let i = 0; i < content.length; i++) {
    const ch = content[i]
    if (ch === '"') {
      if (inQuotes && content[i + 1] === '"') { field += '"'; i++; continue }
      inQuotes = !inQuotes
    } else if (ch === ',' && !inQuotes) {
      cur.push(field)
      field = ''
    } else if ((ch === '\n' || ch === '\r') && !inQuotes) {
      if (ch === '\r' && content[i + 1] === '\n') i++
      cur.push(field)
      rows.push(cur)
      cur = []
      field = ''
    } else {
      field += ch
    }
  }
  // flush last field/row
  cur.push(field)
  rows.push(cur)
  return rows
}

function readPairsFile(path?: string): string[] {
  if (!path) return []
  try {
    const fs = require('fs') as typeof import('fs')
    if (!fs.existsSync(path)) return []
    const content = fs.readFileSync(path, 'utf8')
    const rows = parseCsvRows(content)
    if (rows.length === 0) return []

    // Try CSV with header containing lpAddress (case-insensitive)
    if (rows[0].length > 1) {
      const headers = rows[0].map((h: string) => h.trim().replace(/^"|"$/g, '').toLowerCase())
      const candidates = ['lpaddress', 'pair', 'pairaddress', 'address', 'pool', 'pooladdress']
      const addrIdx = headers.findIndex((h: string) => candidates.includes(h))
      if (addrIdx >= 0) {
        const addrs: string[] = []
        for (let i = 1; i < rows.length; i++) {
          const cols = rows[i].map((c: string) => c.trim())
          const raw = (cols[addrIdx] || '').replace(/^"|"$/g, '').toLowerCase()
          if (/^0x[a-f0-9]{40}$/.test(raw)) addrs.push(raw)
        }
        return Array.from(new Set(addrs))
      }
    }

    // Fallback: one address per line
    const lines = content.split(/\r?\n/)
    return Array.from(new Set(lines
      .map((l: string) => l.trim().replace(/^"|"$/g, '').toLowerCase())
      .filter((l: string) => /^0x[a-f0-9]{40}$/.test(l))))
  } catch {
    return []
  }
}

function getEnvNum(name: string, fallback?: number): number | undefined {
  const v = process.env[name]
  if (v == null || v === '') return fallback
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

// Env config for Base chain
// Option A: provide POOLS directly (comma-separated pairs)
// Option B: provide V2_FACTORY and we will auto-discover via PairCreated
const PAIRS_FILE = process.env.PAIRS_FILE
const POOLS = [...new Set([...getEnvArray('POOLS'), ...readPairsFile(PAIRS_FILE)])]
const V2_FACTORY = process.env.V2_FACTORY?.toLowerCase()
const FROM_BLOCK = getEnvNum('FROM_BLOCK') ?? 8450000 // choose a reasonable default
const TO_BLOCK = getEnvNum('TO_BLOCK')
const ARCHIVE_GATEWAY = process.env.ARCHIVE_GATEWAY || 'https://v2.archive.subsquid.io/network/base-mainnet'

if (POOLS.length === 0 && !V2_FACTORY) {
  throw new Error('Provide PAIRS_FILE/POOLS or V2_FACTORY for V2 processor')
}

const processor = new EvmBatchProcessor()
  .setBlockRange(TO_BLOCK ? {from: FROM_BLOCK, to: TO_BLOCK} : {from: FROM_BLOCK})
  .setGateway(ARCHIVE_GATEWAY)

// Chunk addresses to avoid overly large filters
function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

if (POOLS.length > 0) {
  const chunks = chunk(POOLS, 100)
  for (const addrChunk of chunks) {
    processor.addLog({address: addrChunk, topic0: [v2.events.Swap.topic]})
    processor.addLog({address: addrChunk, topic0: [v2.events.Mint.topic]})
    processor.addLog({address: addrChunk, topic0: [v2.events.Burn.topic]})
    processor.addLog({address: addrChunk, topic0: [v2.events.Sync.topic]})
  }
}

if (V2_FACTORY) {
  processor.addLog({address: [V2_FACTORY], topic0: [v2factory.events.PairCreated.topic]})
}

// Organize outputs in subfolder per run
const RUN_ID = process.env.RUN_ID || new Date().toISOString().replace(/[:.]/g, '-')
const db = new Database({tables, dest: new LocalDest(`./data/${RUN_ID}`), chunkSizeMb: 50})

console.log(`[V2] pairs=${POOLS.length}, factory=${V2_FACTORY ? 'yes' : 'no'}, from=${FROM_BLOCK}, to=${TO_BLOCK ?? 'latest'}, run=${RUN_ID}`)
if (POOLS.length > 0) {
  console.log(`[V2] example pairs: ${POOLS.slice(0, 3).join(', ')}`)
}

processor.run(db, async (ctx) => {
  // dynamic set of discovered pairs (when factory is provided)
  const knownPairs = new Set<string>(POOLS)

  for (const block of ctx.blocks) {
    for (const log of block.logs) {
      const topic = log.topics[0]
      const common = {
        blockNumber: block.header.height,
        timestamp: block.header.timestamp,
        eventId: `${block.header.height}:${log.transactionIndex}:${log.logIndex}`,
      }

      if (topic === v2factory.events.PairCreated.topic) {
        const ev = v2factory.events.PairCreated.decode(log)
        const pair = ev.pair.toLowerCase()
        if (!knownPairs.has(pair)) {
          knownPairs.add(pair)
          // Register pair logs on-the-fly for subsequent blocks
          processor
            .addLog({address: [pair], topic0: [v2.events.Swap.topic]})
            .addLog({address: [pair], topic0: [v2.events.Mint.topic]})
            .addLog({address: [pair], topic0: [v2.events.Burn.topic]})
            .addLog({address: [pair], topic0: [v2.events.Sync.topic]})
        }
      } else if (topic === v2.events.Swap.topic) {
        const ev = v2.events.Swap.decode(log)
        ctx.store.V2Swaps.write({
          ...common,
          pair: log.address,
          sender: ev.sender,
          to: ev.to,
          amount0In: ev.amount0In.toString(),
          amount1In: ev.amount1In.toString(),
          amount0Out: ev.amount0Out.toString(),
          amount1Out: ev.amount1Out.toString()
        })
      } else if (topic === v2.events.Mint.topic) {
        const ev = v2.events.Mint.decode(log)
        ctx.store.V2Mints.write({
          ...common,
          pair: log.address,
          amount0: ev.amount0.toString(),
          amount1: ev.amount1.toString()
        })
      } else if (topic === v2.events.Burn.topic) {
        const ev = v2.events.Burn.decode(log)
        ctx.store.V2Burns.write({
          ...common,
          pair: log.address,
          amount0: ev.amount0.toString(),
          amount1: ev.amount1.toString()
        })
      } else if (topic === v2.events.Sync.topic) {
        const ev = v2.events.Sync.decode(log)
        ctx.store.V2Sync.write({
          ...common,
          pair: log.address,
          reserve0: ev.reserve0.toString(),
          reserve1: ev.reserve1.toString()
        })
      }
    }
  }
  ctx.store.setForceFlush(true)
})


