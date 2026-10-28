export type PlanView = { title: string; file: string; done: number; total: number; next: string | null }

declare module 'claude-code' {
  interface PluginState {
    'plan-progress': { plan: PlanView | null; planPath: string | null; isHidden: boolean }
  }
}
