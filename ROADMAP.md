# ROADMAP

Дорожная карта развития `vite-font-extractor-plugin`.

> Приоритеты: **P0** — блокирует релиз, **P1** — следующий релиз, **P2** — планируется, **P3** — backlog.

---

## Фаза 0 — Инфраструктура и DX

Цель: привести в порядок tooling, CI и developer experience до начала работы над функциональностью.

### 0.1 Добавить `.nvmrc`
- **Приоритет:** P0
- Зафиксировать версию Node.js (22 LTS) для всех контрибьюторов
- CI должен использовать `.nvmrc` как source of truth

### 0.2 Переход с Jest на Vitest
- **Приоритет:** P0
- Удалить `jest`, `ts-jest`, `@types/jest`
- Настроить `vitest` с поддержкой TypeScript из коробки (не нужен `ts-jest`)
- Убрать `NODE_OPTIONS="--experimental-vm-modules"` — Vitest нативно поддерживает ESM
- Переписать `jest.config.ts` → `vitest.config.ts`
- Обновить `tsconfig.test.json` — убрать `"types": ["jest"]`
- Адаптировать тесты: API совместим, но проверить `describe`/`it`/`expect` импорты

### 0.3 Переход с ESLint на oxlint + oxfmt (Oxc toolchain)
- **Приоритет:** P1
- Удалить `eslint`, `@typescript-eslint/eslint-plugin`, `eslint-config-standard-with-typescript`, `.eslintrc.json`, `.eslintcache`, `.eslintignore`
- Установить `oxlint` — линтинг (замена ESLint)
- Установить `oxfmt` — форматирование (замена Prettier, которого и не было)
- Создать `oxlint.json` с правилами, эквивалентными текущему конфигу
- Обновить npm-скрипты: `"lint": "oxlint"`, `"fmt": "oxfmt"`, `"fmt:check": "oxfmt --check"`

### 0.4 Git-хуки (pre-commit, commit-msg)
- **Приоритет:** P1
- Установить `simple-git-hooks` (или `lefthook`) — легковесная альтернатива husky
- Pre-commit hook: `oxlint && oxfmt --check`
- Commit-msg hook: валидация по Conventional Commits (`feat:`, `fix:`, `chore:` и т.д.)
- Добавить `lint-staged` для проверки только staged-файлов

### 0.5 `.gitmessage` — шаблон коммитов
- **Приоритет:** P1
- Создать `.gitmessage` с шаблоном Conventional Commits
- Документировать настройку: `git config commit.template .gitmessage`

### 0.6 Автоматический CHANGELOG
- **Приоритет:** P1
- Внедрить `changesets` (`@changesets/cli`) — каждый PR содержит changeset-файл, описывающий изменение
- При релизе `changeset version` автоматически обновляет `CHANGELOG.md` и бампит версию
- Альтернатива: `release-it` + `@release-it/conventional-changelog` если нужен более простой flow
- Удалить ручные npm-скрипты `versioning:*`
- Добавить GitHub Action для автоматического релиза

### 0.7 Обновить CI pipeline
- **Приоритет:** P1
- Добавить шаг `lint` (`oxlint`) в CI
- Добавить шаг `fmt:check` (`oxfmt --check`) в CI
- Обновить матрицу Node.js: `[20.x, 22.x, 24.x]` (убрать 18.x — EOL)
- Добавить job для `npm run build` + проверка, что `dist/` собирается без ошибок
- Добавить caching для `node_modules`

---

## Фаза 1 — Обновление зависимостей и совместимость

Цель: поддержать актуальные версии экосистемы.

### 1.1 Обновить все зависимости
- **Приоритет:** P0
- **dependencies:**
  - `fontext` 1.2.0 → 1.9.1 (мажорное обновление API — проверить breaking changes)
  - `picocolors` 1.1.1 → актуальная (минорное)
  - Оценить удаление `lodash.camelcase` и `lodash.groupby` — заменить нативными реализациями (3-5 строк каждая), убрать 2 зависимости из production bundle
- **devDependencies:**
  - `typescript` 5.9.2 → latest stable
  - `tsup` 8.3.6 → 8.5.x
  - `@tsconfig/node20` → `@tsconfig/node22`
  - `lightningcss` 1.29.1 → 1.32.x
  - `sass` 1.89.2 → 1.98.x
  - `@types/node` 24.2.0 → latest
  - Удалить `@types/jest`, `ts-jest`, `ts-node` после перехода на Vitest
  - Удалить `@types/lodash.camelcase`, `@types/lodash.groupby` после нативизации

### 1.2 Добавить поддержку Vite 7
- **Приоритет:** P0
- Добавить `vite-7` в devDependencies (`https://registry.npmjs.org/vite/-/vite-7.3.1.tgz`)
- Обновить `peerDependencies`: `"vite": "^4 || ^5 || ^6 || ^7"`
- Добавить импорт `vite-7` в `tests/utils.ts` по аналогии с остальными версиями
- Проверить совместимость API: `isCSSRequest`, `send`, `createLogger`, `createResolver`
- Прогнать полный тестовый набор

### 1.3 Добавить поддержку Vite 8
- **Приоритет:** P1
- Добавить `vite-8` в devDependencies (`https://registry.npmjs.org/vite/-/vite-8.0.1.tgz`)
- Обновить `peerDependencies`: `"vite": "^4 || ^5 || ^6 || ^7 || ^8"`
- Vite 8 использует Rolldown вместо Rollup — проверить:
  - Совместимость типов `OutputAsset`, `TransformPluginContext`
  - Поведение `this.emitFile` и `this.getFileName`
  - Работу `generateBundle` hook с Rolldown output
- Прогнать полный тестовый набор

### 1.4 Оценить удаление поддержки Vite 4
- **Приоритет:** P2
- Vite 4 — EOL, последний релиз 4.5.1 (2023)
- Удаление упростит тесты и снимет ограничения по API
- Решение: объявить deprecated в 3.x, удалить в 4.0

---

## Фаза 2 — Архитектурный рефакторинг

Цель: решить основной технический долг перед добавлением новой функциональности.

### 2.1 Декомпозиция `extractor.ts`
- **Приоритет:** P1
- Разделить на модули:
  - `src/transform.ts` — логика `transform` хука (CSS-парсинг, asset emission)
  - `src/serve.ts` — dev-server middleware и font proxying
  - `src/bundle.ts` — логика `generateBundle` (минификация, замена стабов)
  - `src/google-fonts.ts` — обработка Google Font URL
  - `src/extractor.ts` — остаётся как фасад, собирающий Plugin из модулей
- Вынести замыкания (`glyphsFindMap`, `transformMap`, `fontServeProxy`, `progress`) в отдельное хранилище состояния

### 2.2 Исправить `Math.random()` в auto-режиме
- **Приоритет:** P0
- Строка `extractor.ts:333`: `sid: Math.random().toString()` → детерминированный хеш
- К моменту `generateBundle` все CSS обработаны, `glyphsFindMap` заполнена — SID можно вычислить как хеш от собранных глифов
- Это устранит нестабильные имена файлов при каждой сборке

### 2.3 Заменить Proxy на явные абстракции
- **Приоритет:** P2
- `autoTarget` (Proxy с throw при чтении fontName) → класс `AutoTarget` с методом `getRaws()`
- `autoProxyOption` (Proxy с lazy SID) → getter-метод
- `optionsMap` (кастомный satisfies) → обычный класс с `get`/`has`
- `styler.ts` (Proxy к picocolors) — оставить, это единственное место где Proxy оправдан

### 2.4 Улучшить обработку ошибок
- **Приоритет:** P1
- `generateBundle` catch-блок: пробрасывать ошибку вместо тихого логирования (битый output хуже сломанной сборки)
- `configureServer` middleware: обернуть async-блок в try/catch, вызывать `next(error)`
- Добавить дедупликацию одновременных запросов к одному шрифту в dev-server

### 2.5 Исправить опечатки
- **Приоритет:** P2
- `src/internal-loger.ts` → `src/internal-logger.ts`
- `'Clean up generated bundle is filed'` → `'Clean up generated bundle has failed'`

---

## Фаза 3 — Улучшение парсинга CSS

Цель: сделать обработку CSS надёжнее.

### 3.1 Добавить unit-тесты для regex-парсинга
- **Приоритет:** P1
- Покрыть тестами `extractFontFaces`, `extractFontName`, `extractFonts`, `findUnicodeGlyphs`, `extractGoogleFontsUrls`
- Кейсы: комментарии в CSS, многострочные значения, экранированные кавычки, нестандартные пробелы
- Это предохранитель перед рефакторингом регулярок

### 3.2 Предварительная очистка CSS от комментариев
- **Приоритет:** P2
- Перед regex-парсингом удалять `/* ... */` блоки — это устранит ложные срабатывания
- Простая реализация: `/\/\*[\s\S]*?\*\//g`

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
