import type { OutputAsset } from 'rollup'
import { buildByVersion, type BuildOptions, type ContainerVersion, type CssMinify, fixtures, viteBuild } from './utils'

describe('Google', () => {
  const runGoogleFontTest = (version: ContainerVersion) => {
    describe(`Google font test for vite@${version}`, () => {
      Array.from(['lightningcss', 'esbuild'] as CssMinify[]).forEach(cssMinify => {
        describe(`Css minificator is ${cssMinify}`, () => {
          describe('Build test', () => {
            const fixture = fixtures['google-font']
            const build = async (options?: BuildOptions) => buildByVersion(version, {
              ...options,
              fixture: fixture.path,
              targets: fixture.fonts.map(font => font.name),
            })

            it('should return fixed urls', async () => {
              const { output } = await build()
              const targets = output
                .filter((asset): asset is OutputAsset => asset.type === 'asset' &&
                  typeof asset.source === 'string' &&
                  asset.source.includes('fonts.googleapis.com'),
                )
                .map<string>(asset => asset.source.toString())

              expect(targets).toHaveLength(2)
              targets.forEach(content => {
                expect(content).toContain('&text=close+play_arrow')
              })
            })
          })

          describe('Duplication minification logic', () => {
            const fixture = fixtures['google-font-warn']
            const build = async (options?: BuildOptions) => buildByVersion(version, {
              ...options,
              fixture: fixture.path,
              targets: fixture.fonts.map(font => font.name),
            })

            it('should warn message if original url has text option', async () => {
              const { messages, output } = await build()

              const hasWarning = messages.some(({ message, type }) =>
                message.includes('has duplicated logic for minification') && type === 'warn')
              expect(hasWarning).toBeTruthy()

              const targets = output
                .filter((asset): asset is OutputAsset => asset.type === 'asset' &&
                  typeof asset.source === 'string' &&
                  asset.source.includes('fonts.googleapis.com'),
                )
                .map<string>(asset => asset.source.toString())

              expect(targets).toHaveLength(2)
              targets.forEach(content => {
                expect(content).toContain('&text=duplicate+close+play_arrow')
              })
            })
          })
        })
      })
    })
  }

  const runAllTests = () => {
    Object.keys(viteBuild).forEach(version => {
      runGoogleFontTest(version)
    })
  }

  runAllTests()
  // runGoogleFontTest(versionV4)
})
