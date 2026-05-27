/**
 * MetaMask 연결 유틸리티
 * ethers.js v6 BrowserProvider 사용
 */
import { ethers } from "ethers";

export interface MetaMaskState {
  connected: boolean;
  address?: string;
  chainId?: number;
  signer?: ethers.Signer;
  provider?: ethers.BrowserProvider;
  error?: string;
}

// Hardhat 로컬 네트워크 설정
export const HARDHAT_NETWORK = {
  chainId: "0xAA36A7",       // 11155111 Sepolia
  chainName: "Sepolia",
  rpcUrls: ["https://ethereum-sepolia-rpc.publicnode.com"],
  nativeCurrency: { name: "SepoliaETH", symbol: "ETH", decimals: 18 },
};

export function isMetaMaskInstalled(): boolean {
  return typeof window !== "undefined" && typeof window.ethereum !== "undefined";
}

// MetaMask 연결 요청
export async function connectMetaMask(): Promise<MetaMaskState> {
  if (!isMetaMaskInstalled()) {
    return { connected: false, error: "MetaMask가 설치되어 있지 않습니다." };
  }

  try {
    const provider = new ethers.BrowserProvider(window.ethereum!);

    // 계정 연결 요청 (MetaMask 팝업)
    await provider.send("eth_requestAccounts", []);

    const signer = await provider.getSigner();
    const address = await signer.getAddress();
    const network = await provider.getNetwork();
    const chainId = Number(network.chainId);

    return { connected: true, address, chainId, signer, provider };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "연결 실패";
    const userDenied = msg.includes("rejected") || msg.includes("denied");
    return {
      connected: false,
      error: userDenied ? "사용자가 연결을 거부했습니다." : `연결 오류: ${msg}`,
    };
  }
}

// MetaMask에 Hardhat 네트워크 추가
export async function addHardhatNetwork(): Promise<{ success: boolean; error?: string }> {
  if (!isMetaMaskInstalled()) {
    return { success: false, error: "MetaMask가 설치되어 있지 않습니다." };
  }
  try {
    await window.ethereum!.request({
      method: "wallet_addEthereumChain",
      params: [HARDHAT_NETWORK],
    });
    return { success: true };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "알 수 없는 오류";
    return { success: false, error: msg };
  }
}

// Hardhat 네트워크로 전환
export async function switchToHardhat(): Promise<{ success: boolean; error?: string }> {
  if (!isMetaMaskInstalled()) {
    return { success: false, error: "MetaMask가 설치되어 있지 않습니다." };
  }
  try {
    await window.ethereum!.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: HARDHAT_NETWORK.chainId }],
    });
    return { success: true };
  } catch (e: unknown) {
    const err = e as { code?: number; message?: string };
    // 4902: 네트워크가 MetaMask에 없음 → 추가 시도
    if (err.code === 4902) {
      return addHardhatNetwork();
    }
    return { success: false, error: err.message ?? "알 수 없는 오류" };
  }
}

// 현재 연결된 계정 정보 조회 (이미 연결된 경우)
export async function getConnectedAccount(): Promise<MetaMaskState> {
  if (!isMetaMaskInstalled()) {
    return { connected: false };
  }
  try {
    const provider = new ethers.BrowserProvider(window.ethereum!);
    const accounts: string[] = await provider.send("eth_accounts", []);
    if (accounts.length === 0) return { connected: false };

    const signer = await provider.getSigner();
    const address = await signer.getAddress();
    const network = await provider.getNetwork();
    return { connected: true, address, chainId: Number(network.chainId), signer, provider };
  } catch {
    return { connected: false };
  }
}
