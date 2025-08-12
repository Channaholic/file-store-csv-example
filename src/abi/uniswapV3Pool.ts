import * as p from '@subsquid/evm-codec'
import { event, indexed } from '@subsquid/evm-abi'

export const events = {
  Swap: event(
    '0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67',
    'Swap(address,address,int256,int256,uint160,uint128,int24)',
    {
      sender: indexed(p.address),
      recipient: indexed(p.address),
      amount0: p.int256,
      amount1: p.int256,
      sqrtPriceX96: p.uint160,
      liquidity: p.uint128,
      tick: p.int24
    }
  ),
  Mint: event(
    '0x7a53080c2243b3560c9f6ad94868f0f4a7e6e2b80b712c3439b78ad8b170e2ae',
    'Mint(address,address,int24,int24,uint128,uint256,uint256)',
    {
      sender: indexed(p.address),
      owner: indexed(p.address),
      tickLower: p.int24,
      tickUpper: p.int24,
      amount: p.uint128,
      amount0: p.uint256,
      amount1: p.uint256
    }
  ),
  Burn: event(
    '0x0c396cd989aa62200e60f7c3587e87e40b01a3d3c6a0c7786a6f1fbf6b9d2f95',
    'Burn(address,int24,int24,uint128,uint256,uint256)',
    {
      owner: indexed(p.address),
      tickLower: p.int24,
      tickUpper: p.int24,
      amount: p.uint128,
      amount0: p.uint256,
      amount1: p.uint256
    }
  )
}


