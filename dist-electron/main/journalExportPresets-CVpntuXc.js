"use strict";
Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
const PAGE_SIZES = {
  A4: { widthMm: 210, heightMm: 297 },
  Letter: { widthMm: 215.9, heightMm: 279.4 }
};
const JOURNAL_EXPORT_PRESETS = [
  // ── 化学 ──
  {
    id: "rsc",
    category: "chemistry",
    label: "RSC",
    description: "Royal Society of Chemistry 投稿格式",
    exampleJournals: ["Chemical Science", "Chemical Communications", "PCCP", "Green Chemistry"],
    fontFamily: "Times New Roman, serif",
    fontSizePt: 12,
    lineSpacingMultiple: 2,
    pageSize: PAGE_SIZES.A4,
    margins: { top: 25.4, right: 25.4, bottom: 25.4, left: 25.4 },
    headerFooter: { headerLayout: "left-title-right-pagenum", footerLayout: "none" },
    runningTitleLabel: "Running Head",
    authorLineLabel: "Author Line",
    runningTitlePlaceholder: "Smith et al.",
    authorLinePlaceholder: "Smith, J. et al.",
    runningTitleMaxChars: 60
  },
  {
    id: "acs",
    category: "chemistry",
    label: "ACS",
    description: "American Chemical Society 投稿格式",
    exampleJournals: ["JACS", "ACS Nano", "Langmuir", "Inorganic Chemistry"],
    fontFamily: "Times New Roman, serif",
    fontSizePt: 12,
    lineSpacingMultiple: 2,
    pageSize: PAGE_SIZES.Letter,
    margins: { top: 25.4, right: 25.4, bottom: 25.4, left: 25.4 },
    headerFooter: { headerLayout: "left-title-right-pagenum", footerLayout: "none", differentFirstPage: false },
    runningTitleLabel: "Running Title",
    authorLineLabel: "Authors",
    runningTitlePlaceholder: "Smith et al.",
    authorLinePlaceholder: "Jane Smith, John Doe",
    runningTitleMaxChars: 50
  },
  {
    id: "wiley",
    category: "chemistry",
    label: "Wiley",
    description: "Wiley-VCH 旗下期刊投稿格式",
    exampleJournals: ["Angewandte Chemie", "Chemistry – A European Journal", "ChemSusChem"],
    fontFamily: "Times New Roman, serif",
    fontSizePt: 12,
    lineSpacingMultiple: 2,
    pageSize: PAGE_SIZES.A4,
    margins: { top: 25.4, right: 25.4, bottom: 25.4, left: 25.4 },
    headerFooter: { headerLayout: "left-title-right-pagenum", footerLayout: "none" },
    runningTitleLabel: "Running Title",
    authorLineLabel: "Authors",
    runningTitlePlaceholder: "Smith et al.",
    authorLinePlaceholder: "Jane Smith, John Doe",
    runningTitleMaxChars: 60
  },
  {
    id: "elsevier",
    category: "chemistry",
    label: "Elsevier",
    description: "Elsevier 旗下期刊通用投稿格式",
    exampleJournals: ["Tetrahedron", "Journal of Catalysis", "Applied Surface Science", "Carbon"],
    fontFamily: "Times New Roman, serif",
    fontSizePt: 12,
    lineSpacingMultiple: 2,
    pageSize: PAGE_SIZES.A4,
    margins: { top: 25, right: 25, bottom: 25, left: 25 },
    headerFooter: { headerLayout: "none", footerLayout: "center-pagenum" },
    runningTitleLabel: "Short Title",
    authorLineLabel: "Authors",
    runningTitlePlaceholder: "Smith et al. / Journal Name",
    authorLinePlaceholder: "Jane Smith, John Doe",
    runningTitleMaxChars: 80
  },
  // ── 材料/物理 ──
  {
    id: "nature-group",
    category: "materials",
    label: "Nature 系列",
    description: "Nature / Nature Materials / Nature Communications 等",
    exampleJournals: ["Nature", "Nature Materials", "Nature Communications", "npj Computational Materials"],
    fontFamily: "Arial, Helvetica, sans-serif",
    fontSizePt: 10,
    lineSpacingMultiple: 2,
    pageSize: PAGE_SIZES.A4,
    margins: { top: 25.4, right: 25.4, bottom: 25.4, left: 25.4 },
    headerFooter: { headerLayout: "left-title-right-pagenum", footerLayout: "none" },
    runningTitleLabel: "Running Title",
    authorLineLabel: "Authors",
    runningTitlePlaceholder: "Smith et al.",
    authorLinePlaceholder: "Jane Smith, John Doe",
    runningTitleMaxChars: 45
  },
  {
    id: "springer",
    category: "materials",
    label: "Springer",
    description: "Springer/SpringerLink 旗下期刊通用格式",
    exampleJournals: ["Journal of Materials Science", "Theoretical and Applied Fracture Mechanics"],
    fontFamily: "Times New Roman, serif",
    fontSizePt: 12,
    lineSpacingMultiple: 2,
    pageSize: PAGE_SIZES.A4,
    margins: { top: 25.4, right: 25.4, bottom: 25.4, left: 25.4 },
    headerFooter: { headerLayout: "none", footerLayout: "center-pagenum" },
    runningTitleLabel: "Running Head",
    authorLineLabel: "Authors",
    runningTitlePlaceholder: "Smith et al.",
    authorLinePlaceholder: "Jane Smith · John Doe",
    runningTitleMaxChars: 60
  },
  // ── 生物医学 ──
  {
    id: "pnas",
    category: "biology",
    label: "PNAS",
    description: "Proceedings of the National Academy of Sciences",
    exampleJournals: ["PNAS"],
    fontFamily: "Times New Roman, serif",
    fontSizePt: 12,
    lineSpacingMultiple: 2,
    pageSize: PAGE_SIZES.Letter,
    margins: { top: 25.4, right: 25.4, bottom: 25.4, left: 25.4 },
    headerFooter: { headerLayout: "left-title-right-pagenum", footerLayout: "none" },
    runningTitleLabel: "Significance Statement / Running Head",
    authorLineLabel: "Authors",
    runningTitlePlaceholder: "Smith et al.",
    authorLinePlaceholder: "Jane Smith, John Doe",
    runningTitleMaxChars: 60
  },
  // ── 工程/计算机 ──
  {
    id: "ieee",
    category: "engineering",
    label: "IEEE",
    description: "IEEE Transactions 和 Conferences 投稿初稿格式",
    exampleJournals: ["IEEE Transactions on X", "IEEE Access", "ICASSP", "ICCV"],
    fontFamily: "Times New Roman, serif",
    fontSizePt: 10,
    lineSpacingMultiple: 1,
    pageSize: PAGE_SIZES.Letter,
    margins: { top: 25.4, right: 19.05, bottom: 25.4, left: 19.05 },
    headerFooter: { headerLayout: "none", footerLayout: "center-pagenum" },
    runningTitleLabel: "Paper Title",
    authorLineLabel: "Authors",
    runningTitlePlaceholder: "Deep Learning for...",
    authorLinePlaceholder: "Jane Smith, John Doe"
  },
  // ── 中文 ──
  {
    id: "chinese-journal",
    category: "chinese",
    label: "中文核心期刊",
    description: "中文科技核心期刊通用格式（参考 GB/T 7713.2）",
    exampleJournals: ["中国科学", "科学通报", "化学学报", "物理学报"],
    fontFamily: 'SimSun, "Noto Serif SC", serif',
    fontSizePt: 10.5,
    lineSpacingMultiple: 1.5,
    chineseTextIndent: true,
    pageSize: PAGE_SIZES.A4,
    margins: { top: 25.4, right: 31.7, bottom: 25.4, left: 31.7 },
    headerFooter: { headerLayout: "center-title", footerLayout: "center-pagenum" },
    runningTitleLabel: "页眉文字（论文题目或期刊名）",
    authorLineLabel: "作者",
    runningTitlePlaceholder: "某某研究的题目",
    authorLinePlaceholder: "张三, 李四",
    runningTitleMaxChars: 30
  },
  {
    id: "chinese-thesis",
    category: "chinese",
    label: "学位论文",
    description: "中国学位论文格式（参考 GB/T 7714，含页眉）",
    exampleJournals: ["博士/硕士学位论文"],
    fontFamily: "Times New Roman, SimSun, serif",
    fontSizePt: 12,
    lineSpacingMultiple: 1.5,
    chineseTextIndent: true,
    pageSize: PAGE_SIZES.A4,
    margins: { top: 30, right: 25, bottom: 25, left: 30 },
    headerFooter: { headerLayout: "center-title", footerLayout: "center-pagenum", differentFirstPage: true },
    runningTitleLabel: "论文题目（页眉）",
    authorLineLabel: "作者/导师",
    runningTitlePlaceholder: "基于XXX的YYY研究",
    authorLinePlaceholder: "张三（导师：李四教授）",
    runningTitleMaxChars: 40
  }
];
function getJournalPreset(id) {
  return JOURNAL_EXPORT_PRESETS.find((p) => p.id === id);
}
Array.from(
  new Set(JOURNAL_EXPORT_PRESETS.map((p) => p.category))
);
exports.JOURNAL_EXPORT_PRESETS = JOURNAL_EXPORT_PRESETS;
exports.PAGE_SIZES = PAGE_SIZES;
exports.getJournalPreset = getJournalPreset;
