/** Regenerates frontend/src/abi.ts from deploy-package/RamenForge.abi.json.
 * Run scripts/prepare-deploy.js first (it exports the ABI), then:
 *   node scripts/gen-frontend-abi.js                                        */
"use strict";
const fs = require("fs");
const path = require("path");
const abi = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "deploy-package", "RamenForge.abi.json"), "utf8"));
const wanted = new Set([
  "hasAgentId","mintDaily","reroll","claimBadge","cookRamen","cookDeluxe","cookGolden",
  "buyPass","serve","fundPool","canDrawToday","canReroll","todaysTokenOf","streakOf",
  "badgeClaimed","hasIngredient","distinctIngredientsOf","ingredientCount","ingredientTokenIds",
  "dishTokenIds","ramenCookIds","deluxeCookIds","goldenCookIds","passesSold","passCountOf",
  "hasFounderPerks","founderNumberOf","rewardPool","currentServePayout","goldenCooked",
  "goldenServed","trophiesMinted","totalMinted","totalBurned","cookStats","playersCount",
  "getPlayers","getFounders","getGoldenChefs","tokenKind","tokenItem","tokenSerial","everHadDish",
  "IngredientDrawn","Rerolled","Cooked","BadgeClaimed","PassPurchased","Served","PoolFunded",
  "balanceOf","ownerOf","transferFrom","approve","setApprovalForAll",
]);
const picked = abi.filter((e) => wanted.has(e.name));
const missing = [...wanted].filter((w) => !picked.some((e) => e.name === w));
if (missing.length) { console.error("MISSING from ABI:", missing); process.exit(1); }
const out = `// RamenForge ABI subset — generated from deploy-package/RamenForge.abi.json
// (scripts/gen-frontend-abi.js). Do not edit by hand.

export const registryAbi = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "handleOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "string" }],
  },
] as const;

export const ramenForgeAbi = ${JSON.stringify(picked, null, 2)} as const;
`;
fs.writeFileSync(path.join(__dirname, "..", "frontend", "src", "abi.ts"), out);
console.log("wrote frontend/src/abi.ts with", picked.length, "entries");
