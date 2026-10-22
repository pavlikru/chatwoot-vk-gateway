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
- Исходящие сообщения форвардятся только когда payload содержит id нужного API-инбокса
  (`inbox.id`, `inbox_id`, `conversation.inbox_id` или `conversation.inbox.id`). Если используется
  account-level webhook и сообщения игнорируются, настройте Callback URL прямо в API-инбоксе `VK`.
- Если `invalid signature` (401) — задан `CHATWOOT_WEBHOOK_SECRET`, но подпись не совпала.
  Для первого end-to-end теста оставьте `CHATWOOT_WEBHOOK_SECRET` пустым: тогда шлюз принимает
  неподписанные доставки. После проверки доставки задайте его равным секрету API-инбокса или
  account webhook в Chatwoot и перезапустите шлюз.
- В Chatwoot 4.15.1 account webhooks и API inbox webhooks подписываются, когда у webhook/channel
  есть `secret`: Chatwoot отправляет `X-Chatwoot-Timestamp` и `X-Chatwoot-Signature` со значением
  `sha256=<hex>`, где `<hex>` — HMAC-SHA256 от `{timestamp}.{raw_json_body}`. Automation/macro
  webhook actions в этой версии вызывают доставку без секрета и не подходят для включённого
  `CHATWOOT_WEBHOOK_SECRET`.
- Право `VK_TOKEN` должно включать отправку сообщений.

## Вложения не пересылаются

- Превышен `MAX_ATTACHMENT_MB` — увеличьте лимит.
- Видео из VK не скачиваются (ограничение VK) — приходят ссылкой/заголовком, это ожидаемо.
- Ошибки `failed to upload attachment to VK` — проверьте права токена на Фото/Документы.

## Дубли сообщений

- Повторные доставки отсекаются дедуп-кэшем (TTL 5 мин).
- Без `REDIS_URL` кэш хранится в памяти процесса. Это нормально для одной реплики, но после
  рестарта и между несколькими репликами история не общая.
- Для продакшена с несколькими репликами настройте общий Redis и задайте
  `REDIS_URL=redis://<host>:6379[/db]`.
- Если Redis недоступен, шлюз не стартует. Проверьте адрес, сеть и логи
  `redis dedup client error`.

## Полезные команды

```bash
docker compose logs -f            # логи в Docker
curl http://localhost:3000/health # проверка живости
LOG_LEVEL=debug npm run dev       # подробные логи локально
```
