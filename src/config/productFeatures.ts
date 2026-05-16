/**
 * 产品功能开关配置
 *
 * 通过修改此处的 true/false 即可统一控制侧边栏入口、首页卡片和路由保护。
 * 不需要在多个文件中分别硬编码。
 *
 * 默认恢复首页、工作、学习、生活四个主场景入口；首页内展示工作/学习/生活三分区。
 */
export const PRODUCT_FEATURES = {
  home: true,
  work: true,
  learning: true,
  life: true,
  resources: true,
  skills: true,
  communication: true,
  settings: true,
} as const

export type ProductFeatureKey = keyof typeof PRODUCT_FEATURES

export function isProductFeatureEnabled(feature: ProductFeatureKey): boolean {
  return PRODUCT_FEATURES[feature] === true
}

/** 应用默认启动区域对应的路由路径（去掉前导斜杠即为 PrimarySection key）。 */
export const DEFAULT_APP_ROUTE = '/home'
