import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ScreenshotRecognitionPage } from './ScreenshotRecognitionPage'

vi.mock('../recognition/preflight', () => ({
  inspectScreenshotFile: vi.fn(async (file: File) => ({
    fileName: file.name, mimeType: file.type, width: 2048, height: 1024, aspectRatio: 2,
    sha256: '0123456789abcdef', layout: 'saved', layoutConfidence: .94, woodPixelRatio: .58,
    deviceProfile: 'iphone-17', panel: { x: .074, y: .03, width: .827, height: .915 }, panelConfidence: .95,
    panelSource: 'automatic',
    complete: true, issues: [],
  })),
}))

vi.mock('../recognition/cardAnalysis', () => ({ analyzeCardLayout: vi.fn(async () => ({ regions: [], heroes: [] })) }))

describe('截图识别页面', () => {
  beforeEach(() => {
    vi.stubGlobal('URL', Object.assign(URL, {
      createObjectURL: vi.fn(() => 'blob:test-image'),
      revokeObjectURL: vi.fn(),
    }))
  })

  it('上传完整截图并确认候选后进入统一编辑器', async () => {
    const onEdit = vi.fn()
    const { container } = render(<ScreenshotRecognitionPage onEditInCalculator={onEdit} />)
    const input = container.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [new File(['image'], '001.png', { type: 'image/png' })] } })
    expect(await screen.findByText(/完整截图检查通过/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '运行模拟识别' }))
    expect(await screen.findByText('模拟识别已完成。请核对黄色和红色项目；当前结果不代表截图真实内容。')).toBeTruthy()
    const continueButton = screen.getByRole('button', { name: '确认并进入配兵编辑器' }) as HTMLButtonElement
    expect(continueButton.disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: /确认全部模拟候选/ }))
    await waitFor(() => expect(continueButton.disabled).toBe(false))
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
})
