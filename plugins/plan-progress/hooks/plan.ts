import type { PlanView } from '../types'

// Галочка плана: «- [ ] …», «- [x] …», «* [X] …», с отступом или без
const BOX = /^\s*[-*]\s+\[([ xX])\]\s*(.*)$/

// Подпись шага: жирное начало «**1. [Claude] Разобрать 07.10.**», иначе начало строки
export function stepLabel(text: string, room = 70): string {
  const bold = text.match(/^\*\*(.+?)\*\*/)
  const raw = (bold ? bold[1] : text).replace(/\*\*/g, '').replace(/`/g, '').trim()
  return raw.length <= room ? raw : `${raw.slice(0, room - 1)}…`
}

// Заголовок плана: первая строка «# …» без хвоста « — план …»; нет — имя файла без даты
export function planTitle(text: string, fileName: string): string {
  const head = text.split(/\r?\n/).find(l => /^#\s+/.test(l))
  if (head) return head.replace(/^#\s+/, '').split(' — ')[0].trim()
  return fileName.replace(/\.md$/i, '').replace(/^\d{4}-\d{2}-\d{2}-/, '').replace(/-/g, ' ')
}

// Галочки одного плана; null — в файле нет ни одной галочки
export function parsePlan(text: string, fileName: string): PlanView | null {
  let done = 0
  let total = 0
  let next: string | null = null
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(BOX)
    if (!m) continue
    total++
    if (m[1] === ' ') {
      if (next === null) next = stepLabel(m[2])
    } else done++
  }
  if (total === 0) return null
  return { title: planTitle(text, fileName), file: fileName, done, total, next }
}

// Файл плана: …/docs/plans/<имя>.md или …/plans/<имя>.md (заготовка для зала), с любыми чертами в пути
export function isPlanPath(path: unknown): path is string {
  return typeof path === 'string' && /(^|[\\/])plans[\\/][^\\/]+\.md$/i.test(path)
}

// Имя файла из пути
export function baseName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path
}

// Шкала из клеток ▪▫, как у Шкалы (ctx)
export function cells(done: number, total: number, n = 10): string {
  const full = total > 0 ? Math.round((done / total) * n) : 0
  return '▪'.repeat(full) + '▫'.repeat(n - full)
}
