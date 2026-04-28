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
	/** Optional progress callback so the UI can show "broadcast", "in block", "finalized". */
	onProgress?: (stage: string) => void;
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
	onProgress?: (stage: string) => void,
): Promise<FixedSizeBinary<20>> {
	const client = getClient(wsUrl);
	const api = client.getTypedApi(stack_template);
	const mappedH160 = await api.apis.ReviveApi.address(originSs58);
	const existing = await api.query.Revive.OriginalAccount.getValue(mappedH160);
	if (existing) {
		onProgress?.("Account already mapped, skipping registration");
		return mappedH160;
	}
	onProgress?.("Mapping account (one-time)…");
	const tx = api.tx.Revive.map_account();
	const result = await watchSubmit(tx, signer, (s) => onProgress?.(`map_account: ${s}`));
	if (!result.ok) {
		throw new Error(`Revive.map_account failed: ${JSON.stringify(result.dispatchError)}`);
	}
	return mappedH160;
}

/**
 * Submit a tx and report progress (broadcasted → in best block → finalized) to
 * the UI. Resolves when the tx is in the best block (~6s), without waiting for
 * the full finalization window (~60s on Paseo). Returns the same shape as
 * signAndSubmit so callers can keep their `result.ok` checks.
 */
async function watchSubmit(
	tx: { signSubmitAndWatch: ReturnType<typeof Object> } & {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		signSubmitAndWatch: (signer: PolkadotSigner) => any;
	},
	signer: PolkadotSigner,
	onStage: (stage: string) => void,
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any> {
	return new Promise((resolve, reject) => {
		const sub = tx.signSubmitAndWatch(signer).subscribe({
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			next: (e: any) => {
				if (e.type === "signed") onStage("signed by wallet");
				else if (e.type === "broadcasted") onStage("broadcasted to network");
				else if (e.type === "txBestBlocksState") {
					if (e.found) {
						onStage(`included in best block ${e.block.hash.slice(0, 10)}…`);
						sub.unsubscribe();
						resolve({
							ok: e.ok,
							txHash: e.txHash,
							dispatchError: e.dispatchError,
						});
					} else {
						onStage("waiting for inclusion…");
					}
				}
			},
			error: (err: unknown) => reject(err),
		});
	});
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
	const { wsUrl, signer, originSs58, contractAddress, abi, functionName, args, onProgress } =
		params;
	const value = params.value ?? 0n;

	await mapAccountIfNeeded(wsUrl, signer, originSs58, onProgress);

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

	onProgress?.(`Submitting Revive.call (${functionName})…`);
	const result = await watchSubmit(tx, signer, (s) => onProgress?.(`call: ${s}`));
	return { result, dryRun };
}
