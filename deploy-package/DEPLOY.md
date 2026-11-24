# RamenForge — Deployment Guide

**Status: DEPLOYED 2026-11-25 — RamenForge is LIVE at 0xbCC65C8693cdEbcF934A38f7Cb0287b2BD801f1D (creation tx 0x731c854d9224354223f7511c390c5ca0d5141c4774538a85310777175c532eaa, block 135,549,831, gasUsed 5,663,684, cost 0.00042711126700268 BNB; Sourcify exact_match, matchId 59864347). The text below is the pre-flight plan as written before deployment.**
All figures are LOCAL measurements (Hardhat in-process network) from
`scripts/prepare-deploy.js` — see `prediction.json` in this folder.
Re-check gas and balance at deploy time. Deployment needs a separate,
explicit user go-ahead.

## Pre-flight summary (one line)

> BSC mainnet (chain 56) · from W `0x0518AE367CA3612872Aa2f0897BF3B5FaFCE893A` · to: deterministic CREATE2 proxy `0x4e59b44847b379578588920cA78FbF26c0B4956C` (contract creation via proxy) · value **0 BNB** · creates **RamenForge at the predicted address `0xbCC65C8693cdEbcF934A38f7Cb0287b2BD801f1D`** (salt `keccak256("velt.ramenforge.v1")`) · constructor arg: Agent ID registry `0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F` · creation gas measured locally at **5,652,060** (recommended limit ≈ **6,800,000**, +20%) · est. cost at 0.05 gwei ≈ **0.00034 BNB** at the recommended limit · **no approvals, no spenders, no token transfers**.

The prediction is deterministic: same bytecode + same salt + same
constructor arg ⇒ same address. If the contract source changes at all,
re-run `npm run prepare-deploy` — the prediction changes with it. The
frontend config deliberately keeps the **zero address** until a real
deployment is verified on-chain (this prediction is for planning and
for the one-shot CREATE2 call only).

## Contract facts (measured locally)

- Compiler: solc **0.8.24**, optimizer **200 runs**, EVM **paris**, **viaIR: true**
  (viaIR is required — the legacy pipeline exceeds both the stack and,
  without it, the code-size budget for this contract).
- Runtime size: **24,097 bytes** (limit 24,576). Creation code: 25,936 bytes.
- Compile warnings: **0**. Tests: **25/25 passing** (`npx hardhat test`).

### Gas measured on the local network (first-call worst cases)

| Call | Gas |
|---|---|
| Contract creation | 5,652,060 |
| `buyPass()` | 346,171 |
| `mintDaily()` (first draw) | 468,587 |
| `reroll()` | 301,406 |
| `cookRamen()` | 399,639 |
| `cookDeluxe()` | 330,675 |
| `cookGolden()` | 303,151 |
| `serve()` | 270,595 |
| `claimBadge()` | 150,976 |

These are estimates from a local EVM, not BSC measurements — treat them
as sizing guidance, not guarantees.

## The route — BAW contract-call to the CREATE2 proxy

The route that deployed AgentProof and DailyFest: the baw CLI has no
create command, but a contract-call to the deterministic deployment
proxy with calldata `salt ++ initCode` deploys at the predicted
address. Build the calldata at deploy time from the compiled artifact
(creation bytecode + ABI-encoded registry address) — do not hand-copy
it.

**Prerequisite:** `baw --json wallet status` must return `CONNECTED`
(re-pair in the Binance App if the session has lapsed — only the user
can do that part).

### 1. Preview (simulation only — broadcasts nothing, creates no app notification)

Preview the contract-call to the proxy with value 0 and the
`salt ++ initCode` calldata. Expected: simulation success, no risks,
empty allowance/authority changes, `requireConfirmation=false` under
Developer Mode. If anything differs — STOP and re-check; do not execute
a dirty preview.

### 2. Execute (only on the user's explicit go-ahead for that preview)

Execute the preview's requestId. Expected: `BROADCASTED` + orderId
(Developer Mode), or `PENDING_CONFIRMATION` + orderId — in the latter
case the confirmation exists only now; the user taps it in the Binance
App.

### 3. Verify the deployment landed at the predicted address

- The created contract must be **`0xbCC65C8693cdEbcF934A38f7Cb0287b2BD801f1D`**.
- Read-only checks: `agentIdRegistry()` == the registry, `totalMinted()` == 0,
  `passesSold()` == 0, `goldenCooked()` == 0, `hasAgentId(W)` == true,
  runtime code present (24,097 bytes).

## Post-deploy checklist

1. **Frontend config** — in `frontend/src/config.ts`:
   - Set `RAMENFORGE_ADDRESS` to the deployed address, flip
     `RAMENFORGE_DEPLOYED` to `true` **only after** step 3 verifies.
   - Set `RAMENFORGE_START_BLOCK` to the deployment block.
   - Set the same address in `agent/ramenforge.js` and
     `frontend/public/agent.json` (deploymentStatus → DEPLOYED).
   - Rebuild: `cd frontend && npm run build` (must pass).
2. **Source verification:**
   - Sourcify: submit the contract with solc 0.8.24, optimizer 200,
     EVM paris, **viaIR enabled** — expect exact_match.
   - BscScan verify with the same settings if Sourcify forwarding lags.
3. **Live sanity check** (read-only first): `hasAgentId(W)` true,
   `canDrawToday(W)` true; then ONE real `mintDaily()` from W via the
   agent CLI preview→execute flow as the first live draw (token 0).
4. **Marketplaces:** submit collection branding (name RamenForge, art,
   description, 5% royalty already on-chain via ERC-2981) on Element
   (primary) and OpenSea; confirm the collection indexed all token
   kinds; paste the collection URLs into `frontend/src/config.ts`
   (`ELEMENT_URL` / `OPENSEA_URL`) and rebuild.
5. **Publish:** push the repo to GitHub (`github.com/Velt89/ramenforge`),
   deploy `frontend/` to Vercel (root directory `frontend`), confirm
   `/agent.json` serves with the deployed address.
6. **Launch:** announce via the community channel with the agent
   one-liner ("Draw my RamenForge ingredient…"). Pass sale is live from
   deployment — the reward pool starts filling immediately; no separate
   sale contract or sale-start step exists.
