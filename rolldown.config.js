import { defineConfig } from 'rolldown'
import pkg from './package.json' with { type: 'json' }
import { dts } from 'rolldown-plugin-dts'

const dependencies = [
  ...Object.keys(pkg.dependencies ?? {}),
  ...Object.keys(pkg.peerDependencies ?? {}),
  ...Object.keys(pkg.devDependencies ?? {})
]
const external = new RegExp(`^(node:|${dependencies.join('|')})`)
const input = './src/index.ts'

export default defineConfig([
  {
    input,
    output: [{ file: 'lib/index.js', format: 'es' }],
    external
  },
  {
    input: './src/client.tsx',
    output: [{ file: 'lib/client.js', format: 'es' }],
    external
  },
  {
    input,
    output: [{ dir: 'lib', format: 'es' }],
    plugins: [dts({ emitDtsOnly: true })],
    external
  }
])
