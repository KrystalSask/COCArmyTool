import { expect, test } from '@playwright/test'

const sample = 'recognition-samples/manual-tests/images/video-subtitle-ipad.png'

test('带黑边字幕的视频截图可全图定位并切分卡片', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: '截图识别' }).click()
  await page.locator('input[type="file"]').setInputFiles(sample)
  await expect(page.getByTestId('panel-location')).toBeVisible()
  const panel = (await page.getByTestId('panel-location').getAttribute('data-panel'))!.split(',').map(Number)
  expect(panel[0]).toBeGreaterThan(.05)
  expect(panel[0]).toBeLessThan(.14)
  expect(panel[1]).toBeGreaterThan(.10)
  expect(panel[1]).toBeLessThan(.23)
  expect(panel[2]).toBeGreaterThan(.76)
  expect(panel[2]).toBeLessThan(.90)
  for (const [region, minimum] of [['mainTroops', 5], ['mainSpells', 1], ['mainSiege', 3], ['castleArmy', 4]] as const) {
    const summary = page.getByTestId(`card-count-${region}`)
    await expect(summary).toBeVisible()
    const count = (await summary.getAttribute('data-top1') ?? '').split(',').filter(Boolean).length
    expect(count, region).toBeGreaterThanOrEqual(minimum)
  }
  const heroes = page.getByTestId('hero-visual-analysis')
  await expect(heroes).toBeVisible()
  expect((await heroes.getAttribute('data-hero-ids') ?? '').split(',')).toHaveLength(4)
  expect((await heroes.getAttribute('data-equipment-ids') ?? '').split(';').every((pair) => pair.split('_').length === 2 && !pair.includes('?'))).toBe(true)
  expect((await heroes.getAttribute('data-pet-ids') ?? '').split(',').every((id) => id !== '?')).toBe(true)
})
