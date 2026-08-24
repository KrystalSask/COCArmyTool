import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ImportPage } from './ImportPage'

vi.mock('../storage/armyDatabase', () => ({ saveArmyRecord: vi.fn() }))

const link = 'https://link.clashofclans.com/cn?action=CopyArmy&army=h1p9e48_17-2m1p16e4_5-6p17e49_43-7p4e52_53i11x5-2x188d1x70-1x98u5x5-10x8-5x65-2x1-1x188-1x135-1x75s4x120-2x5-1x2-1x1-1x9'

describe('导入页面', () => {
  it('解析链接并显示主军、援军和英雄配置', () => {
    render(<ImportPage onSaved={vi.fn()} onEditInCalculator={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('配兵链接'), { target: { value: link } })
    fireEvent.click(screen.getByRole('button', { name: '解析链接' }))
    expect(screen.getByText('链接解析成功，已还原完整配置。')).toBeTruthy()
    expect(screen.getAllByText('气球兵').length).toBeGreaterThan(0)
    expect(screen.getByText('弓箭女皇')).toBeTruthy()
    expect(screen.getByText('满足18本导出条件')).toBeTruthy()
    expect((screen.getByRole('button', { name: '复制链接' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('不完整链接允许查看但禁止复制', () => {
    render(<ImportPage onSaved={vi.fn()} onEditInCalculator={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('配兵链接'), { target: { value: 'u1x0s1x0' } })
    fireEvent.click(screen.getByRole('button', { name: '解析链接' }))
    expect((screen.getByRole('button', { name: '复制链接' }) as HTMLButtonElement).disabled).toBe(true)
  })
})
