import { readFileSync } from 'node:fs'

const msgPath = process.argv[2]
const msg = readFileSync(msgPath, 'utf-8').trim()

const pattern = /^(feat|fix|chore|docs|style|refactor|perf|test|ci|build|revert)(\(.+\))?!?:\s.+/

if (!pattern.test(msg)) {
  console.error(
    '\x1b[31mInvalid commit message format.\x1b[0m\n\n' +
    'Commit messages must follow Conventional Commits:\n' +
    '  <type>(<scope>): <description>\n\n' +
    'Types: feat, fix, chore, docs, style, refactor, perf, test, ci, build, revert\n\n' +
    'Examples:\n' +
    '  feat: add vite 7 support\n' +
    '  fix(cache): resolve hash collision\n' +
    '  chore(deps): update fontext to 1.9\n'
  )
  process.exit(1)
}
