"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { generateKeyPair, KeyPair } from "@/lib/crypto";
import { createVP, VerifiableCredential, VerifiablePresentation } from "@/lib/vc";

// ── 타입 ────────────────────────────────────────────────────────────────────
interface AttendanceRecord {
  date: string;
  checkInTime: string;
  checkOutTime?: string;
}

interface EmployeeData {
  id: string;
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
  vc?: VerifiableCredential;
  workerDid?: string;
  createdAt: string;
}

type Step = "search" | "select" | "pin" | "dashboard";

const WEEKDAY_LABELS: Record<string, string> = {
  mon: "월", tue: "화", wed: "수", thu: "목", fri: "금", sat: "토", sun: "일",
};

// ── 메인 컴포넌트 ────────────────────────────────────────────────────────────
export default function WorkerPage() {
  const [step, setStep] = useState<Step>("search");
  const [searchName, setSearchName] = useState("");
  const [searchResults, setSearchResults] = useState<EmployeeData[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState("");

  const [selectedResult, setSelectedResult] = useState<EmployeeData | null>(null);
  const [pin, setPin] = useState("");
  const [pinError, setPinError] = useState("");
  const [pinLoading, setPinLoading] = useState(false);

  const [employee, setEmployee] = useState<EmployeeData | null>(null);
  const [myKeyPair, setMyKeyPair] = useState<KeyPair | null>(null);
  const [didRegistered, setDidRegistered] = useState(false);

  // 대시보드 탭
  const [tab, setTab] = useState<"schedule" | "vc" | "vp">("schedule");

  // 출근 체크
  const [checkInLoading, setCheckInLoading] = useState(false);
  const [checkInMsg, setCheckInMsg] = useState("");

  // 퇴근 체크
  const [checkOutLoading, setCheckOutLoading] = useState(false);
  const [checkOutMsg, setCheckOutMsg] = useState("");

  // VP 생성
  const [vpJson, setVpJson] = useState("");
  const [vpLoading, setVpLoading] = useState(false);
  const [vpError, setVpError] = useState("");

  // 로컬 날짜 (타임존 문제 방지)
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

  // ── 이름 검색 ────────────────────────────────────────────────────────────
  async function handleSearch() {
    if (!searchName.trim()) return;
    setSearchLoading(true);
    setSearchError("");
    setSearchResults([]);
    try {
      const res = await fetch(`/api/employees/search?name=${encodeURIComponent(searchName.trim())}`);
      const data = await res.json();
      if (res.ok && Array.isArray(data)) {
        setSearchResults(data);
        if (data.length === 0) setSearchError("검색 결과가 없습니다. 이름을 다시 확인하세요.");
        else setStep("select");
      } else {
        setSearchError(data.error || "검색 실패");
      }
    } catch {
      setSearchError("서버 오류");
    } finally {
      setSearchLoading(false);
    }
  }

  // ── PIN 인증 ─────────────────────────────────────────────────────────────
  async function handlePinLogin() {
    if (!selectedResult || pin.length !== 4) return;
    setPinLoading(true);
    setPinError("");
    try {
      const res = await fetch(`/api/employees/${selectedResult.id}/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin }),
      });
      const data = await res.json();
      if (res.ok) {
        setEmployee(data);
        // 로컬 키쌍 불러오기 또는 생성
        loadOrCreateKeyPair(data.id, data);
        setStep("dashboard");
      } else {
        setPinError(data.error || "PIN 오류");
      }
    } catch {
      setPinError("서버 오류");
    } finally {
      setPinLoading(false);
    }
  }

  // ── 로컬 키쌍 관리 ───────────────────────────────────────────────────────
  function loadOrCreateKeyPair(employeeId: string, emp: EmployeeData) {
    const storageKey = `workpass_worker_${employeeId}`;
    const stored = localStorage.getItem(storageKey);
    let kp: KeyPair;
    if (stored) {
      kp = JSON.parse(stored);
    } else {
      kp = generateKeyPair();
      localStorage.setItem(storageKey, JSON.stringify(kp));
    }
    setMyKeyPair(kp);
    // 서버의 workerDid와 내 DID가 일치하는지 확인
    setDidRegistered(emp.workerDid === kp.did);
  }

  // ── DID 등록 (서버에 내 DID 전달) ───────────────────────────────────────
  async function handleRegisterDID() {
    if (!employee || !myKeyPair) return;
    try {
      const res = await fetch(`/api/employees/${employee.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workerDid: myKeyPair.did,
          requirePin: true,
          pin,
        }),
      });
      if (res.ok) {
        setDidRegistered(true);
        setEmployee((prev) => prev ? { ...prev, workerDid: myKeyPair.did } : prev);
        alert("DID 등록 완료! 사장이 이제 VC를 발행할 수 있습니다.");
      } else {
        const err = await res.json();
        alert("등록 실패: " + err.error);
      }
    } catch {
      alert("서버 오류");
    }
  }

  // ── 최신 직원 정보 갱신 ──────────────────────────────────────────────────
  async function refreshEmployee() {
    if (!employee) return;
    try {
      const loginRes = await fetch(`/api/employees/${employee.id}/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin }),
      });
      if (loginRes.ok) {
        const data = await loginRes.json();
        setEmployee(data);
      }
    } catch {
      // ignore
    }
  }

  // ── 출근 체크 ────────────────────────────────────────────────────────────
  async function handleCheckIn() {
    if (!employee) return;
    setCheckInLoading(true);
    setCheckInMsg("");
    try {
      const res = await fetch(`/api/employees/${employee.id}/attendance`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin }),
      });
      const data = await res.json();
      if (res.ok) {
        setCheckInMsg(`✅ 출근 체크 완료! (${data.checkInTime})`);
        await refreshEmployee();
      } else {
        setCheckInMsg(`❌ ${data.error}`);
      }
    } catch {
      setCheckInMsg("❌ 서버 오류");
    } finally {
      setCheckInLoading(false);
    }
  }

  // ── 퇴근 체크 ────────────────────────────────────────────────────────────
  async function handleCheckOut() {
    if (!employee) return;
    setCheckOutLoading(true);
    setCheckOutMsg("");
    try {
      const res = await fetch(`/api/employees/${employee.id}/checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin }),
      });
      const data = await res.json();
      if (res.ok) {
        setCheckOutMsg(`✅ 퇴근 체크 완료! (${data.checkOutTime})`);
        await refreshEmployee();
      } else {
        setCheckOutMsg(`❌ ${data.error}`);
      }
    } catch {
      setCheckOutMsg("❌ 서버 오류");
    } finally {
      setCheckOutLoading(false);
    }
  }

  // ── VP 생성 ──────────────────────────────────────────────────────────────
  async function handleCreateVP() {
    if (!employee?.vc || !myKeyPair) return;
    setVpLoading(true);
    setVpError("");
    setVpJson("");
    try {
      const vc = employee.vc as VerifiableCredential;
      const vp: VerifiablePresentation = createVP(
        [vc],
        [0],
        ["employerName", "position", "employmentType", "startDate", "endDate", "hourlyWage"],
        myKeyPair.did,
        myKeyPair.privateKey
      );
      setVpJson(JSON.stringify(vp, null, 2));
    } catch (e) {
      setVpError(String(e));
    } finally {
      setVpLoading(false);
    }
  }

  function downloadVP() {
    if (!vpJson) return;
    const blob = new Blob([vpJson], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `vp_${employee?.name || "worker"}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ── 이번 달 일정 계산 ────────────────────────────────────────────────────
  function getThisMonthSchedule() {
    if (!employee) return [];
    const now = new Date();
    const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    return employee.specificDates.filter((d) => d.startsWith(yearMonth));
  }

  // ── 렌더링 ────────────────────────────────────────────────────────────────

  // ─── Step 1: 이름 검색 ────────────────────────────────────────────────────
  if (step === "search") {
    return (
      <PageShell>
        <div className="flex flex-col items-center justify-center flex-1 p-6">
          <div className="w-full max-w-sm space-y-6">
            <div className="text-center">
              <div className="text-6xl mb-4">👤</div>
              <h2 className="text-2xl font-bold text-gray-800">직원 로그인</h2>
              <p className="text-gray-500 mt-2">이름을 검색하여 내 근무 정보를 확인하세요</p>
            </div>

            <div className="space-y-3">
              <input
                className="w-full border-2 rounded-xl px-4 py-3 text-lg focus:border-green-500 outline-none"
                placeholder="이름 입력 (예: 홍길동)"
                value={searchName}
                onChange={(e) => setSearchName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                autoFocus
              />
              {searchError && <p className="text-sm text-red-500 text-center">{searchError}</p>}
              <button
                onClick={handleSearch}
                disabled={!searchName.trim() || searchLoading}
                className="w-full bg-green-600 text-white rounded-xl py-3 text-lg font-semibold hover:bg-green-700 disabled:opacity-50"
              >
                {searchLoading ? "검색 중..." : "검색"}
              </button>
            </div>
          </div>
        </div>
      </PageShell>
    );
  }

  // ─── Step 2: 검색 결과 선택 ───────────────────────────────────────────────
  if (step === "select") {
    return (
      <PageShell>
        <div className="p-6 space-y-4">
          <div className="flex items-center gap-3">
            <button onClick={() => setStep("search")} className="text-green-600 hover:text-green-800">← 뒤로</button>
            <h2 className="font-bold text-gray-700">검색 결과: &quot;{searchName}&quot;</h2>
          </div>

          <div className="space-y-3">
            {searchResults.map((emp) => (
              <div
                key={emp.id}
                onClick={() => { setSelectedResult(emp); setPin(""); setPinError(""); setStep("pin"); }}
                className="bg-white rounded-xl p-4 shadow-sm cursor-pointer hover:shadow-md hover:border-green-300 border-2 border-transparent transition-all"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-bold text-gray-800">{emp.name}</p>
                    <p className="text-sm text-gray-500">{emp.position} · {emp.employmentType}</p>
                    <p className="text-xs text-gray-400">{emp.startDate} ~ {emp.endDate || "미정"}</p>
                  </div>
                  <span className="text-green-500 text-2xl">→</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </PageShell>
    );
  }

  // ─── Step 3: PIN 입력 ─────────────────────────────────────────────────────
  if (step === "pin") {
    return (
      <PageShell>
        <div className="flex flex-col items-center justify-center flex-1 p-6">
          <div className="w-full max-w-sm space-y-6">
            <div className="text-center">
              <div className="text-5xl mb-3">🔐</div>
              <h2 className="text-xl font-bold text-gray-800">{selectedResult?.name}님, PIN 입력</h2>
              <p className="text-gray-500 text-sm mt-1">사장에게 받은 4자리 PIN을 입력하세요</p>
            </div>

            <div className="space-y-3">
              <input
                type="password"
                maxLength={4}
                className="w-full border-2 rounded-xl px-4 py-3 text-2xl text-center tracking-widest focus:border-green-500 outline-none"
                placeholder="••••"
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
                onKeyDown={(e) => e.key === "Enter" && pin.length === 4 && handlePinLogin()}
                autoFocus
              />
              {pinError && <p className="text-sm text-red-500 text-center">{pinError}</p>}
              <button
                onClick={handlePinLogin}
                disabled={pin.length !== 4 || pinLoading}
                className="w-full bg-green-600 text-white rounded-xl py-3 text-lg font-semibold hover:bg-green-700 disabled:opacity-50"
              >
                {pinLoading ? "확인 중..." : "로그인"}
              </button>
              <button onClick={() => setStep("select")} className="w-full text-gray-400 text-sm hover:text-gray-600">
                ← 이름 다시 선택
              </button>
            </div>
          </div>
        </div>
      </PageShell>
    );
  }

  // ─── Step 4: 대시보드 ─────────────────────────────────────────────────────
  if (!employee || !myKeyPair) return null;

  const thisMonthSchedule = getThisMonthSchedule();
  const isTodayWorkDay = employee.specificDates.includes(today);
  const todayRecord = employee.attendance.find((a) => a.date === today);
  const checkedToday = !!todayRecord;
  const checkedOutToday = !!todayRecord?.checkOutTime;
  const totalAttended = employee.attendance.length;
  const totalPlanned = employee.specificDates.length;

  return (
    <PageShell>
      <div className="p-4 space-y-4">
        {/* 프로필 카드 */}
        <div className="bg-white rounded-xl p-4 shadow-sm">
          <div className="flex items-start justify-between">
            <div>
              <h2 className="text-xl font-bold text-gray-800">{employee.name}</h2>
              <p className="text-sm text-gray-500">{employee.position} · {employee.employmentType}</p>
              <p className="text-xs text-gray-400">{employee.startDate} ~ {employee.endDate || "미정"}</p>
            </div>
            <div className="text-right">
              <p className="text-sm font-semibold text-green-600">{employee.hourlyWage.toLocaleString()}원/시 · {employee.weeklyHours}시간/주</p>
              <p className="text-xs text-gray-400">출근 {totalAttended}/{totalPlanned}일</p>
              <button onClick={refreshEmployee} className="text-xs text-green-500 hover:underline mt-1">새로고침</button>
            </div>
          </div>

          {/* DID 등록 섹션 */}
          {!didRegistered ? (
            <div className="mt-3 pt-3 border-t bg-yellow-50 rounded-lg p-3">
              <p className="text-sm font-semibold text-yellow-800 mb-1">⚠️ DID 등록 필요</p>
              <p className="text-xs text-yellow-700 mb-2">
                사장이 VC를 발행하려면 내 DID를 먼저 등록해야 합니다.
              </p>
              <p className="text-xs text-gray-500 break-all mb-2">내 DID: {myKeyPair.did}</p>
              <button
                onClick={handleRegisterDID}
                className="w-full bg-yellow-500 text-white rounded-lg py-2 text-sm hover:bg-yellow-600"
              >
                내 DID 등록하기
              </button>
            </div>
          ) : (
            <div className="mt-3 pt-3 border-t">
              <p className="text-xs text-gray-400">내 DID (등록 완료)</p>
              <p className="text-xs text-green-600 break-all">{myKeyPair.did}</p>
            </div>
          )}
        </div>

        {/* 오늘 출근 카드 */}
        <div className={`rounded-xl p-4 shadow-sm ${
          checkedOutToday ? "bg-blue-50 border-2 border-blue-200" :
          checkedToday ? "bg-green-50 border-2 border-green-200" :
          isTodayWorkDay ? "bg-orange-50 border-2 border-orange-200" :
          "bg-gray-50"
        }`}>
          <div className="flex items-center justify-between">
            <div>
              <p className="font-semibold text-gray-700">오늘 ({today})</p>
              {checkedOutToday ? (
                <>
                  <p className="text-blue-600 font-bold">🏁 근무 완료</p>
                  <p className="text-xs text-gray-500">
                    출근: {todayRecord?.checkInTime} · 퇴근: {todayRecord?.checkOutTime}
                  </p>
                </>
              ) : checkedToday ? (
                <>
                  <p className="text-green-600 font-bold">✅ 출근 완료 — 퇴근 전</p>
                  <p className="text-xs text-gray-500">출근: {todayRecord?.checkInTime}</p>
                </>
              ) : isTodayWorkDay ? (
                <p className="text-orange-600 font-bold">오늘은 근무일입니다!</p>
              ) : (
                <p className="text-gray-400">오늘은 근무일이 아닙니다</p>
              )}
            </div>
            <div className="flex flex-col gap-2 items-end">
              {isTodayWorkDay && !checkedToday && (
                <button
                  onClick={handleCheckIn}
                  disabled={checkInLoading}
                  className="bg-green-600 text-white px-5 py-3 rounded-xl font-bold text-lg hover:bg-green-700 disabled:opacity-50 shadow-md"
                >
                  {checkInLoading ? "처리 중..." : "출근 체크"}
                </button>
              )}
              {checkedToday && !checkedOutToday && (
                <button
                  onClick={handleCheckOut}
                  disabled={checkOutLoading}
                  className="bg-blue-600 text-white px-5 py-3 rounded-xl font-bold text-lg hover:bg-blue-700 disabled:opacity-50 shadow-md"
                >
                  {checkOutLoading ? "처리 중..." : "퇴근 체크"}
                </button>
              )}
            </div>
          </div>
          {checkInMsg && <p className="text-sm mt-2">{checkInMsg}</p>}
          {checkOutMsg && <p className="text-sm mt-2">{checkOutMsg}</p>}
        </div>

        {/* 탭 메뉴 */}
        <div className="bg-white rounded-xl shadow-sm overflow-hidden">
          <div className="flex border-b">
            {(["schedule", "vc", "vp"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`flex-1 py-3 text-sm font-medium transition-colors ${
                  tab === t
                    ? "text-green-600 border-b-2 border-green-600 bg-green-50"
                    : "text-gray-500 hover:text-gray-700"
                }`}
              >
                {t === "schedule" ? "📅 일정" : t === "vc" ? "📋 인증서" : "🔏 VP 만들기"}
              </button>
            ))}
          </div>

          {/* ─ 탭: 일정 ─ */}
          {tab === "schedule" && (
            <div className="p-4">
              <div className="flex items-center justify-between mb-3">
                <p className="font-semibold text-gray-700">이번 달 근무 일정</p>
                <p className="text-xs text-gray-400">
                  근무 요일: {employee.weekdays.map((d) => WEEKDAY_LABELS[d]).join("/")}
                </p>
              </div>

              {thisMonthSchedule.length === 0 ? (
                <p className="text-gray-400 text-sm text-center py-4">이번 달 근무 일정이 없습니다</p>
              ) : (
                <div className="space-y-1">
                  {thisMonthSchedule.map((date) => {
                    const attended = employee.attendance.find((a) => a.date === date);
                    const isToday2 = date === today;
                    return (
                      <div
                        key={date}
                        className={`flex justify-between items-center rounded-lg px-3 py-2 ${
                          attended ? "bg-green-50" :
                          isToday2 ? "bg-orange-50 border border-orange-200" :
                          date < today ? "bg-gray-50" : "bg-white border border-gray-100"
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <span className={`text-sm ${isToday2 ? "font-bold text-orange-600" : "text-gray-700"}`}>
                            {date}
                          </span>
                          {isToday2 && <span className="text-xs bg-orange-100 text-orange-600 px-1.5 py-0.5 rounded">오늘</span>}
                        </div>
                        <span className={`text-sm ${
                          attended?.checkOutTime ? "text-blue-600 font-medium" :
                          attended ? "text-green-600 font-medium" :
                          isToday2 ? "text-orange-500" :
                          date < today ? "text-red-400" : "text-gray-400"
                        }`}>
                          {attended?.checkOutTime
                            ? `✓ ${attended.checkInTime} → ${attended.checkOutTime}`
                            : attended
                            ? `✓ ${attended.checkInTime} (퇴근 전)`
                            : isToday2 ? "출근 대기"
                            : date < today ? "결근" : "예정"}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* 전체 출근 기록 (이번 달 외) */}
              {employee.attendance.filter((a) => !thisMonthSchedule.includes(a.date)).length > 0 && (
                <div className="mt-4 pt-4 border-t">
                  <p className="text-xs text-gray-500 mb-2">과거 출근 기록</p>
                  <div className="space-y-1">
                    {employee.attendance
                      .filter((a) => !thisMonthSchedule.includes(a.date))
                      .reverse()
                      .map((a) => (
                        <div key={a.date} className="flex justify-between text-xs text-gray-500 bg-gray-50 rounded px-3 py-1.5">
                          <span>{a.date}</span>
                          <span className={a.checkOutTime ? "text-blue-500" : "text-green-500"}>
                            {a.checkOutTime
                              ? `${a.checkInTime} → ${a.checkOutTime}`
                              : a.checkInTime}
                          </span>
                        </div>
                      ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ─ 탭: 인증서 (VC) ─ */}
          {tab === "vc" && (
            <div className="p-4">
              {employee.vc ? (
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <span className="text-2xl">📋</span>
                    <div>
                      <p className="font-semibold text-gray-800">경력 인증서 발급됨</p>
                      <p className="text-xs text-green-600">사장이 서명한 VC</p>
                    </div>
                  </div>

                  {(() => {
                    const vc = employee.vc as VerifiableCredential;
                    return (
                      <div className="bg-gray-50 rounded-xl p-4 space-y-2 text-sm">
                        <Row label="사업장" value={vc.credentialSubject.employerName} />
                        <Row label="직무" value={vc.credentialSubject.position} />
                        <Row label="고용유형" value={vc.credentialSubject.employmentType} />
                        <Row label="기간" value={`${vc.credentialSubject.startDate} ~ ${vc.credentialSubject.endDate || "미정"}`} />
                        <Row label="시급" value={`${vc.credentialSubject.hourlyWage.toLocaleString()}원`} />
                        <Row label="총 근무시간" value={`${vc.credentialSubject.totalHours}시간`} />
                        <div className="pt-2 border-t">
                          <p className="text-xs text-gray-500">발행자 DID</p>
                          <p className="text-xs text-gray-400 break-all">{vc.issuer}</p>
                        </div>
                      </div>
                    );
                  })()}

                  <button
                    onClick={() => {
                      const blob = new Blob([JSON.stringify(employee.vc, null, 2)], { type: "application/json" });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement("a");
                      a.href = url; a.download = "employment_vc.json"; a.click();
                      URL.revokeObjectURL(url);
                    }}
                    className="w-full border border-green-500 text-green-600 rounded-lg py-2 text-sm hover:bg-green-50"
                  >
                    📥 VC JSON 다운로드
                  </button>
                </div>
              ) : (
                <div className="text-center py-8">
                  <div className="text-4xl mb-3">⏳</div>
                  <p className="text-gray-500 font-medium">아직 VC가 발급되지 않았습니다</p>
                  <p className="text-xs text-gray-400 mt-2">
                    {!didRegistered
                      ? "먼저 DID를 등록하면 사장이 VC를 발행할 수 있습니다"
                      : "DID 등록 완료! 사장에게 VC 발행을 요청하세요"}
                  </p>
                  <button
                    onClick={refreshEmployee}
                    className="mt-4 text-sm text-green-500 hover:underline"
                  >
                    새로고침
                  </button>
                </div>
              )}
            </div>
          )}

          {/* ─ 탭: VP 만들기 ─ */}
          {tab === "vp" && (
            <div className="p-4 space-y-4">
              {!employee.vc ? (
                <div className="text-center py-6">
                  <p className="text-gray-400">VC가 있어야 VP를 만들 수 있습니다</p>
                  <button onClick={() => setTab("vc")} className="text-green-500 text-sm hover:underline mt-2">
                    인증서 탭 확인
                  </button>
                </div>
              ) : (
                <>
                  <div className="bg-blue-50 rounded-xl p-3 text-sm text-blue-700">
                    <p className="font-semibold mb-1">VP(Verifiable Presentation)란?</p>
                    <p className="text-xs">내 VC를 홀더(나)의 서명으로 포장한 제출용 인증 패키지입니다. 은행이나 새 고용주에게 제출하세요.</p>
                  </div>

                  <button
                    onClick={handleCreateVP}
                    disabled={vpLoading || !didRegistered}
                    title={!didRegistered ? "DID 등록 후 사용 가능" : ""}
                    className="w-full bg-green-600 text-white rounded-xl py-3 font-semibold hover:bg-green-700 disabled:opacity-50"
                  >
                    {vpLoading ? "생성 중..." : "🔏 VP 생성"}
                  </button>

                  {vpError && <p className="text-sm text-red-500">{vpError}</p>}

                  {vpJson && (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-semibold text-gray-700">VP 생성 완료!</p>
                        <button
                          onClick={downloadVP}
                          className="flex items-center gap-1 bg-green-600 text-white px-3 py-1.5 rounded-lg text-sm hover:bg-green-700"
                        >
                          📥 다운로드
                        </button>
                      </div>
                      <textarea
                        readOnly
                        className="w-full border rounded-lg p-3 text-xs font-mono h-40 resize-none bg-gray-50"
                        value={vpJson}
                      />
                      <div className="bg-gray-50 rounded-lg p-3 text-xs text-gray-600">
                        <p className="font-semibold mb-1">제출 방법</p>
                        <ol className="list-decimal list-inside space-y-1">
                          <li>위 JSON을 다운로드하거나 복사</li>
                          <li>은행 페이지(/bank)에서 파일 업로드</li>
                          <li>발행자 공개키 입력 후 검증 실행</li>
                        </ol>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>

        {/* 로그아웃 */}
        <button
          onClick={() => { setStep("search"); setEmployee(null); setMyKeyPair(null); setPin(""); setSearchName(""); setVpJson(""); }}
          className="w-full text-gray-400 text-sm hover:text-red-400 py-2"
        >
          로그아웃
        </button>
      </div>
    </PageShell>
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
          <p className="text-sm opacity-80">출근 체크 · 경력 인증서 관리</p>
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
