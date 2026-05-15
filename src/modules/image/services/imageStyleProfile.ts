import type { ImageReferenceItem, ImageStyleProfile, ImageStyleProfileMetrics } from '../../../types/imageGeneration'

const SAMPLE_SIZE = 56

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function toHex(value: number): string {
  return Math.round(clamp(value, 0, 255)).toString(16).padStart(2, '0')
}

function rgbToHex(red: number, green: number, blue: number): string {
  return `#${toHex(red)}${toHex(green)}${toHex(blue)}`
}

function rgbToHsl(red: number, green: number, blue: number): { h: number; s: number; l: number } {
  const r = red / 255
  const g = green / 255
  const b = blue / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const delta = max - min
  let h = 0
  const l = (max + min) / 2
  const s = delta === 0 ? 0 : delta / (1 - Math.abs(2 * l - 1))

  if (delta !== 0) {
    if (max === r) h = ((g - b) / delta) % 6
    else if (max === g) h = (b - r) / delta + 2
    else h = (r - g) / delta + 4
  }

  h = Math.round(h * 60)
  if (h < 0) h += 360
  return { h, s, l }
}

function inferOrientation(width: number, height: number): ImageStyleProfileMetrics['orientation'] {
  const ratio = width / Math.max(height, 1)
  if (ratio > 1.18) return 'landscape'
  if (ratio < 0.84) return 'portrait'
  return 'square'
}

function loadImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.crossOrigin = 'anonymous'
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('参考图加载失败，无法解析风格特征。'))
    image.src = source
  })
}

function quantizeColor(red: number, green: number, blue: number): string {
  const q = (value: number) => Math.round(value / 32) * 32
  return rgbToHex(q(red), q(green), q(blue))
}

function inferPaletteLabels(colors: string[]): string[] {
  return colors.slice(0, 5)
}

function inferLighting(metrics: ImageStyleProfileMetrics): string {
  if (metrics.brightness >= 0.7 && metrics.contrast < 0.2) return 'bright and softly diffused'
  if (metrics.brightness < 0.38 && metrics.contrast >= 0.22) return 'low-key and dramatic'
  if (metrics.contrast >= 0.28) return 'high-contrast with pronounced highlights and shadows'
  return 'balanced and evenly lit'
}

function inferLinework(metrics: ImageStyleProfileMetrics): string {
  if (metrics.edgeDensity >= 0.18 && metrics.colorDiversity < 0.42) return 'clean, crisp contour lines'
  if (metrics.edgeDensity >= 0.2) return 'fine detailed edges with strong contour separation'
  if (metrics.edgeDensity <= 0.08) return 'soft edges with minimal line emphasis'
  return 'moderate edge definition with controlled line presence'
}

function inferTexture(metrics: ImageStyleProfileMetrics): string {
  if (metrics.colorDiversity < 0.26 && metrics.edgeDensity < 0.1) return 'smooth flat surfaces with little visible grain'
  if (metrics.colorDiversity >= 0.5 && metrics.edgeDensity < 0.14) return 'painterly surface transitions with soft variation'
  if (metrics.edgeDensity >= 0.2 && metrics.contrast >= 0.24) return 'crisp rendered surfaces with visible detail contrast'
  return 'light material variation with controlled texture noise'
}

function inferComposition(metrics: ImageStyleProfileMetrics): string {
  const orientationLabel = metrics.orientation === 'landscape'
    ? 'horizontal'
    : metrics.orientation === 'portrait'
      ? 'vertical'
      : 'balanced square'
  if (metrics.edgeDensity < 0.1) return `${orientationLabel} composition with open spacing and restrained visual density`
  if (metrics.edgeDensity > 0.2) return `${orientationLabel} composition with dense focal structure and stronger visual anchors`
  return `${orientationLabel} composition with balanced focal rhythm`
}

function inferMood(metrics: ImageStyleProfileMetrics): string {
  if (metrics.brightness >= 0.68 && metrics.saturation <= 0.28) return 'calm, airy, and restrained'
  if (metrics.saturation >= 0.5 && metrics.contrast >= 0.22) return 'bold, energetic, and highly expressive'
  if (metrics.brightness < 0.42) return 'moody, serious, and atmospheric'
  return 'clear, composed, and professional'
}

function inferMedium(metrics: ImageStyleProfileMetrics, hintText: string): string {
  const hint = hintText.toLowerCase()
  if (/(watercolor|水彩)/i.test(hint)) return 'watercolor illustration'
  if (/(oil|oil painting|油画)/i.test(hint)) return 'oil painting'
  if (/(comic|manga|anime|漫画|动漫)/i.test(hint)) return 'comic illustration'
  if (/(3d|render|octane|cgi|三维|渲染)/i.test(hint)) return '3D render'
  if (/(photo|photography|摄影|照片)/i.test(hint)) return 'photographic composition'
  if (/(vector|flat|illustration|插画|扁平)/i.test(hint)) return 'flat editorial illustration'

  if (metrics.edgeDensity < 0.09 && metrics.saturation < 0.24) return 'watercolor-style painting'
  if (metrics.edgeDensity < 0.12 && metrics.colorDiversity < 0.3) return 'flat editorial illustration'
  if (metrics.edgeDensity >= 0.18 && metrics.contrast >= 0.24 && metrics.saturation >= 0.32) return '3D render'
  if (metrics.edgeDensity >= 0.18 && metrics.colorDiversity >= 0.4) return 'photographic illustration'
  return 'stylized illustration'
}

function inferForbidden(medium: string): string[] {
  const normalized = medium.toLowerCase()
  if (/(flat|editorial|illustration)/i.test(normalized)) {
    return ['photorealistic studio photography', 'octane 3D render', 'hyper-real material realism', 'heavy cinematic color grading']
  }
  if (/(watercolor|oil|painting)/i.test(normalized)) {
    return ['hard vector iconography', 'clinical photorealism', 'plastic 3D shading']
  }
  if (/(comic)/i.test(normalized)) {
    return ['photographic realism', 'oil painting impasto', 'ultra realistic cinematic rendering']
  }
  if (/(3d)/i.test(normalized)) {
    return ['flat vector illustration', 'paper-cut collage', 'watercolor wash texture']
  }
  if (/(photo)/i.test(normalized)) {
    return ['flat editorial illustration', 'comic cel shading', 'brush-heavy painterly abstraction']
  }
  return ['visual styles that contradict the primary reference medium']
}

function summarizeProfile(profile: Omit<ImageStyleProfile, 'summary'>): string {
  return `${profile.medium}; palette ${profile.palette.join(', ')}; ${profile.lighting}; ${profile.linework}; ${profile.texture}; ${profile.composition}; mood ${profile.mood}`
}

function analyzeImageMetrics(imageData: ImageData, width: number, height: number): { metrics: ImageStyleProfileMetrics; palette: string[] } {
  const pixels = imageData.data
  const paletteCounter = new Map<string, number>()
  let luminanceSum = 0
  let luminanceSquaredSum = 0
  let saturationSum = 0
  let edgeAccumulator = 0
  let warmPixels = 0
  let coolPixels = 0
  const pixelCount = width * height

  const luminanceMap = new Array<number>(pixelCount).fill(0)

  for (let index = 0; index < pixelCount; index += 1) {
    const offset = index * 4
    const red = pixels[offset]
    const green = pixels[offset + 1]
    const blue = pixels[offset + 2]
    const alpha = pixels[offset + 3] / 255
    if (alpha < 0.05) continue

    const { h, s, l } = rgbToHsl(red, green, blue)
    luminanceMap[index] = l
    luminanceSum += l
    luminanceSquaredSum += l * l
    saturationSum += s
    if (h <= 55 || h >= 320) warmPixels += 1
    if (h >= 160 && h <= 260) coolPixels += 1

    const bucket = quantizeColor(red, green, blue)
    paletteCounter.set(bucket, (paletteCounter.get(bucket) || 0) + 1)
  }

  for (let y = 0; y < height - 1; y += 1) {
    for (let x = 0; x < width - 1; x += 1) {
      const index = y * width + x
      const dx = Math.abs(luminanceMap[index] - luminanceMap[index + 1])
      const dy = Math.abs(luminanceMap[index] - luminanceMap[index + width])
      edgeAccumulator += (dx + dy) / 2
    }
  }

  const meanLuminance = luminanceSum / Math.max(pixelCount, 1)
  const variance = luminanceSquaredSum / Math.max(pixelCount, 1) - meanLuminance * meanLuminance
  const palette = Array.from(paletteCounter.entries())
    .sort((left, right) => right[1] - left[1])
    .slice(0, 5)
    .map(([color]) => color)

  return {
    metrics: {
      brightness: meanLuminance,
      contrast: Math.sqrt(Math.max(variance, 0)),
      saturation: saturationSum / Math.max(pixelCount, 1),
      edgeDensity: edgeAccumulator / Math.max((width - 1) * (height - 1), 1),
      colorDiversity: paletteCounter.size / 256,
      warmRatio: warmPixels / Math.max(pixelCount, 1),
      coolRatio: coolPixels / Math.max(pixelCount, 1),
      orientation: inferOrientation(width, height),
    },
    palette: inferPaletteLabels(palette),
  }
}

export async function extractImageStyleProfile(reference: Pick<ImageReferenceItem, 'id' | 'url' | 'dataUrl' | 'name' | 'fileName'>): Promise<ImageStyleProfile> {
  const source = String(reference.dataUrl || reference.url || '').trim()
  if (!source) {
    throw new Error('缺少可用的主参考图地址，无法执行风格剖析。')
  }

  const image = await loadImage(source)
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) {
    throw new Error('当前环境不支持 Canvas 风格剖析。')
  }

  const width = SAMPLE_SIZE
  const height = Math.max(1, Math.round((image.naturalHeight / Math.max(image.naturalWidth, 1)) * SAMPLE_SIZE))
  canvas.width = width
  canvas.height = height
  context.drawImage(image, 0, 0, width, height)
  const imageData = context.getImageData(0, 0, width, height)
  const { metrics, palette } = analyzeImageMetrics(imageData, width, height)
  const hintText = `${reference.name || ''} ${reference.fileName || ''}`.trim()
  const medium = inferMedium(metrics, hintText)

  const profileWithoutSummary = {
    medium,
    palette,
    lighting: inferLighting(metrics),
    linework: inferLinework(metrics),
    texture: inferTexture(metrics),
    composition: inferComposition(metrics),
    mood: inferMood(metrics),
    forbidden: inferForbidden(medium),
    extractedAt: new Date().toISOString(),
    sourceImageId: reference.id,
    metrics,
  }

  return {
    ...profileWithoutSummary,
    summary: summarizeProfile(profileWithoutSummary),
  }
}