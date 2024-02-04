import { extname } from 'node:path'
import type { OutputAsset } from 'rollup'
import {
  buildByVersion,
  type BuildOptions,
  type ContainerVersion,
  type CssMinify,
  fixtures,
  type FixturesNames,
  fontsLength,
  viteBuild,
} from './utils'

describe('Common', () => {
  const runCommonTest = (version: ContainerVersion, fixturesNames: FixturesNames) => {
    describe(`Common test for vite@${version}`, () => {
      fixturesNames.forEach((fixtureName) => {
        const fixture = fixtures[fixtureName]
        Array.from(['lightningcss', 'esbuild'] as CssMinify[]).forEach(cssMinify => {
          describe(`Build test for "${fixtureName}" fixture with "${cssMinify}" css minificator`, () => {
            const build = async (options?: BuildOptions) => buildByVersion(version, {
              ...options,
              fixture: fixture.path,
              targets: fixture.fonts.map(font => font.name),
            })

            it('should return a bundle with minified fonts', async () => {
              const { output } = await build()
              const fontAssets = output
                .filter((asset): asset is OutputAsset => asset.type === 'asset' && asset.fileName.includes('font-'))
              const cssAssets = output.filter((asset): asset is OutputAsset => asset.type === 'asset' && asset.fileName.endsWith('.css'))

              expect(fontAssets).toHaveLength(fixture.fonts.flatMap(font => font.urls).length)

              fontAssets
                .forEach(asset => {
                  const ext = extname(asset.name).slice(1) as keyof typeof fontsLength
                  expect(asset.source.length).toBeLessThan(fontsLength[ext])
                })
              cssAssets.forEach(asset => {
                expect(asset.source.toString()).not.toContain('.fef')
              })
            })
          })
        })
      })
    })
  }

  const runAllTests = () => {
    Object.keys(viteBuild).forEach(version => {
      runCommonTest(version, ['plain', 'plain-html', 'mixins', 'import-css', 'import-js'])
    })
  }

  runAllTests()
  // runCommonTest(versionV4, ['plain-html']) // for single debug
})
