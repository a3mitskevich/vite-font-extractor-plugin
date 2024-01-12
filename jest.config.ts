import type { JestConfigWithTsJest } from 'ts-jest'
import { jsWithTsESM } from 'ts-jest/presets'

const jestConfig: JestConfigWithTsJest = {
  ...jsWithTsESM,
  cache: true,
  collectCoverage: true,
  coverageReporters: ['lcovonly'],
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        tsconfig: './tsconfig.test.json',
        useESM: true,
      },
    ],
  },
}

export default jestConfig
