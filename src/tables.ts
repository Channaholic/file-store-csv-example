import {Column, Table, Types, dialects} from '@subsquid/file-store-csv'

export const tables = {
  Swaps: new Table(
    'swaps.csv',
    {
      blockNumber: Column(Types.Numeric()),
      timestamp: Column(Types.Numeric()),
      eventId: Column(Types.String()),
      pool: Column(Types.String()),
      sqrtPriceX96: Column(Types.String()),
      liquidity: Column(Types.String()),
      tick: Column(Types.Numeric()),
      amount0: Column(Types.String()),
      amount1: Column(Types.String())
    },
    {dialect: dialects.excel, header: true}
  ),
  Mints: new Table(
    'mints.csv',
    {
      blockNumber: Column(Types.Numeric()),
      timestamp: Column(Types.Numeric()),
      eventId: Column(Types.String()),
      pool: Column(Types.String()),
      tickLower: Column(Types.Numeric()),
      tickUpper: Column(Types.Numeric()),
      amount: Column(Types.String())
    },
    {dialect: dialects.excel, header: true}
  ),
  Burns: new Table(
    'burns.csv',
    {
      blockNumber: Column(Types.Numeric()),
      timestamp: Column(Types.Numeric()),
      eventId: Column(Types.String()),
      pool: Column(Types.String()),
      tickLower: Column(Types.Numeric()),
      tickUpper: Column(Types.Numeric()),
      amount: Column(Types.String())
    },
    {dialect: dialects.excel, header: true}
  )
  ,
  V2Swaps: new Table(
    'v2_swaps.csv',
    {
      blockNumber: Column(Types.Numeric()),
      timestamp: Column(Types.Numeric()),
      eventId: Column(Types.String()),
      pair: Column(Types.String()),
      sender: Column(Types.String()),
      to: Column(Types.String()),
      amount0In: Column(Types.String()),
      amount1In: Column(Types.String()),
      amount0Out: Column(Types.String()),
      amount1Out: Column(Types.String())
    },
    {dialect: dialects.excel, header: true}
  ),
  V2Mints: new Table(
    'v2_mints.csv',
    {
      blockNumber: Column(Types.Numeric()),
      timestamp: Column(Types.Numeric()),
      eventId: Column(Types.String()),
      pair: Column(Types.String()),
      amount0: Column(Types.String()),
      amount1: Column(Types.String())
    },
    {dialect: dialects.excel, header: true}
  ),
  V2Burns: new Table(
    'v2_burns.csv',
    {
      blockNumber: Column(Types.Numeric()),
      timestamp: Column(Types.Numeric()),
      eventId: Column(Types.String()),
      pair: Column(Types.String()),
      amount0: Column(Types.String()),
      amount1: Column(Types.String())
    },
    {dialect: dialects.excel, header: true}
  ),
  V2Sync: new Table(
    'v2_sync.csv',
    {
      blockNumber: Column(Types.Numeric()),
      timestamp: Column(Types.Numeric()),
      eventId: Column(Types.String()),
      pair: Column(Types.String()),
      reserve0: Column(Types.String()),
      reserve1: Column(Types.String())
    },
    {dialect: dialects.excel, header: true}
  )
}


