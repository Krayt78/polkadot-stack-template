import { useEffect, useState } from "react";
import { ss58Address } from "@polkadot-labs/hdkd-helpers";
import { getPolkadotSignerFromPjs } from "polkadot-api/pjs-signer";
import type { PolkadotSigner } from "polkadot-api";
import type { UserSession } from "@novasamatech/host-papp";
import { getPappAdapter } from "../lib/pappAdapter";

export type HostAccount = {
	name: string;
	address: string; // SS58
	signer: PolkadotSigner;
	session: UserSession;
};

function bytesToHex(bytes: Uint8Array): `0x${string}` {
	let s = "0x";
	for (const b of bytes) s += b.toString(16).padStart(2, "0");
	return s as `0x${string}`;
}

function hexToBytes(hex: string): Uint8Array {
	const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
	const out = new Uint8Array(clean.length / 2);
	for (let i = 0; i < out.length; i++) {
		out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
	}
	return out;
}

/**
 * Wrap a host-papp UserSession as a polkadot-api PolkadotSigner so PAPI's
 * signAndSubmit (and therefore reviveCall) can use it transparently.
 */
function makeHostSigner(session: UserSession, address: string): PolkadotSigner {
	const signPayload = async (
		p: import("polkadot-api/pjs-signer").SignerPayloadJSON,
	): Promise<{ signature: string; signedTransaction?: string | Uint8Array }> => {
		const result = await session.signPayload({
			address: p.address,
			blockHash: p.blockHash as `0x${string}`,
			blockNumber: p.blockNumber as `0x${string}`,
			era: p.era as `0x${string}`,
			genesisHash: p.genesisHash as `0x${string}`,
			method: p.method as `0x${string}`,
			nonce: p.nonce as `0x${string}`,
			specVersion: p.specVersion as `0x${string}`,
			tip: p.tip as `0x${string}`,
			transactionVersion: p.transactionVersion as `0x${string}`,
			signedExtensions: p.signedExtensions,
			version: p.version,
			assetId: p.assetId as `0x${string}` | undefined,
			metadataHash: p.metadataHash as `0x${string}` | undefined,
			mode: p.mode,
			withSignedTransaction: p.withSignedTransaction,
		});
		return result.match(
			(data) => ({
				signature: bytesToHex(data.signature),
				signedTransaction: data.signedTransaction ? data.signedTransaction : undefined,
			}),
			(err) => {
				throw err;
			},
		);
	};

	const signRaw = async (req: {
		address: string;
		data: string;
		type: "bytes";
	}): Promise<{ id: number; signature: `0x${string}` }> => {
		const bytes = hexToBytes(req.data);
		const result = await session.signRaw({
			address: req.address,
			data: { tag: "Bytes", value: bytes },
		});
		return result.match(
			(data) => ({ id: 0, signature: bytesToHex(data.signature) }),
			(err) => {
				throw err;
			},
		);
	};

	return getPolkadotSignerFromPjs(address, signPayload, signRaw);
}

function sessionToAccount(session: UserSession): HostAccount {
	const accountId = session.remoteAccount.accountId; // Uint8Array (32 bytes)
	const ss58 = ss58Address(accountId, 42); // generic substrate prefix
	return {
		name: "PWallet",
		address: ss58,
		signer: makeHostSigner(session, ss58),
		session,
	};
}

/**
 * Subscribes to the host-papp adapter's session list and exposes any paired
 * sessions as HostAccount records ready to be used as PAPI signers.
 */
export function useHostAccounts(): HostAccount[] {
	const [accounts, setAccounts] = useState<HostAccount[]>([]);
	useEffect(() => {
		const papp = getPappAdapter();
		const initial = papp.sessions.sessions.read();
		setAccounts(initial.map(sessionToAccount));
		const unsub = papp.sessions.sessions.subscribe((sessions) => {
			setAccounts(sessions.map(sessionToAccount));
		});
		return () => unsub();
	}, []);
	return accounts;
}

/** One-shot trigger for the SSO pairing flow. The QR modal renders separately. */
export async function startHostPairing(): Promise<void> {
	const papp = getPappAdapter();
	const result = await papp.sso.authenticate();
	result.match(
		() => undefined,
		(err) => {
			console.error("[host-papp] authenticate failed:", err);
		},
	);
}

export async function disconnectHostSession(account: HostAccount): Promise<void> {
	const papp = getPappAdapter();
	const result = await papp.sessions.disconnect(account.session);
	result.match(
		() => undefined,
		(err) => {
			console.error("[host-papp] disconnect failed:", err);
		},
	);
}
