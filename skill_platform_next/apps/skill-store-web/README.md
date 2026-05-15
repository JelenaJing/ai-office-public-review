# skill-store-web（独立前端）

该目录是新商店前端占位目录，仅用于展示、购买、授权状态，不承担 Skill 安装与执行。

## 功能边界

- 允许：浏览 Skill、查看详情、购买、查看授权状态。
- 禁止：下载 `.aoskill`、导入包、执行 Skill。

## 依赖接口

- `GET /store/skills`
- `GET /store/skills/{skillId}`
- `POST /store/skills/{skillId}/purchase`
- `GET /store/my-purchases`

