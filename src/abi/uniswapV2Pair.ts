import * as p from '@subsquid/evm-codec'
import { event, indexed } from '@subsquid/evm-abi'

export const events = {
  Swap: event(
    '0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822',
    'Swap(address,uint256,uint256,uint256,uint256,address)',
    {
      sender: indexed(p.address),
      amount0In: p.uint256,
      amount1In: p.uint256,
      amount0Out: p.uint256,
      amount1Out: p.uint256,
      to: indexed(p.address)
    }
  ),
  Mint: event(
    '0x4c209b5fc8ad505345e2d0351cd2d22e1c9f7f3ee096685f98ad5d9f5f7f3d9b',
    'Mint(address,uint256,uint256)',
    {
      sender: indexed(p.address),
      amount0: p.uint256,
      amount1: p.uint256
    }
  ),
  Burn: event(
    '0xdccd412f657b8d6bf6f8a6269c4e3e5c2b4d113ad8b189a6b2d518f1b0b85f23',
    'Burn(address,uint256,uint256,address)',
    {
      sender: indexed(p.address),
      amount0: p.uint256,
      amount1: p.uint256,
      to: indexed(p.address)
    }
  ),
  Sync: event(
    '0x1c411e9a96e071241c2f21f7726b17ae89e3cab4c8b29e702b7b2e0b7b8f3e5c',
    'Sync(uint112,uint112)',
    {
      reserve0: p.uint112,
      reserve1: p.uint112
    }
  )
}


