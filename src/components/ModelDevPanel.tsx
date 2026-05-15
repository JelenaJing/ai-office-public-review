import styled from 'styled-components'
import { Cpu, Link, MessageSquare, Wrench, GitBranch, Blocks } from 'lucide-react'

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
  { icon: <Cpu size={22} />, color: '#1f6fd6', title: '模型配置', desc: '选择和配置 AI 模型，设置推理参数和上下文窗口' },
  { icon: <Link size={22} />, color: '#1a7a4a', title: 'API 地址配置', desc: '配置 OpenAI 兼容接口地址、Key 与代理设置' },
  { icon: <MessageSquare size={22} />, color: '#7c4dff', title: 'Prompt 调试', desc: '在沙盒环境中测试和迭代系统提示词' },
  { icon: <Wrench size={22} />, color: '#00897b', title: 'Skill 管理', desc: '查看、启用和管理已注册的 AI Skill 能力列表' },
  { icon: <Blocks size={22} />, color: '#c05c15', title: 'Skill Builder', desc: '可视化构建新 Skill，定义输入、输出和执行链路' },
  { icon: <GitBranch size={22} />, color: '#607080', title: '工作流配置', desc: '编排多步骤 AI 工作流，支持条件分支与并行执行' },
]

export default function ModelDevPanel() {
  return (
    <Shell>
      <Header>
        <Title>模型开发</Title>
        <Subtitle>管理模型、Prompt、Skill、工作流和接口能力</Subtitle>
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
