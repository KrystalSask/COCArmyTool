import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { CalculatorPage } from './CalculatorPage'

vi.mock('../storage/armyDatabase', () => ({ saveArmyRecord: vi.fn() }))

describe('配兵计算器', () => {
  it('初始禁止导出，载入完整示例后解锁', () => {
    render(<CalculatorPage onSaved={vi.fn()} />)
    const exportButton = screen.getByRole('button', { name: '复制国服链接' })
    expect((exportButton as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: '载入完整示例' }))
    expect((exportButton as HTMLButtonElement).disabled).toBe(false)
    expect(screen.getByText('配置完整，可以导出')).toBeTruthy()
  })
})
