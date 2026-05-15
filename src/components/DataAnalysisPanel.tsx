import styled from 'styled-components'
import { BarChart2, Upload, Table, PieChart, FileText, Download } from 'lucide-react'

const Shell = styled.div`
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  background: #f4f7fc;
  padding: 40px 56px;
  display: flex;
  flex-direction: column;
`

const Header = styled.div`
  margin-bottom: 32px;
  flex-shrink: 0;
`

const Title = styled.h1`
  margin: 0 0 6px;
  font-size: 26px;
  font-weight: 800;
  color: #1a2f47;
`

const Subtitle = styled.p`
  margin: 0;
  font-size: 14px;
  color: #6b7f94;
`

const Grid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 18px;
`

const Card = styled.div`
  background: #fff;
  border: 1.5px solid #e2eaf4;
  border-radius: 16px;
  padding: 24px 24px 20px;
  display: flex;
  flex-direction: column;
  gap: 10px;
`

const CardIconWrap = styled.div<{ $color: string }>`
  width: 44px;
  height: 44px;
  border-radius: 12px;
  background: ${p => p.$color}22;
  color: ${p => p.$color};
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
`

const CardTitle = styled.span`
  font-size: 15px;
  font-weight: 700;
  color: #1a2f47;
`

const CardDesc = styled.span`
  font-size: var(--font-size-sm);
  color: #6b7f94;
  line-height: 1.5;
`

const Badge = styled.span`
  display: inline-block;
  align-self: flex-start;
  padding: 2px 10px;
  border-radius: 999px;
  font-size: var(--font-size-xs);
  font-weight: 600;
  background: #fdf0e2;
  color: #a05c10;
`

const ITEMS = [
  { icon: <Upload size={22} />, color: '#1f6fd6', title: '上传数据', desc: '支持 Excel、CSV、JSON 格式的数据文件上传与解析' },
  { icon: <Table size={22} />, color: '#1a7a4a', title: '选择数据源', desc: '连接本地文件或工作区已有数据集，快速导入分析' },
  { icon: <BarChart2 size={22} />, color: '#7c4dff', title: '生成图表', desc: '根据数据自动生成折线图、柱状图、饼图等可视化图表' },
  { icon: <PieChart size={22} />, color: '#00897b', title: '生成分析结论', desc: 'AI 自动提炼数据趋势、关键指标和分析建议' },
  { icon: <FileText size={22} />, color: '#c05c15', title: '生成数据报告', desc: '将图表与结论整合成可分享的数据分析报告文档' },
  { icon: <Download size={22} />, color: '#607080', title: '导出图表 / 报告', desc: '导出为 PNG、XLSX 或 DOCX 格式' },
]

export default function DataAnalysisPanel() {
  return (
    <Shell>
      <Header>
        <Title>数据分析</Title>
        <Subtitle>分析表格、生成图表、整理数据结论</Subtitle>
      </Header>
      <Grid>
        {ITEMS.map(item => (
          <Card key={item.title}>
            <CardIconWrap $color={item.color}>{item.icon}</CardIconWrap>
            <CardTitle>{item.title}</CardTitle>
            <CardDesc>{item.desc}</CardDesc>
            <Badge>建设中</Badge>
          </Card>
        ))}
      </Grid>
    </Shell>
  )
}
