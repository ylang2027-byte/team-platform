// 업로드 이미지를 정사각형으로 크롭 + 축소해서 작은 data URL 로 변환.
// Supabase Storage 없이 profiles.avatar_url 텍스트 칸에 그대로 저장하려는 용도 (팀 5명 규모라 충분).
export function fileToAvatarDataUrl(file, size = 256) {
  return new Promise((resolve, reject) => {
    if (!file) return reject(new Error('파일이 없어요.'))
    if (!file.type.startsWith('image/')) return reject(new Error('이미지 파일만 올릴 수 있어요.'))
    if (file.size > 12 * 1024 * 1024) return reject(new Error('파일이 너무 커요 (12MB 이하).'))

    const reader = new FileReader()
    reader.onerror = () => reject(new Error('파일을 읽지 못했어요.'))
    reader.onload = () => {
      const img = new Image()
      img.onerror = () => reject(new Error('이미지를 불러오지 못했어요.'))
      img.onload = () => {
        const s = Math.min(img.width, img.height)
        const sx = (img.width - s) / 2
        const sy = (img.height - s) / 2
        const canvas = document.createElement('canvas')
        canvas.width = size
        canvas.height = size
        const ctx = canvas.getContext('2d')
        ctx.drawImage(img, sx, sy, s, s, 0, 0, size, size)
        resolve(canvas.toDataURL('image/jpeg', 0.82))
      }
      img.src = reader.result
    }
    reader.readAsDataURL(file)
  })
}
