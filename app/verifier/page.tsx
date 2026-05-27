"use client";

import { useState } from "react";
import Link from "next/link";
import { VerifiablePresentation } from "@/lib/vc";
import { verifySignature } from "@/lib/crypto";
import { resolvePublicKey, checkRevocationStatus } from "@/lib/blockchain";

type VerifyResult = {
  status: "valid" | "invalid" | "revoked" | "error";
  message: string;
  details: {
    holderSignatureValid: boolean;
    issuerSignatureValid: boolean;
    revokedStatus: "not_checked" | "valid" | "revoked";
    disclosedFields: string[];
    credentials: Array<{
      employer: string;
      position: string;
      period: string;
      signatureValid: boolean;
    }>;
  };
};

export default function VerifierPage() {
  const [vpInput, setVpInput] = useState("");
  const [issuerPubKey, setIssuerPubKey] = useState("");
  const [holderPubKey, setHolderPubKey] = useState("");
  const [useBlockchain, setUseBlockchain] = useState(false);
  const [chainMsg, setChainMsg] = useState("");
  const [result, setResult] = useState<VerifyResult | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleVerify() {
    setLoading(true);
    setResult(null);
    setChainMsg("");

    try {
      const vp: VerifiablePresentation = JSON.parse(vpInput);

      if (!vp.type?.includes("VerifiablePresentation")) {
        setResult({ status: "error", message: "유효하지 않은 VP 형식입니다. 지갑 페이지에서 VP를 만들어 주세요.", details: { holderSignatureValid: false, issuerSignatureValid: false, revokedStatus: "not_checked", disclosedFields: [], credentials: [] } });
        setLoading(false);
        return;
      }

      let resolvedPubKey = issuerPubKey;

      // ── 블록체인 자동 조회 ──────────────────────────────
      if (useBlockchain) {
        const firstVC = vp.verifiableCredential[0];
        if (firstVC) {
          setChainMsg("블록체인에서 발행자 공개키 조회 중...");
          const keyResult = await resolvePublicKey(firstVC.issuer);
          if (keyResult.found && keyResult.publicKeyHex) {
            resolvedPubKey = keyResult.publicKeyHex;
            setChainMsg(`공개키 조회 완료: ${resolvedPubKey.slice(0, 16)}...`);
          } else {
            setChainMsg(`공개키 조회 실패: ${keyResult.error}`);
          }
        }
      }

      // 1. 홀더 서명 검증
      let holderSigValid = false;
      if (vp.proof && holderPubKey) {
        const payload = JSON.stringify({ ...vp, proof: undefined });
        holderSigValid = verifySignature(payload, vp.proof.proofValue, holderPubKey);
      }

      // 2. 각 VC 발행자 서명 검증
      const credDetails: VerifyResult["details"]["credentials"] = [];
      let allIssuerSigsValid = true;

      for (const vc of vp.verifiableCredential) {
        let sigValid = false;
        if (vc.proof && resolvedPubKey) {
          const payload = JSON.stringify({ ...vc, proof: undefined });
          sigValid = verifySignature(payload, vc.proof.proofValue, resolvedPubKey);
        }
        if (!sigValid) allIssuerSigsValid = false;

        credDetails.push({
          employer: vc.credentialSubject.employerName || "(비공개)",
          position: vc.credentialSubject.position || "(비공개)",
          period: `${vc.credentialSubject.startDate || "?"} ~ ${vc.credentialSubject.endDate || "?"}`,
          signatureValid: sigValid,
        });
      }

      // 3. 블록체인 폐기 상태 조회
      let revokedStatus: "valid" | "revoked" | "not_checked" = "not_checked";

      if (useBlockchain) {
        setChainMsg((prev) => prev + "\n폐기 상태 조회 중...");
        let anyRevoked = false;
        for (const vc of vp.verifiableCredential) {
          const cs = vc.credentialStatus;
          if (cs?.statusListId !== undefined && cs?.statusListIndex !== undefined) {
            const revResult = await checkRevocationStatus(cs.statusListId, cs.statusListIndex);
            if (revResult.checked && revResult.revoked) { anyRevoked = true; break; }
          }
        }
        revokedStatus = anyRevoked ? "revoked" : "valid";
        setChainMsg((prev) => prev + `\n폐기 상태: ${revokedStatus === "revoked" ? "폐기됨" : "유효"}`);
      }

      const isRevoked = revokedStatus === "revoked";
      const status: "valid" | "invalid" | "revoked" | "error" =
        isRevoked ? "revoked" : !allIssuerSigsValid ? "invalid" : revokedStatus === "not_checked" ? "valid" : "valid";

      setResult({
        status,
        message: isRevoked
          ? "폐기된 인증서입니다."
          : !allIssuerSigsValid
          ? "위·변조 감지 — 서명 불일치"
          : revokedStatus === "not_checked"
          ? "서명 일치 확인됨 (폐기 상태 미확인 — 블록체인 연결 권장)"
          : "진본 확인됨 — 서명 일치, 폐기되지 않음",
        details: {
          holderSignatureValid: holderSigValid,
          issuerSignatureValid: allIssuerSigsValid,
          revokedStatus,
          disclosedFields: vp.disclosedFields || [],
          credentials: credDetails,
        },
      });
    } catch {
      setResult({
        status: "error",
        message: "VP 파싱 오류입니다. 올바른 VP JSON을 붙여넣으세요.",
        details: { holderSignatureValid: false, issuerSignatureValid: false, revokedStatus: "not_checked", disclosedFields: [], credentials: [] },
      });
    } finally {
      setLoading(false);
    }
  }

  const statusConfig = {
    valid: { bg: "bg-green-50 border-green-200", icon: "✅", text: "text-green-700", label: "진본 확인" },
    invalid: { bg: "bg-red-50 border-red-200", icon: "❌", text: "text-red-700", label: "위·변조 감지" },
    revoked: { bg: "bg-yellow-50 border-yellow-200", icon: "⚠️", text: "text-yellow-700", label: "폐기됨" },
    error: { bg: "bg-gray-50 border-gray-200", icon: "⚙️", text: "text-gray-700", label: "오류" },
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-purple-600 text-white px-6 py-4 flex items-center gap-4">
        <Link href="/" className="text-white hover:text-white/80">← 뒤로</Link>
        <div>
          <h1 className="text-xl font-bold">검증자</h1>
          <p className="text-sm opacity-80">은행 / 신규 고용주</p>
        </div>
      </header>

      <div className="max-w-2xl mx-auto p-6 space-y-4">
        <div className="bg-white rounded-xl p-6 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">VP 검증</h2>
            <label className="flex items-center gap-2 cursor-pointer">
              <span className="text-sm text-gray-600">블록체인 연동</span>
              <div
                onClick={() => setUseBlockchain(!useBlockchain)}
                className={`w-10 h-6 rounded-full transition-colors relative cursor-pointer ${useBlockchain ? "bg-purple-600" : "bg-gray-300"}`}
              >
                <div className={`w-4 h-4 bg-white rounded-full absolute top-1 transition-transform ${useBlockchain ? "translate-x-5" : "translate-x-1"}`} />
              </div>
            </label>
          </div>

          {useBlockchain && (
            <div className="bg-purple-50 rounded-lg p-3 text-sm text-purple-700 mb-4">
              <p className="font-medium">블록체인 모드 활성화</p>
              <p className="text-xs mt-1">발행자 공개키를 DID Registry에서 자동 조회하고, StatusRegistry에서 폐기 여부를 확인합니다.</p>
              {chainMsg && <p className="text-xs mt-2 whitespace-pre-line text-purple-500">{chainMsg}</p>}
            </div>
          )}

          <div className="space-y-4">
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-sm font-medium text-gray-700">VP JSON *</label>
                <label className="flex items-center gap-1 cursor-pointer text-xs text-purple-600 hover:text-purple-800">
                  <span>📂 파일 업로드</span>
                  <input
                    type="file"
                    accept=".json"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      const reader = new FileReader();
                      reader.onload = (ev) => setVpInput(ev.target?.result as string);
                      reader.readAsText(file);
                      e.target.value = "";
                    }}
                  />
                </label>
              </div>
              <textarea
                className="w-full border rounded-lg p-3 text-xs font-mono h-32 resize-none"
                placeholder='{"@context": [...], "type": ["VerifiablePresentation"], ...} 또는 위 버튼으로 파일 업로드'
                value={vpInput}
                onChange={(e) => setVpInput(e.target.value)}
              />
              {vpInput && (
                <button
                  onClick={() => setVpInput("")}
                  className="text-xs text-gray-400 hover:text-red-400 mt-1"
                >
                  ✕ 초기화
                </button>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                발행자 공개키 (hex) {useBlockchain ? "(블록체인에서 자동 조회)" : "*"}
              </label>
              <input
                className={`w-full border rounded-lg px-4 py-2 font-mono text-sm ${useBlockchain ? "bg-gray-50 text-gray-400" : ""}`}
                disabled={useBlockchain}
                placeholder="발행자 DID 페이지에서 복사한 공개키"
                value={issuerPubKey}
                onChange={(e) => setIssuerPubKey(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">소유자 공개키 (hex, 선택)</label>
              <input
                className="w-full border rounded-lg px-4 py-2 font-mono text-sm"
                placeholder="소유자 DID에서 추출한 공개키"
                value={holderPubKey}
                onChange={(e) => setHolderPubKey(e.target.value)}
              />
            </div>
          </div>

          <button
            className="w-full mt-4 bg-purple-600 text-white rounded-lg py-3 font-semibold hover:bg-purple-700 disabled:opacity-50"
            disabled={!vpInput.trim() || (!useBlockchain && !issuerPubKey.trim()) || loading}
            onClick={handleVerify}
          >
            {loading ? "검증 중..." : "검증 실행"}
          </button>
        </div>

        {result && (() => {
          const cfg = statusConfig[result.status];
          return (
            <div className={`rounded-xl border-2 p-6 ${cfg.bg}`}>
              <div className="flex items-center gap-3 mb-4">
                <span className="text-3xl">{cfg.icon}</span>
                <div>
                  <p className={`text-xl font-bold ${cfg.text}`}>{cfg.label}</p>
                  <p className={`text-sm ${cfg.text}`}>{result.message}</p>
                </div>
              </div>

              <div className="space-y-3 text-sm">
                <CheckRow label="발행자 서명 검증" ok={result.details.issuerSignatureValid} />
                <CheckRow label="소유자 서명 검증" ok={result.details.holderSignatureValid} na={!holderPubKey} />
                <CheckRow label="폐기 상태" ok={result.details.revokedStatus === "valid"} naLabel="데모 — 블록체인 미연결" na={result.details.revokedStatus === "not_checked"} />

                {result.details.disclosedFields.length > 0 && (
                  <div className="pt-2 border-t">
                    <p className="font-medium mb-1">공개된 항목:</p>
                    <p className="text-gray-600">{result.details.disclosedFields.join(", ")}</p>
                  </div>
                )}

                {result.details.credentials.length > 0 && (
                  <div className="pt-2 border-t">
                    <p className="font-medium mb-2">인증서 내용:</p>
                    {result.details.credentials.map((c, i) => (
                      <div key={i} className="bg-white rounded-lg p-3 mb-2">
                        <p><span className="font-medium">사업장:</span> {c.employer}</p>
                        <p><span className="font-medium">직무:</span> {c.position}</p>
                        <p><span className="font-medium">기간:</span> {c.period}</p>
                        <p>
                          <span className="font-medium">서명: </span>
                          {c.signatureValid
                            ? <span className="text-green-600">✓ 유효</span>
                            : issuerPubKey ? <span className="text-red-600">✗ 불일치</span> : <span className="text-gray-400">공개키 필요</span>}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })()}

        {/* 도움말 */}
        <div className="bg-blue-50 rounded-xl p-4 text-sm text-blue-700">
          <p className="font-semibold mb-1">💡 검증 방법</p>
          <ol className="list-decimal list-inside space-y-1 text-blue-600">
            <li>소유자(지갑)가 VP QR을 보여주면 이미지를 QR 스캐너로 읽거나 JSON을 복사</li>
            <li>발행자의 공개키를 발행자 페이지에서 확인</li>
            <li>검증 실행 → 서명 일치 + 폐기 아님 → 진본 확인</li>
          </ol>
        </div>
      </div>
    </div>
  );
}

function CheckRow({ label, ok, na = false, naLabel = "N/A" }: { label: string; ok: boolean; na?: boolean; naLabel?: string }) {
  return (
    <div className="flex justify-between items-center">
      <span className="text-gray-600">{label}</span>
      {na ? (
        <span className="text-gray-400 text-xs">{naLabel}</span>
      ) : ok ? (
        <span className="text-green-600 font-medium">✓ 통과</span>
      ) : (
        <span className="text-red-600 font-medium">✗ 실패</span>
      )}
    </div>
  );
}
