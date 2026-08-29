import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ScreenshotPreflight, ScreenshotRecognitionResult } from './types'
import { ArmyDatabase, db } from '../storage/armyDatabase'
import { buildSampleMeta, collectSample, enqueueSample, flushSampleQueue, getSampleQueueSummary, isAutomatedSession, isSampleCollectionSupported } from './sampleCollection'

const sha256 = 'a'.repeat(64)

const preflight = (overrides: Partial<ScreenshotPreflight> = {}): ScreenshotPreflight => ({
  fileName: 'shot.png',
  mimeType: 'image/png',
  width: 2400,
  height: 1080,
  aspectRatio: 2.222,
  sha256,
  layout: 'saved',
  layoutConfidence: .98,
  panel: { x: .1, y: .1, width: .8, height: .8 },
  panelConfidence: .9,
  panelSource: 'automatic',
  woodPixelRatio: .5,
  complete: true,
  issues: [],
  viewportPixels: { width: 2, height: 2, data: new Uint8ClampedArray(16) } as ImageData,
  ...overrides,
})

const machineResult = (): ScreenshotRecognitionResult => ({
  engine: 'visual',
  layout: 'saved',
  panel: { x: .1, y: .1, width: .8, height: .8 },
  anchors: [],
  regions: [],
  cards: [{
    key: 'card-1',
    region: 'mainTroops',
    rect: { x: 0, y: 0, width: .1, height: .1 },
    selectedId: 2,
    selectedKind: 'troop',
    count: 12,
    itemCandidates: [{ id: 2, kind: 'troop', score: .9 }],
    countCandidates: [{ value: 12, score: .8 }],
    confidence: .85,
    confirmed: false,
    ignoreLevel: true,
  }],
  heroes: [],
  warnings: [],
  createdAt: '2026-08-27T00:00:00.000Z',
})

const imageFile = () => new File([new Uint8Array([1, 2, 3, 4])], 'shot.png', { type: 'image/png' })

const captureInput = () => ({
  file: imageFile(),
  preflight: preflight(),
  machineResult: machineResult(),
  finalComposition: { heroes: [], clanCastleTroops: [], clanCastleSpells: [], troops: [], spells: [] },
  unresolvedCountAtEntry: 0,
})

let database: ArmyDatabase

beforeEach(() => {
  database = new ArmyDatabase(`test-sample-${crypto.randomUUID()}`)
  delete (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__
  Object.defineProperty(navigator, 'webdriver', { value: false, configurable: true })
})

afterEach(async () => {
  await database.delete()
  await db.sampleQueue.clear()
  delete (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__
  delete (navigator as { webdriver?: unknown }).webdriver
  vi.unstubAllGlobals()
})

describe('样本元数据构建', () => {
  it('剥离 viewportPixels 且保留其余 preflight 字段', () => {
    const meta = buildSampleMeta({
      preflight: preflight(),
      machineResult: machineResult(),
      finalComposition: { heroes: [], clanCastleTroops: [], clanCastleSpells: [], troops: [{ id: 2, count: 12 }], spells: [] },
      unresolvedCountAtEntry: 0,
    })
    expect((meta.preflight as Record<string, unknown>).viewportPixels).toBeUndefined()
    expect(meta.preflight.sha256).toBe(sha256)
    expect(meta.preflight.layout).toBe('saved')
    expect(meta.armyLink).toBeUndefined()
  })

  it('携带配兵链接时写入 armyLink 字段', () => {
    const meta = buildSampleMeta({
      ...captureInput(),
      armyLink: 'https://link.clashofclans.com/cn?action=CopyArmy&army=i0',
    })
    expect(meta.armyLink).toBe('https://link.clashofclans.com/cn?action=CopyArmy&army=i0')
  })

  it('人工修正与机器输出不一致时标记 hadCorrections', () => {
    const input = {
      preflight: preflight(),
      machineResult: machineResult(),
      unresolvedCountAtEntry: 1,
    }
    const unchanged = buildSampleMeta({ ...input, finalComposition: { heroes: [], clanCastleTroops: [], clanCastleSpells: [], troops: [{ id: 2, count: 12 }], spells: [] } })
    const corrected = buildSampleMeta({ ...input, finalComposition: { heroes: [], clanCastleTroops: [], clanCastleSpells: [], troops: [{ id: 3, count: 8 }], spells: [] } })
    expect(unchanged.hadCorrections).toBe(false)
    expect(corrected.hadCorrections).toBe(true)
    expect(corrected.unresolvedCountAtEntry).toBe(1)
  })
})

describe('平台与自动化闸门', () => {
  it('浏览器环境支持采集，桌面端不支持', () => {
    expect(isSampleCollectionSupported()).toBe(true)
    ;(window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {}
    expect(isSampleCollectionSupported()).toBe(false)
  })

  it('webdriver 会话视为自动化环境', () => {
    expect(isAutomatedSession()).toBe(false)
    Object.defineProperty(navigator, 'webdriver', { value: true, configurable: true })
    expect(isAutomatedSession()).toBe(true)
  })
})

describe('样本队列', () => {
  it('入队并以 sha256 去重', async () => {
    const input = captureInput()
    expect(await enqueueSample(input, database)).toBe('enqueued')
    expect(await enqueueSample(input, database)).toBe('duplicate')
    expect(await getSampleQueueSummary(database)).toEqual({ pending: 1, uploaded: 0 })
  })

  it('上传成功后标记 uploaded，请求携带令牌与样本字段', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 } as Response)
    vi.stubGlobal('fetch', fetchMock)
    await enqueueSample(captureInput(), database)

    const result = await flushSampleQueue(3, database)
    expect(result).toEqual({ uploaded: 1, failed: 0, remaining: 0 })
    expect(await getSampleQueueSummary(database)).toEqual({ pending: 0, uploaded: 1 })

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toMatch(/\/sample$/)
    expect(init.headers).toMatchObject({ 'x-upload-token': expect.any(String) })
    const body = JSON.parse(String(init.body))
    expect(body.sha256).toBe(sha256)
    expect(body.imageBase64).toBeTruthy()
    expect(body.sample.preflight.sha256).toBe(sha256)
  })

  it('上传失败时保留待传状态并记录错误', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')))
    await enqueueSample(captureInput(), database)

    const result = await flushSampleQueue(3, database)
    expect(result).toEqual({ uploaded: 0, failed: 1, remaining: 1 })
    const row = await database.sampleQueue.get(sha256)
    expect(row?.status).toBe('pending')
    expect(row?.attempts).toBe(1)
    expect(row?.lastError).toBe('network down')
  })
})

describe('采集入口', () => {
  it('桌面端不采集', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    ;(window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {}

    collectSample(captureInput())
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(fetchMock).not.toHaveBeenCalled()
    expect(await getSampleQueueSummary()).toEqual({ pending: 0, uploaded: 0 })
  })

  it('自动化会话不采集，避免 e2e 污染线上样本库', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    Object.defineProperty(navigator, 'webdriver', { value: true, configurable: true })

    collectSample(captureInput())
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(fetchMock).not.toHaveBeenCalled()
    expect(await getSampleQueueSummary()).toEqual({ pending: 0, uploaded: 0 })
  })

  it('模拟引擎不采集', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    collectSample({ ...captureInput(), machineResult: { ...machineResult(), engine: 'mock' } })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(fetchMock).not.toHaveBeenCalled()
    expect(await getSampleQueueSummary()).toEqual({ pending: 0, uploaded: 0 })
  })

  it('web 端正常采集并入队上传', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 } as Response)
    vi.stubGlobal('fetch', fetchMock)

    collectSample(captureInput())
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(await getSampleQueueSummary()).toEqual({ pending: 0, uploaded: 1 })
  })
})
