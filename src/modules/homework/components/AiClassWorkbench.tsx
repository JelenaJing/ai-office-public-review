import WebviewWorkbench from './WebviewWorkbench'

export default function AiClassWorkbench() {
  return (
    <WebviewWorkbench
      urlStorageKey="ai_class_remote_url"
      defaultUrl="http://10.20.5.61:3005"
      connectingText="正在连接 AI 课堂平台…"
      errorTitle="无法连接到 AI 课堂"
      errorDesc={(url) => `无法访问 ${url}。\n请确认远程服务器正在运行，且网络连通正常。`}
      urlPlaceholder="输入 AI 课堂地址，例如 http://10.20.5.61:3005"
    />
  )
}
