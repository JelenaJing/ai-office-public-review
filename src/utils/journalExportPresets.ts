// journalExportPresets.ts — 期刊投稿初稿格式预设定义
// 所有参数来自各期刊官方 Author Guidelines（2024），仅针对投稿初稿（单栏格式）。

export interface JournalPageSize {
  widthMm: number
  heightMm: number
}

export const PAGE_SIZES = {
  A4: { widthMm: 210, heightMm: 297 } as JournalPageSize,
  Letter: { widthMm: 215.9, heightMm: 279.4 } as JournalPageSize,
}

/** 页眉布局：运行标题在左、页码在右（最常见）or 无页眉 */
export type HeaderLayout =
  | 'left-title-right-pagenum'   // 运行标题(左) + 页码(右)
  | 'center-title'               // 居中运行标题，无页码
  | 'none'                       // 无页眉

/** 页脚布局 */
export type FooterLayout =
  | 'center-pagenum'             // 页码居中
  | 'right-pagenum'              // 页码靠右
  | 'none'                       // 无页脚

export interface JournalHeaderFooterConfig {
  headerLayout: HeaderLayout
  footerLayout: FooterLayout
  /** 首页不同（某些期刊第一页不要页眉） */
  differentFirstPage?: boolean
}

export interface JournalExportPreset {
  id: string
  /** 显示分类 */
  category: 'chemistry' | 'materials' | 'biology' | 'engineering' | 'general' | 'chinese'
  /** 界面显示名 */
  label: string
  /** 出版商/期刊说明 */
  description: string
  /** 代表性期刊 */
  exampleJournals?: string[]

  // ── 字体排版 ──
  fontFamily: string
  fontSizePt: number
  lineSpacingMultiple: number
  /** 中文首行缩进 */
  chineseTextIndent?: boolean

  // ── 页面布局 ──
  pageSize: JournalPageSize
  /** 页边距 (mm) */
  margins: { top: number; right: number; bottom: number; left: number }

  // ── 页眉页脚 ──
  headerFooter: JournalHeaderFooterConfig

  // ── 弹窗提示标签 ──
  runningTitleLabel: string
  authorLineLabel: string
  runningTitlePlaceholder: string
  authorLinePlaceholder: string
  /** 运行标题建议最大字符数 */
  runningTitleMaxChars?: number
}

// ---------------------------------------------------------------------------
// 预设定义
// ---------------------------------------------------------------------------

export const JOURNAL_EXPORT_PRESETS: JournalExportPreset[] = [
  // ── 化学 ──
  {
    id: 'rsc',
    category: 'chemistry',
    label: 'RSC',
    description: 'Royal Society of Chemistry 投稿格式',
    exampleJournals: ['Chemical Science', 'Chemical Communications', 'PCCP', 'Green Chemistry'],
    fontFamily: 'Times New Roman, serif',
    fontSizePt: 12,
    lineSpacingMultiple: 2.0,
    pageSize: PAGE_SIZES.A4,
    margins: { top: 25.4, right: 25.4, bottom: 25.4, left: 25.4 },
    headerFooter: { headerLayout: 'left-title-right-pagenum', footerLayout: 'none' },
    runningTitleLabel: 'Running Head',
    authorLineLabel: 'Author Line',
    runningTitlePlaceholder: 'Smith et al.',
    authorLinePlaceholder: 'Smith, J. et al.',
    runningTitleMaxChars: 60,
  },
  {
    id: 'acs',
    category: 'chemistry',
    label: 'ACS',
    description: 'American Chemical Society 投稿格式',
    exampleJournals: ['JACS', 'ACS Nano', 'Langmuir', 'Inorganic Chemistry'],
    fontFamily: 'Times New Roman, serif',
    fontSizePt: 12,
    lineSpacingMultiple: 2.0,
    pageSize: PAGE_SIZES.Letter,
    margins: { top: 25.4, right: 25.4, bottom: 25.4, left: 25.4 },
    headerFooter: { headerLayout: 'left-title-right-pagenum', footerLayout: 'none', differentFirstPage: false },
    runningTitleLabel: 'Running Title',
    authorLineLabel: 'Authors',
    runningTitlePlaceholder: 'Smith et al.',
    authorLinePlaceholder: 'Jane Smith, John Doe',
    runningTitleMaxChars: 50,
  },
  {
    id: 'wiley',
    category: 'chemistry',
    label: 'Wiley',
    description: 'Wiley-VCH 旗下期刊投稿格式',
    exampleJournals: ['Angewandte Chemie', 'Chemistry – A European Journal', 'ChemSusChem'],
    fontFamily: 'Times New Roman, serif',
    fontSizePt: 12,
    lineSpacingMultiple: 2.0,
    pageSize: PAGE_SIZES.A4,
    margins: { top: 25.4, right: 25.4, bottom: 25.4, left: 25.4 },
    headerFooter: { headerLayout: 'left-title-right-pagenum', footerLayout: 'none' },
    runningTitleLabel: 'Running Title',
    authorLineLabel: 'Authors',
    runningTitlePlaceholder: 'Smith et al.',
    authorLinePlaceholder: 'Jane Smith, John Doe',
    runningTitleMaxChars: 60,
  },
  {
    id: 'elsevier',
    category: 'chemistry',
    label: 'Elsevier',
    description: 'Elsevier 旗下期刊通用投稿格式',
    exampleJournals: ['Tetrahedron', 'Journal of Catalysis', 'Applied Surface Science', 'Carbon'],
    fontFamily: 'Times New Roman, serif',
    fontSizePt: 12,
    lineSpacingMultiple: 2.0,
    pageSize: PAGE_SIZES.A4,
    margins: { top: 25.0, right: 25.0, bottom: 25.0, left: 25.0 },
    headerFooter: { headerLayout: 'none', footerLayout: 'center-pagenum' },
    runningTitleLabel: 'Short Title',
    authorLineLabel: 'Authors',
    runningTitlePlaceholder: 'Smith et al. / Journal Name',
    authorLinePlaceholder: 'Jane Smith, John Doe',
    runningTitleMaxChars: 80,
  },

  // ── 材料/物理 ──
  {
    id: 'nature-group',
    category: 'materials',
    label: 'Nature 系列',
    description: 'Nature / Nature Materials / Nature Communications 等',
    exampleJournals: ['Nature', 'Nature Materials', 'Nature Communications', 'npj Computational Materials'],
    fontFamily: 'Arial, Helvetica, sans-serif',
    fontSizePt: 10,
    lineSpacingMultiple: 2.0,
    pageSize: PAGE_SIZES.A4,
    margins: { top: 25.4, right: 25.4, bottom: 25.4, left: 25.4 },
    headerFooter: { headerLayout: 'left-title-right-pagenum', footerLayout: 'none' },
    runningTitleLabel: 'Running Title',
    authorLineLabel: 'Authors',
    runningTitlePlaceholder: 'Smith et al.',
    authorLinePlaceholder: 'Jane Smith, John Doe',
    runningTitleMaxChars: 45,
  },
  {
    id: 'springer',
    category: 'materials',
    label: 'Springer',
    description: 'Springer/SpringerLink 旗下期刊通用格式',
    exampleJournals: ['Journal of Materials Science', 'Theoretical and Applied Fracture Mechanics'],
    fontFamily: 'Times New Roman, serif',
    fontSizePt: 12,
    lineSpacingMultiple: 2.0,
    pageSize: PAGE_SIZES.A4,
    margins: { top: 25.4, right: 25.4, bottom: 25.4, left: 25.4 },
    headerFooter: { headerLayout: 'none', footerLayout: 'center-pagenum' },
    runningTitleLabel: 'Running Head',
    authorLineLabel: 'Authors',
    runningTitlePlaceholder: 'Smith et al.',
    authorLinePlaceholder: 'Jane Smith · John Doe',
    runningTitleMaxChars: 60,
  },

  // ── 生物医学 ──
  {
    id: 'pnas',
    category: 'biology',
    label: 'PNAS',
    description: 'Proceedings of the National Academy of Sciences',
    exampleJournals: ['PNAS'],
    fontFamily: 'Times New Roman, serif',
    fontSizePt: 12,
    lineSpacingMultiple: 2.0,
    pageSize: PAGE_SIZES.Letter,
    margins: { top: 25.4, right: 25.4, bottom: 25.4, left: 25.4 },
    headerFooter: { headerLayout: 'left-title-right-pagenum', footerLayout: 'none' },
    runningTitleLabel: 'Significance Statement / Running Head',
    authorLineLabel: 'Authors',
    runningTitlePlaceholder: 'Smith et al.',
    authorLinePlaceholder: 'Jane Smith, John Doe',
    runningTitleMaxChars: 60,
  },

  // ── 工程/计算机 ──
  {
    id: 'ieee',
    category: 'engineering',
    label: 'IEEE',
    description: 'IEEE Transactions 和 Conferences 投稿初稿格式',
    exampleJournals: ['IEEE Transactions on X', 'IEEE Access', 'ICASSP', 'ICCV'],
    fontFamily: 'Times New Roman, serif',
    fontSizePt: 10,
    lineSpacingMultiple: 1.0,
    pageSize: PAGE_SIZES.Letter,
    margins: { top: 25.4, right: 19.05, bottom: 25.4, left: 19.05 },
    headerFooter: { headerLayout: 'none', footerLayout: 'center-pagenum' },
    runningTitleLabel: 'Paper Title',
    authorLineLabel: 'Authors',
    runningTitlePlaceholder: 'Deep Learning for...',
    authorLinePlaceholder: 'Jane Smith, John Doe',
  },

  // ── 中文 ──
  {
    id: 'chinese-journal',
    category: 'chinese',
    label: '中文核心期刊',
    description: '中文科技核心期刊通用格式（参考 GB/T 7713.2）',
    exampleJournals: ['中国科学', '科学通报', '化学学报', '物理学报'],
    fontFamily: 'SimSun, "Noto Serif SC", serif',
    fontSizePt: 10.5,
    lineSpacingMultiple: 1.5,
    chineseTextIndent: true,
    pageSize: PAGE_SIZES.A4,
    margins: { top: 25.4, right: 31.7, bottom: 25.4, left: 31.7 },
    headerFooter: { headerLayout: 'center-title', footerLayout: 'center-pagenum' },
    runningTitleLabel: '页眉文字（论文题目或期刊名）',
    authorLineLabel: '作者',
    runningTitlePlaceholder: '某某研究的题目',
    authorLinePlaceholder: '张三, 李四',
    runningTitleMaxChars: 30,
  },
  {
    id: 'chinese-thesis',
    category: 'chinese',
    label: '学位论文',
    description: '中国学位论文格式（参考 GB/T 7714，含页眉）',
    exampleJournals: ['博士/硕士学位论文'],
    fontFamily: 'Times New Roman, SimSun, serif',
    fontSizePt: 12,
    lineSpacingMultiple: 1.5,
    chineseTextIndent: true,
    pageSize: PAGE_SIZES.A4,
    margins: { top: 30, right: 25, bottom: 25, left: 30 },
    headerFooter: { headerLayout: 'center-title', footerLayout: 'center-pagenum', differentFirstPage: true },
    runningTitleLabel: '论文题目（页眉）',
    authorLineLabel: '作者/导师',
    runningTitlePlaceholder: '基于XXX的YYY研究',
    authorLinePlaceholder: '张三（导师：李四教授）',
    runningTitleMaxChars: 40,
  },
]

export const JOURNAL_CATEGORY_LABELS: Record<JournalExportPreset['category'], string> = {
  chemistry: '化学',
  materials: '材料/物理',
  biology: '生物医学',
  engineering: '工程/CS',
  general: '综合性',
  chinese: '中文',
}

export function getJournalPreset(id: string): JournalExportPreset | undefined {
  return JOURNAL_EXPORT_PRESETS.find((p) => p.id === id)
}

export function getPresetsByCategory(category: JournalExportPreset['category']): JournalExportPreset[] {
  return JOURNAL_EXPORT_PRESETS.filter((p) => p.category === category)
}

/** 所有出现的分类，保留定义顺序去重 */
export const JOURNAL_CATEGORIES: JournalExportPreset['category'][] = Array.from(
  new Set(JOURNAL_EXPORT_PRESETS.map((p) => p.category)),
)

export interface JournalExportConfig {
  preset: JournalExportPreset
  runningTitle: string
  authorLine: string
}
