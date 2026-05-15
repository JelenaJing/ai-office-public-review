export interface PlotAgentStatus {
  ready: boolean
  running: boolean
  baseUrl: string
  port: number
  pythonCommand: string | null
  agentRoot: string | null
  lastError?: string | null
}

export interface PlotChartTypeInfo {
  chart_type: string
  name: string
  description: string
  required_columns: Record<string, unknown>
}

export interface PlotChartTypesResponse {
  chart_types: PlotChartTypeInfo[]
  count: number
}

export interface PlotRecommendationItem {
  chart_type: string
  confidence: number
  reasoning: string
  suggested_parameters: Record<string, unknown>
}

export interface PlotDataAnalysis {
  columns?: string[]
  numeric_columns?: string[]
  categorical_columns?: string[]
  datetime_columns?: string[]
  n_rows?: number
  n_columns?: number
  data_characteristics?: string[]
  dtypes?: Record<string, string>
}

export interface PlotRecommendationResponse {
  recommended_chart: string
  confidence: number
  reasoning: string
  alternative_charts: string[]
  suggested_parameters: Record<string, unknown>
  recommendations?: PlotRecommendationItem[]
  data_analysis?: PlotDataAnalysis
}

export interface PlotGenerateResponse {
  success: boolean
  chart_type: string
  image?: string
  file_path?: string
  message: string
  recommendation?: PlotRecommendationResponse
}

export interface RealtimePlotSessionStatus {
  session_id: string
  chart_type: string
  point_count: number
  x_col?: string | null
  y_col?: string | null
  created_at: string
  last_updated: string
}

export interface RealtimePlotSessionResponse {
  success: boolean
  session_id: string
  status: RealtimePlotSessionStatus
}

export interface RealtimePlotUpdateResponse {
  success: boolean
  image?: string
  points_added?: number
  status: RealtimePlotSessionStatus
}

export async function getPlotAgentStatus(): Promise<PlotAgentStatus> {
  return window.electronAPI.getPlotAgentStatus() as Promise<PlotAgentStatus>
}

export async function getPlotChartTypes(): Promise<PlotChartTypesResponse> {
  return window.electronAPI.getPlotChartTypes() as unknown as Promise<PlotChartTypesResponse>
}

export async function recommendPlotFromFile(filePath: string, useLlm = false): Promise<PlotRecommendationResponse> {
  return window.electronAPI.recommendPlot({ filePath, useLlm }) as unknown as Promise<PlotRecommendationResponse>
}

export async function generatePlotFromFile(
  filePath: string,
  chartType: string,
  options?: {
    mode?: 'smart' | 'manual'
    x?: string
    y?: string
    hue?: string
    title?: string
    xlabel?: string
    ylabel?: string
    style?: 'publication' | 'default' | 'colorful'
  },
): Promise<PlotGenerateResponse> {
  return window.electronAPI.generatePlot({
    filePath,
    chartType,
    outputFormat: 'base64',
    style: options?.style || 'publication',
    autoRecommend: false,
    mode: options?.mode || 'smart',
    x: options?.x,
    y: options?.y,
    hue: options?.hue,
    title: options?.title,
    xlabel: options?.xlabel,
    ylabel: options?.ylabel,
  }) as unknown as Promise<PlotGenerateResponse>
}

export async function createRealtimePlotSession(params: {
  chartType: string
  style?: 'publication' | 'default' | 'colorful'
  title?: string
  xlabel?: string
  ylabel?: string
}): Promise<RealtimePlotSessionResponse> {
  return window.electronAPI.createRealtimePlotSession(params) as unknown as Promise<RealtimePlotSessionResponse>
}

export async function addRealtimePlotPoint(sessionId: string, point: Record<string, unknown>): Promise<RealtimePlotUpdateResponse> {
  return window.electronAPI.addRealtimePlotPoint({ sessionId, point }) as unknown as Promise<RealtimePlotUpdateResponse>
}

export async function addRealtimePlotBatch(sessionId: string, points: Array<Record<string, unknown>>): Promise<RealtimePlotUpdateResponse> {
  return window.electronAPI.addRealtimePlotBatch({ sessionId, points }) as unknown as Promise<RealtimePlotUpdateResponse>
}

export async function getRealtimePlot(sessionId: string): Promise<RealtimePlotUpdateResponse> {
  return window.electronAPI.getRealtimePlot(sessionId) as unknown as Promise<RealtimePlotUpdateResponse>
}

export async function getRealtimePlotStatus(sessionId: string): Promise<{ success: boolean; status: RealtimePlotSessionStatus }> {
  return window.electronAPI.getRealtimePlotStatus(sessionId) as Promise<{ success: boolean; status: RealtimePlotSessionStatus }>
}

export async function deleteRealtimePlotSession(sessionId: string): Promise<{ success: boolean; message: string }> {
  return window.electronAPI.deleteRealtimePlotSession(sessionId) as Promise<{ success: boolean; message: string }>
}

export interface PlotDataModelOption {
  id: string
  label: string
  description: string
}

export async function listPlotDataModels(): Promise<PlotDataModelOption[]> {
  try {
    return (await window.electronAPI.excelListDataModels()) as PlotDataModelOption[]
  } catch {
    return []
  }
}