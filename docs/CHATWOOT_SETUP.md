# Настройка Chatwoot

Шлюз использует **API-канал** Chatwoot (тип инбокса «API») и **Application API**.

## 1. Создайте API-инбокс

1. **Settings → Inboxes → Add Inbox**.
2. Выберите тип **API**.
3. Имя инбокса, например `VK`.
4. **Callback URL** = `https://<домен-шлюза>/chatwoot/webhook`
   (можно задать сейчас или позже — это адрес, куда Chatwoot шлёт события `message_created`).
5. Добавьте агентов, которые будут отвечать.

После создания запомните **номер инбокса** — он виден в URL настроек инбокса
(`/accounts/<acc>/settings/inboxes/<inbox_id>`). Это `CHATWOOT_INBOX_ID`.

Альтернатива — создать инбокс скриптом (после заполнения `CHATWOOT_*` в `.env`):

```bash
npm run setup:inbox -- "VK" "https://<домен-шлюза>/chatwoot/webhook"
```

## 2. Access token (CHATWOOT_TOKEN)

**Profile settings → Access Token**. Токен агента/администратора с доступом к аккаунту.
Это `CHATWOOT_TOKEN`. Шлюз шлёт его в заголовке `api_access_token`.

## 3. Account ID (CHATWOOT_ACCOUNT_ID)

Число после `/accounts/` в адресе Chatwoot, например в
`https://chat.example.com/app/accounts/1/...` это `1`.

## 4. Base URL (CHATWOOT_URL)

Корень установки без завершающего слэша, например `https://chat.example.com`.

## 5. Подпись вебхуков (опционально)

Если ваша версия/конфигурация Chatwoot подписывает доставки вебхуков, задайте общий секрет в
`CHATWOOT_WEBHOOK_SECRET`. Тогда шлюз проверит заголовки `X-Chatwoot-Signature` и
`X-Chatwoot-Timestamp` (HMAC-SHA256 от `{timestamp}.{body}`). Если секрет не задан —
неподписанные доставки принимаются. Точную схему сверьте со своей версией Chatwoot
(см. [TROUBLESHOOTING.md](TROUBLESHOOTING.md)).

## Что делает шлюз через API

| Действие           | Endpoint                                                  |
| ------------------ | --------------------------------------------------------- |
| Поиск контакта     | `GET /api/v1/accounts/{acc}/contacts/search?q=<vk_id>`    |
| Создание контакта  | `POST /api/v1/accounts/{acc}/contacts`                    |
| Беседы контакта    | `GET /api/v1/accounts/{acc}/contacts/{id}/conversations`  |
| Создание беседы    | `POST /api/v1/accounts/{acc}/conversations`               |
| Создание сообщения | `POST /api/v1/accounts/{acc}/conversations/{id}/messages` |

`source_id` контакта = числовой id пользователя VK; он же используется как `identifier`.
