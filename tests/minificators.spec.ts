import { buildByVersion, type BuildOptions, type ContainerVersion, type CssMinify, fixtures, viteBuild } from './utils'

describe('Minificators', () => {
  const runMinificatorsTest = (version: ContainerVersion) => {
    describe(`Google font test for vite@${version}`, () => {
      Array.from(['lightningcss', 'esbuild'] as CssMinify[]).forEach(cssMinify => {
        describe(`Css minificator is ${cssMinify}`, () => {
          describe('Has an url in sources', () => {
            const fixture = fixtures['font-family-resource-is-url']

            const build = async (options?: BuildOptions) => buildByVersion(version, {
              ...options,
              fixture: fixture.path,
              targets: fixture.fonts.map(font => font.name),
            })

            it('should log warn about expected font has an url source', async () => {
              const { messages } = await build()

              const hasError = messages.some(({ message, type }) =>
                message.includes('has external url sources:') && type === 'warn')
              expect(hasError).toBeTruthy()
            })
          })
        })
      })
    })
  }

  const runAllTests = () => {
    Object.keys(viteBuild).forEach(runMinificatorsTest)
  }

  runAllTests()
  // runMinificatorsTest(versionV4) // for single debug
})
