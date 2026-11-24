# RamenForge — forge the Golden Ramen

A cooking game for **Agent ID holders** on BNB Chain. Draw one free
ingredient a day, trade what you don't need, and cook your way up the
ladder: **Ramen → Deluxe Ramen → Golden Ramen** — of which only **100**
will ever exist.

**Status: BUILT, TESTED, NOT DEPLOYED.** Deployment is a separate step
that needs its own go-ahead. The frontend and agent manifest therefore
carry the zero address as a placeholder. (DailyFest V1 — a different,
already-live contract — is untouched by this project.)

## The game

- **Daily draw.** Every UTC day, each Agent ID holder draws ONE free
  ingredient NFT at random (gas only) from 7 types:

  | Ingredient | Rarity | Drop rate |
  |---|---|---|
  | Handmade Noodles | Uncommon | 19% |
  | Tonkotsu Broth | Uncommon | 19% |
  | Scallion | Uncommon | 19% |
  | Nori | Uncommon | 19% |
  | Chashu Pork | Rare | 9% |
  | Ajitama Egg | Rare | 9% |
  | Wagyu Slice | Epic | 6% |

- **Trading is the anti-boredom engine.** Every ingredient and dish is a
  standard, tradeable ERC-721 (Element primary, OpenSea secondary).
  Duplicates are trade stock; missing pieces are bought, not waited for.
- **Cooking** (Agent ID holders only) burns the inputs:
  - 4 uncommons → **Ramen**
  - Ramen + Chashu Pork + Ajitama Egg → **Deluxe Ramen**
  - Deluxe Ramen + Wagyu Slice → **Golden Ramen** — hard cap **100**,
    numbered #1–#100; cooking reverts once #100 exists.
- **Streaks & badges** (from DailyFest V1): consecutive draw days build
  a streak; **Feast badges** — Bronze (3-day best streak), Silver (7),
  Gold (14) — are soulbound and claimable off your *best* streak.
  Lifetime shelves (ingredients/dishes ever held) never shrink when
  cooking burns tokens.

## The economy

- **Founder Chef Pass** — 500 max, **0.005 BNB** each, sold by the game
  contract. **100% of proceeds enter the reward pool.** Per purchase the
  buyer also receives a soulbound **Founder Chef Badge** numbered in
  purchase order. The pass itself is tradeable; perks follow the
  *current* holder and never stack:
  - **Daily reroll** — burn today's drawn ingredient and draw again,
    once per day.
  - **Season 2 head-start entitlement** — readable on-chain via
    `hasFounderPerks(address)` (early access + 1 bonus uncommon
    ingredient in Season 2; the bonus itself is a Season 2 event).
  - Hall of Fame founder listing (`getFounders`).
  Pass purchase is open to anyone — the Agent ID gate applies to
  drawing and cooking, not to funding.
- **Serve-to-earn.** Serving (burning) a Golden Ramen mints a soulbound,
  numbered **Golden Chef Trophy** and pays from the pool:

  ```
  payout = min(0.025 BNB, rewardPool / (100 − servesAlreadyDone))
  ```

  At full funding (500 passes = 2.5 BNB) every one of the 100 serves
  pays exactly **0.025 BNB**, and the share stays constant as the pool
  drains because the denominator shrinks with it. If fewer passes sell,
  the per-serve amount scales down in proportion (e.g. 100 passes →
  0.5 BNB pool → 0.005 BNB per serve). Later funding (more pass sales,
  sponsor top-ups via `fundPool()`, marketplace royalties) raises the
  share again, up to the 0.025 BNB cap. **If the pool is empty, a serve
  still mints the Trophy and pays 0 — it never reverts for lack of
  funds.** Serving is open to whoever owns the Golden (a bought Golden
  can be served by its buyer).
- **Royalties.** ERC-2981, 5% on every token, receiver = the game
  contract itself — so secondary-market royalties flow into the same
  reward pool.
- **Pool safety.** The contract has **no owner, no admin, no pause, no
  upgradeability and no withdrawal/rescue function of any kind**. The
  only code path that moves BNB out is a serve payout. Pool accounting
  (`rewardPool()`) is a public on-chain number; the contract balance
  always covers it.

## Architecture decision: one contract

Game, pass sale and reward pool live in a **single contract**
(`contracts/RamenForge.sol`) rather than a game + separate pass
contract:

1. **Pool accounting is airtight** — pass proceeds enter the same
   contract that pays serves; there is no forwarding hop that could
   strand or divert funds, and no second contract to trust.
2. **No circular dependency** — the reroll perk checks pass ownership
   internally; a two-contract split would need CREATE2 address
   prediction or a post-deploy setter (an admin surface) to wire the
   two together.
3. **One collection** on Element/OpenSea for everything (ingredients,
   dishes, passes), with soulbound kinds (badges, trophies, founder
   badges) clearly marked in metadata.

`contracts/MockAgentID.sol` is a local-test stand-in for the Agent ID
registry and is never deployed.

## Randomness — approach and honest limits

The draw is `keccak256(blockhash(block.number − 1), block.prevrandao,
sender, utcDay, senderLifetimeDrawCount) mod 100`, revealed at mint.
Properties:

- One draw per wallet per UTC day, bound to the sender — nobody can
  draw for another wallet, and waiting within a day doesn't help
  (yesterday's seed is gone; the day counter is in the seed).
- The lifetime draw count makes every draw's seed unique even across
  rerolls and days.

Limits, stated plainly: the seed is derived from **public chain data**,
so it is not secret. A sophisticated caller who can land a transaction
in an exact chosen block — or a contract wallet that calls `mintDaily`
and reverts unless the result is epic — could bias *their own* single
daily draw. The impact is bounded: one ingredient per day, Agent ID is
one-per-person (Sybil cost), and the epic ingredient is freely
tradeable anyway, so grinding competes with simply buying a Wagyu
Slice. A commit-reveal scheme doesn't fix this (the claim step becomes
the grindable step), and a VRF oracle would add a dependency and a
per-draw fee to a free daily game; both were considered and rejected
for Season 1. If RamenForge ever stakes real value on a single draw,
the draw — not the rest of the game — should move to VRF first.

## Venues

- **Element** (primary): BSC-native marketplace, ~0.5% seller fee,
  honors ERC-2981 royalties, aggregates OpenSea listings.
- **OpenSea** (secondary): supports BNB Chain, largest audience.
- The collection auto-indexes on both at deployment (standard ERC-721 +
  ERC-2981); collection branding is submitted once after deploy.

## Repository layout

```
contracts/        RamenForge.sol (+ MockAgentID.sol, tests only)
test/             Hardhat suite — 25 tests, all passing
frontend/         Vite + React dApp (config = NOT DEPLOYED placeholder)
agent/            ramenforge.js CLI (baw, preview-first) + SKILL.md
deploy-package/   RamenForge.abi.json, prediction.json, DEPLOY.md
scripts/          prepare-deploy.js (local gas measurement + CREATE2
                  prediction), check-registry.js, gen-art.js,
                  gen-frontend-abi.js
DESIGN.md         the settled design record (every number user-decided)
```

## Build & test

```bash
npm install
npx hardhat compile        # solc 0.8.24, optimizer 200, paris, viaIR — 0 warnings
npx hardhat test           # 25 passing
cd frontend && npm install && npm run build
node agent/ramenforge.js status    # works pre-deployment (registry reads)
```

## Honest limits

- Drawing and cooking are free (gas only); the pass costs 0.005 BNB.
  Serve payouts come **only** from the pass-funded pool and shrink if
  fewer passes sell. Nothing in RamenForge promises returns or profit;
  ingredients and dishes are game collectibles, not investments.
- The draw randomness is public-data based (see above).
- Golden Ramen #100 ends Season 1 cooking; a Season 2 (new hero dish)
  would be a new contract — passes carry their head-start entitlement
  read on-chain from this one.
