from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable
from xml.sax.saxutils import escape
import zipfile

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import ListFlowable, ListItem, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle
from reportlab.pdfbase.cidfonts import UnicodeCIDFont
from reportlab.pdfbase import pdfmetrics


@dataclass
class TableBlock:
    rows: list[list[str]]


@dataclass
class SectionBlock:
    heading: str
    paragraphs: list[str] = field(default_factory=list)
    bullets: list[str] = field(default_factory=list)
    table: TableBlock | None = None


@dataclass
class SampleDocument:
    stem: str
    title: str
    subtitle: str
    usage_hint: str
    metadata: list[str]
    sections: list[SectionBlock]


SAMPLES: list[SampleDocument] = [
    SampleDocument(
        stem="01_新能源项目季度进展汇报",
        title="新能源项目季度进展汇报",
        subtitle="适合测试：作为模板文档导入，验证结构继承、章节复用与汇报语气",
        usage_hint="建议在 Knowledge Library 中将这份文档设为全局写作模板，或在写作/Remake 任务中作为本次模板使用。",
        metadata=[
            "文档定位：季度经营汇报模板",
            "推荐角色：模板文档",
            "测试重点：章节骨架、执行摘要、行动项风格",
        ],
        sections=[
            SectionBlock(
                heading="一、执行摘要",
                paragraphs=[
                    "本季度新能源项目整体推进平稳，建设、并网与采购三个主线均达到阶段目标。围绕项目里程碑的执行情况看，核心节点完成率保持在较高水平，但设备到货节奏与外部审批反馈仍对总工期形成一定压力。",
                    "建议在测试时重点观察 AI Writer 是否能够沿用这份材料的汇报语气、章节粒度与结论前置的表达方式，同时避免把旧数据和旧项目名称直接搬运到新报告中。",
                ],
            ),
            SectionBlock(
                heading="二、里程碑进展",
                paragraphs=[
                    "里程碑管理围绕设计冻结、土建完工、主设备到货与并网联调四个节点展开，当前主要差异集中在外部接口协调环节。",
                ],
                table=TableBlock(
                    rows=[
                        ["里程碑", "计划状态", "当前状态", "说明"],
                        ["设计冻结", "3月上旬", "已完成", "施工图与设备清单已同步归档"],
                        ["主设备到货", "3月下旬", "部分延迟", "逆变器到货推迟约 5 天"],
                        ["并网联调", "4月中旬", "按计划准备", "需继续跟踪审批窗口"],
                    ]
                ),
            ),
            SectionBlock(
                heading="三、风险与决策建议",
                bullets=[
                    "对外审批资料需要提前两周完成预审，避免联调窗口被动顺延。",
                    "建议对关键设备建立周度到货看板，并同步触发备选供应商预案。",
                    "经营层决策材料应在风险后面直接给出动作、责任人与时间点，减少解释成本。",
                ],
            ),
            SectionBlock(
                heading="四、下阶段行动",
                paragraphs=[
                    "下阶段建议继续采用“结论先行、里程碑对齐、风险闭环”的汇报结构。对于需要决策的事项，应明确区分已确认动作与待拍板事项，以便在管理层审阅时快速定位。",
                ],
            ),
        ],
    ),
    SampleDocument(
        stem="02_医疗数据治理调研简报",
        title="医疗数据治理调研简报",
        subtitle="适合测试：作为参考资料导入，验证摘要提取、辅助资料注入与术语继承",
        usage_hint="建议在 Knowledge Library 中将这份文档加入全局写作默认参考，或在 Remake 任务中作为辅助资料使用。",
        metadata=[
            "文档定位：行业调研参考",
            "推荐角色：参考资料 / 辅助资料",
            "测试重点：术语注入、背景事实、治理问题拆解",
        ],
        sections=[
            SectionBlock(
                heading="一、调研背景",
                paragraphs=[
                    "医疗机构在数据治理推进过程中，通常同时面临编码口径不统一、授权边界模糊、留痕链条不完整三类共性问题。这些问题不会只体现在技术平台，而会直接影响审计响应效率、跨部门协作与对外合规披露。",
                ],
            ),
            SectionBlock(
                heading="二、核心问题清单",
                table=TableBlock(
                    rows=[
                        ["问题类别", "典型表现", "业务影响", "治理建议"],
                        ["主数据不一致", "同一患者或项目存在多套编码", "统计口径冲突", "建立统一编码映射与主数据台账"],
                        ["访问授权粗放", "共享账号、权限继承混乱", "责任边界不清", "以角色与场景重构授权模型"],
                        ["审计留痕不足", "关键操作缺少完整日志", "追溯成本高", "补齐审批、访问、导出三层日志链路"],
                    ]
                ),
            ),
            SectionBlock(
                heading="三、调研结论",
                bullets=[
                    "如果把这份材料作为参考资料使用，模型应优先继承“权限矩阵、主数据、审计留痕”等术语。",
                    "在 remake 场景中，这类资料更适合作为辅助背景，而不是直接充当结构模板。",
                    "测试时可观察输出是否会自然吸收行业表达，同时保持新文档主题不被旧场景绑死。",
                ],
            ),
        ],
    ),
    SampleDocument(
        stem="03_AI_Writer_知识库功能演示材料",
        title="AI Writer 3.0 知识库功能演示材料",
        subtitle="适合测试：批量 remake 目标、任务级模板、辅助资料三类勾选是否被正确区分",
        usage_hint="建议把这份材料与另外两份样例一起导入，用来观察 KnowledgePanel 中三类任务选择器的操作路径。",
        metadata=[
            "文档定位：功能演示说明",
            "推荐角色：批量目标样例",
            "测试重点：三类勾选、批量提交、文案理解",
        ],
        sections=[
            SectionBlock(
                heading="一、测试目标",
                paragraphs=[
                    "这份演示材料专门用于验证新版本 KnowledgePanel 中的三类任务选择器。批量目标只决定哪些文档会被提交进行 remake；模板只决定生成骨架；辅助资料只作为上下文补充，三者在界面和行为上应完全区分。",
                ],
            ),
            SectionBlock(
                heading="二、建议测试步骤",
                bullets=[
                    "先在左侧为一份文档设置全局写作模板，并为另一份文档设置全局写作默认参考。",
                    "再进入文档级 Remake 任务设置，打开三类任务选择器，分别勾选批量目标、模板和辅助资料。",
                    "最后提交批量 remake，确认任务记录与运行结果里保存的是任务级目标与任务级上下文，而不是误读全局默认。",
                ],
            ),
            SectionBlock(
                heading="三、验收清单",
                table=TableBlock(
                    rows=[
                        ["验收点", "期望结果"],
                        ["批量目标未勾选", "点击批量按钮时回退到当前文档"],
                        ["辅助资料已勾选", "任务 extraContext 中出现辅助资料信息"],
                        ["模板已勾选", "任务记录中保存 templateDocumentId"],
                        ["全局写作默认已配置", "左侧统计卡与列表标签使用新文案"],
                    ]
                ),
            ),
        ],
    ),
]


CONTENT_TYPES_XML = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>
"""

ROOT_RELS_XML = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>
"""

APP_XML = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"
  xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <Application>AI Writer 3.0 Local Test Generator</Application>
</Properties>
"""


def xml_run(text: str, *, bold: bool = False, size: int = 21) -> str:
    escaped = escape(text)
    rpr = [f"<w:sz w:val=\"{size * 2}\"/>", f"<w:szCs w:val=\"{size * 2}\"/>"]
    if bold:
        rpr.append("<w:b/>")
    return (
        "<w:r>"
        f"<w:rPr>{''.join(rpr)}</w:rPr>"
        f"<w:t xml:space=\"preserve\">{escaped}</w:t>"
        "</w:r>"
    )


def xml_paragraph(text: str, *, bold: bool = False, size: int = 21, align: str = "left", spacing_after: int = 120) -> str:
    align_xml = f"<w:jc w:val=\"{align}\"/>" if align else ""
    lines = text.split("\n")
    runs: list[str] = []
    for index, line in enumerate(lines):
        if index:
            runs.append("<w:r><w:br/></w:r>")
        runs.append(xml_run(line, bold=bold, size=size))
    return (
        "<w:p>"
        f"<w:pPr>{align_xml}<w:spacing w:after=\"{spacing_after}\"/></w:pPr>"
        f"{''.join(runs)}"
        "</w:p>"
    )


def xml_table(rows: list[list[str]]) -> str:
    col_count = max(len(row) for row in rows)
    col_width = 9000 // max(col_count, 1)
    grid = "".join(f'<w:gridCol w:w="{col_width}"/>' for _ in range(col_count))
    row_xml: list[str] = []
    for row_index, row in enumerate(rows):
        cells: list[str] = []
        for value in row:
            paragraph = xml_paragraph(value, bold=row_index == 0, size=20 if row_index == 0 else 19, spacing_after=60)
            cells.append(
                "<w:tc>"
                f"<w:tcPr><w:tcW w:w=\"{col_width}\" w:type=\"dxa\"/></w:tcPr>{paragraph}"
                "</w:tc>"
            )
        row_xml.append(f"<w:tr>{''.join(cells)}</w:tr>")
    return (
        "<w:tbl>"
        "<w:tblPr>"
        "<w:tblW w:w=\"0\" w:type=\"auto\"/>"
        "<w:tblBorders>"
        "<w:top w:val=\"single\" w:sz=\"8\" w:space=\"0\" w:color=\"B7C9DD\"/>"
        "<w:left w:val=\"single\" w:sz=\"8\" w:space=\"0\" w:color=\"B7C9DD\"/>"
        "<w:bottom w:val=\"single\" w:sz=\"8\" w:space=\"0\" w:color=\"B7C9DD\"/>"
        "<w:right w:val=\"single\" w:sz=\"8\" w:space=\"0\" w:color=\"B7C9DD\"/>"
        "<w:insideH w:val=\"single\" w:sz=\"6\" w:space=\"0\" w:color=\"D8E3EF\"/>"
        "<w:insideV w:val=\"single\" w:sz=\"6\" w:space=\"0\" w:color=\"D8E3EF\"/>"
        "</w:tblBorders>"
        "</w:tblPr>"
        f"<w:tblGrid>{grid}</w:tblGrid>"
        f"{''.join(row_xml)}"
        "</w:tbl>"
    )


def build_document_xml(sample: SampleDocument) -> str:
    blocks: list[str] = [
        xml_paragraph(sample.title, bold=True, size=32, align="center", spacing_after=180),
        xml_paragraph(sample.subtitle, size=18, align="center", spacing_after=180),
        xml_paragraph(sample.usage_hint, size=19, spacing_after=180),
    ]
    for meta in sample.metadata:
        blocks.append(xml_paragraph(f"• {meta}", size=19, spacing_after=80))
    blocks.append(xml_paragraph("", size=6, spacing_after=40))
    for section in sample.sections:
        blocks.append(xml_paragraph(section.heading, bold=True, size=24, spacing_after=120))
        for paragraph in section.paragraphs:
            blocks.append(xml_paragraph(paragraph, size=20, spacing_after=120))
        for bullet in section.bullets:
            blocks.append(xml_paragraph(f"• {bullet}", size=20, spacing_after=80))
        if section.table:
            blocks.append(xml_table(section.table.rows))
            blocks.append(xml_paragraph("", size=6, spacing_after=40))
    return f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    {''.join(blocks)}
    <w:sectPr>
      <w:pgSz w:w="11906" w:h="16838"/>
      <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/>
    </w:sectPr>
  </w:body>
</w:document>
"""


def build_core_xml(sample: SampleDocument) -> str:
    created = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    return f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"
  xmlns:dc="http://purl.org/dc/elements/1.1/"
  xmlns:dcterms="http://purl.org/dc/terms/"
  xmlns:dcmitype="http://purl.org/dc/dcmitype/"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>{escape(sample.title)}</dc:title>
  <dc:subject>{escape(sample.subtitle)}</dc:subject>
  <dc:creator>AI Writer 3.0 Local Test Generator</dc:creator>
  <cp:lastModifiedBy>AI Writer 3.0 Local Test Generator</cp:lastModifiedBy>
  <dcterms:created xsi:type="dcterms:W3CDTF">{created}</dcterms:created>
  <dcterms:modified xsi:type="dcterms:W3CDTF">{created}</dcterms:modified>
</cp:coreProperties>
"""


def write_docx(target_path: Path, sample: SampleDocument) -> None:
    with zipfile.ZipFile(target_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("[Content_Types].xml", CONTENT_TYPES_XML)
        archive.writestr("_rels/.rels", ROOT_RELS_XML)
        archive.writestr("docProps/app.xml", APP_XML)
        archive.writestr("docProps/core.xml", build_core_xml(sample))
        archive.writestr("word/document.xml", build_document_xml(sample))


def build_pdf(target_path: Path, sample: SampleDocument) -> None:
    pdfmetrics.registerFont(UnicodeCIDFont("STSong-Light"))
    stylesheet = getSampleStyleSheet()
    title_style = ParagraphStyle(
        "ZhTitle",
        parent=stylesheet["Title"],
        fontName="STSong-Light",
        fontSize=20,
        leading=26,
        alignment=TA_CENTER,
        textColor=colors.HexColor("#17324D"),
        spaceAfter=10,
    )
    subtitle_style = ParagraphStyle(
        "ZhSubtitle",
        parent=stylesheet["Normal"],
        fontName="STSong-Light",
        fontSize=10.5,
        leading=16,
        alignment=TA_CENTER,
        textColor=colors.HexColor("#597188"),
        spaceAfter=10,
    )
    body_style = ParagraphStyle(
        "ZhBody",
        parent=stylesheet["BodyText"],
        fontName="STSong-Light",
        fontSize=10.5,
        leading=18,
        alignment=TA_LEFT,
        textColor=colors.HexColor("#243447"),
        spaceAfter=8,
    )
    heading_style = ParagraphStyle(
        "ZhHeading",
        parent=stylesheet["Heading2"],
        fontName="STSong-Light",
        fontSize=13.5,
        leading=20,
        textColor=colors.HexColor("#17324D"),
        spaceBefore=10,
        spaceAfter=6,
    )
    hint_style = ParagraphStyle(
        "ZhHint",
        parent=stylesheet["Italic"],
        fontName="STSong-Light",
        fontSize=10,
        leading=16,
        textColor=colors.HexColor("#355A7C"),
        spaceAfter=10,
    )

    story: list = [
        Paragraph(sample.title, title_style),
        Paragraph(sample.subtitle, subtitle_style),
        Paragraph(sample.usage_hint, hint_style),
    ]
    metadata_items = [ListItem(Paragraph(item, body_style)) for item in sample.metadata]
    story.append(ListFlowable(metadata_items, bulletType="bullet", start="circle", bulletFontName="STSong-Light"))
    story.append(Spacer(1, 5 * mm))

    for section in sample.sections:
        story.append(Paragraph(section.heading, heading_style))
        for paragraph in section.paragraphs:
            story.append(Paragraph(paragraph, body_style))
        if section.bullets:
            bullets = [ListItem(Paragraph(item, body_style)) for item in section.bullets]
            story.append(ListFlowable(bullets, bulletType="bullet", start="circle", bulletFontName="STSong-Light"))
        if section.table:
            table = Table(section.table.rows, repeatRows=1, hAlign="LEFT")
            table.setStyle(TableStyle([
                ("FONTNAME", (0, 0), (-1, -1), "STSong-Light"),
                ("FONTSIZE", (0, 0), (-1, -1), 9.5),
                ("LEADING", (0, 0), (-1, -1), 13),
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#EAF3FF")),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.HexColor("#17324D")),
                ("GRID", (0, 0), (-1, -1), 0.6, colors.HexColor("#BFD0E3")),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#F8FBFF")]),
                ("LEFTPADDING", (0, 0), (-1, -1), 6),
                ("RIGHTPADDING", (0, 0), (-1, -1), 6),
                ("TOPPADDING", (0, 0), (-1, -1), 5),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
            ]))
            story.append(table)
            story.append(Spacer(1, 4 * mm))

    document = SimpleDocTemplate(
        str(target_path),
        pagesize=A4,
        leftMargin=18 * mm,
        rightMargin=18 * mm,
        topMargin=16 * mm,
        bottomMargin=16 * mm,
        title=sample.title,
        author="AI Writer 3.0 Local Test Generator",
    )
    document.build(story)


def build_readme(samples: Iterable[SampleDocument]) -> str:
    lines = [
        "本目录由 build/generate-local-test-docs.py 自动生成。",
        "",
        "推荐测试方式：",
        "1. 将 01_新能源项目季度进展汇报 作为模板导入，验证结构继承。",
        "2. 将 02_医疗数据治理调研简报 作为参考/辅助资料导入，验证术语与背景注入。",
        "3. 将 03_AI_Writer_知识库功能演示材料 与前两份一起导入，验证批量目标、模板、辅助资料三类勾选。",
        "",
        "已生成文件：",
    ]
    for sample in samples:
        lines.append(f"- {sample.stem}.docx")
        lines.append(f"- {sample.stem}.pdf")
    return "\n".join(lines) + "\n"


def main() -> None:
    output_dir = Path(__file__).resolve().parents[1] / "docs" / "local-test-assets"
    output_dir.mkdir(parents=True, exist_ok=True)
    for sample in SAMPLES:
        write_docx(output_dir / f"{sample.stem}.docx", sample)
        build_pdf(output_dir / f"{sample.stem}.pdf", sample)
    (output_dir / "README.txt").write_text(build_readme(SAMPLES), encoding="utf-8")
    print(f"Generated {len(SAMPLES)} DOCX files and {len(SAMPLES)} PDF files in {output_dir}")


if __name__ == "__main__":
    main()