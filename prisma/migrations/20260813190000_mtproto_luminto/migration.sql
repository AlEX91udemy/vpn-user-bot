CREATE TYPE "MtprotoProxyStatus" AS ENUM ('ONLINE', 'OFFLINE', 'INVALID', 'UNKNOWN');

CREATE TABLE "mtproto_proxies" (
  "id" TEXT NOT NULL,
  "host" TEXT NOT NULL,
  "port" INTEGER NOT NULL,
  "secret" TEXT NOT NULL,
  "status" "MtprotoProxyStatus" NOT NULL,
  "pingMs" INTEGER,
  "source" TEXT NOT NULL DEFAULT 'luminto',
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "mtproto_proxies_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "mtproto_proxies_host_port_secret_key" ON "mtproto_proxies"("host", "port", "secret");
CREATE INDEX "mtproto_proxies_status_pingMs_idx" ON "mtproto_proxies"("status", "pingMs");

CREATE TABLE "mtproto_assignments" (
  "telegramUserId" BIGINT NOT NULL,
  "proxyId" TEXT NOT NULL,
  "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "mtproto_assignments_pkey" PRIMARY KEY ("telegramUserId"),
  CONSTRAINT "mtproto_assignments_proxyId_fkey" FOREIGN KEY ("proxyId") REFERENCES "mtproto_proxies"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "mtproto_assignments_proxyId_idx" ON "mtproto_assignments"("proxyId");
