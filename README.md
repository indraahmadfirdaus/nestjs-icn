# nestjs-icn

Task Board backend built with NestJS and Supabase. It provides authentication, task management, AI suggestions, health checks, and a daily summary job that aggregates user tasks and logs emails.

## Table of Contents
- [Overview](#overview)
- [Features](#features)
- [Tech Stack](#tech-stack)
- [Quick Start](#quick-start)
- [Configuration](#configuration)
- [Running](#running)
- [Scheduling](#scheduling)
- [API](#api)
- [Testing](#testing)
- [Project Structure](#project-structure)

## Overview
This project exposes a REST API for:
- Register, login, and retrieve the authenticated user
- Create, list, update, and delete tasks
- Request AI suggestions for task titles/descriptions
- Health checks for service and Supabase
- A daily summary job that aggregates tasks per user and writes email summaries to `public.email_logs`. Email sending can be mocked or performed via SMTP.

Notes:
- The backend cron (`DailySummaryService`) replaces the need for a Supabase Edge Function. You can still deploy the function if you prefer platform-managed scheduling.
- `SupabaseService.getAdminClient()` is used for privileged operations and bypasses RLS, analogous to the service role key.

## Features
- Authentication: register, login, JWT-based auth
- Tasks: CRUD operations with per-user scoping
- AI: suggestion endpoint for task content
- Email: SMTP integration with timeouts, mock mode falls back to logging in `email_logs`
- Daily Summary: scheduled job computes per-user summaries and logs emails

## Tech Stack
- NestJS
- Supabase (Postgres, RLS bypass via service role)
- Nodemailer (SMTP)
- TypeScript

## Quick Start
1. Install dependencies:
   - `cd backend && npm install`
2. Configure environment variables (see [Configuration](#configuration)).
3. Run the backend:
   - `npm run start:dev`

## Configuration
Set these variables in `backend/.env` or project root `.env`:

- Supabase
  - `SUPABASE_URL`
  - `SUPABASE_ANON_KEY`
  - `SUPABASE_SERVICE_ROLE_KEY`
  - `SUPABASE_USE_MOCK` (optional; `true` forces in-memory mock client)

- SMTP (optional; if omitted, email sending uses mock mode and logs to `email_logs`)
  - `SMTP_HOST`
  - `SMTP_PORT` (default `587`)
  - `SMTP_USER`
  - `SMTP_PASS`
  - `SMTP_CONNECTION_TIMEOUT` (default `10000` ms)
  - `SMTP_GREETING_TIMEOUT` (default `10000` ms)
  - `SMTP_SOCKET_TIMEOUT` (default `10000` ms)

- Daily Summary Cron
  - `DAILY_SUMMARY_CRON` (default `0 7 * * *`)
  - `DAILY_SUMMARY_TZ` (default `UTC`)

## Running
- Development: `npm run start:dev`
- Build: `npm run build`
- Production: `npm run start:prod`

Backend listens on `PORT` (default `3001`).

## Scheduling
The daily summary runs via a NestJS cron job (`DailySummaryService`).

- Change schedule: set `DAILY_SUMMARY_CRON` to a valid crontab string, e.g. `0 8 * * *`.
- Change timezone: set `DAILY_SUMMARY_TZ`, e.g. `Asia/Jakarta`.

Optional Supabase Edge Function:
- A function implementation exists at `supabase/functions/daily-summary/index.ts` if you prefer platform scheduling.
- To deploy via Supabase CLI: `supabase functions deploy daily-summary`
- To schedule via Supabase dashboard or pg_cron/pg_net, configure an HTTP trigger to the function.

## API
Key endpoints (require `Authorization: Bearer <token>` unless noted):

- Auth
  - `POST /auth/register` — Register user
  - `POST /auth/login` — Login and receive JWT
  - `GET /auth/me` — Current user

- Tasks
  - `POST /tasks` — Create task
  - `GET /tasks` — List tasks
  - `GET /tasks/:id` — Get task
  - `PATCH /tasks/:id` — Update task
  - `DELETE /tasks/:id` — Delete task

- AI
  - `POST /ai/suggest` — Suggest task title/description

- Health
  - `GET /health` — Basic service health
  - `GET /health/supabase` — Supabase connectivity

## Testing
- Run integration tests: `npm run test:e2e`
- Scripted API tests: from project root run `./test-api.sh`

## Project Structure
```
nestjs-icn/
├── backend/
│   ├── src/
│   │   ├── ai/
│   │   ├── auth/
│   │   ├── email/
│   │   ├── health/
│   │   ├── summary/           # DailySummaryService (cron)
│   │   ├── supabase/
│   │   └── tasks/
│   └── package.json
├── supabase/
│   ├── migrations/
│   └── functions/daily-summary/  # Optional Edge Function
├── test-api.sh
└── test-supabase.sh
```

## Notes
- Email sending is non-blocking in task creation. SMTP timeouts are set to avoid hanging requests.
- When Supabase credentials are missing or `SUPABASE_USE_MOCK=true`, an in-memory mock client is used for local development and tests.