# Диагностика

## Шлюз не стартует: `Invalid configuration`

Сообщение перечисляет конкретные поля. Проверьте `.env`:

- для `longpoll` задан `VK_GROUP_ID`;
- для `callback` заданы `VK_CONFIRMATION` и `PUBLIC_URL`;
- `CHATWOOT_URL` — валидный URL; числовые `*_ID` — числа.

## VK не подтверждает Callback URL

- Шлюз должен быть **запущен** с правильным `VK_CONFIRMATION` **до** нажатия «Подтвердить».
- Адрес в настройках VK = `https://<домен>/vk/callback`, доступен по HTTPS извне.
- Проверьте reverse-proxy: `curl -i https://<домен>/health` → `200`.
- В логах шлюза при ошибке секрета будет `VK callback rejected: bad secret` — сверьте
  `VK_CALLBACK_SECRET` с полем «Секретный ключ» в VK.

## Сообщения из VK не появляются в Chatwoot

- Включено ли событие **Входящее сообщение** (`message_new`) в Long Poll/Callback.
- Включены ли «Сообщения сообщества» и возможности ботов.
- Верны ли `CHATWOOT_TOKEN`, `CHATWOOT_ACCOUNT_ID`, `CHATWOOT_INBOX_ID`.
- В логах ищите ошибки `Chatwoot ... failed: <status>`. `401/403` — токен; `404` — id аккаунта
  или инбокса; `422` — тело запроса/дубликат идентификатора.
- Включите `LOG_LEVEL=debug` для подробностей.

## Ответы из Chatwoot не доходят в VK

- **Callback URL инбокса** в Chatwoot = `https://<домен>/chatwoot/webhook`.
- В логах при получении вебхука должно быть `relayed Chatwoot -> VK`. Если
  `outbound message without a resolvable VK peer id` — в payload нет `source_id`; проверьте,
  что контакт создан шлюзом (его `source_id` = id пользователя VK).
- Если `invalid signature` (401) — задан `CHATWOOT_WEBHOOK_SECRET`, но подпись не совпала.
  Либо уберите секрет, либо сверьте схему подписи вашей версии Chatwoot (`X-Chatwoot-Signature`,
  `X-Chatwoot-Timestamp`, HMAC-SHA256 от `{timestamp}.{body}`).
- Право `VK_TOKEN` должно включать отправку сообщений.

## Вложения не пересылаются

- Превышен `MAX_ATTACHMENT_MB` — увеличьте лимит.
- Видео из VK не скачиваются (ограничение VK) — приходят ссылкой/заголовком, это ожидаемо.
- Ошибки `failed to upload attachment to VK` — проверьте права токена на Фото/Документы.

## Дубли сообщений

- Повторные доставки отсекаются дедуп-кэшем (TTL 5 мин, в памяти). При нескольких репликах
  настройте общий `REDIS_URL` (реализация Redis-стора — по плану, этап 6).

## Полезные команды

```bash
docker compose logs -f            # логи в Docker
curl http://localhost:3000/health # проверка живости
LOG_LEVEL=debug npm run dev       # подробные логи локально
```
