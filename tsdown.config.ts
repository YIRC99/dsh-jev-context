/**
 * Builds for both halves of the plugin.
 *
 * The Node half is a plain ESM library: its imports of the harness's own
 * packages stay imports, so the plugin shares the installation's service
 * identity rather than carrying a second copy. The browser half is a bundle
 * for the harness shell, and its artifact contract belongs to the shell, not
 * to this repository: it registers itself through
 * `window.__ModuleLoader__.load({ id, factory })`, takes its shared modules
 * through the injected `require`, and carries its own stylesheet inlined as a
 * tagged `<style>` tag.
 */
import { readFile } from 'node:fs/promises'
import { isBuiltin } from 'node:module'
import { basename, dirname, resolve } from 'node:path'
import { defineConfig } from 'tsdown'
import { transform } from 'lightningcss'

/** Plugin id stamped into the loader handoff and onto injected style tags. */
const ID = '@yirc99/dsh-jev-context'

/**
 * Packages the installation provides: an import of one stays an import in the
 * Node half, so the plugin shares the harness's own service identity instead
 * of carrying a second copy. `schemastery` is a peer for the same reason — a
 * schema's identity is its object.
 */
const HOST_EXTERNALS: readonly string[] = [
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-agent',
  '@deepseek-ai/dsh-compaction',
  '@deepseek-ai/dsh-credentials',
  '@deepseek-ai/dsh-launch-environment',
  '@deepseek-ai/dsh-llm',
  '@deepseek-ai/dsh-session',
  '@deepseek-ai/dsh-session-projection',
  '@deepseek-ai/dsh-settings',
  '@deepseek-ai/dsh-token-meter',
  '@deepseek-ai/schemastery',
  'zod',
]

/** Whether a specifier names one of {@link HOST_EXTERNALS} or a subpath of one. */
function isHostExternal(specifier: string): boolean {
  return HOST_EXTERNALS.some(name => specifier === name || specifier.startsWith(`${name}/`))
}

/**
 * Module specifiers the shell shares into its frozen module table. A name in
 * this list stays an import; everything else is inlined, because a `require()`
 * the table cannot answer is a guaranteed runtime failure.
 */
const PLATFORM_MODULES: readonly string[] = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-dockkit',
]

/** Virtual-id wrapper keeping CSS modules away from tsdown's own CSS pipeline. */
const CSS_VIRTUAL_PREFIX = '\0jev-css:'
const CSS_VIRTUAL_SUFFIX = '.mjs'

/** The Node half: `lib/index.js`, the module a profile row imports. */
const host = {
  name: ID,
  entry: { index: 'src/index.ts' },
  outDir: 'lib',
  format: ['esm'] as const,
  platform: 'node' as const,
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  sourcemap: true,
  clean: false,
  deps: {
    neverBundle: isHostExternal,
    // Builtins keep tsdown's own handling: neither side claims them.
    alwaysBundle: (specifier: string) => !isBuiltin(specifier) && !isHostExternal(specifier),
  },
}

/** The browser half: `lib/client.js`, the artifact the shell fetches. */
const client = {
  name: `${ID}/client`,
  entry: { client: 'src/client/index.ts' },
  outDir: 'lib',
  format: 'cjs' as const,
  platform: 'browser' as const,
  dts: false,
  sourcemap: true,
  clean: false,
  deps: {
    neverBundle: (specifier: string) => PLATFORM_MODULES.includes(specifier),
    alwaysBundle: (specifier: string) => !PLATFORM_MODULES.includes(specifier),
  },
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
    'import.meta.env.MODE': JSON.stringify('production'),
    'import.meta.env': JSON.stringify({ MODE: 'production' }),
  },
  plugins: [{
    name: 'jev-css-modules-inline',
    resolveId(source: string, importer: string | undefined) {
      if (!source.endsWith('.module.css')) return null
      const absolute = importer === undefined ? source : resolve(dirname(importer), source)
      return CSS_VIRTUAL_PREFIX + absolute + CSS_VIRTUAL_SUFFIX
    },
    async load(this: { addWatchFile(file: string): void }, virtualId: string) {
      if (!virtualId.startsWith(CSS_VIRTUAL_PREFIX)) return null
      const file = virtualId.slice(CSS_VIRTUAL_PREFIX.length, -CSS_VIRTUAL_SUFFIX.length)
      this.addWatchFile(file)
      const source = await readFile(file)
      const { code, exports } = transform({
        filename: file,
        code: source,
        cssModules: { pattern: '[hash]_[local]' },
        minify: true,
      })
      const classMap: Record<string, string> = {}
      for (const [local, exported] of Object.entries(exports ?? {}).sort(([left], [right]) => left < right ? -1 : 1)) {
        classMap[local] = exported.name
      }
      const tagId = `${ID}/${basename(file)}`
      return [
        `const css = ${JSON.stringify(code.toString())};`,
        `const tagId = ${JSON.stringify(tagId)};`,
        'if (typeof document !== \'undefined\' && document.querySelector(\'style[data-plugin-css=\' + JSON.stringify(tagId) + \']\') === null) {',
        '  const tag = document.createElement(\'style\');',
        `  tag.dataset.plugin = ${JSON.stringify(ID)};`,
        '  tag.dataset.pluginCss = tagId;',
        '  tag.textContent = css;',
        '  document.head.appendChild(tag);',
        '}',
        `export default ${JSON.stringify(classMap)};`,
      ].join('\n')
    },
  }],
  outputOptions: {
    entryFileNames: 'client.js',
    banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(ID)}, factory: (require) => {`,
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
}

export default defineConfig([host, client])
