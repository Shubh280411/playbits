const express = require("express");
const cors = require("cors");
const { ethers, HDNodeWallet } = require("ethers");
const crypto = require("crypto");

require("dotenv").config();

if (!process.env.MNEMONIC) {
  console.error("[FATAL] MNEMONIC env var is required. Set it in .env or environment variables.");
  process.exit(1);
}
const MNEMONIC = process.env.MNEMONIC;
const MASTER = HDNodeWallet.fromPhrase(MNEMONIC);
const BSC_RPC = "https://bsc-dataseed.binance.org";
const PROVIDER = new ethers.JsonRpcProvider(BSC_RPC);
const USDT_ADDR = "0x55d398326f99059fF775485246999027B3197955";
const USDT_ABI = ["function balanceOf(address) view returns (uint256)", "function transfer(address,uint256) returns (bool)"];
const FIRESTORE_BASE = "https://firestore.googleapis.com/v1/projects/playbits-9e671/databases/(default)/documents";
const API_KEY = "AIzaSyB1luMRbNVxo_x3IRcdLygIbb0yEUoZAjk";

const app = express();
app.use(cors());
app.use(express.json());

function toVal(v) {
  if (typeof v === "string") return { stringValue: v };
  if (typeof v === "number") {
    if (Number.isInteger(v)) return { integerValue: String(v) };
    return { doubleValue: v };
  }
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === "boolean") return { booleanValue: v };
  return { stringValue: String(v) };
}

async function fireGet(col, docId) {
  try {
    const res = await fetch(`${FIRESTORE_BASE}/${col}/${docId}?key=${API_KEY}`);
    if (!res.ok) return null;
    const d = await res.json();
    if (!d.fields) return null;
    const obj = {};
    for (const [k, v] of Object.entries(d.fields)) {
      if (v.stringValue !== undefined) obj[k] = v.stringValue;
      else if (v.integerValue !== undefined) obj[k] = parseInt(v.integerValue);
      else if (v.doubleValue !== undefined) obj[k] = v.doubleValue;
      else if (v.booleanValue !== undefined) obj[k] = v.booleanValue;
      else if (v.timestampValue) obj[k] = v.timestampValue;
      else obj[k] = v;
    }
    return obj;
  } catch(e) { return null }
}

async function firePatch(col, docId, updates) {
  const masks = Object.keys(updates).map(f => "updateMask.fieldPaths=" + f).join("&");
  const fields = {};
  for (const [k, v] of Object.entries(updates)) fields[k] = toVal(v);
  const res = await fetch(`${FIRESTORE_BASE}/${col}/${docId}?key=${API_KEY}&${masks}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fields })
  });
  if (!res.ok) {
    const txt = await res.text();
    console.error(`[FIRESTORE] Patch failed for ${col}/${docId}:`, txt);
    throw new Error("Firestore update failed: " + txt);
  }
  return true;
}

async function fireSet(col, docId, updates) {
  try {
    const fields = {};
    for (const [k, v] of Object.entries(updates)) fields[k] = toVal(v);
    const res = await fetch(`${FIRESTORE_BASE}/${col}/${docId}?key=${API_KEY}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fields })
    });
    if (!res.ok) throw new Error(await res.text());
    return true;
  } catch(e) {
    console.error(`[FIRESTORE] Set failed for ${col}/${docId}:`, e.message);
    return false;
  }
}

async function fireCommitDepositCredit({ depositDocId, userId, amount, address, txHash = "" }) {
  const now = Date.now();
  const depositName = `projects/playbits-9e671/databases/(default)/documents/deposits/${depositDocId}`;
  const userName = `projects/playbits-9e671/databases/(default)/documents/users/${userId}`;
  const user = await fireGet("users", userId);
  const userFields = {
    telegramId: toVal(String(userId)),
    firstName: toVal(user?.firstName || `Player_${String(userId).slice(-4)}`),
    username: toVal(user?.username || ""),
    isActive: toVal(user?.isActive !== false),
    depositBalance: toVal((Number(user?.depositBalance) || 0) + amount),
    totalDeposited: toVal((Number(user?.totalDeposited) || 0) + amount),
    activationUSDT: toVal(Number(user?.activationUSDT) || 0),
    packageAmount: toVal(Number(user?.packageAmount) || 0),
    packageStatus: toVal(user?.packageStatus || "none"),
    updatedAt: toVal(now)
  };
  if (!user) userFields.createdAt = toVal(now);

  const depositFields = {
    status: toVal("confirmed"),
    amount: toVal(amount),
    credited: toVal(true),
    creditedAt: toVal(now),
    confirmedAt: toVal(now),
    updatedAt: toVal(now),
    txHash: toVal(txHash),
    address: toVal(address)
  };

  const body = {
    writes: [
      {
        update: { name: depositName, fields: depositFields },
        updateMask: { fieldPaths: Object.keys(depositFields) },
        currentDocument: { exists: true }
      },
      {
        update: { name: userName, fields: userFields },
        updateMask: { fieldPaths: Object.keys(userFields) }
      }
    ]
  };

  const res = await fetch(`${FIRESTORE_BASE}:commit?key=${API_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(await res.text());
  return true;
}

async function ensureUserDoc(userId) {
  const existing = await fireGet("users", userId);
  if (existing) return true;
  return fireSet("users", userId, {
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
    updatedAt: Date.now()
  });
}

async function makeUniqueDepositIndex(userId) {
  for (let i = 0; i < 3; i++) {
    const index = crypto.randomInt(1, 2147483647);
    const depositId = `${String(userId).replace(/[^a-zA-Z0-9_-]/g, "_")}_${index}`;
    const existing = await fireGet("deposits", depositId);
    if (!existing) return { index, depositId };
  }
  // Fallback: use timestamp-based ID to avoid extra reads
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
  } catch(e) { return 0 }
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

    // Send gas
    const gasTx = await masterConnected.sendTransaction({ to: child.address, value: gasNeeded });
    await gasTx.wait();

    // Sweep USDT
    const tx = await usdt.transfer(masterConnected.address, bal);
    await tx.wait();

    // Return leftover BNB
    const remaining = await PROVIDER.getBalance(child.address);
    const sendBack = remaining - ethers.parseEther("0.000005");
    if (sendBack > 0n) {
      const backTx = await child.sendTransaction({ to: masterConnected.address, value: sendBack });
      await backTx.wait();
    }

    return Number(ethers.formatUnits(bal, 18));
  } catch(e) { console.error("Sweep error for index", index, ":", e.message); return 0 }
}

// Health
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

async function runQuery(structuredQuery) {
  const queryUrl = `${FIRESTORE_BASE}:runQuery?key=${API_KEY}`;
  const res = await fetch(queryUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ structuredQuery })
  });
  if (!res.ok) throw new Error(await res.text());
  const data = await res.json();
  const docs = [];
  for (const item of data || []) {
    if (!item.document || !item.document.fields) continue;
    const fields = item.document.fields;
    const obj = { id: item.document.name.split("/").pop() };
    for (const [k, v] of Object.entries(fields)) {
      if (v.stringValue !== undefined) obj[k] = v.stringValue;
      else if (v.integerValue !== undefined) obj[k] = parseInt(v.integerValue);
      else if (v.doubleValue !== undefined) obj[k] = v.doubleValue;
      else if (v.booleanValue !== undefined) obj[k] = v.booleanValue;
      else if (v.timestampValue) obj[k] = v.timestampValue;
      else obj[k] = v;
    }
    docs.push(obj);
  }
  return docs;
}

function getBoosterById(id) {
  return BOOSTERS.find(b => b.id === id) || null;
}

async function computeBoosterState(userId, opts = {}) {
  const now = Date.now();
  const user = await fireGet("users", String(userId));
  if (!user) throw new Error("User not found");

  const sponsorAmount = Number(user.packageAmount) || 0;
  const sponsorActive = (user.packageStatus || "none") === "active" && sponsorAmount > 0;

  const directs = await runQuery({
    from: [{ collectionId: "users" }],
    where: {
      fieldFilter: {
        field: { fieldPath: "referredBy" },
        op: "EQUAL",
        value: { stringValue: String(userId) }
      }
    },
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

  let nextBooster = BOOSTERS.find(b => activeDirectCount < b.targetDirects) || null;
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

  // Only persist on actual state change to avoid unnecessary Firestore writes
  if (opts.persist !== false && historyWrites.length > 0) {
    updates.updatedAt = now;
    await firePatch("users", String(userId), updates);
    for (const h of historyWrites) {
      await fireSet("boosterHistory", h.id, { ...h.data, createdAt: now, updatedAt: now });
    }
  }

  const finalBooster = activeBooster || (qualified && newStatus === "active" ? qualified : null);
  const extraRoi = Number(updates.boosterExtraROI !== undefined ? updates.boosterExtraROI : (user.boosterExtraROI || 0));
  const expiresAt = Number(updates.boosterExpiresAt !== undefined ? updates.boosterExpiresAt : (user.boosterExpiresAt || 0));
  const remainingMs = newStatus === "active" && expiresAt > now ? (expiresAt - now) : 0;

  return {
    userId: String(userId),
    sponsorPackageAmount: sponsorAmount,
    sponsorPackageStatus: sponsorActive ? "active" : "inactive",
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
    const user = await fireGet("users", req.params.userId);
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
  } catch(e) { res.status(500).json({ error: e.message }) }
});

app.get("/api/booster/:userId", async (req, res) => {
  try {
    const userId = String(req.params.userId || "");
    if (!userId) return res.status(400).json({ success: false, error: "userId required" });
    const state = await computeBoosterState(userId, { persist: true });

    let history = [];
    try {
      const raw = await runQuery({
        from: [{ collectionId: "boosterHistory" }],
        where: {
          fieldFilter: {
            field: { fieldPath: "userId" },
            op: "EQUAL",
            value: { stringValue: userId }
          }
        }
      });
      history = raw.sort((a, b) => (Number(b.at) || 0) - (Number(a.at) || 0)).slice(0, 20);
    } catch(e) {
      console.warn("[BOOSTER] History query failed (index may not exist yet):", e.message);
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

    const user = await fireGet("users", userId);
    if (!user) return res.json({ success: false, error: "User not found" });

    const depBal = user.depositBalance || 0;
    if (depBal < amount) return res.json({ success: false, error: "Insufficient deposit balance" });

    let tier = null;
    for (const t of TIERS) {
      if (amount >= t.min && amount <= t.max) { tier = t; break; }
    }
    if (!tier) return res.json({ success: false, error: "Amount not in any tier range" });

    const maxEarningsBits = amount * tier.cap * 100;

    // Deduct from depositBalance, set package fields
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
      await firePatch("users", userId, updates);
    } catch(e) {
      console.error("[BUY-PACKAGE] firePatch failed:", e.message);
      return res.json({ success: false, error: "Failed to save package: " + e.message });
    }

    // Store package doc (non-blocking — best effort)
    fireSet("packages", userId + "_" + Date.now(), {
      userId: String(userId),
      amount,
      roi: tier.roi,
      capMultiplier: tier.cap,
      maxEarnings: maxEarningsBits,
      totalEarned: 0,
      status: "active",
      activatedAt: Date.now()
    }).catch(e => console.error("Failed to store package doc:", e.message));

    res.json({ success: true, amount, roi: tier.roi, cap: tier.cap, maxEarnings: maxEarningsBits, tier: tier.label });
  } catch(e) { res.status(500).json({ success: false, error: e.message }) }
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
    const saved = await fireSet("deposits", depositId, {
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
    if (!saved) return res.status(500).json({ success: false, error: "Could not save deposit record" });

    res.json({ success: true, userId, network: network || "bep20", index, address: child.address, depositId, newAddress: !!newAddress });
  } catch(e) {
    res.status(500).json({ error: e.message })
  }
});

// Check USDT balance for a specific address
app.get("/api/check-deposit/:address", async (req, res) => {
  try {
    const amount = await checkUsdtBalance(req.params.address);
    res.json({ success: true, address: req.params.address, amount });
  } catch(e) { res.json({ success: false, error: e.message }) }
});

// Monitor: scan pending deposits created in the last 48h, expire old ones
const DEPOSIT_TTL_MS = 48 * 60 * 60 * 1000; // 48 hours
let monitorRunning = false;
async function monitorDeposits() {
  if (monitorRunning) {
    console.log("[MONITOR] Previous run still active, skipping this tick");
    return;
  }
  monitorRunning = true;
  console.log("[MONITOR] Checking pending deposits...");
  try {
    const cutoff = Date.now() - DEPOSIT_TTL_MS;
    const queryUrl = `${FIRESTORE_BASE}:runQuery?key=${API_KEY}`;
    const body = {
      structuredQuery: {
        from: [{ collectionId: "deposits" }],
        where: {
          compositeFilter: {
            op: "AND",
            filters: [
              {
                fieldFilter: {
                  field: { fieldPath: "status" },
                  op: "EQUAL",
                  value: { stringValue: "pending" }
                }
              },
              {
                fieldFilter: {
                  field: { fieldPath: "createdAt" },
                  op: "GREATER_THAN_OR_EQUAL",
                  value: { integerValue: String(cutoff) }
                }
              }
            ]
          }
        },
        limit: 50
      }
    };
    const qres = await fetch(queryUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!qres.ok) { console.log("[MONITOR] Query failed:", await qres.text()); return }
    const data = await qres.json();
    if (!data || data.length === 0) { console.log("[MONITOR] No pending deposits") }

    for (const item of data || []) {
      if (!item.document || !item.document.fields) continue;
      const docId = item.document.name.split("/").pop();
      const fields = item.document.fields;
      const userId = fields.userId?.stringValue || "";
      const address = fields.address?.stringValue || "";
      const depositIndex = fields.index ? parseInt(fields.index.integerValue || fields.index.stringValue || "0") : 0;
      const credited = fields.credited?.booleanValue || false;

      if (!address || !userId || credited) continue;

      const balance = await checkUsdtBalance(address);
      console.log(`[MONITOR] ${address} (user: ${userId}) → ${balance} USDT`);

      if (balance >= 0.01) {
        console.log(`[MONITOR] Deposit detected! ${balance} USDT at ${address}`);

        const user = await fireGet("users", userId);
        if (!user) {
          console.log(`[MONITOR] User document missing for ${userId}; creating it in Firebase`);
          const userReady = await ensureUserDoc(userId);
          if (!userReady) {
            await firePatch("deposits", docId, {
              creditError: `Could not prepare user record: ${userId}`,
              updatedAt: Date.now()
            });
            continue;
          }
        }

        await fireCommitDepositCredit({ depositDocId: docId, userId, amount: balance, address });

        console.log(`[MONITOR] Credited ${balance} USDT to user ${userId}`);

        const swept = await sweepChild(depositIndex);
        if (swept > 0) {
          console.log(`[MONITOR] Swept ${swept} USDT from child ${depositIndex} to master`);
          await firePatch("deposits", docId, { swept: true, sweptAt: Date.now(), sweepError: "" });
        }
      }
    }
  } catch(e) { console.error("[MONITOR] Error:", e.message) }
  finally {
    monitorRunning = false
  }
}

async function retryUnsweptDeposits() {
  const queryUrl = `${FIRESTORE_BASE}:runQuery?key=${API_KEY}`;
  const body = {
    structuredQuery: {
      from: [{ collectionId: "deposits" }],
      where: {
        fieldFilter: {
          field: { fieldPath: "swept" },
          op: "EQUAL",
          value: { booleanValue: false }
        }
      },
      limit: 50
    }
  };

  const qres = await fetch(queryUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!qres.ok) {
    console.log("[MONITOR] Unswept query failed:", await qres.text());
    return;
  }

  const data = await qres.json();
  for (const item of data) {
    try {
      if (!item.document || !item.document.fields) continue;
      const docId = item.document.name.split("/").pop();
      const fields = item.document.fields;
      const status = fields.status?.stringValue || "";
      const depositIndex = fields.index ? parseInt(fields.index.integerValue || fields.index.stringValue || "0") : 0;
      if (status !== "confirmed") continue;
      if (!depositIndex) continue;

      const swept = await sweepChild(depositIndex);
      if (swept > 0) {
        console.log(`[MONITOR] Retry swept ${swept} USDT from child ${depositIndex}`);
        await firePatch("deposits", docId, { swept: true, sweptAt: Date.now(), sweepError: "" });
      } else {
        await firePatch("deposits", docId, { sweepError: "No sweepable balance or gas unavailable", updatedAt: Date.now() });
      }
    } catch(e) {
      console.error("[UNSWEPT] Error processing", item.document?.name, e.message);
    }
  }
}

const PORT = process.env.PORT || 3000;
const MONITOR_INTERVAL_MS = Number(process.env.MONITOR_INTERVAL_MS || 120000);
const UNSWEPT_INTERVAL_MS = Number(process.env.UNSWEPT_INTERVAL_MS || 600000);
app.listen(PORT, "0.0.0.0", () => {
  console.log("PLAYBITS Backend running on port " + PORT);
  console.log("Master address:", MASTER.address);
  setTimeout(monitorDeposits, 30000);
  console.log("Deposit monitor every " + Math.floor(MONITOR_INTERVAL_MS / 1000) + " seconds (initial delay 30s)...");
  setInterval(monitorDeposits, MONITOR_INTERVAL_MS);
  setTimeout(() => {
    retryUnsweptDeposits();
    setInterval(retryUnsweptDeposits, UNSWEPT_INTERVAL_MS);
  }, 120000);
  console.log("Unswept retry every " + Math.floor(UNSWEPT_INTERVAL_MS / 60) + " minutes...");
});
