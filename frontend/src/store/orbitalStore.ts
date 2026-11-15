import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { DEFAULT_ORB_CONFIG, orbApi, type OrbCommand, type OrbConfig, type OrbEvent, type OrbPlan, type OrbSummary } from '../api/orbital'
import { ApiError } from '../api/http'
import { orbitalClock } from '../hooks/useOrbitalClock'
import type { OrbData } from '../lib/orbital'

/** Editable setup (persisted across reloads) + the loaded simulation. The core stays the single source of truth for results. */
interface OrbState {
  config: OrbConfig
  simId: string | null
  summary: OrbSummary | null
  data: OrbData | null
  events: OrbEvent[]
  plan: OrbPlan | null
  busy: string | null
  error: string | null
  setConfig: (c: OrbConfig) => void
  patchConfig: (fn: (c: OrbConfig) => OrbConfig) => void
  createFromConfig: (applyPlan?: boolean) => Promise<void>
  load: (id: string) => Promise<void>
  refresh: () => Promise<void>
  run: (body?: Record<string, unknown>) => Promise<void>
  control: (cmd: Record<string, unknown>) => Promise<void>
  resetSim: () => Promise<void>
  makePlan: () => Promise<void>
  clearError: () => void
}

async function fetchAll(id: string, epoch: string, tNow: number) {
  const [traj, tel, ev] = await Promise.all([orbApi.trajectory(id), orbApi.telemetry(id), orbApi.events(id)])
  const eph = await orbApi.ephemerides(epoch, 0, Math.max(tNow, 60), 500)
  return { data: { traj, tel, eph }, events: ev.events }
}

const msg = (e: unknown) => (e instanceof ApiError ? e.describe() : e instanceof Error ? e.message : String(e))

export const useOrbital = create<OrbState>()(
  persist(
    (set, get) => {
      const wrap = async (label: string, fn: () => Promise<void>) => {
        set({ busy: label, error: null })
        try { await fn() } catch (e) { set({ error: msg(e) }) } finally { set({ busy: null }) }
      }
      const apply = async (s: OrbSummary) => {
        const { data, events } = await fetchAll(s.id, s.epoch_iso, s.t_now_s)
        set({ simId: s.id, summary: s, data, events })
        orbitalClock.setLimit(s.t_now_s)
      }
      return {
        config: DEFAULT_ORB_CONFIG, simId: null, summary: null, data: null, events: [], plan: null, busy: null, error: null,
        setConfig: (c) => set({ config: c }),
        patchConfig: (fn) => set((s) => ({ config: fn(s.config) })),
        clearError: () => set({ error: null }),
        createFromConfig: (applyPlan = false) => wrap('Создание симуляции…', async () => {
          const created = await orbApi.create(get().config, applyPlan)
          set({ plan: created.plan ?? null })
          const s = await orbApi.run(created.id, {})
          await apply(s)
          orbitalClock.reset()
        }),
        load: (id) => wrap('Загрузка…', async () => { const s = await orbApi.get(id); set({ config: s.config }); await apply(s); orbitalClock.reset() }),
        refresh: () => wrap('Обновление…', async () => { const id = get().simId; if (id) await apply(await orbApi.get(id)) }),
        run: (body = {}) => wrap('Расчёт траектории…', async () => { const id = get().simId; if (id) await apply(await orbApi.run(id, body)) }),
        control: (cmd) => wrap('Применение управления…', async () => {
          const id = get().simId; if (!id) return
          const keep = orbitalClock.getSnapshot().t
          await apply(await orbApi.control(id, cmd))
          orbitalClock.seek(keep)
        }),
        resetSim: () => wrap('Сброс…', async () => { const id = get().simId; if (id) { await apply(await orbApi.reset(id)); orbitalClock.reset() } }),
        makePlan: () => wrap('Планирование (численная оптимизация)…', async () => { set({ plan: await orbApi.plan(get().config) }) }),
      }
    },
    { name: 'geomoon.orbital.v1', version: 1, partialize: (s) => ({ config: s.config, simId: s.simId }) },
  ),
)

export type { OrbCommand }
