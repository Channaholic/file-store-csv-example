import * as erc20abi from './abi/erc20'
import {Database, LocalDest} from '@subsquid/file-store'
import {Column, Table, Types, dialects} from '@subsquid/file-store-csv'

import {processor, STABLECOIN_CONTRACTS, STABLECOIN_DECIMALS, MIN_BALANCE_THRESHOLD} from './processor'

// In-memory balance tracking with periodic cleanup
const balances = new Map<string, Map<string, bigint>>()
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

// Helper function to normalize token value to USD (assuming 1:1 for stablecoins)
function normalizeToUSD(value: bigint, decimals: number): number {
	// Use string conversion to avoid precision loss for very large numbers
	const divisor = BigInt(10 ** decimals)
	const wholePart = value / divisor
	const fractionalPart = value % divisor
	return Number(wholePart) + Number(fractionalPart) / Number(divisor)
}

// Helper function to check if balance meets minimum threshold
function meetsThreshold(value: bigint, decimals: number): boolean {
	return normalizeToUSD(value, decimals) >= MIN_BALANCE_THRESHOLD
}

const dbOptions = {
	tables: {
		// Original transfers table
		TransfersTable: new Table(
			'transfers.tsv',
			{
				block: Column(Types.Numeric()),
				timestamp: Column(Types.Numeric()),
				token: Column(Types.String()),
				from: Column(Types.String()),
				to: Column(Types.String()),
				value: Column(Types.Numeric()),
				value_usd: Column(Types.Numeric())
			},
			{
				dialect: dialects.excelTab,
				header: true
			}
		),
		// New balances table
		BalancesTable: new Table(
			'balances.tsv',
			{
				block: Column(Types.Numeric()),
				timestamp: Column(Types.Numeric()),
				address: Column(Types.String()),
				token: Column(Types.String()),
				balance: Column(Types.Numeric()),
				balance_usd: Column(Types.Numeric())
			},
			{
				dialect: dialects.excelTab,
				header: true
			}
		),
		// Summary table with total balances per address
		SummaryTable: new Table(
			'summary.tsv',
			{
				block: Column(Types.Numeric()),
				timestamp: Column(Types.Numeric()),
				address: Column(Types.String()),
				total_balance_usd: Column(Types.Numeric()),
				token_count: Column(Types.Numeric())
			},
			{
				dialect: dialects.excelTab,
				header: true
			}
		)
	},
	dest: new LocalDest('./data'),
	chunkSizeMb: 10,
	syncIntervalBlocks: 1000 // Sync every 1000 blocks for balance updates
}

processor.run(new Database(dbOptions), async (ctx) => {
	for (let block of ctx.blocks) {
		const blockTimestamp = block.header.timestamp
		
		// Process all transfer events in this block
		for (let log of block.logs) {
			if (log.topics[0] === erc20abi.events.Transfer.topic) {
				// Find which stablecoin this transfer belongs to
				const tokenName = Object.keys(STABLECOIN_CONTRACTS).find(
					name => STABLECOIN_CONTRACTS[name as keyof typeof STABLECOIN_CONTRACTS] === log.address
				)
				
				if (tokenName) {
					const { from, to, value } = erc20abi.events.Transfer.decode(log)
					const decimals = STABLECOIN_DECIMALS[tokenName as keyof typeof STABLECOIN_DECIMALS]
					const valueUSD = normalizeToUSD(value, decimals)
					
					// Skip zero-value transfers
					if (value === BigInt(0)) continue
					
					// Record the transfer
					ctx.store.TransfersTable.write({
						block: block.header.height,
						timestamp: blockTimestamp,
						token: tokenName,
						from,
						to,
						value: value,
						value_usd: valueUSD
					})
					
					// Update balances using double-entry bookkeeping
					// Skip zero address to avoid tracking mint/burn operations
					if (from !== ZERO_ADDRESS) {
						updateBalance(from, tokenName, -value, decimals, block.header.height, blockTimestamp, ctx as any)
					}
					if (to !== ZERO_ADDRESS) {
						updateBalance(to, tokenName, value, decimals, block.header.height, blockTimestamp, ctx as any)
					}
				}
			}
		}
		
		// Write summary and cleanup memory every 1000 blocks
		if (block.header.height % 1000 === 0) {
			writeSummary(block.header.height, blockTimestamp, ctx as any)
			cleanupMemory()
		}
	}
})

function updateBalance(
	address: string, 
	token: string, 
	delta: bigint, 
	decimals: number,
	blockHeight: number,
	timestamp: number,
	ctx: { store: { BalancesTable: { write: (data: any) => void } } }
) {
	// Initialize address balance map if it doesn't exist
	if (!balances.has(address)) {
		balances.set(address, new Map())
	}
	
	const addressBalances = balances.get(address)!
	
	// Get current balance or initialize to 0
	const currentBalance = addressBalances.get(token) || BigInt(0)
	const newBalance = currentBalance + delta
	
	// Update the balance
	addressBalances.set(token, newBalance)
	
	// Clean up zero balances from memory
	if (newBalance === BigInt(0)) {
		addressBalances.delete(token)
		// If address has no tokens left, remove the entire address entry
		if (addressBalances.size === 0) {
			balances.delete(address)
		}
	}
	
	// Only write significant balance changes (threshold changes or periodic updates)
	if (meetsThreshold(newBalance, decimals)) {
		const balanceUSD = normalizeToUSD(newBalance, decimals)
		
		ctx.store.BalancesTable.write({
			block: blockHeight,
			timestamp,
			address,
			token,
			balance: newBalance,
			balance_usd: balanceUSD
		})
	}
}

function writeSummary(blockHeight: number, timestamp: number, ctx: { store: { SummaryTable: { write: (data: any) => void } } }) {
	for (const [address, tokenBalances] of balances.entries()) {
		let totalBalanceUSD = 0
		let tokenCount = 0
		
		// Calculate total balance across all tokens
		for (const [token, balance] of tokenBalances.entries()) {
			const decimals = STABLECOIN_DECIMALS[token as keyof typeof STABLECOIN_DECIMALS]
			const balanceUSD = normalizeToUSD(balance, decimals)
			
			if (meetsThreshold(balance, decimals)) {
				totalBalanceUSD += balanceUSD
				tokenCount++
			}
		}
		
		// Only write summary if total balance meets threshold
		if (totalBalanceUSD >= MIN_BALANCE_THRESHOLD) {
			ctx.store.SummaryTable.write({
				block: blockHeight,
				timestamp,
				address,
				total_balance_usd: totalBalanceUSD,
				token_count: tokenCount
			})
		}
	}
}

// Cleanup function to manage memory usage
function cleanupMemory() {
	// Remove addresses with balances below threshold from memory to prevent memory bloat
	const addressesToRemove = []
	
	for (const [address, tokenBalances] of balances.entries()) {
		let totalBalanceUSD = 0
		
		for (const [token, balance] of tokenBalances.entries()) {
			const decimals = STABLECOIN_DECIMALS[token as keyof typeof STABLECOIN_DECIMALS]
			const balanceUSD = normalizeToUSD(balance, decimals)
			totalBalanceUSD += balanceUSD
		}
		
		// Mark for removal if total balance is below threshold
		if (totalBalanceUSD < MIN_BALANCE_THRESHOLD) {
			addressesToRemove.push(address)
		}
	}
	
	// Remove low-balance addresses from memory
	for (const address of addressesToRemove) {
		balances.delete(address)
	}
	
	console.log(`Memory cleanup: removed ${addressesToRemove.length} low-balance addresses. Active addresses: ${balances.size}`)
}
