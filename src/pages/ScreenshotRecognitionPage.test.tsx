import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ScreenshotRecognitionPage } from './ScreenshotRecognitionPage'

vi.mock('../recognition/preflight', () => ({
  inspectScreenshotFile: vi.fn(async (file: File) => ({
    fileName: file.name, mimeType: file.type, width: 2048, height: 1024, aspectRatio: 2,
    sha256: '0123456789abcdef', layout: 'saved', layoutConfidence: .94, woodPixelRatio: .58,
    panel: { x: .074, y: .03, width: .827, height: .915 }, panelConfidence: .95,
    panelSource: 'automatic',
    complete: true, issues: [],
  })),
}))

vi.mock('../recognition/cardAnalysis', () => ({
  analyzeCardLayout: vi.fn(async () => ({
    regions: [{
      region: 'mainTroops', label: '主军队', validation: { issues: [], suggestions: [] }, slots: [{
        rect: { x: .4, y: .2, width: .08, height: .12 }, badgeConfidence: .62,
        candidates: [{ id: 8, kind: 'troop', score: .9 }],
        count: { confidence: 0, digits: [] },
      }],
    }],
    heroes: [{
      index: 0, heroId: 7, geometryScore: .8, diagnostics: [],
      equipment: [
        { rect: { x: .01, y: .8, width: .05, height: .09 }, candidates: [{ id: 52, score: .9 }] },
        { rect: { x: .07, y: .8, width: .05, height: .09 }, candidates: [{ id: 60, score: .88 }] },
      ],
      pet: { rect: { x: .01, y: .72, width: .13, height: .07 }, candidates: [{ id: 16, score: .72 }], recognizedId: 16 },
    }],
  })),
}))

const uploadSample = async (container: HTMLElement) => {
  const input = container.querySelector('input[type="file"]') as HTMLInputElement
  fireEvent.change(input, { target: { files: [new File(['image'], '001.png', { type: 'image/png' })] } })
  expect(await screen.findByText(/完整截图检查通过/)).toBeTruthy()
}

describe('截图识别页面', () => {
  beforeEach(() => {
    vi.stubGlobal('URL', Object.assign(URL, {
      createObjectURL: vi.fn(() => 'blob:test-image'),
      revokeObjectURL: vi.fn(),
    }))
    // 页面任何进入编辑器的路径都可能触发样本回传；单测里拦截网络。
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200 } as Response))
  })

  it('上传完整截图并确认候选后进入统一编辑器', async () => {
    const onEdit = vi.fn()
    const { container } = render(<ScreenshotRecognitionPage onEditInCalculator={onEdit} />)
    await uploadSample(container)
    fireEvent.click(screen.getByRole('button', { name: '运行模拟识别' }))
    expect(await screen.findByText('模拟识别已完成。请核对黄色和红色项目；当前结果不代表截图真实内容。')).toBeTruthy()
    const continueButton = screen.getByRole('button', { name: /一键确认全部/ }) as HTMLButtonElement
    expect(continueButton.disabled).toBe(false)
    fireEvent.click(continueButton)
    expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ troops: expect.any(Array) }))
  })

  it('支持从系统剪贴板粘贴图片', async () => {
    render(<ScreenshotRecognitionPage onEditInCalculator={vi.fn()} />)
    const file = new File(['image'], 'clipboard.jpg', { type: 'image/jpeg' })
    fireEvent.paste(window, { clipboardData: { files: [file] } })
    expect(await screen.findByText('clipboard.jpg')).toBeTruthy()
    expect(await screen.findByText(/完整截图检查通过/)).toBeTruthy()
  })

  it('存在未解决项时确认按钮定位第一个未解决项而不是进入编辑器', async () => {
    const onEdit = vi.fn()
    const { container } = render(<ScreenshotRecognitionPage onEditInCalculator={onEdit} />)
    await uploadSample(container)
    fireEvent.click(screen.getByRole('button', { name: '生成真实识别候选' }))
    const gateButton = await screen.findByRole('button', { name: /定位首个待确认项（剩余/ })
    expect(onEdit).not.toHaveBeenCalled()
    fireEvent.click(gateButton)
    expect(onEdit).not.toHaveBeenCalled()
    const firstCard = container.querySelector('[data-review-key="mainTroops-0"]')
    expect(firstCard).toBeTruthy()
    expect(firstCard?.className).toContain('active')
  })

  it('兜底入口跳过确认直接进入编辑器并回传未完成样本', async () => {
    const onEdit = vi.fn()
    const fetchMock = vi.mocked(fetch)
    const { container } = render(<ScreenshotRecognitionPage onEditInCalculator={onEdit} />)
    await uploadSample(container)
    fireEvent.click(screen.getByRole('button', { name: '生成真实识别候选' }))
    const skipButton = await screen.findByRole('button', { name: '跳过确认直接进入编辑器' })
    fireEvent.click(skipButton)
    expect(onEdit).toHaveBeenCalledTimes(1)
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled())
  })

  it('web 端默认共享：无共享开关，显示上传说明', async () => {
    const { container } = render(<ScreenshotRecognitionPage onEditInCalculator={vi.fn()} />)
    await uploadSample(container)
    expect(screen.queryByText(/共享识别样本/)).toBeNull()
    expect(container.querySelector('input[type="checkbox"][aria-label], .sample-sharing')).toBeNull()
    expect(screen.getByText(/进入配兵编辑器时会自动回传识别样本/)).toBeTruthy()
  })
})
