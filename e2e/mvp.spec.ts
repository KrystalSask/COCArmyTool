import { expect, test } from '@playwright/test'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'

const sample = 'https://link.clashofclans.com/cn?action=CopyArmy&army=h1p9e48_17-2m1p16e4_5-6p17e49_43-7p4e52_53i11x5-2x188d1x70-1x98u5x5-10x8-5x65-2x1-1x188-1x135-1x75s4x120-2x5-1x2-1x1-1x9'
const siegeIds = new Set([51, 52, 62, 75, 87, 91, 92, 135, 188])
const batchLabels = new Map(readFileSync('recognition-samples/batch-01-dev/labels.txt', 'utf8').trim().split(/\r?\n/).slice(1).map((line) => {
  const [id, link] = line.split('\t')
  return [Number(id), link]
}))
const batchActualEquipment = (JSON.parse(readFileSync('recognition-samples/batch-01-dev/actual-equipment.json', 'utf8')) as {
  samples: Record<string, Record<string, Array<number | null>>>
}).samples

const expectedCardCounts = (link: string) => {
  const payload = new URL(link).searchParams.get('army') ?? ''
  const sections = new Map([...payload.matchAll(/([hidus])([^hidus]+)/g)].map((match) => [match[1], match[2]]))
  const entries = (key: string) => (sections.get(key) ?? '').split('-').filter(Boolean).map((entry) => Number(entry.split('x')[1]))
  const troops = entries('u')
  return {
    mainTroops: troops.filter((id) => !siegeIds.has(id)).length,
    mainSpells: entries('s').length,
    mainSiege: troops.filter((id) => siegeIds.has(id)).length,
    castleArmy: entries('i').length + entries('d').length,
  }
}

const expectedQuantities = (link: string) => {
  const payload = new URL(link).searchParams.get('army') ?? ''
  const sections = new Map([...payload.matchAll(/([hidus])([^hidus]+)/g)].map((match) => [match[1], match[2]]))
  const entries = (key: string) => (sections.get(key) ?? '').split('-').filter(Boolean).map((entry) => {
    const [count, id] = entry.split('x').map(Number)
    return { count, id }
  })
  const troops = entries('u')
  return {
    mainTroops: troops.filter((entry) => !siegeIds.has(entry.id)).map((entry) => entry.count),
    mainSpells: entries('s').map((entry) => entry.count),
    mainSiege: troops.filter((entry) => siegeIds.has(entry.id)).map((entry) => entry.count),
    castleArmy: [...entries('i'), ...entries('d')].map((entry) => entry.count),
  }
}

const expectedHeroData = (link: string, sampleId?: string) => {
  const payload = new URL(link).searchParams.get('army') ?? ''
  const heroSection = [...payload.matchAll(/([hidus])([^hidus]+)/g)].find((match) => match[1] === 'h')?.[2] ?? ''
  return heroSection.split('-').filter(Boolean).map((entry) => {
    const match = entry.match(/^(\d+)(?:m(\d+))?(?:p(\d+))?(?:e(\d+)(?:_(\d+))?)?$/)!
    const id = Number(match[1])
    return { id, mode: Number(match[2] ?? 0), petId: match[3] ? Number(match[3]) : undefined, equipmentIds: sampleId ? batchActualEquipment[sampleId]?.[String(id)] ?? [Number(match[4]), Number(match[5])] : [Number(match[4]), Number(match[5])] }
  })
}

const expectedItemKeys = (link: string) => {
  const payload = new URL(link).searchParams.get('army') ?? ''
  const sections = new Map([...payload.matchAll(/([hidus])([^hidus]+)/g)].map((match) => [match[1], match[2]]))
  const ids = (key: string) => (sections.get(key) ?? '').split('-').filter(Boolean).map((entry) => Number(entry.split('x')[1]))
  const troops = ids('u')
  return {
    mainTroops: troops.filter((id) => !siegeIds.has(id)).map((id) => `troop:${id}`),
    mainSpells: ids('s').map((id) => `spell:${id}`),
    mainSiege: troops.filter((id) => siegeIds.has(id)).map((id) => `siege:${id}`),
    castleArmy: [...ids('i').map((id) => `${siegeIds.has(id) ? 'siege' : 'troop'}:${id}`), ...ids('d').map((id) => `spell:${id}`)],
  }
}

const maximumCandidateMatches = (expected: string[], candidates: string[][]) => {
  const claimedBy = Array.from({ length: candidates.length }, () => -1)
  const visit = (expectedIndex: number, seen: Set<number>): boolean => {
    for (let slot = 0; slot < candidates.length; slot += 1) {
      if (seen.has(slot) || !candidates[slot].includes(expected[expectedIndex])) continue
      seen.add(slot)
      if (claimedBy[slot] === -1 || visit(claimedBy[slot], seen)) {
        claimedBy[slot] = expectedIndex
        return true
      }
    }
    return false
  }
  return expected.reduce((count, _item, index) => count + Number(visit(index, new Set())), 0)
}

const confirmAllVisualCandidates = async (page: import('@playwright/test').Page) => {
  while (await page.getByRole('button', { name: '确认当前结果' }).count()) await page.getByRole('button', { name: '确认当前结果' }).first().click()
  while (await page.getByRole('button', { name: '确认英雄配置' }).count()) await page.getByRole('button', { name: '确认英雄配置' }).first().click()
}

test('链接、统一编辑器保存、方案库与手动创建形成完整流程', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('/')
  await page.getByLabel('配兵链接').fill(sample)
  await page.getByRole('button', { name: '解析链接' }).click()
  await expect(page.getByText(/链接解析成功/)).toBeVisible()
  await expect(page.getByText('352/352')).toBeVisible()
  await expect(page.getByText('弓箭女皇')).toBeVisible()
  await expect.poll(async () => page.locator('.game-icon').evaluateAll((images) => images.every((image) => !(image instanceof HTMLImageElement) || image.complete && image.naturalWidth > 0))).toBe(true)
  await page.screenshot({ path: 'artifacts/parsed-army.png', fullPage: true })
  await page.getByRole('button', { name: '进入配兵编辑器' }).click()
  await expect(page.getByRole('button', { name: '复制国服链接' })).toBeEnabled()
  await page.getByLabel('方案名称').fill('端到端回归方案')
  await page.getByRole('button', { name: '保存方案' }).click()
  await expect(page.getByText('完整方案已保存。')).toBeVisible()

  await page.getByRole('button', { name: /^方案库/ }).click()
  await expect(page.getByText('端到端回归方案')).toBeVisible()

  await page.getByRole('button', { name: '新建方案', exact: true }).click()
  await page.getByRole('button', { name: /手动创建/ }).click()
  await expect(page.getByRole('button', { name: '复制国服链接' })).toBeDisabled()
  await page.getByRole('button', { name: '载入完整示例' }).click()
  await expect(page.getByRole('button', { name: '复制国服链接' })).toBeEnabled()
  await expect(page.getByText('配置完整，可以复制链接')).toBeVisible()
  await page.screenshot({ path: 'artifacts/calculator-ready.png', fullPage: false })
})

test('移动端关键导航与新建表单可用', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await expect(page.getByRole('heading', { name: '选择配兵的创建方式' })).toBeVisible()
  await page.getByRole('button', { name: /手动创建/ }).click()
  await expect(page.getByRole('heading', { name: '配兵编辑器' })).toBeVisible()
  await page.screenshot({ path: 'artifacts/mobile-calculator.png', fullPage: false })
})

for (const viewport of [{ width: 1280, height: 720 }, { width: 1920, height: 1080 }, { width: 2560, height: 1440 }]) {
  test(`桌面窗口 ${viewport.width}×${viewport.height} 保留关键操作`, async ({ page }) => {
    await page.setViewportSize(viewport)
    await page.goto('/')
    await expect(page.getByRole('heading', { name: '选择配兵的创建方式' })).toBeVisible()
    await expect(page.getByRole('button', { name: /手动创建/ })).toBeVisible()
    await page.getByRole('button', { name: /手动创建/ }).click()
    await expect(page.getByRole('button', { name: '保存方案' })).toBeVisible()
    await expect(page.getByRole('button', { name: '复制国服链接' })).toBeVisible()
  })
}

test('未保存编辑会话离开时需要确认', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: /手动创建/ }).click()
  await page.getByLabel('方案名称').fill('尚未保存')
  page.once('dialog', async (dialog) => {
    expect(dialog.message()).toContain('未保存修改')
    await dialog.dismiss()
  })
  await page.getByRole('button', { name: /^方案库/ }).click()
  await expect(page.getByRole('heading', { name: '配兵编辑器' })).toBeVisible()
})

test('完整截图通过本地检查并进入模拟校正与安全导出', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('/')
  await page.getByRole('button', { name: '截图识别' }).click()
  await page.locator('input[type="file"]').setInputFiles('recognition-samples/seed-unlabelled/images/001-saved.jpg')
  await expect(page.getByText(/完整截图检查通过/)).toBeVisible()
  await expect(page.getByText('准备进攻 / 进攻确认', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '运行模拟识别' }).click()
  await expect(page.getByText(/当前为模拟识别结果/)).toBeVisible()
  await expect(page.getByRole('button', { name: '确认并进入配兵编辑器' })).toBeDisabled()
  await page.getByRole('button', { name: /确认全部模拟候选/ }).click()
  await expect(page.getByRole('button', { name: '确认并进入配兵编辑器' })).toBeEnabled()
  await page.getByRole('button', { name: '确认并进入配兵编辑器' }).click()
  await expect(page.getByRole('heading', { name: '配兵编辑器' })).toBeVisible()
  await page.screenshot({ path: 'artifacts/screenshot-recognition-pipeline.png', fullPage: true })
})

test('编辑导入截图能够识别为第二类固定布局', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto('/')
  await page.getByRole('button', { name: '截图识别' }).click()
  await page.locator('input[type="file"]').setInputFiles('recognition-samples/seed-unlabelled/images/002-edit.jpg')
  await expect(page.getByText(/完整截图检查通过/)).toBeVisible()
  await expect(page.getByText('编辑导入的军队配置', { exact: true })).toBeVisible()
})

test('移动端截图上传入口和原图预览保持可用', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await page.getByRole('button', { name: '截图识别' }).click()
  await expect(page.getByRole('heading', { name: '从完整截图识别配兵' })).toBeVisible()
  await page.getByLabel('上传完整军队配置截图').setInputFiles('recognition-samples/seed-unlabelled/images/001-saved.jpg')
  await expect(page.getByText(/完整截图检查通过/)).toBeVisible()
  await expect(page.getByAltText('待识别的完整军队配置截图')).toBeVisible()
  await page.screenshot({ path: 'artifacts/mobile-screenshot-upload.png', fullPage: false })
})

test('13 个原始样本均能按设备画像定位完整军队面板', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: '截图识别' }).click()
  let visualTop1Correct = 0
  let visualTop1Total = 0
  let visualTop3Correct = 0
  const correctionsBySample: Array<{ id: number, top1Corrections: number }> = []
  const exportChecks: Record<string, boolean> = {}
  for (let id = 1; id <= 13; id += 1) {
    let sampleTop1Corrections = 0
    await page.getByLabel('上传完整军队配置截图').setInputFiles(`recognition-samples/batch-01-dev/images/${String(id).padStart(3, '0')}.png`)
    await expect(page.getByText(/完整截图检查通过/)).toBeVisible()
    await expect(page.getByText(id <= 7 ? 'iphone-17' : 'ipad-pro-2024-11', { exact: true })).toBeVisible()
    const values = (await page.getByTestId('panel-location').getAttribute('data-panel'))?.split(',').map(Number) ?? []
    expect(values).toHaveLength(4)
    expect(values[2]).toBeGreaterThan(.78)
    expect(values[3]).toBeGreaterThan(id <= 7 ? .86 : .60)
    expect(values[3]).toBeLessThan(id <= 7 ? .97 : .76)
    const expectedCounts = expectedCardCounts(batchLabels.get(id) ?? '')
    const expectedQuantityValues = expectedQuantities(batchLabels.get(id) ?? '')
    const expectedItems = expectedItemKeys(batchLabels.get(id) ?? '')
    for (const [region, count] of Object.entries(expectedCounts)) {
      const summary = page.getByTestId(`card-count-${region}`)
      await expect(summary).toContainText(`${count} 张卡片`)
      const receivedQuantities = (await summary.getAttribute('data-counts'))?.split(',').filter(Boolean).map(Number).sort((a, b) => a - b)
      expect(receivedQuantities, await summary.getAttribute('data-count-details')).toEqual(expectedQuantityValues[region as keyof typeof expectedQuantityValues].sort((a, b) => a - b))
      const receivedItems = (await summary.getAttribute('data-top1'))?.split(',').sort() ?? []
      const expectedRegionItems = expectedItems[region as keyof typeof expectedItems].sort()
      const remaining = [...receivedItems]
      expectedRegionItems.forEach((item) => {
        const index = remaining.indexOf(item)
        if (index >= 0) { visualTop1Correct += 1; remaining.splice(index, 1) }
        else sampleTop1Corrections += 1
        visualTop1Total += 1
      })
      const top3Groups = (await summary.getAttribute('data-top3'))?.split(';').map((group) => group.split('|').filter(Boolean)) ?? []
      visualTop3Correct += maximumCandidateMatches(expectedRegionItems, top3Groups)
    }
    const heroSummary = page.getByTestId('hero-visual-analysis')
    const expectedHeroes = expectedHeroData(batchLabels.get(id) ?? '', String(id).padStart(3, '0'))
    expect((await heroSummary.getAttribute('data-hero-ids'))?.split(',').map(Number)).toEqual(expectedHeroes.map((hero) => hero.id))
    expect((await heroSummary.getAttribute('data-pet-ids'))?.split(',').map((value) => value === '?' ? undefined : Number(value)), await heroSummary.getAttribute('data-pet-details')).toEqual(expectedHeroes.map((hero) => hero.petId))
    expect((await heroSummary.getAttribute('data-equipment-ids'))?.split(';').map((pair) => pair.split('_').map(Number))).toEqual(expectedHeroes.map((hero) => hero.equipmentIds))
    const wardenIndex = expectedHeroes.findIndex((hero) => hero.id === 2)
    if (wardenIndex >= 0) expect((await heroSummary.getAttribute('data-modes'))?.split(',')[wardenIndex]).toBe(String(expectedHeroes[wardenIndex].mode))
    correctionsBySample.push({ id, top1Corrections: sampleTop1Corrections })
    if ([1, 2, 7].includes(id)) {
      await page.getByRole('button', { name: '生成真实识别候选' }).click()
      await confirmAllVisualCandidates(page)
      const enabled = await page.getByRole('button', { name: '确认并进入配兵编辑器' }).isEnabled()
      exportChecks[String(id).padStart(3, '0')] = enabled
      expect(enabled, await page.getByTestId('recognition-review-gate').getAttribute('data-composition')).toBe(true)
    }
  }
  const top1Rate = visualTop1Correct / visualTop1Total
  const top3Rate = visualTop3Correct / visualTop1Total
  expect(top1Rate).toBeGreaterThanOrEqual(.95)
  expect(top3Rate).toBe(1)
  expect(correctionsBySample.filter((sample) => sample.top1Corrections <= 2).length).toBeGreaterThanOrEqual(7)
  const report = {
    generatedAt: new Date().toISOString(),
    batch: 'batch-01-dev',
    samples: 13,
    devices: { 'iphone-17': 7, 'ipad-pro-2024-11': 6 },
    cardIdentity: { total: visualTop1Total, top1Correct: visualTop1Correct, top1Rate, top3Correct: visualTop3Correct, top3Rate },
    quantity: { exactSamples: 13, exactRate: 1 },
    heroSubcards: { equipmentExactSamples: 13, petExactSamples: 13, wardenModeExactSamples: 13 },
    correctionsBySample,
    reviewChecks: { '001-ready': exportChecks['001'], '002-ready-after-confirmation': exportChecks['002'], '007-ready-after-confirmation': exportChecks['007'] },
  }
  mkdirSync('recognition-samples/batch-01-dev/reports', { recursive: true })
  writeFileSync('recognition-samples/batch-01-dev/reports/browser-mvp-evaluation.json', `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  await page.getByRole('button', { name: '生成真实识别候选' }).click()
  await expect(page.getByText('真实视觉候选已生成。请逐项确认后再进行容量校验与链接导出。')).toBeVisible()
  await expect(page.getByText(/当前为本地真实视觉候选/)).toBeVisible()
  await expect(page.getByRole('button', { name: '确认并进入配兵编辑器' })).toBeDisabled()
})
