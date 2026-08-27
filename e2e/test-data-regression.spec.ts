import { expect, test } from '@playwright/test'

test('视频样本 1 的数量、非歧义类别与英雄装备保持基准', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: '截图识别' }).click()
  await page.locator('input[type="file"]').setInputFiles('recognition-samples/test_data/1.png')
  await expect(page.getByTestId('panel-location')).toBeVisible()

  const expected = {
    mainTroops: {
      ids: ['troop:0', 'troop:1', 'troop:10', 'troop:23', 'troop:5', 'troop:57', 'troop:6', 'troop:76', 'troop:8'].sort().join(','),
      counts: [1, 3, 2, 20, 5, 2, 2, 5, 1],
    },
    mainSpells: {
      ids: ['spell:120', 'spell:109', 'spell:5', 'spell:2', 'spell:9', 'spell:10'].sort().join(','),
      counts: [2, 3, 2, 1, 1, 1],
    },
    mainSiege: {
      ids: ['siege:75', 'siege:91', 'siege:188'].sort().join(','),
      counts: [1, 1, 1],
    },
    castleArmy: {
      ids: ['troop:63', 'troop:76', 'siege:75', 'siege:188', 'spell:70', 'spell:98'].sort().join(','),
      counts: [1, 1, 1, 1, 1, 1],
    },
  }
  for (const [region, value] of Object.entries(expected)) {
    const summary = page.getByTestId(`card-count-${region}`)
    if (region === 'mainSpells' || region === 'mainSiege') expect(await summary.getAttribute('data-top1')).toBe(value.ids)
    else expect((await summary.getAttribute('data-top1'))?.split(',')).toHaveLength(value.counts.length)
    expect((await summary.getAttribute('data-count-details'))?.split(',').map((entry) => Number(entry.split(':')[0]))).toEqual(value.counts)
  }
  const heroes = page.getByTestId('hero-visual-analysis')
  expect(await heroes.getAttribute('data-equipment-ids')).toBe('52_60;0_32;4_5;49_43')
})

test('ONNX 分类与 PP-OCR 启用后样本 1 与人工真值逐项一致', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: '截图识别' }).click()
  await page.locator('input[type="file"]').setInputFiles('recognition-samples/test_data/1.png')
  const summary = page.getByTestId('card-count-mainTroops')
  await expect(summary).toBeVisible()
  expect(await summary.getAttribute('data-top1')).toBe(
    ['troop:0', 'troop:1', 'troop:10', 'troop:23', 'troop:5', 'troop:57', 'troop:6', 'troop:76', 'troop:8'].sort().join(','),
  )
  const spells = page.getByTestId('card-count-mainSpells')
  expect((await spells.getAttribute('data-count-details'))?.split(',').map((entry) => Number(entry.split(':')[0]))).toEqual([2, 3, 2, 1, 1, 1])
  expect(await page.getByTestId('card-count-castleArmy').getAttribute('data-top1')).toBe(
    ['troop:63', 'troop:76', 'siege:75', 'siege:188', 'spell:70', 'spell:98'].sort().join(','),
  )
})

for (const sample of [11, 12]) test(`视频样本 ${sample} 保留完整英雄子卡分割`, async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: '截图识别' }).click()
  await page.locator('input[type="file"]').setInputFiles(`recognition-samples/test_data/${sample}.${sample === 11 ? 'jpg' : 'png'}`)
  await expect(page.getByText(/完整截图检查通过/)).toBeVisible()
  const panel = page.getByTestId('panel-location')
  expect((await panel.getAttribute('data-panel-candidates'))?.split(';').length).toBeGreaterThanOrEqual(3)
  expect((await panel.getAttribute('data-panel-candidates'))?.split(';').length).toBeLessThanOrEqual(5)
  const summary = page.getByTestId('hero-visual-analysis')
  await expect(summary).toBeVisible()
  expect((await summary.getAttribute('data-hero-geometry'))?.split(';')).toHaveLength(4)
  expect((await summary.getAttribute('data-equipment-rects'))?.split(';')).toHaveLength(8)
  expect((await summary.getAttribute('data-pet-rects'))?.split(';')).toHaveLength(4)
})

const expectedCardCounts = {
  1: { mainTroops: 9, mainSpells: 6, mainSiege: 3, castleArmy: 6 },
  2: { mainTroops: 9, mainSpells: 5, mainSiege: 2, castleArmy: 7 },
  3: { mainTroops: 7, mainSpells: 6, mainSiege: 3, castleArmy: 5 },
  4: { mainTroops: 10, mainSpells: 6, mainSiege: 3, castleArmy: 7 },
} as const

test('四个视频样本的自动面板边界保持稳定', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: '截图识别' }).click()
  const expectedPanels = {
    1: [.0547, .1569, .8887, .6639],
    2: [.0625, .1389, .8984, .7130],
    3: [0, 0, 1, .9303],
    4: [.1172, .1502, .7617, .7065],
  } as const
  for (const sample of [1, 2, 3, 4] as const) {
    await page.locator('input[type="file"]').setInputFiles(`recognition-samples/test_data/${sample}.png`)
    const location = page.getByTestId('panel-location')
    await expect(location).toBeVisible()
    const actual = (await location.getAttribute('data-panel'))?.split(',').map(Number) ?? []
    expect(actual).toHaveLength(4)
    actual.forEach((value, index) => expect(Math.abs(value - expectedPanels[sample][index])).toBeLessThan(.02))
  }
})

for (const [sample, regions] of Object.entries(expectedCardCounts)) {
  test(`视频样本 ${sample} 使用卡片边缘与间距完整切分`, async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: '截图识别' }).click()
    await page.locator('input[type="file"]').setInputFiles(`recognition-samples/test_data/${sample}.png`)
    await expect(page.getByTestId('panel-location')).toBeVisible()
    for (const [region, expected] of Object.entries(regions)) {
      const summary = page.getByTestId(`card-count-${region}`)
      await expect(summary).toBeVisible()
      const slots = (await summary.getAttribute('data-top1') ?? '').split(',').filter(Boolean)
      const diagnostics = [await summary.getAttribute('data-geometry'), await summary.getAttribute('data-slot-diagnostics'), await summary.getAttribute('data-count-details'), await summary.getAttribute('data-top1-scores'), await summary.getAttribute('data-slot-rects')].join(' / ')
      expect(slots, `${sample}:${region} ${diagnostics}`).toHaveLength(expected)
    }
  })
}
