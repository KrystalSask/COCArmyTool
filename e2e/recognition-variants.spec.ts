import { expect, test } from '@playwright/test'

const variants = [
  ['原始 PNG', 'recognition-samples/batch-01-dev/images/001.png'],
  ['JPEG 95', 'recognition-samples/batch-01-dev/derived/jpeg-q95/001.jpg'],
  ['JPEG 85', 'recognition-samples/batch-01-dev/derived/jpeg-q85/001.jpg'],
  ['WebP 90', 'recognition-samples/batch-01-dev/derived/webp-q90/001.webp'],
  ['缩放 75%', 'recognition-samples/batch-01-dev/derived/scale-75/001.png'],
] as const

test('正式支持格式和尺寸派生图保持等价定位与卡片切分', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: /截图识别/ }).click()
  const results = []
  for (const [variant, file] of variants) {
    await page.getByLabel('上传完整军队配置截图').setInputFiles(file)
    await expect(page.getByText(/完整截图检查通过/)).toBeVisible()
    const panel = (await page.getByTestId('panel-location').getAttribute('data-panel'))?.split(',').map(Number) ?? []
    const counts: Record<string, number> = {}
    for (const region of ['mainTroops', 'mainSpells', 'mainSiege', 'castleArmy']) {
      const summary = page.getByTestId(`card-count-${region}`)
      counts[region] = (await summary.getAttribute('data-top1') ?? '').split(',').filter(Boolean).length
    }
    results.push({ variant, panel, counts })
  }
  const baseline = results[0]
  for (const result of results.slice(1)) {
    expect(result.counts, result.variant).toEqual(baseline.counts)
    expect(result.panel[0], result.variant).toBeCloseTo(baseline.panel[0], 2)
    expect(result.panel[1], result.variant).toBeCloseTo(baseline.panel[1], 2)
    expect(result.panel[2], result.variant).toBeCloseTo(baseline.panel[2], 2)
    expect(result.panel[3], result.variant).toBeCloseTo(baseline.panel[3], 2)
  }
})

test('50% 压力样本的缺失数量不会被容量规则补全或绕过人工确认', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: /截图识别/ }).click()
  await page.getByLabel('上传完整军队配置截图').setInputFiles('recognition-samples/batch-01-dev/derived/scale-50/001.png')
  await expect(page.getByText(/完整截图检查通过/)).toBeVisible()
  await page.getByRole('button', { name: '生成真实识别候选' }).click()
  // 缺失数量保持未解决：确认按钮保持可操作，点击后激活并定位第一个未解决项，
  // 而不是进入编辑器。
  const gate = page.getByTestId('recognition-review-gate')
  const gateButton = gate.getByRole('button', { name: /定位首个待确认项（剩余/ })
  await expect(gateButton).toBeEnabled()
  await expect(gate).toContainText('个待确认项')
  await gateButton.click()
  const activeReview = page.locator('.recognized-card.active, .recognized-hero.active').first()
  await expect(activeReview).toBeAttached()
  const activeKey = await activeReview.getAttribute('data-review-key')
  expect(activeKey).toBeTruthy()
  // 覆盖层中同一稳定键的证据矩形同步高亮。
  await expect(page.locator(`.recognition-card-box[aria-label="定位${activeKey}"]`)).toHaveClass(/active/)
  // 未进入编辑器。
  await expect(gateButton).toBeVisible()
})
