import {EvmBatchProcessor} from '@subsquid/evm-processor'
import * as erc20abi from './abi/erc20'

// Major stablecoin contracts on Ethereum
export const STABLECOIN_CONTRACTS = {
	USDC: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'.toLowerCase(),
	USDT: '0xdAC17F958D2ee523a2206206994597C13D831ec7'.toLowerCase(),
	DAI: '0x6B175474E89094C44Da98b954EedeAC495271d0F'.toLowerCase(),
	BUSD: '0x4Fabb145d64652a948d72533023f6E7A623C7C53'.toLowerCase(),
	FRAX: '0x853d955aCEf822Db058eb8505911ED77F175b99e'.toLowerCase(),
	TUSD: '0x0000000000085d4780B73119b644AE5ecd22b376'.toLowerCase(),
	USDP: '0x8E870D67F660D95d5be530380D0eC0bd388289E1'.toLowerCase(),
	LUSD: '0x5f98805A4E8be255a32880FDeC7F6728C6568bA0'.toLowerCase(),
	GUSD: '0x056Fd409E1d7A124BD7017459dFEa2F387b6d5Cd'.toLowerCase(),
	alUSD: '0xBC6DA0FE9aD5f3b0d5818981f971d5c1b4b4c2b5'.toLowerCase()
}

// Stablecoin decimals for proper value calculation
export const STABLECOIN_DECIMALS = {
	USDC: 6,
	USDT: 6,
	DAI: 18,
	BUSD: 18,
	FRAX: 18,
	TUSD: 18,
	USDP: 6,
	LUSD: 18,
	GUSD: 2,
	alUSD: 18
}

// Minimum balance threshold in USD (1 dollar)
export const MIN_BALANCE_THRESHOLD = 1

export const processor = new EvmBatchProcessor()
	.setBlockRange({
		from: 4634748 // DAI deployment block (earliest major stablecoin)
	})
	.setGateway('https://v2.archive.subsquid.io/network/ethereum-mainnet')
	.addLog({
		address: Object.values(STABLECOIN_CONTRACTS),
		topic0: [erc20abi.events.Transfer.topic]
	})
