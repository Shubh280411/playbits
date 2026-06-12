CREATE TABLE IF NOT EXISTS users (
  "telegramId" TEXT PRIMARY KEY,
  "firstName" TEXT DEFAULT '',
  "username" TEXT DEFAULT '',
  "isActive" BOOLEAN DEFAULT true,
  "isActivated10" BOOLEAN DEFAULT false,
  "depositBalance" DOUBLE PRECISION DEFAULT 0,
  "totalDeposited" DOUBLE PRECISION DEFAULT 0,
  "activationUSDT" DOUBLE PRECISION DEFAULT 0,
  "packageAmount" DOUBLE PRECISION DEFAULT 0,
  "packageStatus" TEXT DEFAULT 'none',
  "packageROI" DOUBLE PRECISION DEFAULT 0,
  "packageCapMultiplier" DOUBLE PRECISION DEFAULT 0,
  "packageMaxEarnings" DOUBLE PRECISION DEFAULT 0,
  "packageCap" DOUBLE PRECISION DEFAULT 0,
  "packageEarned" DOUBLE PRECISION DEFAULT 0,
  "packageActivatedAt" BIGINT DEFAULT 0,
  "boosterLevelId" TEXT DEFAULT 'none',
  "boosterName" TEXT DEFAULT 'None',
  "boosterExtraROI" DOUBLE PRECISION DEFAULT 0,
  "boosterStatus" TEXT DEFAULT 'locked',
  "boosterActivatedAt" BIGINT DEFAULT 0,
  "boosterExpiresAt" BIGINT DEFAULT 0,
  "boosterExpiredAt" BIGINT DEFAULT 0,
  "activeDirectsQualified" INTEGER DEFAULT 0,
  "referredBy" TEXT DEFAULT '1001',
  "withdrawableBits" DOUBLE PRECISION DEFAULT 0,
  "bits" DOUBLE PRECISION DEFAULT 0,
  "totalEarned" DOUBLE PRECISION DEFAULT 0,
  "referralEarnings" DOUBLE PRECISION DEFAULT 0,
  "totalWithdrawn" DOUBLE PRECISION DEFAULT 0,
  "lockedBits" DOUBLE PRECISION DEFAULT 0,
  "unlockingBits" DOUBLE PRECISION DEFAULT 0,
  "unlockedFromSignup" DOUBLE PRECISION DEFAULT 0,
  "followClaimed" BOOLEAN DEFAULT false,
  "followBits" DOUBLE PRECISION DEFAULT 0,
  "followClaimedAt" BIGINT DEFAULT 0,
  "lastUnlockDateUTC" TEXT DEFAULT '',
  "lastClaimDateUTC" TEXT DEFAULT '',
  "lastClaimAt" BIGINT DEFAULT 0,
  "activeDirects" INTEGER DEFAULT 0,
  "totalDirects" INTEGER DEFAULT 0,
  "email" TEXT DEFAULT '',
  "createdAt" BIGINT DEFAULT 0,
  "updatedAt" BIGINT DEFAULT 0
);
ALTER TABLE users ADD COLUMN IF NOT EXISTS "lockedBits" DOUBLE PRECISION DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS "unlockingBits" DOUBLE PRECISION DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS "unlockedFromSignup" DOUBLE PRECISION DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS "followClaimed" BOOLEAN DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS "followBits" DOUBLE PRECISION DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS "followClaimedAt" BIGINT DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS "lastUnlockDateUTC" TEXT DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS "lastClaimDateUTC" TEXT DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS "lastClaimAt" BIGINT DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS "activeDirects" INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS "totalDirects" INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS "email" TEXT DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS "freeBitsBalance" DOUBLE PRECISION DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS "freeBitsEarned" DOUBLE PRECISION DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS "freeBitsUsed" DOUBLE PRECISION DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS "freeBitsExpiry" BIGINT DEFAULT 0;
ALTER TABLE admins ADD COLUMN IF NOT EXISTS "email" TEXT DEFAULT '';
ALTER TABLE admin_logs ADD COLUMN IF NOT EXISTS "adminEmail" TEXT DEFAULT '';

CREATE TABLE IF NOT EXISTS airdrop_history (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL REFERENCES users("telegramId"),
  "source" TEXT NOT NULL,
  "bits" DOUBLE PRECISION DEFAULT 0,
  "createdAt" BIGINT DEFAULT 0
);

CREATE TABLE IF NOT EXISTS deposits (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL REFERENCES users("telegramId"),
  "network" TEXT DEFAULT 'bep20',
  "address" TEXT DEFAULT '',
  "amount" DOUBLE PRECISION DEFAULT 0,
  "status" TEXT DEFAULT 'pending',
  "credited" BOOLEAN DEFAULT false,
  "creditedAt" BIGINT DEFAULT 0,
  "confirmedAt" BIGINT DEFAULT 0,
  "swept" BOOLEAN DEFAULT false,
  "sweptAt" BIGINT DEFAULT 0,
  "sweepError" TEXT DEFAULT '',
  "creditError" TEXT DEFAULT '',
  "index" INTEGER DEFAULT 0,
  "txHash" TEXT DEFAULT '',
  "createdAt" BIGINT DEFAULT 0,
  "updatedAt" BIGINT DEFAULT 0
);

CREATE TABLE IF NOT EXISTS packages (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL REFERENCES users("telegramId"),
  "amount" DOUBLE PRECISION DEFAULT 0,
  "roi" DOUBLE PRECISION DEFAULT 0,
  "capMultiplier" DOUBLE PRECISION DEFAULT 0,
  "maxEarnings" DOUBLE PRECISION DEFAULT 0,
  "totalEarned" DOUBLE PRECISION DEFAULT 0,
  "status" TEXT DEFAULT 'active',
  "activatedAt" BIGINT DEFAULT 0,
  "createdAt" BIGINT DEFAULT 0
);

CREATE TABLE IF NOT EXISTS income_history (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL REFERENCES users("telegramId"),
  "amount" DOUBLE PRECISION DEFAULT 0,
  "type" TEXT DEFAULT '',
  "description" TEXT DEFAULT '',
  "sourceUserId" TEXT DEFAULT '',
  "sourceUserName" TEXT DEFAULT '',
  "level" TEXT DEFAULT '',
  "status" TEXT DEFAULT 'completed',
  "packageName" TEXT DEFAULT '',
  "packageAmount" DOUBLE PRECISION DEFAULT 0,
  "roi" DOUBLE PRECISION DEFAULT 0,
  "boosterName" TEXT DEFAULT '',
  "extraRoi" DOUBLE PRECISION DEFAULT 0,
  "rankName" TEXT DEFAULT '',
  "rewardCycle" TEXT DEFAULT '',
  "network" TEXT DEFAULT '',
  "txHash" TEXT DEFAULT '',
  "walletAddress" TEXT DEFAULT '',
  "reason" TEXT DEFAULT '',
  "createdAt" BIGINT DEFAULT 0,
  "updatedAt" BIGINT DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_income_userId ON income_history("userId");
CREATE INDEX IF NOT EXISTS idx_income_type ON income_history("type");
CREATE INDEX IF NOT EXISTS idx_income_createdAt ON income_history("createdAt");

CREATE TABLE IF NOT EXISTS booster_history (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL REFERENCES users("telegramId"),
  "boosterId" TEXT DEFAULT '',
  "boosterName" TEXT DEFAULT '',
  "status" TEXT DEFAULT '',
  "extraRoi" DOUBLE PRECISION DEFAULT 0,
  "at" BIGINT DEFAULT 0,
  "expiresAt" BIGINT DEFAULT 0,
  "activeDirectCount" INTEGER DEFAULT 0,
  "reason" TEXT DEFAULT '',
  "createdAt" BIGINT DEFAULT 0,
  "updatedAt" BIGINT DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_booster_userId ON booster_history("userId");

CREATE TABLE IF NOT EXISTS daily_claims (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "date" TEXT DEFAULT '',
  "claimedAt" BIGINT DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_daily_userId ON daily_claims("userId");

CREATE TABLE IF NOT EXISTS orbit_rewards (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL REFERENCES users("telegramId"),
  "rankName" TEXT DEFAULT '',
  "rewardCycle" TEXT DEFAULT '',
  "amount" DOUBLE PRECISION DEFAULT 0,
  "status" TEXT DEFAULT 'pending',
  "claimedAt" BIGINT DEFAULT 0,
  "createdAt" BIGINT DEFAULT 0,
  "updatedAt" BIGINT DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_orbit_userId ON orbit_rewards("userId");

CREATE TABLE IF NOT EXISTS withdrawals (
  "id" TEXT PRIMARY KEY,
  "telegramId" TEXT NOT NULL REFERENCES users("telegramId"),
  "amount" DOUBLE PRECISION DEFAULT 0,
  "address" TEXT DEFAULT '',
  "network" TEXT DEFAULT 'BEP20',
  "status" TEXT DEFAULT 'pending',
  "createdAt" BIGINT DEFAULT 0,
  "updatedAt" BIGINT DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_withdrawals_userId ON withdrawals("telegramId");

CREATE TABLE IF NOT EXISTS admins (
  "id" TEXT PRIMARY KEY,
  "username" TEXT UNIQUE NOT NULL,
  "email" TEXT DEFAULT '',
  "passwordHash" TEXT NOT NULL,
  "role" TEXT DEFAULT 'ADMIN' CHECK("role" IN ('SUPER_ADMIN','ADMIN','MODERATOR')),
  "isActive" BOOLEAN DEFAULT true,
  "createdAt" BIGINT DEFAULT 0,
  "lastLogin" BIGINT DEFAULT 0
);

CREATE TABLE IF NOT EXISTS admin_logs (
  "id" TEXT PRIMARY KEY,
  "adminId" TEXT NOT NULL,
  "adminEmail" TEXT DEFAULT '',
  "adminUsername" TEXT DEFAULT '',
  "action" TEXT NOT NULL,
  "targetType" TEXT DEFAULT '',
  "targetId" TEXT DEFAULT '',
  "details" TEXT DEFAULT '',
  "ip" TEXT DEFAULT '',
  "createdAt" BIGINT DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_admin_logs_adminId ON admin_logs("adminId");
CREATE INDEX IF NOT EXISTS idx_admin_logs_createdAt ON admin_logs("createdAt");

CREATE TABLE IF NOT EXISTS settings (
  "key" TEXT PRIMARY KEY,
  "value" TEXT DEFAULT '',
  "updatedAt" BIGINT DEFAULT 0,
  "updatedBy" TEXT DEFAULT ''
);
