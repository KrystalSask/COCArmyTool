import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createInterface } from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'

const MIN_NODE_MAJOR = 22
const npmCommand = 'npm'
const npmNeedsShell = process.platform === 'win32'

const actions = {
  desktop: { label: '启动桌面开发版', script: 'desktop:dev', needsRust: true },
  web: { label: '启动网页版', script: 'dev' },
  test: { label: '运行单元与组件测试', script: 'test' },
  e2e: { label: '运行 Edge 端到端测试', script: 'test:e2e' },
  build: { label: '构建网页版', script: 'build' },
  'desktop-build': { label: '构建 Windows 安装包', script: 'desktop:build', needsRust: true },
}

const commandExists = (command, args = ['--version']) => {
  const result = spawnSync(command, args, { encoding: 'utf8', shell: command === npmCommand && npmNeedsShell })
  return result.status === 0 ? (result.stdout || result.stderr).trim() : null
}

const environment = () => ({
  node: process.version,
  npm: commandExists(npmCommand),
  rustc: commandExists('rustc'),
  cargo: commandExists('cargo'),
  dependencies: existsSync('node_modules'),
})

const checkEnvironment = ({ needsRust = false } = {}) => {
  const info = environment()
  const nodeMajor = Number(process.versions.node.split('.')[0])
  const errors = []
  if (nodeMajor < MIN_NODE_MAJOR) errors.push(`需要 Node.js ${MIN_NODE_MAJOR} 或更高版本，当前为 ${info.node}`)
  if (!info.npm) errors.push('未找到 npm')
  if (!info.dependencies) errors.push('尚未安装依赖，请先运行 npm install')
  if (needsRust && (!info.rustc || !info.cargo)) errors.push('桌面版需要 Rust 工具链（rustc 与 cargo）')
  return { info, errors }
}

const printEnvironment = () => {
  const { info, errors } = checkEnvironment()
  console.log('COCArmyTool 环境检查')
  console.log(`- Node.js: ${info.node}`)
  console.log(`- npm: ${info.npm ?? '未找到'}`)
  console.log(`- rustc: ${info.rustc ?? '未找到（仅网页版不需要）'}`)
  console.log(`- cargo: ${info.cargo ?? '未找到（仅网页版不需要）'}`)
  console.log(`- node_modules: ${info.dependencies ? '已安装' : '未安装'}`)
  if (errors.length) {
    console.error('\n需要处理：')
    errors.forEach((message) => console.error(`- ${message}`))
    process.exitCode = 1
  } else {
    console.log('\n基础环境检查通过。')
  }
}

const runAction = (name) => {
  const action = actions[name]
  if (!action) {
    console.error(`未知操作：${name}`)
    printHelp()
    process.exitCode = 1
    return
  }
  const { errors } = checkEnvironment(action)
  if (errors.length) {
    errors.forEach((message) => console.error(`- ${message}`))
    process.exitCode = 1
    return
  }
  console.log(`\n正在${action.label}……\n`)
  const result = spawnSync(npmCommand, ['run', action.script], { stdio: 'inherit', shell: npmNeedsShell })
  if (result.error) throw result.error
  process.exitCode = result.status ?? 1
}

const printHelp = () => {
  console.log(`COCArmyTool 统一入口

用法：
  node scripts/start.mjs [操作]

操作：
  desktop       启动桌面开发版（npm start 的默认操作）
  web           启动网页版
  test          运行单元与组件测试
  e2e           运行 Edge 端到端测试
  build         构建网页版
  desktop-build 构建 Windows 安装包
  check         检查本地开发环境
  help          显示此帮助

不传操作时显示交互菜单。`)
}

const showMenu = async () => {
  const entries = [
    ['1', 'desktop'], ['2', 'web'], ['3', 'test'], ['4', 'e2e'],
    ['5', 'build'], ['6', 'desktop-build'], ['7', 'check'], ['0', 'exit'],
  ]
  console.log('\nCOCArmyTool 统一启动入口\n')
  entries.forEach(([key, name]) => console.log(`${key}. ${name === 'exit' ? '退出' : (actions[name]?.label ?? '检查本地开发环境')}`))
  const readline = createInterface({ input, output })
  const answer = (await readline.question('\n请选择操作：')).trim()
  readline.close()
  const selected = entries.find(([key]) => key === answer)?.[1]
  if (!selected || selected === 'exit') return
  if (selected === 'check') printEnvironment()
  else runAction(selected)
}

const requested = (process.argv[2] ?? '').toLowerCase()
if (!requested) await showMenu()
else if (requested === 'check') printEnvironment()
else if (requested === 'help' || requested === '--help' || requested === '-h') printHelp()
else runAction(requested)
