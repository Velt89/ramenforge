#!/usr/bin/env node
/**
 * RamenForge — agent interface (Binance Agentic Wallet / baw).
 *
 * Lets an agent play RamenForge on BNB Chain through the user's OWN paired
 * Binance Agentic Wallet, without opening the web dApp:
 *
 *   node agent/ramenforge.js status [--address <addr>]
 *   node agent/ramenforge.js leaderboard [--limit n]
 *   node agent/ramenforge.js recipes
 *   node agent/ramenforge.js pass-info [--address <addr>]
 *   node agent/ramenforge.js preview-mint [--from <addr>]
 *   node agent/ramenforge.js preview-reroll [--from <addr>]
 *   node agent/ramenforge.js preview-badge <tier|bronze|silver|gold> [--from <addr>]
 *   node agent/ramenforge.js preview-cook <ramen|deluxe|golden> [--from <addr>]
 *   node agent/ramenforge.js preview-pass [--from <addr>]
 *   node agent/ramenforge.js preview-serve <goldenTokenId> [--from <addr>]
 *   node agent/ramenforge.js execute <requestId>
 *
 * Run from the repo root (uses the root node_modules ethers v6).
 *
 * SAFETY MODEL (see agent/SKILL.md):
 * - Reads are plain RPC calls — no wallet, no keys, no signing.
 * - Writes are ALWAYS two-phase: `preview-*` runs `baw contract-call preview`
 *   (a simulation — it broadcasts nothing and creates no app notification),
 *   and `execute` is a separate, explicit step to run ONLY after the user has
 *   seen the preview summary and said go.
 * - Values: every call is 0 BNB EXCEPT preview-pass, which is exactly
 *   0.005 BNB (the Founder Chef Pass price, paid into the reward pool).
 *   Allowance/authority changes in any preview MUST be empty — this script
 *   prints them and warns if they are not.
 * - Cooking burns ingredient tokens; serving burns a Golden Ramen. The
 *   previews decode exactly which token ids will burn.
 * - The contract is DEPLOYED (address below, verified on-chain 2026-11-25).
 *   If code ever stops existing at the configured address, every write path refuses
 *   with a "not deployed yet" message and never calls baw.
 */
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const { ethers } = require("ethers");

// ---------------------------------------------------------------- constants

const CHAIN_ID = 56;
const RAMENFORGE = "0xbCC65C8693cdEbcF934A38f7Cb0287b2BD801f1D"; // DEPLOYED 2026-11-25, block 135549831, creation tx 0x731c854d9224354223f7511c390c5ca0d5141c4774538a85310777175c532eaa
const REGISTRY = "0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F";
const BSCSCAN = "https://bscscan.com";
const PASS_PRICE_WEI = ethers.parseEther("0.005");

const INGREDIENTS = [
  "Handmade Noodles", "Tonkotsu Broth", "Scallion", "Nori",
  "Chashu Pork", "Ajitama Egg", "Wagyu Slice",
];
const RARITIES = ["Uncommon", "Uncommon", "Uncommon", "Uncommon", "Rare", "Rare", "Epic"];
const BADGE_TIERS = [
  { tier: 1, name: "Bronze", required: 3 },
  { tier: 2, name: "Silver", required: 7 },
  { tier: 3, name: "Gold", required: 14 },
];
const KIND_NAMES = ["Ingredient", "Ramen", "Deluxe Ramen", "Golden Ramen", "Feast Badge", "Golden Chef Trophy", "Founder Chef Pass", "Founder Chef Badge"];

const RPC_ENDPOINTS = [
  "https://bsc-rpc.publicnode.com",
  "https://bsc-dataseed.binance.org",
  "https://bsc-dataseed1.defibit.io",
  "https://bsc-dataseed2.bnbchain.org",
];
const BROWSER_UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

const ABI_PATH = path.join(__dirname, "..", "deploy-package", "RamenForge.abi.json");
const rfAbi = JSON.parse(fs.readFileSync(ABI_PATH, "utf8"));
const iface = new ethers.Interface(rfAbi);

const registryAbi = [
  "function balanceOf(address owner) view returns (uint256)",
  "function handleOf(address account) view returns (string)",
];

// ------------------------------------------------------------------- errors

function fail(msg) {
  console.error(`ERROR: ${msg}`);
  process.exit(1);
}

// ---------------------------------------------------------------------- RPC
// Sequential endpoint rotation: ethers v6 JsonRpcProvider with a browser
// User-Agent (BSC dataseed 403s the default UA) and a hard request timeout
// (a hung RPC otherwise stalls forever).

let _provider = null;

function makeProvider(url) {
  const req = new ethers.FetchRequest(url);
  req.setHeader("User-Agent", BROWSER_UA);
  req.timeout = 20000;
  return new ethers.JsonRpcProvider(req, CHAIN_ID, { staticNetwork: true });
}

async function provider() {
  if (_provider) return _provider;
  let lastErr;
  for (const url of RPC_ENDPOINTS) {
    const p = makeProvider(url);
    try {
      await p.getBlockNumber();
      _provider = p;
      return p;
    } catch (e) {
      lastErr = e;
    }
  }
  fail(`all BSC RPC endpoints failed (last error: ${lastErr && lastErr.message})`);
}

async function read(contractAddr, abi, fn, args = []) {
  const p = await provider();
  const c = new ethers.Contract(contractAddr, abi, p);
  try {
    return await c[fn](...args);
  } catch (e) {
    _provider = null;
    const p2 = await provider();
    const c2 = new ethers.Contract(contractAddr, abi, p2);
    return await c2[fn](...args);
  }
}

const rfRead = (fn, args) => read(RAMENFORGE, rfAbi, fn, args);
const regRead = (fn, args) => read(REGISTRY, registryAbi, fn, args);

let _deployed = null;
async function isDeployed() {
  if (_deployed !== null) return _deployed;
  if (RAMENFORGE === ethers.ZeroAddress) {
    _deployed = false;
    return _deployed;
  }
  const p = await provider();
  _deployed = (await p.getCode(RAMENFORGE)) !== "0x";
  return _deployed;
}

function notDeployedMessage() {
  return (
    `the RamenForge contract is not deployed yet — the configured address ${RAMENFORGE} ` +
    `has no code on-chain. No baw preview was called. Deployment is a separate, user-approved step.`
  );
}

// ---------------------------------------------------------------------- baw

function bawBin() {
  const probe = spawnSync("baw", ["--version"], { encoding: "utf8" });
  if (!probe.error && probe.status !== null) return "baw";
  const abs = path.join(os.homedir(), "workspace/tools/baw-cli/bin/baw");
  if (fs.existsSync(abs)) return abs;
  fail("baw CLI not found on PATH or at ~/workspace/tools/baw-cli/bin/baw — install the Binance Agentic Wallet CLI first.");
}

function runBaw(args) {
  const bin = bawBin();
  const env = { ...process.env };
  env.PATH = `${path.join(os.homedir(), "workspace/tools/baw-cli/bin")}:${env.PATH || ""}`;
  const res = spawnSync(bin, args, { encoding: "utf8", env, timeout: 120000 });
  if (res.error) fail(`baw invocation failed: ${res.error.message}`);
  const out = (res.stdout || "").trim();
  try {
    return JSON.parse(out);
  } catch {
    fail(`baw returned non-JSON output for \`${args.join(" ")}\`:\n${out}\n${res.stderr || ""}`);
  }
}

function bawWalletStatus() {
  const j = runBaw(["wallet", "status", "--json"]);
  if (j && j.success && j.data) return j.data.status || "UNKNOWN";
  return "UNKNOWN";
}

/** Best-effort: pull the EVM (chain 56) address out of `baw wallet address`. */
function bawWalletAddress() {
  const j = runBaw(["wallet", "address", "--json"]);
  if (!j || !j.success) return null;
  const hits = [];
  (function walk(node, keyHint) {
    if (typeof node === "string") {
      if (/^0x[0-9a-fA-F]{40}$/.test(node)) hits.push({ addr: node, hint: keyHint || "" });
    } else if (Array.isArray(node)) {
      node.forEach((v) => walk(v, keyHint));
    } else if (node && typeof node === "object") {
      for (const [k, v] of Object.entries(node)) walk(v, k);
    }
  })(j.data, "");
  if (!hits.length) return null;
  const pref = hits.find((h) => /evm|bsc|bnb|56/i.test(h.hint));
  return (pref || hits[0]).addr;
}

/**
 * Resolve the sender for previews: explicit --from, then the paired baw
 * wallet's own address, then $RAMENFORGE_WALLET. Never invents an address.
 */
function resolveSender(flagFrom) {
  if (flagFrom) {
    if (!ethers.isAddress(flagFrom)) fail(`--from is not a valid address: ${flagFrom}`);
    return ethers.getAddress(flagFrom);
  }
  const st = bawWalletStatus();
  if (st === "CONNECTED") {
    const a = bawWalletAddress();
    if (a) return ethers.getAddress(a);
    fail("baw is CONNECTED but `baw wallet address` returned no EVM address.");
  }
  if (process.env.RAMENFORGE_WALLET && ethers.isAddress(process.env.RAMENFORGE_WALLET)) {
    return ethers.getAddress(process.env.RAMENFORGE_WALLET);
  }
  fail(
    `baw wallet status is ${st} (not CONNECTED) — previews need the user's paired, connected ` +
      `Agentic Wallet. Ask the user to re-pair/connect in the Binance App, or pass --from <address> ` +
      `for a read-only sender override (baw will still refuse to preview while disconnected).`
  );
}

// ------------------------------------------------------------------ helpers

/** Holder status straight from the registry — works before deployment. */
async function holderInfo(addr) {
  const bal = await regRead("balanceOf", [addr]);
  const holder = bal > 0n;
  let handle = null;
  if (holder) {
    try {
      handle = await regRead("handleOf", [addr]);
    } catch {
      handle = null;
    }
  }
  return { holder, handle };
}

function parseTier(input) {
  if (input === undefined) fail("tier is required (1, 2, 3 or bronze/silver/gold).");
  const s = String(input).trim().toLowerCase();
  if (/^[123]$/.test(s)) return BADGE_TIERS[Number(s) - 1];
  const hit = BADGE_TIERS.find((t) => t.name.toLowerCase() === s);
  if (hit) return hit;
  fail(`unknown tier "${input}". Use 1/2/3 or bronze/silver/gold.`);
}

function takeFromFlag(argv) {
  const fi = argv.indexOf("--from");
  if (fi < 0) return { from: null, rest: argv };
  const from = argv[fi + 1];
  return { from, rest: argv.filter((_, i) => i !== fi && i !== fi + 1) };
}

async function requireDeployed() {
  if (!(await isDeployed())) fail(`refusing to preview: ${notDeployedMessage()}`);
}

async function requireHolder(from) {
  const sender = await holderInfo(from);
  if (!sender.holder) {
    fail(`refusing to preview: sender ${from} does not hold an Agent ID — this call would revert on-chain. No baw preview was called.`);
  }
  return sender;
}

// ------------------------------------------------------------------ preview

function runPreview({ from, calldata, decoded, valueWei = 0n }) {
  const args = [
    "contract-call", "preview",
    "--binanceChainId", String(CHAIN_ID),
    "--from", from,
    "--to", RAMENFORGE,
    "--value", valueWei.toString(),
    "--inputData", calldata,
    "--json",
  ];
  const j = runBaw(args);
  console.log("— Decoded call ————————————————————————————————");
  for (const [k, v] of Object.entries(decoded)) console.log(`  ${k}: ${v}`);
  console.log(`  value: ${ethers.formatEther(valueWei)} BNB${valueWei > 0n ? " (Founder Chef Pass price — into the reward pool)" : " (always 0 except pass purchase)"}`);
  console.log("— baw preview verdict ———————————————————————————");
  if (!j.success) {
    console.log(JSON.stringify(j, null, 2));
    fail("baw preview did not succeed — nothing to execute. Show the user this error.");
  }
  const d = j.data || {};
  const sim = d.simulationResult || {};
  const risks = d.risks || {};
  const riskCount = (risks.riskDetails || []).length + (risks.riskBehaviors || []).length;
  const allowance = sim.allowanceChanges || [];
  const authority = sim.authorityChanges || [];
  console.log(`  requestId:          ${d.requestId}`);
  console.log(`  expiresAt:          ${d.expiresAt ? new Date(d.expiresAt).toISOString() : "?"} (${d.expiresAt})`);
  console.log(`  simulationCode:     ${sim.simulationCode}`);
  console.log(`  simulationError:    ${sim.simulationErrorDetail || "none"}`);
  console.log(`  balanceChanges:     ${JSON.stringify(sim.balanceChanges || [])}`);
  console.log(`  allowanceChanges:   ${JSON.stringify(allowance)}${allowance.length ? "  <-- WARNING: expected EMPTY" : ""}`);
  console.log(`  authorityChanges:   ${JSON.stringify(authority)}${authority.length ? "  <-- WARNING: expected EMPTY" : ""}`);
  console.log(`  risks:              ${riskCount === 0 ? "none" : JSON.stringify(risks)}`);
  console.log(`  requireConfirmation:${d.requireConfirmation}`);
  console.log("——————————————————————————————————————————————————");
  console.log(
    "PREVIEW ONLY — nothing was broadcast and no app notification was created.\n" +
      "Show this summary to the user. Execute ONLY on their explicit go-ahead:\n" +
      `  node agent/ramenforge.js execute ${d.requestId}`
  );
  return d;
}

// ----------------------------------------------------------------- commands

async function kitchenLines(addr) {
  const lines = [];
  for (let i = 0; i < INGREDIENTS.length; i++) {
    const c = await rfRead("ingredientCount", [addr, i]);
    if (c > 0n) lines.push(`${INGREDIENTS[i]} ×${c}`);
  }
  return lines;
}

async function cmdStatus(argv) {
  let addr = null;
  const ai = argv.indexOf("--address");
  if (ai >= 0) addr = argv[ai + 1];
  let bawStatus = null;
  try {
    bawStatus = bawWalletStatus();
  } catch {
    bawStatus = "UNAVAILABLE";
  }
  if (!addr) {
    if (bawStatus !== "CONNECTED") {
      console.log(`baw wallet status: ${bawStatus}`);
      fail("no --address given and the baw wallet is not CONNECTED, so no wallet address can be determined. Re-pair/connect in the Binance App, or pass --address <addr> for a read-only status.");
    }
    addr = bawWalletAddress();
    if (!addr) fail("baw is CONNECTED but returned no EVM address.");
  }
  addr = ethers.getAddress(addr);
  const { holder, handle } = await holderInfo(addr);
  console.log(`address:            ${addr}`);
  console.log(`baw wallet status:  ${bawStatus}`);
  console.log(`Agent ID holder:    ${holder}${handle ? ` (handle: ${handle}.ai)` : ""}`);

  if (!(await isDeployed())) {
    console.log(`RamenForge contract: NOT DEPLOYED YET — address ${RAMENFORGE} is a placeholder with no code on-chain (deployment pending).`);
    console.log("Holder status above is live from the Agent ID registry; game reads and previews activate after deployment.");
    return;
  }

  const [current, best, lifetime] = await rfRead("streakOf", [addr]);
  const canDraw = await rfRead("canDrawToday", [addr]);
  const [todayId, todayItem, drawn] = await rfRead("todaysTokenOf", [addr]);
  const canReroll = await rfRead("canReroll", [addr]);
  const distinct = await rfRead("distinctIngredientsOf", [addr]);
  const passes = await rfRead("passCountOf", [addr]);
  const founderNo = await rfRead("founderNumberOf", [addr]);
  const kitchen = await kitchenLines(addr);
  const goldenIds = await rfRead("dishTokenIds", [addr, 3]);
  const badgeBits = [];
  for (const t of BADGE_TIERS) {
    const claimed = await rfRead("badgeClaimed", [addr, t.tier]);
    badgeBits.push(`${t.name}:${claimed ? "claimed" : best >= BigInt(t.required) ? "claimable" : `${best}/${t.required}`}`);
  }
  console.log(`can draw today:     ${canDraw}`);
  console.log(`today's draw:       ${drawn ? `${INGREDIENTS[Number(todayItem)]} (token #${todayId})${canReroll ? " — reroll available (Founder perk)" : ""}` : "not drawn yet"}`);
  console.log(`streak:             current=${current} best=${best} lifetime days=${lifetime}`);
  console.log(`kitchen:            ${kitchen.length ? kitchen.join(" · ") : "(empty)"}`);
  console.log(`lifetime shelf:     ${distinct} of 7 ingredients`);
  console.log(`golden ramen held:  ${goldenIds.length}${goldenIds.length ? ` (token ids: ${goldenIds.join(", ")})` : ""}`);
  console.log(`founder pass:       ${passes > 0n ? `${passes} held · founder #${founderNo} · perks active` : founderNo > 0n ? `badge #${founderNo} kept, pass sold (perks inactive)` : "none"}`);
  console.log(`feast badges:       ${badgeBits.join(" · ")}`);
}

async function cmdLeaderboard(argv) {
  let limit = 20;
  const li = argv.indexOf("--limit");
  if (li >= 0) limit = Math.max(1, parseInt(argv[li + 1], 10) || 20);
  if (!(await isDeployed())) {
    console.log(`RamenForge contract: NOT DEPLOYED YET — no players yet (the forge has not lit).`);
    return;
  }
  const addrs = await rfRead("getPlayers", [0n, 100n]);
  console.log(`players: ${addrs.length}`);
  const rows = [];
  for (const a of addrs) {
    const [current, best, lifetime] = await rfRead("streakOf", [a]);
    rows.push({ a, current, best, lifetime });
  }
  rows.sort((x, y) =>
    y.current !== x.current
      ? y.current > x.current ? 1 : -1
      : y.best !== x.best
        ? y.best > x.best ? 1 : -1
        : y.lifetime > x.lifetime ? 1 : y.lifetime < x.lifetime ? -1 : 0
  );
  rows.slice(0, limit).forEach((r, i) => {
    console.log(`#${i + 1}  ${r.a}  streak=${r.current} best=${r.best} days=${r.lifetime}`);
  });
  console.log("(addresses only — RamenForge never resolves Agent ID names to wallets)");
}

async function cmdRecipes() {
  console.log("Stage 1 · Ramen        = Handmade Noodles + Tonkotsu Broth + Scallion + Nori (the 4 uncommons)");
  console.log("Stage 2 · Deluxe Ramen = Ramen + Chashu Pork + Ajitama Egg (the 2 rares)");
  console.log("Stage 3 · Golden Ramen = Deluxe Ramen + Wagyu Slice (the epic) — hard cap 100, numbered");
  console.log("Daily draw odds: uncommon 19% each · rare 9% each · Wagyu Slice 6%. Cooking burns the inputs.");
  if (await isDeployed()) {
    const cooked = await rfRead("goldenCooked", []);
    console.log(`Golden cooked so far: ${cooked} / 100`);
  } else {
    console.log("(contract not deployed yet — recipes shown are the baked-in build tables, identical on-chain)");
  }
}

async function cmdPassInfo(argv) {
  let addr = null;
  const ai = argv.indexOf("--address");
  if (ai >= 0) addr = argv[ai + 1];
  if (!(await isDeployed())) {
    console.log(`RamenForge contract: NOT DEPLOYED YET.`);
    console.log(`Founder Chef Pass terms (baked into the contract): 500 max · 0.005 BNB each · 100% of proceeds to the serve reward pool · daily reroll perk · soulbound numbered Founder Chef Badge per purchase.`);
    return;
  }
  const sold = await rfRead("passesSold", []);
  const pool = await rfRead("rewardPool", []);
  const payout = await rfRead("currentServePayout", []);
  const served = await rfRead("goldenServed", []);
  console.log(`passes sold:        ${sold} / 500`);
  console.log(`reward pool:        ${ethers.formatEther(pool)} BNB`);
  console.log(`next serve payout:  ${ethers.formatEther(payout)} BNB (serves done: ${served} / 100)`);
  if (addr) {
    addr = ethers.getAddress(addr);
    const passes = await rfRead("passCountOf", [addr]);
    const no = await rfRead("founderNumberOf", [addr]);
    console.log(`for ${addr}: passes held=${passes} · founder #=${no} · perks=${passes > 0n ? "active" : "inactive"}`);
  }
}

async function cmdPreviewMint(argv) {
  const { from: flagFrom } = takeFromFlag(argv);
  await requireDeployed();
  const from = resolveSender(flagFrom);
  await requireHolder(from);
  const canDraw = await rfRead("canDrawToday", [from]);
  if (!canDraw) {
    fail(`refusing to preview: ${from} has already drawn today's ingredient — mintDaily would revert ("Already drawn today"). No baw preview was called.`);
  }
  const calldata = iface.encodeFunctionData("mintDaily", []);
  runPreview({
    from,
    calldata,
    decoded: {
      contract: `${RAMENFORGE} (RamenForge)`,
      from,
      function: "mintDaily()",
      effect: "draws 1 random ingredient (uncommon 19% ea · rare 9% ea · Wagyu Slice 6%)",
    },
  });
}

async function cmdPreviewReroll(argv) {
  const { from: flagFrom } = takeFromFlag(argv);
  await requireDeployed();
  const from = resolveSender(flagFrom);
  const can = await rfRead("canReroll", [from]);
  if (!can) {
    fail(`refusing to preview: ${from} cannot reroll now (needs today's draw still held, a Founder Chef Pass, and no reroll used today). No baw preview was called.`);
  }
  const [todayId, todayItem] = await rfRead("todaysTokenOf", [from]);
  const calldata = iface.encodeFunctionData("reroll", []);
  runPreview({
    from,
    calldata,
    decoded: {
      contract: `${RAMENFORGE} (RamenForge)`,
      from,
      function: "reroll()",
      burns: `token #${todayId} (${INGREDIENTS[Number(todayItem)]}) — today's draw`,
      effect: "draws a fresh random ingredient instead",
    },
  });
}

async function cmdPreviewBadge(argv) {
  const { from: flagFrom, rest } = takeFromFlag(argv);
  const tier = parseTier(rest[0]);
  await requireDeployed();
  const from = resolveSender(flagFrom);
  const [, best] = await rfRead("streakOf", [from]);
  if (best < BigInt(tier.required)) {
    fail(`refusing to preview: best streak of ${from} is ${best}, but the ${tier.name} Feast Badge requires ${tier.required} — claimBadge would revert on-chain. No baw preview was called.`);
  }
  const claimed = await rfRead("badgeClaimed", [from, tier.tier]);
  if (claimed) {
    fail(`refusing to preview: ${from} has already claimed the ${tier.name} Feast Badge. No baw preview was called.`);
  }
  const calldata = iface.encodeFunctionData("claimBadge", [tier.tier]);
  runPreview({
    from,
    calldata,
    decoded: {
      contract: `${RAMENFORGE} (RamenForge)`,
      from,
      function: "claimBadge(uint8)",
      tier: `${tier.tier} (${tier.name} Feast Badge, requires best streak ${tier.required})`,
      bestStreak: best.toString(),
    },
  });
}

async function cmdPreviewCook(argv) {
  const { from: flagFrom, rest } = takeFromFlag(argv);
  const stage = String(rest[0] || "").toLowerCase();
  if (!["ramen", "deluxe", "golden"].includes(stage)) {
    fail("usage: preview-cook <ramen|deluxe|golden> [--from <addr>]");
  }
  await requireDeployed();
  const from = resolveSender(flagFrom);
  await requireHolder(from);
  if (stage === "ramen") {
    const [ids, ready] = await rfRead("ramenCookIds", [from]);
    if (!ready) fail(`refusing to preview: ${from} doesn't hold all 4 uncommon ingredients. No baw preview was called.`);
    const calldata = iface.encodeFunctionData("cookRamen", [[...ids]]);
    runPreview({
      from, calldata,
      decoded: {
        contract: `${RAMENFORGE} (RamenForge)`, from,
        function: "cookRamen(uint256[4])",
        cooks: "Ramen",
        burns: [...ids].map((id, i) => `#${id} (${INGREDIENTS[i]})`).join(", "),
      },
    });
  } else if (stage === "deluxe") {
    const [ramenId, rareIds, ready] = await rfRead("deluxeCookIds", [from]);
    if (!ready) fail(`refusing to preview: ${from} needs a Ramen plus Chashu Pork and Ajitama Egg. No baw preview was called.`);
    const calldata = iface.encodeFunctionData("cookDeluxe", [ramenId, [...rareIds]]);
    runPreview({
      from, calldata,
      decoded: {
        contract: `${RAMENFORGE} (RamenForge)`, from,
        function: "cookDeluxe(uint256,uint256[2])",
        cooks: "Deluxe Ramen",
        burns: `#${ramenId} (Ramen), #${rareIds[0]} (Chashu Pork), #${rareIds[1]} (Ajitama Egg)`,
      },
    });
  } else {
    const [deluxeId, wagyuId, ready] = await rfRead("goldenCookIds", [from]);
    if (!ready) fail(`refusing to preview: ${from} needs a Deluxe Ramen plus a Wagyu Slice (and the 100 Golden cap not reached). No baw preview was called.`);
    const cooked = await rfRead("goldenCooked", []);
    const calldata = iface.encodeFunctionData("cookGolden", [deluxeId, wagyuId]);
    runPreview({
      from, calldata,
      decoded: {
        contract: `${RAMENFORGE} (RamenForge)`, from,
        function: "cookGolden(uint256,uint256)",
        cooks: `Golden Ramen #${Number(cooked) + 1} of 100`,
        burns: `#${deluxeId} (Deluxe Ramen), #${wagyuId} (Wagyu Slice)`,
      },
    });
  }
}

async function cmdPreviewPass(argv) {
  const { from: flagFrom } = takeFromFlag(argv);
  await requireDeployed();
  const from = resolveSender(flagFrom);
  const sold = await rfRead("passesSold", []);
  if (sold >= 500n) {
    fail("refusing to preview: Founder Chef Passes are sold out (500/500). No baw preview was called.");
  }
  const calldata = iface.encodeFunctionData("buyPass", []);
  runPreview({
    from,
    calldata,
    valueWei: PASS_PRICE_WEI,
    decoded: {
      contract: `${RAMENFORGE} (RamenForge)`,
      from,
      function: "buyPass()",
      effect: `mints Founder Chef Pass #${Number(sold) + 1} + soulbound Founder Chef Badge #${Number(sold) + 1}; the full 0.005 BNB enters the reward pool`,
    },
  });
}

async function cmdPreviewServe(argv) {
  const { from: flagFrom, rest } = takeFromFlag(argv);
  const idStr = rest[0];
  if (idStr === undefined || !/^\d+$/.test(idStr)) fail("usage: preview-serve <goldenTokenId> [--from <addr>]");
  const tokenId = BigInt(idStr);
  await requireDeployed();
  const from = resolveSender(flagFrom);
  let kind, owner, serial;
  try {
    kind = await rfRead("tokenKind", [tokenId]);
    owner = await rfRead("ownerOf", [tokenId]);
    serial = await rfRead("tokenSerial", [tokenId]);
  } catch {
    fail(`refusing to preview: token #${tokenId} does not exist (or is burned). No baw preview was called.`);
  }
  if (Number(kind) !== 3) fail(`refusing to preview: token #${tokenId} is a ${KIND_NAMES[Number(kind)]}, not a Golden Ramen. No baw preview was called.`);
  if (ethers.getAddress(owner) !== from) fail(`refusing to preview: token #${tokenId} is owned by ${owner}, not by ${from}. No baw preview was called.`);
  const payout = await rfRead("currentServePayout", []);
  const calldata = iface.encodeFunctionData("serve", [tokenId]);
  runPreview({
    from,
    calldata,
    decoded: {
      contract: `${RAMENFORGE} (RamenForge)`,
      from,
      function: "serve(uint256)",
      burns: `Golden Ramen #${serial} (token #${tokenId}) — PERMANENT`,
      effect: `mints a soulbound Golden Chef Trophy and pays ${ethers.formatEther(payout)} BNB from the reward pool`,
    },
  });
}

/**
 * Execute a previously previewed request. Fully implemented, but ONLY to be
 * run on the user's explicit go-ahead after they have seen the preview
 * summary (see agent/SKILL.md). After broadcast it polls the receipt and
 * verifies the on-chain effect of the exact function that was called.
 */
async function cmdExecute(argv) {
  const requestId = argv[0];
  if (!requestId) fail("usage: execute <requestId>");
  const j = runBaw(["contract-call", "execute", "--requestId", requestId, "--json"]);
  console.log(JSON.stringify(j, null, 2));
  if (!j.success) fail("baw execute did not succeed.");
  const d = j.data || {};
  console.log(`orderId: ${d.orderId || "?"}`);
  console.log(`status:  ${d.status || "?"}`);
  if (d.status === "PENDING_CONFIRMATION") {
    console.log(
      "Waiting for the user to confirm in the Binance App. Once they tap confirm, " +
        "re-check the transaction in the app or on BscScan — no tx hash exists yet."
    );
    return;
  }
  const txHash = d.txHash;
  if (!txHash) {
    console.log("No tx hash returned yet — the order may still be processing. Check the Binance App / BscScan shortly.");
    return;
  }
  console.log(`txHash:  ${txHash}`);
  console.log(`BscScan: ${BSCSCAN}/tx/${txHash}`);

  const p = await provider();
  let rcpt = null;
  for (let i = 0; i < 30 && !rcpt; i++) {
    rcpt = await p.getTransactionReceipt(txHash);
    if (!rcpt) await new Promise((r) => setTimeout(r, 3000));
  }
  if (!rcpt) fail("tx not mined within ~90s — check BscScan for its final status.");
  console.log(`mined:   block ${rcpt.blockNumber}, status ${rcpt.status === 1 ? "SUCCESS" : "FAILED"}, gasUsed ${rcpt.gasUsed}`);
  if (rcpt.status !== 1) fail("transaction reverted on-chain.");

  const tx = await p.getTransaction(txHash);
  const parsed = iface.parseTransaction({ data: tx.data, value: tx.value });
  if (parsed) {
    if (parsed.name === "mintDaily" || parsed.name === "reroll") {
      const [current, best, lifetime] = await rfRead("streakOf", [tx.from]);
      const [, item, drawn] = await rfRead("todaysTokenOf", [tx.from]);
      console.log(`verified: ${tx.from} streak current=${current} best=${best} lifetime days=${lifetime}; today's ingredient: ${drawn ? INGREDIENTS[Number(item)] : "?"}`);
    } else if (parsed.name.startsWith("cook")) {
      const [cooks, burned, golden, served] = await rfRead("cookStats", []);
      console.log(`verified: cookStats cooks=${cooks} burned=${burned} goldenCooked=${golden} served=${served}`);
    } else if (parsed.name === "claimBadge") {
      const tier = Number(parsed.args[0]);
      const claimed = await rfRead("badgeClaimed", [tx.from, tier]);
      console.log(`verified: badgeClaimed(${tx.from}, ${tier}) = ${claimed}`);
    } else if (parsed.name === "buyPass") {
      const sold = await rfRead("passesSold", []);
      const pool = await rfRead("rewardPool", []);
      console.log(`verified: passesSold=${sold}; rewardPool=${ethers.formatEther(pool)} BNB`);
    } else if (parsed.name === "serve") {
      const served = await rfRead("goldenServed", []);
      const pool = await rfRead("rewardPool", []);
      console.log(`verified: goldenServed=${served}; rewardPool=${ethers.formatEther(pool)} BNB`);
    }
  }
}

// --------------------------------------------------------------------- main

const HELP = `RamenForge agent interface (baw) — usage:
  node agent/ramenforge.js status [--address <addr>]
  node agent/ramenforge.js leaderboard [--limit n]
  node agent/ramenforge.js recipes
  node agent/ramenforge.js pass-info [--address <addr>]
  node agent/ramenforge.js preview-mint [--from <addr>]
  node agent/ramenforge.js preview-reroll [--from <addr>]
  node agent/ramenforge.js preview-badge <tier|bronze|silver|gold> [--from <addr>]
  node agent/ramenforge.js preview-cook <ramen|deluxe|golden> [--from <addr>]
  node agent/ramenforge.js preview-pass [--from <addr>]            (0.005 BNB — the only paid call)
  node agent/ramenforge.js preview-serve <goldenTokenId> [--from <addr>]
  node agent/ramenforge.js execute <requestId>          (ONLY on the user's explicit go-ahead)

Ingredients: ${INGREDIENTS.map((n, i) => `${n} (${RARITIES[i]})`).join(" · ")}
Recipes: 4 uncommons -> Ramen · Ramen + 2 rares -> Deluxe Ramen · Deluxe + Wagyu Slice -> Golden Ramen (cap 100)
Badges: ${BADGE_TIERS.map((t) => `${t.tier}=${t.name} (best streak ${t.required})`).join(" · ")}
Contract: ${RAMENFORGE} (BNB Chain, chainId 56) — NOT DEPLOYED YET; check deployment before writing.`;

(async () => {
  const [cmd, ...argv] = process.argv.slice(2);
  try {
    switch (cmd) {
      case "status": await cmdStatus(argv); break;
      case "leaderboard": await cmdLeaderboard(argv); break;
      case "recipes": await cmdRecipes(); break;
      case "pass-info": await cmdPassInfo(argv); break;
      case "preview-mint": await cmdPreviewMint(argv); break;
      case "preview-reroll": await cmdPreviewReroll(argv); break;
      case "preview-badge": await cmdPreviewBadge(argv); break;
      case "preview-cook": await cmdPreviewCook(argv); break;
      case "preview-pass": await cmdPreviewPass(argv); break;
      case "preview-serve": await cmdPreviewServe(argv); break;
      case "execute": await cmdExecute(argv); break;
      case undefined:
      case "help":
      case "--help":
        console.log(HELP);
        break;
      default:
        fail(`unknown command "${cmd}".\n${HELP}`);
    }
  } catch (e) {
    fail(e && e.message ? e.message : String(e));
  }
})();
