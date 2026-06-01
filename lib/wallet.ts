/**
 * 로컬 지갑 (localStorage 기반 오프체인 저장)
 * 실제 앱에서는 Keystore/SecureEnclave 사용
 */
import { KeyPair, generateKeyPair } from "./crypto";
import { VerifiableCredential } from "./vc";

const WALLET_KEY = "workpass_wallet";
const VCS_KEY = "workpass_vcs";

export interface WalletData {
  keyPair: KeyPair;
  role: "issuer" | "holder" | "verifier";
  name: string;
}

// 지갑 생성 또는 불러오기
export function getOrCreateWallet(role: "issuer" | "holder" | "verifier", name: string): WalletData {
  if (typeof window === "undefined") throw new Error("Browser only");
  const stored = localStorage.getItem(`${WALLET_KEY}_${role}`);
  if (stored) return JSON.parse(stored);
  const wallet: WalletData = { keyPair: generateKeyPair(), role, name };
  localStorage.setItem(`${WALLET_KEY}_${role}`, JSON.stringify(wallet));
  return wallet;
}

export function getWallet(role: "issuer" | "holder" | "verifier"): WalletData | null {
  if (typeof window === "undefined") return null;
  const stored = localStorage.getItem(`${WALLET_KEY}_${role}`);
  return stored ? JSON.parse(stored) : null;
}

export function resetWallet(role: "issuer" | "holder" | "verifier"): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(`${WALLET_KEY}_${role}`);
}

// VC 저장 (소유자 지갑) — 같은 id면 중복 저장하지 않음
export function saveVC(vc: VerifiableCredential): boolean {
  const vcs = loadVCs();
  if (vcs.some((v) => v.id === vc.id)) return false;
  vcs.push(vc);
  localStorage.setItem(VCS_KEY, JSON.stringify(vcs));
  return true;
}

export function loadVCs(): VerifiableCredential[] {
  if (typeof window === "undefined") return [];
  const stored = localStorage.getItem(VCS_KEY);
  return stored ? JSON.parse(stored) : [];
}

export function deleteVC(vcId: string): void {
  const vcs = loadVCs().filter((vc) => vc.id !== vcId);
  localStorage.setItem(VCS_KEY, JSON.stringify(vcs));
}
