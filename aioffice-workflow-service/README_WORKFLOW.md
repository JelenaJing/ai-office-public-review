# AI Office Workflow Service

基于 Flowable 的邮件 OA 审批后端服务，为 AI Office 提供工作流能力。

## 环境要求

- Java 17+
- Maven 3.9+

## 启动方式

```bash
cd aioffice-workflow-service

# 构建（跳过测试）
mvn -q -DskipTests package

# 启动服务
mvn spring-boot:run
```

服务启动后监听：**http://localhost:4080**

H2 控制台（开发用）：**http://localhost:4080/h2-console**
- JDBC URL: `jdbc:h2:file:./data/aioffice_workflow`
- 用户名: `sa`，密码: 空

---

## 接口说明

### 健康检查

```
GET /api/workflows/health
```

响应示例：
```json
{ "status": "ok", "service": "aioffice-workflow-service" }
```

---

### 启动邮件审批流程

```
POST /api/workflows/email/start
Content-Type: application/json
```

请求体：
```json
{
  "sourceType": "email",
  "emailId": "email-001",
  "threadId": "thread-001",
  "subject": "关于项目预算审批",
  "sender": "sender@example.com",
  "requesterId": "user-001",
  "assignee": "approver-001",
  "priority": "urgent",
  "category": "approval",
  "aiSummary": "AI 摘要内容",
  "attachmentIds": ["att-001", "att-002"],
  "workspaceId": "ws-001"
}
```

必填字段说明：
- `sourceType`: 固定为 `"email"`
- `emailId` / `subject` / `requesterId` / `assignee`: 必填
- `priority`: 必须是 `urgent` / `important` / `normal`

响应：

---

### 查询我的待办任务

```
GET /api/workflows/tasks/my?assignee={userId}
```

响应（数组）：
```json
[
  {
    "taskId": "...",
    "taskName": "办理/审批邮件事项",
    "processInstanceId": "...",
    "businessKey": "email:email-001",
    "assignee": "approver-001",
    "subject": "关于项目预算审批",
    "sender": "sender@example.com",
    "priority": "urgent",
    "category": "approval",
    "aiSummary": "AI 摘要内容",
    "createTime": "..."
  }
]
```

---

### 完成任务（审批/拒绝）

```
POST /api/workflows/tasks/{taskId}/complete
Content-Type: application/json
```

请求体：
```json
{
  "decision": "approve",
  "comment": "同意，请执行",
  "operatorId": "approver-001"
}
```

`decision` 值：`approve`（通过）或 `reject`（拒绝）

响应：
```json
{ "taskId": "...", "status": "completed", "decision": "approve" }
```

---

### 查询流程实例状态

```
GET /api/workflows/instances/{processInstanceId}
```

响应示例（进行中）：
```json
{
  "processInstanceId": "...",
  "businessKey": "email:email-001",
  "processDefinitionKey": "emailOaApproval",
  "status": "active",
  "variables": { ... }
}
```

响应示例（已完成）：
```json
{
  "processInstanceId": "...",
  "status": "completed",
  "startTime": "...",
  "endTime": "..."
}
```

---

## 快速测试流程

```bash
# 1. 健康检查
curl http://localhost:4080/api/workflows/health

# 2. 启动审批流程
curl -X POST http://localhost:4080/api/workflows/email/start \
  -H "Content-Type: application/json" \
  -d '{"emailId":"e001","threadId":"t001","subject":"测试审批","sender":"a@b.com","requesterId":"u001","assignee":"approver1","priority":"high","category":"approval","aiSummary":"测试摘要","workspaceId":"ws1","sourceType":"email"}'

# 3. 查询待办（替换 assignee 为实际值）
curl "http://localhost:4080/api/workflows/tasks/my?assignee=approver1"

# 4. 完成任务（替换 {taskId} 为第3步返回的 taskId）
curl -X POST http://localhost:4080/api/workflows/tasks/{taskId}/complete \
  -H "Content-Type: application/json" \
  -d '{"decision":"approve","comment":"同意","operatorId":"approver1"}'

# 5. 查询流程状态（替换 {processInstanceId} 为第2步返回的值）
curl http://localhost:4080/api/workflows/instances/{processInstanceId}
```

---

## BPMN 流程说明

流程文件：`src/main/resources/processes/email_oa_approval.bpmn20.xml`

```
startEvent
  → userTask "办理/审批邮件事项" (assignee = ${assignee})
    → exclusiveGateway
      → decision == 'approve' → approvedEnd (审批通过)
      → decision == 'reject'  → rejectedEnd (审批拒绝)
```
