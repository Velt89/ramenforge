---
name: ramenforge
description: |
  Use when the user wants to play RamenForge — the cooking game for Agent ID
  holders on BNB Chain — through their agent instead of the web dApp: draw
  today's free random ingredient NFT, reroll it with a Founder Chef Pass,
  check their kitchen / streak / Feast badges, cook Ramen, Deluxe Ramen or
  Golden Ramen from ingredient recipes, buy a Founder Chef Pass, or serve a
  Golden Ramen for a Golden Chef Trophy plus a reward-pool payout. Drives
  the Binance Agentic Wallet (baw) CLI: preview-first contract calls against
  the RamenForge contract (BNB Chain, chainId 56). All calls are 0 BNB
  except the pass purchase, which is exactly 0.005 BNB into the reward pool.
metadata:
  author: velt (RamenForge)
  version: '0.1.0'
  openclaw:
    requires:
      bins:
        - baw
        - node
---

# RamenForge Skill (via Binance Agentic Wallet)

RamenForge is a **cooking game** for Agent ID holders: every UTC day each
holder draws ONE free ingredient NFT at random — 7 types (Handmade Noodles,
Tonkotsu Broth, Scallion, Nori at 19% each; Chashu Pork, Ajitama Egg at 9%
each; Wagyu Slice at 6%). Ingredients are **tradeable** (Element /
OpenSea), so duplicates are trade stock and missing pieces can be bought.
**Cooking burns ingredients:** 4 uncommons → Ramen; Ramen + 2 rares →
Deluxe Ramen; Deluxe + Wagyu Slice → **Golden Ramen** (hard cap 100,
numbered). Serving a Golden Ramen burns it, mints a soulbound **Golden
Chef Trophy**, and pays from the reward pool:
`min(0.025 BNB, pool / remaining serves)`. Daily draws build a streak;
Feast badges (Bronze 3 / Silver 7 / Gold 14 **best** streak) are soulbound.
The **Founder Chef Pass** (500 max, 0.005 BNB, 100% of proceeds to the
reward pool) grants one **daily reroll** and a Season 2 head-start
entitlement while held.

This skill drives the game through the user's own paired Binance Agentic
Wallet (`baw`) — **no website, no wallet browser**. Example daily line:
*"Draw my RamenForge ingredient, reroll it if it's a duplicate, and cook
anything I'm ready to cook."*

- Contract: `0x0000000000000000000000000000000000000000` (BNB Chain,
  chainId 56) — **NOT DEPLOYED YET.** The address is a zero placeholder
  until deployment (a separate user-approved step). Before any write,
  check `eth_getCode` for the configured address: while it returns `0x`,
  the game has not started and the helper script refuses all previews
  with a "not deployed yet" message. Never preview or execute against an
  address with no code.
- Agent ID registry: `0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F`
- Helper script (run from the RamenForge repo root):
  `node agent/ramenforge.js …` (needs `npm install` at the repo root once,
  for ethers v6)
- Machine-readable manifest: served by the dApp at `/agent.json`
  (also `frontend/public/agent.json` in the repo).

## Prerequisites

1. `baw` CLI installed and the user's Agentic Wallet **paired by the user
   in the Binance App** (this skill never pairs, never asks for seeds,
   keys, pairing codes or passwords).
2. `baw --json wallet status` returns `{"status": "CONNECTED"}`. If it
   does not, stop and ask the user to connect/re-pair in the Binance App.
3. Drawing and cooking require an Agent ID. Pass purchase, trading and
   serving do not. The script checks gates on-chain before previewing.

## Commands

| User intent | Command |
|---|---|
| My status / today's draw / kitchen / streak | `node agent/ramenforge.js status` |
| Status of a specific address (read-only) | `node agent/ramenforge.js status --address <addr>` |
| Leaderboard (addresses + streaks) | `node agent/ramenforge.js leaderboard [--limit n]` |
| The recipes + draw odds | `node agent/ramenforge.js recipes` |
| Pass sale / pool / next serve payout | `node agent/ramenforge.js pass-info [--address <addr>]` |
| Draw today's ingredient | `node agent/ramenforge.js preview-mint` |
| Reroll today's ingredient (pass holders) | `node agent/ramenforge.js preview-reroll` |
| Claim a Feast badge | `node agent/ramenforge.js preview-badge <tier\|bronze\|silver\|gold>` |
| Cook a dish | `node agent/ramenforge.js preview-cook <ramen\|deluxe\|golden>` |
| Buy a Founder Chef Pass (0.005 BNB) | `node agent/ramenforge.js preview-pass` |
| Serve a Golden Ramen | `node agent/ramenforge.js preview-serve <goldenTokenId>` |
| Execute an approved preview | `node agent/ramenforge.js execute <requestId>` |

The script refuses locally — before ever calling `baw` — when: the
contract is not deployed yet, the sender holds no Agent ID (for draw /
cook), today's ingredient was already drawn, a reroll is unavailable, a
recipe isn't ready, a badge is unqualified or already claimed, passes are
sold out, or the serve target isn't the sender's Golden Ramen.

## The two-phase write flow (mandatory)

Every write goes through these steps, in order, with no shortcuts:

1. **Preview.** Run the matching `preview-*` command. This calls
   `baw contract-call preview` — a simulation. It broadcasts nothing and
   creates **no** notification in the user's Binance App.
2. **Show the user the preview summary** before anything else: from
   (their wallet), to (the RamenForge contract), function + decoded
   arguments — **including exactly which token ids will BURN** for cooks,
   rerolls and serves, and the payout for a serve — the value (0, or
   exactly 0.005 BNB for a pass), the simulation verdict,
   `requireConfirmation`, and the risk fields. `allowanceChanges` and
   `authorityChanges` must be **empty** and `risks` must be **none** — if
   any of them is not, STOP, show the user, and do not execute.
3. **Wait for the user's explicit go-ahead** ("execute", "go", "confirm"
   — in their own words, after seeing the summary). A request to
   *prepare* or *preview* is never a go-ahead to execute. Burns are
   irreversible: for cook/serve/reroll previews, make sure the user saw
   the burn list.
4. **Execute.** Only then run `node agent/ramenforge.js execute
   <requestId>` with the requestId from step 1. If the preview has
   expired or anything changed (e.g. the UTC day rolled over between
   preview and execute — the draw would differ), discard it and go back
   to step 1 — **never execute a stale preview**.
5. **Report and verify.** After execution, report the outcome exactly as
   returned: if `PENDING_CONFIRMATION`, tell the user a confirmation is
   waiting for their tap in the Binance App (it only exists *after*
   execute — never tell the user to tap for a mere preview). If
   `BROADCASTED`, report the tx hash + BscScan link and the on-chain
   verification the script prints. If it failed or reverted, say so
   plainly with the reason given.

## Safety rules (non-negotiable)

- **Preview first, always.** No `execute` without a fresh, clean preview
  that the user has seen.
- **Execute only on the user's explicit go-ahead**, for that specific
  preview's requestId. One go-ahead covers one execute.
- **Values:** 0 BNB for everything except `buyPass`, which is exactly
  0.005 BNB into the contract's reward pool. Never change a value, add a
  token approval, or bundle extra calls.
- **Burns are permanent.** Cooking burns ingredient tokens; serving
  burns a Golden Ramen; reroll burns today's draw. The user must see the
  exact burn list in the preview summary before any go-ahead.
- **Verify deployment before writing.** If `eth_getCode(contract)` is
  `0x`, stop — the game has not started.
- **Never ask for or handle** seed phrases, private keys, pairing codes,
  passwords or session tokens. Pairing happens only in the user's
  Binance App.
- **No name→wallet lookup.** RamenForge never resolves an Agent ID
  handle to someone else's wallet. The leaderboard shows addresses and
  streaks only.
- **No promises.** Serve payouts come only from the pass-funded reward
  pool and shrink if fewer passes sell. Never describe ingredients,
  dishes or the pass as investments or guaranteed rewards.
- If `baw` reports the wallet is not CONNECTED, stop and hand the
  connection step back to the user (Binance App). Do not attempt sign-in
  flows for them.

## Example user prompts

- "Draw my RamenForge ingredient for today."
- "What's in my kitchen? Can I cook anything?"
- "Reroll today's ingredient — it's my third Nori."
- "Cook a Deluxe Ramen for me."
- "Buy me a Founder Chef Pass."
- "Serve my Golden Ramen."
- "What's the reward pool at, and what would a serve pay now?"
- "Show me the RamenForge leaderboard."
