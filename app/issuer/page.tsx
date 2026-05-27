"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import QRCode from "qrcode";
import { ethers } from "ethers";
import { getOrCreateWallet, WalletData } from "@/lib/wallet";
import { issueVC, VerifiableCredential } from "@/lib/vc";
import {
  checkConnection,
  registerIssuerOnChain,
  createStatusList,
  revokeVC,
} from "@/lib/blockchain";
import MetaMaskButton from "@/components/MetaMaskButton";

interface FormData {
  workerDid: string;
  employerName: string;
  position: string;
  employmentType: string;
  startDate: string;
  endDate: string;
  hourlyWage: string;
  totalHours: string;
}

type ChainStatus = { connected: boolean; blockNumber?: number; error?: string } | null;
type RegStatus = "none" | "loading" | "done" | "error";

export default function IssuerPage() {
  const [wallet, setWallet] = useState<WalletData | null>(null);
  const [form, setForm] = useState<FormData>({
    workerDid: "",
    employerName: "",
    position: "",
    employmentType: "단기/시간제",
    startDate: "",
    endDate: "",
    hourlyWage: "",
    totalHours: "",
  });
  const [issuedVC, setIssuedVC] = useState<VerifiableCredential | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string>("");
  const [step, setStep] = useState<"form" | "done">("form");

  // MetaMask
  const [mmSigner, setMmSigner] = useState<ethers.Signer | null>(null);
  const [mmAddress, setMmAddress] = useState("");

  // 블록체인 상태
  const [chainStatus, setChainStatus] = useState<ChainStatus>(null);
  const [regStatus, setRegStatus] = useState<RegStatus>("none");
  const [regMsg, setRegMsg] = useState("");
  const [statusListId, setStatusListId] = useState<number | null>(null);
  const [issuingLoading, setIssuingLoading] = useState(false);

  // 발행 내역 (폐기용)
  const [issuedList, setIssuedList] = useState<VerifiableCredential[]>([]);
  const [revokeMsg, setRevokeMsg] = useState("");

  useEffect(() => {
    const w = getOrCreateWallet("issuer", "발행자");
    setWallet(w);
    // 저장된 발행 내역 로드
    const saved = localStorage.getItem("workpass_issued_vcs");
    if (saved) setIssuedList(JSON.parse(saved));
    // 저장된 statusListId
    const savedListId = localStorage.getItem("workpass_status_list_id");
    if (savedListId) setStatusListId(parseInt(savedListId));
  }, []);

  // 블록체인 연결 확인
  async function handleCheckChain() {
    const status = await checkConnection();
    setChainStatus(status);
  }

  // DID 블록체인 등록 (MetaMask로 서명)
  async function handleRegisterDID() {
    if (!wallet || !mmSigner) return;
    setRegStatus("loading");
    setRegMsg("MetaMask 팝업을 확인하세요...");

    // 1. DID 등록 — MetaMask 팝업에서 서명
    const regResult = await registerIssuerOnChain(wallet.keyPair.did, wallet.keyPair.publicKey, mmSigner);
    if (!regResult.success) {
      if (regResult.error?.includes("이미 등록")) {
        setRegMsg("이미 등록된 DID입니다. (정상)");
        setRegStatus("done");
      } else {
        setRegMsg(`DID 등록 실패: ${regResult.error}`);
        setRegStatus("error");
        return;
      }
    } else {
      setRegMsg(`✓ DID 등록 완료 — Tx: ${regResult.txHash?.slice(0, 18)}...`);
    }

    // 2. 상태목록 생성 (처음 한 번만) — MetaMask 팝업에서 서명
    if (!statusListId) {
      setRegMsg((prev) => prev + "\nMetaMask 팝업을 확인하세요 (상태목록 생성)...");
      const listResult = await createStatusList(mmSigner);
      if (listResult.success && listResult.listId) {
        setStatusListId(listResult.listId);
        localStorage.setItem("workpass_status_list_id", String(listResult.listId));
        setRegMsg((prev) => prev + `\n✓ 상태목록 생성 완료 — ListId: ${listResult.listId}`);
      } else {
        setRegMsg((prev) => prev + `\n상태목록 생성 실패: ${listResult.error}`);
      }
    }

    setRegStatus("done");
  }

  async function handleIssue() {
    if (!wallet) return;
    setIssuingLoading(true);

    const listId = statusListId ?? 1;
    const listIndex = Math.floor(Math.random() * 10000);

    const vc = issueVC(
      {
        id: form.workerDid || `did:key:z${crypto.randomUUID().replace(/-/g, "")}`,
        employerName: form.employerName,
        position: form.position,
        employmentType: form.employmentType,
        startDate: form.startDate,
        endDate: form.endDate,
        hourlyWage: parseInt(form.hourlyWage),
        totalHours: parseInt(form.totalHours),
      },
      wallet.keyPair.did,
      wallet.keyPair.privateKey,
      listId,
      listIndex,
      "http://localhost:8545"
    );

    // 발행 내역 저장
    const updatedList = [...issuedList, vc];
    setIssuedList(updatedList);
    localStorage.setItem("workpass_issued_vcs", JSON.stringify(updatedList));

    setIssuedVC(vc);
    const qr = await QRCode.toDataURL(JSON.stringify(vc), { width: 400, errorCorrectionLevel: "L" });
    setQrDataUrl(qr);
    setIssuingLoading(false);
    setStep("done");
  }

  async function handleRevoke(vc: VerifiableCredential) {
    if (!mmSigner) {
      setRevokeMsg("먼저 MetaMask를 연결하세요.");
      return;
    }
    const reason = prompt("폐기 사유를 입력하세요:");
    if (!reason) return;
    setRevokeMsg("MetaMask 팝업을 확인하세요...");
    const result = await revokeVC(
      vc.credentialStatus.statusListId,
      vc.credentialStatus.statusListIndex,
      reason,
      mmSigner
    );
    setRevokeMsg(result.success
      ? `✓ 폐기 완료 — Tx: ${result.txHash?.slice(0, 18)}...`
      : `✗ 실패: ${result.error}`);
  }

  if (step === "done" && issuedVC && qrDataUrl) {
    return (
      <PageLayout title="발행자" subtitle="고용주 / 점주" color="blue" back="/">
        <div className="bg-white rounded-xl p-6 shadow-sm text-center">
          <div className="text-green-500 text-5xl mb-4">✓</div>
          <h2 className="text-xl font-bold mb-2">경력 인증서 발행 완료!</h2>
          <p className="text-gray-500 text-sm mb-6">
            아래 QR코드 또는 JSON을 근로자에게 전달하세요.
          </p>
          <img src={qrDataUrl} alt="VC QR" className="mx-auto mb-6 rounded-lg border" />
          <div className="text-left bg-gray-50 rounded-lg p-4 text-sm mb-4 space-y-1">
            <p><span className="font-semibold">발행자 DID:</span> <span className="text-xs break-all">{issuedVC.issuer}</span></p>
            <p><span className="font-semibold">근무지:</span> {issuedVC.credentialSubject.employerName}</p>
            <p><span className="font-semibold">직무:</span> {issuedVC.credentialSubject.position}</p>
            <p><span className="font-semibold">기간:</span> {issuedVC.credentialSubject.startDate} ~ {issuedVC.credentialSubject.endDate}</p>
            <p><span className="font-semibold">StatusList ID:</span> {issuedVC.credentialStatus.statusListId} / Index: {issuedVC.credentialStatus.statusListIndex}</p>
          </div>
          <div className="flex gap-3">
            <button
              onClick={() => {
                const blob = new Blob([JSON.stringify(issuedVC, null, 2)], { type: "application/json" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = "employment_vc.json";
                a.click();
              }}
              className="flex-1 border border-blue-600 text-blue-600 rounded-lg py-2 hover:bg-blue-50"
            >
              JSON 다운로드
            </button>
            <button onClick={() => setStep("form")} className="flex-1 bg-blue-600 text-white rounded-lg py-2 hover:bg-blue-700">
              새 인증서 발행
            </button>
          </div>
        </div>
      </PageLayout>
    );
  }

  return (
    <PageLayout title="발행자" subtitle="고용주 / 점주" color="blue" back="/">
      {/* MetaMask + 블록체인 연결 카드 */}
      <div className="bg-white rounded-xl p-4 shadow-sm space-y-3">
        <h3 className="font-semibold text-sm text-gray-700">블록체인 연결</h3>

        {/* MetaMask 연결 버튼 */}
        <MetaMaskButton
          onConnected={(signer, address) => {
            setMmSigner(signer);
            setMmAddress(address);
            handleCheckChain();
          }}
          onDisconnected={() => {
            setMmSigner(null);
            setMmAddress("");
            setChainStatus(null);
          }}
        />

        {/* Hardhat 노드 상태 */}
        <div className="flex items-center justify-between">
          <div>
            {chainStatus === null ? (
              <p className="text-xs text-gray-400">Hardhat 노드 상태 미확인</p>
            ) : chainStatus.connected ? (
              <p className="text-xs text-green-600">✓ Hardhat 노드 연결됨 (블록 #{chainStatus.blockNumber})</p>
            ) : (
              <p className="text-xs text-red-500">✗ {chainStatus.error}</p>
            )}
          </div>
          <button onClick={handleCheckChain} className="text-xs text-blue-500 hover:underline">
            새로고침
          </button>
        </div>

        {/* DID 등록 버튼 — MetaMask 연결 + 노드 연결 시에만 활성화 */}
        {mmSigner && chainStatus?.connected && (
          <div>
            {regStatus === "none" || regStatus === "error" ? (
              <button
                onClick={handleRegisterDID}
                className="w-full text-sm bg-indigo-600 text-white rounded-lg py-2 hover:bg-indigo-700"
              >
                🔗 DID 블록체인 등록 (MetaMask 서명)
              </button>
            ) : regStatus === "loading" ? (
              <p className="text-xs text-indigo-500 text-center whitespace-pre-line">{regMsg || "처리 중..."}</p>
            ) : (
              <p className="text-xs text-green-600 whitespace-pre-line">{regMsg || "DID 등록 완료"}</p>
            )}
          </div>
        )}

        {!mmSigner && (
          <p className="text-xs text-gray-400">MetaMask 연결 후 DID를 블록체인에 등록할 수 있습니다.</p>
        )}
      </div>

      {/* 내 DID */}
      {wallet && (
        <div className="bg-blue-50 rounded-xl p-4 text-sm">
          <div className="flex justify-between items-center mb-1">
            <p className="font-semibold text-blue-800">내 발행자 DID</p>
            <button
              onClick={() => navigator.clipboard.writeText(wallet.keyPair.publicKey)}
              className="text-xs text-blue-500 hover:underline"
            >
              공개키 복사
            </button>
          </div>
          <p className="text-blue-600 break-all text-xs">{wallet.keyPair.did}</p>
          <p className="text-blue-400 text-xs mt-1">공개키: {wallet.keyPair.publicKey.slice(0, 20)}...</p>
        </div>
      )}

      {/* 근무 정보 입력 폼 */}
      <div className="bg-white rounded-xl p-6 shadow-sm">
        <h2 className="text-lg font-semibold mb-4">근무 정보 입력</h2>
        <div className="space-y-4">
          <FormField label="근로자 DID (선택)" placeholder="did:key:z..." value={form.workerDid} onChange={(v) => setForm({ ...form, workerDid: v })} />
          <FormField label="사업장 이름 *" placeholder="○○ 카페" value={form.employerName} onChange={(v) => setForm({ ...form, employerName: v })} />
          <FormField label="직무 *" placeholder="바리스타(시간제)" value={form.position} onChange={(v) => setForm({ ...form, position: v })} />
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">고용 유형 *</label>
            <select className="w-full border rounded-lg px-4 py-2" value={form.employmentType} onChange={(e) => setForm({ ...form, employmentType: e.target.value })}>
              <option>단기/시간제</option>
              <option>일용직</option>
              <option>플랫폼 노동</option>
              <option>계약직</option>
            </select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <FormField label="근무 시작일 *" type="date" value={form.startDate} onChange={(v) => setForm({ ...form, startDate: v })} />
            <FormField label="근무 종료일 *" type="date" value={form.endDate} onChange={(v) => setForm({ ...form, endDate: v })} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <FormField label="시급 (원) *" type="number" placeholder="11000" value={form.hourlyWage} onChange={(v) => setForm({ ...form, hourlyWage: v })} />
            <FormField label="총 근무시간 *" type="number" placeholder="80" value={form.totalHours} onChange={(v) => setForm({ ...form, totalHours: v })} />
          </div>
        </div>
        <button
          className="w-full mt-6 bg-blue-600 text-white rounded-lg py-3 font-semibold hover:bg-blue-700 disabled:opacity-50"
          disabled={!form.employerName || !form.position || !form.startDate || !form.endDate || !form.hourlyWage || !form.totalHours || issuingLoading}
          onClick={handleIssue}
        >
          {issuingLoading ? "발행 중..." : "경력 인증서 발행"}
        </button>
      </div>

      {/* 발행 내역 + 폐기 */}
      {issuedList.length > 0 && (
        <div className="bg-white rounded-xl p-4 shadow-sm">
          <h3 className="font-semibold mb-3">발행 내역 (폐기 가능)</h3>
          {revokeMsg && <p className="text-sm mb-2 text-indigo-600">{revokeMsg}</p>}
          <div className="space-y-2">
            {issuedList.map((vc) => (
              <div key={vc.id} className="flex justify-between items-center text-sm border rounded-lg p-3">
                <div>
                  <p className="font-medium">{vc.credentialSubject.employerName} · {vc.credentialSubject.position}</p>
                  <p className="text-xs text-gray-400">{vc.credentialSubject.startDate} ~ {vc.credentialSubject.endDate}</p>
                </div>
                <button
                  onClick={() => handleRevoke(vc)}
                  className="text-xs text-red-500 border border-red-200 rounded px-2 py-1 hover:bg-red-50"
                >
                  폐기
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </PageLayout>
  );
}

function FormField({ label, placeholder, value, onChange, type = "text" }: {
  label: string; placeholder?: string; value: string; onChange: (v: string) => void; type?: string;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      <input type={type} className="w-full border rounded-lg px-4 py-2" placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

function PageLayout({ title, subtitle, color, back, children }: {
  title: string; subtitle: string; color: string; back: string; children: React.ReactNode;
}) {
  const headerColor = color === "blue" ? "bg-blue-600" : color === "green" ? "bg-green-600" : "bg-purple-600";
  return (
    <div className="min-h-screen bg-gray-50">
      <header className={`${headerColor} text-white px-6 py-4 flex items-center gap-4`}>
        <Link href={back} className="text-white hover:text-white/80">← 뒤로</Link>
        <div>
          <h1 className="text-xl font-bold">{title}</h1>
          <p className="text-sm opacity-80">{subtitle}</p>
        </div>
      </header>
      <div className="max-w-2xl mx-auto p-6 space-y-4">{children}</div>
    </div>
  );
}
