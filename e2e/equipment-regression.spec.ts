import { expect, test } from '@playwright/test'

for (const [sample, expected] of [['revenge-deck', 60], ['rocket-backpack', 53]] as const) {
  test(`${sample} 真实装备槽不会与另一飞龙公爵装备混淆`, async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: '截图识别' }).click()
    await page.locator('input[type="file"]').setInputFiles(`recognition-samples/equipment-regression/${sample}-panel.png`)
    const heroes = page.getByTestId('hero-visual-analysis')
    await expect(heroes).toBeVisible()
    const pairs = (await heroes.getAttribute('data-equipment-ids') ?? '').split(';').map((pair) => pair.split('_').map(Number))
    expect(pairs[0]).toContain(expected)
    expect(pairs[0]).toContain(52)
    const firstSlot = (await heroes.getAttribute('data-equipment-candidates') ?? '').split(';')[0].split('_')[0]
    const candidates = firstSlot.split('|').map((candidate) => {
      const [id, score] = candidate.split(':').map(Number)
      return { id, score }
    })
    expect(candidates[0].id).toBe(expected)
    expect(candidates[0].score - candidates[1].score).toBeGreaterThan(.02)
  })
}
