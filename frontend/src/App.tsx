import { useCallback, useEffect, useMemo, useState } from "react";
import {
  createPublicClient,
  createWalletClient,
  custom,
  formatEther,
  http,
  parseEther,
  type Address,
} from "viem";
import {
  AGENT_ID_REGISTRY,
  BADGE_TIERS,
  CHAIN,
  DISHES,
  ELEMENT_URL,
  GOLDEN_CAP,
  INGREDIENTS,
  MAX_SERVE_PAYOUT_BNB,
  OPENSEA_URL,
  PASS_PRICE_BNB,
  PASS_SUPPLY,
  RAMENFORGE_ADDRESS,
  RAMENFORGE_DEPLOYED,
  artImage,
  utcDayNow,
} from "./config";
import { ramenForgeAbi, registryAbi } from "./abi";

declare global {
  interface Window {
    ethereum?: {
      request: (args: { method: string; params?: unknown }) => Promise<unknown>;
      on?: (event: string, handler: (...args: unknown[]) => void) => void;
      removeListener?: (event: string, handler: (...args: unknown[]) => void) => void;
    };
  }
}

const publicClient = createPublicClient({ chain: CHAIN, transport: http() });
const DEPLOYED = RAMENFORGE_DEPLOYED;

function short(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function errorCode(e: unknown): number | undefined {
  if (typeof e === "object" && e !== null && "code" in e) {
    const c = (e as { code?: unknown }).code;
    return typeof c === "number" ? c : undefined;
  }
  return undefined;
}

function fmtCountdown(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(h)}:${pad(m)}:${pad(sec)}`;
}

type MineState = {
  current: bigint;
  best: bigint;
  lifetime: bigint;
  canDraw: boolean;
  canReroll: boolean;
  drawnToday: boolean;
  drawnItem: number;
  counts: bigint[]; // live ingredient counts 0..6
  distinct: bigint;
  dishCounts: number[]; // live counts for kinds 1..3
  goldenIds: bigint[];
  badges: boolean[];
  passes: bigint;
  founderNumber: bigint;
  perks: boolean;
};

type Stats = {
  players: bigint;
  total: bigint;
  goldenCooked: bigint;
  goldenServed: bigint;
  passesSold: bigint;
  pool: bigint;
  payout: bigint;
};

export default function App() {
  const [account, setAccount] = useState<Address | null>(null);
  const [holder, setHolder] = useState<boolean | null>(null);
  const [handle, setHandle] = useState<string>("");
  const [busy, setBusy] = useState<string>("");
  const [error, setError] = useState<string>("");

  const [nowMs, setNowMs] = useState<number>(Date.now());
  const today = utcDayNow();
  const nextMidnightMs = (today + 1) * 86400 * 1000;
  const countdown = fmtCountdown(nextMidnightMs - nowMs);

  const [stats, setStats] = useState<Stats | null>(null);
  const [mine, setMine] = useState<MineState | null>(null);
  const [mineLoading, setMineLoading] = useState(false);
  const [mineError, setMineError] = useState(false);
  const [founders, setFounders] = useState<string[]>([]);
  const [chefs, setChefs] = useState<string[]>([]);

  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const walletClient = useMemo(() => {
    if (!window.ethereum) return null;
    return createWalletClient({ chain: CHAIN, transport: custom(window.ethereum) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account]);

  const read = useCallback(
    (functionName: string, args?: readonly unknown[]) =>
      publicClient.readContract({
        address: RAMENFORGE_ADDRESS,
        abi: ramenForgeAbi,
        functionName: functionName as never,
        args: args as never,
      }) as Promise<never>,
    []
  );

  const loadStats = useCallback(async () => {
    if (!DEPLOYED) return;
    try {
      const [players, total, goldenCooked, goldenServed, passesSold, pool, payout] =
        await Promise.all([
          read("playersCount"),
          read("totalMinted"),
          read("goldenCooked"),
          read("goldenServed"),
          read("passesSold"),
          read("rewardPool"),
          read("currentServePayout"),
        ]);
      setStats({ players, total, goldenCooked, goldenServed, passesSold, pool, payout });
      const [f, c] = await Promise.all([read("getFounders", [0n, 100n]), read("getGoldenChefs", [0n, 100n])]);
      setFounders(f as string[]);
      setChefs(c as string[]);
    } catch {
      /* stats are decorative; ignore failures */
    }
  }, [read]);

  const loadMine = useCallback(
    async (me: Address) => {
      setMineLoading(true);
      setMineError(false);
      try {
        const bal = await publicClient.readContract({
          address: AGENT_ID_REGISTRY,
          abi: registryAbi,
          functionName: "balanceOf",
          args: [me],
        });
        setHolder(bal > 0n);
        if (bal > 0n) {
          try {
            const h = await publicClient.readContract({
              address: AGENT_ID_REGISTRY,
              abi: registryAbi,
              functionName: "handleOf",
              args: [me],
            });
            setHandle(h);
          } catch {
            setHandle("");
          }
        } else {
          setHandle("");
        }
        if (!DEPLOYED) {
          setMine(null);
          return;
        }
        const [streakRes, canDraw, canReroll, todayRes, distinct, passes, founderNumber, perks] =
          await Promise.all([
            read("streakOf", [me]),
            read("canDrawToday", [me]),
            read("canReroll", [me]),
            read("todaysTokenOf", [me]),
            read("distinctIngredientsOf", [me]),
            read("passCountOf", [me]),
            read("founderNumberOf", [me]),
            read("hasFounderPerks", [me]),
          ]);
        const counts: bigint[] = [];
        for (let i = 0; i < INGREDIENTS.length; i++) {
          counts.push(await read("ingredientCount", [me, i]));
        }
        const dishCounts: number[] = [];
        const goldenIds: bigint[] = [];
        for (const d of DISHES) {
          const ids = (await read("dishTokenIds", [me, d.kind])) as bigint[];
          dishCounts.push(ids.length);
          if (d.kind === 3) goldenIds.push(...ids);
        }
        const badges: boolean[] = [];
        for (const t of BADGE_TIERS) {
          badges.push(await read("badgeClaimed", [me, t.tier]));
        }
        const s = streakRes as [bigint, bigint, bigint];
        const tt = todayRes as [bigint, number, boolean];
        setMine({
          current: s[0],
          best: s[1],
          lifetime: s[2],
          canDraw: canDraw as boolean,
          canReroll: canReroll as boolean,
          drawnToday: tt[2],
          drawnItem: Number(tt[1]),
          counts,
          distinct: distinct as bigint,
          dishCounts,
          goldenIds,
          badges,
          passes: passes as bigint,
          founderNumber: founderNumber as bigint,
          perks: perks as boolean,
        });
      } catch {
        setMineError(true);
      } finally {
        setMineLoading(false);
      }
    },
    [read]
  );

  useEffect(() => {
    loadStats();
  }, [loadStats]);

  useEffect(() => {
    const eth = window.ethereum;
    if (!eth?.on) return;
    const onAccountsChanged = (...args: unknown[]) => {
      const accounts = Array.isArray(args[0]) ? (args[0] as string[]) : [];
      if (accounts.length === 0) {
        setAccount(null);
        setHolder(null);
        setHandle("");
        setMine(null);
      } else {
        const me = accounts[0] as Address;
        setAccount(me);
        loadMine(me);
      }
    };
    const onChainChanged = (...args: unknown[]) => {
      if (args[0] !== "0x38") {
        setError("You switched away from BNB Chain — switch back to BNB Chain (56) to play.");
      } else {
        setError("");
        loadStats();
        if (account) loadMine(account);
      }
    };
    eth.on("accountsChanged", onAccountsChanged);
    eth.on("chainChanged", onChainChanged);
    return () => {
      eth.removeListener?.("accountsChanged", onAccountsChanged);
      eth.removeListener?.("chainChanged", onChainChanged);
    };
  }, [loadMine, loadStats, account]);

  async function connect() {
    setError("");
    if (!window.ethereum) {
      setError("No injected wallet found. Open this page in MetaMask or the Binance Wallet browser.");
      return;
    }
    try {
      const accounts = (await window.ethereum.request({ method: "eth_requestAccounts" })) as string[];
      const chainId = (await window.ethereum.request({ method: "eth_chainId" })) as string;
      if (chainId !== "0x38") {
        try {
          await window.ethereum.request({
            method: "wallet_switchEthereumChain",
            params: [{ chainId: "0x38" }],
          });
        } catch {
          setError("Please switch to BNB Chain (56) in your wallet — RamenForge only works on BNB Chain.");
          return;
        }
      }
      const me = accounts[0] as Address;
      setAccount(me);
      await loadMine(me);
    } catch (e) {
      if (errorCode(e) === 4001) {
        setError("Connection request was rejected in your wallet — nothing was connected.");
      } else {
        setError(e instanceof Error ? e.message : "Connection failed");
      }
    }
  }

  async function write(key: string, functionName: string, args: unknown[], value?: bigint): Promise<boolean> {
    if (!walletClient || !account) return false;
    setBusy(key);
    setError("");
    try {
      const hash = await walletClient.writeContract({
        address: RAMENFORGE_ADDRESS,
        abi: ramenForgeAbi,
        functionName: functionName as never,
        args: args as never,
        value,
        account,
        chain: CHAIN,
      });
      await publicClient.waitForTransactionReceipt({ hash });
      await loadMine(account);
      await loadStats();
      return true;
    } catch (e) {
      if (errorCode(e) === 4001) {
        setError("Transaction was rejected in your wallet — nothing was sent.");
      } else {
        setError(e instanceof Error ? e.message : "Transaction failed");
      }
      return false;
    } finally {
      setBusy("");
    }
  }

  async function cook(stage: "ramen" | "deluxe" | "golden") {
    if (!account) return;
    if (stage === "ramen") {
      const [ids, ready] = (await read("ramenCookIds", [account])) as [readonly bigint[], boolean];
      if (!ready) return setError("You don't hold all 4 uncommon ingredients yet.");
      await write("cookRamen", "cookRamen", [[...ids]]);
    } else if (stage === "deluxe") {
      const [ramenId, rareIds, ready] = (await read("deluxeCookIds", [account])) as [
        bigint,
        readonly bigint[],
        boolean,
      ];
      if (!ready) return setError("You need a Ramen plus both rare ingredients.");
      await write("cookDeluxe", "cookDeluxe", [ramenId, [...rareIds]]);
    } else {
      const [deluxeId, wagyuId, ready] = (await read("goldenCookIds", [account])) as [bigint, bigint, boolean];
      if (!ready) return setError("You need a Deluxe Ramen plus a Wagyu Slice (and the Golden cap isn't reached).");
      await write("cookGolden", "cookGolden", [deluxeId, wagyuId]);
    }
  }

  const drawDisabledReason = !DEPLOYED
    ? "The forge lights when the RamenForge contract is deployed."
    : !account
      ? "Connect your wallet to draw today's ingredient."
      : holder === false
        ? "This wallet holds no Agent ID — only Agent ID holders can draw."
        : mineLoading
          ? "Checking your kitchen…"
          : mine && !mine.canDraw
            ? "You've already drawn today's ingredient."
            : "";

  return (
    <div className="page">
      <header>
        <h1>RamenForge</h1>
        <p className="tagline">
          Draw one free ingredient a day. Trade what you don't need. Cook Ramen, then Deluxe
          Ramen, then one of only <strong>100 Golden Ramen</strong> — and serve it for a trophy
          plus a share of the reward pool.
        </p>
        {!account ? (
          <button onClick={connect}>Connect wallet</button>
        ) : (
          <p className="meta">Connected: {short(account)} (BNB Chain)</p>
        )}
        {error && <p className="error">{error}</p>}
        {stats && (
          <p className="meta">
            {stats.players.toString()} players · {stats.goldenCooked.toString()}/{GOLDEN_CAP} Golden
            cooked · {stats.goldenServed.toString()} served · pool{" "}
            {Number(formatEther(stats.pool)).toFixed(4)} BNB
          </p>
        )}
      </header>

      {!DEPLOYED && (
        <section>
          <div className="card warn">
            <p>
              <strong>Pre-deployment build:</strong> RamenForge is fully built and tested but{" "}
              <strong>not deployed yet</strong> — deployment is a separate step. Everything below
              shows the real game design; drawing, cooking and the pass sale activate at launch.
            </p>
          </div>
        </section>
      )}

      <section>
        <h2>Today's draw</h2>
        <div className="card fest">
          <p>
            One free ingredient per UTC day, drawn at random when you mint. Duplicates aren't
            wasted — they're trade stock. Next draw in{" "}
            <span className="countdown">{countdown}</span>.
          </p>
          <div className="shelf">
            {INGREDIENTS.map((ing) => (
              <div className="shelf-cell" key={ing.slug}>
                <img src={artImage(ing.slug)} alt={ing.name} />
                <div className="dish-label">{ing.name}</div>
                <div className="dish-day">
                  {ing.rarity} · {ing.weight}%
                </div>
              </div>
            ))}
          </div>
          {account && mine?.drawnToday && (
            <p className="field-ok">
              Today's draw: <strong>{INGREDIENTS[mine.drawnItem].name}</strong> ✓
              {mine.canReroll ? " — Founder perk ready: you can reroll it once." : ""}
            </p>
          )}
          <div className="row">
            <button
              disabled={drawDisabledReason !== "" || busy !== ""}
              onClick={() => write("mintDaily", "mintDaily", [])}
            >
              {busy === "mintDaily" ? "Confirm in your wallet…" : "Draw today's ingredient — free"}
            </button>
            {account && mine?.canReroll && (
              <button disabled={busy !== ""} onClick={() => write("reroll", "reroll", [])}>
                {busy === "reroll" ? "Confirm in your wallet…" : "Reroll (Founder perk)"}
              </button>
            )}
          </div>
          {drawDisabledReason && <p className="meta">{drawDisabledReason}</p>}
        </div>
      </section>

      <section>
        <h2>Your kitchen</h2>
        {!account ? (
          <div className="card placeholder">
            <p>Connect your wallet to see your ingredients, dishes, streak and badges.</p>
            <p className="meta">
              Your Agent ID status is verified against the SPACE ID Agent ID registry (
              {short(AGENT_ID_REGISTRY)}) — only holders can draw and cook.
            </p>
          </div>
        ) : mineError && holder === null ? (
          <div className="card warn">
            <p className="error">Couldn't check your Agent ID status.</p>
            <button onClick={() => account && loadMine(account)}>Retry</button>
          </div>
        ) : holder === null ? (
          <p>Checking…</p>
        ) : !holder ? (
          <div className="card">
            <p>This wallet holds no Agent ID yet.</p>
            <p className="meta">
              Agent IDs can only be claimed inside the Binance App: Wallet → homepage banner →
              Agent ID. Come back with the same wallet once you have one. (You can still buy a
              Founder Chef Pass or trade ingredients without one.)
            </p>
          </div>
        ) : !DEPLOYED ? (
          <div className="card placeholder">
            <p>
              Agent ID holder ✓{handle ? <> — <strong>{handle}.ai</strong></> : null}
            </p>
            <p className="meta">Your kitchen opens at deployment. The full menu is above.</p>
          </div>
        ) : mineLoading && !mine ? (
          <p className="meta">Loading your kitchen…</p>
        ) : mine ? (
          <div className="card">
            <div className="row">
              <span className="badge hot">Streak: {mine.current.toString()} days</span>
              <span className="badge">Best: {mine.best.toString()}</span>
              <span className="badge">Days drawn: {mine.lifetime.toString()}</span>
              <span className="badge">Shelf: {mine.distinct.toString()}/7 ingredients ever</span>
              {mine.passes > 0n && (
                <span className="badge t3">
                  Founder Chef #{mine.founderNumber.toString()} · {mine.passes.toString()} pass
                  {mine.passes > 1n ? "es" : ""}
                </span>
              )}
            </div>
            <div className="shelf">
              {INGREDIENTS.map((ing, i) => (
                <div className={`shelf-cell ${mine.counts[i] === 0n ? "missing" : ""}`} key={ing.slug}>
                  <img src={artImage(ing.slug)} alt={ing.name} />
                  <div className="dish-label">{ing.name}</div>
                  <div className="dish-day">× {mine.counts[i].toString()}</div>
                </div>
              ))}
            </div>
            <p className="meta">
              Cooked and held: {mine.dishCounts[0]} Ramen · {mine.dishCounts[1]} Deluxe Ramen ·{" "}
              {mine.dishCounts[2]} Golden Ramen
            </p>
            <div className="badge-grid">
              {BADGE_TIERS.map((t, i) => {
                const claimed = mine.badges[i];
                const qualified = mine.best >= BigInt(t.required);
                return (
                  <div className={`badge-cell ${claimed || qualified ? "" : "locked"}`} key={t.tier}>
                    <img src={artImage(t.slug)} alt={`${t.name} Feast Badge`} />
                    <div className="badge-name">{t.name} Feast Badge</div>
                    <div className="badge-req">Best streak {t.required}+</div>
                    {claimed ? (
                      <p className="field-ok">Claimed ✓</p>
                    ) : qualified ? (
                      <button
                        disabled={busy !== ""}
                        onClick={() => write(`claimBadge${t.tier}`, "claimBadge", [t.tier])}
                      >
                        {busy === `claimBadge${t.tier}` ? "Confirm in your wallet…" : "Claim badge"}
                      </button>
                    ) : (
                      <p className="meta">
                        {mine.best.toString()} / {t.required} days
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}
      </section>

      <section>
        <h2>Recipe Book — the forge</h2>
        <div className="card">
          <p>
            Cooking <strong>burns</strong> the ingredients. Your streak, badges and lifetime
            shelf are never touched by cooking.
          </p>
          <div className="badge-grid">
            <div className="badge-cell">
              <img src={artImage("ramen")} alt="Ramen" />
              <div className="badge-name">Stage 1 · Ramen</div>
              <div className="badge-req">Noodles + Broth + Scallion + Nori</div>
              <button disabled={!DEPLOYED || !account || busy !== ""} onClick={() => cook("ramen")}>
                Cook Ramen
              </button>
            </div>
            <div className="badge-cell">
              <img src={artImage("ramen-deluxe")} alt="Deluxe Ramen" />
              <div className="badge-name">Stage 2 · Deluxe Ramen</div>
              <div className="badge-req">Ramen + Chashu Pork + Ajitama Egg</div>
              <button disabled={!DEPLOYED || !account || busy !== ""} onClick={() => cook("deluxe")}>
                Cook Deluxe
              </button>
            </div>
            <div className="badge-cell">
              <img src={artImage("ramen-golden")} alt="Golden Ramen" />
              <div className="badge-name">Stage 3 · Golden Ramen</div>
              <div className="badge-req">Deluxe Ramen + Wagyu Slice · cap {GOLDEN_CAP}</div>
              <button disabled={!DEPLOYED || !account || busy !== ""} onClick={() => cook("golden")}>
                Cook Golden
              </button>
            </div>
          </div>
          <p className="meta">
            Recipes are enforced on-chain — the contract checks every token you pass. Golden
            Ramen are numbered #1–#{GOLDEN_CAP}; when #100 is cooked, the forge closes for
            Season 1.
          </p>
        </div>
      </section>

      <section>
        <h2>Serve a Golden Ramen</h2>
        <div className="card fest">
          <p>
            Serving burns your Golden Ramen forever and mints a soulbound{" "}
            <strong>Golden Chef Trophy</strong>. It also pays from the reward pool:{" "}
            <strong>
              {stats ? `${Number(formatEther(stats.payout)).toFixed(4)} BNB` : `up to ${MAX_SERVE_PAYOUT_BNB} BNB`}
            </strong>{" "}
            per serve right now (pool ÷ remaining serves, capped at {MAX_SERVE_PAYOUT_BNB} BNB).
            Or sell the Golden instead — your call, chef.
          </p>
          {account && mine && mine.goldenIds.length > 0 ? (
            <div>
              {mine.goldenIds.map((id) => (
                <div className="row" key={id.toString()}>
                  <span className="badge t3">Golden Ramen (token #{id.toString()})</span>
                  <button disabled={busy !== ""} onClick={() => write(`serve${id}`, "serve", [id])}>
                    {busy === `serve${id}` ? "Confirm in your wallet…" : "Serve it"}
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className="meta">You hold no Golden Ramen yet. Cook one — or buy one on the market.</p>
          )}
        </div>
      </section>

      <section>
        <h2>Founder Chef Pass</h2>
        <div className="card">
          <div className="mint-dish">
            <img src={artImage("founder-pass")} alt="Founder Chef Pass" />
            <div>
              <p className="title">
                {PASS_PRICE_BNB} BNB · {stats ? `${stats.passesSold.toString()} / ` : ""}
                {PASS_SUPPLY} passes
              </p>
              <p className="meta">
                <strong>100% of every sale goes into the serve reward pool</strong> — no dev cut,
                and pool funds can only ever leave as serve payouts (the contract has no
                withdrawal function at all).
              </p>
              <p className="meta">
                Perks while you hold the pass (they follow the pass, never stack): one{" "}
                <strong>daily reroll</strong> of today's ingredient, a soulbound numbered
                Founder Chef Badge, Hall of Fame listing, and the Season 2 head-start
                entitlement. The pass is tradeable; the badge is yours forever.
              </p>
            </div>
          </div>
          {stats && (
            <p className="meta">
              Reward pool now: {Number(formatEther(stats.pool)).toFixed(4)} BNB · next serve
              pays: {Number(formatEther(stats.payout)).toFixed(4)} BNB
            </p>
          )}
          <button
            disabled={!DEPLOYED || !account || busy !== ""}
            onClick={() => write("buyPass", "buyPass", [], parseEther(PASS_PRICE_BNB))}
          >
            {busy === "buyPass" ? "Confirm in your wallet…" : `Buy Founder Chef Pass — ${PASS_PRICE_BNB} BNB`}
          </button>
          {!DEPLOYED && <p className="meta">Pass sales open at deployment.</p>}
        </div>
      </section>

      <section>
        <h2>Market — trade ingredients</h2>
        <div className="card">
          <p>
            Every ingredient, dish and pass is a standard ERC-721 with 5% ERC-2981 royalties
            (royalties flow into the reward pool). Missing a Wagyu Slice? Buy it. Three spare
            Nori? Sell them.
          </p>
          <div className="badge-grid">
            <div className="badge-cell">
              <div className="badge-name">Element</div>
              <div className="badge-req">Primary market · BSC-native · floor: —</div>
              <a href={ELEMENT_URL} target="_blank" rel="noreferrer">
                <button>Open Element</button>
              </a>
            </div>
            <div className="badge-cell">
              <div className="badge-name">OpenSea</div>
              <div className="badge-req">Secondary market · floor: —</div>
              <a href={OPENSEA_URL} target="_blank" rel="noreferrer">
                <button>Open OpenSea</button>
              </a>
            </div>
          </div>
          <p className="meta">
            The collection is live on both marketplaces and auto-indexed from the contract —
            floor prices appear here once the first listings land.
          </p>
        </div>
      </section>

      <section>
        <h2>Hall of Fame</h2>
        <div className="card">
          <p className="title">Golden Chefs (served a Golden Ramen)</p>
          {!DEPLOYED ? (
            <p className="meta">The first Golden Chef gets carved here at launch.</p>
          ) : chefs.length === 0 ? (
            <p className="meta">No Golden Ramen served yet — the first serve makes history.</p>
          ) : (
            chefs.map((c, i) => (
              <div className="lb-row" key={`chef-${i}`}>
                <span className="lb-rank">#{i + 1}</span>
                <span className="lb-addr">{short(c)}</span>
                {account && c.toLowerCase() === account.toLowerCase() && <span className="badge hot">you</span>}
              </div>
            ))
          )}
          <p className="title">Founders (Founder Chef Pass buyers)</p>
          {!DEPLOYED ? (
            <p className="meta">500 founder slots. Numbered in purchase order, forever.</p>
          ) : founders.length === 0 ? (
            <p className="meta">No founders yet.</p>
          ) : (
            founders.map((f, i) => (
              <div className="lb-row" key={`founder-${i}`}>
                <span className="lb-rank">#{i + 1}</span>
                <span className="lb-addr">{short(f)}</span>
                {account && f.toLowerCase() === account.toLowerCase() && <span className="badge hot">you</span>}
              </div>
            ))
          )}
        </div>
      </section>

      <section>
        <h2>Play RamenForge through your agent</h2>
        <div className="card fest">
          <p>
            <strong>The agent-first way to play.</strong> If you run an agent with the Binance
            Agentic Wallet (<code>baw</code>), give it the RamenForge skill: it draws your daily
            ingredient, rerolls with your pass, cooks and serves — preview-first through your
            own paired wallet, and you confirm in your Binance App.
          </p>
          <p className="meta">
            Machine-readable manifest: <a href="/agent.json">/agent.json</a> · Example
            instruction: <em>"Draw my RamenForge ingredient, reroll it if it's a duplicate, and
            cook anything I'm ready to cook."</em>
          </p>
          <p className="meta">
            Every agent write is two-phase: a <code>baw</code> preview (a simulation — nothing
            is broadcast) that you approve before any execute. Cooking burns tokens and serving
            burns your Golden — the agent always shows you exactly what will burn first.
          </p>
        </div>
      </section>

      <footer>
        <p className="meta">
          Honest print: drawing and cooking are free (BNB Chain gas only). The Founder Chef
          Pass costs {PASS_PRICE_BNB} BNB and 100% of it funds the serve reward pool; serve
          payouts come only from that pool and shrink if fewer passes sell — nothing here
          promises returns or profit. Ingredients and dishes are collectibles with a game
          attached, not investments. Badges and trophies are soulbound. The contract has no
          owner, no admin keys and no withdrawal function.
        </p>
        <p className="meta">
          Agent ID registry: {AGENT_ID_REGISTRY} · RamenForge contract:{" "}
          {DEPLOYED ? RAMENFORGE_ADDRESS : "not deployed yet (deployment is a separate, approved step)"}
        </p>
      </footer>
    </div>
  );
}
