## MVP: Uniswap V3 CSV Indexer

Indexes `Swap`, `Mint`, `Burn` events for selected Uniswap V3 pools and writes minimal CSVs for downstream analysis (price, realized vol, liquidity churn). This is step M0 of the plan.

### Output files (in `./data`)
- `swaps.csv`: `blockNumber,timestamp,txHash,pool,sqrtPriceX96,liquidity,tick,amount0,amount1`
- `mints.csv`: `blockNumber,timestamp,txHash,pool,tickLower,tickUpper,amount`
- `burns.csv`: `blockNumber,timestamp,txHash,pool,tickLower,tickUpper,amount`

### Configure pools
Set environment variable `POOLS` as a comma-separated list of pool addresses (lowercase). Defaults include `USDC/WETH 0.3%` and `DAI/WETH 0.3%`.

Example `.env`:
```env
POOLS=0x8ad599c3a0ff1de082011efddc58f1908eb6e6d8,0xc2e9f25be6257c210d7adf0d4cd6e3e881ba25f8
RESAMPLE_SEC=60
```

### Run (with explicit pairs)
```bash
npm i
npm run build
npx squid-cli process | cat
```

The files will appear under `./data`. Proceed to analytics scripts in the next step to compute price and realized volatility.

## Uniswap V2 on Base (V2 CSV Indexer)

A separate entrypoint `lib/main_v2.js` indexes Uniswap V2 pair events (Swap, Mint, Burn, Sync) on Base.

### Run
```bash
export ARCHIVE_GATEWAY=https://v2.archive.subsquid.io/network/base-mainnet
export POOLS=0x...v2pair1,0x...v2pair2   # required: Base pair addresses (lowercase)
export FROM_BLOCK=8450000                  # choose a suitable start block
# export TO_BLOCK=...                      # optional

npm run build
node lib/main_v2.js | cat
```

### Run (auto-discover via factory)
```bash
export ARCHIVE_GATEWAY=https://v2.archive.subsquid.io/network/base-mainnet
export V2_FACTORY=0x...factoryAddressOnBase      # e.g., UniswapV2-like factory
export FROM_BLOCK=8450000
export RUN_ID=run1                                # optional: folder under data/

npm run build
node lib/main_v2.js | cat
```

### Output
- `v2_swaps.csv`: `blockNumber,timestamp,eventId,pair,amount0In,amount1In,amount0Out,amount1Out`
- `v2_mints.csv`: `blockNumber,timestamp,eventId,pair,amount0,amount1`
- `v2_burns.csv`: `blockNumber,timestamp,eventId,pair,amount0,amount1`
- `v2_sync.csv`: `blockNumber,timestamp,eventId,pair,reserve0,reserve1`
