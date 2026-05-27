import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

export default buildModule("WorkPassModule", (m) => {
  const didRegistry = m.contract("DIDRegistry");
  const statusRegistry = m.contract("StatusRegistry");

  return { didRegistry, statusRegistry };
});
