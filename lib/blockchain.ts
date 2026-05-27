/**
 * 블록체인 연결 유틸리티
 * ethers.js v6 — 읽기: JsonRpcProvider, 쓰기: MetaMask Signer (또는 fallback)
 *
 * 온체인 저장 내용:
 *   - DIDRegistry: 발행자 DID → Ed25519 공개키 (개인정보 없음)
 *   - StatusRegistry: listId → index → 폐기 여부 (개인정보 없음)
 */
import { ethers } from "ethers";

const HARDHAT_RPC = "https://ethereum-sepolia-rpc.publicnode.com";

// DIDRegistry ABI
const DID_REGISTRY_ABI = [
  "function registerIssuer(bytes32 didHash, bytes calldata pubKey) external",
  "function resolveKey(bytes32 didHash) external view returns (bytes memory)",
  "function isRegistered(bytes32 didHash) external view returns (bool)",
  "event IssuerRegistered(bytes32 indexed didHash, address indexed controller)",
];

// StatusRegistry ABI
const STATUS_REGISTRY_ABI = [
  "function createStatusList() external returns (uint256 listId)",
  "function revoke(uint256 listId, uint256 index, string calldata reason) external",
  "function isRevoked(uint256 listId, uint256 index) external view returns (bool)",
  "event StatusListCreated(uint256 indexed listId, address indexed owner)",
  "event Revoked(uint256 indexed listId, uint256 index, string reason)",
];

export interface ContractAddresses {
  DIDRegistry: string;
  StatusRegistry: string;
}

async function loadAddresses(): Promise<ContractAddresses> {
  const res = await fetch("/contract-addresses.json");
  if (!res.ok) throw new Error("컨트랙트 주소 파일 없음. 'npm run deploy' 먼저 실행하세요.");
  return res.json();
}

// 읽기 전용 provider (MetaMask 없이도 동작)
function getReadProvider(): ethers.JsonRpcProvider {
  return new ethers.JsonRpcProvider(HARDHAT_RPC);
}

// 노드 연결 상태 확인
export async function checkConnection(): Promise<{ connected: boolean; blockNumber?: number; error?: string }> {
  try {
    const blockNumber = await getReadProvider().getBlockNumber();
    return { connected: true, blockNumber };
  } catch {
    return { connected: false, error: "Sepolia 네트워크에 연결할 수 없습니다. 인터넷 연결을 확인하세요." };
  }
}

function didToBytes32(did: string): string {
  return ethers.keccak256(ethers.toUtf8Bytes(did));
}

function pubKeyToBytes(pubKeyHex: string): Uint8Array {
  const clean = pubKeyHex.startsWith("0x") ? pubKeyHex.slice(2) : pubKeyHex;
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

// ─────────────────────────────────────────────
// DID Registry
// ─────────────────────────────────────────────

// 발행자 DID 등록 — MetaMask signer 필수 (팝업에서 사용자 승인)
export async function registerIssuerOnChain(
  issuerDid: string,
  publicKeyHex: string,
  signer: ethers.Signer
): Promise<{ success: boolean; txHash?: string; error?: string }> {
  try {
    const addrs = await loadAddresses();
    const contract = new ethers.Contract(addrs.DIDRegistry, DID_REGISTRY_ABI, signer);

    const didHash = didToBytes32(issuerDid);
    const pubKeyBytes = pubKeyToBytes(publicKeyHex);

    const tx = await contract.registerIssuer(didHash, pubKeyBytes);
    const receipt = await tx.wait();
    return { success: true, txHash: receipt.hash };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "알 수 없는 오류";
    if (msg.includes("already registered")) return { success: false, error: "이미 등록된 DID입니다." };
    if (msg.includes("user rejected")) return { success: false, error: "MetaMask에서 트랜잭션을 거부했습니다." };
    return { success: false, error: msg };
  }
}

// 블록체인에서 발행자 공개키 조회 (읽기 전용 — MetaMask 불필요)
export async function resolvePublicKey(
  issuerDid: string
): Promise<{ found: boolean; publicKeyHex?: string; error?: string }> {
  try {
    const addrs = await loadAddresses();
    const contract = new ethers.Contract(addrs.DIDRegistry, DID_REGISTRY_ABI, getReadProvider());

    const didHash = didToBytes32(issuerDid);
    const isReg: boolean = await contract.isRegistered(didHash);
    if (!isReg) return { found: false, error: "블록체인에 등록되지 않은 DID입니다." };

    const pubKeyBytes: string = await contract.resolveKey(didHash);
    const pubKeyHex = pubKeyBytes.startsWith("0x") ? pubKeyBytes.slice(2) : pubKeyBytes;
    return { found: true, publicKeyHex: pubKeyHex };
  } catch (e: unknown) {
    return { found: false, error: e instanceof Error ? e.message : "알 수 없는 오류" };
  }
}

// ─────────────────────────────────────────────
// Status Registry
// ─────────────────────────────────────────────

// 상태목록 생성 — MetaMask signer 필수
export async function createStatusList(
  signer: ethers.Signer
): Promise<{ success: boolean; listId?: number; error?: string }> {
  try {
    const addrs = await loadAddresses();
    const contract = new ethers.Contract(addrs.StatusRegistry, STATUS_REGISTRY_ABI, signer);

    const tx = await contract.createStatusList();
    const receipt = await tx.wait();

    const iface = new ethers.Interface(STATUS_REGISTRY_ABI);
    let listId = 1;
    for (const log of receipt.logs) {
      try {
        const parsed = iface.parseLog(log);
        if (parsed?.name === "StatusListCreated") {
          listId = Number(parsed.args[0]);
          break;
        }
      } catch { /* 다른 이벤트 */ }
    }

    return { success: true, listId };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "알 수 없는 오류";
    if (msg.includes("user rejected")) return { success: false, error: "MetaMask에서 트랜잭션을 거부했습니다." };
    return { success: false, error: msg };
  }
}

// VC 폐기 — MetaMask signer 필수
export async function revokeVC(
  listId: number,
  index: number,
  reason: string,
  signer: ethers.Signer
): Promise<{ success: boolean; txHash?: string; error?: string }> {
  try {
    const addrs = await loadAddresses();
    const contract = new ethers.Contract(addrs.StatusRegistry, STATUS_REGISTRY_ABI, signer);

    const tx = await contract.revoke(listId, index, reason);
    const receipt = await tx.wait();
    return { success: true, txHash: receipt.hash };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "알 수 없는 오류";
    if (msg.includes("user rejected")) return { success: false, error: "MetaMask에서 트랜잭션을 거부했습니다." };
    return { success: false, error: msg };
  }
}

// 폐기 여부 조회 (읽기 전용 — MetaMask 불필요)
export async function checkRevocationStatus(
  listId: number,
  index: number
): Promise<{ checked: boolean; revoked?: boolean; error?: string }> {
  try {
    const addrs = await loadAddresses();
    const contract = new ethers.Contract(addrs.StatusRegistry, STATUS_REGISTRY_ABI, getReadProvider());
    const revoked: boolean = await contract.isRevoked(listId, index);
    return { checked: true, revoked };
  } catch (e: unknown) {
    return { checked: false, error: e instanceof Error ? e.message : "알 수 없는 오류" };
  }
}
