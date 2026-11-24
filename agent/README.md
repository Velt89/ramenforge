# RamenForge agent interface

Play RamenForge through the Binance Agentic Wallet (`baw`) instead of the
web dApp. See **SKILL.md** for the full agent-facing contract (commands,
two-phase preview/execute flow, safety rules).

Quick start (from the repo root, after `npm install`):

```bash
node agent/ramenforge.js status
node agent/ramenforge.js recipes
node agent/ramenforge.js preview-mint        # simulation only
node agent/ramenforge.js execute <requestId> # only on the user's go-ahead
```

Status: the RamenForge contract is **not deployed yet** — all write
commands refuse cleanly until it is. Reads of the Agent ID registry work
today.
