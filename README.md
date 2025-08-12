# Stablecoin Balance Indexer

This enhanced blockchain indexer tracks **all major stablecoin transfers** on Ethereum and computes **running balances** for all addresses, similar to the BigQuery double-entry bookkeeping approach. It filters out addresses with balances below $1 USD.

## Supported Stablecoins

- **USDC** (6 decimals)
- **USDT** (6 decimals) 
- **DAI** (18 decimals)
- **BUSD** (18 decimals)
- **FRAX** (18 decimals)
- **TUSD** (18 decimals)
- **USDP** (6 decimals)
- **LUSD** (18 decimals)
- **GUSD** (2 decimals)
- **alUSD** (18 decimals)

## How It Works

### Double-Entry Bookkeeping Logic
Similar to the BigQuery example, this squid implements proper double-entry bookkeeping:

1. **Debits**: When tokens are sent FROM an address, the balance decreases
2. **Credits**: When tokens are sent TO an address, the balance increases
3. **Running Balances**: Maintains cumulative balances for all addresses across all stablecoins

### Data Output

The squid creates three TSV files in the `./data/` directory:

#### 1. `transfers.tsv` - All Transfer Events
```
block	timestamp	token	from	to	value	value_usd
1234567	1640995200	USDC	0x123...	0x456...	1000000	1.0
1234568	1640995260	USDT	0x789...	0xabc...	5000000	5.0
```

#### 2. `balances.tsv` - Individual Token Balances
```
block	timestamp	address	token	balance	balance_usd
1234567	1640995200	0x123...	USDC	5000000	5.0
1234567	1640995200	0x456...	USDT	10000000	10.0
```

#### 3. `summary.tsv` - Total Balances Per Address
```
block	timestamp	address	total_balance_usd	token_count
1234567	1640995200	0x123...	15.0	2
1234567	1640995200	0x456...	25.5	3
```

## Key Features

- **$1 Minimum Threshold**: Only tracks addresses with balances ≥ $1 USD
- **Multi-Token Support**: Tracks 10 major stablecoins simultaneously
- **Real-time Processing**: Processes blocks as they're indexed
- **Memory Efficient**: Uses in-memory balance tracking with periodic file writes
- **Proper Decimals**: Handles different decimal places for each token correctly

## Installation & Usage

```bash
# Install dependencies
npm install

# Build the project
npm run build

# Start the processor
sqd process
```

## Data Analysis Examples

### Find Top Holders
```bash
# Sort summary by total balance
sort -t$'\t' -k4 -nr data/*/summary.tsv | head -10
```

### Get USDC Balances Only
```bash
# Filter balances for USDC
grep "USDC" data/*/balances.tsv | sort -t$'\t' -k5 -nr | head -10
```

### Find Addresses with Multiple Stablecoins
```bash
# Filter addresses holding 3+ different stablecoins
awk -F'\t' '$5 >= 3' data/*/summary.tsv | sort -t$'\t' -k4 -nr
```

## Performance Considerations

- **Memory Management**: Automatic cleanup of low-balance addresses every 1000 blocks
- **Zero Address Filtering**: Excludes mint/burn operations (zero address transfers)
- **Precision Handling**: Uses BigInt arithmetic to avoid floating-point precision loss
- **File Sync**: Data is written to files every 1000 blocks
- **Threshold Filtering**: Only addresses meeting the $1 threshold are persisted
- **Partitioning**: Data is automatically partitioned by block ranges

## Comparison with BigQuery

This squid provides similar functionality to the BigQuery query you referenced:

**BigQuery Approach:**
- Uses `crypto_ethereum.traces` and `crypto_ethereum.transactions`
- Computes ETH balances with transaction fees
- Runs on Google's infrastructure

**This Squid:**
- Uses ERC-20 Transfer events directly
- Computes stablecoin balances (not ETH)
- Runs locally with file-based storage
- More efficient for token-specific analysis

## Dependencies

- NodeJS
- [Squid CLI](https://docs.subsquid.io/squid-cli)
- TypeScript
- Subsquid Framework packages

## License

MIT License - see LICENSE file for details.
