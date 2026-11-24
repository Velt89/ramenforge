const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

const DAY = 86400;
const PASS_PRICE = ethers.parseEther("0.005");

// Token kinds (mirror the contract)
const K_ING = 0, K_RAMEN = 1, K_DELUXE = 2, K_GOLDEN = 3, K_BADGE = 4, K_TROPHY = 5, K_PASS = 6, K_FOUNDER = 7;
// Ingredients: 0 Noodles, 1 Broth, 2 Scallion, 3 Nori, 4 Chashu, 5 Ajitama, 6 Wagyu

async function deploy() {
  // Pin chain time to 01:00 UTC of the next day boundary so tests never
  // straddle a UTC midnight (which would legitimately change "today").
  const latest = await time.latest();
  await time.setNextBlockTimestamp((Math.floor(latest / DAY) + 1) * DAY + 3600);
  const [owner, alice, bob, carol, dave, market] = await ethers.getSigners();
  const Mock = await ethers.getContractFactory("MockAgentID");
  const mock = await Mock.deploy();
  const RF = await ethers.getContractFactory("RamenForge");
  const rf = await RF.deploy(await mock.getAddress());
  for (const u of [alice, bob, carol]) await mock.setHolder(u.address, true);
  // dave: no Agent ID. owner: not a holder either (used as funder/buyer).
  return { rf, mock, owner, alice, bob, carol, dave, market };
}

async function draw(rf, user) {
  const tx = await rf.connect(user).mintDaily();
  const rc = await tx.wait();
  for (const log of rc.logs) {
    try {
      const p = rf.interface.parseLog(log);
      if (p && p.name === "IngredientDrawn") {
        return { ingredient: Number(p.args.ingredient), tokenId: p.args.tokenId, streak: p.args.streak };
      }
    } catch { /* not ours */ }
  }
  throw new Error("no IngredientDrawn event");
}

async function nextDay() {
  await time.increase(DAY);
}

/** Draw once per day until `ready(user)` (live-holdings predicate) is true. */
async function drawUntil(rf, user, ready, maxDays = 500) {
  for (let d = 0; d < maxDays; d++) {
    if (await ready(user)) return;
    await nextDay();
    await draw(rf, user);
  }
  if (!(await ready(user))) throw new Error("drawUntil: predicate not reached");
}

async function count(rf, user, item) {
  return Number(await rf.ingredientCount(user.address, item));
}

async function hasFullSet(rf, user) {
  for (let i = 0; i < 7; i++) if ((await count(rf, user, i)) < 1) return false;
  return true;
}

/** Cook one Golden for `user` from scratch (draws across days as needed). */
async function cookOneGolden(rf, user) {
  await drawUntil(rf, user, (u) => hasFullSet(rf, u), 600);
  const [ramenIds, ramenReady] = await rf.ramenCookIds(user.address);
  expect(ramenReady).to.equal(true);
  await rf.connect(user).cookRamen([...ramenIds]);
  const [ramenId, rareIds, deluxeReady] = await rf.deluxeCookIds(user.address);
  expect(deluxeReady).to.equal(true);
  await rf.connect(user).cookDeluxe(ramenId, [...rareIds]);
  const [deluxeId, wagyuId, goldenReady] = await rf.goldenCookIds(user.address);
  expect(goldenReady).to.equal(true);
  const tx = await rf.connect(user).cookGolden(deluxeId, wagyuId);
  const rc = await tx.wait();
  for (const log of rc.logs) {
    try {
      const p = rf.interface.parseLog(log);
      if (p && p.name === "Cooked") return { tokenId: p.args.newTokenId, serial: Number(p.args.serial) };
    } catch { /* ignore */ }
  }
  throw new Error("no Cooked event");
}

describe("RamenForge", function () {
  describe("Agent ID gating + daily draw", function () {
    it("rejects non-holders, accepts holders", async function () {
      const { rf, dave, alice } = await deploy();
      await expect(rf.connect(dave).mintDaily()).to.be.revertedWith("sender holds no Agent ID");
      expect(await rf.hasAgentId(alice.address)).to.equal(true);
      expect(await rf.hasAgentId(dave.address)).to.equal(false);
      const { tokenId, ingredient } = await draw(rf, alice);
      expect(await rf.ownerOf(tokenId)).to.equal(alice.address);
      expect(await rf.tokenKind(tokenId)).to.equal(K_ING);
      expect(ingredient).to.be.within(0, 6);
    });

    it("allows only one draw per UTC day", async function () {
      const { rf, alice } = await deploy();
      await draw(rf, alice);
      await expect(rf.connect(alice).mintDaily()).to.be.revertedWith("Already drawn today");
      expect(await rf.canDrawToday(alice.address)).to.equal(false);
      await nextDay();
      expect(await rf.canDrawToday(alice.address)).to.equal(true);
      await draw(rf, alice);
    });

    it("tracks streaks and resets after a skipped day", async function () {
      const { rf, alice } = await deploy();
      await draw(rf, alice);
      await nextDay(); await draw(rf, alice);
      await nextDay(); const d3 = await draw(rf, alice);
      expect(d3.streak).to.equal(3n);
      let [cur, best, life] = await rf.streakOf(alice.address);
      expect([cur, best, life]).to.deep.equal([3n, 3n, 3n]);
      await nextDay(); await nextDay(); // skip a day
      const d = await draw(rf, alice);
      expect(d.streak).to.equal(1n);
      [cur, best, life] = await rf.streakOf(alice.address);
      expect([cur, best, life]).to.deep.equal([1n, 3n, 4n]);
    });
  });

  describe("draw distribution (weights 19/19/19/19/9/9/6)", function () {
    it("roughly matches the settled weights over 300 draws", async function () {
      const { rf, alice } = await deploy();
      const tally = [0, 0, 0, 0, 0, 0, 0];
      for (let i = 0; i < 300; i++) {
        if (i > 0) await nextDay();
        const { ingredient } = await draw(rf, alice);
        tally[ingredient]++;
      }
      const uncommon = tally[0] + tally[1] + tally[2] + tally[3];
      const rare = tally[4] + tally[5];
      const epic = tally[6];
      // Loose sanity bands (means: uncommon 228, rare 54, epic 18).
      expect(uncommon).to.be.within(180, 276);
      expect(rare).to.be.within(28, 85);
      expect(epic).to.be.within(4, 40);
      for (let i = 0; i < 4; i++) expect(tally[i]).to.be.greaterThan(30);
      expect(tally[4]).to.be.greaterThan(8);
      expect(tally[5]).to.be.greaterThan(8);
    }).timeout(300000);
  });

  describe("Feast badges", function () {
    it("claims off BEST streak and stays soulbound", async function () {
      const { rf, alice, bob } = await deploy();
      await draw(rf, alice);
      await nextDay(); await draw(rf, alice);
      await expect(rf.connect(alice).claimBadge(1)).to.be.revertedWith("streak too short for this badge");
      await nextDay(); await draw(rf, alice); // best streak 3
      const tx = await rf.connect(alice).claimBadge(1);
      const rc = await tx.wait();
      let badgeId;
      for (const log of rc.logs) {
        try { const p = rf.interface.parseLog(log); if (p && p.name === "BadgeClaimed") badgeId = p.args.tokenId; } catch {}
      }
      expect(await rf.tokenKind(badgeId)).to.equal(K_BADGE);
      expect(await rf.badgeClaimed(alice.address, 1)).to.equal(true);
      await expect(rf.connect(alice).claimBadge(1)).to.be.revertedWith("badge already claimed");
      await expect(rf.connect(alice).claimBadge(2)).to.be.revertedWith("streak too short for this badge");
      await expect(rf.connect(alice).transferFrom(alice.address, bob.address, badgeId))
        .to.be.revertedWith("RamenForge: this token is soulbound");
      await expect(rf.connect(alice).approve(bob.address, badgeId))
        .to.be.revertedWith("RamenForge: this token is soulbound");
    });
  });

  describe("cooking", function () {
    it("cooks Ramen from the 4 uncommons and burns the inputs", async function () {
      const { rf, alice } = await deploy();
      await drawUntil(rf, alice, async (u) => {
        for (let i = 0; i < 4; i++) if ((await count(rf, u, i)) < 1) return false;
        return true;
      });
      const [ids, ready] = await rf.ramenCookIds(alice.address);
      expect(ready).to.equal(true);
      const distinctBefore = await rf.distinctIngredientsOf(alice.address);
      const tx = await rf.connect(alice).cookRamen([...ids]);
      const rc = await tx.wait();
      let ramenId;
      for (const log of rc.logs) {
        try { const p = rf.interface.parseLog(log); if (p && p.name === "Cooked") ramenId = p.args.newTokenId; } catch {}
      }
      expect(await rf.tokenKind(ramenId)).to.equal(K_RAMEN);
      for (const id of ids) {
        expect(await rf.isBurned(id)).to.equal(true);
        await expect(rf.ownerOf(id)).to.be.revertedWith("token does not exist");
      }
      // Lifetime shelf never shrinks.
      expect(await rf.distinctIngredientsOf(alice.address)).to.equal(distinctBefore);
      for (let i = 0; i < 4; i++) expect(await rf.hasIngredient(alice.address, i)).to.equal(true);
      expect(await rf.everHadDish(alice.address, K_RAMEN)).to.equal(true);
      expect((await rf.dishTokenIds(alice.address, K_RAMEN)).length).to.equal(1);
    });

    it("rejects wrong ingredient sets for Ramen", async function () {
      const { rf, alice, bob } = await deploy();
      // Collect >=2 of one uncommon and >=1 of two others, but miss the 4th:
      // simpler: collect any 5 ingredients and try invalid combos directly.
      await drawUntil(rf, alice, async (u) => (await rf.balanceOf(u.address)) >= 6n);
      const all = [];
      for (let i = 0; i < 7; i++) for (const id of await rf.ingredientTokenIds(alice.address, i)) all.push({ id, item: i });
      expect(all.length).to.be.greaterThanOrEqual(6);
      // duplicate token id
      await expect(rf.connect(alice).cookRamen([all[0].id, all[0].id, all[1].id, all[2].id]))
        .to.be.revertedWith("token ids must be distinct");
      // a rare/epic in the mix (if drawn) or a non-uncommon set
      const nonUncommon = all.find((x) => x.item >= 4);
      if (nonUncommon) {
        const others = all.filter((x) => x.id !== nonUncommon.id).slice(0, 3);
        await expect(rf.connect(alice).cookRamen([nonUncommon.id, others[0].id, others[1].id, others[2].id]))
          .to.be.revertedWith("Ramen needs uncommon ingredients only");
      }
      // someone else's token
      await draw(rf, bob);
      const [, bobTok] = await rf.todaysTokenOf(bob.address);
      const bobIds = await rf.ingredientTokenIds(bob.address, Number(bobTok));
      const mine = all.slice(0, 3).map((x) => x.id);
      await expect(rf.connect(alice).cookRamen([bobIds[0], mine[0], mine[1], mine[2]]))
        .to.be.revertedWith("not your token");
    });

    it("rejects cooking for non-holders even with valid ingredients", async function () {
      const { rf, alice, dave } = await deploy();
      await drawUntil(rf, alice, async (u) => {
        for (let i = 0; i < 4; i++) if ((await count(rf, u, i)) < 1) return false;
        return true;
      });
      const [ids] = await rf.ramenCookIds(alice.address);
      for (const id of ids) await rf.connect(alice).transferFrom(alice.address, dave.address, id);
      const daveIds = [];
      for (let i = 0; i < 4; i++) daveIds.push((await rf.ingredientTokenIds(dave.address, i))[0]);
      await expect(rf.connect(dave).cookRamen(daveIds)).to.be.revertedWith("sender holds no Agent ID");
    });

    it("cooks Deluxe from Ramen + both rares, rejecting duplicates/wrong rares", async function () {
      const { rf, alice } = await deploy();
      await drawUntil(rf, alice, (u) => hasFullSet(rf, u), 600);
      const [ramenIds] = await rf.ramenCookIds(alice.address);
      await rf.connect(alice).cookRamen([...ramenIds]);
      const [ramenId, rareIds, ready] = await rf.deluxeCookIds(alice.address);
      expect(ready).to.equal(true);
      // duplicate rare id reverts
      await expect(rf.connect(alice).cookDeluxe(ramenId, [rareIds[0], rareIds[0]]))
        .to.be.revertedWith("token ids must be distinct");
      const tx = await rf.connect(alice).cookDeluxe(ramenId, [...rareIds]);
      const rc = await tx.wait();
      let deluxeId;
      for (const log of rc.logs) {
        try { const p = rf.interface.parseLog(log); if (p && p.name === "Cooked") deluxeId = p.args.newTokenId; } catch {}
      }
      expect(await rf.tokenKind(deluxeId)).to.equal(K_DELUXE);
      expect(await rf.isBurned(ramenId)).to.equal(true);
    });

    it("cooks a numbered Golden from Deluxe + Wagyu", async function () {
      const { rf, alice } = await deploy();
      const g = await cookOneGolden(rf, alice);
      expect(g.serial).to.equal(1);
      expect(await rf.tokenKind(g.tokenId)).to.equal(K_GOLDEN);
      expect(await rf.tokenSerial(g.tokenId)).to.equal(1);
      expect(await rf.goldenCooked()).to.equal(1n);
      const uri = await rf.tokenURI(g.tokenId);
      const json = JSON.parse(Buffer.from(uri.split(",")[1], "base64").toString());
      expect(json.name).to.include("Golden Ramen #1");
    }).timeout(300000);
  });

  describe("Golden cap (100)", function () {
    it("cooks exactly 100 Golden Ramen and then reverts", async function () {
      const { rf, alice } = await deploy();
      let days = 0;
      while ((await rf.goldenCooked()) < 100n && days < 6000) {
        await nextDay();
        await draw(rf, alice);
        days++;
        for (;;) {
          const [dId, wId, gReady] = await rf.goldenCookIds(alice.address);
          if (gReady) { await rf.connect(alice).cookGolden(dId, wId); continue; }
          const [rId, rareIds, dReady] = await rf.deluxeCookIds(alice.address);
          if (dReady) { await rf.connect(alice).cookDeluxe(rId, [...rareIds]); continue; }
          const [ids, rReady] = await rf.ramenCookIds(alice.address);
          if (rReady) { await rf.connect(alice).cookRamen([...ids]); continue; }
          break;
        }
      }
      expect(await rf.goldenCooked()).to.equal(100n);
      // Build one more full set (ingredients still draw fine) and try to cook #101.
      await drawUntil(rf, alice, async (u) => {
        const w = await count(rf, u, 6);
        const d = (await rf.dishTokenIds(u.address, K_DELUXE)).length;
        return w >= 1 && d >= 1;
      }, 3000);
      const deluxeId = (await rf.dishTokenIds(alice.address, K_DELUXE))[0];
      const wagyuId = (await rf.ingredientTokenIds(alice.address, 6))[0];
      await expect(rf.connect(alice).cookGolden(deluxeId, wagyuId))
        .to.be.revertedWith("Golden Ramen cap reached (100)");
      expect(await rf.goldenCooked()).to.equal(100n);
    }).timeout(900000);
  });

  describe("trading (ERC-721)", function () {
    it("transfers ingredients freely, incl. to non-holders", async function () {
      const { rf, alice, dave } = await deploy();
      const { tokenId } = await draw(rf, alice);
      await rf.connect(alice).transferFrom(alice.address, dave.address, tokenId);
      expect(await rf.ownerOf(tokenId)).to.equal(dave.address);
      // live cooking lists follow the token
      const item = await rf.tokenItem(tokenId);
      expect(await rf.ingredientCount(alice.address, item)).to.equal(0n);
      expect(await rf.ingredientCount(dave.address, item)).to.equal(1n);
    });

    it("supports approvals and marketplace-style operator transfers", async function () {
      const { rf, alice, bob, market } = await deploy();
      const { tokenId } = await draw(rf, alice);
      await rf.connect(alice).approve(market.address, tokenId);
      expect(await rf.getApproved(tokenId)).to.equal(market.address);
      await rf.connect(market).transferFrom(alice.address, bob.address, tokenId);
      expect(await rf.ownerOf(tokenId)).to.equal(bob.address);
      expect(await rf.getApproved(tokenId)).to.equal(ethers.ZeroAddress);
      // operator-for-all path
      await nextDay();
      const d2 = await draw(rf, alice);
      await rf.connect(alice).setApprovalForAll(market.address, true);
      expect(await rf.isApprovedForAll(alice.address, market.address)).to.equal(true);
      await rf.connect(market).safeTransferFrom(alice.address, bob.address, d2.tokenId);
      expect(await rf.ownerOf(d2.tokenId)).to.equal(bob.address);
    });

    it("pays 5% ERC-2981 royalties to the contract (the pool)", async function () {
      const { rf, alice } = await deploy();
      const { tokenId } = await draw(rf, alice);
      const [receiver, amount] = await rf.royaltyInfo(tokenId, ethers.parseEther("1"));
      expect(receiver).to.equal(await rf.getAddress());
      expect(amount).to.equal(ethers.parseEther("0.05"));
      expect(await rf.supportsInterface("0x2a55205a")).to.equal(true);
      expect(await rf.supportsInterface("0x80ac58cd")).to.equal(true);
    });
  });

  describe("Founder Chef Pass + reward pool", function () {
    it("sells at exactly 0.005 BNB, numbers badges in purchase order, fills the pool", async function () {
      const { rf, alice, bob, dave } = await deploy();
      await expect(rf.connect(alice).buyPass({ value: ethers.parseEther("0.004") }))
        .to.be.revertedWith("pass price is exactly 0.005 BNB");
      await expect(rf.connect(alice).buyPass({ value: ethers.parseEther("0.006") }))
        .to.be.revertedWith("pass price is exactly 0.005 BNB");
      await expect(rf.connect(alice).buyPass({ value: 0 }))
        .to.be.revertedWith("pass price is exactly 0.005 BNB");

      const tx = await rf.connect(alice).buyPass({ value: PASS_PRICE });
      const rc = await tx.wait();
      let ev;
      for (const log of rc.logs) {
        try { const p = rf.interface.parseLog(log); if (p && p.name === "PassPurchased") ev = p.args; } catch {}
      }
      expect(Number(ev.passNumber)).to.equal(1);
      expect(await rf.tokenKind(ev.passTokenId)).to.equal(K_PASS);
      expect(await rf.tokenKind(ev.badgeTokenId)).to.equal(K_FOUNDER);
      expect(await rf.tokenSerial(ev.badgeTokenId)).to.equal(1);
      expect(await rf.passesSold()).to.equal(1n);
      expect(await rf.rewardPool()).to.equal(PASS_PRICE);
      expect(await ethers.provider.getBalance(await rf.getAddress())).to.equal(PASS_PRICE);
      expect(await rf.founderNumberOf(alice.address)).to.equal(1n);
      expect(await rf.hasFounderPerks(alice.address)).to.equal(true);
      expect(await rf.passCountOf(alice.address)).to.equal(1n);

      // Open to non-holders too (funding is not playing); numbering continues.
      await rf.connect(dave).buyPass({ value: PASS_PRICE });
      expect(await rf.founderNumberOf(dave.address)).to.equal(2n);
      expect(await rf.passesSold()).to.equal(2n);
      expect(await rf.rewardPool()).to.equal(PASS_PRICE * 2n);
      const founders = await rf.getFounders(0, 10);
      expect(founders).to.deep.equal([alice.address, dave.address]);
      expect(bob).to.not.equal(undefined);
    });

    it("caps the sale at 500 passes", async function () {
      const { rf, owner } = await deploy();
      for (let i = 0; i < 500; i++) {
        await rf.connect(owner).buyPass({ value: PASS_PRICE });
      }
      expect(await rf.passesSold()).to.equal(500n);
      expect(await rf.rewardPool()).to.equal(ethers.parseEther("2.5"));
      await expect(rf.connect(owner).buyPass({ value: PASS_PRICE }))
        .to.be.revertedWith("Founder Chef Passes sold out");
    }).timeout(600000);

    it("pool only grows via funding paths and matches the contract balance", async function () {
      const { rf, owner, alice } = await deploy();
      await rf.connect(owner).fundPool({ value: ethers.parseEther("0.1") });
      expect(await rf.rewardPool()).to.equal(ethers.parseEther("0.1"));
      // plain BNB transfer -> receive() -> pool (this is how royalties land)
      await owner.sendTransaction({ to: await rf.getAddress(), value: ethers.parseEther("0.05") });
      expect(await rf.rewardPool()).to.equal(ethers.parseEther("0.15"));
      expect(await ethers.provider.getBalance(await rf.getAddress())).to.equal(ethers.parseEther("0.15"));
      await expect(rf.connect(alice).fundPool({ value: 0 })).to.be.revertedWith("no value sent");
    });
  });

  describe("reroll (Founder perk)", function () {
    it("lets a pass holder redraw once per day; rejects everyone else", async function () {
      const { rf, alice, bob } = await deploy();
      const first = await draw(rf, alice);
      // no pass -> no reroll
      await expect(rf.connect(alice).reroll()).to.be.revertedWith("reroll requires a Founder Chef Pass");
      await rf.connect(alice).buyPass({ value: PASS_PRICE });
      expect(await rf.canReroll(alice.address)).to.equal(true);
      const tx = await rf.connect(alice).reroll();
      const rc = await tx.wait();
      let ev;
      for (const log of rc.logs) {
        try { const p = rf.interface.parseLog(log); if (p && p.name === "Rerolled") ev = p.args; } catch {}
      }
      expect(ev.burnedTokenId).to.equal(first.tokenId);
      expect(await rf.isBurned(first.tokenId)).to.equal(true);
      expect(await rf.ownerOf(ev.newTokenId)).to.equal(alice.address);
      // once per day
      expect(await rf.canReroll(alice.address)).to.equal(false);
      await expect(rf.connect(alice).reroll()).to.be.revertedWith("reroll already used today");
      // next day: draw + reroll works again
      await nextDay();
      await draw(rf, alice);
      expect(await rf.canReroll(alice.address)).to.equal(true);
      await rf.connect(alice).reroll();
      // bob never drew: nothing to reroll
      await expect(rf.connect(bob).reroll()).to.be.revertedWith("no draw today to reroll");
    });

    it("perks follow the pass on transfer and never stack", async function () {
      const { rf, alice, bob } = await deploy();
      await rf.connect(alice).buyPass({ value: PASS_PRICE });
      await rf.connect(alice).buyPass({ value: PASS_PRICE }); // 2 passes, still 1 reroll/day
      expect(await rf.passCountOf(alice.address)).to.equal(2n);
      await draw(rf, alice);
      await rf.connect(alice).reroll();
      await expect(rf.connect(alice).reroll()).to.be.revertedWith("reroll already used today");
      // move both passes to bob: alice loses perks, bob gains them
      const aliceTokens = [];
      const total = await rf.totalMinted();
      for (let id = 0; id < Number(total); id++) {
        try {
          if (Number(await rf.tokenKind(id)) === K_PASS && (await rf.ownerOf(id)) === alice.address) aliceTokens.push(id);
        } catch { /* burned */ }
      }
      expect(aliceTokens.length).to.equal(2);
      for (const id of aliceTokens) await rf.connect(alice).transferFrom(alice.address, bob.address, id);
      expect(await rf.hasFounderPerks(alice.address)).to.equal(false);
      expect(await rf.hasFounderPerks(bob.address)).to.equal(true);
      // founder badge stays with the buyer (soulbound), perks moved with the pass
      expect(await rf.founderNumberOf(alice.address)).to.equal(1n);
      // bob draws today and can reroll with the transferred pass
      await draw(rf, bob);
      expect(await rf.canReroll(bob.address)).to.equal(true);
      await rf.connect(bob).reroll();
    });

    it("reverts if today's ingredient was traded away before rerolling", async function () {
      const { rf, alice, bob } = await deploy();
      await rf.connect(alice).buyPass({ value: PASS_PRICE });
      const { tokenId } = await draw(rf, alice);
      await rf.connect(alice).transferFrom(alice.address, bob.address, tokenId);
      await expect(rf.connect(alice).reroll()).to.be.revertedWith("today's ingredient no longer held");
    });
  });

  describe("serve-to-earn", function () {
    it("pays pool/100 at partial funding (100 passes -> 0.005 BNB per serve)", async function () {
      const { rf, owner, alice } = await deploy();
      const g = await cookOneGolden(rf, alice);
      for (let i = 0; i < 100; i++) await rf.connect(owner).buyPass({ value: PASS_PRICE });
      expect(await rf.rewardPool()).to.equal(ethers.parseEther("0.5"));
      expect(await rf.currentServePayout()).to.equal(ethers.parseEther("0.005"));
      await expect(rf.connect(alice).serve(g.tokenId)).to.changeEtherBalance(alice, ethers.parseEther("0.005"));
      expect(await rf.goldenServed()).to.equal(1n);
      expect(await rf.rewardPool()).to.equal(ethers.parseEther("0.495"));
      expect(await rf.totalPaidOut()).to.equal(ethers.parseEther("0.005"));
      expect(await rf.isBurned(g.tokenId)).to.equal(true);
      // trophy: soulbound, serial 1
      const total = Number(await rf.totalMinted());
      let trophyId;
      for (let id = 0; id < total; id++) {
        try { if (Number(await rf.tokenKind(id)) === K_TROPHY) trophyId = id; } catch {}
      }
      expect(trophyId).to.not.equal(undefined);
      expect(await rf.ownerOf(trophyId)).to.equal(alice.address);
      expect(await rf.tokenSerial(trophyId)).to.equal(1);
      const chefs = await rf.getGoldenChefs(0, 10);
      expect(chefs).to.deep.equal([alice.address]);
      // share stays constant while no new funding arrives: 0.495 / 99 = 0.005
      expect(await rf.currentServePayout()).to.equal(ethers.parseEther("0.005"));
    }).timeout(600000);

    it("pays the full 0.025 BNB at full funding (500 passes)", async function () {
      const { rf, owner, alice } = await deploy();
      const g = await cookOneGolden(rf, alice);
      for (let i = 0; i < 500; i++) await rf.connect(owner).buyPass({ value: PASS_PRICE });
      expect(await rf.currentServePayout()).to.equal(ethers.parseEther("0.025"));
      await expect(rf.connect(alice).serve(g.tokenId)).to.changeEtherBalance(alice, ethers.parseEther("0.025"));
      expect(await rf.rewardPool()).to.equal(ethers.parseEther("2.475"));
    }).timeout(900000);

    it("serves for a trophy and 0 payout when the pool is empty — never reverts", async function () {
      const { rf, alice } = await deploy();
      const g = await cookOneGolden(rf, alice);
      expect(await rf.rewardPool()).to.equal(0n);
      expect(await rf.currentServePayout()).to.equal(0n);
      await expect(rf.connect(alice).serve(g.tokenId)).to.changeEtherBalance(alice, 0);
      expect(await rf.trophiesMinted()).to.equal(1n);
      expect(await rf.goldenServed()).to.equal(1n);
    }).timeout(600000);

    it("rejects serving tokens you don't own or that aren't Golden", async function () {
      const { rf, alice, bob } = await deploy();
      const g = await cookOneGolden(rf, alice);
      await expect(rf.connect(bob).serve(g.tokenId)).to.be.revertedWith("not your token");
      await nextDay();
      const { tokenId } = await draw(rf, alice);
      await expect(rf.connect(alice).serve(tokenId)).to.be.revertedWith("wrong token kind");
    }).timeout(600000);
  });

  describe("metadata", function () {
    it("serves RamenForge JSON for ingredients and passes", async function () {
      const { rf, alice } = await deploy();
      const { tokenId } = await draw(rf, alice);
      const uri = await rf.tokenURI(tokenId);
      const json = JSON.parse(Buffer.from(uri.split(",")[1], "base64").toString());
      expect(json.name).to.include("RamenForge");
      expect(json.image).to.include("ramenforge@main/frontend/public/art/");
      await rf.connect(alice).buyPass({ value: PASS_PRICE });
      const total = Number(await rf.totalMinted());
      const passUri = await rf.tokenURI(total - 2); // pass minted just before its badge
      const passJson = JSON.parse(Buffer.from(passUri.split(",")[1], "base64").toString());
      expect(passJson.name).to.include("Founder Chef Pass #1");
    });
  });
});
