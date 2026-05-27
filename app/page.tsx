import Link from "next/link";

export default function Home() {
  return (
    <main className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex flex-col items-center justify-center p-8">
      <div className="text-center mb-12">
        <h1 className="text-5xl font-bold text-indigo-800 mb-4">WorkPass</h1>
        <p className="text-xl text-gray-600 max-w-2xl">
          DID 기반 단기근로 경력 인증 플랫폼
        </p>
        <p className="text-sm text-gray-500 mt-2">
          흩어진 노동의 흔적을 한 사람의 자산으로. 누구도 빼앗을 수 없고, 누구나 믿을 수 있는 경력.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 w-full max-w-4xl">
        <RoleCard
          href="/employer"
          icon="🏢"
          title="사장 · 고용주"
          subtitle="매장 관리자"
          description="직원을 추가하고, 근무 일정을 설정하고, 경력 인증서(VC)를 발행합니다."
          colorClass="border-orange-200 hover:border-orange-400 hover:shadow-orange-100"
          iconBgClass="bg-orange-100"
          badge="직원 관리 + VC 발행"
          badgeColor="bg-orange-100 text-orange-700"
        />
        <RoleCard
          href="/worker"
          icon="👷"
          title="직원 · 근로자"
          subtitle="아르바이트 / 단기 근로자"
          description="근무 일정 확인, 출근 체크, 발급된 경력 인증서로 VP를 만들어 제출합니다."
          colorClass="border-green-200 hover:border-green-400 hover:shadow-green-100"
          iconBgClass="bg-green-100"
          badge="출근 체크 + VP 생성"
          badgeColor="bg-green-100 text-green-700"
        />
        <RoleCard
          href="/bank"
          icon="🏦"
          title="은행 · 검증자"
          subtitle="금융기관 / 신규 고용주"
          description="직원이 제출한 VP를 검증하여 경력서의 진위를 즉시 확인합니다."
          colorClass="border-indigo-200 hover:border-indigo-400 hover:shadow-indigo-100"
          iconBgClass="bg-indigo-100"
          badge="VP 검증 + 진위 확인"
          badgeColor="bg-indigo-100 text-indigo-700"
        />
      </div>

      {/* 흐름도 */}
      <div className="mt-12 w-full max-w-4xl">
        <div className="bg-white/70 backdrop-blur rounded-2xl p-6">
          <p className="text-center text-sm font-semibold text-gray-600 mb-4">이용 흐름</p>
          <div className="flex items-center justify-center gap-2 flex-wrap text-sm text-gray-600">
            <Step n={1} text="사장이 직원 추가 + PIN 설정" color="orange" />
            <Arrow />
            <Step n={2} text="직원이 DID 등록" color="green" />
            <Arrow />
            <Step n={3} text="사장이 VC 발행" color="orange" />
            <Arrow />
            <Step n={4} text="직원이 VP 생성 + 다운로드" color="green" />
            <Arrow />
            <Step n={5} text="은행이 VP 검증" color="indigo" />
          </div>
        </div>
      </div>

      <div className="mt-8 text-center text-xs text-gray-400 space-y-1">
        <p>W3C DID Core 1.0 · W3C Verifiable Credentials 2.0 · Solidity Smart Contract (Sepolia)</p>
        <p className="text-gray-300">
          <Link href="/issuer" className="hover:text-gray-400">구 발행자</Link>
          {" · "}
          <Link href="/wallet" className="hover:text-gray-400">구 지갑</Link>
          {" · "}
          <Link href="/verifier" className="hover:text-gray-400">구 검증자</Link>
        </p>
      </div>
    </main>
  );
}

function RoleCard({
  href, icon, title, subtitle, description, colorClass, iconBgClass, badge, badgeColor,
}: {
  href: string;
  icon: string;
  title: string;
  subtitle: string;
  description: string;
  colorClass: string;
  iconBgClass: string;
  badge: string;
  badgeColor: string;
}) {
  return (
    <Link href={href}>
      <div
        className={`bg-white rounded-2xl border-2 ${colorClass} p-6 cursor-pointer hover:shadow-xl transition-all duration-200 h-full flex flex-col items-center text-center`}
      >
        <div
          className={`text-4xl mb-4 ${iconBgClass} w-16 h-16 rounded-full flex items-center justify-center`}
        >
          {icon}
        </div>
        <h2 className="text-xl font-bold text-gray-800">{title}</h2>
        <p className="text-sm text-gray-500 mb-2">{subtitle}</p>
        <span className={`text-xs px-2 py-1 rounded-full font-medium mb-3 ${badgeColor}`}>
          {badge}
        </span>
        <p className="text-sm text-gray-600">{description}</p>
      </div>
    </Link>
  );
}

function Step({ n, text, color }: { n: number; text: string; color: string }) {
  const colors: Record<string, string> = {
    orange: "bg-orange-500",
    green: "bg-green-500",
    indigo: "bg-indigo-600",
  };
  return (
    <div className="flex items-center gap-1.5">
      <span className={`${colors[color]} text-white w-5 h-5 rounded-full text-xs flex items-center justify-center font-bold flex-shrink-0`}>
        {n}
      </span>
      <span className="text-gray-600 text-xs">{text}</span>
    </div>
  );
}

function Arrow() {
  return <span className="text-gray-300 text-lg">→</span>;
}
