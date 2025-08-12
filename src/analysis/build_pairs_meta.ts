import fs from 'fs'
import path from 'path'

// Build a pairs metadata join from v2_sync to get latest reserves per pair and infer token price in quote
// Output: data/<RUN_ID>/pairs_meta.csv with columns: pair,reserve0,reserve1,ts

const RUN_ID = process.env.RUN_ID || ''
if (!RUN_ID) {
  console.error('RUN_ID is required')
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

type SyncRow = {
  block_number: string
  timestamp: string
  event_id: string
  pair: string
  reserve0: string
  reserve1: string
}

const files = listFiles(runDir, 'v2_sync.csv')
const latestByPair = new Map<string, SyncRow>()

for (const f of files) {
  const lines = fs.readFileSync(f, 'utf8').trim().split(/\r?\n/)
  const header = lines.shift()
  for (const line of lines) {
    const [block_number,timestamp,event_id,pair,reserve0,reserve1] = line.split(',')
    const row: SyncRow = {block_number,timestamp,event_id,pair,reserve0,reserve1}
    const prev = latestByPair.get(pair)
    if (!prev || Number(row.block_number) > Number(prev.block_number)) {
      latestByPair.set(pair, row)
    }
  }
}

const outPath = path.join(runDir, 'pairs_meta.csv')
const outLines = ['pair,reserve0,reserve1,timestamp']
for (const row of latestByPair.values()) {
  outLines.push([row.pair,row.reserve0,row.reserve1,row.timestamp].join(','))
}
fs.writeFileSync(outPath, outLines.join('\n'))
console.log(`wrote ${latestByPair.size} rows to ${outPath}`)


