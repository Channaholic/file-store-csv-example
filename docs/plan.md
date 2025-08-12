Here’s a drop-in Markdown plan. File name suggestion: `PLAN_PORTFOLIO_CONSTRUCTION.md`.

---

# Portfolio Construction in DeFi — Hedging, Liquidity Risk, and Volatility Metrics

This plan scopes a minimal but extensible pipeline to (1) index on-chain AMM events, (2) compute liquidity/volatility scores, (3) simulate LP tokens as hedges, and (4) prototype a liquidity- & vol-informed allocation rule. Designed to be implemented incrementally with Subsquid + TypeScript (Cursor-friendly), plus optional Python notebooks for analysis.

---

## 0) Scope & Milestones

**M0 (Day 1–2):** Single-pool CSV indexer → price series + realized vol
**M1 (Week 1):** Liquidity Health Score (LHS v0) + Volatility Score (VS v0) over 3–5 pools
**M2 (Week 2):** LP range simulation (fees vs IL) + toy hedge overlay vs HODL
**M3 (Week 3):** Portfolio rule backtest (weights ∝ LHS^α / VS^β), daily rebal + cost model
**M4 (Week 4+):** “Crypto VIX” prototype index + cross-pool validation + robustness checks

---

## 1) Repository Layout

```
.
├─ /squid/                 # Indexer (TypeScript)
│  ├─ /abi/                # Pool ABIs (JSON)
│  ├─ /src/
│  │  ├─ tables.ts         # CSV schemas
│  │  ├─ db.ts             # file-store setup
│  │  ├─ processor.ts      # EVM processor with event handlers
│  │  ├─ math.ts           # price/vol/liquidity helpers
│  │  └─ config.ts         # pools, chain, window sizes
│  └─ package.json
├─ /data/                  # Output CSVs (gitignored)
│  ├─ swaps.csv
│  ├─ mints.csv
│  └─ burns.csv
├─ /analysis/
│  ├─ metrics.ts           # LHS/VS computation (Node script)
│  ├─ backtest.ts          # allocation + hedging sims
│  └─ notebooks/           # optional .ipynb or .py notebooks
├─ /docs/
│  └─ NOTES.md             # design choices, pitfalls, todos
├─ .env.example
└─ PLAN_PORTFOLIO_CONSTRUCTION.md
```

---

## 2) Minimal Data Product (v0)

**Goal:** CSVs for a small set of pools with enough fields to recover price, realized volatility, and liquidity churn.

### 2.1 Pools & Chain

* Start with 2–3 deep pools on one chain (e.g., mainnet).
* Store pool addresses in `.env` as `POOLS=0x...,0x...`.

### 2.2 Events to Index

* **Swap**: `amount0`, `amount1`, `sqrtPriceX96`, `liquidity`, `tick`, `sender`, `recipient`
* **Mint**: `tickLower`, `tickUpper`, `amount`
* **Burn**: `tickLower`, `tickUpper`, `amount`
* Per event also capture: `blockNumber`, `timestamp`, `txHash`, `logIndex`, `pool`.

> These three event types are enough for v0 price/vol and a first liquidity score. Tick-level depth can be added later.

### 2.3 CSV Schemas

**`swaps.csv`**

* `blockNumber:int`
* `timestamp:ISO8601`
* `txHash:str`
* `pool:str`
* `sqrtPriceX96:str` (BigInt as string)
* `liquidity:str` (BigInt as string; pool L at event)
* `tick:int`
* `amount0:str`
* `amount1:str`

**`mints.csv` / `burns.csv`**

* `blockNumber:int`
* `timestamp:ISO8601`
* `txHash:str`
* `pool:str`
* `tickLower:int`
* `tickUpper:int`
* `amount:str`

---

## 3) Price & Volatility (v0)

### 3.1 Price from `sqrtPriceX96`

Let token0 decimals = `d0`, token1 decimals = `d1`. Pool price as **token0 per token1**:

$$
P_t = \left(\frac{\text{sqrtPriceX96}_t}{2^{96}}\right)^2 \cdot 10^{d_0 - d_1}
$$

Keep all math in BigInt/decimal (avoid JS float drift).

### 3.2 Returns & Realized Vol

* Resample to fixed interval (e.g., 1m or 5m) using last-seen price.
* Log return: $r_t = \ln P_t - \ln P_{t-1}$
* Rolling realized volatility over window $W$ (e.g., 24h of 1m bars):

$$
\sigma_{rv} = \sqrt{\sum_{t\in W} r_t^2} \cdot \sqrt{\frac{\text{annualization}}{\text{bars per year}}}
$$

* Jump proxy: $J = \frac{1}{|W|}\sum \mathbf{1}\{|r_t| > 3\hat\sigma\}$ (use in VS).

---

## 4) Liquidity Health Score (LHS v0)

**Intent:** A normalized 0–100 score combining price impact, liquidity stability, and LP churn. Compute per pool (or per token).

### 4.1 Components (compute over rolling window $W$, e.g., 24h)

* **Impact per notional (I):**
  For each swap, estimate micro-price change per notional:

  $$
  i_t = \frac{|\Delta \ln P_t|}{\text{notional}_t}
  $$

  with $\text{notional}_t \approx |amount1_t|$ valued in token1 units (or convert to USD if stable). Use median across $W$: $I=\text{median}(i_t)$. Lower is better (less impact for same size).
* **Liquidity stability (S):**
  Inverse volatility of pool liquidity:

  $$
  S = \frac{1}{1+\text{stdev}(\Delta \ln L_t)}
  $$

  where $L_t$ = pool `liquidity` at swaps. Higher is better.
* **LP churn (C):**
  Net outflow ratio from `Mint`/`Burn`:

  $$
  C = \frac{1}{1+\max(0,\ \text{burned} - \text{minted}) / (1+\text{minted})}
  $$

  Higher is better (less net outflow).

### 4.2 Normalization & Score

* Cross-sectionally normalize each component to $[0,1]$ within the token set using robust ranks or winsorized z-scores.
* Combine:

$$
\text{LHS} = 100 \cdot ( w_I \cdot (1-\hat I) + w_S \cdot \hat S + w_C \cdot \hat C )
$$

Default weights: $w_I=0.5, w_S=0.3, w_C=0.2$.

> Later: replace `I` with deterministic slippage at ±bps using tick depth; add **liquidity concentration** (share of L within ±X bps).

---

## 5) Volatility Score (VS v0)

Normalize to 0–100 where **higher = riskier**.

* Base: realized vol $\sigma_{rv}$ from §3.2 (rank-normalized).
* Jumps: $J$ from §3.2 (rank-normalized).
* Combine:

$$
\text{VS} = 100 \cdot \text{rank}(\alpha \cdot \hat\sigma_{rv} + (1-\alpha)\cdot \hat J)
$$

Default $\alpha = 0.7$.

> Later: blend in implied vol proxies (if available), funding rates, liquidations, and net stablecoin flows into a **market regime index**.

---

## 6) LP Tokens as Hedges (v0)

**Goal:** Show whether an LP position behaves like a fee-earning short-vol overlay vs spot.

### 6.1 Simplified Range Simulation

Given a target token pair and center price $P_0$:

* Choose symmetric width ±$r\%$ in price (convert to ticks).
* Track position value + accumulated fees over time:

  * Fees: pro-rata from observed swap volumes within range.
  * Impermanent loss (IL): mark-to-market vs HODL at each step.
* Output series: `LP_PnL`, `Fees`, `IL`, `LP_vs_HODL`, `time_in_range`.

### 6.2 Parameter Sweep

* Width $r \in \{1\%, 2.5\%, 5\%, 10\%\}$
* Re-center policy: (i) never, (ii) when out-of-range for X mins, (iii) periodic.
* Compare variance, drawdown, and correlation vs spot.

---

## 7) Liquidity- & Vol-Informed Allocation (v0)

Daily (or hourly) rebalancing; long-only; hard cap per asset $w_{\max}$.

$$
w_i \propto \frac{\text{LHS}_i^\alpha}{\text{VS}_i^\beta}, \quad
\sum_i w_i = 1,\ \ 0 \le w_i \le w_{\max}
$$

Defaults: $\alpha=1, \beta=1, w_{\max}=0.25$.

**Turnover penalty / cost model**

* Estimate execution cost from your swap history: median slippage for a fixed notional.
* Penalize trades if expected cost > incremental risk-adjusted benefit.
* Track realized performance: return, volatility, Sharpe, max DD, Calmar, turnover, average trade cost.

---

## 8) Implementation Steps

### 8.1 Config

`/squid/src/config.ts`

* `CHAIN_RPC`, `ARCHIVE_GATEWAY` (read from env)
* `POOLS: string[]`
* `DECIMALS: Record<pool, {d0:number; d1:number}>`
* Window sizes: `W_VOL`, `W_LHS`, resampling interval.

### 8.2 CSV Store & Schemas

`/squid/src/tables.ts`

* Define `Swaps`, `Mints`, `Burns` CSV tables (no headers, append mode).
* Chunk size (e.g., 100MB).

### 8.3 Processor

`/squid/src/processor.ts`

* Batch processor subscribing to `Swap`, `Mint`, `Burn` for `POOLS`.
* Decode logs, write CSV rows (avoid bignum → float).
* Idempotency: derive a unique key `txHash|logIndex` if needed.
* Basic metrics counters (events processed, throughput).

### 8.4 Helpers

`/squid/src/math.ts`

* `priceFromSqrtX96(sqrtX96: bigint, d0: number, d1: number): Decimal`
* `asDecimal(bi: bigint, decimals: number): Decimal`
* Rolling aggregators (efficient single-pass Welford where needed).

### 8.5 Scripts (Node)

`/analysis/metrics.ts`

* Load CSVs → resample price → compute `σ_rv`, `J`, `LHS`, `VS`.
* Output `scores.parquet` (or CSV) with columns: `pool`, `ts`, `price`, `sigma_rv`, `J`, `LHS`, `VS`.

`/analysis/backtest.ts`

* Read `scores` + optional spot price (for P\&L).
* Implement allocation rule, turnover penalty, and reporting.
* If hedging enabled: blend spot + LP overlay results.

---

## 9) Data Contracts (Outputs)

**`prices_{pool}.csv`**

* `ts, price, ret, rv_window, sigma_rv, jumps_J`

**`scores_{pool}.csv`**

* `ts, LHS, VS, components: I, S, C`

**`lp_sim_{pool}_{r}.csv`**

* `ts, LP_value, Fees, IL, LP_vs_HODL, in_range`

**`allocations.csv`**

* `ts, asset, weight_pre_cost, weight_post_cost, turnover_est, exec_cost_est`

**`perf.csv`**

* `ts, portfolio_value, daily_ret, drawdown, vol_ann, sharpe, calmar`

---

## 10) Testing & Validation

* **Unit tests (math):** price conversion from known ticks; BigInt rounding invariants.
* **Sanity checks (data):** monotone timestamps per pool; no duplicate `(txHash,logIndex)`; non-negative fees; bounds on returns.
* **Backtest hygiene:** no look-ahead; resampling uses info up to `ts`; costs applied at trade time.

---

## 11) “Crypto VIX” Prototype (M4+)

* Inputs (hourly/daily): realized vol (per major assets), funding rates (perp venues), liquidation counts/notional, stablecoin netflows, options-implied vol (if accessible).
* Standardize each series to z-scores; combine via fixed weights or PCA(1) to an index in $[0,100]$ after min-max scaling.
* Use index as a regime switch (risk-on/off) overlay on the allocation rule.

---

## 12) Configuration & Env

`.env.example`

```
RPC_ENDPOINT=
ARCHIVE_GATEWAY=
POOLS=0xPOOL_A,0xPOOL_B
DECIMALS_TOKEN0=18
DECIMALS_TOKEN1=6
RESAMPLE_SEC=60
WINDOW_VOL_MIN=1440
WINDOW_LHS_MIN=1440
```

---

## 13) Performance & Scaling

* Start with CSV sinks; once stable, switch to a columnar store (Parquet) or a simple DB for joins.
* Use batching and minimal decoding; avoid JSON stringify in hot paths.
* Profile: measure events/sec and I/O; keep `data/` out of git.

---

## 14) Extensions (Next)

* **Tick-level depth:** reconstruct liquidity at ±X bps to compute deterministic slippage curves.
* **Cross-chain:** replicate processor with chain-specific gateways; harmonize timestamps to UTC then local reporting.
* **Token-level scores:** aggregate pool scores to token scores (liquidity-weighted).
* **Risk parity variant:** use `1/VS` as target risk weights, gated by LHS floor.
* **Execution:** add a simple TWAP simulator using historical swaps to price rebalances.

---

## 15) Deliverables (per Milestone)

* **M0:** `/data/{swaps,mints,burns}.csv`, `/analysis/prices_*.csv`, plotting notebook (optional).
* **M1:** `/analysis/scores_*.csv` with LHS/VS; comparison table across pools.
* **M2:** `/analysis/lp_sim_*.csv` + summary (avg return, vol, DD, time-in-range).
* **M3:** `/analysis/allocations.csv`, `/analysis/perf.csv`, report with KPIs.
* **M4:** regime index file + overlay backtest.

---

## 16) Risks & Pitfalls

* Price series built from sparse swap events → resampling must be explicit.
* BigInt/decimal handling (no JS float) for `sqrtPriceX96`, liquidity, and fees.
* Liquidity field on `Swap` is pool-level at event, not depth at ±bps (v0 approximation).
* Avoid survivorship bias: include quiet windows and out-of-range periods for LP sims.
* Transaction cost model strongly affects turnover; calibrate from your own swap data.

---

## 17) Checklists

**M0 Done When:**

* [ ] Indexer runs and produces non-empty CSVs for chosen pools
* [ ] Price series plots look sane; realized vol computed without NaNs
* [ ] Tests pass for price conversion and return calc

**M1 Done When:**

* [ ] LHS, VS computed hourly/daily for ≥3 pools
* [ ] Rank ordering matches intuition (deep pools score higher LHS, lower VS)

**M2 Done When:**

* [ ] LP vs HODL comparison table across widths $r$
* [ ] Time-in-range and recenter policy sensitivity reported

**M3 Done When:**

* [ ] Allocation rule with costs; turnover < threshold
* [ ] Portfolio improves Sharpe or drawdown vs baseline

---

## 18) Minimal Snippets

**Price helper (TypeScript)**

```ts
import { Decimal } from 'decimal.js'

export function priceFromSqrtX96(sqrtX96: bigint, d0: number, d1: number): Decimal {
  const Q96 = new Decimal(2).pow(96)
  const s = new Decimal(sqrtX96.toString())
  return s.div(Q96).pow(2).mul(new Decimal(10).pow(d0 - d1))
}
```

**Simple realized vol (Node script)**

```ts
// input: prices.csv (ts,price)
// output: prices_with_vol.csv (ts,price,ret,sigma_rv)
```

(Implement with rolling windows; store as CSV/Parquet.)

---

## 19) Documentation Notes

Keep `/docs/NOTES.md` updated with:

* Exact pool addresses & token decimals used
* Any deviations from formulas above
* Known issues (e.g., outliers, data gaps) and mitigation

---

**End of plan.**
