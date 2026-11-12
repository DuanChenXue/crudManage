# 员工管理后台（Staff Admin）

小团队员工花名册管理系统，替代 Excel 传来传去。**不引用任何三方 UI 组件库**，Modal / Toast / 表单样式全部自绘。

## 快速开始

```bash
npm start
```

然后访问 <http://localhost:3000>

> 无需 `npm install`（`package.json` 中没有任何依赖声明）。要求 Node.js >= 22.5.0（需要内置 `node:sqlite`）。
> 换端口：`PORT=4000 npm start`

## 功能

| 编号 | 功能 | 说明 |
| --- | --- | --- |
| R-1 | 员工列表与检索 | 关键词（姓名/工号/手机号）+ 部门 + 状态组合筛选，每页 10 条 |
| R-2 | 新增员工 | 工号系统自动生成（`EMP` + 4 位自增），事务内生成防重号 |
| R-3 | 编辑员工 | 工号只读；**离职后禁止编辑**（前端置灰 + 后端 400 拒绝） |
| R-4 | 删除员工 | 二次确认，物理删除，分页自愈 |

## 技术选型说明

| 项 | 方案 | 说明 |
| --- | --- | --- |
| 后端框架 | `node:http` | Node 内置，替代 Express |
| 数据库 | `node:sqlite` | Node 内置，替代 `better-sqlite3` |
| 前端 DOM | **jQuery 3.7.1** | 本地引入 `public/vendor/`，非 CDN |
| 前端 UI | 原生 CSS + JS | **不使用 Bootstrap 或其他组件库**，Modal / Toast / 表单样式全部自绘 |

**关于 jQuery**：jQuery 是 DOM 工具库，不属于「UI 组件库」，因此与「不引用三方组件库」的约束不冲突。为满足内网离线可用与「`npm install` 零依赖」两点，jQuery 通过**本地文件**引入而非 CDN：

- 文件位置：`public/vendor/jquery-3.7.1.min.js`（87 KB，MIT 许可）
- SHA256：`fc9a93dd241f6b045cbff0481cf4e1901becd0e12fb45166a8f17f95823f0b1a`
- 引入方式：`<script src="/vendor/jquery-3.7.1.min.js"></script>`，位于 `app.js` 之前
- **未写入 `package.json` 依赖**，因此 `npm install` 仍为零依赖

**关于 Bootstrap**：项目**完全没有引入 Bootstrap**。表单控件样式、浮层（Modal）、提示条（Toast）均由 `public/css/style.css` + `app.js` 自绘，包含：遮罩居中层、遮罩点击关闭、ESC 关闭、Toast 3 秒自动消失。

## 目录结构

```
crudManage/
├── server.js              # HTTP 服务：静态托管 + 路由分发 + 统一响应 + access_log
├── routes/employees.js    # 员工接口 + 校验 + 业务约束
├── db/index.js            # 建表、连接、工号事务生成
├── data/staff.db          # SQLite 文件（自动创建）
├── public/
│   ├── index.html         # 唯一页面 + 3 个浮层
│   ├── js/app.js          # 列表/检索/分页/表单/删除/Toast（jQuery 实现）
│   ├── css/style.css      # 全部样式（含自绘 Modal / Toast）
│   └── vendor/
│       └── jquery-3.7.1.min.js
├── test/acceptance.js     # 验收测试（覆盖 PRD 第 4、9 节）
└── package.json
```

## 接口

统一响应体 `{ code, message, data }`，`code !== 0` 表示业务失败。

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET | `/api/employees?keyword=&department=&status=&page=1&pageSize=10` | 列表 + 检索 + 分页 |
| GET | `/api/employees/:id` | 单条详情（编辑回填） |
| POST | `/api/addEmployee` | 新增（工号后端生成） |
| PUT | `/api/employees/:id` | 编辑（离职记录 400 拒绝） |
| DELETE | `/api/delete/:id` | 删除 |
| GET | `/api/health` | 健康检查 |

状态码：200 成功 / 400 校验失败或业务拒绝 / 404 记录不存在 / 409 唯一键冲突 / 500 服务端异常。

## 验收测试

```bash
npm test
```

一条命令跑两套测试，**共 67 项断言**：

| 脚本 | 断言数 | 说明 |
| --- | --- | --- |
| `test/frontend-smoke.js` | 29 | 前端静态校验（无需浏览器）：依赖边界（无 Bootstrap、jQuery 本地引入）、浮层显隐兜底规则、XSS 转义、离职置灰、事件委托、表单字段与数据模型对齐 |
| `test/acceptance.js` | 38 | 后端验收：工号自动生成与不复用、前后端双重校验、离职禁编辑、组合检索、分页、并发不重号、数据库层唯一索引等 |

`acceptance.js` 无参运行时**自带隔离环境**（自动起服务 + 临时数据库，跑完销毁），不依赖、不污染开发数据；也可传已有服务地址：`node test/acceptance.js http://localhost:3000`（会向该库写入测试数据，勿用于生产库）。

## 关键实现说明

**工号不复用**：序号存在独立的 `counters` 表，不从 `MAX(emp_no)` 现算。删除记录后序号不回退，因此 `EMP0025` 被删后新增得到的仍是 `EMP0026`，不会捡回已删工号造成历史混淆（满足 PRD R-2 第 3 条验收）。

**并发防重号**：取序号、生成工号、插入三步包在 `BEGIN IMMEDIATE` 事务内，`emp_no` 另有 UNIQUE 索引兜底。

**离职禁止编辑**：前端列表按钮置灰（hover 提示），后端 `PUT` 前校验状态并返回 400——前端只是体验优化，后端是最终防线。

**过滤下推 SQL**：检索条件拼进 `WHERE` 由 SQLite 执行，不做全表捞出后应用层过滤。

**jQuery 用法要点**：
- 统一请求封装 `api()` 基于 `$.ajax`，把后端 `{ code, message, data }` 协议转成 Promise 语义（`code !== 0` 走 `reject`），业务代码只需 `.then(成功, 失败)`
- 表格行操作用**事件委托** `$('#tbody').on('click', '[data-act]', handler)`，行 DOM 重建后无需重新绑定
- 表格渲染用 `escapeHtml()`（内部走 `$('<div>').text(v).html()`）转义所有用户输入，防 XSS
- 搜索框用自实现 `debounce`，输入停止 300ms 后请求
- 浮层显隐统一用 `.prop('hidden', true/false)`，由 CSS `[hidden] { display: none !important; }` 保证生效

**浮层自绘的实现坑（已修）**：`.mask` 和 `.pager` 使用 `display: flex`，若直接依赖 HTML `hidden` 属性会失效（`display: flex` 优先级更高，导致遮罩常显、按钮点不动）。样式表顶部以 `[hidden] { display: none !important; }` 兜底解决。

## 已知限制（v1，与 PRD 非目标一致）

- 无登录与权限（假设运行在可信内网）
- 无 Excel 导入导出、无操作日志界面（`access_log` 表已记录，可用 SQL 查）
- 无移动端适配
- 离职为不可逆终态（PRD Q7 待产品确认，对应 P2 的 R-13）
- 工号超过 `EMP9999` 后自动进位为 5 位，不报错（PRD Q9）
- jQuery 为本地手动下载的静态文件，升级需自行替换 `public/vendor/` 下的文件
