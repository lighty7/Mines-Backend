# Mines-Backend — Plan

Server-authoritative backend for the Mines game (Android + Web), hosted on Render.

---

## 1. Context

The frontend (`F:\Hmmm1\Mines`) is a native Android app (Kotlin + Jetpack Compose) that plays a Stake-style Mines game. v1 is a **demo**: fake balance, board generated locally via `SecureRandom`. The codebase already has the intended backend seam:

```kotlin
// app/src/main/java/com/minesgame/data/repository/GameRepository.kt
interface GameRepository {
    fun createBoard(mines: Int, boardSize: Int = 5): Set<Int>
}
```

This backend replaces the local repository with a server-authoritative implementation: **the server generates the board and never reveals mine positions to the client**. The client only sends guesses and receives results.

## 2. Decisions

| Area        | Decision                                                        |
|-------------|-----------------------------------------------------------------|
| Language    | Node.js + **TypeScript**                                        |
| Framework   | **Express** (REST) + Socket.io-ready for future multiplayer      |
| Database    | **PostgreSQL** (managed on Render)                              |
| ORM         | **Prisma** (type-safe queries + migrations)                     |
| Auth        | **JWT** (access token) + bcrypt password hashing                |
| Validation  | **Zod** (type-safe request schemas)                             |
| Money model | Internal Decimal balance first; crypto deposit/withdraw later   |
| Deploy      | **Render Web Service** + Render managed PostgreSQL              |

### Why Node.js + TypeScript

- Industry standard for real-time / casino-style game backends
- WebSocket (Socket.io) support is native for future multiplayer
- Render free tier is optimized for Node.js
- Largest package ecosystem (auth, rate-limiting, validation)
- The game math is pure — easy 1:1 port from Kotlin

### Why PostgreSQL

- ACID — critical for balance/wallet correctness (atomic bets, wins, no double-spend)
- Relational data fits users / rounds / transactions naturally
- Render provides a free managed PostgreSQL instance

### System flow diagram (high level)

```mermaid
flowchart TB
    subgraph Clients["Clients"]
        A["Android App<br/>(Kotlin + Jetpack Compose)"]
        C["Web App<br/>(React + Vite)"]
    end

    A -->|"HTTPS /api/*"| S["Express Server (Node + TypeScript)"]
    C -->|"HTTPS /api/*"| S

    S --> M["Middleware<br/>JWT verify · Zod validate · rate limit · helmet · CORS"]
    M --> R["Routes<br/>auth / game / user / leaderboard"]

    R --> G["Game Service<br/>(server-authoritative state machine)"]
    G --> E["MinesEngine<br/>(crypto.randomInt, pure math)"]
    R --> WS["Wallet Service<br/>(atomic debit / credit)"]
    G --> WS
    WS --> D[("PostgreSQL<br/>(Prisma + connection pool)")]

    subgraph Outbound["Future (Phase 4+)"]
        F["Blockchain scanner + hot wallet<br/>(USDT BEP-20 / SOL)"]
    end
    WS -.-> F
```

### Game round flow (state machine)

```mermaid
stateDiagram-v2
    [*] --> IDLE
    IDLE --> ACTIVE: start round<br/>bet debited atomically
    ACTIVE --> ACTIVE: reveal safe tile<br/>multiplier increases, potentialWin grows
    ACTIVE --> LOST: reveal mine<br/>round marked LOST, all mines revealed
    ACTIVE --> WON: cashout<br/>payout credited atomically
    LOST --> IDLE
    WON --> IDLE

    note right of ACTIVE
        forbidden: change bet/mines mid-round,
        cashout with 0 reveals, repeated tile
    end note
```

### Guest mode strategy

The Android app defaults to a **guest profile** (`isGuest = true`) and the
profile modal doubles as the login screen. Decision:

- **Guest users (Option A — hybrid, recommended):** the Android app continues
  using `LocalGameRepository` (offline, instant, zero backend load). No auth
  required to try the game.
- **Registered users:** the app swaps to `RemoteGameRepository` (Retrofit HTTP
  API) against this backend. All balance/game state becomes server-authoritative.
- **Why not a server-side guest (`POST /api/auth/guest`):** it adds a full
  server round-trip for what is currently free demo play and bloats the user
  table with anonymous rows. Revisit only if guests must interact with
  leaderboards or receive balances.

This keeps the backend surface minimal at launch while making the
guest → registered upgrade path a one-tap account creation.

## 3. Tech stack

| Layer          | Choice                                                  |
|----------------|---------------------------------------------------------|
| Runtime        | Node.js 20 LTS                                          |
| Language       | TypeScript (strict mode)                                |
| Web framework  | Express 4                                                |
| ORM            | Prisma                                                  |
| Auth           | jsonwebtoken, bcryptjs                                  |
| Validation     | Zod                                                     |
| Rate limiting  | express-rate-limit                                      |
| Security       | helmet, cors, express.json (strict)                     |
| Test runner    | Vitest (unit tests for engine + services)               |
| Database       | PostgreSQL (Render managed)                             |

## 4. Project structure

```
Mines-Backend/
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── .env.example               # Env var template
├── Procfile                   # web: node dist/index.js (Render)
├── prisma/
│   ├── schema.prisma          # DB schema
│   └── migrations/            # Generated migrations
└── src/
    ├── index.ts               # Server entry point
    ├── app.ts                 # Express app assembly
    ├── config/
    │   └── env.ts             # Env validation (Zod)
    ├── engine/
    │   ├── mines.engine.ts    # Ported MinesEngine (pure TS)
    │   └── mines.engine.test.ts
    ├── middleware/
    │   ├── auth.ts            # JWT verification
    │   └── error.ts           # Central error handler
    ├── routes/
    │   ├── auth.routes.ts     # register / login / me
    │   ├── game.routes.ts     # start / reveal / cashout / history
    │   ├── user.routes.ts     # profile / balance
    │   └── leaderboard.routes.ts
    ├── services/
    │   ├── auth.service.ts
    │   ├── game.service.ts    # Server-side game state machine
    │   ├── wallet.service.ts  # Atomic balance credit/debit
    │   └── provably-fair.service.ts   # Phase 5
    ├── lib/
    │   └── prisma.ts          # Prisma client singleton
    └── types/
        └── index.ts           # Shared API types
```

## 5. Database schema (Prisma)

```prisma
model User {
  id           String         @id @default(cuid())
  username     String         @unique
  email        String         @unique
  passwordHash String
  address      String?        // withdraw/deposit address (matches Android profile)
  balance      Decimal        @default(1000) @db.Decimal(18, 8)
  createdAt    DateTime       @default(now())
  games        GameRound[]
  transactions Transaction[]
}

model GameRound {
  id             String      @id @default(cuid())
  userId         String
  user           User        @relation(fields: [userId], references: [id])
  bet            Decimal     @db.Decimal(18, 8)
  mines          Int
  boardSize      Int         @default(5)
  status         GameStatus  @default(ACTIVE)   // ACTIVE, WON, LOST
  serverSeed     String      // unrevealed secret seed (PvF Phase 5)
  serverSeedHash String      // SHA-256(serverSeed) — public commitment sent at start
  clientSeed     String      // user-entered seed (PvF Phase 5)
  multiplier     Decimal     @default(1) @db.Decimal(18, 8)
  payout         Decimal?    @db.Decimal(18, 8)
  createdAt      DateTime    @default(now())
  reveals        Reveal[]    // audit log of guesses
}

model Reveal {
  id        String    @id @default(cuid())
  roundId   String
  round     GameRound @relation(fields: [roundId], references: [id])
  tileIndex Int
  isMine    Boolean
  createdAt DateTime  @default(now())
}

model Transaction {
  id        String   @id @default(cuid())
  userId    String
  user      User     @relation(fields: [userId], references: [id])
  type      TxType   // BET, WIN, DEPOSIT, WITHDRAW
  amount    Decimal  @db.Decimal(18, 8)
  roundId   String?  // linked game round
  createdAt DateTime @default(now())
}

enum GameStatus { ACTIVE WON LOST }
enum TxType { BET WIN DEPOSIT WITHDRAW }
```

### Entity-relationship diagram

```mermaid
erDiagram
    User ||--o{ GameRound : "plays"
    User ||--o{ Transaction : "has"
    User ||--o{ Reveal : "via rounds"
    GameRound ||--o{ Reveal : "contains"

    User {
        String id PK
        String username UK
        String email UK
        String passwordHash
        String address "nullable"
        Decimal balance "default 1000, 18,8"
        DateTime createdAt
    }

    GameRound {
        String id PK
        String userId FK
        Decimal bet "18,8 precision"
        Int mines
        Int boardSize "4, 5 or 6"
        GameStatus status "ACTIVE / WON / LOST"
        String serverSeed "secret until round ends"
        String serverSeedHash "SHA-256 commitment"
        String clientSeed "user-selected (PvF)"
        Decimal multiplier "18,8 precision"
        Decimal payout "nullable"
        DateTime createdAt
    }

    Reveal {
        String id PK
        String roundId FK
        Int tileIndex
        Boolean isMine
        DateTime createdAt
    }

    Transaction {
        String id PK
        String userId FK
        TxType type "BET / WIN / DEPOSIT / WITHDRAW"
        Decimal amount "18,8 precision"
        String roundId "nullable link"
        DateTime createdAt
    }
```

**Wallet correctness**: bet debit and win credit are always wrapped in a single
DB transaction (Prisma `$transaction` + row lock), guaranteeing no negative
balances and no double-spend.

## 6. Game engine — TypeScript port

Direct 1:1 port of `MinesEngine.kt` (pure math, unit-tested):

```ts
// src/engine/mines.engine.ts
export const MIN_BOARD_SIZE = 4
export const MAX_BOARD_SIZE = 6
export const DEFAULT_BOARD_SIZE = 5
export const HOUSE_EDGE = 0.99

export function totalTiles(boardSize = DEFAULT_BOARD_SIZE): number
export function maxMinesForBoard(boardSize = DEFAULT_BOARD_SIZE): number
export function generateMinePositions(mines, boardSize): Set<number>
export function mineChancePercentage(boardSize, mines): number
export function safeChancePercentage(boardSize, mines): number
export function safeProbability(mines, revealed, boardSize): number
export function multiplierAt(mines, revealed, boardSize): number
export function potentialWin(bet, mines, revealed, boardSize): number
```

- Kotlin `SecureRandom` → Node `crypto.randomInt()` (equally secure)
- Constraints: `mines in 1..boardSize²-1`, board sizes 4x4 / 5x5 / 6x6
- House edge: 99% RTP, `P(safe_i) = (total − mines − revealed) / (total − revealed)`
- **Provably-fair note (Phase 5)**: the `GameRound` already stores
  `serverSeed` + `serverSeedHash` + `clientSeed`. In Phase 5,
  `generateMinePositions` becomes deterministic — mines derived via
  SHA-256(serverSeed ‖ clientSeed ‖ nonce) instead of `crypto.randomInt` — so
  players can re-derive the board after the round ends to verify fairness. The
  seed hash is committed to the client at `/game/start` and the seed revealed in
  the round result.

## 7. API design

All endpoints return JSON. Protected endpoints require `Authorization: Bearer <jwt>`.

| Method | Endpoint                  | Auth | Body / Params                          | Purpose                        |
|--------|---------------------------|------|----------------------------------------|--------------------------------|
| POST   | `/api/auth/register`      | —    | `{username, email, password}`          | Create account                |
| POST   | `/api/auth/login`         | —    | `{email, password}`                    | Get JWT                      |
| GET    | `/api/auth/me`            | ✅   | —                                      | Current user + balance       |
| POST   | `/api/game/start`         | ✅   | `{bet, mines, boardSize}`              | Debit bet, create round      |
| POST   | `/api/game/reveal`        | ✅   | `{roundId, tileIndex}`                 | Guess tile, compute result   |
| POST   | `/api/game/cashout`       | ✅   | `{roundId}`                            | Credit winnings, end round   |
| GET    | `/api/game/history`       | ✅   | `?limit`                               | Past rounds                  |
| GET    | `/api/leaderboard`        | —    | `?limit`                               | Top players by net winnings  |
| PUT    | `/api/user/profile`       | ✅   | `{username, address}`                  | Update profile               |
| GET    | `/api/user/balance`       | ✅   | —                                      | Current balance              |

### Game flow (server-authoritative)

```
1. START  POST /api/game/start  { bet, mines, boardSize }
   - Validate bet > 0 and bet <= balance
   - Server generates mine positions (crypto.randomInt Fisher–Yates)
   - Stores mines + seed in GameRound row (never sent to client)
   - Atomically debits balance (Transaction type=BET)
   - Returns: { roundId, boardSize, mines, status: ACTIVE }

2. REVEAL  POST /api/game/reveal  { roundId, tileIndex }
   - Server checks tileIndex in stored mines:
     - SAFE  → multiplier = multiplierAt(mines, revealed+1)
               returns { safe: true, revealed, multiplier, potentialWin }
     - MINE  → marks round LOST, all mines revealed to client
               returns { safe: false, mines: [...], status: LOST }
   - Illegal / repeated / unknown tile → 400

3. CASHOUT  POST /api/game/cashout  { roundId }
   - Only valid when at least 1 safe reveal and round ACTIVE
   - Atomically credits payout (Transaction type=WIN), marks round WON
   - Returns { payout, multiplier, status: WON }
   - Idempotent: repeated cashout on WON/LOST round → rejected
```

### Request sequence (start → reveal → cashout)

```mermaid
sequenceDiagram
    autonumber
    participant C as Client (Android / Web)
    participant S as Express Server
    participant W as Wallet Service
    participant G as MinesEngine
    participant D as PostgreSQL

    rect rgb(30, 36, 45)
        Note over C,D: Start round
        C->>S: POST /api/game/start {bet, mines, boardSize}
        S->>S: verify JWT + Zod body
        S->>W: debitBalance(userId, bet)
        W->>D: BEGIN · SELECT user FOR UPDATE
        W->>D: UPDATE balance · INSERT Transaction(BET)
        W-->>S: ok (new balance)
        S->>G: generateMinePositions(mines, boardSize)
        G-->>S: mine set (kept server-side, never sent)
        S->>D: INSERT GameRound {... , seed}
        S-->>C: {roundId, boardSize, mines, status: ACTIVE, balance}
    end

    rect rgb(30, 36, 45)
        Note over C,D: Reveal tile
        C->>S: POST /api/game/reveal {roundId, tileIndex}
        S->>D: SELECT round FOR UPDATE (+ reveals count)
        S->>D: INSERT Reveal(tileIndex, isMine)
        alt tile is a mine
            S->>D: UPDATE round → status = LOST
            S-->>C: {safe:false, status:LOST, mineIndices, balance}
        else tile is safe
            S->>G: multiplierAt(mines, revealed + 1)
            S-->>C: {safe:true, revealed, multiplier, potentialWin}
        end
    end

    rect rgb(30, 36, 45)
        Note over C,D: Cash out
        C->>S: POST /api/game/cashout {roundId}
        S->>S: verify ≥1 safe reveal, status = ACTIVE
        S->>D: SELECT round FOR UPDATE
        S->>W: creditPayout(userId, payout)
        W->>D: UPDATE balance · INSERT Transaction(WIN)
        W->>D: UPDATE round → status = WON
        S-->>C: {status:WON, multiplier, payout, balance}
    end
```

The `FOR UPDATE` row lock is what serializes concurrent actions against the
same user/round — this is what makes 100+ tx/s on real players' money safe:

two simultaneous cashouts on the same round cannot both succeed.

### Response shapes

```jsonc
// POST /api/game/start
{
  "roundId": "cm...",
  "boardSize": 5,
  "mines": 5,
  "status": "ACTIVE",
  "balance": 990.0
}

// POST /api/game/reveal (safe)
{
  "safe": true,
  "revealed": 2,
  "multiplier": 1.43,
  "potentialWin": 14.30,
  "balance": 990.0
}

// POST /api/game/reveal (hit mine)
{
  "safe": false,
  "status": "LOST",
  "mineIndices": [3, 7, 12, 19, 23],
  "balance": 990.0
}

// POST /api/game/cashout
{
  "status": "WON",
  "multiplier": 2.14,
  "payout": 21.40,
  "balance": 1011.40
}
```

## 8. Security

- **Server-authoritative board** — mine positions never leave the server; the client only sends guesses. This makes client-side cheating impossible.
- **JWT auth** with bcrypt-hashed passwords
- **Atomic transactions** for every balance change (no double-spend, no negative balance)
- **Zod validation** on every request body and env var
- **Rate limiting** on auth + game endpoints (brute-force / abuse protection)
- **Helmet** security headers, strict CORS allow-list
- HTTPS enforced automatically by Render

## 9. Performance — 100 transactions/second

**Target: sustain 100 transactions/sec of game + wallet activity.**

100 tx/s is comfortably within a single Node.js instance + single PostgreSQL on
Render. This section explains why and what must be done to guarantee it.

### Why 100 tx/s is safe at this scale

| Component | Headroom |
|-----------|----------|
| Node.js event loop | Handles 10k+ concurrent I/O connections; game actions are pure I/O (DB round-trips), no heavy CPU |
| Game math | trivial — Fisher-Yates on ≤36 tiles + a multiplier product are microseconds |
| 1 wallet write | `BEGIN` + one row `UPDATE` + one `INSERT` ≈ 1–5 ms on Render Postgres |
| Postgres throughput | single instance handles thousands of tx/s; we ask for 100 |

A single DB connection can already serialize ~200–1000 simple writes/sec.
With a small connection pool, 100 tx/s uses well under 5% of capacity.

### Rules to guarantee it

1. **Connection pooling** — Prisma pool sized to the free instance. Render free
   = 512 MB RAM, so keep `connection_limit` moderate (5–10). Never open a new
   client per request.
2. **Keep money moves tiny** — each balance change is exactly one DB
   transaction: `SELECT ... FOR UPDATE` → `UPDATE balance` → `INSERT
   Transaction`. No nested transactions, no sleeps, no external calls inside.
3. **Never hash passwords on the hot path** — bcrypt only on register/login
   (cost factor 10–12). JWT `verify` is what auth costs during gameplay.
4. **Indexes for every query** made by the API:
   - `Transaction(userId, createdAt)` — history & audit
   - `GameRound(userId, createdAt)` — player history
   - `GameRound(status)` — active-round lookups
   - `GameRound(id)` already PK
5. **Idempotency keys on money endpoints** — client sends `idempotencyKey` on
   `/game/start` (and later deposit/withdraw); a unique index makes a retried
   request a no-op instead of a double bet. Protects against network retries.
6. **Read-path offloading** — leaderboard/history are read-heavy and cheap:
   computed with a single indexed query. If it ever gets hot, add a short-lived
   cache (in-memory TTL or Redis) — but at 100 tx/s this is optional.
7. **Rate limiting tuned per endpoint** — protects the write path from abuse
   without throttling legit players (e.g. game actions generous limit, auth
   strict).
8. **Never block the event loop** — no `crypto.randomInt` starvation (it uses
   async randomness), no synchronous fs, no CPU-bound work in request handlers.

### Concurrency & correctness at 100 tx/s

- All writes to one user's balance are serialized by the **row lock**
  (`SELECT ... FOR UPDATE`). Two players betting simultaneously never
  interleave, so balance can't go negative and a round can't be cashed out
  twice.
- Concurrent actions are **per-user serialized**, but different users run in
  parallel — this is exactly why 100 tx/s (across many users) is trivial.
- `$transaction` + the Prisma interactive transaction API groups the
  lock-update-insert into one atomic unit.

### Tuning / measuring

- **Load-test before launch** with `autocannon` or `k6`: sustain ≥100 tx/s of
  mixed start/reveal/cashout against the deployed Render stack before going
  live.
- Watch `pg_stat_activity`, pool wait times, and p95 latency via logging or
  Papetura/retention. If p95 creeps above ~50 ms, check pool size and indexes
  before anything else.
- 100 tx/s = 100 games/s ≈ 8.6M game-actions/day — far beyond the expected
  load of a single-instance rollout; the design has ~20x headroom.

### If traffic ever exceeds a single instance

- Scale **horizontally**: put multiple Node instances behind a load balancer
  (Render handles this in paid plans). The app is stateless (JWT auth + DB), so
  instances are interchangeable.
- Postgres remains the single source of truth — row locks still serialize per
  user, and instance count no longer matters for correctness.
- Optional read replica for leaderboard/history if reads dominate later.

## 10. Deployment — Render

Two services on Render:

### Web Service (`mines-backend`)

| Setting   | Value                               |
|-----------|-------------------------------------|
| Runtime   | Node                                |
| Build     | `npm install && npx prisma migrate deploy && npm run build` |
| Start     | `npm start` (or `Procfile`)         |
| Instance  | Free tier (512 MB RAM)              |

### PostgreSQL (managed)

| Setting  | Value                 |
|----------|-----------------------|
| Plan     | Free (256 MB storage) |
| Client   | Prisma via `DATABASE_URL` |

### Env vars

```env
DATABASE_URL=postgres://user:pass@host:5432/mines   # from Render PostgreSQL
JWT_SECRET=<long random string>
CORS_ORIGINS=http://localhost:5173<br/>https://your-web-app.com   # comma separated
PORT=10000            # Render injects automatically
```

### Render free-tier notes

- **Cold starts**: free web services spin down after ~15 min idle; first request can take 30-50 s. Mitigations: keep-alive ping (cron-job.org every 10 min) or upgrade to $7/mo.
- **Client must tolerate cold starts**: the Android Retrofit client (Phase 2) should set OkHttp `connectTimeout(30s)` + `readTimeout(30s)` so the first request after spin-down doesn't fail as a timeout. Retry once on `SocketTimeoutException`/5xx.
- Free PostgreSQL is 256 MB — plenty for this scale (users, rounds, transactions are small rows).

## 11. Roadmap

| Phase | Scope                                                                 |
|-------|-----------------------------------------------------------------------|
| **1** | Backend skeleton: Express + Prisma + auth + server-authoritative game + unit tests + deploy to Render |
| **2** | Android connects: INTERNET permission, Retrofit client (30s timeouts for Render cold starts), swap `LocalGameRepository` for `RemoteGameRepository` on login |
| **3** | Web frontend: React + Vite consuming the same REST API                 |
| **4** | Wallet/deposit: existing token (USDT BEP-20 or SOL) deposits + withdrawals |
| **5** | Provably-fair: server seed commitment (SHA-256 hash) + client seed + verification screens |
| **6** | Polish: autoplay, full history/stats, richer leaderboard, themes      |

## 12. Crypto / "creating your own coin" — position

Current status: the game uses **internal balance only** (a `Decimal` in the user
row). Deposits/withdrawals are future work.

### Recommendation: do not create a custom coin for Phase 1

Creating and running your own cryptocurrency involves:

- Smart-contract development + **security audit** (mandatory for money safety, costly)
- **Funding gas** for every transfer you make to players (real recurring cost)
- **Liquidity problem** — a brand-new coin has no exchange listing or buyers
- **Legal/compliance risk**

### Recommended path (Phase 4)

When real-money support is needed, use an existing cheap-gas token:

- **USDT (BEP-20)** on BNB Chain, or **SOL** on Solana — transfers cost pennies
- Users deposit the token to your hot wallet → backend verifies on-chain → credits internal balance
- Users withdraw → backend debits internal balance → hot wallet sends the token to their address

The `Transaction` table (types `DEPOSIT` / `WITHDRAW`) is already designed to
accommodate this without schema changes.

If the goal is a **rewards/points token** (not a tradable currency), the
cheapest path is a BEP-20 or Solana SPL token issued later — not a requirement
for Phase 1.

## 13. Build order (Phase 1)

1. Scaffold project: `package.json`, `tsconfig.json`, Express + TypeScript boot
2. `env.ts` validation via Zod
3. Prisma schema + first migration
4. Port `MinesEngine` from Kotlin → `src/engine/mines.engine.ts` (+ Vitest tests matching existing test vectors)
5. Auth: register / login / me (JWT + bcrypt)
6. Wallet service: atomic debit/credit with transactions
7. Game service: start / reveal / cashout state machine
8. Routes, middleware (auth, error handler, rate limits)
9. Unit tests for engine + game service
10. `Procfile` + `.env.example`, deploy to Render, verify health endpoint