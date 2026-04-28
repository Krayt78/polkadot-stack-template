import { type Abi, type Address, encodeFunctionData } from "viem";
import { Binary, FixedSizeBinary, type PolkadotSigner } from "polkadot-api";
import { stack_template } from "@polkadot-api/descriptors";
import { getClient } from "./useChain";

export type ReviveCallParams = {
	wsUrl: string;
	signer: PolkadotSigner;
	originSs58: string;
	contractAddress: Address;
	abi: Abi;
	functionName: string;
	args: readonly unknown[];
	value?: bigint;
};

function h160ToBytes(addr: string): FixedSizeBinary<20> {
	const hex = addr.startsWith("0x") ? addr.slice(2) : addr;
	if (hex.length !== 40) {
		throw new Error(`Expected 20-byte H160, got ${hex.length / 2} bytes`);
	}
	const bytes = new Uint8Array(20);
	for (let i = 0; i < 20; i++) {
		bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
	}
	return FixedSizeBinary.fromBytes(bytes);
}

/**
 * One-time mapping of an sr25519 AccountId32 → H160 in pallet-revive's address mapper.
 * Required before that account can be the origin of `Revive.call`. Returns the mapped
 * H160 either way (fresh map or already-registered).
 */
export async function mapAccountIfNeeded(
	wsUrl: string,
	signer: PolkadotSigner,
	originSs58: string,
): Promise<FixedSizeBinary<20>> {
	const client = getClient(wsUrl);
	const api = client.getTypedApi(stack_template);
	const mappedH160 = await api.apis.ReviveApi.address(originSs58);
	const existing = await api.query.Revive.OriginalAccount.getValue(mappedH160);
	if (existing) return mappedH160;
	const tx = api.tx.Revive.map_account();
	const result = await tx.signAndSubmit(signer);
	if (!result.ok) {
		throw new Error(`Revive.map_account failed: ${JSON.stringify(result.dispatchError)}`);
	}
	return mappedH160;
}

/**
 * Submit an EVM contract call by wrapping it in a substrate `pallet_revive::call`
 * extrinsic and signing it with a substrate (sr25519) signer. The contract sees
 * `msg.sender` as the revive-mapped H160 of the substrate account.
 *
 * Steps:
 *   1. Ensure the substrate origin is registered with the address mapper
 *      (pallet-revive rejects calls from unmapped accounts).
 *   2. Encode the call data via viem (using the contract ABI).
 *   3. Dry-run via `ReviveApi.call` to estimate gas + storage deposit and
 *      surface contract reverts before signing.
 *   4. Build `Revive.call` with the dry-run-derived limits.
 *   5. signAndSubmit with the provided substrate signer.
 */
export async function reviveCall(params: ReviveCallParams) {
	const { wsUrl, signer, originSs58, contractAddress, abi, functionName, args } = params;
	const value = params.value ?? 0n;

	await mapAccountIfNeeded(wsUrl, signer, originSs58);

	const callData = encodeFunctionData({
		abi,
		functionName,
		args: args as readonly unknown[] as never,
	});
	const data = Binary.fromHex(callData);
	const dest = h160ToBytes(contractAddress);

	const client = getClient(wsUrl);
	const api = client.getTypedApi(stack_template);

	// Dry-run: estimate gas + storage deposit, catch reverts early.
	const dryRun = await api.apis.ReviveApi.call(
		originSs58,
		dest,
		value,
		undefined, // gas_limit: let the runtime use the block max
		undefined, // storage_deposit_limit: unbounded for the dry-run
		data,
	);
	if (!dryRun.result.success) {
		const err = dryRun.result.value;
		throw new Error(`Revive dry-run failed: ${JSON.stringify(err)}`);
	}

	// Pallet-revive returns `gas_required` as Weight; copy it across to weight_limit.
	const weight_limit = {
		ref_time: dryRun.weight_required.ref_time,
		proof_size: dryRun.weight_required.proof_size,
	};
	// storage_deposit can be Refund (no extra deposit needed) or Charge (need at
	// least that much). We pass an explicit limit only when there is a charge.
	const storage_deposit_limit =
		dryRun.storage_deposit.type === "Charge" ? dryRun.storage_deposit.value : 0n;

	const tx = api.tx.Revive.call({
		dest,
		value,
		weight_limit,
		storage_deposit_limit,
		data,
	});

	const result = await tx.signAndSubmit(signer);
	return { result, dryRun };
}
