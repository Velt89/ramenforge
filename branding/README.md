# RamenForge — marketplace branding pack

Everything needed to brand the collection on **Element** (primary) and
**OpenSea** (secondary). Assets are ready; submission itself needs the
collection owner's wallet (W = 0x0518AE367CA3612872Aa2f0897BF3B5FaFCE893A)
to sign in on each platform — see "Submission steps" below.

## Assets

| File | Use |
|---|---|
| `logo.png` (1000×1000) | Collection logo (Golden Ramen art) |
| `logo-mark.png` (512×512) | Small mark / favicon-style logo |
| `banner.png` (1400×400) | Collection banner |
| `art/*.svg` | All 16 token art files (ingredients, dishes, pass, badges, trophy) — source SVGs if a platform asks for the featured image; use `art/ramen-golden.svg` |

## Collection facts (paste-ready)

- **Name:** RamenForge
- **Contract (BSC, chainId 56):** 0xbCC65C8693cdEbcF934A38f7Cb0287b2BD801f1D
- **Symbol:** FORGE
- **Category:** Gaming / Collectibles
- **Royalties:** 5% — already on-chain via ERC-2981, receiver = the
  RamenForge contract itself (royalties flow into the player reward
  pool). Do NOT set a different royalty wallet on the platform; if the
  platform asks for a royalty recipient, it is the contract address
  above.
- **Links:**
  - Website: (add the Vercel URL once deployed — pending user import)
  - GitHub: https://github.com/Velt89/ramenforge (once repo is created + pushed)
  - X: https://x.com/AdityaGraha6
  - Contract: https://bscscan.com/address/0xbCC65C8693cdEbcF934A38f7Cb0287b2BD801f1D
  - Source verified: Sourcify exact_match (matchId 59864347)

## Description (long — OpenSea / Element collection page)

RamenForge is a cooking game for Agent ID holders on BNB Chain. Every
UTC day, each holder draws ONE free ingredient NFT at random (gas
only) from 7 types: Handmade Noodles, Tonkotsu Broth, Scallion and
Nori (uncommon, 19% each), Chashu Pork and Ajitama Egg (rare, 9%
each), and the Wagyu Slice (epic, 6%).

Every ingredient and dish is a standard tradeable ERC-721 — duplicates
are trade stock, missing pieces are bought, not waited for. Cooking
burns the inputs and climbs the ladder: 4 uncommons → Ramen; Ramen +
the 2 rares → Deluxe Ramen; Deluxe Ramen + a Wagyu Slice → Golden
Ramen. Only 100 Golden Ramen will ever exist, numbered #1–#100.

Serving a Golden Ramen burns it, mints a soulbound Golden Chef Trophy
and pays 0.025 BNB from the reward pool (scaling with the pool if it
is not yet full). The pool is funded 100% by the Founder Chef Pass —
500 passes at 0.005 BNB — whose holders get a daily ingredient reroll
and a Season 2 head-start entitlement. The contract has no owner, no
admin and no withdrawal function: the only way BNB leaves it is a
serve payout.

Daily draws build streaks; soulbound Feast badges mark 3 / 7 / 14-day
best streaks. Forge the Golden Ramen.

## Description (short — listings / social)

Draw a free ingredient daily, trade what you don't need, cook Ramen →
Deluxe → Golden. Only 100 Golden Ramen will ever exist. Serve one for
a Golden Chef Trophy + 0.025 BNB from the pass-funded pool. BNB Chain,
Agent ID gated draws.

## Submission steps (user, ~2 minutes per platform)

Both platforms gate collection editing behind the contract owner's
wallet signature, so this last step is yours:

**Element (primary)**
1. Go to element.market, connect wallet W (Binance Agentic Wallet
   address 0x0518…893A) on BNB Chain.
2. Open the RamenForge collection (search the contract address
   0xbCC65C8693cdEbcF934A38f7Cb0287b2BD801f1D), then Edit collection.
3. Upload `logo.png` + `banner.png`, paste the long description, add
   the links, confirm royalties show 5% to the contract. Save.

**OpenSea (secondary)**
1. Go to opensea.io, sign in with wallet W.
2. Studio → your collections → RamenForge (BSC) → Edit.
3. Same assets + copy as above. Save.

Everything above is prepared — no other input is needed at submission
time.
