# RamenForge — design record (brainstorm, user-decided)

Project name (user tap, 2026-11-25): **RamenForge** (was working title
"DailyFest Fusion"). Built in ~/workspace/ramenforge/.

Settled step by step in the "DailyFest fusion brainstorm" side chat, 2026-11-25.
Status: BUILD AUTHORIZED by the user 2026-11-25 ~05:58 WIB ("Build it. Make
perfect build") — **BUILT 2026-11-25**: contracts compile with 0 warnings,
25/25 tests pass, frontend production build passes, agent CLI smoke-tested
against the not-deployed config. Build decisions where the design left a choice:
single contract (game + pass + pool — see README "Architecture
decision"), serve open to any Golden owner, pass purchase open to
anyone.
**DEPLOYED 2026-11-25** (user: "If it clean the deploy it" — all clean
gates passed): RamenForge LIVE on BSC at
**0xbCC65C8693cdEbcF934A38f7Cb0287b2BD801f1D** (exact predicted CREATE2
address, salt keccak256("velt.ramenforge.v1") via proxy
0x4e59b44847b379578588920cA78FbF26c0B4956C through BAW; preview fully
clean, execute BROADCASTED under DevMode; creation tx
0x731c854d9224354223f7511c390c5ca0d5141c4774538a85310777175c532eaa,
block 135,549,831, gasUsed 5,663,684, cost 0.00042711126700268 BNB;
on-chain verified on two RPCs: code 24,097 bytes, registry correct,
name RamenForge / symbol FORGE, totalMinted/goldenCooked/passesSold all
0, hasAgentId(W) true). Sourcify VERIFIED exact_match (match +
creationMatch + runtimeMatch, matchId 59864347); auto-forwarded to
BscScan, landing unconfirmed. Frontend config + agent.json + agent CLI
flipped to DEPLOYED (start block 135,549,831), frontend rebuilt OK, CLI
live status smoke test passed.
**LAUNCH STEPS 2026-11-25** (user: "Ok lets do it"): Boltbook b/alpha
launch post LIVE: https://boltbook.fun/p/yqU7Ah-Kr10O (duplicate-checked
by contract + name forum-wide, facts re-verified on two RPCs at posting,
verify challenge solved 42/7=6.00; first attempt hit the 30-min post
rate limit, single retry after 19 min succeeded — posted exactly once).
GitHub push BLOCKED-ON-USER: repo Velt89/ramenforge does not exist and
the GitHub App cannot create repos (create_repository -> 403 "Resource
not accessible by integration") — user must create the empty repo, then
the 49-file bulk push + raw-read verification runs. Vercel
BLOCKED-ON-USER: connector hit the known old team scope block (403,
scope velt4); frontend builds clean locally with the live address —
user step is the one-click import of Velt89/ramenforge, root directory
frontend (after the GitHub push). Marketplace branding PACK PREPARED in
~/workspace/ramenforge/branding/ (logo.png 1000x1000, logo-mark.png,
banner.png 1400x400, all art SVGs, paste-ready copy, royalty note);
submission BLOCKED-ON-USER on both Element and OpenSea (collection
editing requires the owner wallet W signature; exact steps in
branding/README.md).
(A first draft build exists in this folder — 14-dish rotation + dish-as-ingredient
recipes, 23/23 tests — it predates this design and will be reworked to match.)

## Decisions

1. **New standalone build**, not a V1 companion. V1 DailyFest (live, submitted)
   stays untouched.
2. **Recipes, not copies**: a dish is cooked from several *different* ingredients.
3. **Everything tradeable** (user tap: "Everything tradeable — full marketplace
   economy"): all dish tiers are standard ERC-721, listable on OpenSea / Element.
   Feast badges stay soulbound (streak prestige cannot be bought).
   Venues (checked 2026-11-25): **Element = primary** (BSC-native, ~0.5% seller
   fee, honors ERC-2981 royalties, aggregates OpenSea listings); **OpenSea =
   secondary** (supports BNB Chain, biggest audience). No listing action needed
   pre-launch — standard ERC-721 + ERC-2981 auto-indexes; we submit collection
   branding after deploy. The RamenForge site links both + shows live floors.
4. **Anti-boredom engine**: players must not stall waiting for a rotation day —
   missing pieces are bought/traded, duplicates are trade stock.
5. **One hero dish, small pool** (too many dishes = nobody completes):
   - Hero dish: **Ramen**
   - **7 ingredients**: 4 uncommon, 2 rare, 1 epic
   - Daily mint: **1 per day, RANDOM ingredient** (replaces the fixed rotation)
   - The rest of a recipe is completed by **trading**
6. **Ingredient pool (real ramen anatomy)**:
   - Uncommon (4): Handmade Noodles, Tonkotsu Broth, Scallion, Nori
   - Rare (2): Chashu Pork, Ajitama Egg
   - Epic (1): **Wagyu Slice** — user chose luxury flex over Black Garlic Oil
     (authentic alternative, rejected 2026-11-25)
7. **Staged cooking** (rarity ladder = cooking ladder):
   - Ramen = 4 uncommon ingredients
   - Deluxe Ramen = Ramen + 2 rare ingredients
   - Golden Ramen = Deluxe Ramen + 1 epic ingredient (Wagyu Slice)
   Cooking burns the ingredients. Streaks/badges/lifetime shelf unaffected.

8. **Drop weights** (user tap, 2026-11-25): uncommon 76% total (19% each),
   rare 18% (9% each), **epic 6%** — "chase, but fair" (~17-day average solo
   wait for the Wagyu Slice; trading is the shortcut).

9. **Fundraising** (user tap, 2026-11-25): **Founder Chef Pass sale = main raise.**
   Royalties (5% ERC-2981) remain the sustaining layer; sponsors/grants are
   upside, not the plan. Pass perks = convenience/status, NEVER direct power:
   no selling the epic or rares — the 6% chase and the ingredient market must
   not be bypassed. Never promise returns. (Fund split decided below:
   100% to the reward pool.)
   - Price (user, 2026-11-25): **0.005 BNB** — deliberately low/community-priced
     (rejected 0.025/0.05/0.1 as too high).
   - Supply (user, 2026-11-25): **500 passes** → max raise **2.5 BNB**.
   - Fund use (user, 2026-11-25): **100% of the raise goes to the reward pool**
     (supersedes the earlier 60/40 proposal — no dev cut from the pass sale).
   - Perks SETTLED (user tap, 2026-11-25): gameplay perk = **daily reroll** —
     once per day, redraw today's ingredient once (second drop / status-only
     rejected). Rest of bundle as proposed: soulbound Founder Chef badge
     numbered in purchase order, Hall of Fame founder listing, Season 2 early
     access + 1 bonus uncommon ingredient (never rare/epic), pass tradeable
     with perks following the current holder, max 1 pass counts per wallet,
     no drop-rate boosts and no ingredient sales — ever.
11. **Reward payout** (user tap, 2026-11-25): **serve-to-earn, all 100 serves
    × 0.025 BNB** — every Golden Ramen served (burned for the Golden Chef
    Trophy) pays 0.025 BNB from the pool; 100 serves × 0.025 = the full
    2.5 BNB pool, ending exactly with the Golden cap. If fewer than 500
    passes sell, per-serve payout scales with the actual pool
    (pool ÷ 100), enforced on-chain. Selling a Golden stays possible —
    serve (Trophy + 0.025 BNB) vs sell (market price) is the holder's choice.
10. **Golden Ramen supply cap** (user tap, 2026-11-25): **100 max, numbered
    #1–#100.** When #100 is cooked, Golden cooking closes for Season 1.
    Rationale: scarce vs 500 passes (≤1 in 5 holders), reachable in-season
    (needs ≥100 Wagyu drops ≈ ≥1,700 community mints at 6%).

## Still open (defaults proposed, not yet user-confirmed)

- Randomness mechanism (must be fair, not grindable by timing) — proposed:
  keccak256(day, sender, blockhash of day start) style draw, revealed at mint.
- Whether mint/cooking stay Agent-ID gated (draft: yes for both; trading open).
