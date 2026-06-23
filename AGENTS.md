# AGENTS.md — instructions for coding agents

This file gives any coding agent (OpenAI Codex, Claude, etc.) the context and rules to develop
this repository safely. It is intentionally tool-agnostic: no command here is specific to a
particular assistant. Read it fully before making changes.

## What this project is

`chatwoot-vk-gateway` is a standalone **Node.js/TypeScript** service that bridges **vk.com**
community messages with **Chatwoot** (open-source) through Chatwoot's **API channel**. It does
**not** fork or modify Chatwoot core. The full design and milestones live in the project plan
referenced by the maintainer; this file is the day-to-day contract.

Data flow:

- **Inbound** (VK → Chatwoot): a VK event arrives via Long Poll or Callback API → normalized →
  Chatwoot contact/conversation resolved → an `incoming` message is created (with attachments).
- **Outbound** (Chatwoot → VK): Chatwoot posts a `message_created` webhook → the gateway filters
  agent outgoing messages → uploads attachments to VK → sends via `messages.send`.

## Commands

```bash
npm install          # install dependencies
npm run dev          # run locally with auto-reload (tsx watch)
npm run build        # compile TypeScript to dist/
npm start            # run the compiled build
npm test             # run unit tests (vitest)
npm run lint         # ESLint
npm run typecheck    # tsc --noEmit
npm run format       # apply Prettier
npm run format:check # verify formatting (used by CI)
```

## Definition of Done (every change)

A change is complete only when **all** of these pass locally:

1. `npm run format:check` — clean
2. `npm run lint` — no errors
3. `npm run typecheck` — no errors
4. `npm test` — all green (add/adjust tests for the behavior you changed)
5. `npm run build` — succeeds
6. Docs updated when behavior or configuration changed (`README.md`, `docs/*`, `.env.example`)

CI (`.github/workflows/ci.yml`) runs the same gates plus a Docker build. Do not merge red CI.

## Conventions

- **TypeScript strict.** No `any` (`@typescript-eslint/no-explicit-any` is an error). Prefer
  precise types; use `unknown` + narrowing at boundaries.
- Small, pure functions. Keep transport adapters (`src/vk`, `src/chatwoot`) separate from
  orchestration (`src/core`). `core/` speaks only the normalized types in `src/types.ts`.
- ESM only. Use `.js` extensions in relative imports (NodeNext resolution).
- Log via the `pino` logger; never log secrets or tokens.
- Secrets come only from config (`src/config.ts`, validated with zod). Never hardcode them.
- New env vars: add to `src/config.ts`, `.env.example`, and `docs/CONFIGURATION.md` together.

## Module map (where things go)

| Area             | File                                                           | Responsibility                                          |
| ---------------- | -------------------------------------------------------------- | ------------------------------------------------------- |
| Config           | `src/config.ts`                                                | zod-validated env → `Config`                            |
| Logging          | `src/logger.ts`                                                | pino logger factory                                     |
| HTTP server      | `src/server.ts`                                                | Fastify: `/health`, `/vk/callback`, `/chatwoot/webhook` |
| Entrypoint       | `src/index.ts`                                                 | wire deps, start server + VK updates, graceful shutdown |
| VK client        | `src/vk/client.ts`                                             | vk-io API: users.get, messages.send, setActivity        |
| VK updates       | `src/vk/updates.ts`                                            | Long Poll loop + Callback handler                       |
| VK attachments   | `src/vk/attachments.in.ts`, `attachments.out.ts`               | parse / upload media                                    |
| Chatwoot client  | `src/chatwoot/client.ts`                                       | Application API REST                                    |
| Chatwoot webhook | `src/chatwoot/webhook.ts`                                      | signature verify, filtering, peer extraction            |
| Orchestration    | `src/core/inbound.ts`, `outbound.ts`, `mapping.ts`, `dedup.ts` | the pipelines                                           |
| Shared types     | `src/types.ts`, `src/vk/types.ts`, `src/chatwoot/types.ts`     | payload shapes                                          |
| Tests            | `test/*.test.ts`                                               | vitest unit tests                                       |
| Inbox helper     | `scripts/setup-chatwoot-inbox.ts`                              | create a Chatwoot API inbox                             |

## Do not

- Do **not** modify or fork Chatwoot core — integrate only via its public API/webhooks.
- Do **not** add other messengers (Telegram, WhatsApp, …). This project is VK-only.
- Do **not** commit secrets, `.env`, or generated artifacts (`dist/`, `node_modules/`).
- Do **not** introduce a database unless a milestone requires it; prefer stateless + optional Redis.

## Verifying against live services

Some behaviors (exact Chatwoot contact/conversation resolution per version, VK attachment edge
cases, webhook signature scheme) must be validated against a **real** Chatwoot install and a real
VK community — they cannot be fully verified by unit tests. When touching those paths, test with
real credentials following [docs/INSTALL.md](docs/INSTALL.md) and note any deployment-specific
findings in [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md).
