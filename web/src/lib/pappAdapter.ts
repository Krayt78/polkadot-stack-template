import {
	createPappAdapter,
	SS_PASEO_STABLE_STAGE_ENDPOINTS,
	type PappAdapter,
} from "@novasamatech/host-papp";
import { createLazyClient } from "@novasamatech/statement-store";
import { getWsProvider } from "polkadot-api/ws-provider/web";

const APP_ID = "polkadot-stack-template";

let cached: PappAdapter | null = null;

function resolveMetadataUrl(): string {
	if (typeof window !== "undefined") {
		return `${window.location.origin}/papp-metadata.json`;
	}
	return "/papp-metadata.json";
}

export function getPappAdapter(): PappAdapter {
	if (cached) return cached;
	// host-papp's default Statement Store endpoint (pop3-testnet.parity-lab.parity.io)
	// is dead (502); pin to the Paseo People endpoint that PWallet itself uses.
	const lazyClient = createLazyClient(
		getWsProvider({
			endpoints: [...SS_PASEO_STABLE_STAGE_ENDPOINTS],
			heartbeatTimeout: 120_000,
		}),
	);
	cached = createPappAdapter({
		appId: APP_ID,
		metadata: resolveMetadataUrl(),
		hostMetadata: {
			hostVersion: "0.1.0",
			osType: typeof navigator !== "undefined" ? navigator.platform : "web",
		},
		adapters: { lazyClient },
	});
	return cached;
}
