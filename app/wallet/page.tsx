"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import QRCode from "qrcode";
import { getOrCreateWallet, saveVC, loadVCs, deleteVC, WalletData } from "@/lib/wallet";
import { VerifiableCredential, createVP } from "@/lib/vc";
import { verifyVC } from "@/lib/vc";

const DISCLOSABLE_FIELDS: { key: string; label: string }[] = [
  { key: "employerName", label: "사업장 이름" },
  { key: "position", label: "직무" },
  { key: "employmentType", label: "고용 유형" },
  { key: "startDate", label: "근무 시작일" },
  { key: "endDate", label: "근무 종료일" },
  { key: "hourlyWage", label: "시급" },
  { key: "totalHours", label: "총 근무시간" },
];

export default function WalletPage() {
  const [wallet, setWallet] = useState<WalletData | null>(null);
  const [vcs, setVcs] = useState<VerifiableCredential[]>([]);
  const [tab, setTab] = useState<"list" | "scan" | "create-vp">("list");
  const [selectedVCs, setSelectedVCs] = useState<Set<number>>(new Set());
  const [disclosedFields, setDisclosedFields] = useState<Set<string>>(
    new Set(["employerName", "position", "startDate", "endDate", "totalHours"])
  );
  const [vpQr, setVpQr] = useState<string>("");
  const [vpJson, setVpJson] = useState<string>("");
  const [scanInput, setScanInput] = useState("");
  const [scanMsg, setScanMsg] = useState("");

  useEffect(() => {
    const w = getOrCreateWallet("holder", "근로자");
    setWallet(w);
    setVcs(loadVCs());
  }, []);

  function handleScanVC() {
    try {
      const vc: VerifiableCredential = JSON.parse(scanInput);
      if (!vc.type?.includes("VerifiableCredential")) {
        setScanMsg("유효하지 않은 VC 형식입니다.");
        return;
      }
      saveVC(vc);
      setVcs(loadVCs());
      setScanInput("");
      setScanMsg("✓ 경력 인증서가 지갑에 저장됐습니다!");
      setTimeout(() => { setTab("list"); setScanMsg(""); }, 1500);
    } catch {
      setScanMsg("JSON 파싱 오류입니다. 올바른 VC JSON을 붙여넣으세요.");
    }
  }

  async function handleCreateVP() {
    if (!wallet || selectedVCs.size === 0) return;
    const indices = Array.from(selectedVCs);
    const fields = Array.from(disclosedFields);

    const vp = createVP(vcs, indices, fields, wallet.keyPair.did, wallet.keyPair.privateKey);
    const json = JSON.stringify(vp, null, 2);
    setVpJson(json);
    const qr = await QRCode.toDataURL(JSON.stringify(vp), { width: 400, errorCorrectionLevel: "L" });
    setVpQr(qr);
  }

  const totalHours = vcs.reduce((sum, vc) => sum + (vc.credentialSubject.totalHours || 0), 0);

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-green-600 text-white px-6 py-4 flex items-center gap-4">
        <Link href="/" className="text-white hover:text-white/80">← 뒤로</Link>
        <div>
          <h1 className="text-xl font-bold">지갑 (소유자)</h1>
          <p className="text-sm opacity-80">근로자 / 학생</p>
        </div>
      </header>

      {wallet && (
        <div className="bg-green-50 px-6 py-3 text-sm">
          <p className="font-semibold text-green-800">내 DID</p>
          <p className="text-green-600 break-all text-xs">{wallet.keyPair.did}</p>
        </div>
      )}

      {/* 요약 카드 */}
      <div className="max-w-2xl mx-auto p-6">
        <div className="grid grid-cols-2 gap-4 mb-6">
          <div className="bg-white rounded-xl p-4 shadow-sm text-center">
            <p className="text-3xl font-bold text-green-600">{vcs.length}</p>
            <p className="text-sm text-gray-500">보유 인증서</p>
          </div>
          <div className="bg-white rounded-xl p-4 shadow-sm text-center">
            <p className="text-3xl font-bold text-blue-600">{totalHours}</p>
            <p className="text-sm text-gray-500">총 근무시간</p>
          </div>
        </div>

        {/* 탭 */}
        <div className="flex gap-2 mb-4">
          {[
            { id: "list", label: "📋 인증서 목록" },
            { id: "scan", label: "📷 인증서 받기" },
            { id: "create-vp", label: "🔏 VP 제출" },
          ].map((t) => (
            <button
              key={t.id}
              onClick={() => { setTab(t.id as typeof tab); setVpQr(""); setVpJson(""); }}
              className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${
                tab === t.id ? "bg-green-600 text-white" : "bg-white text-gray-600 hover:bg-green-50"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* 인증서 목록 탭 */}
        {tab === "list" && (
          <div className="space-y-3">
            {vcs.length === 0 ? (
              <div className="bg-white rounded-xl p-8 text-center text-gray-400">
                <p className="text-4xl mb-2">📭</p>
                <p>저장된 경력 인증서가 없습니다.</p>
                <p className="text-sm mt-1">발행자에게 VC를 받아 &apos;인증서 받기&apos; 탭에서 저장하세요.</p>
              </div>
            ) : (
              vcs.map((vc, i) => (
                <VCCard key={vc.id} vc={vc} onDelete={() => { deleteVC(vc.id); setVcs(loadVCs()); }} index={i} />
              ))
            )}
          </div>
        )}

        {/* 인증서 받기 탭 */}
        {tab === "scan" && (
          <div className="bg-white rounded-xl p-6 shadow-sm">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-lg font-semibold">경력 인증서 (VC) 저장</h2>
              <label className="flex items-center gap-1 cursor-pointer text-sm text-green-600 hover:text-green-800">
                <span>📂 파일 업로드</span>
                <input
                  type="file"
                  accept=".json"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    const reader = new FileReader();
                    reader.onload = (ev) => setScanInput(ev.target?.result as string);
                    reader.readAsText(file);
                    e.target.value = "";
                  }}
                />
              </label>
            </div>
            <p className="text-sm text-gray-500 mb-4">
              발행자가 제공한 VC JSON 파일을 업로드하거나 직접 붙여넣으세요.
            </p>
            <textarea
              className="w-full border rounded-lg p-3 text-xs font-mono h-40 resize-none"
              placeholder='{"@context": ["https://www.w3.org/ns/credentials/v2"], ...}'
              value={scanInput}
              onChange={(e) => setScanInput(e.target.value)}
            />
            {scanMsg && (
              <p className={`text-sm mt-2 ${scanMsg.startsWith("✓") ? "text-green-600" : "text-red-500"}`}>{scanMsg}</p>
            )}
            <button
              className="w-full mt-3 bg-green-600 text-white rounded-lg py-2 font-semibold hover:bg-green-700 disabled:opacity-50"
              onClick={handleScanVC}
              disabled={!scanInput.trim()}
            >
              저장하기
            </button>
          </div>
        )}

        {/* VP 제출 탭 */}
        {tab === "create-vp" && (
          <div className="space-y-4">
            {vcs.length === 0 ? (
              <div className="bg-white rounded-xl p-6 text-center text-gray-400">
                먼저 인증서를 저장하세요.
              </div>
            ) : (
              <>
                <div className="bg-white rounded-xl p-4 shadow-sm">
                  <h3 className="font-semibold mb-3">제출할 인증서 선택</h3>
                  {vcs.map((vc, i) => (
                    <label key={vc.id} className="flex items-center gap-3 p-2 hover:bg-gray-50 rounded cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selectedVCs.has(i)}
                        onChange={(e) => {
                          const next = new Set(selectedVCs);
                          e.target.checked ? next.add(i) : next.delete(i);
                          setSelectedVCs(next);
                        }}
                        className="w-4 h-4"
                      />
                      <span className="text-sm">
                        {vc.credentialSubject.employerName} · {vc.credentialSubject.position}
                        <span className="text-gray-400 ml-2">({vc.credentialSubject.startDate} ~ {vc.credentialSubject.endDate})</span>
                      </span>
                    </label>
                  ))}
                </div>

                <div className="bg-white rounded-xl p-4 shadow-sm">
                  <h3 className="font-semibold mb-3">공개할 항목 선택 (선택적 공개)</h3>
                  {DISCLOSABLE_FIELDS.map((f) => (
                    <label key={f.key} className="flex items-center gap-3 p-2 hover:bg-gray-50 rounded cursor-pointer">
                      <input
                        type="checkbox"
                        checked={disclosedFields.has(f.key)}
                        onChange={(e) => {
                          const next = new Set(disclosedFields);
                          e.target.checked ? next.add(f.key) : next.delete(f.key);
                          setDisclosedFields(next);
                        }}
                        className="w-4 h-4"
                      />
                      <span className="text-sm">{f.label}</span>
                    </label>
                  ))}
                </div>

                <button
                  className="w-full bg-green-600 text-white rounded-lg py-3 font-semibold hover:bg-green-700 disabled:opacity-50"
                  disabled={selectedVCs.size === 0 || disclosedFields.size === 0}
                  onClick={handleCreateVP}
                >
                  VP QR 생성
                </button>

                {vpQr && (
                  <div className="bg-white rounded-xl p-6 shadow-sm text-center">
                    <h3 className="font-semibold mb-4">검증자에게 이 QR을 보여주세요</h3>
                    <img src={vpQr} alt="VP QR Code" className="mx-auto rounded-lg border" />
                    <p className="text-xs text-gray-400 mt-3">
                      공개 항목: {Array.from(disclosedFields).map(f => DISCLOSABLE_FIELDS.find(d => d.key === f)?.label).join(", ")}
                    </p>
                    <button
                      onClick={() => {
                        const blob = new Blob([vpJson], { type: "application/json" });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement("a");
                        a.href = url;
                        a.download = "vp.json";
                        a.click();
                        URL.revokeObjectURL(url);
                      }}
                      className="mt-4 w-full border border-green-600 text-green-600 rounded-lg py-2 hover:bg-green-50 text-sm font-medium"
                    >
                      📥 VP JSON 다운로드
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function VCCard({ vc, onDelete, index }: { vc: VerifiableCredential; onDelete: () => void; index: number }) {
  const [expanded, setExpanded] = useState(false);
  const s = vc.credentialSubject;
  return (
    <div className="bg-white rounded-xl shadow-sm overflow-hidden">
      <div
        className="p-4 flex items-center justify-between cursor-pointer hover:bg-gray-50"
        onClick={() => setExpanded(!expanded)}
      >
        <div>
          <p className="font-semibold text-gray-800">{s.employerName}</p>
          <p className="text-sm text-gray-500">{s.position} · {s.startDate} ~ {s.endDate}</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded-full">유효</span>
          <span className="text-gray-400">{expanded ? "▲" : "▼"}</span>
        </div>
      </div>
      {expanded && (
        <div className="border-t p-4 text-sm space-y-2">
          <Row label="발행자 DID" value={vc.issuer} mono />
          <Row label="시급" value={`${s.hourlyWage?.toLocaleString()}원`} />
          <Row label="총 근무시간" value={`${s.totalHours}시간`} />
          <Row label="고용 유형" value={s.employmentType} />
          <div className="pt-2">
            <button
              onClick={onDelete}
              className="text-red-500 text-xs hover:underline"
            >
              삭제
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <span className="text-gray-500">{label}: </span>
      <span className={`text-gray-800 ${mono ? "font-mono text-xs break-all" : ""}`}>{value}</span>
    </div>
  );
}
