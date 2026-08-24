import { isTauri } from './platform'

const mimeFromPath = (path: string) => {
  const extension = path.split('.').pop()?.toLowerCase()
  if (extension === 'png') return 'image/png'
  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg'
  if (extension === 'webp') return 'image/webp'
  return ''
}

const nameFromPath = (path: string) => path.split(/[\\/]/).pop() || 'dropped-image'

export const fileFromDesktopPath = async (path: string) => {
  const type = mimeFromPath(path)
  if (!type) throw new Error('仅支持 PNG、JPG 或 WebP 图片')
  const { invoke } = await import('@tauri-apps/api/core')
  const bytes = await invoke<ArrayBuffer>('read_image_file', { path })
  return new File([bytes], nameFromPath(path), { type })
}

export const listenForDesktopImageDrop = async (
  onFile: (file: File) => void,
  onError: (message: string) => void,
) => {
  if (!isTauri()) return () => undefined
  const { getCurrentWebview } = await import('@tauri-apps/api/webview')
  return getCurrentWebview().onDragDropEvent(async (event) => {
    if (event.payload.type !== 'drop') return
    const path = event.payload.paths.find((candidate) => mimeFromPath(candidate))
    if (!path) {
      onError('没有收到可读取的图片文件。若图片来自微信，请复制图片后在应用内按 Ctrl+V。')
      return
    }
    try {
      onFile(await fileFromDesktopPath(path))
    } catch (reason) {
      onError(reason instanceof Error ? reason.message : String(reason))
    }
  })
}
