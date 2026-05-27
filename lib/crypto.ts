/**
 * 암호화 유틸리티
 * Ed25519 키 생성, 서명, 검증 (@noble/curves 사용)
 */
import { ed25519 } from "@noble/curves/ed25519";

export interface KeyPair {
  privateKey: string; // hex
  publicKey: string;  // hex
  did: string;        // did:key:z... 형식
}

// 새 키쌍 생성
export function generateKeyPair(): KeyPair {
  const privKey = ed25519.utils.randomPrivateKey();
  const pubKey = ed25519.getPublicKey(privKey);
  const privHex = bytesToHex(privKey);
  const pubHex = bytesToHex(pubKey);
  return {
    privateKey: privHex,
    publicKey: pubHex,
    did: `did:key:z${pubHex}`,
  };
}

// 데이터 서명 (문자열 → hex 서명)
export function signData(data: string, privateKeyHex: string): string {
  const message = new TextEncoder().encode(data);
  const privKey = hexToBytes(privateKeyHex);
  const sig = ed25519.sign(message, privKey);
  return bytesToHex(sig);
}

// 서명 검증
export function verifySignature(
  data: string,
  signatureHex: string,
  publicKeyHex: string
): boolean {
  try {
    const message = new TextEncoder().encode(data);
    const sig = hexToBytes(signatureHex);
    const pubKey = hexToBytes(publicKeyHex);
    return ed25519.verify(sig, message, pubKey);
  } catch {
    return false;
  }
}

// DID 해시 (블록체인 등록용)
export function didToBytes32(did: string): string {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(did);
  const hash = new Uint8Array(32);
  for (let i = 0; i < Math.min(bytes.length, 32); i++) {
    hash[i] = bytes[i];
  }
  return "0x" + bytesToHex(hash);
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}
