# Установка и запуск

Полное пошаговое руководство по развёртыванию `chatwoot-vk-gateway` рядом с вашим Chatwoot.

## 0. Предварительные требования

- Работающий **Chatwoot** (open-source), доступный по HTTP(S), и права администратора.
- Сообщество (группа) **vk.com**, где вы администратор.
- Сервер с **Node.js 20+** или **Docker** + **Docker Compose**.
- Для режима **Callback** — публичный **HTTPS-URL**, указывающий на шлюз (домен + сертификат,
  обычно через reverse-proxy: nginx / Caddy / Traefik).

Схема итоговой конфигурации:

```
VK сообщество  ⇄  chatwoot-vk-gateway  ⇄  Chatwoot (API-инбокс)
```

## 1. Настройка Chatwoot

Создайте **API-инбокс** и получите токен доступа. Подробно — в
[CHATWOOT_SETUP.md](CHATWOOT_SETUP.md). Кратко:

1. Settings → Inboxes → **Add Inbox** → **API**. Имя, например `VK`.
2. **Callback URL** инбокса = `https://<домен-шлюза>/chatwoot/webhook` (можно задать позже).
3. Запомните **номер инбокса** (`CHATWOOT_INBOX_ID`).
4. Profile → **Access Token** — это `CHATWOOT_TOKEN`.
5. **Account ID** — число после `/accounts/` в URL Chatwoot (`CHATWOOT_ACCOUNT_ID`).

Альтернатива шагам 1–3 — создать инбокс скриптом после заполнения `.env`:

```bash
npm run setup:inbox -- "VK" "https://<домен-шлюза>/chatwoot/webhook"
```

## 2. Настройка VK

Подробно — в [VK_SETUP.md](VK_SETUP.md). Кратко:

1. Управление сообществом → **Работа с API** → **Ключи доступа** → создайте ключ с правом
   **Сообщения**. Это `VK_TOKEN`.
2. **Long Poll** (для теста): Управление → Работа с API → **Long Poll API** → включить, версия
   как в `VK_API_VERSION`. Нужен числовой `VK_GROUP_ID`.
3. **Callback** (для прода): Управление → Работа с API → **Callback API** → укажите адрес
   `https://<домен-шлюза>/vk/callback`, строку подтверждения (`VK_CONFIRMATION`) и `secret`
   (`VK_CALLBACK_SECRET`), подпишитесь на событие **Входящее сообщение**.
4. Включите сообщения сообщества: Управление → **Сообщения** → включить «Сообщения сообщества»;
   Настройки для бота → разрешить добавлять в чаты / возможности ботов.

## 3. Конфигурация шлюза

```bash
cp .env.example .env
```

Заполните `.env` (полное описание — [CONFIGURATION.md](CONFIGURATION.md)):

```dotenv
VK_MODE=longpoll            # или callback для прода
VK_TOKEN=...                # ключ доступа сообщества
VK_GROUP_ID=123456789       # числовой id сообщества (для longpoll)
VK_API_VERSION=5.199

# только для VK_MODE=callback:
PUBLIC_URL=https://gw.example.com
VK_CONFIRMATION=...
VK_CALLBACK_SECRET=...

CHATWOOT_URL=https://chat.example.com
CHATWOOT_ACCOUNT_ID=1
CHATWOOT_TOKEN=...
CHATWOOT_INBOX_ID=7
CHATWOOT_WEBHOOK_SECRET=    # опционально, если включена подпись вебхуков
```

## 4. Запуск

### Вариант A — Node.js (для разработки/теста)

```bash
npm install
npm run dev        # авто-перезагрузка; или: npm run build && npm start
```

### Вариант B — Docker Compose (рекомендуется для прода)

```bash
docker compose up -d --build
docker compose logs -f
```

Шлюз слушает порт `PORT` (по умолчанию 3000). Проверка:

```bash
curl http://localhost:3000/health     # {"status":"ok"}
```

## 5. Reverse-proxy и HTTPS (для Callback)

Пример nginx:

```nginx
location /vk/callback     { proxy_pass http://127.0.0.1:3000; }
location /chatwoot/webhook { proxy_pass http://127.0.0.1:3000; }
```

Выдайте сертификат (Let's Encrypt). В настройках Callback API VK укажите
`https://<домен>/vk/callback` и подтвердите адрес — VK обратится к шлюзу и получит
строку подтверждения.

## 6. Проверка end-to-end

1. Напишите сообществу VK из личного аккаунта.
2. В Chatwoot в инбоксе `VK` появится контакт (с именем и аватаром), беседа и входящее сообщение.
3. Ответьте из Chatwoot — сообщение придёт пользователю в VK.
4. Проверьте вложения: отправьте фото и файл в обе стороны.

Если что-то не работает — см. [TROUBLESHOOTING.md](TROUBLESHOOTING.md).

## 7. Обновление

```bash
git pull
docker compose up -d --build      # или: npm install && npm run build && npm start
```
