# AIOS Server

Node.js + TypeScript + Prisma + PostgreSQL backend for the AIOS Web platform.

## Quick Start

### 1. Start PostgreSQL

```bash
docker compose up -d
```

Or point `DATABASE_URL` at an existing PostgreSQL instance.

### 2. Configure environment

```bash
cp .env.example .env
# Edit .env if your DB credentials differ
```

### 3. Install dependencies & run migrations

```bash
npm install
npm run db:push       # push schema to DB (dev)
# or: npm run db:migrate   # for tracked migrations
```

### 4. Start dev server

```bash
npm run dev
# → http://localhost:3001
```

## API

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/auth/register` | Register a new user |
| POST | `/api/auth/login` | Login and receive JWT |
| GET | `/api/health` | Health check |

### Register payload
```json
{ "email": "user@example.com", "password": "password123", "name": "张三" }
```

### Login payload
```json
{ "email": "user@example.com", "password": "password123" }
```

Both return: `{ "token": "...", "user": { "id", "email", "name" } }`
