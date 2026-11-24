/**
 * prepare-deploy.js — LOCAL measurement only. Nothing is broadcast.
 *
 * Run: npx hardhat run scripts/prepare-deploy.js
 *
 * - Deploys RamenForge to the in-process Hardhat network (with a mock
 *   registry) and measures real gasUsed for creation + every key function.
 * - Exports deploy-package/RamenForge.abi.json.
 * - Computes the CREATE2 address prediction for the deterministic proxy
 *   route (salt keccak256("velt.ramenforge.v1"), constructor arg = the real
 *   Agent ID registry) and writes deploy-package/prediction.json.
 *   The prediction is informational only — deployment needs a separate
 *   user go-ahead, and the frontend config keeps the zero address until
 *   a deployment is verified on-chain.
 */
const fs = require("fs");
const path = require("path");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

const REGISTRY = "0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F";
const CREATE2_PROXY = "0x4e59b44847b379578588920cA78FbF26c0B4956C";
const SALT_LABEL = "velt.ramenforge.v1";
const DAY = 86400;

async function gasOf(tx) {
  const rc = await tx.wait();
  return Number(rc.gasUsed);
}

async function main() {
  const [deployer, player] = await ethers.getSigners();

  const Mock = await ethers.getContractFactory("MockAgentID");
  const mock = await Mock.deploy();
  await mock.setHolder(player.address, true);

  const RF = await ethers.getContractFactory("RamenForge");
  const deployTx = await RF.getDeployTransaction(await mock.getAddress());
  const sent = await deployer.sendTransaction(deployTx);
  const rc = await sent.wait();
  const rf = RF.attach(rc.contractAddress);
  const creationGas = Number(rc.gasUsed);

  const artifact = await hre.artifacts.readArtifact("RamenForge");
  const runtimeBytes = (artifact.deployedBytecode.length - 2) / 2;
  const creationBytes = (artifact.bytecode.length - 2) / 2;

  // --- exercise the key functions and measure gas ---
  const gas = { creation: creationGas };
  gas.buyPass = await gasOf(await rf.connect(player).buyPass({ value: ethers.parseEther("0.005") }));
  gas.mintDaily = await gasOf(await rf.connect(player).mintDaily());
  gas.reroll = await gasOf(await rf.connect(player).reroll());

  // Draw across days until the player can cook a full Golden chain.
  const need = async () => {
    for (let i = 0; i < 7; i++) if ((await rf.ingredientCount(player.address, i)) < 1n) return true;
    return false;
  };
  let guard = 0;
  while ((await need()) && guard++ < 600) {
    await time.increase(DAY);
    await rf.connect(player).mintDaily();
  }
  const rcIds = await rf.ramenCookIds(player.address);
  gas.cookRamen = await gasOf(await rf.connect(player).cookRamen([...rcIds[0]]));
  const d = await rf.deluxeCookIds(player.address);
  gas.cookDeluxe = await gasOf(await rf.connect(player).cookDeluxe(d[0], [...d[1]]));
  const g = await rf.goldenCookIds(player.address);
  gas.cookGolden = await gasOf(await rf.connect(player).cookGolden(g[0], g[1]));
  const goldenId = (await rf.dishTokenIds(player.address, 3))[0];
  gas.serve = await gasOf(await rf.connect(player).serve(goldenId));
  // badge claim: build a 3-day streak on a fresh holder
  const [, , third] = await ethers.getSigners();
  await mock.setHolder(third.address, true);
  for (let i = 0; i < 3; i++) {
    if (i > 0) await time.increase(DAY);
    await rf.connect(third).mintDaily();
  }
  gas.claimBadge = await gasOf(await rf.connect(third).claimBadge(1));

  // --- ABI export ---
  const pkgDir = path.join(__dirname, "..", "deploy-package");
  fs.mkdirSync(pkgDir, { recursive: true });
  fs.writeFileSync(path.join(pkgDir, "RamenForge.abi.json"), JSON.stringify(artifact.abi, null, 2) + "\n");

  // --- CREATE2 prediction (real registry as constructor arg) ---
  const initCode = ethers.concat([
    artifact.bytecode,
    ethers.AbiCoder.defaultAbiCoder().encode(["address"], [REGISTRY]),
  ]);
  const salt = ethers.keccak256(ethers.toUtf8Bytes(SALT_LABEL));
  const predicted = ethers.getCreate2Address(CREATE2_PROXY, salt, ethers.keccak256(initCode));

  const out = {
    contract: "RamenForge",
    compiler: "solc 0.8.24, optimizer 200 runs, evm paris, viaIR true",
    runtimeBytes,
    creationBytes,
    gasEstimates: gas,
    create2: {
      proxy: CREATE2_PROXY,
      saltLabel: SALT_LABEL,
      salt,
      constructorArg: REGISTRY,
      predictedAddress: predicted,
      note: "PREDICTION ONLY — nothing deployed. Frontend config stays zero-address until a real deployment is verified on-chain.",
    },
  };
  fs.writeFileSync(path.join(pkgDir, "prediction.json"), JSON.stringify(out, null, 2) + "\n");
  console.log(JSON.stringify(out, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
