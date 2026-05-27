"use client";

import { useState, useEffect } from "react";
import { ethers } from "ethers";
import {
  isMetaMaskInstalled,
  connectMetaMask,
  switchToHardhat,
  getConnectedAccount,
  MetaMaskState,
  HARDHAT_NETWORK,
} from "@/lib/metamask";

interface Props {
  onConnected: (signer: ethers.Signer, address: string) => void;
  onDisconnected?: () => void;
}

export default function MetaMaskButton({ onConnected, onDisconnected }: Props) {
  const [state, setState] = useState<MetaMaskState>({ connected: false });
  const [loading, setLoading] = useState(false);
  const [networkOk, setNetworkOk] = useState(false);
  // 서버 렌더링 때는 window가 없으므로, 클라이언트 마운트 후에만 MetaMask 확인
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);

    // 이미 연결된 계정이 있으면 자동 복원
    getConnectedAccount().then((s) => {
      if (s.connected && s.signer && s.address) {
        setState(s);
        setNetworkOk(s.chainId === 11155111);
        onConnected(s.signer, s.address);
      }
    });

    if (!isMetaMaskInstalled()) return;

    // 계정/네트워크 변경 감지
    const handleAccountsChanged = () => {
      getConnectedAccount().then((s) => {
        setState(s);
        if (s.connected && s.signer && s.address) {
          onConnected(s.signer, s.address);
        } else {
          onDisconnected?.();
        }
      });
    };

    const handleChainChanged = (chainId: unknown) => {
      setNetworkOk(Number(chainId) === 11155111);
      handleAccountsChanged();
    };

    window.ethereum?.on("accountsChanged", handleAccountsChanged);
    window.ethereum?.on("chainChanged", handleChainChanged);

    return () => {
      window.ethereum?.removeListener("accountsChanged", handleAccountsChanged);
      window.ethereum?.removeListener("chainChanged", handleChainChanged);
    };
  }, []);

  async function handleConnect() {
    setLoading(true);
    const result = await connectMetaMask();
    if (result.connected && result.signer && result.address) {
      setState(result);
      if (result.chainId !== 11155111) {
        const switched = await switchToHardhat();
        if (switched.success) {
          const updated = await getConnectedAccount();
          setState(updated);
          setNetworkOk(true);
          if (updated.signer && updated.address) onConnected(updated.signer, updated.address);
        } else {
          setState({ ...result, error: `네트워크 전환 실패: ${switched.error}` });
        }
      } else {
        setNetworkOk(true);
        onConnected(result.signer, result.address);
      }
    } else {
      setState(result);
    }
    setLoading(false);
  }

  async function handleSwitchNetwork() {
    setLoading(true);
    const result = await switchToHardhat();
    if (result.success) {
      setNetworkOk(true);
      const updated = await getConnectedAccount();
      setState(updated);
      if (updated.signer && updated.address) onConnected(updated.signer, updated.address);
    } else {
      setState((prev) => ({ ...prev, error: result.error }));
    }
    setLoading(false);
  }

  // 클라이언트 마운트 전: 빈 skeleton 표시 (hydration 불일치 방지)
  if (!mounted) {
    return (
      <div className="h-10 bg-gray-100 rounded-lg animate-pulse" />
    );
  }

  if (!isMetaMaskInstalled()) {
    return (
      <div className="flex items-center gap-2 bg-orange-50 border border-orange-200 rounded-lg px-3 py-2">
        <span className="text-lg">🦊</span>
        <div className="text-xs">
          <p className="font-medium text-orange-700">MetaMask 미설치</p>
          <a
            href="https://metamask.io/download/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-orange-500 underline"
          >
            설치하기 →
          </a>
        </div>
      </div>
    );
  }

  if (state.connected && state.address) {
    if (!networkOk) {
      return (
        <div className="flex items-center gap-2 bg-yellow-50 border border-yellow-200 rounded-lg px-3 py-2">
          <span className="text-lg">🦊</span>
          <div className="text-xs flex-1">
            <p className="font-medium text-yellow-700">잘못된 네트워크</p>
            <p className="text-yellow-500">Hardhat Local (11155111) 로 전환 필요</p>
          </div>
          <button
            onClick={handleSwitchNetwork}
            disabled={loading}
            className="text-xs bg-yellow-500 text-white px-2 py-1 rounded hover:bg-yellow-600"
          >
            {loading ? "..." : "전환"}
          </button>
        </div>
      );
    }

    return (
      <div className="flex items-center gap-2 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
        <span className="text-lg">🦊</span>
        <div className="text-xs">
          <p className="font-medium text-green-700">MetaMask 연결됨</p>
          <p className="text-green-500 font-mono">
            {state.address.slice(0, 6)}...{state.address.slice(-4)}
          </p>
        </div>
        <div className="ml-1 w-2 h-2 bg-green-400 rounded-full" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <button
        onClick={handleConnect}
        disabled={loading}
        className="flex items-center gap-2 bg-orange-500 hover:bg-orange-600 text-white text-sm font-medium px-3 py-2 rounded-lg disabled:opacity-50 transition-colors"
      >
        <span>🦊</span>
        {loading ? "연결 중..." : "MetaMask 연결"}
      </button>
      {state.error && (
        <p className="text-xs text-red-500">{state.error}</p>
      )}
      <p className="text-xs text-gray-400">
        네트워크: {HARDHAT_NETWORK.chainName} (Chain ID 11155111)
      </p>
    </div>
  );
}
