/**
 * Ignition 배포 결과를 public/contract-addresses.json으로 변환
 * 실행: node scripts/export-addresses.mjs [sepolia|localhost]
 */
import { readFileSync, writeFileSync, readdirSync } from "fs";
import { join } from "path";

const network = process.argv[2]; // "sepolia" or "localhost" or undefined

const CHAIN_IDS = {
  sepolia: "chain-11155111",
  localhost: "chain-31337",
};

const deploymentsDir = "ignition/deployments";
const dirs = readdirSync(deploymentsDir).filter(d => d.startsWith("chain-"));

if (dirs.length === 0) {
  console.error("배포된 체인 없음. npm run deploy 먼저 실행하세요.");
  process.exit(1);
}

// 네트워크 인자가 있으면 해당 chain 폴더 사용, 없으면 가장 최근 폴더 사용
let targetDir;
if (network && CHAIN_IDS[network]) {
  targetDir = CHAIN_IDS[network];
  if (!dirs.includes(targetDir)) {
    console.error(`${targetDir} 폴더가 없습니다. 먼저 ${network}에 배포하세요.`);
    process.exit(1);
  }
} else {
  targetDir = dirs[dirs.length - 1];
}

const addressFile = join(deploymentsDir, targetDir, "deployed_addresses.json");
const deployed = JSON.parse(readFileSync(addressFile, "utf-8"));

const result = {
  DIDRegistry: deployed["WorkPassModule#DIDRegistry"],
  StatusRegistry: deployed["WorkPassModule#StatusRegistry"],
  network: targetDir,
  exportedAt: new Date().toISOString(),
};

writeFileSync("public/contract-addresses.json", JSON.stringify(result, null, 2));
console.log("contract-addresses.json 생성 완료:");
console.log(result);
