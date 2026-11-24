// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title RamenForge — forge the Golden Ramen (BNB Chain, for Agent ID holders)
/// @notice A standalone game built for the Agent ID community. DailyFest V1
/// is a different, already-live contract and is untouched by this one.
///
/// THE GAME:
/// - Every UTC day, each Agent ID holder draws ONE free ingredient NFT at
///   random (gas only): 7 ingredient types — 4 uncommon (Handmade Noodles,
///   Tonkotsu Broth, Scallion, Nori, 19% each), 2 rare (Chashu Pork,
///   Ajitama Egg, 9% each) and 1 epic (Wagyu Slice, 6%).
/// - Ingredients are TRADEABLE: duplicates are trade stock, missing pieces
///   are bought on marketplaces (Element / OpenSea) — the game never stalls
///   waiting for a lucky day.
/// - COOKING (burns the inputs, Agent ID holders only):
///     4 uncommons            -> Ramen
///     Ramen + 2 rares        -> Deluxe Ramen
///     Deluxe + Wagyu Slice   -> Golden Ramen (hard cap: 100, numbered)
/// - Drawing on consecutive days builds a streak; Feast badges (Bronze at a
///   3-day BEST streak, Silver 7, Gold 14) are soulbound, as in DailyFest V1.
///   Lifetime shelves never shrink when cooking burns tokens.
///
/// FOUNDER CHEF PASS + REWARD POOL:
/// - 500 Founder Chef Passes at 0.005 BNB. 100% of proceeds enter the
///   reward pool held by THIS contract. The ONLY way BNB ever leaves this
///   contract is a serve payout (below) — there is no owner, no withdraw,
///   no rescue, no admin key of any kind.
/// - A pass is a tradeable ERC-721. Perks follow the CURRENT holder and
///   never stack (holding 2 passes = the same perks as 1): one daily
///   REROLL (burn today's drawn ingredient and draw again, once per day),
///   plus a Season 2 head-start entitlement readable on-chain. Every
///   purchase also mints a SOULBOUND Founder Chef Badge numbered in
///   purchase order to the buyer (kept even if the pass is later sold).
/// - SERVE-TO-EARN: burning ("serving") a Golden Ramen mints a soulbound,
///   numbered Golden Chef Trophy and pays from the pool:
///       payout = min(0.025 BNB, rewardPool / (100 - servesAlreadyDone))
///   At full funding (2.5 BNB) every one of the 100 serves pays exactly
///   0.025 BNB; with fewer passes sold the share scales down in proportion.
///   If the pool is empty a serve still mints the Trophy and pays 0 — a
///   serve NEVER reverts for lack of funds.
///
/// RANDOMNESS (honest limits): the draw is a keccak256 hash of the previous
/// block's hash, block.prevrandao, the sender, the UTC day and the sender's
/// lifetime draw count, revealed at mint time. It cannot be re-rolled by
/// simply waiting (one draw per wallet per day) and the sender-bound seed
/// means nobody can draw "for" another wallet; but it is derived from
/// public chain data, so a sophisticated caller who can land a transaction
/// in an exact chosen block (or a contract wallet that reverts unless the
/// draw is epic) could bias their own single daily draw. Impact is bounded
/// (1 ingredient/day, Agent ID is one-per-person, the epic is tradeable
/// anyway). A VRF oracle would remove this; it was deliberately not used
/// to keep the contract dependency-free and fully self-contained. See the
/// project README for the full discussion.
///
/// GATING: daily draw + cooking require an Agent ID (registry balanceOf).
/// Trading, pass purchase and serving are open to any holder of the tokens
/// (a Golden bought on a marketplace can be served by its buyer).
///
/// ROYALTIES: ERC-2981, 5% on every token, receiver = this contract — so
/// marketplace royalties flow into the same reward pool that pays serves.

interface IAgentID {
    function balanceOf(address owner) external view returns (uint256);
}

contract RamenForge {
    // ----- ERC-721 metadata -----
    string public constant name = "RamenForge";
    string public constant symbol = "FORGE";

    uint256 public constant SECONDS_PER_DAY = 86400;
    uint256 public constant INGREDIENT_TYPES = 7;

    // Token kinds.
    uint8 public constant KIND_INGREDIENT = 0;
    uint8 public constant KIND_RAMEN = 1;
    uint8 public constant KIND_DELUXE = 2;
    uint8 public constant KIND_GOLDEN = 3;
    uint8 public constant KIND_BADGE = 4; // Feast badge (item = tier 1..3), soulbound
    uint8 public constant KIND_TROPHY = 5; // Golden Chef Trophy (serial), soulbound
    uint8 public constant KIND_PASS = 6; // Founder Chef Pass (serial), tradeable
    uint8 public constant KIND_FOUNDER = 7; // Founder Chef Badge (serial), soulbound

    // Economy constants (user-settled design, 2026-11-25).
    uint256 public constant GOLDEN_CAP = 100;
    uint256 public constant PASS_SUPPLY = 500;
    uint256 public constant PASS_PRICE = 0.005 ether;
    uint256 public constant MAX_SERVE_PAYOUT = 0.025 ether;
    uint256 public constant ROYALTY_BPS = 500; // 5%

    string internal constant _IMAGE_BASE =
        "https://cdn.jsdelivr.net/gh/Velt89/ramenforge@main/frontend/public/art/";

    /// @notice SPACE ID Agent ID registry on BNB Chain (immutable).
    IAgentID public immutable agentIdRegistry;

    // ----- Ingredient table (fixed at construction) -----
    string[] private _ingredientNames;
    string[] private _ingredientSlugs;

    // ----- Tokens -----
    struct TokenMeta {
        uint8 kind; // see KIND_* constants
        uint8 item; // ingredient: 0..6; badge: tier 1..3; else 0
        uint32 serial; // golden: 1..100; trophy: serve #; pass/founder: purchase #
        uint256 mintDay; // UTC day number
        uint256 streakAtMint; // draw tokens: streak after the draw
    }

    TokenMeta[] private _tokens;
    mapping(uint256 => address) private _owners;
    mapping(address => uint256) private _balances;
    mapping(uint256 => bool) private _burned;
    mapping(uint256 => address) private _tokenApprovals;
    mapping(address => mapping(address => bool)) private _operatorApprovals;

    // Live holdings lists (for cooking selection). A token sits in exactly
    // one list: ingredients by item, dishes (kinds 1..3) by kind.
    mapping(address => mapping(uint8 => uint256[])) private _ingredientIds;
    mapping(address => mapping(uint8 => uint256[])) private _dishIds;
    mapping(uint256 => uint256) private _listIndex;

    // ----- Per-player game state (V1 streak semantics) -----
    mapping(address => bool) private _everDrew;
    mapping(address => uint256) private _lastDrawDay;
    mapping(address => uint256) private _currentStreak;
    mapping(address => uint256) private _bestStreak;
    mapping(address => uint256) private _lifetimeDays;
    mapping(address => uint256) private _drawCount; // lifetime draws (draw seed)
    mapping(address => mapping(uint8 => bool)) private _hasIngredient; // lifetime
    mapping(address => uint256) private _distinctIngredients; // lifetime
    mapping(address => mapping(uint8 => bool)) private _everDish; // lifetime, kinds 1..3
    mapping(address => mapping(uint8 => bool)) private _badgeClaimed;
    address[] private _players;
    mapping(address => bool) private _isPlayer;

    // ----- Daily draw / reroll state -----
    mapping(address => uint256) private _todayToken;
    mapping(address => uint256) private _todayDay;
    mapping(address => uint256) private _rerollDay;

    // ----- Cooking / serving counters -----
    uint256 private _totalBurned;
    uint256 private _totalCooks;
    uint256 private _goldenCooked;
    uint256 private _totalServed;
    uint256 private _trophiesMinted;
    address[] private _goldenChefs; // one entry per serve, in order

    // ----- Founder pass / reward pool -----
    uint256 private _passesSold;
    mapping(address => uint256) private _passCount; // live passes held
    mapping(address => uint256) private _founderNumber; // first purchase # (0 = never bought)
    address[] private _founders; // unique buyers, in first-purchase order
    uint256 private _rewardPool; // BNB (wei) earmarked for serve payouts
    uint256 private _totalPaidOut;

    // ----- Events -----
    event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);
    event Approval(address indexed owner, address indexed approved, uint256 indexed tokenId);
    event ApprovalForAll(address indexed owner, address indexed operator, bool approved);
    event IngredientDrawn(
        address indexed user, uint256 indexed day, uint8 ingredient, uint256 streak, uint256 tokenId
    );
    event Rerolled(
        address indexed user, uint256 indexed day, uint256 burnedTokenId, uint8 newIngredient, uint256 newTokenId
    );
    event Cooked(address indexed user, uint8 toKind, uint256 newTokenId, uint32 serial);
    event BadgeClaimed(address indexed user, uint8 tier, uint256 tokenId);
    event PassPurchased(address indexed buyer, uint256 passNumber, uint256 passTokenId, uint256 badgeTokenId);
    event Served(
        address indexed user, uint256 goldenTokenId, uint32 goldenSerial, uint256 trophyTokenId, uint256 payout
    );
    event PoolFunded(address indexed from, uint256 amount);

    constructor(address registry) {
        require(registry != address(0), "registry is zero address");
        agentIdRegistry = IAgentID(registry);
        _ingredientNames = [
            "Handmade Noodles", "Tonkotsu Broth", "Scallion", "Nori",
            "Chashu Pork", "Ajitama Egg", "Wagyu Slice"
        ];
        _ingredientSlugs = [
            "handmade-noodles", "tonkotsu-broth", "scallion", "nori",
            "chashu-pork", "ajitama-egg", "wagyu-slice"
        ];
    }

    // ----- Agent ID gate -----

    /// @notice True if `account` holds at least one Agent ID.
    function hasAgentId(address account) public view returns (bool) {
        return agentIdRegistry.balanceOf(account) > 0;
    }

    // ----- Ingredient table -----

    function ingredientName(uint8 item) external view returns (string memory) {
        require(item < INGREDIENT_TYPES, "invalid ingredient");
        return _ingredientNames[item];
    }

    function ingredientSlug(uint8 item) external view returns (string memory) {
        require(item < INGREDIENT_TYPES, "invalid ingredient");
        return _ingredientSlugs[item];
    }

    /// @notice Rarity class of an ingredient: 0 uncommon, 1 rare, 2 epic.
    function ingredientRarity(uint8 item) public pure returns (uint8) {
        require(item < INGREDIENT_TYPES, "invalid ingredient");
        if (item < 4) return 0;
        if (item < 6) return 1;
        return 2;
    }

    function rarityName(uint8 item) public pure returns (string memory) {
        uint8 r = ingredientRarity(item);
        if (r == 0) return "Uncommon";
        if (r == 1) return "Rare";
        return "Epic";
    }

    /// @notice Best-streak requirement for a Feast badge tier (1=Bronze 3, 2=Silver 7, 3=Gold 14).
    function badgeRequirement(uint8 tier) public pure returns (uint256) {
        if (tier == 1) return 3;
        if (tier == 2) return 7;
        if (tier == 3) return 14;
        revert("invalid tier");
    }

    function badgeName(uint8 tier) public pure returns (string memory) {
        if (tier == 1) return "Bronze";
        if (tier == 2) return "Silver";
        if (tier == 3) return "Gold";
        revert("invalid tier");
    }

    // ----- Random draw -----

    function _today() internal view returns (uint256) {
        return block.timestamp / SECONDS_PER_DAY;
    }

    /// @dev Map a 0..99 roll to an ingredient: 0-18 Noodles, 19-37 Broth,
    /// 38-56 Scallion, 57-75 Nori (19% each), 76-84 Chashu, 85-93 Ajitama
    /// (9% each), 94-99 Wagyu Slice (6%).
    function _ingredientForRoll(uint256 roll) internal pure returns (uint8) {
        if (roll < 19) return 0;
        if (roll < 38) return 1;
        if (roll < 57) return 2;
        if (roll < 76) return 3;
        if (roll < 85) return 4;
        if (roll < 94) return 5;
        return 6;
    }

    function _draw(address user, uint256 day, uint256 salt) internal view returns (uint8) {
        uint256 seed = uint256(
            keccak256(
                abi.encodePacked(
                    blockhash(block.number - 1), block.prevrandao, user, day, salt, _drawCount[user]
                )
            )
        );
        return _ingredientForRoll(seed % 100);
    }

    // ----- Internal token bookkeeping -----

    function _isSoulbound(uint8 kind) internal pure returns (bool) {
        return kind == KIND_BADGE || kind == KIND_TROPHY || kind == KIND_FOUNDER;
    }

    function _trackMint(address user, uint256 tokenId, TokenMeta memory t) internal {
        if (t.kind == KIND_INGREDIENT) {
            _listIndex[tokenId] = _ingredientIds[user][t.item].length;
            _ingredientIds[user][t.item].push(tokenId);
            if (!_hasIngredient[user][t.item]) {
                _hasIngredient[user][t.item] = true;
                _distinctIngredients[user] += 1;
            }
        } else if (t.kind >= KIND_RAMEN && t.kind <= KIND_GOLDEN) {
            _listIndex[tokenId] = _dishIds[user][t.kind].length;
            _dishIds[user][t.kind].push(tokenId);
            _everDish[user][t.kind] = true;
        } else if (t.kind == KIND_PASS) {
            _passCount[user] += 1;
        }
    }

    function _trackRemove(address user, uint256 tokenId, TokenMeta memory t) internal {
        if (t.kind == KIND_INGREDIENT) {
            uint256[] storage list = _ingredientIds[user][t.item];
            uint256 idx = _listIndex[tokenId];
            uint256 lastId = list[list.length - 1];
            list[idx] = lastId;
            _listIndex[lastId] = idx;
            list.pop();
        } else if (t.kind >= KIND_RAMEN && t.kind <= KIND_GOLDEN) {
            uint256[] storage list = _dishIds[user][t.kind];
            uint256 idx = _listIndex[tokenId];
            uint256 lastId = list[list.length - 1];
            list[idx] = lastId;
            _listIndex[lastId] = idx;
            list.pop();
        } else if (t.kind == KIND_PASS) {
            _passCount[user] -= 1;
        }
    }

    function _mint(address user, TokenMeta memory t) internal returns (uint256 tokenId) {
        tokenId = _tokens.length;
        _tokens.push(t);
        _owners[tokenId] = user;
        _balances[user] += 1;
        _trackMint(user, tokenId, t);
        emit Transfer(address(0), user, tokenId);
    }

    function _burn(address user, uint256 tokenId) internal {
        TokenMeta memory t = _tokens[tokenId];
        _burned[tokenId] = true;
        _owners[tokenId] = address(0);
        _balances[user] -= 1;
        _tokenApprovals[tokenId] = address(0);
        _trackRemove(user, tokenId, t);
        _totalBurned += 1;
        emit Transfer(user, address(0), tokenId);
    }

    function _requireOwnedDish(address user, uint256 tokenId, uint8 kind) internal view returns (TokenMeta memory t) {
        require(tokenId < _tokens.length && !_burned[tokenId], "token does not exist");
        require(_owners[tokenId] == user, "not your token");
        t = _tokens[tokenId];
        require(t.kind == kind, "wrong token kind");
    }


    // ----- Daily draw -----

    /// @notice Draw today's free ingredient. One per wallet per UTC day,
    /// Agent ID holders only. Consecutive days build the streak.
    function mintDaily() external returns (uint256 tokenId) {
        require(hasAgentId(msg.sender), "sender holds no Agent ID");
        uint256 today = _today();
        require(!(_everDrew[msg.sender] && _lastDrawDay[msg.sender] == today), "Already drawn today");

        uint256 streak;
        if (_everDrew[msg.sender] && today > 0 && _lastDrawDay[msg.sender] == today - 1) {
            streak = _currentStreak[msg.sender] + 1;
        } else {
            streak = 1;
        }
        _currentStreak[msg.sender] = streak;
        if (streak > _bestStreak[msg.sender]) _bestStreak[msg.sender] = streak;
        _lifetimeDays[msg.sender] += 1;
        _lastDrawDay[msg.sender] = today;

        uint8 ingredient = _draw(msg.sender, today, 0);
        _drawCount[msg.sender] += 1;
        tokenId = _mint(
            msg.sender,
            TokenMeta({
                kind: KIND_INGREDIENT,
                item: ingredient,
                serial: 0,
                mintDay: today,
                streakAtMint: streak
            })
        );
        _todayToken[msg.sender] = tokenId;
        _todayDay[msg.sender] = today;

        if (!_everDrew[msg.sender]) {
            _everDrew[msg.sender] = true;
            if (!_isPlayer[msg.sender]) {
                _isPlayer[msg.sender] = true;
                _players.push(msg.sender);
            }
        }
        emit IngredientDrawn(msg.sender, today, ingredient, streak, tokenId);
    }

    /// @notice Founder Chef Pass perk: burn today's drawn ingredient and draw
    /// again. Once per day, pass holders only (perks never stack). The new
    /// draw uses a different seed, so the result is a fresh roll.
    function reroll() external returns (uint256 tokenId) {
        uint256 today = _today();
        require(_everDrew[msg.sender] && _todayDay[msg.sender] == today, "no draw today to reroll");
        require(_passCount[msg.sender] > 0, "reroll requires a Founder Chef Pass");
        require(_rerollDay[msg.sender] != today, "reroll already used today");
        uint256 oldId = _todayToken[msg.sender];
        require(
            oldId < _tokens.length && !_burned[oldId] && _owners[oldId] == msg.sender,
            "today's ingredient no longer held"
        );
        _rerollDay[msg.sender] = today;
        _burn(msg.sender, oldId);

        uint8 ingredient = _draw(msg.sender, today, 1);
        _drawCount[msg.sender] += 1;
        tokenId = _mint(
            msg.sender,
            TokenMeta({
                kind: KIND_INGREDIENT,
                item: ingredient,
                serial: 0,
                mintDay: today,
                streakAtMint: _currentStreak[msg.sender]
            })
        );
        _todayToken[msg.sender] = tokenId;
        emit Rerolled(msg.sender, today, oldId, ingredient, tokenId);
    }

    /// @notice Claim a Feast badge your BEST streak qualifies you for.
    /// tier: 1 = Bronze (3), 2 = Silver (7), 3 = Gold (14). Once per tier.
    function claimBadge(uint8 tier) external returns (uint256 tokenId) {
        require(tier >= 1 && tier <= 3, "invalid tier");
        require(_bestStreak[msg.sender] >= badgeRequirement(tier), "streak too short for this badge");
        require(!_badgeClaimed[msg.sender][tier], "badge already claimed");
        _badgeClaimed[msg.sender][tier] = true;
        tokenId = _mint(
            msg.sender,
            TokenMeta({
                kind: KIND_BADGE,
                item: tier,
                serial: 0,
                mintDay: _today(),
                streakAtMint: _bestStreak[msg.sender]
            })
        );
        emit BadgeClaimed(msg.sender, tier, tokenId);
    }

    // ----- Cooking -----

    /// @notice Cook a Ramen: burn 4 ingredient tokens — exactly one of each
    /// uncommon (Noodles, Broth, Scallion, Nori), in any order.
    function cookRamen(uint256[4] calldata tokenIds) external returns (uint256 tokenId) {
        require(hasAgentId(msg.sender), "sender holds no Agent ID");
        bool[4] memory seen;
        for (uint256 i = 0; i < 4; i++) {
            for (uint256 j = i + 1; j < 4; j++) {
                require(tokenIds[i] != tokenIds[j], "token ids must be distinct");
            }
            TokenMeta memory t = _requireOwnedDish(msg.sender, tokenIds[i], KIND_INGREDIENT);
            require(t.item < 4, "Ramen needs uncommon ingredients only");
            require(!seen[t.item], "duplicate uncommon ingredient");
            seen[t.item] = true;
        }
        for (uint256 i = 0; i < 4; i++) _burn(msg.sender, tokenIds[i]);
        tokenId = _mint(
            msg.sender,
            TokenMeta({kind: KIND_RAMEN, item: 0, serial: 0, mintDay: _today(), streakAtMint: 0})
        );
        _totalCooks += 1;
        emit Cooked(msg.sender, KIND_RAMEN, tokenId, 0);
    }

    /// @notice Cook a Deluxe Ramen: burn 1 Ramen + both rares
    /// (Chashu Pork and Ajitama Egg, in any order).
    function cookDeluxe(uint256 ramenTokenId, uint256[2] calldata rareTokenIds)
        external
        returns (uint256 tokenId)
    {
        require(hasAgentId(msg.sender), "sender holds no Agent ID");
        require(rareTokenIds[0] != rareTokenIds[1], "token ids must be distinct");
        require(rareTokenIds[0] != ramenTokenId && rareTokenIds[1] != ramenTokenId, "token ids must be distinct");
        _requireOwnedDish(msg.sender, ramenTokenId, KIND_RAMEN);
        bool[2] memory seen;
        for (uint256 i = 0; i < 2; i++) {
            TokenMeta memory t = _requireOwnedDish(msg.sender, rareTokenIds[i], KIND_INGREDIENT);
            require(t.item == 4 || t.item == 5, "Deluxe needs the two rare ingredients");
            require(!seen[t.item - 4], "duplicate rare ingredient");
            seen[t.item - 4] = true;
        }
        _burn(msg.sender, ramenTokenId);
        _burn(msg.sender, rareTokenIds[0]);
        _burn(msg.sender, rareTokenIds[1]);
        tokenId = _mint(
            msg.sender,
            TokenMeta({kind: KIND_DELUXE, item: 0, serial: 0, mintDay: _today(), streakAtMint: 0})
        );
        _totalCooks += 1;
        emit Cooked(msg.sender, KIND_DELUXE, tokenId, 0);
    }

    /// @notice Cook a Golden Ramen: burn 1 Deluxe Ramen + 1 Wagyu Slice.
    /// Hard cap 100 — reverts once the 100th Golden has been cooked.
    function cookGolden(uint256 deluxeTokenId, uint256 wagyuTokenId) external returns (uint256 tokenId) {
        require(hasAgentId(msg.sender), "sender holds no Agent ID");
        require(_goldenCooked < GOLDEN_CAP, "Golden Ramen cap reached (100)");
        require(deluxeTokenId != wagyuTokenId, "token ids must be distinct");
        _requireOwnedDish(msg.sender, deluxeTokenId, KIND_DELUXE);
        TokenMeta memory w = _requireOwnedDish(msg.sender, wagyuTokenId, KIND_INGREDIENT);
        require(w.item == 6, "Golden needs a Wagyu Slice");
        _burn(msg.sender, deluxeTokenId);
        _burn(msg.sender, wagyuTokenId);
        _goldenCooked += 1;
        uint32 serial = uint32(_goldenCooked);
        tokenId = _mint(
            msg.sender,
            TokenMeta({kind: KIND_GOLDEN, item: 0, serial: serial, mintDay: _today(), streakAtMint: 0})
        );
        _totalCooks += 1;
        emit Cooked(msg.sender, KIND_GOLDEN, tokenId, serial);
    }

    // ----- Founder Chef Pass + reward pool -----

    /// @notice Buy a Founder Chef Pass: exactly 0.005 BNB, max 500 sold.
    /// 100% of the price enters the reward pool. Mints the tradeable pass
    /// plus a soulbound Founder Chef Badge, both numbered in purchase order.
    /// Open to anyone (the Agent ID gate applies to playing, not funding).
    function buyPass() external payable returns (uint256 passTokenId) {
        require(msg.value == PASS_PRICE, "pass price is exactly 0.005 BNB");
        require(_passesSold < PASS_SUPPLY, "Founder Chef Passes sold out");
        _passesSold += 1;
        uint32 n = uint32(_passesSold);
        _rewardPool += msg.value;
        if (_founderNumber[msg.sender] == 0) {
            _founderNumber[msg.sender] = n;
            _founders.push(msg.sender);
        }
        passTokenId = _mint(
            msg.sender,
            TokenMeta({kind: KIND_PASS, item: 0, serial: n, mintDay: _today(), streakAtMint: 0})
        );
        uint256 badgeTokenId = _mint(
            msg.sender,
            TokenMeta({kind: KIND_FOUNDER, item: 0, serial: n, mintDay: _today(), streakAtMint: 0})
        );
        emit PassPurchased(msg.sender, n, passTokenId, badgeTokenId);
    }

    /// @notice Add BNB to the reward pool (e.g. a sponsor top-up). Pool funds
    /// can only ever leave this contract as serve payouts.
    function fundPool() external payable {
        require(msg.value > 0, "no value sent");
        _rewardPool += msg.value;
        emit PoolFunded(msg.sender, msg.value);
    }

    /// @dev Any BNB that reaches this contract (including ERC-2981 royalties
    /// paid to it by marketplaces) joins the reward pool.
    receive() external payable {
        _rewardPool += msg.value;
        emit PoolFunded(msg.sender, msg.value);
    }

    /// @notice What the next serve would pay right now:
    /// min(0.025 BNB, rewardPool / remaining serves), 0 when sold out/empty.
    function currentServePayout() public view returns (uint256) {
        if (_totalServed >= GOLDEN_CAP) return 0;
        uint256 share = _rewardPool / (GOLDEN_CAP - _totalServed);
        return share > MAX_SERVE_PAYOUT ? MAX_SERVE_PAYOUT : share;
    }

    /// @notice Serve a Golden Ramen: burn it, receive a soulbound numbered
    /// Golden Chef Trophy and the current serve payout from the pool.
    /// Never reverts for lack of funds — an empty pool pays 0.
    function serve(uint256 goldenTokenId) external returns (uint256 trophyTokenId) {
        TokenMeta memory g = _requireOwnedDish(msg.sender, goldenTokenId, KIND_GOLDEN);
        uint256 payout = currentServePayout();
        if (payout > address(this).balance) payout = address(this).balance;
        _burn(msg.sender, goldenTokenId);
        _rewardPool -= payout;
        _totalPaidOut += payout;
        _totalServed += 1;
        _goldenChefs.push(msg.sender);
        _trophiesMinted += 1;
        trophyTokenId = _mint(
            msg.sender,
            TokenMeta({
                kind: KIND_TROPHY,
                item: 0,
                serial: uint32(_trophiesMinted),
                mintDay: _today(),
                streakAtMint: 0
            })
        );
        emit Served(msg.sender, goldenTokenId, g.serial, trophyTokenId, payout);
        if (payout > 0) {
            (bool ok, ) = msg.sender.call{value: payout}("");
            require(ok, "serve payout transfer failed");
        }
    }


    // ----- Views -----

    /// @return current current streak (consecutive days, as of the last draw)
    /// @return best best streak ever reached
    /// @return lifetime total days drawn (lifetime)
    function streakOf(address user) external view returns (uint256 current, uint256 best, uint256 lifetime) {
        return (_currentStreak[user], _bestStreak[user], _lifetimeDays[user]);
    }

    /// @notice True if `user` could mintDaily() right now (holder + not yet today).
    function canDrawToday(address user) external view returns (bool) {
        if (!hasAgentId(user)) return false;
        return !(_everDrew[user] && _lastDrawDay[user] == _today());
    }

    /// @notice True if `user` drew today, holds a pass, and has not rerolled yet.
    function canReroll(address user) external view returns (bool) {
        uint256 today = _today();
        if (_passCount[user] == 0) return false;
        if (!(_everDrew[user] && _todayDay[user] == today)) return false;
        if (_rerollDay[user] == today) return false;
        uint256 id = _todayToken[user];
        return id < _tokens.length && !_burned[id] && _owners[id] == user;
    }

    /// @notice Token id of today's drawn ingredient for `user` (valid only if they drew today).
    function todaysTokenOf(address user) external view returns (uint256 tokenId, uint8 ingredient, bool drawn) {
        drawn = _everDrew[user] && _todayDay[user] == _today();
        if (!drawn) return (0, 0, false);
        tokenId = _todayToken[user];
        ingredient = _tokens[tokenId].item;
    }

    function lastDrawDayOf(address user) external view returns (uint256) {
        return _everDrew[user] ? _lastDrawDay[user] : 0;
    }

    function badgeClaimed(address user, uint8 tier) external view returns (bool) {
        return _badgeClaimed[user][tier];
    }

    function tokenKind(uint256 tokenId) external view returns (uint8) {
        require(tokenId < _tokens.length && !_burned[tokenId], "token does not exist");
        return _tokens[tokenId].kind;
    }

    function tokenItem(uint256 tokenId) external view returns (uint8) {
        require(tokenId < _tokens.length && !_burned[tokenId], "token does not exist");
        return _tokens[tokenId].item;
    }

    /// @notice Serial number: Golden # (1..100), Trophy #, Pass/Founder #; 0 for others.
    function tokenSerial(uint256 tokenId) external view returns (uint32) {
        require(tokenId < _tokens.length && !_burned[tokenId], "token does not exist");
        return _tokens[tokenId].serial;
    }

    function isBurned(uint256 tokenId) external view returns (bool) {
        require(tokenId < _tokens.length, "token does not exist");
        return _burned[tokenId];
    }

    /// @notice Lifetime shelf: true if the user has EVER drawn this ingredient
    /// (never shrinks, even when the token is cooked, rerolled or sold).
    function hasIngredient(address user, uint8 item) external view returns (bool) {
        return _hasIngredient[user][item];
    }

    function distinctIngredientsOf(address user) external view returns (uint256) {
        return _distinctIngredients[user];
    }

    /// @notice True if the user has EVER held a dish of this kind (1 Ramen, 2 Deluxe, 3 Golden).
    function everHadDish(address user, uint8 kind) external view returns (bool) {
        return _everDish[user][kind];
    }

    /// @notice Live count of a user's ingredient tokens of one type.
    function ingredientCount(address user, uint8 item) external view returns (uint256) {
        return _ingredientIds[user][item].length;
    }

    /// @notice Live ingredient token ids of one type (for cooking selection).
    function ingredientTokenIds(address user, uint8 item) external view returns (uint256[] memory) {
        return _ingredientIds[user][item];
    }

    /// @notice Live dish token ids of one kind (1 Ramen, 2 Deluxe, 3 Golden).
    function dishTokenIds(address user, uint8 kind) external view returns (uint256[] memory) {
        require(kind >= KIND_RAMEN && kind <= KIND_GOLDEN, "not a dish kind");
        return _dishIds[user][kind];
    }

    /// @notice Picks owned token ids for cooking a Ramen (one of each uncommon).
    function ramenCookIds(address user)
        external
        view
        returns (uint256[4] memory ids, bool ready)
    {
        ready = true;
        for (uint8 item = 0; item < 4; item++) {
            uint256[] memory owned = _ingredientIds[user][item];
            if (owned.length == 0) {
                ids[item] = type(uint256).max;
                ready = false;
            } else {
                ids[item] = owned[0];
            }
        }
    }

    /// @notice Picks owned token ids for cooking a Deluxe Ramen.
    function deluxeCookIds(address user)
        external
        view
        returns (uint256 ramenId, uint256[2] memory rareIds, bool ready)
    {
        uint256[] memory ramens = _dishIds[user][KIND_RAMEN];
        ready = ramens.length > 0;
        ramenId = ramens.length > 0 ? ramens[0] : type(uint256).max;
        for (uint8 i = 0; i < 2; i++) {
            uint256[] memory owned = _ingredientIds[user][4 + i];
            if (owned.length == 0) {
                rareIds[i] = type(uint256).max;
                ready = false;
            } else {
                rareIds[i] = owned[0];
            }
        }
    }

    /// @notice Picks owned token ids for cooking a Golden Ramen.
    function goldenCookIds(address user)
        external
        view
        returns (uint256 deluxeId, uint256 wagyuId, bool ready)
    {
        uint256[] memory deluxes = _dishIds[user][KIND_DELUXE];
        uint256[] memory wagyu = _ingredientIds[user][6];
        deluxeId = deluxes.length > 0 ? deluxes[0] : type(uint256).max;
        wagyuId = wagyu.length > 0 ? wagyu[0] : type(uint256).max;
        ready = deluxes.length > 0 && wagyu.length > 0 && _goldenCooked < GOLDEN_CAP;
    }

    // ----- Pass / pool / fame views -----

    function passesSold() external view returns (uint256) {
        return _passesSold;
    }

    function passCountOf(address user) external view returns (uint256) {
        return _passCount[user];
    }

    /// @notice Founder perks follow the pass: true while the wallet holds at
    /// least one Founder Chef Pass. This is also the Season 2 head-start
    /// entitlement flag (early access + 1 bonus uncommon ingredient).
    function hasFounderPerks(address user) external view returns (bool) {
        return _passCount[user] > 0;
    }

    /// @notice Purchase-order number of the wallet's first Founder Chef Badge
    /// (0 if it never bought a pass). The badge itself is soulbound and kept
    /// even if the pass is sold; perks, however, follow the pass.
    function founderNumberOf(address user) external view returns (uint256) {
        return _founderNumber[user];
    }

    function rewardPool() external view returns (uint256) {
        return _rewardPool;
    }

    function totalPaidOut() external view returns (uint256) {
        return _totalPaidOut;
    }

    function goldenCooked() external view returns (uint256) {
        return _goldenCooked;
    }

    function goldenServed() external view returns (uint256) {
        return _totalServed;
    }

    function trophiesMinted() external view returns (uint256) {
        return _trophiesMinted;
    }

    function totalMinted() external view returns (uint256) {
        return _tokens.length;
    }

    function totalBurned() external view returns (uint256) {
        return _totalBurned;
    }

    function cookStats() external view returns (uint256 cooks, uint256 burned, uint256 golden, uint256 served) {
        return (_totalCooks, _totalBurned, _goldenCooked, _totalServed);
    }

    function playersCount() external view returns (uint256) {
        return _players.length;
    }

    /// @notice Paginated player addresses (limit clamped to 100).
    function getPlayers(uint256 offset, uint256 limit) external view returns (address[] memory page) {
        return _page(_players, offset, limit);
    }

    function foundersCount() external view returns (uint256) {
        return _founders.length;
    }

    /// @notice Hall of Fame: unique pass buyers in first-purchase order.
    function getFounders(uint256 offset, uint256 limit) external view returns (address[] memory page) {
        return _page(_founders, offset, limit);
    }

    function goldenChefsCount() external view returns (uint256) {
        return _goldenChefs.length;
    }

    /// @notice Hall of Fame: one entry per serve, in serve order.
    function getGoldenChefs(uint256 offset, uint256 limit) external view returns (address[] memory page) {
        return _page(_goldenChefs, offset, limit);
    }

    function _page(address[] storage list, uint256 offset, uint256 limit)
        internal
        view
        returns (address[] memory page)
    {
        if (limit > 100) limit = 100;
        if (offset >= list.length || limit == 0) return new address[](0);
        uint256 end = offset + limit;
        if (end > list.length) end = list.length;
        page = new address[](end - offset);
        for (uint256 i = offset; i < end; i++) {
            page[i - offset] = list[i];
        }
    }

    // ----- ERC-721 -----

    function balanceOf(address owner) external view returns (uint256) {
        require(owner != address(0), "zero address");
        return _balances[owner];
    }

    function ownerOf(uint256 tokenId) public view returns (address) {
        require(tokenId < _tokens.length && !_burned[tokenId], "token does not exist");
        address owner = _owners[tokenId];
        require(owner != address(0), "token does not exist");
        return owner;
    }

    function _transfer(address from, address to, uint256 tokenId) internal {
        TokenMeta memory t = _tokens[tokenId];
        _tokenApprovals[tokenId] = address(0);
        _owners[tokenId] = to;
        _balances[from] -= 1;
        _balances[to] += 1;
        _trackRemove(from, tokenId, t);
        _trackMint(to, tokenId, t);
        emit Transfer(from, to, tokenId);
    }

    function transferFrom(address from, address to, uint256 tokenId) public {
        require(tokenId < _tokens.length && !_burned[tokenId], "token does not exist");
        require(!_isSoulbound(_tokens[tokenId].kind), "RamenForge: this token is soulbound");
        require(_owners[tokenId] == from, "from is not the owner");
        require(to != address(0), "transfer to zero address");
        require(
            msg.sender == from || msg.sender == _tokenApprovals[tokenId] || _operatorApprovals[from][msg.sender],
            "not owner or approved"
        );
        _transfer(from, to, tokenId);
    }

    function safeTransferFrom(address from, address to, uint256 tokenId) external {
        safeTransferFrom(from, to, tokenId, "");
    }

    function safeTransferFrom(address from, address to, uint256 tokenId, bytes memory data) public {
        transferFrom(from, to, tokenId);
        require(_checkOnERC721Received(from, to, tokenId, data), "transfer to non-ERC721 receiver");
    }

    function _checkOnERC721Received(address from, address to, uint256 tokenId, bytes memory data)
        internal
        returns (bool)
    {
        if (to.code.length == 0) return true;
        (bool ok, bytes memory ret) = to.call(
            abi.encodeWithSelector(0x150b7a5e, msg.sender, from, tokenId, data)
        );
        if (!ok || ret.length < 32) return false;
        return abi.decode(ret, (bytes4)) == bytes4(0x150b7a5e);
    }

    function approve(address approved, uint256 tokenId) external {
        require(tokenId < _tokens.length && !_burned[tokenId], "token does not exist");
        require(!_isSoulbound(_tokens[tokenId].kind), "RamenForge: this token is soulbound");
        address owner = _owners[tokenId];
        require(msg.sender == owner || _operatorApprovals[owner][msg.sender], "not owner or operator");
        _tokenApprovals[tokenId] = approved;
        emit Approval(owner, approved, tokenId);
    }

    function setApprovalForAll(address operator, bool approved) external {
        _operatorApprovals[msg.sender][operator] = approved;
        emit ApprovalForAll(msg.sender, operator, approved);
    }

    function getApproved(uint256 tokenId) external view returns (address) {
        require(tokenId < _tokens.length && !_burned[tokenId], "token does not exist");
        return _tokenApprovals[tokenId];
    }

    function isApprovedForAll(address owner, address operator) external view returns (bool) {
        return _operatorApprovals[owner][operator];
    }

    // ----- ERC-2981 royalties -----

    /// @notice 5% royalty on every token, paid to this contract — royalties
    /// flow into the reward pool (see receive()).
    function royaltyInfo(uint256 tokenId, uint256 salePrice)
        external
        view
        returns (address receiver, uint256 royaltyAmount)
    {
        require(tokenId < _tokens.length && !_burned[tokenId], "token does not exist");
        return (address(this), (salePrice * ROYALTY_BPS) / 10000);
    }

    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return
            interfaceId == 0x01ffc9a7 || // ERC165
            interfaceId == 0x80ac58cd || // ERC721
            interfaceId == 0x5b5e139f || // ERC721Metadata
            interfaceId == 0x2a55205a; // ERC2981
    }


    // ----- Metadata -----

    function tokenURI(uint256 tokenId) external view returns (string memory) {
        require(tokenId < _tokens.length && !_burned[tokenId], "token does not exist");
        TokenMeta memory t = _tokens[tokenId];
        return string(abi.encodePacked("data:application/json;base64,", _base64Encode(bytes(_tokenJSON(t)))));
    }

    string internal constant _DESC =
        "RamenForge on BNB Chain: draw one free ingredient a day, trade what you don't need, cook Ramen, Deluxe Ramen and one of only 100 Golden Ramen. Founder Chef Pass proceeds fund the serve reward pool in full. No returns promised.";

    function _tokenJSON(TokenMeta memory t) internal view returns (string memory) {
        if (t.kind == KIND_INGREDIENT) return _ingredientJSON(t);
        if (t.kind == KIND_RAMEN || t.kind == KIND_DELUXE) return _dishJSON(t);
        if (t.kind == KIND_GOLDEN) return _goldenJSON(t);
        if (t.kind == KIND_BADGE) return _badgeJSON(t);
        if (t.kind == KIND_TROPHY) return _trophyJSON(t);
        if (t.kind == KIND_PASS) return _passJSON(t);
        return _founderJSON(t);
    }

    function _ingredientJSON(TokenMeta memory t) internal view returns (string memory) {
        string memory head = string(
            abi.encodePacked(
                '{"name":"RamenForge \xe2\x80\x94 ', _ingredientNames[t.item],
                '","description":"', _DESC,
                '","image":"', _IMAGE_BASE, _ingredientSlugs[t.item], '.svg","attributes":['
            )
        );
        string memory tail = string(
            abi.encodePacked(
                '{"trait_type":"Kind","value":"Ingredient"},',
                '{"trait_type":"Ingredient","value":"', _ingredientNames[t.item], '"},',
                '{"trait_type":"Rarity","value":"', rarityName(t.item), '"},',
                '{"trait_type":"Day","value":', _toString(t.mintDay), "}]}"
            )
        );
        return string(abi.encodePacked(head, tail));
    }

    function _dishJSON(TokenMeta memory t) internal pure returns (string memory) {
        string memory dName = t.kind == KIND_RAMEN ? "Ramen" : "Deluxe Ramen";
        string memory slug = t.kind == KIND_RAMEN ? "ramen" : "ramen-deluxe";
        string memory head = string(
            abi.encodePacked(
                '{"name":"RamenForge \xe2\x80\x94 ', dName,
                '","description":"', _DESC,
                '","image":"', _IMAGE_BASE, slug, '.svg","attributes":['
            )
        );
        string memory tail = string(
            abi.encodePacked(
                '{"trait_type":"Kind","value":"Dish"},',
                '{"trait_type":"Dish","value":"', dName, '"},',
                '{"trait_type":"Day","value":', _toString(t.mintDay), "}]}"
            )
        );
        return string(abi.encodePacked(head, tail));
    }

    function _goldenJSON(TokenMeta memory t) internal pure returns (string memory) {
        string memory head = string(
            abi.encodePacked(
                '{"name":"RamenForge \xe2\x80\x94 Golden Ramen #', _toString(t.serial),
                '","description":"', _DESC,
                '","image":"', _IMAGE_BASE, 'ramen-golden.svg","attributes":['
            )
        );
        string memory tail = string(
            abi.encodePacked(
                '{"trait_type":"Kind","value":"Dish"},',
                '{"trait_type":"Dish","value":"Golden Ramen"},',
                '{"trait_type":"Golden Number","value":', _toString(t.serial), '},',
                '{"trait_type":"Day","value":', _toString(t.mintDay), "}]}"
            )
        );
        return string(abi.encodePacked(head, tail));
    }

    function _badgeJSON(TokenMeta memory t) internal pure returns (string memory) {
        string memory slug = t.item == 1 ? "badge-bronze" : t.item == 2 ? "badge-silver" : "badge-gold";
        string memory head = string(
            abi.encodePacked(
                '{"name":"RamenForge \xe2\x80\x94 ', badgeName(t.item), ' Feast Badge",',
                '"description":"A soulbound Feast badge from RamenForge, earned with a ',
                _toString(badgeRequirement(t.item)), '-day best streak.",',
                '"image":"', _IMAGE_BASE, slug, '.svg","attributes":['
            )
        );
        string memory tail = string(
            abi.encodePacked(
                '{"trait_type":"Kind","value":"Badge"},',
                '{"trait_type":"Tier","value":"', badgeName(t.item), '"},',
                '{"trait_type":"Required streak","value":', _toString(badgeRequirement(t.item)), "}]}"
            )
        );
        return string(abi.encodePacked(head, tail));
    }

    function _trophyJSON(TokenMeta memory t) internal pure returns (string memory) {
        string memory head = string(
            abi.encodePacked(
                '{"name":"RamenForge \xe2\x80\x94 Golden Chef Trophy #', _toString(t.serial),
                '","description":"A soulbound trophy from RamenForge, minted by serving a Golden Ramen. It cannot be bought or transferred.",',
                '"image":"', _IMAGE_BASE, 'trophy.svg","attributes":['
            )
        );
        string memory tail = string(
            abi.encodePacked(
                '{"trait_type":"Kind","value":"Trophy"},',
                '{"trait_type":"Serve Number","value":', _toString(t.serial), "}]}"
            )
        );
        return string(abi.encodePacked(head, tail));
    }

    function _passJSON(TokenMeta memory t) internal pure returns (string memory) {
        string memory head = string(
            abi.encodePacked(
                '{"name":"RamenForge \xe2\x80\x94 Founder Chef Pass #', _toString(t.serial),
                '","description":"A tradeable Founder Chef Pass for RamenForge. While held: one daily ingredient reroll and the Season 2 head-start entitlement. Perks never stack. 100% of the sale price entered the serve reward pool.",',
                '"image":"', _IMAGE_BASE, 'founder-pass.svg","attributes":['
            )
        );
        string memory tail = string(
            abi.encodePacked(
                '{"trait_type":"Kind","value":"Founder Pass"},',
                '{"trait_type":"Pass Number","value":', _toString(t.serial), "}]}"
            )
        );
        return string(abi.encodePacked(head, tail));
    }

    function _founderJSON(TokenMeta memory t) internal pure returns (string memory) {
        string memory head = string(
            abi.encodePacked(
                '{"name":"RamenForge \xe2\x80\x94 Founder Chef Badge #', _toString(t.serial),
                '","description":"A soulbound Founder Chef Badge from RamenForge, numbered in purchase order. Kept forever, even if the pass is sold.",',
                '"image":"', _IMAGE_BASE, 'founder-badge.svg","attributes":['
            )
        );
        string memory tail = string(
            abi.encodePacked(
                '{"trait_type":"Kind","value":"Founder Badge"},',
                '{"trait_type":"Founder Number","value":', _toString(t.serial), "}]}"
            )
        );
        return string(abi.encodePacked(head, tail));
    }

    // ----- String helpers -----

    function _toString(uint256 value) internal pure returns (string memory) {
        if (value == 0) return "0";
        uint256 temp = value;
        uint256 digits;
        while (temp != 0) {
            digits++;
            temp /= 10;
        }
        bytes memory buffer = new bytes(digits);
        while (value != 0) {
            digits -= 1;
            buffer[digits] = bytes1(uint8(48 + uint256(value % 10)));
            value /= 10;
        }
        return string(buffer);
    }

    function _base64Encode(bytes memory data) internal pure returns (string memory) {
        bytes memory table = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        return _base64EncodeSimple(data, table);
    }

    function _base64EncodeSimple(bytes memory data, bytes memory table) internal pure returns (string memory) {
        uint256 len = data.length;
        if (len == 0) return "";
        bytes memory result = new bytes(4 * ((len + 2) / 3));
        uint256 i;
        uint256 j;
        while (i < len) {
            uint256 a = uint8(data[i]);
            uint256 b = i + 1 < len ? uint8(data[i + 1]) : 0;
            uint256 c = i + 2 < len ? uint8(data[i + 2]) : 0;
            result[j] = table[(a >> 2) & 0x3f];
            result[j + 1] = table[((a & 0x03) << 4) | (b >> 4)];
            result[j + 2] = i + 1 < len ? table[((b & 0x0f) << 2) | (c >> 6)] : bytes1("=");
            result[j + 3] = i + 2 < len ? table[c & 0x3f] : bytes1("=");
            i += 3;
            j += 4;
        }
        return string(result);
    }
}
