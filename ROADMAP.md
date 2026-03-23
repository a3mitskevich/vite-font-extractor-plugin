# ROADMAP

Дорожная карта развития `vite-font-extractor-plugin` — v3.0.

> Приоритеты: **P0** — блокирует релиз, **P1** — следующий релиз, **P2** — планируется, **P3** — backlog.

---

## Фаза 1 — Типобезопасность и качество кода

Цель: устранить `as any`, мёртвый код и type safety проблемы, выявленные аудитом.

### 1.1 Исправить `null as any` в PluginContext
- **Приоритет:** P0
- `context.ts:94-96` — `cache`, `importResolvers`, `logger` инициализируются как `null as any`
- Проблема: TypeScript не предупредит при обращении до `configResolved`
- **Решение:** объявить типы как `Cache | null`, `ImportResolvers | null`, `InternalLogger | null` в интерфейсе. Добавить null-checks или assertion-helper `getLogger(): InternalLogger` с понятной ошибкой
- **Файлы:** `src/context.ts`, `src/types.ts`, все потребители ctx.logger/ctx.cache/ctx.importResolvers

### 1.2 Удалить мёртвый код
- **Приоритет:** P1
- `ResourceTransformMeta` в `types.ts` — не используется после удаления `changeResource`
- Закомментированный `sid: mode === "auto" ? Math.random()...` в `transform.ts` — удалить вместе с TODO-комментарием
- `ServeFontStubResponse` — перенести из `context.ts` в `types.ts` (convention проекта)
- **Файлы:** `src/types.ts`, `src/context.ts`, `src/transform.ts`

### 1.3 Улучшить type safety в catch-блоках
- **Приоритет:** P2
- `as Error` cast в `transform.ts:131`, `bundle.ts:119` — предполагает что ошибка всегда Error
- **Решение:** использовать `error instanceof Error ? error : new Error(String(error))`
- **Файлы:** `src/transform.ts`, `src/bundle.ts`, `src/extractor.ts`

### 1.4 Включить `strict: true` в тестах
- **Приоритет:** P2
- `tsconfig.test.json` — `strict: false` снижает надёжность тестов
- Включить strict, исправить возникшие ошибки типизации
- **Файлы:** `tsconfig.test.json`, все файлы в `tests/`

---

## Фаза 2 — Покрытие тестами

Цель: покрыть непротестированные пути — dev-server, error paths, опции плагина.

### 2.1 Тесты dev-сервера
- **Приоритет:** P0
- ~130 строк кода без тестов: `configureServer` middleware, `processServeFontMinify`, `processServeAutoFontMinify`, in-flight deduplication
- Использовать `createServer()` из Vite для запуска dev-сервера в тесте, сделать HTTP-запросы к font URL, проверить что ответ минифицирован
- Проверить что in-flight deduplication не создаёт двойных минификаций
- **Файлы:** создать `tests/serve.spec.ts`

### 2.2 Тесты error paths
- **Приоритет:** P1
- Что происходит при: невалидном font file, отсутствующем файле, timeout fontext, сломанном CSS
- `generateBundle` при ошибке fontext — должен пропустить шрифт и сохранить оригинал, а не ронять сборку
- Тесты для Google Font URL с невалидным форматом
- **Файлы:** создать `tests/errors.spec.ts`

### 2.3 Тесты опций плагина
- **Приоритет:** P1
- `ignore: ['Font Name']` — проверить что шрифт не обрабатывается
- `cache: './custom-path'` — проверить что кэш создаётся по указанному пути
- `cache: false` → `Cache.removeIfExists()` — проверить удаление стейла
- `withWhitespace: true` — проверить что whitespace glyphs включены
- `apply: 'serve' | 'build'` — проверить что плагин применяется только в указанном режиме
- **Файлы:** создать `tests/options.spec.ts`

### 2.4 Устранить flaky тесты
- **Приоритет:** P1
- `retry: 2` в vitest.config.ts маскирует проблему woff2 недетерминированности
- Исследовать: fontext/woff2 encoder даёт разные binary при параллельном выполнении?
- Если проблема в параллелизме — запускать hash тесты с `pool: 'forks'` или `--no-file-parallelism`
- Убрать глобальный `retry: 2` после решения
- **Файлы:** `vitest.config.ts`, `tests/hash.spec.ts`

---

## Фаза 3 — Оптимизация

Цель: убрать неэффективности в runtime и уменьшить зависимости.

### 3.1 Убрать зависимость `fast-glob`
- **Приоритет:** P1
- Используется только в `cache.ts:clearCache()` для одного `glob.sync()` вызова
- Заменить на `node:fs.readdirSync()` + `node:path.join()` — убрать production-зависимость
- **Файлы:** `src/cache.ts`, `package.json`

### 3.2 Оптимизировать `stripCssComments`
- **Приоритет:** P2
- Сейчас вызывается 3 раза на один CSS-файл (`extractFontFaces`, `extractGoogleFontsUrls`, `findUnicodeGlyphs`)
- Вызвать один раз в `transformHook` и передать очищенный код в функции
- **Файлы:** `src/transform.ts`, `src/utils.ts`

### 3.3 Оптимизировать поиск ассетов в bundle
- **Приоритет:** P2
- `bundle.ts:28` — `Object.values(bundle).find()` для каждого referenceId (O(n*m))
- Построить `Map<fileName, OutputAsset>` один раз перед циклом
- **Файлы:** `src/bundle.ts`

### 3.4 Мемоизация `autoTarget.raws`
- **Приоритет:** P3
- `context.ts` — `Array.from(glyphsFindMap.values()).flat()` при каждом обращении к `raws`
- При 100 CSS-файлах — flat() каждый раз без кэширования
- Добавить invalidation flag: пересчитывать только если `glyphsFindMap` изменился
- **Файлы:** `src/context.ts`

---

## Фаза 4 — Graceful degradation

Цель: плагин не должен ронять сборку при проблемах с отдельным шрифтом.

### 4.1 Безопасная обработка ошибок минификации
- **Приоритет:** P1
- Сейчас: если `fontext.extract()` падает → весь `generateBundle` падает через `throw`
- Нужно: пропустить проблемный шрифт, сохранить оригинал, выдать warning
- **Файлы:** `src/bundle.ts`

### 4.2 Защита от невалидного CSS
- **Приоритет:** P2
- `FONT_FACE_BLOCK_REGEX` — `([\s\S]*?)}` сломается при `}` внутри `url("data:...{...}")`
- `extractFontName` захватывает trailing whitespace — добавить `.trim()`
- `GLYPH_REGEX` может давать false positives на `content: ""` (пустая строка)
- **Файлы:** `src/constants.ts`, `src/utils.ts`

---

## Фаза 5 — Подготовка к релизу v3.0

Цель: финализировать изменения для мажорного релиза.

### 5.1 Удалить Vite 4 из peerDependencies
- **Приоритет:** P1
- Vite 4 уже deprecated, не тестируется
- Убрать `^4` из peerDependencies в мажорном релизе
- Обновить README — удалить строку Vite 4
- **Файлы:** `package.json`, `README.md`

### 5.2 Обновить CHANGELOG через changeset
- **Приоритет:** P0
- Создать changeset, описывающий все изменения v3.0
- `npx changeset version` → обновит CHANGELOG.md и бампнет версию
- **Файлы:** `.changeset/`, `CHANGELOG.md`, `package.json`

### 5.3 Обновить README
- **Приоритет:** P1
- Добавить в Troubleshooting: Vite 8 / Rolldown специфику
- Обновить таблицу совместимости (убрать Vite 4)
- Добавить секцию Migration Guide (v2 → v3)
- **Файлы:** `README.md`

---

## Порядок выполнения

```
Фаза 1 (type safety)      ██████░░░░░░░░░░░░░░  v3.0.0-alpha
Фаза 2 (тесты)            ░░░░░██████░░░░░░░░░  v3.0.0-beta
Фаза 3 (оптимизация)      ░░░░░░░░░░░████░░░░░  v3.0.0-beta
Фаза 4 (degradation)      ░░░░░░░░░░░░░░░███░░  v3.0.0-rc
Фаза 5 (релиз)            ░░░░░░░░░░░░░░░░░░██  v3.0.0
```
