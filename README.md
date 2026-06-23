# chatwoot-vk-gateway

Шлюз, который связывает сообщения сообществ **vk.com** с **Chatwoot** (open-source) через
штатный **API-канал** Chatwoot. Не меняет ядро Chatwoot, разворачивается рядом в Docker.

- Входящие из VK → создаются контакт, беседа и входящее сообщение в Chatwoot.
- Ответы агентов из Chatwoot → доставляются обратно пользователю VK.
- Два режима приёма событий VK: **Long Poll** (без публичного URL, удобно для теста) и
  **Callback API** (публичный HTTPS, для продакшена) — переключаются одной переменной.

> Только VK. Чистый TypeScript, строгая типизация, тесты, Docker, CI.

## Возможности

- ✅ Текст в обе стороны
- ✅ Вложения VK → Chatwoot: фото, документы, голосовые, стикеры; видео/ссылки/гео — текстом
- ✅ Вложения Chatwoot → VK: фото и файлы (автозагрузка на сервера VK)
- ✅ Обогащение контакта: имя и аватар через `users.get`
- ✅ Индикатор «печатает…» (`messages.setActivity`)
- ✅ Дедупликация повторных событий (ретраи Callback, перекрытие Long Poll, переотправка вебхуков)
- ✅ Проверка HMAC-подписи вебхуков Chatwoot и `secret` Callback API VK
- ✅ Stateless: состояние не хранится, источник истины — Chatwoot (опц. Redis для дедупа)

## Как это работает

```
                 ┌─────────────────────────┐
 VK community ──▶ │  /vk/callback (Callback) │ ──┐
   (Long Poll) ──▶│  long poll loop          │   │  normalize
                 └─────────────────────────┘   ▼
                          chatwoot-vk-gateway ──────▶ Chatwoot Application API
                 ┌─────────────────────────┐   ▲      (contacts/conversations/messages)
 Chatwoot ─────▶ │ /chatwoot/webhook        │ ──┘
 (message_created)└─────────────────────────┘ ──────▶ VK messages.send
```

Подробно — в [docs/INSTALL.md](docs/INSTALL.md).

## Быстрый старт (Long Poll, для теста)

Требуется Node.js 20+.

```bash
git clone https://github.com/pavlikru/chatwoot-vk-gateway.git
cd chatwoot-vk-gateway
npm install
cp .env.example .env
# заполните VK_TOKEN, VK_GROUP_ID, CHATWOOT_* в .env (VK_MODE=longpoll)
npm run dev
```

Проверка: `curl http://localhost:3000/health` → `{"status":"ok"}`.
Напишите сообществу VK — сообщение появится в Chatwoot; ответьте из Chatwoot — придёт в VK.

## Запуск в Docker (продакшен)

```bash
cp .env.example .env   # заполните, для прода VK_MODE=callback + PUBLIC_URL
docker compose up -d --build
docker compose logs -f
```

## Документация

| Документ                                           | О чём                                      |
| -------------------------------------------------- | ------------------------------------------ |
| [docs/INSTALL.md](docs/INSTALL.md)                 | Полная пошаговая установка                 |
| [docs/VK_SETUP.md](docs/VK_SETUP.md)               | Сообщество VK, токен, Long Poll / Callback |
| [docs/CHATWOOT_SETUP.md](docs/CHATWOOT_SETUP.md)   | API-инбокс, access token, callback URL     |
| [docs/CONFIGURATION.md](docs/CONFIGURATION.md)     | Все переменные окружения                   |
| [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) | Частые проблемы                            |

## Разработка

```bash
npm run dev          # запуск с авто-перезагрузкой (tsx watch)
npm test             # юнит-тесты (vitest)
npm run lint         # ESLint
npm run typecheck    # tsc --noEmit
npm run build        # сборка в dist/
npm run setup:inbox  # создать API-инбокс в Chatwoot (хелпер)
```

Для LLM-агентов (OpenAI Codex и др.) правила и Definition of Done — в [AGENTS.md](AGENTS.md).
Как помочь проекту — в [CONTRIBUTING.md](CONTRIBUTING.md).

## Лицензия

[MIT](LICENSE)

---

## English (short)

A gateway bridging **vk.com** community messages with **Chatwoot** (open-source) via Chatwoot's
**API channel**. VK-only, TypeScript, Docker-ready. Inbound VK messages become Chatwoot
contacts/conversations/messages; agent replies are delivered back to VK. Supports both VK **Long
Poll** (no public URL, good for testing) and **Callback API** (public HTTPS, production), text and
attachments both ways, contact enrichment, dedup and webhook signature verification. See
[docs/INSTALL.md](docs/INSTALL.md). Quick start: `npm install && cp .env.example .env && npm run dev`.
