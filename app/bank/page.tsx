"use client";

import { useState } from "react";
import Link from "next/link";
import { VerifiableCredential, VerifiablePresentation } from "@/lib/vc";
import { verifySignature } from "@/lib/crypto";
import { checkRevocationStatus, resolvePublicKey } from "@/lib/blockchain";

type IssuerKeyStatus = "none" | "manual" | "chain_ok" | "chain_fail";

type VerifyResult = {
  status: "valid" | "invalid" | "revoked" | "no_key" | "error";
  message: string;
  details: {
    holderSigValid: boolean;
    issuerSigValid: boolean | null;   // null = 공개키 없어서 미확인
    revokedStatus: "not_checked" | "valid" | "revoked";
    disclosedFields: string[];
    credentials: Array<{
      employer: string;
      position: string;
      period: string;
      hourlyWage?: number;
      employmentType?: string;
      sigValid: boolean | null;        // null = 공개키 없어서 미확인
    }>;
  };
};

const STATUS_CONFIG = {
  valid:   { bg: "bg-green-50 border-green-200",   icon: "✅", text: "text-green-700",  label: "진본 확인" },
  invalid: { bg: "bg-red-50 border-red-200",        icon: "❌", text: "text-red-700",    label: "위·변조 감지" },
  revoked: { bg: "bg-yellow-50 border-yellow-200",  icon: "⚠️", text: "text-yellow-700", label: "폐기된 인증서" },
  no_key:  { bg: "bg-gray-50 border-gray-300",      icon: "🔑", text: "text-gray-600",   label: "공개키 없음 — 서명 미확인" },
  error:   { bg: "bg-gray-50 border-gray-200",      icon: "⚙️", text: "text-gray-700",   label: "오류" },
};

type Career = {
  id: string;
  employerName: string | null;
  position: string;
  employmentType: string;
  startDate: string;
  endDate: string;
  hourlyWage: number;
  weeklyHours: number;
  attendanceCount: number;
  totalHours: number | null;
  status: "active" | "terminated";
  hasVC: boolean;
  vc: VerifiableCredential | null;
};

type CareerVerify = {
  state: "pending" | "verifying" | "done";
  issuerSig: boolean | null;   // null = 공개키 없음 / VC 없음
  revoked: "valid" | "revoked" | "unknown";
  note?: string;
};

export default function BankPage() {
  const [tab, setTab] = useState<"direct" | "vp">("direct");

  // ── 직원 직접 조회 (ID + PIN) ──────────────────────────────────────────────
  const [lookupId, setLookupId] = useState("");
  const [lookupPin, setLookupPin] = useState("");
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupMsg, setLookupMsg] = useState("");
  const [careers, setCareers] = useState<Career[] | null>(null);
  const [careerName, setCareerName] = useState("");
  const [careerVerify, setCareerVerify] = useState<Record<string, CareerVerify>>({});

  const [vpInput, setVpInput] = useState("");
  const [issuerPubKey, setIssuerPubKey] = useState("");
  const [holderPubKey, setHolderPubKey] = useState("");
  const [checkRevocation, setCheckRevocation] = useState(false);
  const [chainMsg, setChainMsg] = useState("");
  const [keyStatus, setKeyStatus] = useState<IssuerKeyStatus>("none");
  const [result, setResult] = useState<VerifyResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [chainLookupLoading, setChainLookupLoading] = useState(false);
  const [chainLookupMsg, setChainLookupMsg] = useState("");

  // ── 블록체인에서 공개키 자동 조회 ─────────────────────────────────────────
  async function handleLookupFromChain() {
    if (!vpInput.trim()) return;
    setChainLookupLoading(true);
    setChainLookupMsg("Sepolia에서 발행자 공개키 조회 중...");
    try {
      const vp: VerifiablePresentation = JSON.parse(vpInput);
      const issuerDid = vp.verifiableCredential?.[0]?.issuer;
      if (!issuerDid) {
        setChainLookupMsg("❌ VP에서 발행자 DID를 찾을 수 없습니다");
        return;
      }
      const result = await resolvePublicKey(issuerDid);
      if (result.found && result.publicKeyHex) {
        setIssuerPubKey(result.publicKeyHex);
        setKeyStatus("chain_ok");
        setChainLookupMsg("✅ 공개키 조회 성공! 아래 검증을 실행하세요.");
      } else {
        setKeyStatus("chain_fail");
        setChainLookupMsg(
          `❌ ${result.error || "블록체인에 공개키가 없습니다. 사장이 먼저 DID를 등록해야 합니다."}`
        );
      }
    } catch {
      setChainLookupMsg("❌ VP JSON 파싱 오류 — 올바른 VP를 먼저 붙여넣으세요");
    } finally {
      setChainLookupLoading(false);
    }
  }

  async function handleVerify() {
    setLoading(true);
    setResult(null);
    setChainMsg("");

    try {
      const vp: VerifiablePresentation = JSON.parse(vpInput);

      if (!vp.type?.includes("VerifiablePresentation")) {
        setResult({
          status: "error",
          message: "VP 형식이 올바르지 않습니다. 직원이 VP를 생성하여 전달해야 합니다.",
          details: { holderSigValid: false, issuerSigValid: null, revokedStatus: "not_checked", disclosedFields: [], credentials: [] },
        });
        setLoading(false);
        return;
      }

      const resolvedPubKey = issuerPubKey.trim();

      // 1. 홀더 서명 검증
      let holderSigValid = false;
      if (vp.proof && holderPubKey.trim()) {
        const payload = JSON.stringify({ ...vp, proof: undefined });
        holderSigValid = verifySignature(payload, vp.proof.proofValue, holderPubKey.trim());
      }

      // 2. VC 발행자 서명 검증 (공개키 있을 때만)
      const credentials: VerifyResult["details"]["credentials"] = [];
      let allIssuerValid: boolean | null = null;

      for (const vc of vp.verifiableCredential ?? []) {
        let sigValid: boolean | null = null;
        if (vc.proof && resolvedPubKey) {
          const payload = JSON.stringify({ ...vc, proof: undefined });
          sigValid = verifySignature(payload, vc.proof.proofValue, resolvedPubKey);
          if (allIssuerValid === null) allIssuerValid = true;
          if (!sigValid) allIssuerValid = false;
        }
        credentials.push({
          employer: vc.credentialSubject.employerName || "(비공개)",
          position: vc.credentialSubject.position || "(비공개)",
          period: `${vc.credentialSubject.startDate || "?"} ~ ${vc.credentialSubject.endDate || "미정"}`,
          hourlyWage: vc.credentialSubject.hourlyWage,
          employmentType: vc.credentialSubject.employmentType,
          sigValid,
        });
      }

      // 3. 블록체인 폐기 상태 확인 (선택)
      let revokedStatus: "valid" | "revoked" | "not_checked" = "not_checked";
      if (checkRevocation) {
        setChainMsg("블록체인에서 폐기 여부 확인 중...");
        let anyRevoked = false;
        for (const vc of vp.verifiableCredential ?? []) {
          const cs = vc.credentialStatus;
          if (cs?.statusListId !== undefined && cs?.statusListIndex !== undefined) {
            const rev = await checkRevocationStatus(cs.statusListId, cs.statusListIndex);
            if (rev.checked && rev.revoked) { anyRevoked = true; break; }
          }
        }
        revokedStatus = anyRevoked ? "revoked" : "valid";
        setChainMsg(`폐기 상태: ${revokedStatus === "revoked" ? "폐기됨 ⚠️" : "유효 ✓"}`);
      }

      // 최종 상태 결정
      const isRevoked = revokedStatus === "revoked";
      let status: VerifyResult["status"];
      let message: string;

      if (isRevoked) {
        status = "revoked";
        message = "폐기된 인증서입니다. 이 경력서는 신뢰할 수 없습니다.";
      } else if (allIssuerValid === null) {
        // 공개키 없어서 서명 미확인
        status = "no_key";
        message = "발행자 공개키가 없어 서명을 확인하지 못했습니다. 사장 페이지에서 공개키를 복사하여 입력하세요.";
      } else if (!allIssuerValid) {
        status = "invalid";
        message = "서명 불일치 — 위·변조가 감지되었습니다.";
      } else {
        status = "valid";
        message = revokedStatus === "not_checked"
          ? "서명 검증 통과 ✓ (폐기 여부 미확인 — 아래 폐기 확인 켜기)"
          : "진본 확인 ✓ — 서명 일치, 폐기되지 않음";
      }

      setResult({
        status,
        message,
        details: {
          holderSigValid,
          issuerSigValid: allIssuerValid,
          revokedStatus,
          disclosedFields: vp.disclosedFields || [],
          credentials,
        },
      });
    } catch {
      setResult({
        status: "error",
        message: "VP JSON 파싱 오류. 올바른 VP 파일을 업로드하세요.",
        details: { holderSigValid: false, issuerSigValid: null, revokedStatus: "not_checked", disclosedFields: [], credentials: [] },
      });
    } finally {
      setLoading(false);
    }
  }

  async function handleDirectLookup() {
    if (!lookupId.trim() || !lookupPin.trim()) return;
    setLookupLoading(true);
    setLookupMsg("");
    setCareers(null);
    try {
      const res = await fetch(`/api/workers/${encodeURIComponent(lookupId.trim())}/careers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin: lookupPin.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setLookupMsg(`❌ ${data.error || "조회 실패"}`);
        return;
      }
      const list: Career[] = data.careers;
      setCareers(list);
      setCareerName(data.worker?.name || lookupId.trim());
      if (list.length === 0) {
        setLookupMsg("등록된 경력이 없습니다.");
      } else {
        verifyCareers(list);
      }
    } catch {
      setLookupMsg("❌ 네트워크 오류 — 다시 시도하세요");
    } finally {
      setLookupLoading(false);
    }
  }

  // 조회된 각 경력의 VC를 블록체인 공개키로 자동 검증 (발행자 서명 + 폐기 여부)
  async function verifyCareers(list: Career[]) {
    const init: Record<string, CareerVerify> = {};
    for (const c of list) {
      init[c.id] = c.hasVC
        ? { state: "verifying", issuerSig: null, revoked: "unknown" }
        : { state: "done", issuerSig: null, revoked: "unknown", note: "VC 미발급" };
    }
    setCareerVerify(init);

    const pubKeyCache = new Map<string, string | null>();

    for (const c of list) {
      const vc = c.vc;
      if (!vc?.proof) continue;
      let result: CareerVerify = { state: "done", issuerSig: null, revoked: "unknown" };
      try {
        // 1) 발행자 공개키 — DID별 캐시
        let pubKey = pubKeyCache.get(vc.issuer);
        if (pubKey === undefined) {
          const r = await resolvePublicKey(vc.issuer);
          pubKey = r.found && r.publicKeyHex ? r.publicKeyHex : null;
          pubKeyCache.set(vc.issuer, pubKey);
        }
        if (pubKey) {
          const payload = JSON.stringify({ ...vc, proof: undefined });
          result.issuerSig = verifySignature(payload, vc.proof.proofValue, pubKey);
        } else {
          result.note = "발행자 공개키 미등록";
        }

        // 2) 폐기 여부
        const cs = vc.credentialStatus;
        if (cs?.statusListId !== undefined && cs?.statusListIndex !== undefined) {
          const rev = await checkRevocationStatus(cs.statusListId, cs.statusListIndex);
          if (rev.checked) result.revoked = rev.revoked ? "revoked" : "valid";
        }
      } catch {
        result = { state: "done", issuerSig: null, revoked: "unknown", note: "검증 오류" };
      }
      setCareerVerify((prev) => ({ ...prev, [c.id]: result }));
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-indigo-700 text-white px-6 py-4 flex items-center gap-4">
        <Link href="/" className="text-white hover:text-white/80">← 뒤로</Link>
        <div>
          <h1 className="text-xl font-bold">은행 · 경력 검증</h1>
          <p className="text-sm opacity-80">WorkPass 경력 인증서 진위 확인 시스템</p>
        </div>
      </header>

      <div className="max-w-2xl mx-auto p-6 space-y-4">
        {/* 탭 전환 */}
        <div className="flex gap-2 bg-white rounded-xl p-1 shadow-sm">
          <button
            onClick={() => setTab("direct")}
            className={`flex-1 py-2.5 rounded-lg text-sm font-semibold transition-colors ${
              tab === "direct" ? "bg-indigo-700 text-white" : "text-gray-500 hover:bg-gray-50"
            }`}
          >
            👤 직원 직접 조회
          </button>
          <button
            onClick={() => setTab("vp")}
            className={`flex-1 py-2.5 rounded-lg text-sm font-semibold transition-colors ${
              tab === "vp" ? "bg-indigo-700 text-white" : "text-gray-500 hover:bg-gray-50"
            }`}
          >
            🔐 VP 파일 검증
          </button>
        </div>

        {tab === "direct" && (
          <>
            <div className="bg-indigo-50 rounded-xl p-4 border border-indigo-100">
              <p className="text-sm font-semibold text-indigo-800 mb-1">👤 직원 직접 조회 (자동 검증)</p>
              <p className="text-xs text-indigo-700">
                직원 본인이 창구에서 <strong>아이디와 PIN</strong>을 입력하면 등록된 모든 경력을 바로 확인하고,
                각 경력 인증서의 <strong>발행자 서명·폐기 여부를 블록체인에서 자동으로 검증</strong>합니다.
                VP 파일·공개키를 따로 주고받을 필요가 없습니다.
              </p>
            </div>

            <div className="bg-white rounded-xl p-6 shadow-sm space-y-4">
              <h2 className="text-lg font-semibold">직원 아이디 · PIN 입력</h2>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">직원 아이디 *</label>
                <input
                  className="w-full border rounded-lg px-4 py-2 text-sm"
                  placeholder="직원 본인 로그인 아이디"
                  value={lookupId}
                  onChange={(e) => setLookupId(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">PIN (4자리) *</label>
                <input
                  type="password"
                  inputMode="numeric"
                  maxLength={4}
                  className="w-full border rounded-lg px-4 py-2 text-sm tracking-widest"
                  placeholder="••••"
                  value={lookupPin}
                  onChange={(e) => setLookupPin(e.target.value.replace(/\D/g, ""))}
                  onKeyDown={(e) => e.key === "Enter" && handleDirectLookup()}
                />
              </div>
              {lookupMsg && (
                <p className={`text-xs px-2 py-1.5 rounded ${
                  lookupMsg.startsWith("❌") ? "bg-red-50 text-red-600" : "bg-gray-50 text-gray-600"
                }`}>
                  {lookupMsg}
                </p>
              )}
              <button
                className="w-full bg-indigo-700 text-white rounded-lg py-3 font-semibold hover:bg-indigo-800 disabled:opacity-50"
                disabled={!lookupId.trim() || lookupPin.length < 4 || lookupLoading}
                onClick={handleDirectLookup}
              >
                {lookupLoading ? "조회 중..." : "🔍 경력 조회"}
              </button>
            </div>

            {careers && careers.length > 0 && (
              <div className="bg-white rounded-xl p-6 shadow-sm space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold text-gray-700">
                    {careerName} 님의 경력 ({careers.length}건)
                  </p>
                  <button
                    onClick={() => { setCareers(null); setLookupPin(""); setCareerVerify({}); }}
                    className="text-xs text-gray-400 hover:text-red-400"
                  >
                    ✕ 닫기
                  </button>
                </div>
                {careers.map((c) => (
                  <div key={c.id} className="border rounded-lg p-3 space-y-1.5 text-sm">
                    <div className="flex justify-between items-start">
                      <span className="font-semibold text-gray-800">
                        {c.employerName || "(사업장명 미발급)"}
                      </span>
                      <span className={`text-xs px-2 py-0.5 rounded-full ${
                        c.status === "active" ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"
                      }`}>
                        {c.status === "active" ? "재직" : "퇴사"}
                      </span>
                    </div>
                    <Row label="직무" value={c.position} />
                    {c.employmentType && <Row label="고용형태" value={c.employmentType} />}
                    <Row label="근무 기간" value={`${c.startDate || "?"} ~ ${c.endDate || "미정"}`} />
                    {c.hourlyWage > 0 && <Row label="시급" value={`${c.hourlyWage.toLocaleString()}원`} />}
                    <Row label="출근 일수" value={`${c.attendanceCount}일`} />
                    {c.totalHours != null && <Row label="총 근무시간" value={`${c.totalHours}시간`} />}
                    {(() => {
                      const v = careerVerify[c.id];
                      return (
                        <div className="pt-1.5 border-t space-y-1">
                          <div className="flex justify-between items-center">
                            <span className="text-gray-500">경력 인증서(VC)</span>
                            {c.hasVC
                              ? <span className="text-green-600 font-medium text-xs">✓ 발급됨</span>
                              : <span className="text-gray-400 text-xs">미발급</span>}
                          </div>
                          {c.hasVC && (
                            <>
                              <div className="flex justify-between items-center">
                                <span className="text-gray-500">발행자 서명</span>
                                {!v || v.state === "verifying"
                                  ? <span className="text-gray-400 text-xs">검증 중…</span>
                                  : v.issuerSig === true
                                  ? <span className="text-green-600 font-medium text-xs">✓ 진본 확인</span>
                                  : v.issuerSig === false
                                  ? <span className="text-red-600 font-medium text-xs">✗ 위·변조</span>
                                  : <span className="text-gray-400 text-xs">{v.note || "공개키 없음"}</span>}
                              </div>
                              <div className="flex justify-between items-center">
                                <span className="text-gray-500">폐기 여부</span>
                                {!v || v.state === "verifying"
                                  ? <span className="text-gray-400 text-xs">확인 중…</span>
                                  : v.revoked === "valid"
                                  ? <span className="text-green-600 font-medium text-xs">✓ 유효</span>
                                  : v.revoked === "revoked"
                                  ? <span className="text-red-600 font-medium text-xs">✗ 폐기됨</span>
                                  : <span className="text-gray-400 text-xs">미확인</span>}
                              </div>
                            </>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {tab === "vp" && (
        <>
        {/* 안내 카드 */}
        <div className="bg-indigo-50 rounded-xl p-4 border border-indigo-100">
          <p className="text-sm font-semibold text-indigo-800 mb-1">🏦 검증 절차</p>
          <ol className="list-decimal list-inside space-y-1 text-xs text-indigo-700">
            <li>직원에게 VP 파일(.json)을 받아 업로드</li>
            <li>
              사장이 Sepolia에 DID 등록 → <strong>&apos;⛓ 블록체인 자동 조회&apos;</strong> 버튼으로 공개키 자동 입력<br />
              <span className="text-indigo-500 pl-3">또는: 사장 페이지 &apos;공개키 복사&apos; 후 직접 붙여넣기</span>
            </li>
            <li>검증 실행 → 서명 일치 확인</li>
          </ol>
        </div>

        {/* 검증 폼 */}
        <div className="bg-white rounded-xl p-6 shadow-sm space-y-4">
          <h2 className="text-lg font-semibold">경력 인증서 검증</h2>

          {/* VP 파일 입력 */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-sm font-medium text-gray-700">VP 파일 *</label>
              <label className="flex items-center gap-1 cursor-pointer text-xs text-indigo-600 hover:text-indigo-800">
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
              className="w-full border rounded-lg p-3 text-xs font-mono h-28 resize-none"
              placeholder="직원에게 받은 VP JSON을 붙여넣거나 파일을 업로드하세요"
              value={vpInput}
              onChange={(e) => setVpInput(e.target.value)}
            />
            {vpInput && (
              <button onClick={() => setVpInput("")} className="text-xs text-gray-400 hover:text-red-400 mt-1">✕ 초기화</button>
            )}
          </div>

          {/* 발행자 공개키 */}
          <div>
            <div className="flex items-center justify-between mb-1 gap-2 flex-wrap">
              <label className="text-sm font-medium text-gray-700">
                발행자 공개키 (hex)
                {keyStatus === "chain_ok" && <span className="ml-2 text-xs text-green-600">✓ 블록체인 조회됨</span>}
                {keyStatus === "chain_fail" && <span className="ml-2 text-xs text-orange-500">블록체인 조회 실패</span>}
                {keyStatus === "manual" && <span className="ml-2 text-xs text-gray-400">직접 입력</span>}
              </label>
              <button
                onClick={handleLookupFromChain}
                disabled={!vpInput.trim() || chainLookupLoading}
                className="flex-shrink-0 text-xs bg-indigo-600 text-white px-3 py-1.5 rounded-lg hover:bg-indigo-700 disabled:opacity-40 transition-colors"
              >
                {chainLookupLoading ? "조회 중..." : "⛓ 블록체인 자동 조회"}
              </button>
            </div>
            {chainLookupMsg && (
              <p className={`text-xs mb-2 px-2 py-1 rounded ${
                chainLookupMsg.startsWith("✅") ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"
              }`}>
                {chainLookupMsg}
              </p>
            )}
            <input
              className="w-full border rounded-lg px-4 py-2 font-mono text-sm"
              placeholder="VP 업로드 후 '⛓ 블록체인 자동 조회' 또는 사장 페이지 '공개키 복사' 후 붙여넣기"
              value={issuerPubKey}
              onChange={(e) => { setIssuerPubKey(e.target.value); setKeyStatus("manual"); setChainLookupMsg(""); }}
            />
            <p className="text-xs text-gray-400 mt-1">
              * 사장이 Sepolia에 DID를 등록한 경우 자동 조회 가능
            </p>
          </div>

          {/* 홀더 공개키 — 선택 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">직원 공개키 (hex, 선택)</label>
            <input
              className="w-full border rounded-lg px-4 py-2 font-mono text-sm"
              placeholder="생략 가능 (직원 본인 서명 추가 검증 시 사용)"
              value={holderPubKey}
              onChange={(e) => setHolderPubKey(e.target.value)}
            />
          </div>

          {/* 폐기 확인 토글 */}
          <div className="flex items-center justify-between bg-gray-50 rounded-lg p-3">
            <div>
              <p className="text-sm font-medium text-gray-700">블록체인 폐기 여부 확인</p>
              <p className="text-xs text-gray-400">Sepolia 네트워크에서 VC 폐기 상태를 조회합니다</p>
            </div>
            <div
              onClick={() => setCheckRevocation(!checkRevocation)}
              className={`w-10 h-6 rounded-full transition-colors relative cursor-pointer flex-shrink-0 ${checkRevocation ? "bg-indigo-600" : "bg-gray-300"}`}
            >
              <div className={`w-4 h-4 bg-white rounded-full absolute top-1 transition-transform ${checkRevocation ? "translate-x-5" : "translate-x-1"}`} />
            </div>
          </div>
          {checkRevocation && chainMsg && (
            <p className="text-xs text-indigo-600 bg-indigo-50 rounded p-2">{chainMsg}</p>
          )}

          <button
            className="w-full bg-indigo-700 text-white rounded-lg py-3 font-semibold hover:bg-indigo-800 disabled:opacity-50"
            disabled={!vpInput.trim() || loading}
            onClick={handleVerify}
          >
            {loading ? "검증 중..." : "🔍 경력 검증 실행"}
          </button>
        </div>

        {/* 검증 결과 */}
        {result && (() => {
          const cfg = STATUS_CONFIG[result.status];
          return (
            <div className={`rounded-xl border-2 p-6 ${cfg.bg}`}>
              <div className="flex items-center gap-3 mb-5">
                <span className="text-4xl">{cfg.icon}</span>
                <div>
                  <p className={`text-2xl font-bold ${cfg.text}`}>{cfg.label}</p>
                  <p className={`text-sm mt-0.5 ${cfg.text}`}>{result.message}</p>
                </div>
              </div>

              {/* 검증 체크리스트 */}
              <div className="bg-white rounded-xl p-4 space-y-2 mb-4">
                <p className="text-sm font-semibold text-gray-700 mb-3">검증 항목</p>

                {/* 발행자 서명 */}
                <div className="flex justify-between items-center text-sm">
                  <span className="text-gray-600">발행자 서명 검증</span>
                  {result.details.issuerSigValid === null
                    ? <span className="text-gray-400 text-xs">공개키 미입력</span>
                    : result.details.issuerSigValid
                    ? <span className="text-green-600 font-medium">✓ 통과</span>
                    : <span className="text-red-600 font-medium">✗ 실패</span>}
                </div>

                {/* 직원 서명 */}
                <div className="flex justify-between items-center text-sm">
                  <span className="text-gray-600">제출자(직원) 서명 검증</span>
                  {!holderPubKey
                    ? <span className="text-gray-400 text-xs">공개키 미입력</span>
                    : result.details.holderSigValid
                    ? <span className="text-green-600 font-medium">✓ 통과</span>
                    : <span className="text-red-600 font-medium">✗ 실패</span>}
                </div>

                {/* 폐기 여부 */}
                <div className="flex justify-between items-center text-sm">
                  <span className="text-gray-600">폐기 여부 확인</span>
                  {result.details.revokedStatus === "not_checked"
                    ? <span className="text-gray-400 text-xs">확인 안 함 (토글 켜기)</span>
                    : result.details.revokedStatus === "valid"
                    ? <span className="text-green-600 font-medium">✓ 통과</span>
                    : <span className="text-red-600 font-medium">✗ 폐기됨</span>}
                </div>
              </div>

              {/* 경력 내용 */}
              {result.details.credentials.length > 0 && (
                <div className="bg-white rounded-xl p-4 space-y-3">
                  <p className="text-sm font-semibold text-gray-700">경력 내용</p>
                  {result.details.credentials.map((c, i) => (
                    <div key={i} className="border rounded-lg p-3 space-y-1.5 text-sm">
                      <Row label="사업장" value={c.employer} />
                      <Row label="직무" value={c.position} />
                      {c.employmentType && <Row label="고용형태" value={c.employmentType} />}
                      <Row label="근무 기간" value={c.period} />
                      {c.hourlyWage && <Row label="시급" value={`${c.hourlyWage.toLocaleString()}원`} />}
                      <div className="flex justify-between pt-1 border-t">
                        <span className="text-gray-500">서명 검증</span>
                        {c.sigValid === null
                          ? <span className="text-gray-400 text-xs">공개키 필요</span>
                          : c.sigValid
                          ? <span className="text-green-600 font-medium">✓ 유효</span>
                          : <span className="text-red-600 font-medium">✗ 불일치</span>}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* 공개 항목 */}
              {result.details.disclosedFields.length > 0 && (
                <div className="mt-3 bg-white rounded-xl p-3 text-sm">
                  <p className="text-gray-500 mb-1">공개 동의 항목</p>
                  <p className="text-gray-700">{result.details.disclosedFields.join(", ")}</p>
                </div>
              )}

              {/* 공개키 없을 때 안내 */}
              {result.status === "no_key" && (
                <div className="mt-3 bg-yellow-50 rounded-xl p-3 text-sm text-yellow-800">
                  <p className="font-semibold mb-1">💡 공개키 입력 방법</p>
                  <p className="text-xs">사장 페이지(<strong>/employer</strong>) 접속 → 상단 &apos;공개키 복사&apos; 버튼 클릭 → 위 공개키 입력란에 붙여넣기</p>
                </div>
              )}
            </div>
          );
        })()}
        </>
        )}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-gray-500">{label}</span>
      <span className="font-medium text-gray-800">{value}</span>
    </div>
  );
}
