import type { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-viem";
import "@nomicfoundation/hardhat-verify";
import { vars } from "hardhat/config";
import { defineChain } from "viem";

export const polkadotHubTestnet = defineChain({
	id: 420420417,
	name: "Polkadot Hub TestNet",
	nativeCurrency: { name: "Unit", symbol: "UNIT", decimals: 18 },
	rpcUrls: {
		default: { http: ["https://services.polkadothub-rpc.com/testnet"] },
	},
});

/**
 * Pick an account source for testnet deploys, in this priority:
 *   1. MNEMONIC env var or hardhat var (Talisman / MetaMask seed phrase)
 *   2. PRIVATE_KEY env var or hardhat var
 *   3. Empty (deploys will fail until configured)
 *
 * Talisman only exports mnemonics; MNEMONIC is the recommended path. Use the
 * default BIP44 Ethereum derivation `m/44'/60'/0'/0/0` to match Talisman's
 * Ethereum account.
 */
function resolveAccounts() {
	const mnemonic = process.env.MNEMONIC ?? vars.get("MNEMONIC", "");
	if (mnemonic) {
		return {
			mnemonic,
			path: "m/44'/60'/0'/0/0",
			initialIndex: 0,
			count: 1,
		};
	}
	const pk = process.env.PRIVATE_KEY ?? vars.get("PRIVATE_KEY", "");
	return [pk].filter(Boolean);
}

const config: HardhatUserConfig = {
	solidity: "0.8.28",
	networks: {
		local: {
			// Local node Ethereum RPC endpoint
			url: process.env.ETH_RPC_HTTP || "http://127.0.0.1:8545",
			accounts: [
				// Alice dev account private key
				"0x5fb92d6e98884f76de468fa3f6278f8807c48bebc13595d45af5bdc4da702133",
			],
		},
		polkadotTestnet: {
			url: "https://services.polkadothub-rpc.com/testnet",
			chainId: 420420417,
			accounts: resolveAccounts(),
		},
	},
	etherscan: {
		apiKey: {
			polkadotTestnet: "no-api-key-needed",
		},
		customChains: [
			{
				network: "polkadotTestnet",
				chainId: 420420417,
				urls: {
					apiURL: "https://blockscout-testnet.polkadot.io/api",
					browserURL: "https://blockscout-testnet.polkadot.io/",
				},
			},
		],
	},
};

export default config;
