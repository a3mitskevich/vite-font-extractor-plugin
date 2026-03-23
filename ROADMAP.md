# ROADMAP

Дорожная карта развития `vite-font-extractor-plugin` — v3.0.

> Приоритеты: **P0** — блокирует релиз, **P1** — следующий релиз, **P2** — планируется, **P3** — backlog.

---

## Открытые задачи

### Тестирование

#### CSS Modules (.module.css)
- **Приоритет:** P2
- Vite нативно поддерживает CSS modules — нужно проверить что @font-face внутри .module.css обрабатывается плагином
- **Файлы:** создать `tests/fixtures/css-modules/`, добавить тесты

#### Emoji / non-BMP Unicode в auto mode
- **Приоритет:** P2
- Auto mode использует `GLYPH_REGEX` для поиска `content: "..."` — проверить поддержку emoji (🔤, 🎵) и символов за пределами BMP (U+10000+)
- Зависит от поддержки fontext
- **Файлы:** создать `tests/fixtures/auto-emoji/`, обновить `src/constants.ts` при необходимости

#### Deterministic font hashing
- **Приоритет:** P1
- **Статус:** Открытая проблема
- fontext native encoders (ttf2woff2, ttf2eot) нестабильны — content-based hashing может давать разные результаты между запусками
- Тесты используют `retry: 5` как workaround
- **Нужно:** исследовать deterministic font subsetting или альтернативный подход к хешированию

### Функциональность

#### JS import ?subset= в dev server
- **Приоритет:** P3
- Сейчас `renderChunk` обрабатывает только build mode
- Dev server не перехватывает `import font from './font.woff2?subset=ABC'`
- Нужно: добавить обработку в `configureServer` middleware

---

## Выполнено (v3.0)

### Инфраструктура
- ~~.nvmrc (Node 24)~~
- ~~Jest → Vitest~~
- ~~ESLint → oxlint + oxfmt~~
- ~~Git hooks (pre-commit, commit-msg)~~
- ~~.gitmessage (Conventional Commits)~~
- ~~Changesets (автоматический CHANGELOG)~~
- ~~CI pipeline (lint + test parallel)~~

### Зависимости и совместимость
- ~~Все зависимости обновлены (fontext 1.10, TypeScript 5.9, etc)~~
- ~~lodash → нативные реализации~~
- ~~fast-glob → node:fs~~
- ~~Vite 7 support~~
- ~~Vite 8 (Rolldown) support~~
- ~~Vite 4 deprecated → dropped~~
- ~~@tsconfig/node20 → node22~~

### Архитектура
- ~~Декомпозиция extractor.ts → 6 модулей~~
- ~~PluginContext с explicit dependencies~~
- ~~Content-based font hashing~~
- ~~Rolldown-совместимый asset pipeline~~
- ~~Proxy → explicit getters~~
- ~~null as any → type-safe accessors~~
- ~~Math.random() → deterministic SID~~

### Функциональность
- ~~Font subsetting (?subset= в CSS и JS)~~
- ~~renderChunk для JS import subset~~
- ~~Google Fonts multi-family support~~
- ~~Multiple @font-face с одним именем~~
- ~~Автоочистка кэша при отключении~~
- ~~Graceful degradation при ошибках минификации~~

### Качество
- ~~Type safety: strict в тестах, toError(), getLogger/getResolvers~~
- ~~310 тестов, 13 файлов~~
- ~~Unit тесты regex парсинга (37 тестов)~~
- ~~Dev server тесты~~
- ~~Error path тесты~~
- ~~Plugin options тесты~~
- ~~Hash consistency тесты~~
- ~~Font import patterns тесты (multi-weight, font-display, absolute path, dynamic import, new URL)~~
- ~~Subset тесты (chars, range, combined, JS import, config)~~
- ~~Logger тесты (16 тестов)~~
- ~~Sass @import → @use migration~~

### UX
- ~~Structured logger с progress bars и summary~~
- ~~Playground — полноценное демо-приложение~~
- ~~README с badges, quick start, subsetting, troubleshooting~~
