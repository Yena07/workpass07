"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { getOrCreateWallet, WalletData } from "@/lib/wallet";
import { issueVC, VerifiableCredential } from "@/lib/vc";
import { connectMetaMask, MetaMaskState, getConnectedAccount, switchToHardhat } from "@/lib/metamask";
import { registerIssuerOnChain, resolvePublicKey } from "@/lib/blockchain";

// ── 타입 ────────────────────────────────────────────────────────────────────
interface AttendanceRecord {
  date: string;
  checkInTime: string;
  checkOutTime?: string;
}

interface Employee {
  id: string;
  workerId: string;
  name: string;
  position: string;
  employmentType: string;
  startDate: string;
  endDate: string;
  weekdays: string[];
  specificDates: string[];
  hourlyWage: number;
  weeklyHours: number;
  attendance: AttendanceRecord[];
  vc?: object;
  workerDid?: string;
  status: "active" | "terminated";
  terminatedAt?: string;
  createdAt: string;
}

type AddForm = {
  position: string;
  employmentType: string;
  startDate: string;
  endDate: string;
  weekdays: string[];
  hourlyWage: string;
  weeklyHours: string;
};

type FoundWorker = { id: string; name: string; did: string | null };

const WEEKDAY_LABELS: { key: string; label: string }[] = [
  { key: "mon", label: "월" },
  { key: "tue", label: "화" },
  { key: "wed", label: "수" },
  { key: "thu", label: "목" },
  { key: "fri", label: "금" },
  { key: "sat", label: "토" },
  { key: "sun", label: "일" },
];

const EMPLOYMENT_TYPES = ["단기/시간제", "일용직", "플랫폼 노동", "계약직"];

// ── 메인 컴포넌트 ────────────────────────────────────────────────────────────
export default function EmployerPage() {
  const [wallet, setWallet] = useState<WalletData | null>(null);
  const [bizName, setBizName] = useState("");
  const [bizNameEdit, setBizNameEdit] = useState(false);
  const bizNameRef = useRef("");

  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);

  // 모달
  const [showModal, setShowModal] = useState(false);
  const [addForm, setAddForm] = useState<AddForm>(defaultForm());
  const [addError, setAddError] = useState("");
  const [addLoading, setAddLoading] = useState(false);

  // 직원 ID 검색
  const [searchId, setSearchId] = useState("");
  const [foundWorker, setFoundWorker] = useState<FoundWorker | null>(null);
  const [searchMsg, setSearchMsg] = useState("");
  const [searchLoading, setSearchLoading] = useState(false);

  // 직원 상세 패널
  const [selectedEmp, setSelectedEmp] = useState<Employee | null>(null);

  // 퇴사 처리
  const [terminatingId, setTerminatingId] = useState<string | null>(null);
  const [terminateMsg, setTerminateMsg] = useState<Record<string, string>>({});

  // MetaMask
  const [metaMask, setMetaMask] = useState<MetaMaskState>({ connected: false });
  const [registerLoading, setRegisterLoading] = useState(false);
  const [registerMsg, setRegisterMsg] = useState("");
  // 온체인 DID 등록 상태: null=확인중, true=등록됨, false=미등록
  const [didOnChain, setDidOnChain] = useState<boolean | null>(null);

  // 초기화
  useEffect(() => {
    const w = getOrCreateWallet("issuer", "발행자");
    setWallet(w);
    const savedName = localStorage.getItem("workpass_biz_name") || "";
    setBizName(savedName);
    bizNameRef.current = savedName;
    fetchEmployees();
    // MetaMask 자동 감지 + 이벤트 리스너
    getConnectedAccount().then(setMetaMask);
    const handleChange = () => getConnectedAccount().then(setMetaMask);
    window.ethereum?.on("accountsChanged", handleChange);
    window.ethereum?.on("chainChanged", handleChange);
    // 온체인 DID 등록 여부 자동 확인 (MetaMask 없이도 가능)
    resolvePublicKey(w.keyPair.did).then((r) => setDidOnChain(r.found));
    return () => {
      window.ethereum?.removeListener("accountsChanged", handleChange);
      window.ethereum?.removeListener("chainChanged", handleChange);
    };
  }, []);

  function defaultForm(): AddForm {
    return {
      position: "",
      employmentType: "단기/시간제",
      startDate: "",
      endDate: "",
      weekdays: ["mon", "tue", "wed", "thu", "fri"],
      hourlyWage: "",
      weeklyHours: "",
    };
  }

  function openAddModal() {
    setAddForm(defaultForm());
    setAddError("");
    setSearchId("");
    setFoundWorker(null);
    setSearchMsg("");
    setShowModal(true);
  }

  // 직원 계정 ID 검색
  async function handleSearchWorker() {
    setSearchMsg("");
    setFoundWorker(null);
    if (!searchId.trim()) return setSearchMsg("직원 ID를 입력하세요");
    setSearchLoading(true);
    try {
      const res = await fetch(`/api/workers/search?id=${encodeURIComponent(searchId.trim())}`);
      const data = await res.json();
      if (res.ok) {
        setFoundWorker(data);
        setSearchMsg("");
      } else {
        setSearchMsg(data.error || "검색 실패");
      }
    } catch {
      setSearchMsg("서버 오류");
    } finally {
      setSearchLoading(false);
    }
  }

  // ── MetaMask 연결 ──────────────────────────────────────────────────────────
  async function handleConnectMetaMask() {
    const state = await connectMetaMask();
    setMetaMask(state);
    if (state.connected && state.chainId !== 11155111) {
      await switchToHardhat();
      const newState = await getConnectedAccount();
      setMetaMask(newState);
    }
  }

  // ── Sepolia DID 등록 ───────────────────────────────────────────────────────
  async function handleRegisterDID() {
    if (!wallet || !metaMask.signer) return;
    setRegisterLoading(true);
    setRegisterMsg("MetaMask에서 트랜잭션을 승인하세요...");
    try {
      const result = await registerIssuerOnChain(
        wallet.keyPair.did,
        wallet.keyPair.publicKey,
        metaMask.signer
      );
      if (result.success) {
        setRegisterMsg(`✅ DID 등록 완료! (tx: ${result.txHash?.slice(0, 10)}...)`);
        setDidOnChain(true);
      } else if (result.error === "이미 등록된 DID입니다.") {
        // 이미 등록된 경우 = 정상 상태
        setRegisterMsg("✅ 이미 Sepolia에 등록되어 있습니다");
        setDidOnChain(true);
      } else {
        setRegisterMsg(`❌ ${result.error}`);
      }
    } catch (e) {
      setRegisterMsg(`❌ 오류: ${String(e)}`);
    } finally {
      setRegisterLoading(false);
    }
  }

  async function fetchEmployees() {
    setLoading(true);
    try {
      const res = await fetch("/api/employees");
      const data = await res.json();
      setEmployees(Array.isArray(data) ? data : []);
    } catch {
      setEmployees([]);
    } finally {
      setLoading(false);
    }
  }

  function saveBizName() {
    localStorage.setItem("workpass_biz_name", bizNameRef.current);
    setBizName(bizNameRef.current);
    setBizNameEdit(false);
  }

  // ── 직원 추가 ──────────────────────────────────────────────────────────────
  async function handleAddEmployee() {
    setAddError("");
    if (!foundWorker) return setAddError("먼저 직원 ID를 검색해 연결하세요");
    if (!addForm.position.trim()) return setAddError("직무를 입력하세요");
    if (!addForm.startDate) return setAddError("근무 시작일을 입력하세요");
    if (addForm.endDate && new Date(addForm.endDate) < new Date(addForm.startDate))
      return setAddError("종료일이 시작일보다 빠릅니다");
    if (addForm.weekdays.length === 0) return setAddError("근무 요일을 하나 이상 선택하세요");
    if (!addForm.hourlyWage) return setAddError("시급을 입력하세요");
    if (!addForm.weeklyHours) return setAddError("주간 근무 시간을 입력하세요");

    setAddLoading(true);
    try {
      const res = await fetch("/api/employees", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workerId: foundWorker.id,
          position: addForm.position,
          employmentType: addForm.employmentType,
          startDate: addForm.startDate,
          endDate: addForm.endDate,
          weekdays: addForm.weekdays,
          hourlyWage: Number(addForm.hourlyWage),
          weeklyHours: Number(addForm.weeklyHours),
        }),
      });
      const data = await res.json();
      if (!res.ok) { setAddError(data.error || "추가 실패"); return; }
      setShowModal(false);
      await fetchEmployees();
    } catch {
      setAddError("서버 오류가 발생했습니다");
    } finally {
      setAddLoading(false);
    }
  }

  // ── 퇴사 처리 + VC 자동 발행 ───────────────────────────────────────────────
  async function handleTerminate(emp: Employee) {
    if (!wallet) return;
    if (emp.status === "terminated") return;

    if (!emp.workerDid) {
      setTerminateMsg((p) => ({ ...p, [emp.id]: "⚠️ 직원이 DID를 등록해야 퇴사 처리 및 VC 발급이 가능합니다" }));
      return;
    }

    const currentBizName = localStorage.getItem("workpass_biz_name") || "";
    if (!currentBizName) {
      setTerminateMsg((p) => ({ ...p, [emp.id]: "⚠️ 먼저 사업장 이름을 입력하세요" }));
      return;
    }

    // 실제 총 근무시간 계산: 출근일수 × (주간근무시간 / 주당 근무요일 수)
    const daysPerWeek = emp.weekdays.length || 1;
    const hoursPerDay = emp.weeklyHours / daysPerWeek;
    const actualTotalHours = Math.round(emp.attendance.length * hoursPerDay);

    const today = new Date().toISOString().split("T")[0];

    const confirmed = confirm(
      `퇴사 처리 확인\n\n` +
      `직원: ${emp.name}\n` +
      `총 출근: ${emp.attendance.length}일\n` +
      `총 근무시간: 약 ${actualTotalHours}시간\n\n` +
      `퇴사 처리 시 경력 인증서(VC)가 자동으로 발급됩니다.\n계속하시겠습니까?`
    );
    if (!confirmed) return;

    setTerminatingId(emp.id);
    setTerminateMsg((p) => ({ ...p, [emp.id]: "처리 중..." }));

    try {
      // 1. VC 발행 (실제 출근 기반 총 근무시간 사용)
      const vc: VerifiableCredential = issueVC(
        {
          id: emp.workerDid,
          employerName: currentBizName,
          position: emp.position,
          employmentType: emp.employmentType,
          startDate: emp.startDate,
          endDate: today, // 퇴사일 = 오늘
          hourlyWage: emp.hourlyWage,
          totalHours: actualTotalHours,
        },
        wallet.keyPair.did,
        wallet.keyPair.privateKey,
        1,
        Math.floor(Math.random() * 10000),
        "0xDCE05B10146EAbA60dA828Cd0c58cf68D9462487"
      );

      // 2. VC 서버 저장
      const vcRes = await fetch(`/api/employees/${emp.id}/vc`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(vc),
      });
      if (!vcRes.ok) {
        const err = await vcRes.json();
        setTerminateMsg((p) => ({ ...p, [emp.id]: `✗ VC 저장 실패: ${err.error}` }));
        return;
      }

      // 3. 직원 상태 퇴사로 변경
      await fetch(`/api/employees/${emp.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "terminated", terminatedAt: today, endDate: today }),
      });

      setTerminateMsg((p) => ({ ...p, [emp.id]: `✅ 퇴사 처리 완료! VC가 발급되었습니다 (총 ${actualTotalHours}시간)` }));
      await fetchEmployees();
    } catch (e) {
      setTerminateMsg((p) => ({ ...p, [emp.id]: `✗ 오류: ${String(e)}` }));
    } finally {
      setTerminatingId(null);
    }
  }

  // ── 직원 삭제 ──────────────────────────────────────────────────────────────
  async function handleDeleteEmployee(emp: Employee) {
    if (!confirm(`${emp.name} 직원을 삭제하시겠습니까?`)) return;
    try {
      await fetch(`/api/employees/${emp.id}`, { method: "DELETE" });
      if (selectedEmp?.id === emp.id) setSelectedEmp(null);
      await fetchEmployees();
    } catch {
      alert("삭제 실패");
    }
  }

  // ── 렌더링 ────────────────────────────────────────────────────────────────
  const activeEmployees = employees.filter((e) => e.status !== "terminated");
  const terminatedEmployees = employees.filter((e) => e.status === "terminated");

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-orange-500 text-white px-6 py-4 flex items-center gap-4">
        <Link href="/" className="text-white hover:text-white/80">← 뒤로</Link>
        <div className="flex-1">
          <h1 className="text-xl font-bold">사장 · 고용주</h1>
          <p className="text-sm opacity-80">직원 관리 및 경력 인증서 발행</p>
        </div>
        <button onClick={fetchEmployees} className="text-xs text-white/70 hover:text-white">새로고침</button>
      </header>

      <div className="max-w-3xl mx-auto p-4 space-y-4">
        {/* 사업장 정보 */}
        <div className="bg-white rounded-xl p-4 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-gray-700">내 사업장 정보</h3>
            {!bizNameEdit && (
              <button onClick={() => { bizNameRef.current = bizName; setBizNameEdit(true); }} className="text-xs text-orange-500 hover:underline">수정</button>
            )}
          </div>
          {bizNameEdit ? (
            <div className="flex gap-2">
              <input
                className="flex-1 border rounded-lg px-3 py-2 text-sm"
                placeholder="사업장 이름 (예: 스타벅스 강남점)"
                defaultValue={bizNameRef.current}
                onChange={(e) => { bizNameRef.current = e.target.value; }}
                onKeyDown={(e) => e.key === "Enter" && saveBizName()}
                autoFocus
              />
              <button onClick={saveBizName} className="px-3 py-2 bg-orange-500 text-white rounded-lg text-sm hover:bg-orange-600">저장</button>
            </div>
          ) : (
            <p className="text-lg font-bold text-orange-600">
              {bizName || <span className="text-gray-400 font-normal text-sm">사업장 이름을 입력하세요 →</span>}
            </p>
          )}
          {wallet && (
            <div className="mt-3 pt-3 border-t space-y-3">
              {/* 발행자 DID */}
              <div>
                <div className="flex justify-between items-center">
                  <p className="text-xs text-gray-500">발행자 DID (서명용 공개키)</p>
                  <button onClick={() => navigator.clipboard.writeText(wallet.keyPair.publicKey)} className="text-xs text-orange-500 hover:underline">공개키 복사</button>
                </div>
                <p className="text-xs text-gray-400 break-all mt-1">{wallet.keyPair.did}</p>
              </div>

              {/* MetaMask 블록체인 연동 */}
              <div className="border-t pt-2">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-medium text-gray-600">⛓ 블록체인 DID 등록 (Sepolia)</p>
                  {/* 온체인 등록 상태 뱃지 */}
                  {didOnChain === null && (
                    <span className="text-xs text-gray-400">확인 중...</span>
                  )}
                  {didOnChain === true && (
                    <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">✓ 등록됨</span>
                  )}
                  {didOnChain === false && (
                    <span className="text-xs bg-orange-100 text-orange-700 px-2 py-0.5 rounded-full">미등록</span>
                  )}
                </div>

                {/* 이미 등록된 경우 — MetaMask 연결 불필요 */}
                {didOnChain === true ? (
                  <div className="bg-green-50 rounded-lg px-3 py-2 text-xs text-green-700">
                    ✅ 공개키가 Sepolia DIDRegistry에 등록되어 있습니다.<br />
                    <span className="text-green-600">은행 페이지에서 &apos;⛓ 블록체인 자동 조회&apos;로 공개키를 가져올 수 있습니다.</span>
                  </div>
                ) : !metaMask.connected ? (
                  <button
                    onClick={handleConnectMetaMask}
                    className="w-full flex items-center justify-center gap-2 bg-orange-50 border border-orange-200 text-orange-700 rounded-lg py-2 text-sm hover:bg-orange-100 font-medium transition-colors"
                  >
                    🦊 MetaMask 연결 후 DID 등록
                  </button>
                ) : (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <div>
                        <p className="text-xs font-medium text-gray-700">
                          🦊 {metaMask.address?.slice(0, 6)}...{metaMask.address?.slice(-4)}
                        </p>
                        <p className="text-xs mt-0.5">
                          {metaMask.chainId === 11155111
                            ? <span className="text-green-600">✓ Sepolia</span>
                            : <span className="text-red-500">⚠️ Sepolia 아님 — 전환 필요</span>}
                        </p>
                      </div>
                      {metaMask.chainId !== 11155111 ? (
                        <button
                          onClick={async () => {
                            await switchToHardhat();
                            const s = await getConnectedAccount();
                            setMetaMask(s);
                          }}
                          className="text-xs bg-blue-500 text-white px-3 py-1.5 rounded-lg hover:bg-blue-600"
                        >
                          Sepolia로 전환
                        </button>
                      ) : (
                        <button
                          onClick={handleRegisterDID}
                          disabled={registerLoading}
                          className="text-xs bg-orange-500 text-white px-3 py-1.5 rounded-lg hover:bg-orange-600 disabled:opacity-50"
                        >
                          {registerLoading ? "등록 중..." : "⛓ DID 등록"}
                        </button>
                      )}
                    </div>
                    {registerMsg && (
                      <p className={`text-xs ${registerMsg.startsWith("✅") ? "text-green-600" : "text-red-500"}`}>
                        {registerMsg}
                      </p>
                    )}
                  </div>
                )}
                {didOnChain !== true && (
                  <p className="text-xs text-gray-400 mt-1.5">
                    등록 후 은행 페이지에서 블록체인으로 공개키를 자동 조회할 수 있습니다
                  </p>
                )}
              </div>
            </div>
          )}
        </div>

        {/* 재직 중 직원 목록 */}
        <div className="bg-white rounded-xl shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b">
            <h3 className="font-semibold text-gray-700">
              재직 중
              <span className="ml-2 text-sm text-gray-400">({activeEmployees.length}명)</span>
            </h3>
            <button
              onClick={openAddModal}
              className="flex items-center gap-1 bg-orange-500 text-white px-3 py-1.5 rounded-lg text-sm hover:bg-orange-600"
            >
              + 직원 추가
            </button>
          </div>

          {loading ? (
            <div className="p-8 text-center text-gray-400">불러오는 중...</div>
          ) : activeEmployees.length === 0 ? (
            <div className="p-8 text-center text-gray-400">
              <p className="text-4xl mb-3">👥</p>
              <p>직원을 추가해보세요</p>
            </div>
          ) : (
            <div className="divide-y">
              {activeEmployees.map((emp) => (
                <EmployeeRow
                  key={emp.id}
                  emp={emp}
                  selected={selectedEmp?.id === emp.id}
                  onSelect={() => setSelectedEmp(selectedEmp?.id === emp.id ? null : emp)}
                  onTerminate={() => handleTerminate(emp)}
                  onDelete={() => handleDeleteEmployee(emp)}
                  terminatingId={terminatingId}
                  terminateMsg={terminateMsg[emp.id] || ""}
                />
              ))}
            </div>
          )}
        </div>

        {/* 퇴사 직원 목록 */}
        {terminatedEmployees.length > 0 && (
          <div className="bg-white rounded-xl shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b">
              <h3 className="font-semibold text-gray-500">
                퇴사 직원
                <span className="ml-2 text-sm text-gray-400">({terminatedEmployees.length}명)</span>
              </h3>
            </div>
            <div className="divide-y">
              {terminatedEmployees.map((emp) => (
                <TerminatedEmployeeRow
                  key={emp.id}
                  emp={emp}
                  onDelete={() => handleDeleteEmployee(emp)}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── 직원 추가 모달 ── */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl w-full max-w-md max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b">
              <h2 className="text-lg font-bold">직원 추가</h2>
              <button onClick={() => setShowModal(false)} className="text-gray-400 hover:text-gray-600 text-2xl">×</button>
            </div>

            <div className="p-6 space-y-4">
              <Field label="직원 ID 검색 *">
                <div className="flex gap-2">
                  <input
                    className="flex-1 border rounded-lg px-3 py-2 text-sm font-mono"
                    placeholder="직원이 알려준 ID (예: hong123)"
                    value={searchId}
                    onChange={(e) => { setSearchId(e.target.value.replace(/[^a-zA-Z0-9_]/g, "")); setFoundWorker(null); }}
                    onKeyDown={(e) => e.key === "Enter" && handleSearchWorker()}
                  />
                  <button onClick={handleSearchWorker} disabled={searchLoading}
                    className="px-4 py-2 bg-orange-500 text-white rounded-lg text-sm hover:bg-orange-600 disabled:opacity-50">
                    {searchLoading ? "..." : "검색"}
                  </button>
                </div>
                {searchMsg && <p className="text-xs text-red-500 mt-1">{searchMsg}</p>}
                {foundWorker && (
                  <div className="mt-2 bg-green-50 rounded-lg p-3 text-sm">
                    <p className="text-green-700 font-medium">✓ {foundWorker.name} (ID: {foundWorker.id})</p>
                    <p className={`text-xs mt-0.5 ${foundWorker.did ? "text-green-600" : "text-yellow-600"}`}>
                      {foundWorker.did ? "DID 등록됨 — VC 발급 가능" : "⚠️ 직원이 아직 DID 미등록 (연결은 가능)"}
                    </p>
                  </div>
                )}
                <p className="text-xs text-gray-400 mt-1">직원이 직원 포털에서 계정을 만든 뒤 알려준 ID로 검색하세요</p>
              </Field>

              <Field label="직무 *">
                <input className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="바리스타, 매장 도우미 등"
                  value={addForm.position} onChange={(e) => setAddForm((f) => ({ ...f, position: e.target.value }))} />
              </Field>

              <Field label="고용 유형">
                <select className="w-full border rounded-lg px-3 py-2 text-sm"
                  value={addForm.employmentType} onChange={(e) => setAddForm((f) => ({ ...f, employmentType: e.target.value }))}>
                  {EMPLOYMENT_TYPES.map((t) => <option key={t}>{t}</option>)}
                </select>
              </Field>

              <div className="grid grid-cols-2 gap-3">
                <Field label="근무 시작일 *">
                  <input type="date" className="w-full border rounded-lg px-3 py-2 text-sm"
                    value={addForm.startDate} onChange={(e) => setAddForm((f) => ({ ...f, startDate: e.target.value }))} />
                </Field>
                <Field label="근무 종료일 (선택)">
                  <input type="date" className="w-full border rounded-lg px-3 py-2 text-sm"
                    value={addForm.endDate} onChange={(e) => setAddForm((f) => ({ ...f, endDate: e.target.value }))} />
                  <p className="text-xs text-gray-400 mt-1">미입력 시 퇴사 처리 날짜로 자동 설정</p>
                </Field>
              </div>

              <Field label="근무 요일 *">
                <div className="flex gap-2 flex-wrap">
                  {WEEKDAY_LABELS.map(({ key, label }) => {
                    const checked = addForm.weekdays.includes(key);
                    return (
                      <button key={key} type="button"
                        onClick={() => setAddForm((f) => ({ ...f, weekdays: checked ? f.weekdays.filter((d) => d !== key) : [...f.weekdays, key] }))}
                        className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${checked ? "bg-orange-500 text-white border-orange-500" : "bg-white text-gray-600 border-gray-300 hover:border-orange-300"}`}>
                        {label}
                      </button>
                    );
                  })}
                </div>
              </Field>

              <div className="grid grid-cols-2 gap-3">
                <Field label="시급 (원) *">
                  <input type="number" className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="10320"
                    value={addForm.hourlyWage} onChange={(e) => setAddForm((f) => ({ ...f, hourlyWage: e.target.value }))} />
                </Field>
                <Field label="주간 근무 시간 (시간/주) *">
                  <input type="number" className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="20"
                    value={addForm.weeklyHours} onChange={(e) => setAddForm((f) => ({ ...f, weeklyHours: e.target.value }))} />
                </Field>
              </div>

              {/* 주간 시간 → 1일 근무시간 미리보기 */}
              {addForm.weeklyHours && addForm.weekdays.length > 0 && (
                <div className="bg-orange-50 rounded-lg p-3 text-sm text-orange-700">
                  1일 근무시간: 약 {(Number(addForm.weeklyHours) / addForm.weekdays.length).toFixed(1)}시간
                  ({addForm.weekdays.length}일/주 기준)
                </div>
              )}

              {addError && <p className="text-sm text-red-500 bg-red-50 rounded-lg p-3">{addError}</p>}
            </div>

            <div className="px-6 pb-6 flex gap-3">
              <button onClick={() => setShowModal(false)} className="flex-1 border border-gray-300 text-gray-600 rounded-lg py-2.5 hover:bg-gray-50">취소</button>
              <button onClick={handleAddEmployee} disabled={addLoading} className="flex-1 bg-orange-500 text-white rounded-lg py-2.5 hover:bg-orange-600 disabled:opacity-50">
                {addLoading ? "추가 중..." : "직원 추가"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── 재직 중 직원 행 ───────────────────────────────────────────────────────────
function EmployeeRow({
  emp, selected, onSelect, onTerminate, onDelete, terminatingId, terminateMsg,
}: {
  emp: Employee;
  selected: boolean;
  onSelect: () => void;
  onTerminate: () => void;
  onDelete: () => void;
  terminatingId: string | null;
  terminateMsg: string;
}) {
  const today = new Date().toISOString().split("T")[0];
  const attendedCount = emp.attendance.length;
  const totalPlanned = emp.specificDates.length;
  const isToday = emp.specificDates.includes(today);
  const checkedToday = emp.attendance.some((a) => a.date === today);
  const daysPerWeek = emp.weekdays.length || 1;
  const hoursPerDay = emp.weeklyHours / daysPerWeek;
  const estimatedHours = Math.round(attendedCount * hoursPerDay);

  return (
    <div
      className={`p-4 hover:bg-orange-50 cursor-pointer transition-colors ${selected ? "bg-orange-50" : ""}`}
      onClick={onSelect}
    >
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-semibold text-gray-800">{emp.name}</p>
            {isToday && (
              <span className={`text-xs px-2 py-0.5 rounded-full ${checkedToday ? "bg-green-100 text-green-700" : "bg-orange-100 text-orange-700"}`}>
                {checkedToday ? "✓ 출근" : "오늘 근무"}
              </span>
            )}
            <span className={`text-xs px-2 py-0.5 rounded-full ${emp.workerDid ? "bg-blue-100 text-blue-700" : "bg-gray-100 text-gray-500"}`}>
              {emp.workerDid ? "DID 등록됨" : "DID 미등록"}
            </span>
          </div>
          <p className="text-sm text-gray-500 mt-0.5">{emp.position} · {emp.employmentType}</p>
          <p className="text-xs text-gray-400 mt-0.5">
            {emp.startDate} ~ {emp.endDate || "미정"} · 출근 {attendedCount}/{totalPlanned}일 · 누적 약 {estimatedHours}시간
          </p>
        </div>
        <div className="flex items-center gap-2 ml-3 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
          <button onClick={onDelete} className="text-xs px-2 py-1.5 rounded-lg border border-red-200 text-red-400 hover:bg-red-50">삭제</button>
        </div>
      </div>

      {terminateMsg && <p className={`text-xs mt-2 ${terminateMsg.startsWith("✅") ? "text-green-600" : "text-orange-600"}`}>{terminateMsg}</p>}

      {/* 상세 패널 */}
      {selected && (
        <div className="mt-3 pt-3 border-t space-y-3">
          {/* 근무 요일 */}
          <div>
            <p className="text-xs font-medium text-gray-600 mb-1">근무 요일</p>
            <div className="flex gap-1">
              {[{ key: "mon", label: "월" }, { key: "tue", label: "화" }, { key: "wed", label: "수" }, { key: "thu", label: "목" }, { key: "fri", label: "금" }, { key: "sat", label: "토" }, { key: "sun", label: "일" }].map(({ key, label }) => (
                <span key={key} className={`text-xs px-2 py-1 rounded-full ${emp.weekdays.includes(key) ? "bg-orange-100 text-orange-700" : "bg-gray-100 text-gray-400"}`}>{label}</span>
              ))}
            </div>
          </div>

          {/* 시급 / 주간 근무시간 */}
          <div className="flex gap-4 text-sm flex-wrap">
            <span><span className="text-gray-500">시급:</span> {emp.hourlyWage.toLocaleString()}원</span>
            <span><span className="text-gray-500">주간 근무:</span> {emp.weeklyHours}시간/주</span>
            <span><span className="text-gray-500">1일 근무:</span> {hoursPerDay.toFixed(1)}시간</span>
          </div>

          {/* DID 상태 */}
          {emp.workerDid ? (
            <div className="bg-blue-50 rounded-lg p-2">
              <p className="text-xs text-gray-500 mb-0.5">직원 DID</p>
              <p className="text-xs text-blue-700 break-all">{emp.workerDid}</p>
            </div>
          ) : (
            <div className="bg-yellow-50 rounded-lg p-2">
              <p className="text-xs text-yellow-700">⚠️ 직원이 아직 DID를 등록하지 않았습니다. 직원이 본인 계정으로 로그인 후 DID를 등록해야 VC를 발급할 수 있습니다.</p>
            </div>
          )}

          {/* 출근 기록 */}
          {emp.attendance.length > 0 && (
            <div>
              <p className="text-xs font-medium text-gray-600 mb-2">출근 기록 ({emp.attendance.length}회)</p>
              <div className="space-y-1 max-h-32 overflow-y-auto">
                {[...emp.attendance].reverse().map((a) => (
                  <div key={a.date} className="flex justify-between text-xs bg-green-50 rounded px-2 py-1">
                    <span className="text-green-700">{a.date}</span>
                    <span className={a.checkOutTime ? "text-blue-600" : "text-green-600"}>
                      {a.checkOutTime
                        ? `${a.checkInTime} → ${a.checkOutTime}`
                        : `${a.checkInTime} (퇴근 전)`}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 퇴사 처리 버튼 */}
          <div className="pt-2 border-t">
            <div className="bg-gray-50 rounded-xl p-3">
              <p className="text-xs text-gray-500 mb-1">
                퇴사 처리 시 실제 출근 기록을 기반으로 경력 인증서(VC)가 자동 발급됩니다.
              </p>
              <p className="text-xs text-gray-600 mb-3">
                예상 발급 내용: {emp.name} · {emp.position} · 총 약 {estimatedHours}시간 ({attendedCount}일 출근)
              </p>
              <button
                onClick={(e) => { e.stopPropagation(); onTerminate(); }}
                disabled={!!terminatingId || !emp.workerDid}
                title={!emp.workerDid ? "직원이 DID를 등록해야 퇴사 처리 가능" : ""}
                className={`w-full py-2.5 rounded-lg text-sm font-semibold transition-colors ${
                  emp.workerDid
                    ? "bg-red-500 text-white hover:bg-red-600 disabled:opacity-50"
                    : "bg-gray-200 text-gray-400 cursor-not-allowed"
                }`}
              >
                {terminatingId === emp.id ? "처리 중..." : "🚪 퇴사 처리 (VC 자동 발급)"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── 퇴사 직원 행 ─────────────────────────────────────────────────────────────
function TerminatedEmployeeRow({ emp, onDelete }: { emp: Employee; onDelete: () => void }) {
  const [showDetail, setShowDetail] = useState(false);
  const vc = emp.vc as VerifiableCredential | undefined;
  const daysPerWeek = emp.weekdays.length || 1;
  const hoursPerDay = emp.weeklyHours / daysPerWeek;
  const totalHours = vc
    ? (vc as VerifiableCredential).credentialSubject?.totalHours
    : Math.round(emp.attendance.length * hoursPerDay);

  return (
    <div className="p-4 bg-gray-50">
      <div className="flex items-start justify-between">
        <div
          className="flex-1 cursor-pointer"
          onClick={() => setShowDetail(!showDetail)}
        >
          <div className="flex items-center gap-2">
            <p className="font-medium text-gray-500">{emp.name}</p>
            <span className="text-xs px-2 py-0.5 rounded-full bg-gray-200 text-gray-500">퇴사</span>
            {emp.vc && <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700">VC 발급됨</span>}
          </div>
          <p className="text-xs text-gray-400 mt-0.5">
            {emp.position} · {emp.startDate} ~ {emp.terminatedAt || emp.endDate} · 총 {totalHours}시간
          </p>
        </div>
        <button onClick={onDelete} className="text-xs text-gray-400 hover:text-red-400 ml-3">삭제</button>
      </div>

      {showDetail && emp.vc && (
        <div className="mt-3 pt-3 border-t">
          <p className="text-xs font-medium text-gray-500 mb-2">발급된 VC</p>
          <button
            onClick={() => {
              const blob = new Blob([JSON.stringify(emp.vc, null, 2)], { type: "application/json" });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a"); a.href = url;
              a.download = `vc_${emp.name}.json`; a.click(); URL.revokeObjectURL(url);
            }}
            className="text-xs border border-blue-300 text-blue-600 rounded-lg px-3 py-1.5 hover:bg-blue-50"
          >
            📥 VC JSON 다운로드
          </button>
        </div>
      )}
    </div>
  );
}

// ── 공통 서브 컴포넌트 ────────────────────────────────────────────────────────
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      {children}
    </div>
  );
}

