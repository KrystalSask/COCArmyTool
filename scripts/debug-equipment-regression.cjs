// 临时调试脚本：对指定截图跑完整识别流程，导出各阶段页面状态与诊断属性。
// 用法：node scripts/debug-equipment-regression.cjs <图片路径>
// 仅本地排查用，不入 CI。
const { chromium } = require('@playwright/test')

const image = process.argv[2] ?? 'recognition-samples/equipment-regression/revenge-deck-panel.png'

const run = async () => {
  const browser = await chromium.launch({ executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe' })
  const context = await browser.newContext({ ignoreHTTPSErrors: true })
  const page = await context.newPage()
  page.on('pageerror', (error) => console.log('[pageerror]', error.message))

  await page.goto('https://localhost:5173/')
  await page.getByRole('button', { name: '截图识别' }).click()
  await page.locator('input[type="file"]').setInputFiles(image)

  for (let step = 0; step < 24; step += 1) {
    await page.waitForTimeout(5000)
    const state = await page.evaluate(() => {
      const messages = [...document.querySelectorAll('.status-message')].map((node) => node.textContent?.trim())
      const heroSummary = document.querySelector('[data-testid="hero-visual-analysis"]')
      const panelLocation = document.querySelector('[data-testid="panel-location"]')
      const viewportStatus = [...document.querySelectorAll('.preflight-grid span')].map((node) => node.textContent?.trim()).filter((text) => text?.includes('游戏画面') || text?.includes('面板定位'))
      const regionSummary = [...document.querySelectorAll('[data-testid^="card-count-"]')].map((node) => ({
        region: node.getAttribute('data-testid'),
        counts: node.getAttribute('data-counts'),
        top1: node.getAttribute('data-top1'),
        top1Scores: node.getAttribute('data-top1-scores'),
      }))
      return {
        messages,
        viewportStatus,
        panel: panelLocation ? {
          rect: panelLocation.getAttribute('data-panel'),
          candidates: panelLocation.getAttribute('data-panel-candidates'),
          gap: panelLocation.getAttribute('data-panel-selection-gap'),
        } : null,
        heroAnalysis: heroSummary ? {
          heroIds: heroSummary.getAttribute('data-hero-ids'),
          modes: heroSummary.getAttribute('data-modes'),
          equipmentIds: heroSummary.getAttribute('data-equipment-ids'),
          equipmentCandidates: heroSummary.getAttribute('data-equipment-candidates'),
          equipmentRects: heroSummary.getAttribute('data-equipment-rects'),
          petIds: heroSummary.getAttribute('data-pet-ids'),
          petCandidates: heroSummary.getAttribute('data-pet-candidates'),
          petRects: heroSummary.getAttribute('data-pet-rects'),
          heroGeometry: heroSummary.getAttribute('data-hero-geometry'),
        } : null,
        regionSummary,
      }
    })
    console.log(`--- ${(step + 1) * 5}s ---`)
    console.log(JSON.stringify(state, null, 2))
    if (state.heroAnalysis) break
  }
  await browser.close()
}

run().catch((error) => { console.error(error); process.exit(1) })
