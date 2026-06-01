/**
 * 급여 계산 — 순수 함수 (클라이언트·서버 공용, 외부 의존성 없음)
 * 실제 출근/퇴근 시각 기반 근무시간 + 한국 근로기준법 주휴수당 반영
 */

export interface PayAttendance {
  date: string;            // YYYY-MM-DD
  checkInAt?: number;      // epoch ms
  checkOutAt?: number;     // epoch ms
  workedMinutes?: number;  // 실제 근무 분 (퇴근 시 확정)
  isSubstitute?: boolean;  // 대타 근무 여부
}

export interface PayInput {
  hourlyWage: number;
  weeklyHours: number;     // 주 소정근로시간 (계약 기준)
  specificDates: string[]; // 소정근로일 (YYYY-MM-DD)
  attendance: PayAttendance[];
}

// 한 출근 기록의 실제 근무 분
export function recordWorkedMinutes(a: PayAttendance): number {
  if (typeof a.workedMinutes === "number") return a.workedMinutes;
  if (a.checkInAt && a.checkOutAt && a.checkOutAt > a.checkInAt) {
    return Math.round((a.checkOutAt - a.checkInAt) / 60000);
  }
  return 0;
}

function mondayOf(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  const offset = (dt.getDay() + 6) % 7; // 월=0 ... 일=6
  dt.setDate(dt.getDate() - offset);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

export interface WeekPay {
  weekStart: string;    // 그 주 월요일
  scheduledDays: number;
  attendedDays: number;
  perfect: boolean;     // 개근 (소정근로일 모두 출근)
  eligible: boolean;    // 주휴 대상 (개근 + 주 15시간 이상)
  allowanceWon: number;
}

export interface MonthlyPay {
  year: number;
  month: number;        // 1-12
  ym: string;           // "YYYY-MM"
  workedMinutes: number;
  workedHours: number;  // 소수 1자리
  substituteMinutes: number;
  basePayWon: number;
  weeklyAllowanceWon: number;
  totalWon: number;
  weeklyEligible: boolean; // 주 15시간 이상 계약 여부
  weeks: WeekPay[];
}

export function computeMonthlyPay(emp: PayInput, year: number, month: number): MonthlyPay {
  const ym = `${year}-${String(month).padStart(2, "0")}`;

  // 이번 달 실제 근무
  const monthAtt = emp.attendance.filter((a) => a.date.startsWith(ym));
  let workedMinutes = 0;
  let substituteMinutes = 0;
  for (const a of monthAtt) {
    const m = recordWorkedMinutes(a);
    workedMinutes += m;
    if (a.isSubstitute) substituteMinutes += m;
  }
  const basePayWon = Math.round((workedMinutes / 60) * emp.hourlyWage);

  // 주휴수당: 주 소정근로 15시간 이상 + 그 주 소정근로일 개근 시
  //   1주분 주휴수당 = min(주소정근로시간, 40)/40 × 8 × 시급
  const weeklyEligible = emp.weeklyHours >= 15;
  const allowanceHours = (Math.min(emp.weeklyHours, 40) / 40) * 8;
  const allowancePerWeek = Math.round(allowanceHours * emp.hourlyWage);

  // 이번 달 소정근로일을 주(월~일)별로 묶어 개근 판정
  const scheduledThisMonth = emp.specificDates.filter((d) => d.startsWith(ym));
  const attendedSet = new Set(monthAtt.map((a) => a.date));

  const byWeek = new Map<string, { scheduled: number; attended: number }>();
  for (const d of scheduledThisMonth) {
    const wk = mondayOf(d);
    const entry = byWeek.get(wk) ?? { scheduled: 0, attended: 0 };
    entry.scheduled++;
    if (attendedSet.has(d)) entry.attended++;
    byWeek.set(wk, entry);
  }

  const weeks: WeekPay[] = [];
  let weeklyAllowanceWon = 0;
  for (const [weekStart, e] of [...byWeek.entries()].sort()) {
    const perfect = e.scheduled > 0 && e.attended === e.scheduled;
    const eligible = perfect && weeklyEligible;
    const allowanceWon = eligible ? allowancePerWeek : 0;
    weeklyAllowanceWon += allowanceWon;
    weeks.push({
      weekStart,
      scheduledDays: e.scheduled,
      attendedDays: e.attended,
      perfect,
      eligible,
      allowanceWon,
    });
  }

  return {
    year,
    month,
    ym,
    workedMinutes,
    workedHours: Math.round((workedMinutes / 60) * 10) / 10,
    substituteMinutes,
    basePayWon,
    weeklyAllowanceWon,
    totalWon: basePayWon + weeklyAllowanceWon,
    weeklyEligible,
    weeks,
  };
}
