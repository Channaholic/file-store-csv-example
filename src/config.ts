import 'dotenv/config'

export type PoolConfig = {
  pools: string[]
  resampleSec: number
  fromBlock: number
  toBlock?: number
  gateway: string
}

function getEnvArray(name: string, fallback: string[] = []): string[] {
  const raw = process.env[name]
  if (!raw) return fallback
  return raw.split(',').map((a) => a.trim().toLowerCase()).filter(Boolean)
}

function getEnvInt(name: string): number | undefined {
  const v = process.env[name]
  if (v == null || v === '') return undefined
  const n = Number(v)
  return Number.isFinite(n) ? n : undefined
}

export const CONFIG: PoolConfig = {
  pools: getEnvArray('POOLS', [
    // Uniswap V3: USDC/WETH 0.3%
    '0x8ad599c3a0ff1de082011efddc58f1908eb6e6d8'.toLowerCase(),
    // Uniswap V3: DAI/WETH 0.3%
    '0xc2e9f25be6257c210d7adf0d4cd6e3e881ba25f8'.toLowerCase()
  ]),
  resampleSec: Number(process.env.RESAMPLE_SEC ?? 60),
  fromBlock: getEnvInt('FROM_BLOCK') ?? 12369621,
  toBlock: getEnvInt('TO_BLOCK'),
  gateway: process.env.ARCHIVE_GATEWAY ?? 'https://v2.archive.subsquid.io/network/ethereum-mainnet'
}


