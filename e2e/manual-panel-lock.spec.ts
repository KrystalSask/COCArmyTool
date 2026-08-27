import { expect, test } from '@playwright/test'

const panelValues = async (page: import('@playwright/test').Page) =>
  (await page.getByTestId('panel-location').getAttribute('data-panel'))?.split(',').map(Number) ?? []

const dragNorthWest = async (page: import('@playwright/test').Page, dxFraction: number) => {
  const handle = page.getByRole('button', { name: '调整面板nw' })
  await expect(handle).toBeVisible()
  const box = await handle.boundingBox()
  const stage = await page.locator('.recognition-image-stage').boundingBox()
  expect(box).toBeTruthy()
  expect(stage).toBeTruthy()
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2)
  await page.mouse.down()
  await page.mouse.move(box!.x - stage!.width * dxFraction, box!.y + box!.height / 2, { steps: 8 })
  await page.mouse.up()
}

test('样本 5 手动左边缘小幅外移吸附到最近连续面板边，而不是更远的侧菜单边，且锁定不被替换', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: '截图识别' }).click()
  await page.locator('input[type="file"]').setInputFiles('recognition-samples/test_data/5.png')
  const location = page.getByTestId('panel-location')
  await expect(location).toBeVisible()
  const automatic = await panelValues(page)
  expect(automatic).toHaveLength(4)

  await page.getByRole('button', { name: '手动调整面板' }).click()
  // 向左（向外）拖左边缘约 1.5% 图宽；释放时小范围吸附应拉回真实面板边缘。
  await dragNorthWest(page, .015)
  await page.getByRole('button', { name: '按此面板重新识别' }).click()
  await expect(page.getByText(/完整截图检查通过/)).toBeVisible()
  const snapped = await panelValues(page)

  // 吸附结果：左边缘回到自动检测的真实面板边缘附近（512px 分析精度内），
  // 而不是停留在拖出的位置或跳向更左侧的游戏侧菜单边缘。
  expect(Math.abs(snapped[0] - automatic[0]), `snapped ${snapped} automatic ${automatic}`).toBeLessThan(.01)
  expect(snapped[0], `snapped ${snapped} automatic ${automatic}`).toBeGreaterThanOrEqual(automatic[0] - .01)
  expect(Math.abs(snapped[1] - automatic[1]), `snapped ${snapped} automatic ${automatic}`).toBeLessThan(.01)
  expect(Math.abs(snapped[2] - automatic[2]), `snapped ${snapped} automatic ${automatic}`).toBeLessThan(.01)
  expect(Math.abs(snapped[3] - automatic[3]), `snapped ${snapped} automatic ${automatic}`).toBeLessThan(.01)

  // 不拖拽再次提交：四个坐标逐位保持（预检与卡片分析都不再改写它）。
  await page.getByRole('button', { name: '手动调整面板' }).click()
  await page.getByRole('button', { name: '按此面板重新识别' }).click()
  await expect(page.getByText(/完整截图检查通过/)).toBeVisible()
  const relocked = await panelValues(page)
  relocked.forEach((value, index) => expect(Math.abs(value - snapped[index]), `index ${index} relocked ${relocked} snapped ${snapped}`).toBeLessThan(1e-6))
  // 手动面板跳过注册与卡片结构候选：无候选可替换它。
  expect(await location.getAttribute('data-panel-candidates')).toBe('')

  await page.getByRole('button', { name: '生成真实识别候选' }).click()
  await expect(page.getByText('真实视觉候选已生成。请逐项确认后再进行容量校验与链接导出。')).toBeVisible()
  // 四列英雄：4 个列框 + 8 个装备证据框 + 4 个战宠证据框。
  expect(await page.locator('.recognition-card-box.hero-box').count()).toBe(4)
  expect(await page.locator('.recognition-card-box.hero-evidence-box.equipment').count()).toBe(8)
  expect(await page.locator('.recognition-card-box.hero-evidence-box.pet').count()).toBe(4)
  expect(await page.locator('.recognized-hero').count()).toBe(4)
  // 每个英雄列都有装备 1/2 与战宠证据块，即使识别不完整也保留。
  expect(await page.locator('.hero-evidence-block').count()).toBe(12)
  // 子证据键双向可定位：点击第一个装备证据框后审查面板对应证据块激活。
  await page.locator('.recognition-card-box.hero-evidence-box.equipment').first().click()
  await expect(page.locator('.hero-evidence-block.active')).toHaveCount(1)
})
