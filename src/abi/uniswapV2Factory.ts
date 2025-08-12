import * as p from '@subsquid/evm-codec'
import { event, indexed } from '@subsquid/evm-abi'

// Uniswap V2 Factory PairCreated
// event PairCreated(address indexed token0, address indexed token1, address pair, uint256);
export const events = {
  PairCreated: event(
    '0x0d3648bd0f6ba80134a33ba9275ac585d9d315f0ad8355cddefde31afa28d0e9',
    'PairCreated(address,address,address,uint256)',
    {
      token0: indexed(p.address),
      token1: indexed(p.address),
      pair: p.address,
      // uint256 param is pairCount (ignored here)
      pairCount: p.uint256
    }
  )
}


