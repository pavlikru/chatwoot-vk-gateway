# Contributing

Thanks for helping improve `chatwoot-vk-gateway`.

## Getting started

```bash
npm install
cp .env.example .env   # fill in for local testing
npm run dev
```

## Before opening a pull request

Run the full gate (the same checks CI runs):

```bash
npm run format:check && npm run lint && npm run typecheck && npm test && npm run build
```

- Add or update tests for any behavior change (`test/*.test.ts`, vitest).
- Update docs (`README.md`, `docs/*`, `.env.example`) when behavior or config changes.
- Keep the scope VK-only; this gateway intentionally supports a single messenger.

## Code style

- TypeScript strict, no `any`. ESM imports use `.js` extensions.
- Formatting is enforced by Prettier (`npm run format`).
- Keep transport code (`src/vk`, `src/chatwoot`) decoupled from orchestration (`src/core`).

See [AGENTS.md](AGENTS.md) for the module map and the Definition of Done.

## Reporting issues

Open a GitHub issue with: gateway version, `VK_MODE`, Chatwoot version, relevant logs (with
secrets redacted), and steps to reproduce.

## Security

Do not file public issues for security problems. Contact the maintainer privately instead.
