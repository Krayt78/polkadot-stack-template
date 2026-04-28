export type HostEnvironment = "desktop-webview" | "web-iframe" | "standalone";

/**
 * Detect whether the dApp is running inside a Polkadot Host shell (e.g. dot.li
 * loads us in a sandboxed iframe; a desktop wallet may set the WEBVIEW marker).
 */
export function detectHostEnvironment(): HostEnvironment {
	if (typeof window === "undefined") return "standalone";
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	if ((window as any).__HOST_WEBVIEW_MARK__) return "desktop-webview";
	try {
		if (window !== window.top) return "web-iframe";
	} catch {
		return "web-iframe";
	}
	return "standalone";
}

export function isInHost(): boolean {
	return detectHostEnvironment() !== "standalone";
}
