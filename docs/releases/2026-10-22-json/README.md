# VK gateway JSON fix — source bundle, 22 октября 2026

**Статус: RELEASED — production принят Ops по O1–O8, hosted GitHub CI PASS.**
Первый source snapshot: `099cbd2` / `gateway-json-source-20261022`. Candidate source `7ca82d64d706e4a4faa7569389c774a6df2b6af9`, тег `gateway-json-candidate-20261022`.
[Image identity, archive SHA и команды](candidate.json); production rollout выполняет Ops по ТЗ 2.

## Сохранённый baseline

- Начальный HEAD: `5f9e90c`. Все 17 существовавших изменённых/новых файлов сохранены
  **до исправления** коммитом `1cd0bd77cc7957552abb1a4780be996f2c684cfe`.
- `git diff 5f9e90c 1cd0bd7` показывает локальный patch: обязательные timestamp/prefix HMAC,
  fail-closed inbox filtering с несколькими payload shapes, опциональный Redis dedup с валидацией
  config/закрытием клиента, безопасная диагностика отсутствия signature, тесты и документация.
  `src/server.ts` в этом patch добавляет только boolean-диагностику signature rejection.
  Redis уже существовал в рабочем дереве; новая БД/очередь/backend этой правкой не введены.
- Merge `13fcd62e4e2641e4e6de433957cf34835d1e4fbd` сохранил изменения `origin/main` до
  `f72e7b0`: BusyBox wget healthcheck, interval 60s/timeout 10s/start_period 20s.
- Baseline lock SHA и source fingerprints: [fingerprints.json](fingerprints.json).
  Существующие 26 тестов baseline прошли. На локальном baseline `app.inject` с synthetic JSON
  `{"synthetic":"marker",` дал **500 на обоих POST endpoints, 0 вызовов stub**.
  Новые HTTP-регрессии до исправления: 25 failed / 20 passed; после исправления зелёные.

## Подтверждённый production baseline, 2026-10-22 15:02 UTC

Ops предоставил immutable package/dist, runtime inventory, recovery hash и actual Chatwoot fixture.
Доказательства без env/секретов: [ops-baseline.json](ops-baseline.json).
Реконструированный production baseline сохранён отдельно: `77ccd0ac3c1110442cc0920e2c6db7924fb88ddf`
(`codex/production-baseline-20261022`), `5f9e90c` + [production-baseline.patch](production-baseline.patch).
Patch добавляет только boolean диагностику наличия timestamp/signature. Проверены все 36 `.js`/maps:
побайтовое совпадение с immutable production; compiler TypeScript 5.9.3. Исходный TS не извлечён:
это доказанная compiled-equivalent реконструкция. Source tree и build lock исторической сборки
восстановить побайтово нельзя; hidden installed npm lock не выдаётся за исходный package-lock.

Actual platform `linux/amd64`, Node 20.20.2/npm 10.8.2; 128 MiB, swap 0, CPU 0.5; writable paths
и mounts пусты. Docker29 image inspect ID/RepoDigest `de604635…dd8fa40` отличается от config digest
`6c8d656e…6977b40e` — оба сохранены в evidence. Recovery archive на сервере Ops:
`/var/backups/vk-gateway-ops-20261022/previous-image.tar`, SHA-256
`1328c90bcf3dcce468822f380d308311355a96862041ebbc225c482dd0eb8e61`; Compose backup также сохранён.
Matching old image изолированно (`--network none`, synthetic config/stubs): malformed JSON на обоих
POST →500, downstream calls 0; VK secret/confirmation и raw HMAC acceptance/rejection подтверждены.

### Дополнительные изменения source release относительно production

Сохранённый ранее локальный baseline `1cd0bd7` содержит **не-live** изменения: strict timestamp/prefix
HMAC, fail-closed inbox filtering, optional Redis/config и close. Их нельзя называть production patch.
Они сохраняются в source release: actual Chatwoot 4.18.0 подписывает timestamp+raw body в нужном
формате и передаёт inbox.id; synthetic actual-Trigger fixture проверяет совместимость. В production
REDIS_URL отсутствует, поэтому candidate использует прежний in-memory backend; Redis не включается
и operational services/env не меняются. Тесты проверяют default backend и существующий optional path.
Остальные изменения: JSON/shape rejection, безопасные error logs, Node/dependency updates и ранее
внесённый wget healthcheck. Rollout/реальные сообщения принадлежат Ops.

## Исправление и контракт

Вместо передачи `SyntaxError` без status используется штатный Fastify JSON parser с сохранением
исходного Buffer для HMAC. Проверяется только корневой тип объекта; неизвестные event fields
допускаются. Штатная защита parser от prototype/constructor poisoning сохранена.

| Method/path              | Вход и авторизация                                                                                | Успех                                                | Отказы приложения                                                                       |
| ------------------------ | ------------------------------------------------------------------------------------------------- | ---------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `GET /health`            | Без body/auth                                                                                     | `200 {"status":"ok"}`                                | Внутренняя ошибка остаётся 500                                                          |
| `POST /chatwoot/webhook` | JSON-объект; при secret обязательны `X-Chatwoot-Timestamp` и `X-Chatwoot-Signature: sha256=<hex>` | `200 {"status":"ok"}`, обработка фоновая             | 400 JSON/shape, 401 signature, 413 size, 415 media type, 500 internal                   |
| `POST /vk/callback`      | Только callback mode; JSON-объект; при secret совпадение `body.secret`                            | confirmation string либо `200 ok`, обработка фоновая | 400 JSON/shape, 403 secret, 413 size, 415 media type, 500 internal; в longpoll mode 404 |

Content-Type: `application/json` (допускается `; charset=utf-8`); `text/plain` теперь 415.
Лимит **26 214 400 bytes (25 MiB)** не изменён. Syntax/shape проверяются до бизнес-обработчиков;
парсинг/size могут отклонить запрос до auth. `{}` разрешён как объект; полная event schema не вводилась.
Ошибки attachment download/upload также логируются без URL и исходного исключения.
Ошибки HTTP возвращают безопасный текст статуса. 5xx логируется как status/requestId; ошибки фоновых
webhook handlers — по операции, без исходного error message/stack. Причину воспроизводят на
synthetic fixtures; тела запросов и secret headers в диагностику не включают.

HMAC: `HMAC-SHA256(timestamp + "." + received_body_bytes)`, без stringify/нормализации.
Timestamp входит в подпись; окно свежести не добавлялось. Исторический контракт проверен тестами.
Для указанной в saved Ops docs версии 4.18.0 статически сверены официальные
[Trigger](https://github.com/chatwoot/chatwoot/blob/v4.18.0/lib/webhooks/trigger.rb) и
[Listener](https://github.com/chatwoot/chatwoot/blob/v4.18.0/app/listeners/webhook_listener.rb):
API inbox передаёт `inbox.channel.secret`, account webhook — `webhook.secret`, headers/formula
совпадают. Ops подтвердил actual Chatwoot 4.18.0, Channel::Api inbox 12/account 4, совпадение secret с gateway
и отсутствие account webhooks к gateway. `test/fixtures/chatwoot-4.18-trigger.json` создан actual
`Webhooks::Trigger#request_headers` с **новым synthetic secret**, без network/DB. Он проверяется
Vitest и isolated candidate; production signature/secret в bundle отсутствуют.

## Runtime и dependency decisions

По [официальному schedule](https://github.com/nodejs/Release/blob/main/schedule.json) на дату работы
Node 20 EOL, Node 24 поддерживается до 2028-04-30, Node 26 становится LTS 2026-10-28.
Выбрана Node **24.22.1**, обе Docker stages закреплены на official Alpine 3.24 OCI index digest
из fingerprints. `docker buildx imagetools inspect node:24.22.1-alpine3.24` подтвердил digest;
Runtime candidate подтверждён: Node 24.22.1, npm 11.19.1, linux/x64 (amd64). Engines ограничены Node 24, CI использует 24.22.1.
Локальные проверки выполнены существующим Node **24.15.0**, npm **11.12.1**, darwin/arm64.

Точные версии всех прямых dependencies — в fingerprints, полное дерево — в lockfile.
Обновлены Fastify 5.12.7, pino 10.4.0, dotenv 18.0.8, Redis 6.3.0 и совместимые transitive patches.
SDK vk-io 4.10.1 оставлен как latest stable; его node-domexception deprecated dependency не
подменялась самодельным override. Dotenv работает с `quiet: true`, публичный config API сохранён.

- ESLint 9 [достиг EOL](https://eslint.org/version-support/), обновлён до 10.13.0 с совместимыми
  typescript-eslint/config-prettier. Vitest 5.0.5 устраняет advisory chains старого runner.
- TypeScript 5.9.3 оставлен: установленный typescript-eslint 8.72.0 требует TypeScript `<6.1.0`,
  latest TypeScript 7 несовместим с этим проверенным toolchain.
- Zod 3.25.76 оставлен: это актуальная v3, конфигурационная валидация сохранена. По
  [официальным docs](https://github.com/colinhacks/zod/blob/main/packages/docs/content/library-authors.mdx)
  v3 продолжает получать security/однозначные bug fixes, новые features идут в v4. Миграция
  semantics/errors конфигурации на v4 отложена отдельно; известных advisories audit не показывает.
- Baseline runtime audit: 3 high package entries (Fastify, fast-uri, find-my-way); общий audit:
  14 entries, включая dev dependencies. После обновления **npm audit и --omit=dev: 0**.
  Это результат registry audit на дату работы, не утверждение об отсутствии всех уязвимостей.

Build context ограничен allowlist Dockerfile/package manifests/tsconfig/src. `.env`, локальные
настройки, тесты, docs, .git, node_modules и dist с хоста исключены. Runtime копирует только
package manifests, production dependencies и compiled dist. [Docker build](docker-build.txt) завершён успешно из clean commit `7ca82d6`, `--platform linux/amd64`.
[Image provenance](image-provenance.json): проверены root allowlist, отсутствие dev tooling,
отсутствие gateway env в image config/history, credential-free registry URLs в lockfile.
[Actual runtime fingerprints](image-metadata.json): все compiled/lock SHA совпадают с локальной
сборкой. Образ: `sha256:8fbf59f70d3fcec7fdfa51a5cb982cafd616e1b2f77e6346ae083740f1e10f4f`,
archive 75 392 260 bytes, SHA-256 `d4cf1a56a726696f958f76d4941273884c04c3421e68da36a5d002b9689bdbad`.
Registry digest отсутствует: передаётся restricted image archive, не registry tag.

### Проверка resource budget

Mac/Docker — ARM64; для linux/amd64 включён существующий QEMU/binfmt image (без новых
установок/увеличения cap). Node24 startup в нативном окружении не эквивалентен эмуляции.
Под QEMU `verify-candidate.mjs` и actual entrypoint завершились OOM/137 при 128 MiB/0.5 CPU,
сеть `none`, swap 0. Workload не увеличивался, лимит не поднимался. Diagnostic imports:
Node core cgroup current 63 782 912; +Fastify 107 270 144; +vk-io 130 686 976 bytes;
Node RSS reporting в эмуляции возвращает 0 и не используется как метрика.
[Измерения](emulated-memory-stages.jsonl) и state в candidate.json. Это не PASS по budget и не
доказательство такого же расхода на native amd64. Ops запросил provisional archive для отдельного
native запуска в том же cap, без production env/сети/credentials. Native проверки завершены PASS;
image/archive не менялись после provisional handoff.

**Native Linux/amd64, тот же archive:** [30 contract cases](native-contract.json) и
[штатный entrypoint/SIGTERM](native-process.json) PASS, network none, 128 MiB / swap 0 / CPU 0.5.
Contract current/peak 31 068 160 / 34 852 864 bytes; process current/peak 32 419 840 / 36 331 520
bytes (peak 34.7 MiB). max/oom/oom_kill = 0. Это короткая synthetic проверка и 5s idle sample,
не гарантия памяти при реальном потоке/крупных attachments. Production observation выполняет Ops.
Первый native attempt упал EACCES на root-owned synthetic fixture: исправлен только её mode 0444
в root0700 task directory; image и gateway secrets не менялись, evidence сохранён.
Docker29 native inspect ID/local RepoDigest `64ff3858…770ac3d` отличается от config digest
`8fbf59f7…f1e10f4f`; archive SHA/config/compiled fingerprints совпали. Не смешивать эти identifiers.

Повторяемые self-check scripts: [contract](verify-candidate.mjs), [actual process](verify-process.py),
[identity/filesystem](image-metadata.mjs). Contract запускается через stdin в `/app` с read-only
mount synthetic fixture в `/tmp/actual-trigger-fixture.json`; команды в candidate.json.
Actual process script создаёт только network-none synthetic container, проверяет health,
confirmation, actual Trigger signature, malformed JSON по HTTP, 5s idle sample и SIGTERM exit 0;
сохраняет cgroup memory/current/peak/events и удаляет свой container. Это не нагрузочный тест.

## Проверки G1–G8

| AC  | Результат                              | Доказательство / следующий шаг                                                                                                                  |
| --- | -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| G1  | PASS reconstructed baseline            | 36 compiled files equal, patch/ref/recovery retained; original TS/build-lock provenance explicitly unknown                                      |
| G2  | PASS local + native candidate          | Оба включённых POST: malformed JSON 400, stub calls 0; callback mode fixture                                                                    |
| G3  | PASS local + native candidate          | Empty/whitespace/null/array/scalars 400, unsupported media 415, bounded 64 KiB-chunk stream >25 MiB →413                                        |
| G4  | PASS local/actual live Trigger fixture | UTF-8/Unicode/whitespace/CRLF Buffer, NFC/byte mutation и missing/wrong headers; actual Chatwoot 4.18.0 scheme/secret equality подтверждены Ops |
| G5  | PASS stubs + Ops live                  | Secret/confirmation, ACK, filters, dedup, attachments; production deliveries/attachment/replay accepted by Ops                                  |
| G6  | PASS local + native tested errors      | Captured pino logs и responses без synthetic body/secret/signature markers; internal failure остаётся 500                                       |
| G7  | PASS                                   | Lock/base digest сохранены, source tag известен; linux/amd64, image/Node/lock/archive известны; native contract/process budget PASS             |
| G8  | PASS local + hosted GitHub CI          | [candidate-gates.txt](candidate-gates.txt), 82 tests, Docker build; [hosted CI evidence](github-ci.json)                                        |

Без реальных VK/Chatwoot сообщений или внешних отправок. Fixtures находятся в `test/server.test.ts`,
`test/pipelines.test.ts`, `test/shutdown.test.ts`. Последний запускает отдельный процесс с пустым cwd
и явным synthetic env: confirmation → SIGTERM → exit 0. HTTP tests отдельно доказывают, что
ACK/`app.close()` не ждут незавершённых фоновых callback/webhook promises.

## Shutdown, rollout и rollback

Фоновые pipelines и longpoll handler promises не включены в drain `app.close()`; SIGTERM
вызывает abort poll, закрывает HTTP и dedup, затем `process.exit(0)`. Дополнительное время
`stop_grace_period` не создаёт drain. Уже ACK-нутые события могут быть потеряны при recreate.
Dedup TTL 5 минут: in-memory история теряется после restart/между репликами; ключ помечается
до отправки, поэтому failed send может подавить retry. Даже существующий optional Redis не
обеспечивает exactly-once/очередь. Новая drain/queue архитектура не добавлялась.

Ops должен согласовать окно без активных отправок, приостановить новые deliveries на их стороне,
подтвердить завершение известной обработки и учесть невозможность доказать отсутствие всех
in-flight задач текущими средствами. Нельзя объявлять recreate lossless. Если требуется гарантия
сохранения ACK-нутых сообщений, этот release не даёт GO без отдельного решения для обработки.
Не запускать второй gateway с рабочими credentials; secrets не отключать ради smoke.

После сверки baseline повторить все gates на финальном candidate source commit,
из чистого checkout собрать для **подтверждённой Ops платформы**:

```bash
git status --porcelain                 # должен быть пустым
git rev-parse HEAD
shasum -a 256 package-lock.json
df -h .
npm ci
npm run format:check
npm run lint
npm run typecheck
npm test
npm run build
# OPS_PLATFORM и RELEASE_IMAGE задаются из согласованного release inventory.
docker build --platform "$OPS_PLATFORM" -t "$RELEASE_IMAGE" .
docker image inspect "$RELEASE_IMAGE" --format '{{.Id}} {{.Os}}/{{.Architecture}}'
docker run --rm --network none --entrypoint node "$RELEASE_IMAGE" --version
```

Изолированная проверка actual candidate, без production env и сообщений: app tests/fixtures,
lock/compiled hashes, npm production tree, secret-free filesystem/history/logs и memory/peak/OOM
в подтверждённом Ops budget 128 MiB / 0.5 CPU / swap 0.
Identity передаваемого image: ID + registry digest либо SHA-256 restricted `docker save` archive;
не требовать побайтового совпадения двух независимых builds. Записать commit/platform/identity/Node
и пересчитать G1–G8. Actual candidate fingerprints находятся в image-metadata.json; их совпадение с local build проверено.

Production rollout — только Ops по своему runbook: сохранённый immutable old image и точная
gateway Compose backup, recreate только gateway без зависимостей/volumes/shared services,
одна реплика. Проверить actual image, public health, auth/confirmation и разрешённые двусторонние
тестовые deliveries/attachments, затем согласованное окно наблюдения. Health 200 не закрывает AC.
При auth/delivery/OOM/image regression вернуть previous image + gateway Compose config,
проверить те же workflows; runtime rollback не восстанавливает DB и не удаляет новые сообщения.
WAF, proxy limits/auth, DNS/firewall и Chatwoot core не менялись.

## Передача и оставшиеся границы

Build source строго `7ca82d64d706e4a4faa7569389c774a6df2b6af9`; последующие commits меняют только
release evidence/scripts. Образ повторно не пересобирался. Итоговые identity/GO — `candidate.json`.
G8 подтверждён локальными gates и hosted GitHub Actions: build и docker jobs завершились success,
[run evidence](github-ci.json). Ветка, baseline и релизные теги опубликованы;
[PR #4](https://github.com/pavlikru/chatwoot-vk-gateway/pull/4) проходит проверки перед merge.
Ops выполнил production acceptance по ТЗ 2; результаты приведены в production-acceptance.json.

## Existing operational finding

Ops read-only VK check: active callback URL/secret совпадают, status ok; текущее значение
VK_CONFIRMATION не совпадает с кодом VK API. Это существующая конфигурационная проблема,
не регрессия candidate. Павел разрешил Ops исправить только этот ключ при своём rollout,
с protected env backup. Шлюз поддерживает confirmation; эта задача не читает/меняет production
значения и не выполняет реальные sends. Production end-to-end acceptance остаётся у Ops.

## Production acceptance

Ops завершил rollout и независимую приёмку O1–O8: [санитизированный итог](production-acceptance.json).
Работает тот же candidate/source `7ca82d6`, Node 24.22.1. Подтверждены двусторонние доставки,
вложение, отсутствие дубля при повторе подписанного события, ingress/auth и actual confirmation.
За 1820.8 секунды наблюдения: 32 health samples со статусом 200, restart/OOM 0, 16 соседних
сервисов без изменений; current/peak 32.1/53.2 MiB. Перерыв health при выкладке ограничен 4.420 s.
Production rollback не выполнялся; recovery image/Compose/env и guarded procedure проверены Ops.
