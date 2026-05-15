export type MagazineArticle = {
  id: string
  /** ISO 日期，便于日后与远端 feed 对齐 */
  date: string
  tag: string
  headline: string
  deck: string
  body: string
  /** CSS linear-gradient，离线可用；若日后接入 CDN 图，可再增加 imageUrl */
  coverGradient: string
}

/** 列表与详情使用的示例数据（产品内仅作展示） */
export const builtinMagazineArticles: MagazineArticle[] = [
  {
    id: 'office-1',
    date: '2026-05-04',
    tag: '更新日志',
    headline: 'AI-Office 3.0 数据绘图与 Excel 联动',
    deck: '主进程解析表头与列类型，多工作表可选，公式列会给出提示。',
    body: '在「知识对话」侧栏切换到「数据绘图」，选择 xlsx 后即可查看工作表结构与数据预览。绘图引擎侧使用临时导出的 CSV，避免 Python 端对多表与公式的歧义。若列主要为公式且导出值为空，建议在 Excel 中粘贴为数值后再导入。',
    coverGradient: 'linear-gradient(135deg, #0f766e 0%, #2563eb 55%, #7c3aed 100%)',
  },
  {
    id: 'office-2',
    date: '2026-05-03',
    tag: '使用技巧',
    headline: '把图表一键推送到主工作台',
    deck: '生成结果可保存到工作区 figures 目录，并支持插入当前文稿。',
    body: '打开工作区后，生成的 PNG 会进入 figures 或根目录；主界面「插入编辑器」可将图像插入正文。未打开工作区时仍可在主区预览并以 base64 插入，便于快速出稿。',
    coverGradient: 'linear-gradient(145deg, #b45309 0%, #ea580c 45%, #fbbf24 100%)',
  },
  {
    id: 'office-3',
    date: '2026-05-02',
    tag: '工作锦囊',
    headline: '用每日资讯对齐团队关注点',
    deck: '把外部动态与内部要点放在同一入口，减少来回切换。',
    body: '建议固定时段浏览列表，对需要跟进的条目随手记下结论；与项目相关的条目可再落到工作区或文稿里，形成可执行清单。',
    coverGradient: 'linear-gradient(160deg, #0c4a6e 0%, #0369a1 40%, #38bdf8 100%)',
  },
]
