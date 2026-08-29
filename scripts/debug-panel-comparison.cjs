// 临时调试脚本：对比不同面板框下的英雄装备识别结果。
// 用页面内的识别模块直接跑 inspectScreenshotFile + analyzeCardLayout，
// 分别使用自动定位的面板与手工推算的“真实面板”。
// 仅本地排查用，不入 CI。
const { chromium } = require('@playwright/test')

const run = async () => {
  const browser = await chromium.launch({ executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe' })
  const context = await browser.newContext({ ignoreHTTPSErrors: true })
  const page = await context.newPage()
  await page.goto('https://localhost:5173/')

  const result = await page.evaluate(async () => {
    const blob = await (await fetch('/feedback-test.jpg')).blob()
    const file = new File([blob], 'feedback-test.jpg', { type: 'image/jpeg' })
    const { inspectScreenshotFile } = await import('/src/recognition/preflight.ts')
    const { analyzeCardLayout } = await import('/src/recognition/cardAnalysis.ts')

    // 依据原生截图的面板比例与黑边实测推算的“真实面板”（全图归一化坐标）。
    const TRUE_PANEL = { x: 0.1739, y: 0.0837, width: 0.6514, height: 0.8375 }

    const summarize = async (panelOverride) => {
      const preflight = await inspectScreenshotFile(file, panelOverride)
      const analysis = await analyzeCardLayout(file, preflight)
      return {
        panel: `${preflight.panel.x.toFixed(4)},${preflight.panel.y.toFixed(4)},${preflight.panel.width.toFixed(4)},${preflight.panel.height.toFixed(4)}`,
        complete: preflight.complete,
        heroes: analysis.heroes.map((hero) => ({
          heroId: hero.heroId,
          equipment: hero.equipment.map((item) => item.candidates.slice(0, 3).map((candidate) => `${candidate.id}:${candidate.score.toFixed(3)}`).join('|')),
          pet: hero.pet.candidates.slice(0, 3).map((candidate) => `${candidate.id}:${candidate.score.toFixed(3)}`).join('|'),
        })),
      }
    }

    return {
      auto: await summarize(undefined),
      manualTruePanel: await summarize(TRUE_PANEL),
    }
  })
  console.log(JSON.stringify(result, null, 2))
  await browser.close()
}

run().catch((error) => { console.error(error); process.exit(1) })
