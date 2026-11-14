import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { AnalysisParams, AnalysisResult, SimResults, Simulation, TerrainWindow } from '../api/types'
import { DEFAULT_ANALYSIS_PARAMS, DEFAULT_SCENARIO_FORM, DEFAULT_SPACECRAFT_FORM, type ScenarioForm, type SpacecraftForm } from '../lib/payload'

/** Persisted user inputs (survive reloads). Results are NOT persisted: they live on the core / in saved missions. */
interface Inputs {
  target: { lat: number; lon: number }
  targetName: string | null
  analysisRadius_m: number
  datasetId: string | null
  allowSynthetic: boolean
  params: AnalysisParams
  spacecraftForm: SpacecraftForm
  scenario: ScenarioForm
  spacecraftId: number | null
  regionId: number | null
  setTarget: (lat: number, lon: number, name?: string | null) => void
  setAnalysisRadius: (r: number) => void
  setDatasetId: (id: string | null) => void
  setAllowSynthetic: (v: boolean) => void
  setParams: (p: AnalysisParams) => void
  setSpacecraftForm: (f: SpacecraftForm) => void
  setScenario: (s: ScenarioForm) => void
  setSpacecraftId: (id: number | null) => void
  setRegionId: (id: number | null) => void
}

// Initial target is a neutral (0, 0) placeholder the user is expected to change — it implies no scientific meaning.
export const useInputs = create<Inputs>()(
  persist(
    (set) => ({
      target: { lat: 0, lon: 0 }, targetName: null, analysisRadius_m: 1000, datasetId: null, allowSynthetic: false,
      params: DEFAULT_ANALYSIS_PARAMS, spacecraftForm: DEFAULT_SPACECRAFT_FORM, scenario: DEFAULT_SCENARIO_FORM,
      spacecraftId: null, regionId: null,
      setTarget: (lat, lon, name = null) => set({ target: { lat, lon }, targetName: name }),
      setAnalysisRadius: (r) => set({ analysisRadius_m: r }),
      setDatasetId: (id) => set({ datasetId: id }),
      setAllowSynthetic: (v) => set({ allowSynthetic: v }),
      setParams: (p) => set({ params: p }),
      setSpacecraftForm: (f) => set({ spacecraftForm: f }),
      setScenario: (s) => set({ scenario: s }),
      setSpacecraftId: (id) => set({ spacecraftId: id }),
      setRegionId: (id) => set({ regionId: id }),
    }),
    { name: 'geomoon.inputs.v1', version: 1 },
  ),
)

/** Session (non-persisted) results. */
interface Session {
  analysis: AnalysisResult | null
  analysisKey: string | null
  terrainWindow: TerrainWindow | null
  simulation: Simulation | null
  results: SimResults | null
  setAnalysis: (a: AnalysisResult | null, key?: string | null) => void
  setTerrainWindow: (w: TerrainWindow | null) => void
  setSimulation: (s: Simulation | null) => void
  setResults: (r: SimResults | null) => void
}
export const useSession = create<Session>()((set) => ({
  analysis: null, analysisKey: null, terrainWindow: null, simulation: null, results: null,
  setAnalysis: (analysis, analysisKey = null) => set({ analysis, analysisKey }),
  setTerrainWindow: (terrainWindow) => set({ terrainWindow }),
  setSimulation: (simulation) => set({ simulation }),
  setResults: (results) => set({ results }),
}))
