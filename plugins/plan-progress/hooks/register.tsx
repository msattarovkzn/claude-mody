import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { PlanView } from '../types'
import { baseName, cells, isPlanPath, parsePlan } from './plan'

// Прогресс по плану: над полем ввода — план, который этот разговор открывал или правил (docs/plans/*.md):
// сколько шагов сделано и какой следующий. Разговор планов не касался — полоски нет.
// Ничего не пишет, только читает. /plan — спрятать или показать полоску.
const plan = atom({ plugin: 'plan-progress', key: 'plan' } as const, null)
const planPath = atom({ plugin: 'plan-progress', key: 'planPath' } as const, null)
const isHidden = atom({ plugin: 'plan-progress', key: 'isHidden' } as const, false)

const FILE_TOOLS = ['Read', 'Edit', 'Write', 'MultiEdit']
const EVERY_MS = 60_000

let timer: unknown

async function refresh($: any): Promise<void> {
  try {
    const path = await read($, planPath)
    let p: PlanView | null = null
    if (path) {
      const text = await $.fs.read(path).catch(() => null)
      p = text === null ? null : parsePlan(String(text), baseName(path))
    }
    const cur = await read($, plan)
    if (JSON.stringify(cur) !== JSON.stringify(p)) await update($, plan, () => p)
  } catch {
    // файл недоступен — полоску просто не показываем
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    if (e.isInteractive) await $.command.register({ name: 'plan', description: 'Спрятать или показать прогресс по плану' })
    if (!timer) timer = $.clock.every(EVERY_MS, () => void refresh($))
    void refresh($)
    return next(e)
  })

  // Разговор открыл или поправил файл плана — с этого момента полоска про него
  on('tool.call', async ($, e, next) => {
    const result = await next(e)
    const path = (e as any).file_path
    if (FILE_TOOLS.includes(e.tool) && isPlanPath(path)) {
      if ((await read($, planPath)) !== path) await update($, planPath, () => path)
      await refresh($)
    }
    return result
  })

  on('turn.complete', async ($, e, next) => {
    void refresh($)
    return next(e)
  })

  on('command.run', { command: 'plan' }, async $ => {
    const hidden = !(await read($, isHidden))
    await update($, isHidden, () => hidden)
    if (!hidden) await refresh($)
    return { text: hidden ? 'Прогресс по плану спрятан. Показать снова: /plan' : 'Прогресс по плану снова виден.' }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const p = await read($, plan)
    if (p === null || (await read($, isHidden)) || (e.props as any).hasSurvey) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box flexWrap="wrap">
        <Text bold>План: </Text>
        <Text wrap="truncate-end">{p.title}  </Text>
        <Text color="green">{cells(p.done, p.total)}</Text>
        <Text dimColor> {p.done}/{p.total}</Text>
        {p.next !== null ? (
          <Text dimColor wrap="truncate-end">  · дальше: {p.next}</Text>
        ) : (
          <Text color="green">  · всё сделано</Text>
        )}
      </Box>
    )
  })
}
