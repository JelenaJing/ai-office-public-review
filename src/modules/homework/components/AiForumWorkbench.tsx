import WebviewWorkbench from './WebviewWorkbench'

export default function AiForumWorkbench() {
  return (
    <WebviewWorkbench
      urlStorageKey="ai_forum_url"
      defaultUrl="http://nft-core.xyz/forum"
      connectingText="正在连接 AI 论坛…"
      errorTitle="无法连接到 AI 论坛"
      errorDesc={(url) => `无法访问 ${url}。\n请确认网络连通正常。`}
      urlPlaceholder="输入 AI 论坛地址，例如 http://nft-core.xyz/forum"
    />
  )
}
