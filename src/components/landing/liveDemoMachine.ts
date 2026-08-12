export const DEMO_STAGES = ['ready', 'listening', 'invoice', 'share'] as const

export type DemoStage = (typeof DEMO_STAGES)[number]

export function nextDemoStage(stage: DemoStage): DemoStage {
  return DEMO_STAGES[(DEMO_STAGES.indexOf(stage) + 1) % DEMO_STAGES.length]
}

export function initialDemoStage(reducedMotion: boolean): DemoStage {
  return reducedMotion ? 'share' : 'ready'
}
