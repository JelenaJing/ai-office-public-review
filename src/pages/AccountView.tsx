import React from 'react'
import styled from 'styled-components'
import InternalAccountPanel from '../components/InternalAccountPanel'

const Shell = styled.div`
  flex: 1;
  display: flex;
  min-height: 0;
  overflow: hidden;
  background: #f4f7fb;
`

const Content = styled.div`
  flex: 1;
  overflow-y: auto;
  padding: 24px 28px;
  max-width: 680px;
`

const PageTitle = styled.h1`
  font-size: 20px;
  font-weight: 700;
  color: #1f3142;
  margin: 0 0 4px;
`

const PageSubtitle = styled.p`
  font-size: var(--font-size-xs);
  color: #627385;
  margin: 0 0 24px;
`

export default function AccountView() {
  return (
    <Shell>
      <Content>
        <PageTitle>账号</PageTitle>
        <PageSubtitle>管理当前登录账号、绑定状态和退出登录。</PageSubtitle>
        <InternalAccountPanel />
      </Content>
    </Shell>
  )
}
