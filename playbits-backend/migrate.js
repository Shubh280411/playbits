require("dotenv").config();
const db = require("./db");
const { readdirSync, existsSync, readFileSync } = require("fs");

const FIRESTORE_BASE = "https://firestore.googleapis.com/v1/projects/playbits-9e671/databases/(default)/documents";
const API_KEY = "AIzaSyB1luMRbNVxo_x3IRcdLygIbb0yEUoZAjk";

function toObj(doc) {
  if (!doc || !doc.fields) return null;
  const obj = { id: doc.name.split("/").pop() };
  for (const [k, v] of Object.entries(doc.fields)) {
    if (v.stringValue !== undefined) obj[k] = v.stringValue;
    else if (v.integerValue !== undefined) obj[k] = parseInt(v.integerValue);
    else if (v.doubleValue !== undefined) obj[k] = v.doubleValue;
    else if (v.booleanValue !== undefined) obj[k] = v.booleanValue;
    else if (v.timestampValue) obj[k] = v.timestampValue;
    else obj[k] = v;
  }
  return obj;
}

async function fetchAll(col, limit = 500) {
  let all = [];
  let pageToken = null;
  while (true) {
    let url = `${FIRESTORE_BASE}/${col}?key=${API_KEY}&pageSize=${limit}`;
    if (pageToken) url += `&pageToken=${pageToken}`;
    const res = await fetch(url);
    if (!res.ok) { console.error(`[MIGRATE] Failed to fetch ${col}:`, await res.text()); break; }
    const data = await res.json();
    if (!data.documents) break;
    all = all.concat(data.documents.map(toObj).filter(Boolean));
    if (!data.nextPageToken) break;
    pageToken = data.nextPageToken;
  }
  return all;
}

async function fetchAllWithQuery(col, queryBody) {
  const url = `${FIRESTORE_BASE}:runQuery?key=${API_KEY}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(queryBody)
  });
  if (!res.ok) { console.error(`[MIGRATE] Query ${col} failed:`, await res.text()); return []; }
  const data = await res.json();
  return data.filter(d => d.document).map(d => toObj(d.document)).filter(Boolean);
}

function fixUser(u) {
  u.telegramId = u.telegramId || u.id;
  u.firstName = u.firstName || `Player_${String(u.telegramId).slice(-4)}`;
  if (u.isActive === undefined) u.isActive = true;
  if (u.isActivated10 === undefined) u.isActivated10 = false;
  u.depositBalance = Number(u.depositBalance) || 0;
  u.totalDeposited = Number(u.totalDeposited) || 0;
  u.activationUSDT = Number(u.activationUSDT) || 0;
  u.packageAmount = Number(u.packageAmount) || 0;
  u.packageStatus = u.packageStatus || "none";
  u.packageROI = Number(u.packageROI) || 0;
  u.packageCapMultiplier = Number(u.packageCapMultiplier) || 0;
  u.packageMaxEarnings = Number(u.packageMaxEarnings) || 0;
  u.packageCap = Number(u.packageCap) || 0;
  u.packageEarned = Number(u.packageEarned) || 0;
  u.packageActivatedAt = Number(u.packageActivatedAt) || 0;
  u.boosterLevelId = u.boosterLevelId || "none";
  u.boosterName = u.boosterName || "None";
  u.boosterExtraROI = Number(u.boosterExtraROI) || 0;
  u.boosterStatus = u.boosterStatus || "locked";
  u.boosterActivatedAt = Number(u.boosterActivatedAt) || 0;
  u.boosterExpiresAt = Number(u.boosterExpiresAt) || 0;
  u.boosterExpiredAt = Number(u.boosterExpiredAt) || 0;
  u.activeDirectsQualified = Number(u.activeDirectsQualified) || 0;
  u.referredBy = u.referredBy || "1001";
  u.withdrawableBits = Number(u.withdrawableBits) || 0;
  u.bits = Number(u.bits) || 0;
  u.totalEarned = Number(u.totalEarned) || 0;
  u.referralEarnings = Number(u.referralEarnings) || 0;
  u.totalWithdrawn = Number(u.totalWithdrawn) || 0;
  u.createdAt = Number(u.createdAt) || 0;
  u.updatedAt = Number(u.updatedAt) || 0;
  delete u.id;
  return u;
}

function fixDeposit(d) {
  d.userId = d.userId || "";
  d.network = d.network || "bep20";
  d.address = d.address || "";
  d.amount = Number(d.amount) || 0;
  d.status = d.status || "pending";
  d.credited = !!d.credited;
  d.creditedAt = Number(d.creditedAt) || 0;
  d.confirmedAt = Number(d.confirmedAt) || 0;
  d.swept = !!d.swept;
  d.sweptAt = Number(d.sweptAt) || 0;
  d.sweepError = d.sweepError || "";
  d.creditError = d.creditError || "";
  d.index = Number(d.index) || 0;
  d.txHash = d.txHash || "";
  d.createdAt = Number(d.createdAt) || 0;
  d.updatedAt = Number(d.updatedAt) || 0;
  return d;
}

function fixIncome(i) {
  i.userId = i.userId || "";
  i.amount = Number(i.amount) || 0;
  i.type = i.type || "";
  i.description = i.description || "";
  i.sourceUserId = i.sourceUserId || "";
  i.sourceUserName = i.sourceUserName || "";
  i.level = i.level || "";
  i.status = i.status || "completed";
  i.packageName = i.packageName || "";
  i.packageAmount = Number(i.packageAmount) || 0;
  i.roi = Number(i.roi) || 0;
  i.boosterName = i.boosterName || "";
  i.extraRoi = Number(i.extraRoi) || 0;
  i.rankName = i.rankName || "";
  i.rewardCycle = i.rewardCycle || "";
  i.network = i.network || "";
  i.txHash = i.txHash || "";
  i.walletAddress = i.walletAddress || "";
  i.reason = i.reason || "";
  i.createdAt = Number(i.createdAt) || 0;
  i.updatedAt = Number(i.updatedAt) || 0;
  return i;
}

function fixPackage(p) {
  p.userId = p.userId || "";
  p.amount = Number(p.amount) || 0;
  p.roi = Number(p.roi) || 0;
  p.capMultiplier = Number(p.capMultiplier) || 0;
  p.maxEarnings = Number(p.maxEarnings) || 0;
  p.totalEarned = Number(p.totalEarned) || 0;
  p.status = p.status || "active";
  p.activatedAt = Number(p.activatedAt) || 0;
  p.createdAt = Number(p.createdAt) || 0;
  return p;
}

function fixBoosterHistory(b) {
  b.userId = b.userId || "";
  b.boosterId = b.boosterId || "";
  b.boosterName = b.boosterName || "";
  b.status = b.status || "";
  b.extraRoi = Number(b.extraRoi) || 0;
  b.at = Number(b.at) || 0;
  b.expiresAt = Number(b.expiresAt) || 0;
  b.activeDirectCount = Number(b.activeDirectCount) || 0;
  b.reason = b.reason || "";
  b.createdAt = Number(b.createdAt) || 0;
  b.updatedAt = Number(b.updatedAt) || 0;
  return b;
}

function fixOrbitReward(o) {
  o.userId = o.userId || "";
  o.rankName = o.rankName || "";
  o.rewardCycle = o.rewardCycle || "";
  o.amount = Number(o.amount) || 0;
  o.status = o.status || "pending";
  o.claimedAt = Number(o.claimedAt) || 0;
  o.createdAt = Number(o.createdAt) || 0;
  o.updatedAt = Number(o.updatedAt) || 0;
  return o;
}

async function migrate() {
  console.log("=== MIGRATION START ===");

  // 1. Users
  console.log("\n[1/6] Migrating users...");
  const users = await fetchAll("users");
  console.log(`  Fetched ${users.length} users from Firestore`);
  const userRows = users.map(fixUser);
  await db.insertMany("users", userRows, "telegramId");
  console.log(`  Inserted ${userRows.length} users into PostgreSQL`);

  // 2. Deposits
  console.log("\n[2/6] Migrating deposits...");
  let deposits = [];
  try {
    deposits = await fetchAll("deposits");
  } catch (e) { console.warn("  Direct fetch failed, trying query..."); }
  if (!deposits.length) {
    deposits = await fetchAllWithQuery("deposits", {
      structuredQuery: { from: [{ collectionId: "deposits" }], limit: 500 }
    });
  }
  console.log(`  Fetched ${deposits.length} deposits`);
  if (deposits.length) {
    const depositRows = deposits.map(fixDeposit);
    await db.insertMany("deposits", depositRows);
    console.log(`  Inserted ${depositRows.length} deposits`);
  }

  // 3. Packages
  console.log("\n[3/6] Migrating packages...");
  let packageDocs = [];
  try {
    packageDocs = await fetchAll("packages");
  } catch (e) {}
  if (!packageDocs.length) {
    packageDocs = await fetchAllWithQuery("packages", {
      structuredQuery: { from: [{ collectionId: "packages" }], limit: 500 }
    });
  }
  console.log(`  Fetched ${packageDocs.length} packages`);
  if (packageDocs.length) {
    const packageRows = packageDocs.map(fixPackage);
    await db.insertMany("packages", packageRows);
    console.log(`  Inserted ${packageRows.length} packages`);
  }

  // 4. Income History
  console.log("\n[4/6] Migrating income_history...");
  let incomes = [];
  try {
    incomes = await fetchAll("incomeHistory");
  } catch (e) {}
  if (!incomes.length) {
    incomes = await fetchAllWithQuery("incomeHistory", {
      structuredQuery: { from: [{ collectionId: "incomeHistory" }], limit: 500 }
    });
  }
  console.log(`  Fetched ${incomes.length} income entries`);
  if (incomes.length) {
    const incomeRows = incomes.map(fixIncome);
    await db.insertMany("income_history", incomeRows);
    console.log(`  Inserted ${incomeRows.length} income entries`);
  }

  // 5. Booster History
  console.log("\n[5/6] Migrating booster_history...");
  let boosterDocs = [];
  try {
    boosterDocs = await fetchAll("boosterHistory");
  } catch (e) {}
  if (!boosterDocs.length) {
    boosterDocs = await fetchAllWithQuery("boosterHistory", {
      structuredQuery: { from: [{ collectionId: "boosterHistory" }], limit: 500 }
    });
  }
  console.log(`  Fetched ${boosterDocs.length} booster history entries`);
  if (boosterDocs.length) {
    const boosterRows = boosterDocs.map(fixBoosterHistory);
    await db.insertMany("booster_history", boosterRows);
    console.log(`  Inserted ${boosterRows.length} booster entries`);
  }

  // 6. Orbit Rewards (if collection exists)
  console.log("\n[6/6] Migrating orbit_rewards...");
  let orbits = [];
  try {
    orbits = await fetchAll("orbitRewards");
  } catch (e) {}
  if (!orbits.length) {
    orbits = await fetchAllWithQuery("orbitRewards", {
      structuredQuery: { from: [{ collectionId: "orbitRewards" }], limit: 500 }
    });
  }
  console.log(`  Fetched ${orbits.length} orbit rewards`);
  if (orbits.length) {
    const orbitRows = orbits.map(fixOrbitReward);
    await db.insertMany("orbit_rewards", orbitRows);
    console.log(`  Inserted ${orbitRows.length} orbit rewards`);
  }

  console.log("\n=== MIGRATION COMPLETE ===");
  process.exit(0);
}

migrate().catch(err => {
  console.error("Migration failed:", err);
  process.exit(1);
});
