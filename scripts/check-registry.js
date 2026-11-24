/**
 * check-registry.js — read-only sanity check of the SPACE ID Agent ID
 * registry on BSC mainnet (plain RPC, no wallet, no signing).
 * Usage: node scripts/check-registry.js [address-to-check]
 */
"use strict";
const { ethers } = require("ethers");

const REGISTRY = "0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F";
const RPCS = [
  "https://bsc-rpc.publicnode.com",
  "https://bsc-dataseed.binance.org",
  "https://bsc-dataseed1.defibit.io",
  "https://bsc-dataseed2.bnbchain.org",
];
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

async function main() {
  const who = process.argv[2] || "0x0518AE367CA3612872Aa2f0897BF3B5FaFCE893A";
  let provider = null;
  for (const url of RPCS) {
    const req = new ethers.FetchRequest(url);
    req.setHeader("User-Agent", UA);
    req.timeout = 20000;
    const p = new ethers.JsonRpcProvider(req, 56, { staticNetwork: true });
    try {
      await p.getBlockNumber();
      provider = p;
      break;
    } catch { /* try next */ }
  }
  if (!provider) throw new Error("all RPC endpoints failed");
  const code = await provider.getCode(REGISTRY);
  console.log(`registry ${REGISTRY}: code ${code.length / 2 - 1} bytes (present: ${code !== "0x"})`);
  const c = new ethers.Contract(REGISTRY, ["function balanceOf(address) view returns (uint256)"], provider);
  const bal = await c.balanceOf(who);
  console.log(`balanceOf(${who}) = ${bal} -> hasAgentId = ${bal > 0n}`);
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
