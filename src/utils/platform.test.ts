import { afterEach, describe, expect, it } from 'vitest'
import { isTauri } from './platform'

describe('运行平台检测', () => {
  afterEach(() => { delete window.__TAURI_INTERNALS__ })
  it('普通浏览器不识别为 Tauri', () => expect(isTauri()).toBe(false))
  it('存在 Tauri 内部标记时识别为桌面应用', () => { window.__TAURI_INTERNALS__ = {}; expect(isTauri()).toBe(true) })
})
