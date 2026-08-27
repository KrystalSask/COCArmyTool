import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

interface ValidationEntry { validationPath: string, region: 'mainTroops' | 'mainSpells' | 'mainSiege' | 'castleArmy' }

const dataset = resolve('artifacts/army-card-classification-cn-v1')
const validation = readFileSync(resolve(dataset, 'validation-manifest.jsonl'), 'utf8').trim().split(/\r?\n/).map((line) => JSON.parse(line) as ValidationEntry)
const classifierExpected = new Map(readFileSync('artifacts/army-card-evaluation-onnx-v2/predictions.csv', 'utf8').trim().split(/\r?\n/).slice(1).map((line) => {
  const columns = line.split(',')
  return [columns[0], columns[7]]
}))
const countExpected = new Map(readFileSync('artifacts/army-card-count-ocr-baseline-localized/predictions.jsonl', 'utf8').trim().split(/\r?\n/).map((line) => {
  const value = JSON.parse(line) as { validationPath: string, predicted: number }
  return [value.validationPath, value.predicted] as const
}))

test('浏览器 ONNX 与 455 张 Python 基线逐张一致', async ({ page }) => {
  test.setTimeout(10 * 60_000)
  await page.goto('/')
  const actual: Array<{ top1: string, count?: number, rawText: string }> = []
  for (let offset = 0; offset < validation.length; offset += 25) {
    const entries = validation.slice(offset, offset + 25).map((entry) => ({
      url: `/@fs/${resolve(dataset, entry.validationPath).replaceAll('\\', '/')}`,
      region: entry.region,
    }))
    actual.push(...await page.evaluate(async (batch) => {
      const harness = await import('/e2e/browser-model-harness.ts')
      return harness.evaluateNormalizedCards(batch)
    }, entries))
  }
  expect(actual).toHaveLength(455)
  let classifierMatches = 0
  let countMatches = 0
  let unreadable = 0
  validation.forEach((entry, index) => {
    if (actual[index].top1 === classifierExpected.get(entry.validationPath)?.split('_').slice(0, 2).join('_')) classifierMatches += 1
    if (actual[index].count === countExpected.get(entry.validationPath)) countMatches += 1
    if (actual[index].count === undefined) unreadable += 1
  })
  expect(classifierMatches).toBe(455)
  expect(countMatches).toBeGreaterThanOrEqual(454)
  expect(unreadable).toBe(0)
})
