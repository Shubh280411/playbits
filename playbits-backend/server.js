const express = require("express");
const cors = require("cors");
const { ethers, HDNodeWallet } = require("ethers");
const crypto = require("crypto");
const db = require("./db");

require("dotenv").config();

if (!process.env.MNEMONIC) {
  console.error("[FATAL] MNEMONIC env var is required.");
  process.exit(1);
}
const MNEMONIC = process.env.MNEMONIC;
const MASTER = HDNodeWallet.fromPhrase(MNEMONIC);
const BSC_RPC = "https://bsc-dataseed.binance.org";
const PROVIDER = new ethers.JsonRpcProvider(BSC_RPC);
const USDT_ADDR = "0x55d398326f99059fF775485246999027B3197955";
const USDT_ABI = ["function balanceOf(address) view returns (uint256)", "function transfer(address,uint256) returns (bool)"];

const app = express();
app.use(cors());
app.use(express.json());

// Run schema on startup
async function initSchema() {
  try {
    const sql = require("fs").readFileSync("./schema.sql", "utf8");
    const statements = sql.split(";").filter(s => s.trim());
    for (const stmt of statements) {
      try { await db.query(stmt); } catch (e) { console.error("[SCHEMA] Error:", e.message); }
    }
    console.log("[SCHEMA] Tables ensured");
  } catch (e) { console.error("[SCHEMA] Init failed:", e.message); }
}

async function createIncomeEntry(data) {
  try {
    const id = `${data.userId}_${data.type}_${Date.now()}_${Math.random().toString(36).slice(2,6)}`;
    await db.insert("income_history", id, {
      userId: String(data.userId),
      amount: data.amount || 0,
      type: data.type || "",
      description: data.description || "",
      sourceUserId: data.sourceUserId || "",
      sourceUserName: data.sourceUserName || "",
      level: data.level || "",
      status: data.status || "completed",
      txHash: data.txHash || "",
      walletAddress: data.walletAddress || "",
      packageName: data.packageName || "",
      packageAmount: data.packageAmount || 0,
      roi: data.roi || 0,
      boosterName: data.boosterName || "",
      extraRoi: data.extraRoi || 0,
      rankName: data.rankName || "",
      rewardCycle: data.rewardCycle || "",
      network: data.network || "",
      reason: data.reason || "",
      createdAt: Date.now(),
      updatedAt: Date.now()
    });
    return true;
  } catch (e) {
    console.error("[INCOME] Failed to create entry:", e.message);
    return false;
  }
}

async function commitDepositCredit({ depositDocId, userId, amount, address, txHash = "" }) {
  const now = Date.now();
  const user = await db.get("users", String(userId), "telegramId");
  const userFields = {
    firstName: user?.firstName || `Player_${String(userId).slice(-4)}`,
    username: user?.username || "",
    isActive: user?.isActive !== false,
    depositBalance: (Number(user?.depositBalance) || 0) + amount,
    totalDeposited: (Number(user?.totalDeposited) || 0) + amount,
    activationUSDT: Number(user?.activationUSDT) || 0,
    packageAmount: Number(user?.packageAmount) || 0,
    packageStatus: user?.packageStatus || "none",
    updatedAt: now
  };
  if (!user) userFields.createdAt = now;

  const depositFields = {
    status: "confirmed",
    amount,
    credited: true,
    creditedAt: now,
    confirmedAt: now,
    updatedAt: now,
    txHash,
    address
  };

  await db.patch("users", String(userId), userFields, "telegramId");
  await db.patch("deposits", depositDocId, depositFields);
  return true;
}

async function ensureUserDoc(userId) {
  const existing = await db.get("users", String(userId), "telegramId");
  if (existing) return true;
  await db.insert("users", String(userId), {
    telegramId: String(userId),
    firstName: `Player_${String(userId).slice(-4)}`,
    username: "",
    isActive: true,
    depositBalance: 0,
    totalDeposited: 0,
    activationUSDT: 0,
    packageAmount: 0,
    packageStatus: "none",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    referredBy: "1001"
  }, "telegramId");
  return true;
}

async function makeUniqueDepositIndex(userId) {
  for (let i = 0; i < 3; i++) {
    const index = crypto.randomInt(1, 2147483647);
    const depositId = `${String(userId).replace(/[^a-zA-Z0-9_-]/g, "_")}_${index}`;
    const existing = await db.get("deposits", depositId);
    if (!existing) return { index, depositId };
  }
  const index = Date.now() % 2147483647;
  return { index, depositId: `${String(userId).replace(/[^a-zA-Z0-9_-]/g, "_")}_${index}` };
}

function deriveAddress(index) {
  return HDNodeWallet.fromPhrase(MNEMONIC, undefined, "m/44'/60'/0'/0/" + index);
}

function getWallet(index) {
  return deriveAddress(index).connect(PROVIDER);
}

async function checkUsdtBalance(address) {
  try {
    const usdt = new ethers.Contract(USDT_ADDR, USDT_ABI, PROVIDER);
    const bal = await usdt.balanceOf(address);
    return Number(ethers.formatUnits(bal, 18));
  } catch (e) { return 0 }
}

async function sweepChild(index) {
  try {
    const child = getWallet(index);
    const usdt = new ethers.Contract(USDT_ADDR, USDT_ABI, child);
    const bal = await usdt.balanceOf(child.address);
    if (bal <= 0n) return 0;

    const feeData = await PROVIDER.getFeeData();
    const gasPrice = feeData.gasPrice;
    const gasNeeded = gasPrice * 60000n;

    const masterConnected = MASTER.connect(PROVIDER);
    const masterBal = await PROVIDER.getBalance(masterConnected.address);
    if (masterBal < gasNeeded) { console.log("Master low on BNB for gas"); return 0 }

    const gasTx = await masterConnected.sendTransaction({ to: child.address, value: gasNeeded });
    await gasTx.wait();

    const tx = await usdt.transfer(masterConnected.address, bal);
    await tx.wait();

    const remaining = await PROVIDER.getBalance(child.address);
    const sendBack = remaining - ethers.parseEther("0.000005");
    if (sendBack > 0n) {
      const backTx = await child.sendTransaction({ to: masterConnected.address, value: sendBack });
      await backTx.wait();
    }

    return Number(ethers.formatUnits(bal, 18));
  } catch (e) { console.error("Sweep error for index", index, ":", e.message); return 0 }
}

app.get("/", (req, res) => {
  res.json({ status: "ok", masterAddress: MASTER.address });
});

const TIERS = [
  { min: 10, max: 49, roi: 0.5, cap: 2, label: "Starter" },
  { min: 50, max: 199, roi: 0.8, cap: 2.25, label: "Bronze" },
  { min: 200, max: 499, roi: 1.0, cap: 2.5, label: "Silver" },
  { min: 500, max: 999, roi: 1.25, cap: 3, label: "Gold" }
];

const BOOSTERS = [
  { id: "ignition", name: "Ignition Booster", icon: "⚡", targetDirects: 10, extraRoi: 0.25, durationDays: 30 },
  { id: "quantum", name: "Quantum Booster", icon: "🚀", targetDirects: 25, extraRoi: 0.5, durationDays: 45 },
  { id: "infinity", name: "Infinity Booster", icon: "👑", targetDirects: 50, extraRoi: 1.0, durationDays: 60 }
];

function getBoosterById(id) {
  return BOOSTERS.find(b => b.id === id) || null;
}

async function computeBoosterState(userId, opts = {}) {
  const now = Date.now();
  const user = await db.get("users", String(userId), "telegramId");
  if (!user) throw new Error("User not found");

  const sponsorAmount = Number(user.packageAmount) || 0;
  const sponsorActive = (user.packageStatus || "none") === "active" && sponsorAmount > 0;

  const directs = await db.runQuery({
    table: "users",
    where: { referredBy: { op: "EQUAL", value: String(userId) } },
    limit: 300
  });

  const activeDirectCount = directs.filter(d => {
    const dActive = (d.packageStatus || "none") === "active";
    const dAmount = Number(d.packageAmount) || 0;
    return dActive && dAmount > 0 && dAmount >= sponsorAmount;
  }).length;

  let qualified = null;
  for (const b of BOOSTERS) {
    if (activeDirectCount >= b.targetDirects) qualified = b;
  }

  const currentId = user.boosterLevelId || "none";
  const currentStatus = user.boosterStatus || "locked";
  const currentExpiresAt = Number(user.boosterExpiresAt) || 0;
  const current = getBoosterById(currentId);

  const nextBooster = BOOSTERS.find(b => activeDirectCount < b.targetDirects) || null;
  const updates = {};
  const historyWrites = [];

  let newStatus = currentStatus;
  let activeBooster = current;

  if (!sponsorActive) {
    newStatus = "locked";
    activeBooster = null;
    Object.assign(updates, {
      boosterLevelId: "none", boosterName: "None", boosterExtraROI: 0,
      boosterStatus: "locked", boosterActivatedAt: 0, boosterExpiresAt: 0
    });
  } else {
    if (current && currentStatus === "active" && currentExpiresAt > 0 && now >= currentExpiresAt) {
      newStatus = "expired";
      Object.assign(updates, { boosterStatus: "expired", boosterExtraROI: 0, boosterExpiredAt: now });
      historyWrites.push({
        id: `${userId}_${now}_expired_${current.id}`,
        data: {
          userId: String(userId), boosterId: current.id, boosterName: current.name,
          status: "expired", extraRoi: current.extraRoi, at: now, reason: "duration_ended"
        }
      });
      activeBooster = null;
    }

    if (qualified) {
      const shouldActivate = !activeBooster || activeBooster.id !== qualified.id || newStatus !== "active";
      if (shouldActivate) {
        const expiresAt = now + qualified.durationDays * 86400000;
        Object.assign(updates, {
          boosterLevelId: qualified.id, boosterName: qualified.name,
          boosterExtraROI: qualified.extraRoi, boosterStatus: "active",
          boosterActivatedAt: now, boosterExpiresAt: expiresAt
        });
        newStatus = "active";
        activeBooster = qualified;
        historyWrites.push({
          id: `${userId}_${now}_active_${qualified.id}`,
          data: {
            userId: String(userId), boosterId: qualified.id, boosterName: qualified.name,
            status: "active", extraRoi: qualified.extraRoi, at: now,
            expiresAt, activeDirectCount
          }
        });
      }
    } else if (!activeBooster) {
      Object.assign(updates, {
        boosterLevelId: "none", boosterName: "None", boosterExtraROI: 0,
        boosterStatus: "locked", boosterActivatedAt: 0, boosterExpiresAt: 0
      });
      newStatus = "locked";
    }
  }

  const progressTarget = nextBooster ? nextBooster.targetDirects : (activeBooster ? activeBooster.targetDirects : BOOSTERS[0].targetDirects);
  const progressPct = Math.max(0, Math.min(100, Math.round((activeDirectCount / progressTarget) * 100)));

  if (opts.persist !== false && historyWrites.length > 0) {
    updates.updatedAt = now;
    await db.patch("users", String(userId), updates, "telegramId");
    for (const h of historyWrites) {
      await db.insert("booster_history", h.id, { ...h.data, createdAt: now, updatedAt: now });
    }
  }

  const finalBooster = activeBooster || (qualified && newStatus === "active" ? qualified : null);
  const extraRoi = Number(updates.boosterExtraROI !== undefined ? updates.boosterExtraROI : (user.boosterExtraROI || 0));
  const expiresAt = Number(updates.boosterExpiresAt !== undefined ? updates.boosterExpiresAt : (user.boosterExpiresAt || 0));
  const remainingMs = newStatus === "active" && expiresAt > now ? (expiresAt - now) : 0;

  const totalDirectCount = directs.length;

  return {
    userId: String(userId),
    sponsorPackageAmount: sponsorAmount,
    sponsorPackageStatus: sponsorActive ? "active" : "inactive",
    totalDirectCount,
    activeDirectCount,
    currentBooster: finalBooster ? {
      id: finalBooster.id,
      name: finalBooster.name,
      icon: finalBooster.icon,
      extraRoi,
      durationDays: finalBooster.durationDays,
      targetDirects: finalBooster.targetDirects,
      expiresAt
    } : null,
    boosterStatus: newStatus,
    nextBooster: nextBooster ? {
      id: nextBooster.id,
      name: nextBooster.name,
      icon: nextBooster.icon,
      targetDirects: nextBooster.targetDirects,
      extraRoi: nextBooster.extraRoi,
      durationDays: nextBooster.durationDays
    } : null,
    progress: {
      current: activeDirectCount,
      target: progressTarget,
      pct: progressPct
    },
    remainingMs,
    updatedAt: now,
    levels: BOOSTERS
  };
}

// Get user balance & package info
app.get("/api/balance/:userId", async (req, res) => {
  try {
    const user = await db.get("users", req.params.userId, "telegramId");
    if (!user) return res.json({ depositBalance: 0, activationUSDT: 0, packageAmount: 0, packageROI: 0, packageCap: 0, packageEarned: 0, packageStatus: "none" });
    res.json({
      depositBalance: user.depositBalance || 0,
      activationUSDT: user.activationUSDT || 0,
      packageAmount: user.packageAmount || 0,
      packageROI: user.packageROI || 0,
      packageCap: user.packageCap || 0,
      packageEarned: user.packageEarned || 0,
      packageStatus: user.packageStatus || "none",
      packageMaxEarnings: user.packageMaxEarnings || 0,
      packageCapMultiplier: user.packageCapMultiplier || 0,
      boosterLevelId: user.boosterLevelId || "none",
      boosterName: user.boosterName || "None",
      boosterExtraROI: user.boosterExtraROI || 0,
      boosterStatus: user.boosterStatus || "locked",
      boosterExpiresAt: user.boosterExpiresAt || 0,
      activeDirectsQualified: user.activeDirectsQualified || 0
    });
  } catch (e) { res.status(500).json({ error: e.message }) }
});

app.get("/api/booster/:userId", async (req, res) => {
  try {
    const userId = String(req.params.userId || "");
    if (!userId) return res.status(400).json({ success: false, error: "userId required" });
    const state = await computeBoosterState(userId, { persist: true });

    let history = [];
    try {
      history = await db.runQuery({
        table: "booster_history",
        where: { userId: { op: "EQUAL", value: userId } },
        limit: 20,
        orderBy: { field: "at", direction: "DESC" }
      });
    } catch (e) {
      console.warn("[BOOSTER] History query failed:", e.message);
    }

    res.json({ success: true, ...state, history });
  } catch (e) {
    console.error("[BOOSTER] Endpoint error:", e.message);
    res.json({ success: false, error: e.message });
  }
});

// Buy a package
app.post("/api/buy-package", async (req, res) => {
  try {
    const { userId, amount } = req.body;
    if (!userId || !amount) return res.json({ success: false, error: "userId and amount required" });

    const user = await db.get("users", userId, "telegramId");
    if (!user) return res.json({ success: false, error: "User not found" });

    const depBal = user.depositBalance || 0;
    if (depBal < amount) return res.json({ success: false, error: "Insufficient deposit balance" });

    let tier = null;
    for (const t of TIERS) {
      if (amount >= t.min && amount <= t.max) { tier = t; break; }
    }
    if (!tier) return res.json({ success: false, error: "Amount not in any tier range" });

    const maxEarningsBits = amount * tier.cap * 100;

    const updates = {
      depositBalance: depBal - amount,
      activationUSDT: (user.activationUSDT || 0) + amount,
      packageAmount: amount,
      packageROI: tier.roi,
      packageCapMultiplier: tier.cap,
      packageMaxEarnings: maxEarningsBits,
      packageCap: maxEarningsBits,
      packageEarned: 0,
      packageStatus: "active",
      packageActivatedAt: Date.now()
    };
    if (!user.isActivated10 && amount >= 10) updates.isActivated10 = true;

    try {
      await db.patch("users", userId, updates, "telegramId");
    } catch (e) {
      console.error("[BUY-PACKAGE] patch failed:", e.message);
      return res.json({ success: false, error: "Failed to save package: " + e.message });
    }

    db.insert("packages", userId + "_" + Date.now(), {
      userId: String(userId),
      amount,
      roi: tier.roi,
      capMultiplier: tier.cap,
      maxEarnings: maxEarningsBits,
      totalEarned: 0,
      status: "active",
      activatedAt: Date.now(),
      createdAt: Date.now()
    }).catch(e => console.error("Failed to store package doc:", e.message));

    const COMM_PCTS = [10, 5, 2.5];
    const buyerName = user.firstName || `Player_${String(userId).slice(-4)}`;
    (async () => {
      try {
        let curId = user.referredBy || "";
        for (let level = 0; level < 3 && curId && curId !== "SYSTEM" && curId !== "1001"; level++) {
          const upline = await db.get("users", curId, "telegramId");
          if (!upline) break;
          const commBits = Math.floor(amount * (COMM_PCTS[level] / 100) * 100);
          if (commBits <= 0) { curId = upline.referredBy || ""; continue; }
          await db.patch("users", curId, {
            withdrawableBits: (Number(upline.withdrawableBits) || 0) + commBits,
            bits: (Number(upline.bits) || 0) + commBits,
            totalEarned: (Number(upline.totalEarned) || 0) + commBits,
            referralEarnings: (Number(upline.referralEarnings) || 0) + commBits,
            updatedAt: Date.now()
          }, "telegramId");
          createIncomeEntry({
            userId: curId,
            amount: commBits,
            type: "referral_commission",
            description: `L${level + 1} Referral Commission from package activation`,
            sourceUserId: userId,
            sourceUserName: buyerName,
            level: `L${level + 1}`,
            reason: "Package Activation Commission",
            status: "completed"
          });
          curId = upline.referredBy || "";
        }
      } catch (e) { console.error("[REFERRAL] Commission error:", e.message) }
    })();

    res.json({ success: true, amount, roi: tier.roi, cap: tier.cap, maxEarnings: maxEarningsBits, tier: tier.label });
  } catch (e) { res.status(500).json({ success: false, error: e.message }) }
});

app.post("/api/get-deposit-address", async (req, res) => {
  try {
    const { userId, network, newAddress } = req.body;
    if (!userId) return res.status(400).json({ error: "userId required" });

    let index;
    let depositId;
    if (newAddress) {
      const allocated = await makeUniqueDepositIndex(userId);
      index = allocated.index;
      depositId = allocated.depositId;
    } else {
      let h = 0;
      for (let i = 0; i < userId.length; i++) { h = ((h << 5) - h) + userId.charCodeAt(i); h = h & h }
      index = Math.abs(h) % 100000 + 1;
      depositId = `${String(userId).replace(/[^a-zA-Z0-9_-]/g, "_")}_${index}`;
    }

    const userReady = await ensureUserDoc(String(userId));
    if (!userReady) return res.status(500).json({ success: false, error: "Could not prepare user record" });

    const child = deriveAddress(index);
    await db.insert("deposits", depositId, {
      userId: String(userId),
      network: network || "bep20",
      address: child.address,
      amount: 0,
      status: "pending",
      credited: false,
      swept: false,
      index,
      createdAt: Date.now(),
      updatedAt: Date.now()
    });

    res.json({ success: true, userId, network: network || "bep20", index, address: child.address, depositId, newAddress: !!newAddress });
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
});

app.get("/api/check-deposit/:address", async (req, res) => {
  try {
    const amount = await checkUsdtBalance(req.params.address);
    res.json({ success: true, address: req.params.address, amount });
  } catch (e) { res.json({ success: false, error: e.message }) }
});

// ==== NEW APIs ====

// Add income entry (used by ranks page)
app.post("/api/add-income", async (req, res) => {
  try {
    const { userId, type, amount, extra } = req.body;
    if (!userId) return res.status(400).json({ success: false, error: "userId required" });
    await createIncomeEntry({
      userId: String(userId),
      amount: amount || 0,
      type: type || "",
      description: extra?.description || "",
      sourceUserId: extra?.sourceUserId || "",
      sourceUserName: extra?.sourceUserName || "",
      level: extra?.level || "",
      status: extra?.status || "completed",
      reason: extra?.reason || "",
    });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }) }
});

// Recent users for live feed (MUST be before :userId route)
app.get("/api/users/recent", async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 5, 50);
    const rows = await db.query(
      'SELECT "telegramId", "firstName", "username", "createdAt" FROM users ORDER BY "createdAt" DESC LIMIT $1',
      [limit]
    );
    res.json({ success: true, users: rows.rows });
  } catch (e) { res.status(500).json({ error: e.message }) }
});

// Full user data
app.get("/api/users/:userId", async (req, res) => {
  try {
    const user = await db.get("users", req.params.userId, "telegramId");
    if (!user) return res.status(404).json({ error: "User not found" });
    res.json({ success: true, user });
  } catch (e) { res.status(500).json({ error: e.message }) }
});

// Dashboard stats
app.get("/api/dashboard/:userId", async (req, res) => {
  try {
    const user = await db.get("users", req.params.userId, "telegramId");
    if (!user) return res.status(404).json({ error: "User not found" });

    const directs = await db.runQuery({
      table: "users",
      where: { referredBy: { op: "EQUAL", value: String(req.params.userId) } },
      limit: 300
    });

    const today = new Date().toISOString().split("T")[0];
    const todayIncome = await db.runQuery({
      table: "income_history",
      where: {
        userId: { op: "EQUAL", value: String(req.params.userId) },
        createdAt: { op: "GREATER_THAN_OR_EQUAL", value: new Date().setUTCHours(0, 0, 0, 0) }
      },
      limit: 500
    });

    const teamIds = [req.params.userId, ...directs.map(d => d.telegramId)];
    let teamBusiness = 0;
    for (const tid of teamIds) {
      const tu = await db.get("users", tid, "telegramId");
      if (tu) teamBusiness += Number(tu.activationUSDT) || 0;
    }

    const totalIncome = await db.runQuery({
      table: "income_history",
      where: { userId: { op: "EQUAL", value: String(req.params.userId) } },
      limit: 1,
      orderBy: { field: "createdAt", direction: "DESC" }
    });

    const incomeSum = await db.query(
      `SELECT COALESCE(SUM(amount), 0) as total FROM income_history WHERE "userId" = $1`,
      [String(req.params.userId)]
    );

    res.json({
      success: true,
      user,
      directCount: directs.length,
      teamBusiness,
      todayIncome: todayIncome.reduce((s, i) => s + Number(i.amount), 0),
      totalIncome: Number(incomeSum.rows[0].total),
      withdrawableBits: user.withdrawableBits || 0,
      bits: user.bits || 0
    });
  } catch (e) { res.status(500).json({ error: e.message }) }
});

// Network tree
app.get("/api/network/:userId", async (req, res) => {
  try {
    const userId = String(req.params.userId);
    const level = parseInt(req.query.level) || 1;
    if (level > 10) return res.json({ success: true, members: [] });

    let members = [{ telegramId: userId, level: 0 }];
    const seen = new Set([userId]);

    for (let l = 0; l < level; l++) {
      const currentLevelIds = members.filter(m => m.level === l).map(m => m.telegramId);
      if (!currentLevelIds.length) break;
      const nextLevel = await db.query(
        `SELECT * FROM users WHERE "referredBy" = ANY($1::TEXT[])`,
        [currentLevelIds]
      );
      for (const row of nextLevel.rows) {
        if (!seen.has(row.telegramId)) {
          seen.add(row.telegramId);
          members.push({ ...row, level: l + 1 });
        }
      }
    }

    res.json({ success: true, members: members.filter(m => m.level > 0).slice(0, 200) });
  } catch (e) { res.status(500).json({ error: e.message }) }
});

// Leaderboard
app.get("/api/leaderboard", async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 100, 200);
    const rows = await db.query(
      `SELECT "telegramId", "firstName", "username", "totalEarned" FROM users ORDER BY "totalEarned" DESC LIMIT $1`,
      [limit]
    );
    res.json({ success: true, leaderboard: rows.rows });
  } catch (e) { res.status(500).json({ error: e.message }) }
});

// Income history with pagination & filters
app.get("/api/income/:userId", async (req, res) => {
  try {
    const userId = String(req.params.userId);
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const typeFilter = req.query.type || "";
    const offset = (page - 1) * limit;

    let whereClause = `WHERE "userId" = $1`;
    const params = [userId];
    if (typeFilter) {
      whereClause += ` AND "type" = $2`;
      params.push(typeFilter);
    }

    // Today / Week / Month stats
    const now = Date.now();
    const dayMs = 86400000;
    const todayStart = now - (now % dayMs);
    const weekStart = todayStart - 6 * dayMs;
    const monthStart = todayStart - 29 * dayMs;

    const [todaySum, weekSum, monthSum, lifetimeSum] = await Promise.all([
      db.query(`SELECT COALESCE(SUM(amount),0) as s FROM income_history WHERE "userId"=$1 AND "createdAt">=$2`, [userId, todayStart]),
      db.query(`SELECT COALESCE(SUM(amount),0) as s FROM income_history WHERE "userId"=$1 AND "createdAt">=$2`, [userId, weekStart]),
      db.query(`SELECT COALESCE(SUM(amount),0) as s FROM income_history WHERE "userId"=$1 AND "createdAt">=$2`, [userId, monthStart]),
      db.query(`SELECT COALESCE(SUM(amount),0) as s FROM income_history WHERE "userId"=$1`, [userId])
    ]);

    const countResult = await db.query(`SELECT COUNT(*) as total FROM income_history ${whereClause}`, params);
    const total = parseInt(countResult.rows[0].total);

    const rows = await db.query(
      `SELECT * FROM income_history ${whereClause} ORDER BY "createdAt" DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset]
    );

    res.json({
      success: true,
      entries: rows.rows,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
      stats: {
        today: Number(todaySum.rows[0].s),
        week: Number(weekSum.rows[0].s),
        month: Number(monthSum.rows[0].s),
        lifetime: Number(lifetimeSum.rows[0].s)
      }
    });
  } catch (e) { res.status(500).json({ error: e.message }) }
});

// Rank calculation
app.get("/api/rank/:userId", async (req, res) => {
  try {
    const userId = String(req.params.userId);
    const user = await db.get("users", userId, "telegramId");
    if (!user) return res.status(404).json({ error: "User not found" });

    const RANKS = [
      { name: "R1 - Investor", minBiz: 0, bizReq: 0, directsReq: 0, commission: 15, dailyCap: 10, teamShare: 5, dailyIncome: 2, income: 2, level: 1 },
      { name: "R2 - Senior Investor", minBiz: 5, bizReq: 5, directsReq: 3, commission: 20, dailyCap: 20, teamShare: 5, dailyIncome: 4, income: 4, level: 2 },
      { name: "R3 - Executive", minBiz: 20, bizReq: 20, directsReq: 5, commission: 25, dailyCap: 40, teamShare: 5, dailyIncome: 8, income: 8, level: 3 },
      { name: "R4 - Manager", minBiz: 80, bizReq: 80, directsReq: 6, commission: 30, dailyCap: 80, teamShare: 5, dailyIncome: 16, income: 16, level: 4 },
      { name: "R5 - Senior Manager", minBiz: 300, bizReq: 300, directsReq: 8, commission: 35, dailyCap: 160, teamShare: 5, dailyIncome: 32, income: 32, level: 5 },
      { name: "R6 - Director", minBiz: 1200, bizReq: 1200, directsReq: 10, commission: 40, dailyCap: 320, teamShare: 10, dailyIncome: 64, income: 64, level: 6 },
      { name: "R7 - Senior Director", minBiz: 5000, bizReq: 5000, directsReq: 12, commission: 45, dailyCap: 640, teamShare: 10, dailyIncome: 128, income: 128, level: 7 },
      { name: "R8 - Vice President", minBiz: 20000, bizReq: 20000, directsReq: 15, commission: 50, dailyCap: 1280, teamShare: 10, dailyIncome: 256, income: 256, level: 8 },
      { name: "R9 - Senior Vice President", minBiz: 100000, bizReq: 100000, directsReq: 18, commission: 55, dailyCap: 2560, teamShare: 10, dailyIncome: 512, income: 512, level: 9 },
      { name: "R10 - Emperor", minBiz: 500000, bizReq: 500000, directsReq: 20, commission: 60, dailyCap: 5120, teamShare: 10, dailyIncome: 1024, income: 1024, level: 10 }
    ];

    const directs = await db.runQuery({
      table: "users",
      where: { referredBy: { op: "EQUAL", value: userId } },
      limit: 300
    });
    const directCount = directs.length;

    let teamBusiness = Number(user.activationUSDT) || 0;
    for (const d of directs) {
      teamBusiness += Number(d.activationUSDT) || 0;
      const subDirects = await db.runQuery({
        table: "users",
        where: { referredBy: { op: "EQUAL", value: d.telegramId } },
        limit: 300
      });
      for (const sd of subDirects) {
        teamBusiness += Number(sd.activationUSDT) || 0;
      }
    }

    // Binary leg split
    let leftLegBusiness = 0, rightLegBusiness = 0;
    if (directs.length > 0) {
      for (let i = 0; i < directs.length; i++) {
        const dBiz = Number(directs[i].activationUSDT) || 0;
        if (i === 0) leftLegBusiness += dBiz;
        else rightLegBusiness += dBiz;
      }
    }

    let currentRank = RANKS[0];
    let nextRank = RANKS[1];
    for (let i = RANKS.length - 1; i >= 0; i--) {
      const r = RANKS[i];
      const bizReq = r.bizReq;
      const mainLeg = leftLegBusiness;
      const otherLeg = rightLegBusiness;
      const bizOk = bizReq === 0 || teamBusiness >= bizReq;
      const directsOk = directCount >= r.directsReq;
      const binaryOk = bizReq === 0 || (mainLeg >= bizReq / 2 && otherLeg >= bizReq / 2);
      if (bizOk && directsOk && binaryOk) {
        currentRank = r;
        nextRank = i < RANKS.length - 1 ? RANKS[i + 1] : null;
        break;
      }
    }

    const nextBizNeeded = nextRank ? Math.max(0, nextRank.bizReq - teamBusiness) : 0;
    const nextDirectsNeeded = nextRank ? Math.max(0, nextRank.directsReq - directCount) : 0;
    const bizProgress = nextRank ? Math.min(100, Math.round((teamBusiness / nextRank.bizReq) * 100)) : 100;
    const directsProgress = nextRank ? Math.min(100, Math.round((directCount / nextRank.directsReq) * 100)) : 100;

    res.json({
      success: true,
      currentRank: currentRank.name,
      currentLevel: currentRank.level,
      nextRank: nextRank ? nextRank.name : null,
      nextLevel: nextRank ? nextRank.level : null,
      teamBusiness,
      directCount,
      leftLegBusiness,
      rightLegBusiness,
      binaryCondition: { mainLeg: leftLegBusiness, otherLeg: rightLegBusiness, required: currentRank.bizReq / 2 },
      progress: { bizProgress, directsProgress, nextBizNeeded, nextDirectsNeeded },
      ranks: RANKS
    });
  } catch (e) { res.status(500).json({ error: e.message }) }
});

// Daily claim
app.post("/api/claim-daily", async (req, res) => {
  try {
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ success: false, error: "userId required" });

    const user = await db.get("users", userId, "telegramId");
    if (!user) return res.status(404).json({ success: false, error: "User not found" });

    const today = new Date().toISOString().split("T")[0];

    const existing = await db.get("daily_claims", `${userId}_${today}`, "id");
    if (existing) {
      return res.json({ success: false, error: "Already claimed today" });
    }

    if (user.packageStatus !== "active" || !user.packageAmount) {
      return res.json({ success: false, error: "No active package" });
    }

    const dailyROI = (Number(user.packageAmount) || 0) * ((Number(user.packageROI) || 0) / 100) * 100;
    const boosterExtra = dailyROI * ((Number(user.boosterExtraROI) || 0) / 100);
    const totalDaily = dailyROI + boosterExtra;

    const packageEarned = Number(user.packageEarned) || 0;
    const maxEarnings = Number(user.packageMaxEarnings) || 0;
    const claimable = Math.min(totalDaily, maxEarnings - packageEarned);

    if (claimable <= 0) {
      return res.json({ success: false, error: "Package cap exhausted" });
    }

    const claimId = `${userId}_${today}`;
    await db.insert("daily_claims", claimId, {
      userId,
      date: today,
      claimedAt: Date.now()
    });

    await db.patch("users", userId, {
      packageEarned: packageEarned + claimable,
      withdrawableBits: (Number(user.withdrawableBits) || 0) + claimable,
      bits: (Number(user.bits) || 0) + claimable,
      totalEarned: (Number(user.totalEarned) || 0) + claimable,
      updatedAt: Date.now()
    }, "telegramId");

    createIncomeEntry({
      userId,
      amount: claimable,
      type: "daily_roi",
      description: `Daily ROI ${today}`,
      roi: user.packageROI,
      boosterName: user.boosterName || "",
      extraRoi: user.boosterExtraROI || 0,
      status: "completed"
    });

    res.json({ success: true, claimed: claimable, dailyROI, boosterExtra, packageEarned: packageEarned + claimable });
  } catch (e) { res.status(500).json({ error: e.message }) }
});

// One-time migration endpoint
app.post("/api/migrate", async (req, res) => {
  try {
    const { secret } = req.body;
    if (secret !== "migrate2024") return res.status(403).json({ success: false, error: "Invalid secret" });

    const FIRESTORE_BASE = "https://firestore.googleapis.com/v1/projects/playbits-9e671/databases/(default)/documents";
    const API_KEY = "AIzaSyB1luMRbNVxo_x3IRcdLygIbb0yEUoZAjk";

    async function fetchAll(col) {
      let all = [];
      let pageToken = null;
      while (true) {
        let url = `${FIRESTORE_BASE}/${col}?key=${API_KEY}&pageSize=500`;
        if (pageToken) url += `&pageToken=${pageToken}`;
        const r = await fetch(url);
        if (!r.ok) break;
        const data = await r.json();
        if (!data.documents) break;
        for (const d of data.documents) {
          if (!d.fields) continue;
          const obj = { id: d.name.split("/").pop() };
          for (const [k, v] of Object.entries(d.fields)) {
            if (v.stringValue !== undefined) obj[k] = v.stringValue;
            else if (v.integerValue !== undefined) obj[k] = parseInt(v.integerValue);
            else if (v.doubleValue !== undefined) obj[k] = v.doubleValue;
            else if (v.booleanValue !== undefined) obj[k] = v.booleanValue;
            else if (v.timestampValue) obj[k] = v.timestampValue;
            else obj[k] = v;
          }
          all.push(obj);
        }
        if (!data.nextPageToken) break;
        pageToken = data.nextPageToken;
      }
      return all;
    }

    const results = {};

    const users = await fetchAll("users");
    for (const u of users) {
      u.telegramId = u.telegramId || u.id;
      if (!u.telegramId) continue;
      await db.insert("users", u.telegramId, {
        telegramId: u.telegramId, firstName: u.firstName || `Player_${u.telegramId.slice(-4)}`,
        username: u.username || "", isActive: u.isActive !== false, isActivated10: !!u.isActivated10,
        depositBalance: Number(u.depositBalance) || 0, totalDeposited: Number(u.totalDeposited) || 0,
        activationUSDT: Number(u.activationUSDT) || 0, packageAmount: Number(u.packageAmount) || 0,
        packageStatus: u.packageStatus || "none", packageROI: Number(u.packageROI) || 0,
        packageCapMultiplier: Number(u.packageCapMultiplier) || 0,
        packageMaxEarnings: Number(u.packageMaxEarnings) || 0, packageCap: Number(u.packageCap) || 0,
        packageEarned: Number(u.packageEarned) || 0, packageActivatedAt: Number(u.packageActivatedAt) || 0,
        boosterLevelId: u.boosterLevelId || "none", boosterName: u.boosterName || "None",
        boosterExtraROI: Number(u.boosterExtraROI) || 0, boosterStatus: u.boosterStatus || "locked",
        boosterActivatedAt: Number(u.boosterActivatedAt) || 0, boosterExpiresAt: Number(u.boosterExpiresAt) || 0,
        boosterExpiredAt: Number(u.boosterExpiredAt) || 0,
        activeDirectsQualified: Number(u.activeDirectsQualified) || 0,
        referredBy: u.referredBy || "1001", withdrawableBits: Number(u.withdrawableBits) || 0,
        bits: Number(u.bits) || 0, totalEarned: Number(u.totalEarned) || 0,
        referralEarnings: Number(u.referralEarnings) || 0, totalWithdrawn: Number(u.totalWithdrawn) || 0,
        createdAt: Number(u.createdAt) || 0, updatedAt: Number(u.updatedAt) || 0
      }, "telegramId");
    }
    results.users = users.length;

    const deposits = await fetchAll("deposits");
    for (const d of deposits) {
      try {
        await db.insert("deposits", d.id, {
          userId: d.userId || "", network: d.network || "bep20", address: d.address || "",
          amount: Number(d.amount) || 0, status: d.status || "pending", credited: !!d.credited,
          creditedAt: Number(d.creditedAt) || 0, confirmedAt: Number(d.confirmedAt) || 0,
          swept: !!d.swept, sweptAt: Number(d.sweptAt) || 0, sweepError: d.sweepError || "",
          creditError: d.creditError || "", index: Number(d.index) || 0, txHash: d.txHash || "",
          createdAt: Number(d.createdAt) || 0, updatedAt: Number(d.updatedAt) || 0
        });
      } catch (e) { console.warn("[MIGRATE] Skipped deposit", d.id, e.message) }
    }
    results.deposits = deposits.length;

    const packages = await fetchAll("packages");
    for (const p of packages) {
      try {
        await db.insert("packages", p.id, {
          userId: p.userId || "", amount: Number(p.amount) || 0, roi: Number(p.roi) || 0,
          capMultiplier: Number(p.capMultiplier) || 0, maxEarnings: Number(p.maxEarnings) || 0,
          totalEarned: Number(p.totalEarned) || 0, status: p.status || "active",
          activatedAt: Number(p.activatedAt) || 0, createdAt: Number(p.createdAt) || 0
        });
      } catch (e) { console.warn("[MIGRATE] Skipped package", p.id, e.message) }
    }
    results.packages = packages.length;

    const incomes = await fetchAll("incomeHistory");
    for (const i of incomes) {
      try {
        await db.insert("income_history", i.id, {
          userId: i.userId || "", amount: Number(i.amount) || 0, type: i.type || "",
          description: i.description || "", sourceUserId: i.sourceUserId || "",
          sourceUserName: i.sourceUserName || "", level: i.level || "",
          status: i.status || "completed", packageName: i.packageName || "",
          packageAmount: Number(i.packageAmount) || 0, roi: Number(i.roi) || 0,
          boosterName: i.boosterName || "", extraRoi: Number(i.extraRoi) || 0,
          rankName: i.rankName || "", rewardCycle: i.rewardCycle || "",
          network: i.network || "", txHash: i.txHash || "", walletAddress: i.walletAddress || "",
          reason: i.reason || "", createdAt: Number(i.createdAt) || 0,
          updatedAt: Number(i.updatedAt) || 0
        });
      } catch (e) { console.warn("[MIGRATE] Skipped income", i.id, e.message) }
    }
    results.incomes = incomes.length;

    const boosters = await fetchAll("boosterHistory");
    for (const b of boosters) {
      try {
        await db.insert("booster_history", b.id, {
          userId: b.userId || "", boosterId: b.boosterId || "", boosterName: b.boosterName || "",
          status: b.status || "", extraRoi: Number(b.extraRoi) || 0, at: Number(b.at) || 0,
          expiresAt: Number(b.expiresAt) || 0, activeDirectCount: Number(b.activeDirectCount) || 0,
          reason: b.reason || "", createdAt: Number(b.createdAt) || 0,
          updatedAt: Number(b.updatedAt) || 0
        });
      } catch (e) { console.warn("[MIGRATE] Skipped booster", b.id, e.message) }
    }
    results.boosters = boosters.length;

    res.json({ success: true, message: "Migration complete", results });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Signup
app.post("/api/signup", async (req, res) => {
  try {
    const { userId, firstName, username, referredBy } = req.body;
    if (!userId) return res.status(400).json({ success: false, error: "userId required" });

    const existing = await db.get("users", String(userId), "telegramId");
    if (existing) return res.json({ success: true, alreadyExists: true, user: existing });

    const now = Date.now();
    const finalRef = String(referredBy || "1001");
    const ref = finalRef === String(userId) ? "1001" : finalRef;

    await db.insert("users", String(userId), {
      telegramId: String(userId),
      firstName: firstName || `Player_${String(userId).slice(-4)}`,
      username: username || "",
      isActive: true, isActivated10: false,
      depositBalance: 0, totalDeposited: 0, activationUSDT: 0,
      packageAmount: 0, packageStatus: "none", packageROI: 0,
      packageCapMultiplier: 0, packageMaxEarnings: 0, packageCap: 0, packageEarned: 0, packageActivatedAt: 0,
      boosterLevelId: "none", boosterName: "None", boosterExtraROI: 0,
      boosterStatus: "locked", boosterActivatedAt: 0, boosterExpiresAt: 0, boosterExpiredAt: 0,
      activeDirectsQualified: 0,
      referredBy: ref,
      withdrawableBits: 0, bits: 10, totalEarned: 0, referralEarnings: 0, totalWithdrawn: 0,
      lockedBits: 10, unlockingBits: 0, unlockedFromSignup: 0,
      followClaimed: false, followBits: 0, followClaimedAt: 0,
      lastUnlockDateUTC: "", lastClaimDateUTC: "", lastClaimAt: 0,
      createdAt: now, updatedAt: now
    }, "telegramId");

    // Increment upline's totalDirects
    if (ref !== "SYSTEM" && ref !== "1001") {
      const upline = await db.get("users", ref, "telegramId");
      if (upline) {
        await db.patch("users", ref, {
          activeDirects: (Number(upline.activeDirects) || 0) + 1,
          totalDirects: (Number(upline.totalDirects) || 0) + 1,
          updatedAt: now
        }, "telegramId");
      }
    }

    createIncomeEntry({
      userId: String(userId),
      amount: 10,
      type: "signup_bonus",
      description: "Signup bonus 10 bits",
      status: "locked_7day"
    });

    const user = await db.get("users", String(userId), "telegramId");
    res.json({ success: true, user });
  } catch (e) { res.status(500).json({ error: e.message }) }
});

// Update profile
app.post("/api/update-profile", async (req, res) => {
  try {
    const { userId, firstName, email } = req.body;
    if (!userId) return res.status(400).json({ success: false, error: "userId required" });
    const updates = { updatedAt: Date.now() };
    if (firstName !== undefined) updates.firstName = firstName;
    if (email !== undefined) updates.email = email;
    await db.patch("users", String(userId), updates, "telegramId");
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }) }
});

// Claim package earnings (cap)
app.post("/api/claim-package", async (req, res) => {
  try {
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ success: false, error: "userId required" });

    const user = await db.get("users", String(userId), "telegramId");
    if (!user) return res.status(404).json({ success: false, error: "User not found" });

    if (user.packageStatus !== "active") return res.json({ success: false, error: "No active package" });

    const maxEarnings = Number(user.packageMaxEarnings) || 0;
    const earned = Number(user.packageEarned) || 0;
    const dailyROI = (Number(user.packageAmount) || 0) * ((Number(user.packageROI) || 0) / 100) * 100;
    const boosterExtra = dailyROI * ((Number(user.boosterExtraROI) || 0) / 100);
    const totalDaily = dailyROI + boosterExtra;

    const available = maxEarnings - earned;
    if (available <= 0) return res.json({ success: false, error: "Package cap exhausted" });

    const toClaim = Math.min(totalDaily, available) || totalDaily;
    const now = Date.now();

    const today = new Date().toISOString().split("T")[0];
    const existing = await db.get("daily_claims", `${userId}_${today}`, "id");
    if (existing) return res.json({ success: false, error: "Already claimed today" });

    await db.insert("daily_claims", `${userId}_${today}`, { userId: String(userId), date: today, claimedAt: now });
    await db.patch("users", String(userId), {
      packageEarned: earned + toClaim,
      withdrawableBits: (Number(user.withdrawableBits) || 0) + toClaim,
      bits: (Number(user.bits) || 0) + toClaim,
      totalEarned: (Number(user.totalEarned) || 0) + toClaim,
      updatedAt: now
    }, "telegramId");

    createIncomeEntry({
      userId: String(userId),
      amount: toClaim,
      type: "daily_roi",
      description: `Daily ROI ${today}`,
      status: "completed"
    });

    res.json({ success: true, claimed: toClaim, packageEarned: earned + toClaim });
  } catch (e) { res.status(500).json({ error: e.message }) }
});

// Run unlock (daily bits unlock)
app.post("/api/run-unlock", async (req, res) => {
  try {
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ success: false, error: "userId required" });

    const user = await db.get("users", String(userId), "telegramId");
    if (!user) return res.status(404).json({ success: false, error: "User not found" });

    const today = new Date().toISOString().split("T")[0];
    if (user.lastUnlockDateUTC === today) return res.json({ success: true, alreadyUnlocked: true });

    const locked = Number(user.lockedBits) || 0;
    const unlocking = Number(user.unlockingBits) || 0;
    const followBits = Number(user.followBits) || 0;

    if (locked > 0) {
      const toRelease = Math.min(locked, 1);
      const newLocked = locked - toRelease;
      const newUnlocking = unlocking + toRelease;
      await db.patch("users", String(userId), {
        lockedBits: newLocked, unlockingBits: newUnlocking,
        lastUnlockDateUTC: today, updatedAt: Date.now()
      }, "telegramId");
      return res.json({ success: true, released: toRelease, locked: newLocked, unlocking: newUnlocking });
    }

    if (unlocking > 0) {
      const now = Date.now();
      const createdAt = Number(user.createdAt) || now;
      const daysSinceSignup = Math.floor((now - createdAt) / 86400000);
      if (daysSinceSignup >= 7) {
        const toRelease = Math.min(unlocking, unlocking);
        await db.patch("users", String(userId), {
          unlockingBits: 0, unlockedFromSignup: (Number(user.unlockedFromSignup) || 0) + toRelease,
          bits: (Number(user.bits) || 0) + toRelease,
          lastUnlockDateUTC: today, updatedAt: now
        }, "telegramId");
        return res.json({ success: true, released: toRelease, unlocked: toRelease, unlocking: 0 });
      }
    }

    res.json({ success: true, nothingToUnlock: true });
  } catch (e) { res.status(500).json({ error: e.message }) }
});

// Claim follow bits
app.post("/api/claim-follow", async (req, res) => {
  try {
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ success: false, error: "userId required" });

    const user = await db.get("users", String(userId), "telegramId");
    if (!user) return res.status(404).json({ success: false, error: "User not found" });

    if (user.followClaimed) return res.json({ success: false, error: "Already claimed" });

    const now = Date.now();
    await db.patch("users", String(userId), {
      followClaimed: true, followBits: 10, followClaimedAt: now,
      bits: (Number(user.bits) || 0) + 10,
      updatedAt: now
    }, "telegramId");

    createIncomeEntry({
      userId: String(userId),
      amount: 10,
      type: "follow_bonus",
      description: "Social follow bonus 10 bits",
      status: "locked_45day"
    });

    res.json({ success: true, followBits: 10 });
  } catch (e) { res.status(500).json({ error: e.message }) }
});

// ===== ADMIN ENDPOINTS =====

// Admin dashboard stats
app.get("/api/admin/stats", async (req, res) => {
  try {
    const [users, deposits, withdrawals, income, packages, todayUsers] = await Promise.all([
      db.query('SELECT COUNT(*) as c FROM users'),
      db.query('SELECT COUNT(*) as c, COALESCE(SUM(amount),0) as t FROM deposits'),
      db.query('SELECT COUNT(*) as c, COALESCE(SUM(amount),0) as t FROM withdrawals'),
      db.query('SELECT COUNT(*) as c, COALESCE(SUM(amount),0) as t FROM income_history'),
      db.query('SELECT COUNT(*) as c FROM packages'),
      db.query('SELECT COUNT(*) as c FROM users WHERE "createdAt" > $1', [Date.now() - 86400000])
    ]);
    const pendingWd = await db.query("SELECT COUNT(*) as c FROM withdrawals WHERE status='pending'");
    const pendingDep = await db.query("SELECT COUNT(*) as c FROM deposits WHERE status='pending'");
    res.json({
      success: true,
      stats: {
        totalUsers: parseInt(users.rows[0].c),
        todayUsers: parseInt(todayUsers.rows[0].c),
        totalDeposits: parseInt(deposits.rows[0].c),
        totalDepositAmount: Number(deposits.rows[0].t),
        totalWithdrawals: parseInt(withdrawals.rows[0].c),
        totalWithdrawalAmount: Number(withdrawals.rows[0].t),
        totalIncome: parseInt(income.rows[0].c),
        totalIncomeAmount: Number(income.rows[0].t),
        totalPackages: parseInt(packages.rows[0].c),
        pendingWithdrawals: parseInt(pendingWd.rows[0].c),
        pendingDeposits: parseInt(pendingDep.rows[0].c)
      }
    });
  } catch (e) { res.status(500).json({ error: e.message }) }
});

// Admin: get all users
app.get("/api/admin/users", async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const offset = (page - 1) * limit;
    const search = req.query.search || "";
    let whereClause = "";
    const params = [];
    if (search) {
      whereClause = `WHERE "telegramId"::TEXT LIKE $1 OR "firstName" ILIKE $1 OR "username" ILIKE $1`;
      params.push(`%${search}%`);
    }
    const countResult = await db.query(`SELECT COUNT(*) as total FROM users ${whereClause}`, params);
    const total = parseInt(countResult.rows[0].total);
    const rows = await db.query(
      `SELECT "telegramId", "firstName", "username", "referredBy", "depositBalance", "activationUSDT",
              "packageStatus", "packageAmount", "bits", "withdrawableBits", "totalEarned", "totalWithdrawn",
              "isActive", "createdAt", "updatedAt"
       FROM users ${whereClause} ORDER BY "createdAt" DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset]
    );
    res.json({ success: true, users: rows.rows, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
  } catch (e) { res.status(500).json({ error: e.message }) }
});

// Admin: get all deposits
app.get("/api/admin/deposits", async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const offset = (page - 1) * limit;
    const countResult = await db.query('SELECT COUNT(*) as total FROM deposits');
    const total = parseInt(countResult.rows[0].total);
    const rows = await db.query(
      'SELECT * FROM deposits ORDER BY "createdAt" DESC LIMIT $1 OFFSET $2', [limit, offset]
    );
    res.json({ success: true, deposits: rows.rows, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
  } catch (e) { res.status(500).json({ error: e.message }) }
});

// Admin: get all withdrawals with user info
app.get("/api/admin/withdrawals", async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const offset = (page - 1) * limit;
    const countResult = await db.query('SELECT COUNT(*) as total FROM withdrawals');
    const total = parseInt(countResult.rows[0].total);
    const rows = await db.query(
      `SELECT w.*, u."firstName", u."username"
       FROM withdrawals w LEFT JOIN users u ON w."telegramId" = u."telegramId"
       ORDER BY w."createdAt" DESC LIMIT $1 OFFSET $2`, [limit, offset]
    );
    res.json({ success: true, withdrawals: rows.rows, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
  } catch (e) { res.status(500).json({ error: e.message }) }
});

// Admin: get all income history
app.get("/api/admin/income", async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const offset = (page - 1) * limit;
    const typeFilter = req.query.type || "";
    let whereClause = "";
    const params = [];
    if (typeFilter) {
      whereClause = 'WHERE "type" = $1';
      params.push(typeFilter);
    }
    const countResult = await db.query(`SELECT COUNT(*) as total FROM income_history ${whereClause}`, params);
    const total = parseInt(countResult.rows[0].total);
    const rows = await db.query(
      `SELECT * FROM income_history ${whereClause} ORDER BY "createdAt" DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset]
    );
    res.json({ success: true, entries: rows.rows, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
  } catch (e) { res.status(500).json({ error: e.message }) }
});

// Admin: approve withdrawal
app.post("/api/admin/withdraw/approve", async (req, res) => {
  try {
    const { id } = req.body;
    if (!id) return res.status(400).json({ error: "id required" });
    await db.patch("withdrawals", id, { status: "approved", updatedAt: Date.now() });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }) }
});

// Admin: reject withdrawal
app.post("/api/admin/withdraw/reject", async (req, res) => {
  try {
    const { id } = req.body;
    if (!id) return res.status(400).json({ error: "id required" });
    const wd = await db.get("withdrawals", id, "id");
    await db.patch("withdrawals", id, { status: "rejected", updatedAt: Date.now() });
    if (wd) {
      const user = await db.get("users", wd.telegramId, "telegramId");
      if (user) {
        await db.patch("users", wd.telegramId, {
          withdrawableBits: (Number(user.withdrawableBits) || 0) + Number(wd.amount),
          bits: (Number(user.bits) || 0) + Number(wd.amount),
          totalWithdrawn: Math.max(0, (Number(user.totalWithdrawn) || 0) - Number(wd.amount)),
          updatedAt: Date.now()
        }, "telegramId");
      }
    }
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }) }
});

// ===== WITHDRAW =====

// Withdraw
app.post("/api/withdraw", async (req, res) => {
  try {
    const { userId, amount, address, network } = req.body;
    if (!userId || !amount || !address) return res.status(400).json({ success: false, error: "Missing fields" });

    const user = await db.get("users", String(userId), "telegramId");
    if (!user) return res.status(404).json({ success: false, error: "User not found" });

    const withdrawable = Number(user.withdrawableBits) || 0;
    if (withdrawable < amount) return res.json({ success: false, error: "Insufficient withdrawable balance" });

    const now = Date.now();
    const id = `${userId}_${now}`;

    await db.insert("withdrawals", id, {
      telegramId: String(userId), amount: Number(amount), address, network: network || "BEP20",
      status: "pending", createdAt: now, updatedAt: now
    });

    await db.patch("users", String(userId), {
      withdrawableBits: withdrawable - Number(amount),
      bits: (Number(user.bits) || 0) - Number(amount),
      totalWithdrawn: (Number(user.totalWithdrawn) || 0) + Number(amount),
      updatedAt: now
    }, "telegramId");

    createIncomeEntry({
      userId: String(userId),
      amount: Number(amount),
      type: "withdrawal",
      description: `Withdrawal request - ${network || "BEP20"}`,
      status: "pending",
      network: network || "BEP20",
      walletAddress: address
    });

    res.json({ success: true, id });
  } catch (e) { res.status(500).json({ error: e.message }) }
});

// Get withdrawals
app.get("/api/withdrawals", async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const rows = await db.query(
      'SELECT * FROM withdrawals ORDER BY "createdAt" DESC LIMIT $1', [limit]
    );
    res.json({ success: true, withdrawals: rows.rows });
  } catch (e) { res.status(500).json({ error: e.message }) }
});

// Get deposits by userId
app.get("/api/deposits/:userId", async (req, res) => {
  try {
    const deposits = await db.runQuery({
      table: "deposits",
      where: { userId: { op: "EQUAL", value: String(req.params.userId) } },
      limit: 50,
      orderBy: { field: "createdAt", direction: "DESC" }
    });
    res.json({ success: true, deposits });
  } catch (e) { res.status(500).json({ error: e.message }) }
});

// Claim orbit reward
app.post("/api/claim-orbit", async (req, res) => {
  try {
    const { userId, rankName } = req.body;
    if (!userId) return res.status(400).json({ success: false, error: "userId required" });

    const user = await db.get("users", String(userId), "telegramId");
    if (!user) return res.status(404).json({ success: false, error: "User not found" });

    const now = Date.now();
    const id = `${userId}_orbit_${rankName || "unknown"}_${now}`;

    await db.insert("orbit_rewards", id, {
      userId: String(userId), rankName: rankName || "", rewardCycle: "manual",
      amount: 0, status: "claimed", claimedAt: now, createdAt: now, updatedAt: now
    });

    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }) }
});

// Claim rank daily reward
app.post("/api/claim-rank-reward", async (req, res) => {
  try {
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ success: false, error: "userId required" });

    const user = await db.get("users", String(userId), "telegramId");
    if (!user) return res.status(404).json({ success: false, error: "User not found" });

    const today = new Date().toISOString().split("T")[0];
    const existing = await db.get("daily_claims", `${userId}_daily_rank_${today}`, "id");
    if (existing) return res.json({ success: false, error: "Already claimed today" });

    const now = Date.now();
    const claimId = `${userId}_daily_rank_${today}`;
    await db.insert("daily_claims", claimId, { userId: String(userId), date: today, claimedAt: now });

    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }) }
});

// Monitor: scan pending deposits created in the last 48h
const DEPOSIT_TTL_MS = 48 * 60 * 60 * 1000;
let monitorRunning = false;
async function monitorDeposits() {
  if (monitorRunning) {
    console.log("[MONITOR] Previous run still active, skipping");
    return;
  }
  monitorRunning = true;
  console.log("[MONITOR] Checking pending deposits...");
  try {
    const cutoff = Date.now() - DEPOSIT_TTL_MS;
    const deposits = await db.runQuery({
      table: "deposits",
      where: {
        status: { op: "EQUAL", value: "pending" },
        createdAt: { op: "GREATER_THAN_OR_EQUAL", value: cutoff }
      },
      limit: 50
    });

    for (const doc of deposits) {
      const balance = await checkUsdtBalance(doc.address);
      console.log(`[MONITOR] ${doc.address} (user: ${doc.userId}) → ${balance} USDT`);

      if (balance >= 0.01) {
        console.log(`[MONITOR] Deposit detected! ${balance} USDT at ${doc.address}`);

        let user = await db.get("users", doc.userId, "telegramId");
        if (!user) {
          console.log(`[MONITOR] User missing for ${doc.userId}; creating...`);
          await ensureUserDoc(doc.userId);
        }

        await commitDepositCredit({
          depositDocId: doc.id,
          userId: doc.userId,
          amount: balance,
          address: doc.address,
          txHash: doc.txHash || ""
        });

        console.log(`[MONITOR] Credited ${balance} USDT to user ${doc.userId}`);
        createIncomeEntry({
          userId: doc.userId,
          amount: balance * 100,
          type: "deposit",
          description: `Deposit of ${balance} USDT`,
          status: "completed",
          txHash: doc.txHash || "",
          walletAddress: doc.address,
          network: "BEP20"
        }).catch(() => {});

        const swept = await sweepChild(doc.index);
        if (swept > 0) {
          console.log(`[MONITOR] Swept ${swept} USDT from child ${doc.index} to master`);
          await db.patch("deposits", doc.id, { swept: true, sweptAt: Date.now(), sweepError: "" });
        }
      }
    }
  } catch (e) { console.error("[MONITOR] Error:", e.message) }
  finally { monitorRunning = false }
}

async function retryUnsweptDeposits() {
  const deposits = await db.runQuery({
    table: "deposits",
    where: { swept: { op: "EQUAL", value: false } },
    limit: 50
  });

  for (const item of deposits) {
    try {
      if (item.status !== "confirmed") continue;
      if (!item.index) continue;

      const swept = await sweepChild(item.index);
      if (swept > 0) {
        console.log(`[MONITOR] Retry swept ${swept} USDT from child ${item.index}`);
        await db.patch("deposits", item.id, { swept: true, sweptAt: Date.now(), sweepError: "" });
      } else {
        await db.patch("deposits", item.id, { sweepError: "No sweepable balance or gas unavailable", updatedAt: Date.now() });
      }
    } catch (e) {
      console.error("[UNSWEPT] Error processing", item.id, e.message);
    }
  }
}

const PORT = process.env.PORT || 3000;
const MONITOR_INTERVAL_MS = Number(process.env.MONITOR_INTERVAL_MS || 120000);
const UNSWEPT_INTERVAL_MS = Number(process.env.UNSWEPT_INTERVAL_MS || 600000);

initSchema().then(() => {
  app.listen(PORT, "0.0.0.0", () => {
    console.log("PLAYBITS Backend running on port " + PORT);
    console.log("Master address:", MASTER.address);
    setTimeout(monitorDeposits, 30000);
    console.log("Deposit monitor every " + Math.floor(MONITOR_INTERVAL_MS / 1000) + "s...");
    setInterval(monitorDeposits, MONITOR_INTERVAL_MS);
    setTimeout(() => {
      retryUnsweptDeposits();
      setInterval(retryUnsweptDeposits, UNSWEPT_INTERVAL_MS);
    }, 120000);
    console.log("Unswept retry every " + Math.floor(UNSWEPT_INTERVAL_MS / 60) + "min...");
  });
}).catch(e => {
  console.error("[SERVER] Schema init failed:", e);
  process.exit(1);
});
