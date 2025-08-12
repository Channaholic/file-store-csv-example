import {Database, LocalDest} from '@subsquid/file-store'
import {tables} from './tables'
import {EvmBatchProcessor} from '@subsquid/evm-processor'
import * as uni from './abi/uniswapV3Pool'
import {CONFIG} from './config'

// Minimal MVP: capture Uniswap V3 Swap/Mint/Burn for selected pools into CSVs

const processor = new EvmBatchProcessor()
  .setBlockRange(CONFIG.toBlock ? { from: CONFIG.fromBlock, to: CONFIG.toBlock } : { from: CONFIG.fromBlock })
  .setGateway(CONFIG.gateway)
  .addLog({ address: CONFIG.pools, topic0: [uni.events.Swap.topic] })
  .addLog({ address: CONFIG.pools, topic0: [uni.events.Mint.topic] })
  .addLog({ address: CONFIG.pools, topic0: [uni.events.Burn.topic] })

const RUN_ID = process.env.RUN_ID || new Date().toISOString().replace(/[:.]/g, '-')
const db = new Database({
  tables,
  dest: new LocalDest(`./data/${RUN_ID}`),
  chunkSizeMb: 50,
})

processor.run(db, async (ctx) => {
  for (const block of ctx.blocks) {
    for (const log of block.logs) {
      const topic0 = log.topics[0]
      const common = {
        blockNumber: block.header.height,
        timestamp: block.header.timestamp,
        eventId: `${block.header.height}:${log.transactionIndex}:${log.logIndex}`,
        pool: log.address
      }

      if (topic0 === uni.events.Swap.topic) {
        const ev = uni.events.Swap.decode(log)
        ctx.store.Swaps.write({
          ...common,
          sqrtPriceX96: ev.sqrtPriceX96.toString(),
          liquidity: ev.liquidity.toString(),
          tick: ev.tick,
          amount0: ev.amount0.toString(),
          amount1: ev.amount1.toString()
        })
      } else if (topic0 === uni.events.Mint.topic) {
        const ev = uni.events.Mint.decode(log)
        ctx.store.Mints.write({
          ...common,
          tickLower: ev.tickLower,
          tickUpper: ev.tickUpper,
          amount: ev.amount.toString()
        })
      } else if (topic0 === uni.events.Burn.topic) {
        const ev = uni.events.Burn.decode(log)
        ctx.store.Burns.write({
          ...common,
          tickLower: ev.tickLower,
          tickUpper: ev.tickUpper,
          amount: ev.amount.toString()
        })
      }
    }
  }
  // Force flush small chunks so CSVs are written even for short ranges
  ctx.store.setForceFlush(true)
})
