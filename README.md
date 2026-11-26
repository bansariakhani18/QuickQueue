# QuickQueue

A pickup-queue notification system for restaurants and food courts. Customers get a WhatsApp message the moment their order is ready — no shouting, no buzzer pagers, no missed pickups.

**Live:** [quick-queue-pink.vercel.app](https://quick-queue-pink.vercel.app) (frontend) · [quickqueue-backend-1bb3.onrender.com](https://quickqueue-backend-1bb3.onrender.com) (API)

---

## How It Works

1. Customer places an order at the counter and gives their phone number.
2. Staff enters the order in QuickQueue — token number, phone, consent checkbox.
3. When the order is ready, staff taps **Mark Ready**.
4. The customer instantly receives a WhatsApp message: *"Your order #42 at Birmiés is ready for pickup!"*
5. Staff marks it **Collected** when the customer picks up, or **Cancelled** if needed.

If delivery fails, staff can tap **Try again** (up to 4 total attempts). After that, a banner prompts manual notification.

---

## Tech Stack

| Layer | Stack |
|-------|-------|
| Frontend | React 19 · TypeScript · Vite · TanStack Query |
| Backend | Node.js · Express 5 · TypeScript · Prisma ORM |
| Database | PostgreSQL 16 |
| Notifications | WhatsApp Cloud API (Meta Business Platform) |
| Hosting | Vercel (frontend) · Render (backend + PostgreSQL) |

---

## Repository Layout

```
QuickQueue/
├── frontend/             React SPA
│   └── src/
│       ├── components/   Dashboard, OrderCard, SettingsView, auth screens
│       ├── hooks/        useOrders, useCurrentUser
│       └── styles.css    Global theme (SaaS design system)
├── backend/              Express API + background processor
│   ├── src/
│   │   ├── auth.ts           Session auth, signup, login, password reset
│   │   ├── orders.ts         Order CRUD and state machine
│   │   ├── processor.ts      Background notification worker
│   │   ├── webhook.ts        WhatsApp delivery status webhooks
│   │   ├── connections.ts    WhatsApp onboarding (Embedded Signup)
│   │   ├── crypto.ts         AES-256-GCM token encryption
│   │   ├── whatsappClient.ts Cloud API dispatcher
│   │   └── __tests__/        30+ Vitest test suites
│   └── prisma/
│       └── schema.prisma     Database schema and migrations
├── docs/                 Architecture, env vars, troubleshooting
├── docker-compose.yml    Local PostgreSQL container
└── SRS.md                Software Requirements Specification
```

---

## Features

**Order Management**
- Status machine: `PREPARING` → `READY` → `COLLECTED` / `CANCELLED`
- Duplicate token detection and badges
- Real-time 5-second polling with optimistic updates
- Search by token number or phone (digit-normalized, format-agnostic)

**Notification Engine**
- Background processor using `SELECT ... FOR UPDATE SKIP LOCKED`
- Stuck-job recovery and exponential-backoff retries
- Up to 4 notification attempts per order (automatic + manual recall)
- Delivery status tracking via WhatsApp webhooks (sent → delivered → read)
- Template-based messages with dynamic order token and restaurant name

**Multi-Tenant WhatsApp**
- Per-restaurant WhatsApp Business Account via Embedded Signup
- AES-256-GCM encrypted access token storage
- Display-name registration with Meta's approval flow
- HMAC-SHA256 webhook signature verification
- Customer opt-out handling (`STOP` replies)

**Auth & Security**
- Session-based auth with cookie-session (`SameSite=None` for cross-domain production)
- bcrypt password hashing (12 rounds)
- Versioned session invalidation on password reset
- Rate limiting on login and password-reset endpoints
- Origin validation and CORS preflight handling

**UI**
- Clean SaaS design — slate/indigo/white palette, monochrome SVG icons
- Dedicated Settings & Profile page (restaurant details, WhatsApp status, notification preferences)
- Human-friendly notification states (no developer jargon on order cards)
- Mobile-responsive layout

---

## Local Development

**Prerequisites:** Node.js 22+, npm 10+, Docker Desktop

```bash
# Clone and install
git clone https://github.com/your-username/QuickQueue.git
cd QuickQueue
npm install

# Start local PostgreSQL (port 5433)
docker compose up -d postgres

# Apply database migrations
npx --workspace=backend prisma migrate dev

# Copy and fill environment variables
cp .env.example backend/.env
# Edit backend/.env with your Meta WhatsApp credentials

# Start backend (port 3000)
npm run dev:backend

# Start frontend (port 5173, proxies /api to backend)
npm run dev:frontend
```

Open [http://localhost:5173](http://localhost:5173) and create an account.

---

## Environment Variables

Copy `.env.example` to `backend/.env` and fill in the values. The backend reads:

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string |
| `SESSION_SECRET` | 64-char hex string for cookie signing |
| `WHATSAPP_TOKEN_ENCRYPTION_KEY` | 64-char hex string for AES-256-GCM |
| `WHATSAPP_ACCESS_TOKEN` | Meta System User access token |
| `WHATSAPP_PHONE_NUMBER_ID` | Phone number ID from Meta Business |
| `WHATSAPP_WABA_ID` | WhatsApp Business Account ID |
| `WHATSAPP_TEMPLATE_NAME` | Message template name (e.g. `quickqueue_order_ready_v1`) |
| `WHATSAPP_TEMPLATE_LANGUAGE` | Template language code (e.g. `en`) |
| `WHATSAPP_API_VERSION` | Graph API version (e.g. `v21.0`) |
| `WHATSAPP_WEBHOOK_VERIFY_TOKEN` | Webhook verification token |
| `WHATSAPP_APP_SECRET` | Meta app secret for HMAC verification |
| `ALLOWED_ORIGINS` | Comma-separated allowed CORS origins |
| `NODE_ENV` | `production` for deployed environments |

See [docs/ENVIRONMENT_VARIABLES.md](docs/ENVIRONMENT_VARIABLES.md) for details.

---

## Testing & Quality

```bash
npm run typecheck     # TypeScript checks (frontend + backend)
npm run build         # Production builds
npm --workspace=backend run test   # Vitest suite (200+ tests)
```

Test coverage includes auth flows, order state transitions, cross-tenant isolation, concurrent transitions, notification processing, webhook verification, encryption round-trips, and phone number search.

---

## Production Deployment

**Frontend (Vercel):**
- Framework: Vite
- Build command: `npm run build --workspace=frontend`
- Output directory: `frontend/dist`
- Environment variable: `VITE_API_BASE_URL` → your Render backend URL

**Backend (Render):**
- Build command: `npm install && npm --workspace=backend run build && npx --workspace=backend prisma generate`
- Start command: `npx --workspace=backend prisma migrate deploy && node backend/dist/server.js`
- Set all environment variables from the table above

---

## Database Schema

Four core models managed by Prisma:

- **Restaurant** — Account with hashed password, session versioning, status
- **WhatsAppConnection** — Per-restaurant WABA credentials with encrypted tokens
- **Order** — Lifecycle state machine with timestamps for each transition
- **NotificationAttempt** — Per-attempt delivery tracking with provider message IDs

Plus **NotificationOptOut** for customers who reply `STOP`.

See [backend/prisma/schema.prisma](backend/prisma/schema.prisma) for the full schema.

---

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/auth/signup` | Create restaurant account |
| `POST` | `/auth/login` | Sign in |
| `POST` | `/auth/logout` | Sign out |
| `GET` | `/auth/me` | Current user info |
| `POST` | `/auth/password-reset/request` | Request password reset |
| `POST` | `/auth/password-reset/confirm` | Confirm password reset |
| `GET` | `/orders` | List active orders (supports `?search=`) |
| `POST` | `/orders` | Create order |
| `POST` | `/orders/:id/ready` | Mark order ready (triggers notification) |
| `POST` | `/orders/:id/collected` | Mark order collected |
| `POST` | `/orders/:id/cancel` | Cancel order |
| `POST` | `/orders/:id/recall` | Resend notification |
| `GET` | `/connections/status` | WhatsApp connection status |
| `POST` | `/connections/signup/initiate` | Start Embedded Signup |
| `POST` | `/connections/signup/complete` | Complete Embedded Signup |
| `GET` | `/webhook` | WhatsApp webhook verification |
| `POST` | `/webhook` | WhatsApp delivery status callbacks |
| `GET` | `/health` | Health check (database connectivity) |

---

## Documentation

- [System Architecture](docs/ARCHITECTURE.md)
- [Local Development Guide](docs/development.md)
- [Environment Variables Reference](docs/ENVIRONMENT_VARIABLES.md)
- [Notification Engine](docs/NOTIFICATION_ENGINE.md)
- [WhatsApp Integration](docs/WHATSAPP_INTEGRATION.md)
- [Known Limitations](docs/KNOWN_LIMITATIONS.md)
- [Troubleshooting](docs/TROUBLESHOOTING.md)

---



