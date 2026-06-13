const API_BASE = "https://playbits-backend-132h.onrender.com";

window.API = {
  async get(path) {
    const r = await fetch(`${API_BASE}${path}`);
    return r.json();
  },
  async post(path, body) {
    const r = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    return r.json();
  },

  // Users
  getUser(uid) { return this.get(`/api/users/${uid}`); },
  signup(data) { return this.post("/api/signup", data); },
  updateProfile(uid, data) { return this.post("/api/update-profile", { userId: uid, ...data }); },

  // Dashboard
  getDashboard(uid) { return this.get(`/api/dashboard/${uid}`); },
  getBalance(uid) { return this.get(`/api/balance/${uid}`); },
  claimDaily(uid) { return this.post("/api/claim-daily", { userId: uid }); },
  claimPackage(uid) { return this.post("/api/claim-package", { userId: uid }); },
  runUnlock(uid) { return this.post("/api/run-unlock", { userId: uid }); },

  // Booster
  getBooster(uid) { return this.get(`/api/booster/${uid}`); },

  // Packages
  buyPackage(uid, amount) { return this.post("/api/buy-package", { userId: uid, amount }); },
  getDepositAddress(uid, network, newAddress) { return this.post("/api/get-deposit-address", { userId: uid, network, newAddress }); },

  // Network
  getNetwork(uid, level) { return this.get(`/api/network/${uid}${level ? `?level=${level}` : ""}`); },

  // Rank
  getRank(uid) { return this.get(`/api/rank/${uid}`); },

  // Income
  getIncome(uid, page, type) {
    let p = `/api/income/${uid}?page=${page || 1}&limit=50`;
    if (type) p += `&type=${type}`;
    return this.get(p);
  },

  // Leaderboard
  getLeaderboard(limit) { return this.get(`/api/leaderboard?limit=${limit || 100}`); },

  // Deposits
  getDeposits(uid) { return this.get(`/api/deposits/${uid}`); },
  checkDeposit(address) { return this.get(`/api/check-deposit/${address}`); },

  // Withdrawals
  submitWithdraw(uid, amount, address, network) { return this.post("/api/withdraw", { userId: uid, amount, address, network }); },
  getWithdrawals(limit) { return this.get(`/api/withdrawals?limit=${limit || 20}`); },

  // Tasks
  claimFollow(uid) { return this.post("/api/claim-follow", { userId: uid }); },

  // Ranks
  claimOrbit(uid, rankName) { return this.post("/api/claim-orbit", { userId: uid, rankName }); },
  claimRankReward(uid) { return this.post("/api/claim-rank-reward", { userId: uid }); },

  // Add income entry (used by ranks page)
  addIncome(data) { return this.post("/api/add-income", data); },

  // Top users for live feed
  getRecentUsers(limit) { return this.get(`/api/users/recent?limit=${limit || 5}`); },

  // Airdrop vault
  getAirdrop(uid) { return this.get(`/api/airdrop/${uid}`); },
  buyPackageWithFreeBits(uid, amount, useFreeBits) { return this.post("/api/buy-package", { userId: uid, amount, useFreeBits }); }
};
