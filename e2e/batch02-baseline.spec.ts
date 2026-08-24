import { expect, test } from '@playwright/test'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'

const siegeIds = new Set([51, 52, 62, 75, 87, 91, 92, 135, 188])
const rows = readFileSync('recognition-samples/batch-02-request/labels.txt', 'utf8').trim().split(/\r?\n/).slice(1).map((line) => {
  const [id, link, layout, variant, device] = line.split('\t')
  return { id, link, layout, variant, device }
})
const actualEquipment = (JSON.parse(readFileSync('recognition-samples/batch-02-request/actual-equipment.json', 'utf8')) as {
  samples: Record<string, Record<string, Array<number | null>>>
}).samples

const sectionsOf = (link: string) => new Map([...((new URL(link).searchParams.get('army') ?? '').matchAll(/([hidus])([^hidus]+)/g))].map((match) => [match[1], match[2]]))
const entriesOf = (sections: Map<string, string>, key: string) => (sections.get(key) ?? '').split('-').filter(Boolean).map((value) => {
  const [count, id] = value.split('x').map(Number)
  return { count, id }
})
const expectedRegions = (link: string) => {
  const sections = sectionsOf(link)
  const troops = entriesOf(sections, 'u')
  return {
    mainTroops: troops.filter((item) => !siegeIds.has(item.id)).map((item) => ({ ...item, key: `troop:${item.id}` })),
    mainSpells: entriesOf(sections, 's').map((item) => ({ ...item, key: `spell:${item.id}` })),
    mainSiege: troops.filter((item) => siegeIds.has(item.id)).map((item) => ({ ...item, key: `siege:${item.id}` })),
    castleArmy: [
      ...entriesOf(sections, 'i').map((item) => ({ ...item, key: `${siegeIds.has(item.id) ? 'siege' : 'troop'}:${item.id}` })),
      ...entriesOf(sections, 'd').map((item) => ({ ...item, key: `spell:${item.id}` })),
    ],
  }
}
const expectedHeroes = (link: string, sampleId: string) => (sectionsOf(link).get('h') ?? '').split('-').filter(Boolean).map((value) => {
  const match = value.match(/^(\d+)(?:m(\d+))?(?:p(\d+))?(?:e(\d+)(?:_(\d+))?)?$/)!
  const id = Number(match[1])
  return { id, mode: Number(match[2] ?? 0), petId: Number(match[3]), equipment: actualEquipment[sampleId]?.[String(id)] ?? [Number(match[4]), Number(match[5])] }
})

const maximumMatches = (expected: string[], candidates: string[][]) => {
  const claimedBy = Array.from({ length: candidates.length }, () => -1)
  const visit = (index: number, seen: Set<number>): boolean => {
    for (let slot = 0; slot < candidates.length; slot += 1) {
      if (seen.has(slot) || !candidates[slot].includes(expected[index])) continue
      seen.add(slot)
      if (claimedBy[slot] === -1 || visit(claimedBy[slot], seen)) { claimedBy[slot] = index; return true }
    }
    return false
  }
  return expected.reduce((total, _item, index) => total + Number(visit(index, new Set())), 0)
}

test('第二批进攻界面截图在合并图鉴上的识别评估', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: '截图识别' }).click()
  const samples = []
  let total = 0
  let top1 = 0
  let top3 = 0
  let angryExpected = 0
  let angryTop1 = 0
  let angryTop3 = 0
  for (const row of rows) {
    await page.locator('input[type="file"]').setInputFiles(`recognition-samples/batch-02-request/images/${row.id}.png`)
    await expect(page.getByTestId('panel-location')).toBeVisible()
    await expect(page.getByTestId('card-count-mainTroops')).toBeVisible()
    await expect(page.getByTestId('hero-visual-analysis')).toBeVisible()
    const expected = expectedRegions(row.link)
    let cardSplitExact = true
    const cardSplitMismatches: Array<{ region: string, expected: number, received: number }> = []
    let quantityExact = true
    const quantityMismatches: Array<{ region: string, expected: number[], received: number[], candidates: string | null, glyphs: string | null }> = []
    let sampleTop1 = 0
    let sampleTop3 = 0
    let sampleTotal = 0
    for (const [region, items] of Object.entries(expected)) {
      const summary = page.getByTestId(`card-count-${region}`)
      const receivedCounts = (await summary.getAttribute('data-counts') ?? '').split(',').filter(Boolean).map(Number).sort((a, b) => a - b)
      const expectedCounts = items.map((item) => item.count).sort((a, b) => a - b)
      const receivedSlots = (await summary.getAttribute('data-top1') ?? '').split(',').filter(Boolean).length
      cardSplitExact &&= receivedSlots === items.length
      if (receivedSlots !== items.length) cardSplitMismatches.push({ region, expected: items.length, received: receivedSlots })
      quantityExact &&= JSON.stringify(receivedCounts) === JSON.stringify(expectedCounts)
      if (JSON.stringify(receivedCounts) !== JSON.stringify(expectedCounts)) quantityMismatches.push({
        region,
        expected: expectedCounts,
        received: receivedCounts,
        candidates: await summary.getAttribute('data-count-digit-candidates'),
        glyphs: await summary.getAttribute('data-count-glyphs'),
      })
      const receivedTop1 = (await summary.getAttribute('data-top1') ?? '').split(',').filter(Boolean)
      const receivedTop3 = (await summary.getAttribute('data-top3') ?? '').split(';').map((group) => group.split('|').filter(Boolean))
      const expectedKeys = items.map((item) => item.key)
      sampleTop1 += maximumMatches(expectedKeys, receivedTop1.map((item) => [item]))
      sampleTop3 += maximumMatches(expectedKeys, receivedTop3)
      sampleTotal += expectedKeys.length
      const angryCount = expectedKeys.filter((key) => key === 'spell:123').length
      angryExpected += angryCount
      angryTop1 += Math.min(angryCount, receivedTop1.filter((key) => key === 'spell:123').length)
      angryTop3 += Math.min(angryCount, receivedTop3.filter((group) => group.includes('spell:123')).length)
    }
    const expectedHeroData = expectedHeroes(row.link, row.id)
    const heroSummary = page.getByTestId('hero-visual-analysis')
    const heroIds = (await heroSummary.getAttribute('data-hero-ids') ?? '').split(',').map((value) => value === '?' ? undefined : Number(value))
    const petIds = (await heroSummary.getAttribute('data-pet-ids') ?? '').split(',').map((value) => value === '?' ? undefined : Number(value))
    const equipment = (await heroSummary.getAttribute('data-equipment-ids') ?? '').split(';').map((pair) => pair.split('_').map((value) => value === '?' ? undefined : Number(value)))
    const equipmentCandidates = await heroSummary.getAttribute('data-equipment-candidates')
    const modes = (await heroSummary.getAttribute('data-modes') ?? '').split(',')
    const heroExact = JSON.stringify(heroIds) === JSON.stringify(expectedHeroData.map((item) => item.id))
    const petExact = JSON.stringify(petIds) === JSON.stringify(expectedHeroData.map((item) => item.petId))
    const equipmentExact = JSON.stringify(equipment) === JSON.stringify(expectedHeroData.map((item) => item.equipment))
    const wardenIndex = expectedHeroData.findIndex((item) => item.id === 2)
    const modeExact = wardenIndex < 0 || modes[wardenIndex] === String(expectedHeroData[wardenIndex].mode)
    const preflightCells = page.locator('.preflight-grid').first().locator('span strong')
    samples.push({
      id: row.id,
      expectedLayout: row.layout,
      detectedLayoutLabel: await preflightCells.nth(2).textContent(),
      expectedDevice: row.device,
      detectedDevice: await preflightCells.nth(4).textContent(),
      panel: (await page.getByTestId('panel-location').getAttribute('data-panel'))?.split(',').map(Number),
      cardSplitExact,
      cardSplitMismatches,
      quantityExact,
      quantityMismatches,
      identity: { total: sampleTotal, top1: sampleTop1, top3: sampleTop3 },
      heroes: {
        heroExact,
        petExact,
        equipmentExact,
        modeExact,
        expected: expectedHeroData,
        received: { heroIds, petIds, equipment, equipmentCandidates, modes },
      },
    })
    total += sampleTotal
    top1 += sampleTop1
    top3 += sampleTop3
  }
  const report = {
    generatedAt: new Date().toISOString(),
    batch: 'batch-02-request',
    templateSource: 'batch-01-dev+batch-02-request',
    samples,
    cardIdentity: { total, top1, top1Rate: top1 / total, top3, top3Rate: top3 / total },
    angrySpell: { expected: angryExpected, top1: angryTop1, top3: angryTop3 },
    exactSamples: {
      cardSplit: samples.filter((sample) => sample.cardSplitExact).length,
      quantity: samples.filter((sample) => sample.quantityExact).length,
      equipment: samples.filter((sample) => sample.heroes.equipmentExact).length,
      pets: samples.filter((sample) => sample.heroes.petExact).length,
      wardenMode: samples.filter((sample) => sample.heroes.modeExact).length,
    },
  }
  mkdirSync('recognition-samples/batch-02-request/reports', { recursive: true })
  writeFileSync('recognition-samples/batch-02-request/reports/browser-evaluation-after-integration.json', `${JSON.stringify(report, null, 2)}\n`)
})
