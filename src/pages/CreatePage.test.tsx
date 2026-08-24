import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { CreatePage } from './CreatePage'

const link = 'https://link.clashofclans.com/cn?action=CopyArmy&army=u1x0s1x0'

describe('新建方案页面', () => {
  it('提供三种入口并将有效链接交给统一编辑器', () => {
    const onCreateFromLink = vi.fn()
    render(<CreatePage onCreateFromLink={onCreateFromLink} onCreateManual={vi.fn()} onOpenScreenshot={vi.fn()} />)
    expect(screen.getByRole('button', { name: /截图识别/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /手动创建/ })).toBeTruthy()
    fireEvent.change(screen.getByLabelText('国服配兵链接'), { target: { value: link } })
    fireEvent.click(screen.getByRole('button', { name: '解析链接' }))
    fireEvent.click(screen.getByRole('button', { name: '进入配兵编辑器' }))
    expect(onCreateFromLink).toHaveBeenCalledWith(expect.objectContaining({ troops: expect.any(Array) }), link)
  })
})
