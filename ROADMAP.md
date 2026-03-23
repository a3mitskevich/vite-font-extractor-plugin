# ROADMAP

Дорожная карта развития `vite-font-extractor-plugin`.

> Приоритеты: **P0** — блокирует релиз, **P1** — следующий релиз, **P2** — планируется, **P3** — backlog.

---

## Фаза 0 — Инфраструктура и DX

Цель: привести в порядок tooling, CI и developer experience до начала работы над функциональностью.

### ~~0.1 Добавить `.nvmrc`~~ DONE
- **Приоритет:** P0
- ~~Зафиксировать версию Node.js (22 LTS) для всех контрибьюторов~~ → зафиксировано Node 24
- ~~CI должен использовать `.nvmrc` как source of truth~~ → CI обновлен на [20.x, 22.x, 24.x]

### ~~0.2 Переход с Jest на Vitest~~ DONE
- **Приоритет:** P0
- ~~Удалить `jest`, `ts-jest`, `@types/jest`~~ + удалён `ts-node`
- ~~Настроить `vitest` с поддержкой TypeScript из коробки~~
- ~~Убрать `NODE_OPTIONS="--experimental-vm-modules"`~~
- ~~Переписать `jest.config.ts` → `vitest.config.ts`~~
- ~~Обновить `tsconfig.test.json` — убрать `"types": ["jest"]`~~
- ~~Адаптировать тесты~~ — добавлены явные импорты из `vitest` во все 5 файлов

### ~~0.3 Переход с ESLint на oxlint + oxfmt (Oxc toolchain)~~ DONE
- **Приоритет:** P1
- ~~Удалить `eslint`, `@typescript-eslint/eslint-plugin`, `eslint-config-standard-with-typescript`, `.eslintrc.json`, `.eslintcache`, `.eslintignore`~~
- ~~Установить `oxlint` — линтинг (замена ESLint)~~
- ~~Установить `oxfmt` — форматирование~~
- ~~Создать `oxlintrc.json`~~ — с TypeScript, import, promise правилами + категория correctness
- ~~Обновить npm-скрипты~~
- Дополнительно: `fast-glob` перенесён в прямые зависимости

### ~~0.4 Git-хуки (pre-commit, commit-msg)~~ DONE
- **Приоритет:** P1
- ~~Установить `simple-git-hooks`~~ + `lint-staged`
- ~~Pre-commit hook~~ → `npx lint-staged` (oxlint + oxfmt --check на staged .ts)
- ~~Commit-msg hook~~ → `scripts/verify-commit-msg.mjs` (Conventional Commits)
- Весь кодбейз отформатирован oxfmt

### ~~0.5 `.gitmessage` — шаблон коммитов~~ DONE
- **Приоритет:** P1
- ~~Создать `.gitmessage` с шаблоном Conventional Commits~~
- Настройка: `git config commit.template .gitmessage`

### ~~0.6 Автоматический CHANGELOG~~ DONE
- **Приоритет:** P1
- ~~Внедрить `changesets` (`@changesets/cli`)~~
- ~~Удалить ручные npm-скрипты `versioning:*`~~
- Скрипты: `changeset`, `version`, `release`
- GitHub Action для автоматического релиза — отложено на отдельный PR

### ~~0.7 Обновить CI pipeline~~ DONE
- **Приоритет:** P1
- ~~Добавить шаг `lint` (`oxlint`) в CI~~
- ~~Добавить шаг `fmt:check` (`oxfmt --check`) в CI~~
- ~~Обновить матрицу Node.js~~ (сделано в 0.1)
- Lint и test — параллельные job'ы, lint использует `.nvmrc`

---

## Фаза 1 — Обновление зависимостей и совместимость

Цель: поддержать актуальные версии экосистемы.

### ~~1.1 Обновить все зависимости~~ DONE
- **Приоритет:** P0
- ~~`fontext` 1.2.0 → 1.10.0~~ (адаптированы типы Target, ExtractedResult)
- ~~Заменить `lodash.camelcase` и `lodash.groupby` нативными реализациями~~
- ~~`typescript`, `tsup`, `lightningcss`, `sass`, `@types/node` → latest~~
- ~~`@tsconfig/node20` → `@tsconfig/node22`~~
- ~~Удалить `@types/jest`, `ts-jest`, `ts-node`~~ (сделано в 0.2)
- ~~Удалить `@types/lodash.*`~~

### ~~1.2 Добавить поддержку Vite 7~~ DONE
- **Приоритет:** P0
- ~~Добавить `vite-7` (7.3.1) в devDependencies~~
- ~~Обновить `peerDependencies`: `"vite": "^4 || ^5 || ^6 || ^7"`~~
- ~~Добавить в тесты~~ — 152 теста (114 + 38 новых для Vite 7)

### ~~1.3 Добавить поддержку Vite 8~~ PARTIAL
- **Приоритет:** P1
- ~~Добавить `vite-8` (8.0.1) в devDependencies~~
- ~~Обновить `peerDependencies`: `"vite": "^4 || ^5 || ^6 || ^7 || ^8"`~~
- **Статус: Experimental.** Vite 8 (Rolldown) иначе обрабатывает asset pipeline:
  - `OutputAsset.name` может быть `undefined`
  - `.fef` стабы не заменяются в `generateBundle` — Rolldown по-другому маппит emitFile/getFileName
  - Тесты для Vite 8 отключены до адаптации плагина (→ Фаза 2, блок 2.1)

### 1.4 Оценить удаление поддержки Vite 4
- **Приоритет:** P2
- Vite 4 — EOL, последний релиз 4.5.1 (2023)
- Удаление упростит тесты и снимет ограничения по API
- Решение: объявить deprecated в 3.x, удалить в 4.0

---

## Фаза 2 — Архитектурный рефакторинг

Цель: решить основной технический долг, обеспечить полную поддержку Vite 8 (Rolldown).

### 2.1 Адаптация для Rolldown (Vite 8)
- **Приоритет:** P0
- **Статус: исследовано, ожидает решения**
- **Корневая проблема:** не в `generateBundle`, а в `transform` → `changeResource`:
  - Плагин заменяет `__VITE_ASSET__<oldRefId>__` на `__VITE_ASSET__<newRefId>__` в CSS
  - В Rollup Vite резолвит оба формата placeholder'ов и включает emitted assets в output
  - В Rolldown emitted `.fef` stub reference ID **не распознаётся** внутри `__VITE_ASSET__` placeholder — Rolldown его дропает, шрифтовые ассеты пропадают из бандла полностью
- **Что сделано:**
  - `generateBundle` адаптирован: delete + re-add вместо мутации Rust-объектов, `name!` → `name ?? fileName`
  - Исследован asset pipeline Rolldown: `emitFile` работает, `getFileName` работает, но reference ID не подставляются в `__VITE_ASSET__` placeholders
- **Что нужно для полного решения:**
  - Рефакторинг `changeResource` — не заменять reference ID в `__VITE_ASSET__`, а использовать другой механизм привязки stub к оригинальному шрифту
  - Возможный подход: в `transform` сохранять маппинг `originalFileName → stubData`, а в `generateBundle` находить оригинальные ассеты по fileName и заменять их напрямую, без промежуточных `.fef` стабов
  - Это потребует полного рефакторинга asset pipeline (блок 2.2)
- **Файлы:** `src/extractor.ts` (changeResource, generateBundle)

### 2.2 Декомпозиция `extractor.ts`
- **Приоритет:** P1
- Разделить на модули:
  - `src/transform.ts` — логика `transform` хука (CSS-парсинг, asset emission)
  - `src/serve.ts` — dev-server middleware и font proxying
  - `src/bundle.ts` — логика `generateBundle` (минификация, замена стабов)
  - `src/google-fonts.ts` — обработка Google Font URL
  - `src/extractor.ts` — остаётся как фасад, собирающий Plugin из модулей
- Вынести замыкания (`glyphsFindMap`, `transformMap`, `fontServeProxy`, `progress`) в отдельное хранилище состояния
- Декомпозиция облегчит адаптацию под Rolldown — логика `generateBundle` изолирована и тестируема

### ~~2.3 Исправить `Math.random()` в auto-режиме~~ DONE
- ~~`Math.random().toString()` → `font.options.sid`~~ (детерминированный хеш из собранных глифов)
- Старый вызов оставлен закомментированным с `TODO: recheck it`

### 2.4 Заменить Proxy на явные абстракции
- **Приоритет:** P2
- `autoTarget` (Proxy с throw при чтении fontName) → класс `AutoTarget` с методом `getRaws()`
- `autoProxyOption` (Proxy с lazy SID) → getter-метод
- `optionsMap` (кастомный satisfies) → обычный класс с `get`/`has`
- `styler.ts` (Proxy к picocolors) — оставить, это единственное место где Proxy оправдан

### ~~2.5 Улучшить обработку ошибок~~ DONE
- ~~`generateBundle` catch-блок: пробрасывать ошибку~~ → `throw error` после логирования
- ~~`configureServer` middleware~~ → `.then().catch()` с `next(error)`
- ~~Дедупликация одновременных запросов~~ → `inFlightRequests` Map

### ~~2.6 Исправить опечатки~~ DONE
- ~~`src/internal-loger.ts` → `src/internal-logger.ts`~~
- ~~`'Clean up generated bundle is filed'` → `'Clean up generated bundle has failed'`~~
- ~~Удалить устаревшие `eslint-disable` комментарии~~

---

## Фаза 3 — Улучшение парсинга CSS

Цель: сделать обработку CSS надёжнее.

### ~~3.1 Добавить unit-тесты для regex-парсинга~~ DONE
- 30 unit-тестов в `tests/utils.spec.ts`
- Покрыты: `extractFontFaces`, `extractFontName`, `extractFonts`, `findUnicodeGlyphs`, `extractGoogleFontsUrls`, `camelCase`, `groupBy`
- Найден потенциальный баг: `extractFontName` захватывает trailing whitespace

### ~~3.2 Предварительная очистка CSS от комментариев~~ DONE
- ~~Перед regex-парсингом удалять `/* ... */` блоки~~
- `stripCssComments()` применена в `extractFontFaces`, `extractGoogleFontsUrls`, `findUnicodeGlyphs`

### 3.3 Оценить переход на PostCSS парсер
- **Приоритет:** P3
- PostCSS уже есть в зависимостях Vite — не добавит веса
- Заменить regex-парсинг `@font-face` и `content:` на AST-обход
- Значительно повысит надёжность, но увеличит сложность кода
- Решение принять после анализа реальных багов от пользователей

---

## Фаза 4 — Документация и Playground

### 4.1 Переписать README.md
- **Приоритет:** P1
- Новая структура: hero-секция с визуальным примером экономии размера, quick start, badges (npm, CI, license)
- Добавить сравнительную таблицу "до/после" по размерам шрифтов
- Добавить секцию Troubleshooting с типовыми проблемами

### 4.2 Обновить или удалить Playground
- **Приоритет:** P2
- Текущий playground сломан (ссылка на несуществующий .tgz, Vue 2 + Vuetify 2)
- Варианты:
  - Обновить до Vue 3 + Vuetify 3 + актуальный Vite
  - Заменить на минимальный vanilla-пример без фреймворка
- Добавить `.font-extractor-cache/` в `.gitignore`
- Связать playground с локальным пакетом через `"file:../"` вместо .tgz

### 4.3 Добавить `package-lock.json` в репозиторий
- **Приоритет:** P1
- Сейчас `package-lock.json` отсутствует, хотя CI использует `npm ci` (который требует lock-файл)
- Обеспечит детерминированные установки

---

## Фаза 5 — Новая функциональность

### 5.1 Поддержка нескольких `@font-face` с одним именем
- **Приоритет:** P2
- Сейчас дублирование `fontName` вызывает throw (`checkFontProcessing`)
- Реальный кейс: один шрифт в разных файлах (400, 700 weight) — разные файлы, одно имя
- Нужно группировать по `font-weight` / `unicode-range`

### 5.2 Поддержка Google Fonts с несколькими семействами
- **Приоритет:** P3
- `TODO` в коде: `'Google font url includes multiple families. Not supported'`
- URL вида `?family=Material+Icons|Roboto` — нужно парсить `|`-разделитель

### 5.3 Автоочистка кэша при отключении
- **Приоритет:** P3
- `TODO` в `cache.ts`: удалять `.font-extractor-cache/` когда `cache` опция меняется на `false`

---

## Порядок выполнения

```
Фаза 0 (infra)         ███████████░░░░░░░░░░░░░░  v3.0.0-alpha
Фаза 1 (deps + vite)   ░░░░░░░████████░░░░░░░░░░  v3.0.0-beta
Фаза 2 (refactor)      ░░░░░░░░░░░░░░██████░░░░░  v3.0.0
Фаза 3 (CSS parsing)   ░░░░░░░░░░░░░░░░░░░████░░  v3.1.0
Фаза 4 (docs)          ░░░░░░░░░░░░░░░░░░░░░░███  v3.1.0
Фаза 5 (features)      ░░░░░░░░░░░░░░░░░░░░░░░░░  v3.2.0+
```
