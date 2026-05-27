/**
 * W3C Verifiable Credential / Verifiable Presentation 처리
 * VC Data Model 2.0 기반
 */
import { signData, verifySignature } from "./crypto";

export interface EmploymentCredentialSubject {
  id: string;          // 근로자 DID
  employerName: string; // 사업장 이름
  position: string;    // 직무
  employmentType: string; // 고용 유형
  startDate: string;   // 근무 시작일
  endDate: string;     // 근무 종료일
  hourlyWage: number;  // 시급
  totalHours: number;  // 총 근무시간
}

export interface VerifiableCredential {
  "@context": string[];
  type: string[];
  id: string;
  issuer: string;          // 발행자 DID
  validFrom: string;
  validUntil: string;
  credentialStatus: {
    type: string;
    statusListId: number;
    statusListIndex: number;
    statusRegistryAddress: string;
  };
  credentialSubject: EmploymentCredentialSubject;
  proof?: {
    type: string;
    created: string;
    verificationMethod: string;
    proofValue: string;     // hex 서명
    proofPurpose: string;
  };
}

export interface VerifiablePresentation {
  "@context": string[];
  type: string[];
  id: string;
  holder: string;          // 소유자 DID
  verifiableCredential: VerifiableCredential[];
  disclosedFields: string[]; // 선택적 공개 항목
  proof?: {
    type: string;
    created: string;
    verificationMethod: string;
    proofValue: string;
    proofPurpose: string;
  };
}

// VC 생성 + 발행자 서명
export function issueVC(
  subject: EmploymentCredentialSubject,
  issuerDid: string,
  issuerPrivKey: string,
  statusListId: number,
  statusListIndex: number,
  statusRegistryAddress: string
): VerifiableCredential {
  const vc: VerifiableCredential = {
    "@context": ["https://www.w3.org/ns/credentials/v2"],
    type: ["VerifiableCredential", "EmploymentCredential"],
    id: `urn:uuid:${crypto.randomUUID()}`,
    issuer: issuerDid,
    validFrom: new Date().toISOString(),
    validUntil: new Date(Date.now() + 2 * 365 * 24 * 3600 * 1000).toISOString(),
    credentialStatus: {
      type: "BitstringStatusListEntry",
      statusListId,
      statusListIndex,
      statusRegistryAddress,
    },
    credentialSubject: subject,
  };

  // 서명 대상: proof 제외한 VC 직렬화
  const payload = JSON.stringify({ ...vc, proof: undefined });
  const proofValue = signData(payload, issuerPrivKey);

  vc.proof = {
    type: "DataIntegrityProof",
    created: new Date().toISOString(),
    verificationMethod: `${issuerDid}#key-1`,
    proofValue,
    proofPurpose: "assertionMethod",
  };

  return vc;
}

// VP 생성: 선택한 VC와 공개할 필드만 포함
export function createVP(
  vcs: VerifiableCredential[],
  selectedIndices: number[],
  disclosedFields: string[],
  holderDid: string,
  holderPrivKey: string
): VerifiablePresentation {
  // 선택된 VC 원본 그대로 포함 (서명 무결성 유지)
  // disclosedFields로 소유자가 동의한 공개 항목을 명시
  const filteredVCs = selectedIndices.map((idx) => vcs[idx]);

  const vp: VerifiablePresentation = {
    "@context": ["https://www.w3.org/ns/credentials/v2"],
    type: ["VerifiablePresentation"],
    id: `urn:uuid:${crypto.randomUUID()}`,
    holder: holderDid,
    verifiableCredential: filteredVCs,
    disclosedFields,
  };

  const payload = JSON.stringify({ ...vp, proof: undefined });
  const proofValue = signData(payload, holderPrivKey);

  vp.proof = {
    type: "DataIntegrityProof",
    created: new Date().toISOString(),
    verificationMethod: `${holderDid}#key-1`,
    proofValue,
    proofPurpose: "authentication",
  };

  return vp;
}

// VC 서명 검증 (오프체인 — 발행자 공개키 사용)
export function verifyVC(vc: VerifiableCredential, issuerPubKey: string): boolean {
  if (!vc.proof) return false;
  const payload = JSON.stringify({ ...vc, proof: undefined });
  return verifySignature(payload, vc.proof.proofValue, issuerPubKey);
}

// VP 서명 검증
export function verifyVP(vp: VerifiablePresentation, holderPubKey: string): boolean {
  if (!vp.proof) return false;
  const payload = JSON.stringify({ ...vp, proof: undefined });
  return verifySignature(payload, vp.proof.proofValue, holderPubKey);
}
