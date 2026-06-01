"use client";

import { useState } from "react";
import Link from "next/link";
import { generateKeyPair, KeyPair } from "@/lib/crypto";
import { createVP, VerifiableCredential, VerifiablePresentation } from "@/lib/vc";
import { saveVC } from "@/lib/wallet";

// ── 타입 ────────────────────────────────────────────────────────────────────
interface AttendanceRecord {
  date: string;
  checkInTime: string;
  checkOutTime?: string;
}

interface Employment {
  id: string;
  workerId: string;
  name: string;
  workerDid?: string;
  position: string;
  employmentType: string;
  startDate: string;
  endDate: string;
  weekdays: string[];
  specificDates: string[];
  hourlyWage: number;
  weeklyHours: number;
  attendance: AttendanceRecord[];
  vc?: VerifiableCredential;
  status: "active" | "terminated";
  createdAt: string;
}

interface Account {
  id: string;
  name: string;
  did?: string | null;
}

const WEEKDAY_LABELS: Record<string, string> = {
  mon: "월", tue: "화", wed: "수", thu: "목", fri: "금", sat: "토", sun: "일",
};

function todayStr() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

// ── 메인 컴포넌트 ────────────────────────────────────────────────────────────
export default function WorkerPage() {
  const [step, setStep] = useState<"auth" | "dashboard">("auth");
  const [mode, setMode] = useState<"login" | "signup">("login");

  // 폼
  const [formId, setFormId] = useState("");
  const [formName, setFormName] = useState("");
  const [formPin, setFormPin] = useState("");
  const [authError, setAuthError] = useState("");
  const [authLoading, setAuthLoading] = useState(false);

  // 세션
  const [account, setAccount] = useState<Account | null>(null);
  const [pin, setPin] = useState("");
  const [employments, setEmployments] = useState<Employment[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [keyPair, setKeyPair] = useState<KeyPair | null>(null);
  const [didRegistered, setDidRegistered] = useState(false);

  const [msg, setMsg] = useState("");

  // ── 계정 키쌍 (계정당 1개) ─────────────────────────────────────────────────
  function loadOrCreateKeyPair(accountId: string, acct: Account): KeyPair {
    const storageKey = `workpass_worker_acct_${accountId}`;
    const stored = localStorage.getItem(storageKey);
    let kp: KeyPair;
    if (stored) {
      kp = JSON.parse(stored);
    } else {
      kp = generateKeyPair();
      localStorage.setItem(storageKey, JSON.stringify(kp));
    }
    setKeyPair(kp);
    setDidRegistered(acct.did === kp.did);
    return kp;
  }

  // ── 발급된 경력을 통합 지갑에 자동 저장 ──────────────────────────────────────
  function syncVCsToWallet(emps: Employment[]) {
    let saved = 0;
    for (const e of emps) {
      if (e.vc && saveVC(e.vc)) saved++;
    }
    if (saved > 0) setMsg(`✓ 새 경력 인증서 ${saved}건이 내 지갑에 자동 저장됐습니다`);
  }

  function applySession(acct: Account, emps: Employment[]) {
    setAccount(acct);
    setEmployments(emps);
    setSelectedId((prev) => prev ?? (emps[0]?.id ?? null));
    loadOrCreateKeyPair(acct.id, acct);
    syncVCsToWallet(emps);
  }

  // ── 회원가입 ────────────────────────────────────────────────────────────────
  async function handleSignup() {
    setAuthError("");
    if (!/^[a-zA-Z0-9_]{3,20}$/.test(formId)) return setAuthError("ID는 영문/숫자/_ 3~20자여야 합니다");
    if (!formName.trim()) return setAuthError("이름을 입력하세요");
    if (formPin.length !== 4) return setAuthError("PIN은 4자리 숫자여야 합니다");

    setAuthLoading(true);
    try {
      const res = await fetch("/api/workers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: formId.trim(), name: formName.trim(), pin: formPin }),
      });
      const data = await res.json();
      if (!res.ok) { setAuthError(data.error || "가입 실패"); return; }
      // 가입 후 자동 로그인
      setPin(formPin);
      applySession({ id: data.id, name: data.name, did: data.did ?? null }, []);
      setStep("dashboard");
    } catch {
      setAuthError("서버 오류가 발생했습니다");
    } finally {
      setAuthLoading(false);
    }
  }

  // ── 로그인 ──────────────────────────────────────────────────────────────────
  async function handleLogin() {
    setAuthError("");
    if (!formId.trim() || formPin.length !== 4) return setAuthError("ID와 4자리 PIN을 입력하세요");
    setAuthLoading(true);
    try {
      const res = await fetch("/api/workers/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: formId.trim(), pin: formPin }),
      });
      const data = await res.json();
      if (!res.ok) { setAuthError(data.error || "로그인 실패"); return; }
      setPin(formPin);
      applySession(data.worker, data.employments || []);
      setStep("dashboard");
    } catch {
      setAuthError("서버 오류가 발생했습니다");
    } finally {
      setAuthLoading(false);
    }
  }

  // ── 최신 정보 새로고침 ────────────────────────────────────────────────────────
  async function refresh() {
    if (!account) return;
    try {
      const res = await fetch("/api/workers/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: account.id, pin }),
      });
      if (res.ok) {
        const data = await res.json();
        setAccount(data.worker);
        setEmployments(data.employments || []);
        syncVCsToWallet(data.employments || []);
      }
    } catch { /* ignore */ }
  }

  // ── DID 등록 (계정에 1회) ─────────────────────────────────────────────────────
  async function handleRegisterDID() {
    if (!account || !keyPair) return;
    try {
      const res = await fetch(`/api/workers/${account.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin, did: keyPair.did }),
      });
      const data = await res.json();
      if (res.ok) {
        setDidRegistered(true);
        setAccount(data.worker);
        setEmployments(data.employments || []);
        setMsg("✓ DID 등록 완료! 이제 사장이 경력 인증서(VC)를 발행할 수 있습니다");
      } else {
        setMsg("DID 등록 실패: " + (data.error || ""));
      }
    } catch {
      setMsg("서버 오류");
    }
  }

  // ── 출근 / 퇴근 ───────────────────────────────────────────────────────────────
  async function handleCheckIn(empId: string) {
    setMsg("");
    try {
      const res = await fetch(`/api/employees/${empId}/attendance`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin }),
      });
      const data = await res.json();
      setMsg(res.ok ? `✅ 출근 체크 완료! (${data.checkInTime})` : `❌ ${data.error}`);
      await refresh();
    } catch {
      setMsg("❌ 서버 오류");
    }
  }

  async function handleCheckOut(empId: string) {
    setMsg("");
    try {
      const res = await fetch(`/api/employees/${empId}/checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin }),
      });
      const data = await res.json();
      setMsg(res.ok ? `✅ 퇴근 체크 완료! (${data.checkOutTime})` : `❌ ${data.error}`);
      await refresh();
    } catch {
      setMsg("❌ 서버 오류");
    }
  }

  function logout() {
    setStep("auth");
    setMode("login");
    setAccount(null);
    setPin("");
    setEmployments([]);
    setSelectedId(null);
    setKeyPair(null);
    setFormId(""); setFormName(""); setFormPin("");
    setMsg("");
  }

  // ─── 로그인 / 회원가입 화면 ────────────────────────────────────────────────
  if (step === "auth") {
    return (
      <PageShell>
        <div className="flex flex-col items-center justify-center flex-1 p-6">
          <div className="w-full max-w-sm space-y-6">
            <div className="text-center">
              <div className="text-6xl mb-4">👤</div>
              <h2 className="text-2xl font-bold text-gray-800">
                {mode === "login" ? "직원 로그인" : "직원 계정 만들기"}
              </h2>
              <p className="text-gray-500 mt-2">
                {mode === "login"
                  ? "내 ID와 PIN으로 로그인하세요"
                  : "내 계정을 만들면 사장이 내 ID로 근무를 연결합니다"}
              </p>
            </div>

            <div className="space-y-3">
              <input
                className="w-full border-2 rounded-xl px-4 py-3 text-lg focus:border-green-500 outline-none"
                placeholder="ID (영문/숫자, 예: hong123)"
                value={formId}
                onChange={(e) => setFormId(e.target.value.replace(/[^a-zA-Z0-9_]/g, ""))}
                autoFocus
              />
              {mode === "signup" && (
                <input
                  className="w-full border-2 rounded-xl px-4 py-3 text-lg focus:border-green-500 outline-none"
                  placeholder="이름 (예: 홍길동)"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                />
              )}
              <input
                type="password"
                maxLength={4}
                className="w-full border-2 rounded-xl px-4 py-3 text-2xl text-center tracking-widest focus:border-green-500 outline-none"
                placeholder="PIN 4자리"
                value={formPin}
                onChange={(e) => setFormPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
                onKeyDown={(e) => e.key === "Enter" && (mode === "login" ? handleLogin() : handleSignup())}
              />
              {authError && <p className="text-sm text-red-500 text-center">{authError}</p>}
              <button
                onClick={mode === "login" ? handleLogin : handleSignup}
                disabled={authLoading}
                className="w-full bg-green-600 text-white rounded-xl py-3 text-lg font-semibold hover:bg-green-700 disabled:opacity-50"
              >
                {authLoading ? "처리 중..." : mode === "login" ? "로그인" : "계정 만들기"}
              </button>
              <button
                onClick={() => { setMode(mode === "login" ? "signup" : "login"); setAuthError(""); }}
                className="w-full text-gray-500 text-sm hover:text-gray-700"
              >
                {mode === "login" ? "계정이 없으신가요? 회원가입" : "이미 계정이 있으신가요? 로그인"}
              </button>
            </div>
          </div>
        </div>
      </PageShell>
    );
  }

  // ─── 대시보드 ─────────────────────────────────────────────────────────────
  if (!account || !keyPair) return null;
  const selected = employments.find((e) => e.id === selectedId) || null;

  return (
    <PageShell>
      <div className="p-4 space-y-4">
        {/* 계정 카드 */}
        <div className="bg-white rounded-xl p-4 shadow-sm">
          <div className="flex items-start justify-between">
            <div>
              <h2 className="text-xl font-bold text-gray-800">{account.name}</h2>
              <p className="text-sm text-gray-500">내 ID: <span className="font-mono font-semibold">{account.id}</span></p>
              <p className="text-xs text-gray-400 mt-0.5">사장에게 이 ID를 알려주면 근무가 연결됩니다</p>
            </div>
            <button onClick={refresh} className="text-xs text-green-500 hover:underline">새로고침</button>
          </div>

          {/* DID 등록 */}
          {!didRegistered ? (
            <div className="mt-3 pt-3 border-t bg-yellow-50 rounded-lg p-3">
              <p className="text-sm font-semibold text-yellow-800 mb-1">⚠️ DID 등록 필요</p>
              <p className="text-xs text-yellow-700 mb-2">사장이 VC를 발행하려면 내 DID를 먼저 등록해야 합니다.</p>
              <p className="text-xs text-gray-500 break-all mb-2">내 DID: {keyPair.did}</p>
              <button onClick={handleRegisterDID} className="w-full bg-yellow-500 text-white rounded-lg py-2 text-sm hover:bg-yellow-600">
                내 DID 등록하기
              </button>
            </div>
          ) : (
            <div className="mt-3 pt-3 border-t">
              <p className="text-xs text-gray-400">내 DID (등록 완료)</p>
              <p className="text-xs text-green-600 break-all">{keyPair.did}</p>
            </div>
          )}
        </div>

        {msg && <p className="text-sm text-center text-gray-700 bg-gray-100 rounded-lg py-2">{msg}</p>}

        {/* 근무 목록 */}
        {employments.length === 0 ? (
          <div className="bg-white rounded-xl p-8 shadow-sm text-center text-gray-400">
            <p className="text-4xl mb-3">🗂️</p>
            <p>아직 연결된 근무가 없습니다</p>
            <p className="text-xs mt-2">사장님께 내 ID(<span className="font-mono">{account.id}</span>)를 알려주세요</p>
          </div>
        ) : (
          <div className="bg-white rounded-xl shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b">
              <h3 className="font-semibold text-gray-700">내 근무 ({employments.length}곳)</h3>
            </div>
            <div className="divide-y">
              {employments.map((emp) => (
                <button
                  key={emp.id}
                  onClick={() => setSelectedId(emp.id === selectedId ? null : emp.id)}
                  className={`w-full text-left p-4 hover:bg-green-50 transition-colors ${selectedId === emp.id ? "bg-green-50" : ""}`}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-semibold text-gray-800">
                        {emp.position}
                        {emp.status === "terminated" && <span className="ml-2 text-xs px-2 py-0.5 rounded-full bg-gray-200 text-gray-500">퇴사</span>}
                        {emp.vc && <span className="ml-2 text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700">VC 발급됨</span>}
                      </p>
                      <p className="text-xs text-gray-400">{emp.employmentType} · {emp.startDate} ~ {emp.endDate || "미정"} · 출근 {emp.attendance.length}일</p>
                    </div>
                    <span className="text-gray-300">{selectedId === emp.id ? "▲" : "▼"}</span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* 선택된 근무 상세 */}
        {selected && (
          <EmploymentPanel
            emp={selected}
            keyPair={keyPair}
            didRegistered={didRegistered}
            onCheckIn={() => handleCheckIn(selected.id)}
            onCheckOut={() => handleCheckOut(selected.id)}
          />
        )}

        <button onClick={logout} className="w-full text-gray-400 text-sm hover:text-red-400 py-2">로그아웃</button>
      </div>
    </PageShell>
  );
}

// ── 근무 상세 패널 ────────────────────────────────────────────────────────────
function EmploymentPanel({
  emp, keyPair, didRegistered, onCheckIn, onCheckOut,
}: {
  emp: Employment;
  keyPair: KeyPair;
  didRegistered: boolean;
  onCheckIn: () => void;
  onCheckOut: () => void;
}) {
  const [tab, setTab] = useState<"schedule" | "vc" | "vp">("schedule");
  const [vpJson, setVpJson] = useState("");
  const [vpError, setVpError] = useState("");

  const today = todayStr();
  const yearMonth = today.slice(0, 7);
  const thisMonth = emp.specificDates.filter((d) => d.startsWith(yearMonth));
  const isTodayWorkDay = emp.specificDates.includes(today);
  const todayRecord = emp.attendance.find((a) => a.date === today);
  const checkedToday = !!todayRecord;
  const checkedOutToday = !!todayRecord?.checkOutTime;

  function makeVP() {
    setVpError(""); setVpJson("");
    if (!emp.vc) return;
    try {
      const vp: VerifiablePresentation = createVP(
        [emp.vc], [0],
        ["employerName", "position", "employmentType", "startDate", "endDate", "hourlyWage"],
        keyPair.did, keyPair.privateKey
      );
      setVpJson(JSON.stringify(vp, null, 2));
    } catch (e) {
      setVpError(String(e));
    }
  }

  return (
    <div className="space-y-4">
      {/* 오늘 출근 카드 */}
      <div className={`rounded-xl p-4 shadow-sm ${
        checkedOutToday ? "bg-blue-50 border-2 border-blue-200" :
        checkedToday ? "bg-green-50 border-2 border-green-200" :
        isTodayWorkDay ? "bg-orange-50 border-2 border-orange-200" : "bg-gray-50"
      }`}>
        <div className="flex items-center justify-between">
          <div>
            <p className="font-semibold text-gray-700">{emp.position} · 오늘 ({today})</p>
            {checkedOutToday ? (
              <p className="text-blue-600 font-bold">🏁 근무 완료 ({todayRecord?.checkInTime} → {todayRecord?.checkOutTime})</p>
            ) : checkedToday ? (
              <p className="text-green-600 font-bold">✅ 출근 완료 — 퇴근 전 ({todayRecord?.checkInTime})</p>
            ) : isTodayWorkDay ? (
              <p className="text-orange-600 font-bold">오늘은 근무일입니다!</p>
            ) : (
              <p className="text-gray-400">오늘은 근무일이 아닙니다</p>
            )}
          </div>
          <div>
            {isTodayWorkDay && !checkedToday && emp.status === "active" && (
              <button onClick={onCheckIn} className="bg-green-600 text-white px-5 py-3 rounded-xl font-bold hover:bg-green-700 shadow-md">출근 체크</button>
            )}
            {checkedToday && !checkedOutToday && (
              <button onClick={onCheckOut} className="bg-blue-600 text-white px-5 py-3 rounded-xl font-bold hover:bg-blue-700 shadow-md">퇴근 체크</button>
            )}
          </div>
        </div>
      </div>

      {/* 탭 */}
      <div className="bg-white rounded-xl shadow-sm overflow-hidden">
        <div className="flex border-b">
          {(["schedule", "vc", "vp"] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)}
              className={`flex-1 py-3 text-sm font-medium transition-colors ${tab === t ? "text-green-600 border-b-2 border-green-600 bg-green-50" : "text-gray-500 hover:text-gray-700"}`}>
              {t === "schedule" ? "📅 일정" : t === "vc" ? "📋 인증서" : "🔏 VP"}
            </button>
          ))}
        </div>

        {tab === "schedule" && (
          <div className="p-4">
            <div className="flex items-center justify-between mb-3">
              <p className="font-semibold text-gray-700">이번 달 근무 일정</p>
              <p className="text-xs text-gray-400">{emp.weekdays.map((d) => WEEKDAY_LABELS[d]).join("/")}</p>
            </div>
            {thisMonth.length === 0 ? (
              <p className="text-gray-400 text-sm text-center py-4">이번 달 근무 일정이 없습니다</p>
            ) : (
              <div className="space-y-1">
                {thisMonth.map((date) => {
                  const att = emp.attendance.find((a) => a.date === date);
                  const isToday2 = date === today;
                  return (
                    <div key={date} className={`flex justify-between items-center rounded-lg px-3 py-2 ${att ? "bg-green-50" : isToday2 ? "bg-orange-50 border border-orange-200" : date < today ? "bg-gray-50" : "bg-white border border-gray-100"}`}>
                      <span className={`text-sm ${isToday2 ? "font-bold text-orange-600" : "text-gray-700"}`}>{date}{isToday2 ? " (오늘)" : ""}</span>
                      <span className={`text-sm ${att?.checkOutTime ? "text-blue-600" : att ? "text-green-600" : isToday2 ? "text-orange-500" : date < today ? "text-red-400" : "text-gray-400"}`}>
                        {att?.checkOutTime ? `✓ ${att.checkInTime} → ${att.checkOutTime}` : att ? `✓ ${att.checkInTime}` : isToday2 ? "출근 대기" : date < today ? "결근" : "예정"}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {tab === "vc" && (
          <div className="p-4">
            {emp.vc ? (
              <div className="space-y-3">
                <p className="font-semibold text-gray-800">📋 경력 인증서 발급됨</p>
                <div className="bg-gray-50 rounded-xl p-4 space-y-2 text-sm">
                  <Row label="사업장" value={emp.vc.credentialSubject.employerName} />
                  <Row label="직무" value={emp.vc.credentialSubject.position} />
                  <Row label="기간" value={`${emp.vc.credentialSubject.startDate} ~ ${emp.vc.credentialSubject.endDate || "미정"}`} />
                  <Row label="시급" value={`${emp.vc.credentialSubject.hourlyWage.toLocaleString()}원`} />
                  <Row label="총 근무시간" value={`${emp.vc.credentialSubject.totalHours}시간`} />
                </div>
                <div className="bg-green-50 rounded-lg p-3 space-y-2">
                  <p className="text-sm text-green-700">✓ 이 경력은 내 지갑에 자동 저장됩니다</p>
                  <Link href="/wallet" className="block w-full text-center bg-green-600 text-white rounded-lg py-2 text-sm font-medium hover:bg-green-700">
                    👛 내 지갑에서 통합 관리
                  </Link>
                </div>
              </div>
            ) : (
              <div className="text-center py-8 text-gray-400">
                <p className="text-4xl mb-3">⏳</p>
                <p>아직 VC가 발급되지 않았습니다</p>
                <p className="text-xs mt-2">{!didRegistered ? "먼저 DID를 등록하세요" : "퇴사 처리 시 사장이 VC를 발급합니다"}</p>
              </div>
            )}
          </div>
        )}

        {tab === "vp" && (
          <div className="p-4 space-y-3">
            {!emp.vc ? (
              <p className="text-gray-400 text-center py-4">VC가 있어야 VP를 만들 수 있습니다</p>
            ) : (
              <>
                <button onClick={makeVP} disabled={!didRegistered} className="w-full bg-green-600 text-white rounded-xl py-3 font-semibold hover:bg-green-700 disabled:opacity-50">🔏 VP 생성</button>
                {vpError && <p className="text-sm text-red-500">{vpError}</p>}
                {vpJson && (
                  <textarea readOnly className="w-full border rounded-lg p-3 text-xs font-mono h-40 resize-none bg-gray-50" value={vpJson} />
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── 서브 컴포넌트 ────────────────────────────────────────────────────────────
function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <header className="bg-green-600 text-white px-6 py-4 flex items-center gap-4">
        <Link href="/" className="text-white hover:text-white/80">← 뒤로</Link>
        <div>
          <h1 className="text-xl font-bold">직원 포털</h1>
          <p className="text-sm opacity-80">계정 로그인 · 출근 체크 · 경력 관리</p>
        </div>
      </header>
      <div className="flex-1 max-w-md mx-auto w-full flex flex-col">{children}</div>
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
