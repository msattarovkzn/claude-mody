import { expect, test } from 'claude-code/testing'

import { baseName, cells, isPlanPath, parsePlan, planTitle, stepLabel } from './plan'

test('план — только .md прямо в docs/plans, с любыми чертами', async () => {
  expect(isPlanPath('D:\\Claude Code\\docs\\plans\\2026-10-09-сайт-студии-план.md')).toBe(true)
  expect(isPlanPath('D:/Claude Code/docs/plans/x.md')).toBe(true)
  expect(isPlanPath('docs/plans/x.md')).toBe(true)
  // заготовка для зала (claude-start-proekt): планы прямо в plans\ у корня базы
  expect(isPlanPath('D:\\МойБизнес\\plans\\2026-10-28-сайт-план.md')).toBe(true)
  expect(isPlanPath('D:\\МойБизнес\\plansold\\x.md')).toBe(false)
  expect(isPlanPath('D:\\Claude Code\\docs\\specs\\x.md')).toBe(false)
  expect(isPlanPath('D:\\Claude Code\\docs\\plans\\old\\x.md')).toBe(false)
  expect(isPlanPath('D:\\Claude Code\\docs\\plans\\x.txt')).toBe(false)
  expect(isPlanPath(undefined)).toBe(false)
  expect(baseName('D:\\a\\docs\\plans\\x.md')).toBe('x.md')
})

const PLAN = [
  '# Аналитика колл-центра — план наведения порядка',
  '',
  '- [x] Замер звонков',
  '- [x] **1. [Claude] Разобрать 07.10.** Сделано 09.10.2026.',
  '  - [ ] **2. [Марат] Сказать «да» на выкладку.** Ждёт слова',
  '- [ ] **3. [Claude] Слить ветку.**',
  'просто текст - [ ] не галочка',
].join('\n')

test('считает галочки и находит первый незакрытый шаг', async () => {
  const p = parsePlan(PLAN, '2026-10-09-аналитика-колл-центра-план.md')
  expect(p).toEqual({
    title: 'Аналитика колл-центра',
    file: '2026-10-09-аналитика-колл-центра-план.md',
    done: 2,
    total: 4,
    next: '2. [Марат] Сказать «да» на выкладку.',
  })
})

test('план без галочек — не план', async () => {
  expect(parsePlan('# Заметки\nбез галочек', 'x.md')).toBe(null)
})

test('всё сделано — следующего шага нет', async () => {
  const p = parsePlan('- [x] раз\n- [X] два\r\n', 'x.md')
  expect(p?.done).toBe(2)
  expect(p?.next).toBe(null)
})

test('без заголовка название берётся из имени файла', async () => {
  expect(planTitle('- [ ] шаг', '2026-10-08-лендинг-для-яндекс-карт-план.md')).toBe('лендинг для яндекс карт план')
})

test('длинный шаг обрезается, шкала из десяти клеток', async () => {
  expect(stepLabel('а'.repeat(100), 10)).toBe('ааааааааа…')
  expect(cells(2, 4)).toBe('▪▪▪▪▪▫▫▫▫▫')
  expect(cells(0, 0)).toBe('▫▫▫▫▫▫▫▫▫▫')
})
