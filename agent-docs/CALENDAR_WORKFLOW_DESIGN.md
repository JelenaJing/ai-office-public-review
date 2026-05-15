# AIOffice 日程管理模块完整建设方案

## 一、功能目标

AIOffice 需要新增一个“日程管理”模块，并最终打通：

```text
邮件收取
  ↓
AI 邮件分析
  ↓
识别会议 / 面试 / 截止事项 / 候选时间 / 模糊约时间意图
  ↓
生成日程或待确认日程
  ↓
检测时间冲突
  ↓
回复邮件前查询日历
  ↓
无冲突：生成确认回复
  ↓
有冲突：生成改期回复
```

该功能不是单纯做一个日历页面，而是要形成：

```text
邮件 → 日程 → 冲突检测 → AI 回复
```

的完整闭环。

---

## 二、产品定位

日程管理属于“工作场景”的核心能力之一。

它应该和以下模块协同：

- 邮件收发
- AI 邮件分析
- AI 预回复
- 工作日报
- 后续会议安排 / 待办管理

因此日程入口应该出现在工作场景首页中，而不是只藏在邮件模块内部。

当前工作场景首页已有：

1. 文稿编辑
2. 邮件收发
3. 数据分析
4. PPT 生成

需要新增：

5. 日程管理

---

## 三、整体建设阶段

建议分 4 个阶段实现。

```text
阶段 1：日程入口和基础页面
阶段 2：日程数据层、本地存储、冲突检测
阶段 3：邮件 AI 分析接入 timeIntent，识别邮件中的时间要求
阶段 4：邮件详情页展示日程卡片，回复邮件前查日历并生成冲突感知回复
```

不要一开始就接 Google Calendar / Outlook Calendar。

第一版先做 AIOffice 内部日历，把内部闭环跑通。

---

# 阶段 1：日程入口和基础页面

## 1.1 工作场景首页新增日程入口

在工作场景首页新增一个功能卡片。

### 卡片信息

```text
标题：日程管理

描述：
AI识别邮件中的会议、截止事项和候选时间，自动生成日程并检测时间冲突

图标：
CalendarClock

按钮：
进入
```

### 位置

建议放在：

```text
文稿编辑
邮件收发
日程管理
数据分析
PPT生成
```

也就是放在“邮件收发”下面，“数据分析”上面。

### 颜色

使用青蓝色或靛蓝色，例如：

```text
#4338ca
```

不要和现有文稿蓝、邮件紫、数据绿、PPT 橙完全重复。

---

## 1.2 新增路由

点击“日程管理”进入：

```text
/work/calendar
```

如果项目目前不是标准 URL Router，而是通过 `primarySection` 或内部状态切换页面，则按现有项目方式实现。

不要破坏原有工作场景、邮件、文稿、PPT、数据分析的导航逻辑。

---

## 1.3 新增日程页面

新增页面组件，例如：

```text
src/pages/CalendarWorkspace.tsx
```

或根据项目命名风格使用：

```text
WorkCalendarPage
CalendarPage
CalendarWorkspace
```

页面标题：

```text
日程管理
```

页面说明：

```text
管理会议、截止事项、待确认日程和邮件识别出的时间安排。
```

---

## 1.4 日程页面基础 UI

第一版不要做复杂月历视图。

采用三栏结构：

```text
┌──────────────────────────────────────────────┐
│ 顶部：日程管理 / 新建日程                      │
├───────────────┬────────────────┬─────────────┤
│ 左侧筛选区      │ 中间日程列表       │ 右侧日程详情   │
└───────────────┴────────────────┴─────────────┘
```

### 左侧筛选区

包含：

```text
今天
本周
待确认日程
来自邮件
有冲突
截止事项
```

### 中间日程列表

第一版可以展示空状态：

```text
暂无日程安排。
当邮件中识别到会议、截止时间或候选时间后，会在这里显示待确认日程。
```

后续需要按日期分组展示日程。

### 右侧日程详情

第一版可以展示空状态：

```text
请选择一个日程查看详情。
```

后续详情区需要支持显示：

```text
标题
时间
地点
会议链接
描述
来源邮件
来源发件人
冲突状态
参会人
操作按钮
```

---

# 阶段 2：日程数据层、本地存储、冲突检测

阶段 1 完成后，需要让日程模块真正可用。

本阶段目标：

```text
用户可以手动创建日程
日程可以本地保存
页面刷新后仍然存在
可以检测时间冲突
可以修改状态、忽略、删除
```

---

## 2.1 类型定义

新增日程类型文件。

推荐路径：

```text
src/calendar/types.ts
```

如果项目已有统一类型目录，也可以放到：

```text
src/types/calendar.ts
```

参考类型：

```ts
export type CalendarEventStatus =
  | 'tentative'
  | 'confirmed'
  | 'declined'
  | 'cancelled'
  | 'ignored'

export type CalendarEventSource =
  | 'manual'
  | 'email_ai'
  | 'email_user_confirmed'
  | 'imported'

export type CalendarEventType =
  | 'meeting'
  | 'interview'
  | 'deadline'
  | 'reminder'
  | 'focus'
  | 'task'

export interface CalendarAttendee {
  name?: string
  email?: string
  status?: 'accepted' | 'declined' | 'tentative' | 'unknown'
}

export interface CalendarEvent {
  id: string

  title: string
  description?: string

  startTime: string
  endTime?: string
  timezone?: string

  allDay?: boolean

  location?: string
  meetingLink?: string

  attendees?: CalendarAttendee[]

  status: CalendarEventStatus
  eventType: CalendarEventType

  source: CalendarEventSource

  sourceMessageId?: string
  sourceThreadId?: string
  sourceEmailSubject?: string
  sourceEmailFrom?: string

  confidence?: number
  needsUserConfirmation?: boolean

  conflictEventIds?: string[]

  createdAt: string
  updatedAt: string
}
```

### 字段说明

#### `status`

```text
tentative   待确认
confirmed   已确认
declined    已拒绝
cancelled   已取消
ignored     已忽略
```

AI 从邮件识别出的日程默认应该是：

```ts
status: 'tentative'
needsUserConfirmation: true
```

用户手动创建的日程默认应该是：

```ts
status: 'confirmed'
source: 'manual'
needsUserConfirmation: false
```

#### `eventType`

```text
meeting     会议
interview   面试
deadline    截止事项
reminder    提醒
focus       专注
task        任务
```

注意：

```text
截止事项 deadline 不能粗暴当成普通会议。
```

例如：

```text
请在周五下午 5 点前提交材料
```

应该创建为：

```ts
eventType: 'deadline'
```

而不是：

```ts
eventType: 'meeting'
```

#### `source`

```text
manual                用户手动创建
email_ai              AI 从邮件识别
email_user_confirmed  用户确认邮件识别出的日程
imported              外部导入
```

#### 邮件来源字段

这些字段是后续邮件接入必须用的：

```ts
sourceMessageId?: string
sourceThreadId?: string
sourceEmailSubject?: string
sourceEmailFrom?: string
```

作用：

1. 从日程反查来源邮件。
2. 从邮件详情显示已生成的日程。
3. 生成回复时知道日程来自哪封邮件。

---

## 2.2 新增 calendarService

新增服务文件：

```text
src/calendar/calendarService.ts
```

或：

```text
src/services/calendarService.ts
```

根据项目结构选择。

提供以下函数：

```ts
export async function listCalendarEvents(): Promise<CalendarEvent[]>

export async function getCalendarEventById(id: string): Promise<CalendarEvent | null>

export async function createCalendarEvent(
  input: Omit<CalendarEvent, 'id' | 'createdAt' | 'updatedAt'>
): Promise<CalendarEvent>

export async function updateCalendarEvent(
  id: string,
  patch: Partial<Omit<CalendarEvent, 'id' | 'createdAt'>>
): Promise<CalendarEvent | null>

export async function deleteCalendarEvent(id: string): Promise<boolean>

export async function listCalendarEventsByRange(
  startTime: string,
  endTime: string
): Promise<CalendarEvent[]>
```

### 服务要求

1. 所有日程读写集中在 service 中。
2. React 组件不要直接操作 localStorage。
3. 第一版可以使用 localStorage，但必须封装。
4. 如果项目已有本地 JSON 文件、Electron IPC、workspace storage 等持久化方式，优先复用项目已有方式。
5. 创建事件时自动生成：
   - id
   - createdAt
   - updatedAt
6. 修改事件时自动更新 updatedAt。
7. 删除事件时从本地存储中移除。
8. 返回数据按 startTime 升序排列。

---

## 2.3 本地存储 Key

如果使用 localStorage，可以使用：

```ts
const CALENDAR_EVENTS_STORAGE_KEY = 'aioffice.calendar.events.v1'
```

不要把存储 key 散落在多个文件中。

---

## 2.4 冲突检测

新增文件：

```text
src/calendar/calendarConflict.ts
```

定义：

```ts
export interface CalendarConflict {
  eventId: string
  title: string
  startTime: string
  endTime?: string
  status: CalendarEventStatus
  conflictLevel: 'hard' | 'soft'
}
```

新增函数：

```ts
export function detectCalendarConflicts(
  targetEvent: Pick<CalendarEvent, 'id' | 'startTime' | 'endTime' | 'allDay' | 'eventType'>,
  existingEvents: CalendarEvent[]
): CalendarConflict[]
```

### 时间重叠规则

```ts
const hasOverlap = newStart < existingEnd && newEnd > existingStart
```

### 冲突判断要求

1. 不和自己冲突。
2. `cancelled` / `declined` / `ignored` 不参与冲突。
3. `confirmed` 事件是 hard conflict。
4. `tentative` 事件是 soft conflict。
5. `deadline` 默认不阻塞时间，但可以作为 soft reminder。
6. `reminder` 默认不阻塞时间。
7. 没有 endTime 的普通事件默认按 30 分钟处理。
8. allDay 事件需要保守处理，可以作为 soft conflict。
9. 返回冲突列表，供 UI 和邮件回复使用。

---

## 2.5 CalendarWorkspace 接入真实数据

修改：

```text
src/pages/CalendarWorkspace.tsx
```

让页面支持：

1. 加载本地日程列表。
2. 按日期分组展示。
3. 点击某个日程后右侧显示详情。
4. 左侧筛选项可以筛选不同类型日程。
5. 顶部“新建日程”按钮可用。
6. 支持删除、忽略、确认日程。

---

## 2.6 筛选逻辑

左侧筛选项对应逻辑：

```ts
今天：
显示今天的日程

本周：
显示本周的日程

待确认日程：
status === 'tentative' || needsUserConfirmation === true

来自邮件：
source === 'email_ai' || source === 'email_user_confirmed'

有冲突：
conflictEventIds && conflictEventIds.length > 0

截止事项：
eventType === 'deadline'
```

---

## 2.7 日程卡片显示字段

中间列表中的每个日程卡片显示：

```text
标题
时间
状态
类型
来源
冲突标记
```

### 状态标签

```text
confirmed：已确认
tentative：待确认
declined：已拒绝
cancelled：已取消
ignored：已忽略
```

### 类型标签

```text
meeting：会议
interview：面试
deadline：截止事项
reminder：提醒
focus：专注
task：任务
```

### 来源标签

```text
manual：手动创建
email_ai：来自邮件
email_user_confirmed：邮件确认
imported：导入
```

---

## 2.8 右侧详情区

点击某个日程后，右侧详情区显示：

```text
标题
时间
地点
会议链接
描述
状态
类型
来源
来源邮件标题
来源发件人
冲突状态
参会人
```

### 操作按钮

```text
确认加入日程
修改时间
删除
忽略
查看来源邮件
生成回复
```

第一版实现：

```text
确认加入日程：status 改为 confirmed，needsUserConfirmation 改为 false
忽略：status 改为 ignored
删除：删除日程
```

可以暂时占位：

```text
修改时间
查看来源邮件
生成回复
```

但不要报错。

---

## 2.9 新建日程

顶部“新建日程”按钮需要可用。

点击后打开简单表单弹窗，或者右侧编辑区。

字段：

```text
标题
开始时间
结束时间
地点
描述
类型：会议 / 面试 / 截止事项 / 提醒 / 专注 / 任务
状态：已确认 / 待确认
```

保存时调用：

```ts
createCalendarEvent()
```

手动创建日程默认：

```ts
source: 'manual'
status: 'confirmed'
needsUserConfirmation: false
```

保存前调用：

```ts
detectCalendarConflicts()
```

如果有冲突：

1. UI 显示冲突提示。
2. 仍允许保存。
3. 把 conflictEventIds 写入新日程。
4. 日程卡片显示“有冲突”。

---

# 阶段 3：邮件 AI 分析接入 timeIntent

阶段 2 完成后，开始接入邮件模块。

目标：

```text
邮件分析时不仅判断重要性、分类、需不需要回复，还要识别是否包含时间要求。
```

---

## 3.1 扩展 EmailAnalysisResult

在现有邮件分析结果中新增：

```ts
timeIntent?: EmailTimeIntent
```

参考类型：

```ts
export interface EmailTimeIntent {
  hasTimeRequirement: boolean

  type:
    | 'meeting'
    | 'interview'
    | 'deadline'
    | 'reminder'
    | 'appointment'
    | 'candidate_times'
    | 'follow_up'
    | 'none'

  title?: string
  description?: string

  startTime?: string
  endTime?: string
  timezone?: string

  location?: string
  meetingLink?: string

  attendees?: Array<{
    name?: string
    email?: string
  }>

  candidateTimes?: Array<{
    startTime: string
    endTime?: string
    timezone?: string
  }>

  deadlineTime?: string

  confidence: number
  needsUserConfirmation: boolean

  sourceText?: string
}
```

---

## 3.2 邮件时间类型

邮件中的时间意图分为五类。

### 1. 明确会议时间

例如：

```text
会议定在 5 月 20 日下午 3 点到 4 点。
```

处理：

```text
提取 title / startTime / endTime / location / attendees
检测冲突
生成待确认日程
```

默认创建：

```ts
eventType: 'meeting'
status: 'tentative'
source: 'email_ai'
needsUserConfirmation: true
```

---

### 2. 面试安排

例如：

```text
The interview is scheduled for Friday, 10:00 AM - 10:30 AM.
```

处理：

```ts
eventType: 'interview'
status: 'tentative'
source: 'email_ai'
needsUserConfirmation: true
```

---

### 3. 截止事项

例如：

```text
请在周五下午 5 点前提交材料。
```

处理：

```ts
eventType: 'deadline'
status: 'tentative'
source: 'email_ai'
needsUserConfirmation: true
```

注意：

```text
deadline 不应该作为普通会议阻塞整个时间段。
```

---

### 4. 多个候选时间

例如：

```text
我周二下午、周三上午、周五 10 点都有空，你看哪个时间方便？
```

处理：

```text
不要直接创建一个确定日程
生成 candidateTimes
查询日历冲突
推荐无冲突时间
等待用户选择
```

---

### 5. 模糊约时间

例如：

```text
我们下周找个时间聊一下。
```

处理：

```text
不自动创建日程
生成约时间回复建议
```

---

## 3.3 邮件分析 Prompt 要求

AI 邮件分析时，需要输出结构化 JSON。

必须包含：

```text
importance
category
actionType
summary
reason
suggestedReply
timeIntent
```

timeIntent 要求：

1. 没有时间要求时：
   ```ts
   hasTimeRequirement: false
   type: 'none'
   ```
2. 有明确会议时间时，提取 startTime / endTime。
3. 有截止日期时，提取 deadlineTime。
4. 有多个候选时间时，填入 candidateTimes。
5. 时间不明确时，标记 needsUserConfirmation = true。
6. 所有时间必须尽量转成 ISO 字符串。
7. 不确定时不要胡编时间。

---

# 阶段 4：邮件详情页、日程卡片、冲突感知回复

阶段 3 完成后，把邮件与日程页面打通。

---

## 4.1 邮件详情页新增日程卡片

在邮件详情页中，如果当前邮件分析结果存在：

```ts
timeIntent?.hasTimeRequirement === true
```

则显示：

```text
检测到日程安排
```

根据不同情况展示不同 UI。

---

## 4.2 明确时间：无冲突

```text
检测到日程安排

事项：项目会议
时间：5月20日 15:00 - 16:00
地点：Zoom
状态：待确认
冲突：无冲突

[加入日程] [生成确认回复] [修改时间] [忽略]
```

点击“加入日程”：

1. 创建 CalendarEvent。
2. status = confirmed 或 tentative，根据用户动作决定。
3. source = email_user_confirmed。
4. 写入 sourceMessageId / sourceThreadId / sourceEmailSubject / sourceEmailFrom。
5. 日程出现在日程管理页面。

---

## 4.3 明确时间：有冲突

```text
检测到时间冲突

事项：项目会议
时间：5月20日 15:00 - 16:00
冲突：与 1 个已有日程冲突

建议：
该时间段已有安排，建议生成改期回复。

[生成改期回复] [查看冲突] [修改时间] [忽略]
```

注意：

```text
默认不要在邮件回复里暴露具体冲突事项。
```

回复里只写：

```text
我该时间段已有安排，是否可以调整到其他时间？
```

---

## 4.4 多候选时间

```text
检测到多个候选时间

请选择一个方便的时间：

○ 5月20日 14:00 - 15:00    有冲突
● 5月21日 10:00 - 11:00    推荐 · 无冲突
○ 5月22日 15:00 - 16:00    无冲突

[加入日程并生成回复] [只生成回复] [忽略]
```

逻辑：

1. 对每个 candidateTime 检测冲突。
2. 优先推荐无冲突时间。
3. 用户选择后创建 CalendarEvent。
4. 生成回复草稿。

---

## 4.5 截止事项

```text
检测到截止事项

事项：提交报销材料
截止时间：5月24日 17:00
来源：当前邮件

[加入截止提醒] [生成确认回复] [忽略]
```

创建：

```ts
eventType: 'deadline'
source: 'email_user_confirmed'
status: 'confirmed'
```

---

## 4.6 模糊时间

```text
检测到日程意图，但时间不完整

邮件中提到：“下周找个时间聊一下”
AI 无法确定具体时间。

建议：
查看你的空闲时间后，向对方提供可选时间。

[生成约时间回复] [手动创建日程] [忽略]
```

---

## 4.7 邮件列表标签

邮件列表中增加小标签：

```text
日程
待确认日程
时间冲突
截止事项
```

优先级：

```text
时间冲突 > 待确认日程 > 截止事项 > 日程
```

---

## 4.8 AI 邮件分析报告增加“日程发现”

在批量 AI 邮件分析 summary 中新增：

```text
日程发现

本次分析发现：
- 会议/面试安排：6 封
- 截止事项：4 封
- 多候选时间：2 封
- 时间冲突：1 封
- 已加入待确认日程：5 个
```

并列出：

```text
需要确认的日程
存在冲突的日程
截止事项
```

---

## 4.9 回复框上方新增日历检查提示

在邮件回复框上方显示日历检查结果。

### 无冲突

```text
已检查日历：该时间段无冲突
AI建议：可以确认参加

[使用确认回复]
```

### 有冲突

```text
已检查日历：该时间段已有安排
AI建议：回复对方请求改期

[生成改期回复] [查看空闲时间]
```

### 多候选时间

```text
已检查日历：推荐 5月21日 10:00 - 11:00

[使用推荐时间回复] [查看其他可选时间]
```

---

# 五、AI 回复生成策略

生成邮件回复前，必须检查日历。

流程：

```text
读取当前邮件分析结果
  ↓
检查 timeIntent
  ↓
如果不涉及时间，走原有回复逻辑
  ↓
如果涉及时间，查询 CalendarEvent[]
  ↓
检测冲突
  ↓
生成对应回复
```

---

## 5.1 无冲突回复

邮件：

```text
请问你明天下午 3 点是否有空参加项目会议？
```

日历无冲突。

回复：

```text
可以，我明天下午 3 点有空参加项目会议。请把会议链接或地点发给我，谢谢。
```

---

## 5.2 有冲突回复

日历已有安排。

回复：

```text
抱歉，我明天下午 3 点已有安排，可能无法参加这个时间段的会议。请问是否可以调整到明天下午 4 点之后，或后天上午？
```

注意：

```text
默认不要暴露具体冲突日程名称。
```

---

## 5.3 多候选时间回复

邮件：

```text
周二下午、周三上午、周五 10 点你哪个时间方便？
```

日历检查：

```text
周二下午冲突
周三上午空闲
周五 10 点空闲
```

回复：

```text
我周三上午或周五 10 点都可以，其中周三上午更方便。你看是否合适？
```

---

## 5.4 模糊时间回复

邮件：

```text
我们下周找个时间聊一下。
```

回复：

```text
可以。我下周二或周三下午比较方便，请问你哪个时间合适？
```

前提：

```text
AI 需要根据日历找出空闲时间。
```

第一版可以先只生成：

```text
可以，我们可以再确认一个具体时间。
```

---

# 六、UI 最终结构

最终应该有四个入口：

```text
1. 工作场景里的“日程管理”主入口
2. 邮件详情里的“检测到日程安排”卡片
3. AI邮件分析报告里的“日程发现”
4. 邮件回复框上方的“已检查日历”提示条
```

其中最重要的是：

```text
邮件详情里的日程卡片
回复框上方的日历冲突提示
```

日程页面主要是管理和查看。

---

# 七、不要做的事情

第一版不要做：

```text
Google Calendar 同步
Outlook Calendar 同步
CalDAV
复杂月视图
拖拽修改日程
周期性日程
会议室预订
多人空闲时间查询
复杂权限系统
自动无确认发送邮件
```

第一版先做内部闭环：

```text
内部日历
邮件识别
冲突检测
回复草稿
```

---

# 八、验收标准

## 阶段 1 验收

1. 工作场景首页出现“日程管理”卡片。
2. 图标为 CalendarClock。
3. 点击进入日程管理页面。
4. 页面包含左侧筛选、中间列表、右侧详情。
5. 构建通过。

## 阶段 2 验收

1. 可以手动新建日程。
2. 日程保存后出现在列表中。
3. 点击日程，右侧显示详情。
4. 可以确认、忽略、删除日程。
5. 刷新页面后日程仍然存在。
6. 创建两个重叠时间的日程时能检测冲突。
7. 有冲突的日程显示冲突标签。
8. 构建通过。

## 阶段 3 验收

1. AI 邮件分析结果中新增 timeIntent。
2. 普通无时间邮件不会生成 timeIntent。
3. 会议邮件能提取 startTime / endTime。
4. 截止事项邮件能提取 deadlineTime。
5. 多候选时间邮件能提取 candidateTimes。
6. 模糊时间邮件能标记 needsUserConfirmation。
7. 构建通过。

## 阶段 4 验收

1. 邮件详情页能显示“检测到日程安排”卡片。
2. 无冲突会议可以加入日程。
3. 有冲突会议可以生成改期回复。
4. 截止事项可以加入截止提醒。
5. 多候选时间可以选择一个时间加入日程。
6. 邮件列表能显示日程相关标签。
7. AI 邮件分析报告能显示“日程发现”。
8. 回复框上方能显示日历检查结果。
9. 生成邮件回复前会查询日历。
10. 构建通过。

---

# 九、实现原则

1. 不要重写现有邮件模块。
2. 不要破坏现有 AI 邮件分析和预回复功能。
3. 日程数据层要独立，不要把日程逻辑写死在邮件组件里。
4. 邮件和日程通过结构化字段连接：
   - sourceMessageId
   - sourceThreadId
   - timeIntent
5. 所有数量统计和冲突检测必须由代码计算，不要让 AI 猜。
6. AI 可以负责提取和生成文案，但不能替代业务规则。
7. 不允许硬编码联系人、邮箱、日程、时间。
8. 不允许出现 demo、mock、test、测试模式等字样。
9. 每个阶段完成后都要运行：
   ```bash
   npm run build
   ```
10. 如果某一步失败，不要跳过，要定位并修复。