// Порог вопроса «передать?», в процентах контекста
export type AskAt = number

/** Передача, которая идёт: документ, когда начата, ход, который его пишет */
export type HandoffPending = {
  path: string
  startedAt: number
  writeTurnId: string | null
}

/** Что мод помнит о диалоге в $.store — переживает сон диалога и перезапуск процесса */
export type HandoffSessionMark = {
  askAt: AskAt
  pending: HandoffPending | null
  at: number
}

declare module 'claude-code' {
  interface PluginState {
    handoff: { askAt: AskAt }
  }
}
