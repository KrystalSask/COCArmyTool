import { expect, test } from '@playwright/test'

const samples = {
  5: { mainTroops: 8, mainSpells: 5, mainSiege: 2, castleArmy: 7 },
  6: { mainTroops: 5, mainSpells: 4, mainSiege: 3, castleArmy: 5 },
} as const

for (const [sample, expectedRegions] of Object.entries(samples)) {
  test(`新增样本 ${sample} 保留完整面板与全部卡片`, async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: '截图识别' }).click()
    await page.locator('input[type="file"]').setInputFiles(`recognition-samples/test_data/${sample}.png`)
    const panel = page.getByTestId('panel-location')
    await expect(panel).toBeVisible()
    for (const [region, expected] of Object.entries(expectedRegions)) {
      const summary = page.getByTestId(`card-count-${region}`)
      const top1 = (await summary.getAttribute('data-top1') ?? '').split(',').filter(Boolean)
      expect(top1, `${sample}:${region}`).toHaveLength(expected)
    }
    if (sample === '5') {
      const castle = page.getByTestId('card-count-castleArmy')
      const selectedInOrder = (await castle.getAttribute('data-top3') ?? '').split(';').map((slot) => slot.split('|')[0])
      expect(selectedInOrder.slice(0, 4)).toEqual(['troop:5', 'siege:188', 'troop:58', 'troop:7'])
    } else {
      const actualPanel = (await panel.getAttribute('data-panel') ?? '').split(',').map(Number)
      expect(actualPanel[0]).toBeLessThan(.01)
      expect(actualPanel[1]).toBeCloseTo(.0421, 2)
      expect(actualPanel[2]).toBeGreaterThan(.98)
      const troops = page.getByTestId('card-count-mainTroops')
      expect((await troops.getAttribute('data-top3') ?? '').split(';')[0]).toMatch(/^troop:8(?:\||$)/)
      expect((await troops.getAttribute('data-count-details') ?? '').split(',')[0]).toMatch(/^\?:/)
      expect(await troops.getAttribute('data-rule-issues')).toContain('capacity-unverifiable:0')
      const spells = page.getByTestId('card-count-mainSpells')
      expect((await spells.getAttribute('data-top3') ?? '').split(';').at(-1)).toMatch(/^spell:0(?:\||$)/)
      // The visible recall-spell badge is x2; capacity/link truth is the known
      // mismatched label and must not overwrite OCR to x1.
      expect((await spells.getAttribute('data-count-details') ?? '').split(',').at(-1)).toMatch(/^2:/)
      expect(await spells.getAttribute('data-rule-issues')).toContain('capacity-mismatch')
    }
  })
}

test('视频自带黑色左边界时不会把视频边界当作面板边界', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: '截图识别' }).click()
  await page.locator('input[type="file"]').setInputFiles('recognition-samples/test_data/7.png')
  const panel = page.getByTestId('panel-location')
  await expect(panel).toBeVisible()
  const [x, , panelWidth] = (await panel.getAttribute('data-panel') ?? '').split(',').map(Number)
  expect(x).toBeGreaterThan(.11)
  expect(x).toBeLessThan(.15)
  expect(x + panelWidth).toBeGreaterThan(.84)
  expect(x + panelWidth).toBeLessThan(.88)
})
