import {EvmBatchProcessor} from '@subsquid/evm-processor'
import * as v2factory from './abi/uniswapV2Factory'
import 'dotenv/config'
import {LocalDest} from '@subsquid/file-store'

function getEnvNum(name: string, fallback?: number): number | undefined {
  const v = process.env[name]
  if (v == null || v === '') return fallback
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

const V2_FACTORY = process.env.V2_FACTORY?.toLowerCase()
const FROM_BLOCK = getEnvNum('FROM_BLOCK') ?? 8450000
const TO_BLOCK = getEnvNum('TO_BLOCK')
const ARCHIVE_GATEWAY = process.env.ARCHIVE_GATEWAY || 'https://v2.archive.subsquid.io/network/base-mainnet'
const RUN_ID = process.env.RUN_ID || new Date().toISOString().replace(/[:.]/g, '-')

if (!V2_FACTORY) throw new Error('V2_FACTORY is required for discovery')

const processor = new EvmBatchProcessor()
  .setBlockRange(TO_BLOCK ? {from: FROM_BLOCK, to: TO_BLOCK} : {from: FROM_BLOCK})
  .setGateway(ARCHIVE_GATEWAY)
  .addLog({address: [V2_FACTORY], topic0: [v2factory.events.PairCreated.topic]})

const dest = new LocalDest(`./data/${RUN_ID}`)
const pairs = new Set<string>()

processor.run(undefined as any, async (ctx) => {
  for (const block of ctx.blocks) {
    for (const log of block.logs) {
      if (log.topics[0] === v2factory.events.PairCreated.topic) {
        const ev = v2factory.events.PairCreated.decode(log)
        pairs.add(ev.pair.toLowerCase())
      }
    }
  }
})

// After the run completes, write out the discovered pairs
;(async () => {
  // small delay to ensure processor finished
  setTimeout(async () => {
    const content = Array.from(pairs).join('\n') + '\n'
    await dest.writeFile('pairs.txt', content)
  }, 0)
})()


