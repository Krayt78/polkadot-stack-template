import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { getPappAdapter } from "../lib/pappAdapter";
import type { PairingStatus, AttestationStatus } from "@novasamatech/host-papp";

type Stage =
	| { kind: "idle" }
	| { kind: "pairing"; deeplink: string }
	| { kind: "attesting"; username?: string }
	| { kind: "finished" }
	| { kind: "error"; message: string };

function deriveStage(p: PairingStatus, a: AttestationStatus): Stage {
	if (a.step === "attestation") return { kind: "attesting", username: a.username };
	if (a.step === "attestationError") return { kind: "error", message: a.message };
	switch (p.step) {
		case "pairing":
			return { kind: "pairing", deeplink: p.payload };
		case "pairingError":
			return { kind: "error", message: p.message };
		case "finished":
			return { kind: "finished" };
		default:
			return { kind: "idle" };
	}
}

export function ConnectQRModal() {
	const [stage, setStage] = useState<Stage>({ kind: "idle" });

	useEffect(() => {
		const papp = getPappAdapter();
		let pairing = papp.sso.pairingStatus.read();
		let attest = papp.sso.attestationStatus.read();
		setStage(deriveStage(pairing, attest));
		const u1 = papp.sso.pairingStatus.subscribe((p) => {
			pairing = p;
			setStage(deriveStage(pairing, attest));
		});
		const u2 = papp.sso.attestationStatus.subscribe((a) => {
			attest = a;
			setStage(deriveStage(pairing, attest));
		});
		return () => {
			u1();
			u2();
		};
	}, []);

	const open =
		stage.kind === "pairing" || stage.kind === "attesting" || stage.kind === "error";
	if (!open) return null;

	const cancel = () => getPappAdapter().sso.abortAuthentication();

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
			<div className="card max-w-md w-full mx-4 relative">
				<button
					onClick={cancel}
					className="absolute top-3 right-3 text-text-muted hover:text-text-primary"
				>
					✕
				</button>
				<h2 className="section-title mb-2">
					{stage.kind === "pairing" && "Scan with PWallet"}
					{stage.kind === "attesting" && "Signing in"}
					{stage.kind === "error" && "Pairing failed"}
				</h2>
				{stage.kind === "pairing" && (
					<>
						<p className="text-sm text-text-secondary mb-4">
							Open PWallet on your phone and scan this code to pair.
						</p>
						<div className="bg-white p-4 flex items-center justify-center rounded">
							<QRCodeSVG value={stage.deeplink} size={256} level="M" />
						</div>
						<p className="text-xs text-text-muted mt-3 break-all font-mono">
							{stage.deeplink}
						</p>
					</>
				)}
				{stage.kind === "attesting" && (
					<p className="text-sm text-text-secondary">
						Verifying credentials{stage.username ? ` for ${stage.username}` : ""}…
					</p>
				)}
				{stage.kind === "error" && (
					<>
						<p className="text-sm text-accent-red mb-4">{stage.message}</p>
						<button onClick={cancel} className="btn-secondary">
							Close
						</button>
					</>
				)}
			</div>
		</div>
	);
}
