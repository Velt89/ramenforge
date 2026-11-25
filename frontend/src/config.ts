import { bsc } from "viem/chains";

// BNB Chain mainnet
export const CHAIN = bsc; // id 56

// SPACE ID Agent ID registry (ERC-721, non-transferable) — verified live.
// balanceOf(address) > 0 means the address holds an Agent ID.
export const AGENT_ID_REGISTRY = "0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F" as const;

// DEPLOYED 2026-11-25 — landed exactly at the predicted CREATE2 address
// (salt keccak256("velt.ramenforge.v1") via proxy
// 0x4e59b44847b379578588920cA78FbF26c0B4956C). Creation tx:
// 0x731c854d9224354223f7511c390c5ca0d5141c4774538a85310777175c532eaa
export const RAMENFORGE_ADDRESS = "0xbCC65C8693cdEbcF934A38f7Cb0287b2BD801f1D" as const;

export const RAMENFORGE_DEPLOYED = true;

// Block the RamenForge contract was deployed in (for event scans).
export const RAMENFORGE_START_BLOCK = 135549831n;

// The 7 ingredients, in contract order (item index 0-6).
// Drop weights: uncommon 19% each, rare 9% each, epic 6%.
export const INGREDIENTS = [
  { name: "Handmade Noodles", slug: "handmade-noodles", rarity: "Uncommon", weight: 19 },
  { name: "Tonkotsu Broth", slug: "tonkotsu-broth", rarity: "Uncommon", weight: 19 },
  { name: "Scallion", slug: "scallion", rarity: "Uncommon", weight: 19 },
  { name: "Nori", slug: "nori", rarity: "Uncommon", weight: 19 },
  { name: "Chashu Pork", slug: "chashu-pork", rarity: "Rare", weight: 9 },
  { name: "Ajitama Egg", slug: "ajitama-egg", rarity: "Rare", weight: 9 },
  { name: "Wagyu Slice", slug: "wagyu-slice", rarity: "Epic", weight: 6 },
] as const;

// Cooked dishes (token kinds 1-3).
export const DISHES = [
  { kind: 1, name: "Ramen", slug: "ramen" },
  { kind: 2, name: "Deluxe Ramen", slug: "ramen-deluxe" },
  { kind: 3, name: "Golden Ramen", slug: "ramen-golden" },
] as const;

// Feast badge tiers: tier -> required BEST streak.
export const BADGE_TIERS = [
  { tier: 1, name: "Bronze", slug: "badge-bronze", required: 3 },
  { tier: 2, name: "Silver", slug: "badge-silver", required: 7 },
  { tier: 3, name: "Gold", slug: "badge-gold", required: 14 },
] as const;

// Economy constants (mirror the contract).
export const GOLDEN_CAP = 100;
export const PASS_SUPPLY = 500;
export const PASS_PRICE_BNB = "0.005";
export const MAX_SERVE_PAYOUT_BNB = "0.025";

// Marketplaces — the collection is live and indexed (standard ERC-721 +
// ERC-2981). Element is the primary market; this is the collection page.
export const ELEMENT_URL = "https://element.market/collections/ramenforge";
export const OPENSEA_URL = "https://opensea.io";

export function utcDayNow(): number {
  return Math.floor(Date.now() / 1000 / 86400);
}

export function artImage(slug: string): string {
  return `/art/${slug}.svg`;
}
