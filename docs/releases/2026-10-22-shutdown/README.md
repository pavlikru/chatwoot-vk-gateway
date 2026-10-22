# Graceful shutdown — 22 октября 2026

## Изменение

Источник — main после PR #4, прежний production candidate `7ca82d6` / config digest `8fbf59f7…`.
Новый candidate устраняет преждевременный `process.exit(0)` после HTTP ACK:

- Один общий Set отслеживает входящие VK и исходящие Chatwoot delivery promises.
- Chatwoot delivery регистрируется до HTTP ACK. ACK остаётся быстрым, обработка асинхронной.
- SIGTERM/SIGINT останавливает HTTP ingress/Long Poll, дожидается принятой обработки,
  затем закрывает dedup и завершает процесс с exit 0. Повторный сигнал не ускоряет остановку.
- Неудачная доставка не прерывает ожидание остальных (`allSettled`). Backoff Long Poll
  отменяется сигналом; уже полученный batch передаётся обработчикам целиком.
- `SHUTDOWN_TIMEOUT_MS` (default 30000, positive int <=2147483647) ограничивает всю остановку.
  Если время истекло, безопасный лог с pendingTasks и exit 1. HTTP/poll/dedup тоже входят в deadline.

Новая очередь/БД, retries/idempotency и формат webhook не добавлялись; auth, лимиты и SDK неизменны.
При OOM/SIGKILL/host failure и по истечении deadline фоновые задачи всё ещё могут быть потеряны.
Это исправление штатного управляемого restart, не durable хранение заданий.

## Проверки

95 local tests: реальный entrypoint с loopback Chatwoot stub и synthetic env, пустой cwd,
нет внешних отправок. Удерживается принятая delivery; SIGTERM не завершает gateway до её конца.
Отдельные случаи: idle shutdown, failed+pending delivery, повторный SIGINT, timeout exit 1,
отказ новых запросов во время drain, ACK registration ordering, завершение Long Poll/backoff.
Все обычные app gates и GitHub CI выполняются на release source; результаты будут сохранены рядом.

`verify-shutdown.mjs` проверяет compiled actual entrypoint в candidate image: synthetic callback,
локальный downstream, удержание ответа при SIGTERM, последующее завершение/timeout. Запускать
через stdin в `/app`, `--network none`, 128 MiB/0.5 CPU/swap0. Только ephemeral local resources.
Для общего JSON/auth/size контракта переиспользуется прошлый `verify-candidate.mjs` с synthetic
actual Chatwoot Trigger fixture; логика endpoint не менялась кроме порядка registration/ACK.

## Конкретный operational diff для Ops

Пересоздать только gateway с новым immutable image и `stop_grace_period: 40s` в его сервисе
`/opt/chatwoot/compose.yml`. Default app deadline — 30s, новый env не обязателен; остальные env,
resource limits 128 MiB/0.5 CPU, callbacks, сети, secrets и shared services сохраняются.
При custom SHUTDOWN_TIMEOUT_MS Docker grace обязан быть больше app deadline с запасом.
Root docker-compose.yml уже содержит 40s; production Compose ведёт Ops отдельно.

Перед rollout сохранить текущий рабочий image/config recovery. Candidate сверяется по image/config
identity и archive SHA, прогоняется native с synthetic env/network none под текущим budget.
Проверка grace должна удерживать downstream, а не ограничиваться пустым health.
После установки сверить actual StopTimeout, Node/image/compiled hashes, auth/confirmation,
разрешённый двусторонний delivery/attachment и отсутствие дубликатов; наблюдение — у Ops.
Возврат: previous gateway image и точная предыдущая gateway Compose stanza. Данные/volumes не
трогать, не запускать параллельный gateway с рабочими credentials.

Production rollout выполняет Ops; app-команда подготавливает проверенный candidate, PR/CI и handoff.

## Собранный candidate

Source `2a2aaa571d1ac87ac9db29446545395859648556`, тег `gateway-shutdown-candidate-20261022`.
Image `chatwoot-vk-gateway:shutdown-20261022`, config digest
`sha256:96c2db4b832ce77415f7d329927eace5776298e7ffa8ccb0bb8ced723ec2dee6`.
Archive SHA-256 `8aa56af9ff68d556416f50cbb7fa44369ab357fa1e76c128692eddd32ae55ffb`.
[Полные identity/handoff inputs](candidate.json); [actual compiled/runtime fingerprints](image-metadata.json).
Сборка из clean source linux/amd64 завершена; actual Node 24.22.1, lock/compiled SHA совпали с local build.
95 local tests и все обычные gates PASS; [hosted CI](github-ci.json): build/docker success.
Native 128 MiB/.5CPU shutdown proof и production rollout ожидают Ops; этот candidate не объявлен deployed.

## Постоянная Docker regression в CI

Docker job запускает `verify-shutdown.mjs` на только что собранном image с network none,
128 MiB / swap0 / .5CPU. Проверяются held delivery + SIGTERM и timeout exit1; checker сам
завершается exit0 только при успехе обоих сценариев. Для ускорения timeout case использует
SHUTDOWN_TIMEOUT_MS=1000; default приложения остаётся 30000. App/source build inputs candidate
`2a2aaa5` не меняются этой проверкой.
