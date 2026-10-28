import { atom, read, update } from 'claude-code'
import type { Hook, Register } from 'claude-code'

import type { HandoffPending, HandoffSessionMark } from '../types'

// Копия мода Никиты Велса (handoff 1.1.0) на полке Марата: порог 50% вместо 60% (Марат, 11.10.2026).
// На 50% контекста — вопрос «передать работу в чистый контекст?»; «Передать» — Claude пишет документ передачи
// по пути, который назначил мод, мод ждёт конца хода, делает /clear и отправляет «Прочитай <путь> и продолжай
// работу» — работа идёт дальше в чистом контексте, в том же окне. «Не сейчас» — спросит снова на +10%.
// /handoff-now — то же без ожидания 50%.
const ASK_FROM = 50
const askAt = atom({ plugin: 'handoff', key: 'askAt' } as const, ASK_FROM)
// Документ ждём по времени, а не по числу ходов: свои сообщения пользователя передачу не отменяют
const WAIT_MS = 15 * 60_000
const MARK_TTL = 30 * 24 * 60 * 60_000
const K_SESSION = 's:'

type Dollar = Parameters<Hook<'session.start'>>[0]

// Приложение Claude усыпляет простаивающие диалоги и будит их новым процессом: модульные переменные
// при этом пропадают, поэтому порог «Не сейчас» и начатая передача лежат в $.store под id диалога
let cliId = ''
let isAsking = false
let pending: HandoffPending | null = null
// Вопрос снова разрешён, только когда замер покажет контекст ниже порога: замер в конце хода передачи
// и первые замеры после /clear ещё несут старый процент — без этого вопрос всплывал в чистой сессии
let isArmed = true

async function saveMark($: Dollar): Promise<void> {
  if (!cliId) return
  const mark: HandoffSessionMark = { askAt: await read($, askAt), pending, at: await $.clock.now() }
  await $.store.set(K_SESSION + cliId, mark)
}

async function setAskAt($: Dollar, value: number): Promise<void> {
  await update($, askAt, () => value)
  await saveMark($)
}

async function pruneMarks($: Dollar, now: number): Promise<void> {
  for (const key of await $.store.keys()) {
    if (!key.startsWith(K_SESSION)) continue
    const mark = (await $.store.get(key)) as HandoffSessionMark | undefined
    if (!mark || now - (mark.at ?? 0) > MARK_TTL) await $.store.delete(key)
  }
}

// Куда Claude запишет документ: ~/.claude/handoffs/, вне проекта
async function handoffPath($: Dollar): Promise<string> {
  const home = (await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE')) ?? '.'
  const d = new Date(await $.clock.now())
  const p2 = (n: number) => String(n).padStart(2, '0')
  const stamp = `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}`
  return `${home.replace(/\\/g, '/')}/.claude/handoffs/handoff-${stamp}.md`
}

// Шаг 1: Claude пишет документ передачи; шаг 2 — в turn.complete
async function startHandoff($: Dollar): Promise<void> {
  if (pending) return
  isArmed = false
  const path = await handoffPath($)
  pending = { path, startedAt: await $.clock.now(), writeTurnId: null }
  await saveMark($)
  // Если ход записи не узнали по тексту, отмена по времени не должна ждать следующего хода
  void $.clock.after(WAIT_MS + 1000, () => void checkPending($, null))
  await $.command.run({ command: 'handoff:write', args: `Сохрани документ в файл ${path}` })
}

async function cancelHandoff($: Dollar, why: string): Promise<void> {
  const p = pending
  pending = null
  isArmed = true
  await saveMark($)
  if (p) $.ui.toast(`${why} (${p.path}) — передача отменена`)
}

// Документ записан в этой передаче — не старый файл с тем же именем и не до её начала
async function isWritten($: Dollar, p: HandoffPending): Promise<boolean> {
  const stat = await $.fs.stat(p.path).catch(() => undefined)
  return stat !== undefined && stat.mtimeMs >= p.startedAt - 2000
}

// Шаг 2: документ записан — чистый контекст и продолжение работы по документу
async function continueFresh($: Dollar, path: string): Promise<void> {
  pending = null
  await saveMark($)
  try {
    await $.command.run({ command: 'clear' })
    // После /clear у диалога может смениться id: порог чистого контекста — с нуля
    cliId = await $.session.id()
    await setAskAt($, ASK_FROM)
    await $.prompt.submit({ text: `Прочитай ${path} и продолжай работу` })
  } catch (err: any) {
    $.ui.toast(`Передача не дошла до конца: ${String(err?.message ?? err).slice(0, 80)}. Документ — ${path}`)
  }
}

async function offerHandoff($: Dollar, ctx: number): Promise<void> {
  if (isAsking || pending || !isArmed) return
  // Диалог, который никто не видит (фоновая сессия потока): вопрос повис бы навсегда и больше не задавался
  if ((await $.session.surfaces()).length === 0) return
  isAsking = true
  try {
    const answer = await $.ui.ask(`Контекст ${Math.round(ctx)}%. Передать работу в чистый контекст?`, {
      header: 'Контекст',
      options: ['Передать', 'Не сейчас'],
    })
    if (answer === 'Передать') await startHandoff($)
    else await setAskAt($, Math.round(ctx) + 10)
  } catch {
    await setAskAt($, Math.round(ctx) + 10)
  } finally {
    isAsking = false
  }
}

// Документ появился — продолжаем; ход записи кончился без документа или вышло время — отменяем
async function checkPending($: Dollar, endedTurnId: string | null): Promise<void> {
  const p = pending
  if (!p) return
  if (await isWritten($, p)) {
    void continueFresh($, p.path)
    return
  }
  if (endedTurnId && p.writeTurnId === endedTurnId) {
    await cancelHandoff($, 'Документ передачи не записан')
  } else if ((await $.clock.now()) - p.startedAt > WAIT_MS) {
    await cancelHandoff($, 'Документ передачи не дождались')
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    if (e.isInteractive) {
      await $.command.register({ name: 'handoff-now', description: 'Передать работу в чистый контекст сейчас' })
    }

    cliId = await $.session.id()
    const now = await $.clock.now()
    const mark = (await $.store.get(K_SESSION + cliId)) as HandoffSessionMark | undefined
    if (mark) {
      if (typeof mark.askAt === 'number') await update($, askAt, () => mark.askAt)
      pending = mark.pending ?? null
      if (pending) isArmed = false
    }
    void pruneMarks($, now)

    // Процесс перезапустился посреди передачи: документ мог успеть записаться
    if (pending) void $.clock.after(2_000, () => void checkPending($, null))
    return next(e)
  })

  on('command.run', { command: 'handoff-now' }, async ($, e, next) => {
    if (pending) return { text: `Передача уже идёт: ${pending.path}` }
    void startHandoff($)
    return { text: 'Claude пишет документ передачи; после — чистый контекст и продолжение' }
  })

  // Ход, который пишет документ, узнаём по пути в тексте команды передачи
  on('turn.start', async ($, e, next) => {
    if (pending && !pending.writeTurnId && e.text.includes(pending.path)) {
      pending = { ...pending, writeTurnId: e.turnId }
      await saveMark($)
    }
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    // Ход, начатый до «Передать», заканчивается без документа: команда передачи ждёт в очереди — ждём её хода
    if (!e.agentId) await checkPending($, e.turnId)
    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    const ctx = e.context?.percent ?? 0
    const at = await read($, askAt)
    if (ctx < at && !pending) isArmed = true
    if (ctx >= at) void offerHandoff($, ctx)
    return next(e)
  })
}
