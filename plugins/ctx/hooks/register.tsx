import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Gauge } from '../types'

// Шкалы под полем ввода: контекст (подпись — имя мода «ctx»), 5H — лимит пяти часов, 7D — недели,
// ◷ — минут до остывания кэша. Десктоп под вводом рисует только строку статуса — туда шкалы текстом;
// терминал рисует строку подсказки — туда шкалы цветом. Передача в чистый контекст — отдельный мод handoff.
const gauge = atom({ plugin: 'ctx', key: 'gauge' } as const, { ctx: null, h5: null, d7: null, cacheMin: null })
const lastTurnAt = atom({ plugin: 'ctx', key: 'lastTurnAt' } as const, 0)
const isTerminal = atom({ plugin: 'ctx', key: 'isTerminal' } as const, false)

const CACHE_TTL_MIN = 60 // кэш промптов на подписке живёт час с последнего запроса (у API бывает 5 мин)
const CELLS = 8

let timer: (() => void) | undefined

function cells(p: number, n = CELLS): string {
  const full = Math.max(0, Math.min(n, Math.round((p / 100) * n)))
  return '▪'.repeat(full) + '▫'.repeat(n - full) // ▪ и ▫ — малые квадраты одной пары, одного размера
}

function line(g: Gauge): string {
  const parts: string[] = []
  if (g.ctx !== null) parts.push(`${cells(g.ctx)} ${Math.round(g.ctx)}%`)
  if (g.h5 !== null) parts.push(`5H ${cells(g.h5)} ${Math.round(g.h5)}%`)
  if (g.d7 !== null) parts.push(`7D ${cells(g.d7)} ${Math.round(g.d7)}%`)
  if (g.cacheMin !== null) parts.push(`◷ ${g.cacheMin}м`)
  return parts.join('\u2003\u2003') // em-пробелы: обычные десктоп схлопывает в один
}

async function measure($: any) {
  try {
    const u = await $.session.usage()
    const limits: any[] = u.rateLimits ?? []
    const h5 = limits.find(l => l.kind === 'five_hour')?.percentUsed ?? null
    const d7 = limits.find(l => l.kind === 'seven_day')?.percentUsed ?? null
    const last = await read($, lastTurnAt)
    const cacheMin = last > 0 ? Math.max(0, Math.round(CACHE_TTL_MIN - ((await $.clock.now()) - last) / 60000)) : null
    const g: Gauge = { ctx: u.context?.percent ?? null, h5, d7, cacheMin }
    await update($, gauge, () => g)
    $.ui.status((await read($, isTerminal)) ? undefined : line(g) || undefined)
  } catch (err: any) {
    $.ui.status(`ошибка замера: ${String(err?.message ?? err).slice(0, 80)}`)
  }
}

function color(p: number, warn: number, danger: number): string {
  return p >= danger ? 'red' : p >= warn ? 'yellow' : 'green'
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    if (!timer) timer = $.clock.every(30000, () => void measure($))
    void measure($)
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    await update($, lastTurnAt, async () => await $.clock.now())
    void measure($)
    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    void measure($)
    return next(e)
  })

  // Терминал: цветные шкалы в строке подсказки под вводом; пока человек печатает — подсказка движка
  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    if (e.surface !== 'terminal') return next(e)
    if (!(await read($, isTerminal))) {
      await update($, isTerminal, () => true)
      $.ui.status(undefined)
    }
    if (e.props.isDraft) return next(e)
    const g = await read($, gauge)
    if (g.ctx === null && g.h5 === null && g.d7 === null) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    // Узкий терминал: шкалы короче, на совсем узком — только числа; строка переносится, а не режется
    const cols = e.viewport?.columns ?? 120
    const n = cols >= 90 ? CELLS : cols >= 60 ? 4 : 0
    const meter = (label: string, p: number | null, warn: number, danger: number) =>
      p === null ? null : (
        <Box marginRight={2}>
          <Text dimColor>{label} </Text>
          {n > 0 && <Text color={color(p, warn, danger)}>{cells(p, n)}</Text>}
          <Text dimColor={n > 0} color={n > 0 ? undefined : color(p, warn, danger)}> {Math.round(p)}%</Text>
        </Box>
      )
    return (
      <Box flexWrap="wrap">
        {meter('CTX', g.ctx, 45, 60)}
        {meter('5H', g.h5, 70, 90)}
        {meter('7D', g.d7, 70, 90)}
        {g.cacheMin !== null && (
          <Text color={g.cacheMin <= 5 ? 'red' : g.cacheMin <= 15 ? 'yellow' : undefined} dimColor={g.cacheMin > 15}>
            ◷ {g.cacheMin}м
          </Text>
        )}
      </Box>
    )
  })
}
