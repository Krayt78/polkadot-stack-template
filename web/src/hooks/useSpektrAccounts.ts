import { useEffect, useState } from "react";
import {
	connectInjectedExtension,
	type InjectedPolkadotAccount,
} from "polkadot-api/pjs-signer";
import { injectSpektrExtension, SpektrExtensionName } from "@novasamatech/product-sdk";
import { isInHost } from "../lib/hostEnv";

export type SpektrStatus =
	| "detecting"
	| "injecting"
	| "connected"
	| "unavailable"
	| "failed";

type SpektrSnapshot = {
	status: SpektrStatus;
	accounts: InjectedPolkadotAccount[];
};

let cachedSnapshot: SpektrSnapshot = {
	status: "detecting",
	accounts: [],
};
let initPromise: Promise<void> | null = null;
let unsub: (() => void) | null = null;
const subscribers = new Set<(snap: SpektrSnapshot) => void>();

function notify() {
	for (const cb of subscribers) cb(cachedSnapshot);
}

function setSnapshot(next: Partial<SpektrSnapshot>) {
	cachedSnapshot = { ...cachedSnapshot, ...next };
	notify();
}

async function ensureInit(): Promise<void> {
	if (initPromise) return initPromise;
	initPromise = (async () => {
		if (!isInHost()) {
			setSnapshot({ status: "unavailable", accounts: [] });
			return;
		}
		setSnapshot({ status: "injecting" });
		try {
			let injected = false;
			for (let i = 0; i < 10; i++) {
				if (await injectSpektrExtension()) {
					injected = true;
					break;
				}
				if (i < 9) await new Promise((r) => setTimeout(r, 500));
			}
			if (!injected) {
				setSnapshot({ status: "failed" });
				return;
			}
			const ext = await connectInjectedExtension(SpektrExtensionName);
			const accounts = ext.getAccounts();
			setSnapshot({ status: "connected", accounts });
			unsub?.();
			unsub = ext.subscribe((updated) => {
				setSnapshot({ accounts: updated });
			});
		} catch (e) {
			console.error("[useSpektrAccounts] init failed:", e);
			setSnapshot({ status: "failed" });
		}
	})();
	return initPromise;
}

/**
 * Reactive view of the Spektr-injected host accounts (the ones dot.li exposes
 * via `@novasamatech/product-sdk` when this dApp is loaded in its iframe).
 *
 * Init runs once globally; multiple components subscribing share the same
 * accounts list and the same wallet-side subscription.
 */
export function useSpektrAccounts(): SpektrSnapshot {
	const [snap, setSnap] = useState<SpektrSnapshot>(cachedSnapshot);
	useEffect(() => {
		subscribers.add(setSnap);
		setSnap(cachedSnapshot);
		ensureInit();
		return () => {
			subscribers.delete(setSnap);
		};
	}, []);
	return snap;
}
