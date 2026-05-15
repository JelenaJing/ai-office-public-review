export interface ExperimentPlanReference {
  title: string
  citation: string
  doi: string
  year: number
  abstract?: string
}

export async function generateExperimentPlan(topic: string, paperType: string, language: string): Promise<{ plan: string; references: ExperimentPlanReference[] }> {
  const plan = await window.electronAPI.generateExperimentPlan({ topic, paperType, language })
  return { plan, references: [] }
}