# 开发与宿主兼容性

## 本地开发

```sh
pnpm install
pnpm build
pnpm typecheck
```

`pnpm build` 生成 `lib/index.js`（服务端）和 `lib/client.js`（浏览器端）。`prepare` 和 `prepack` 也会执行构建。当前包发布 JavaScript，不声明不存在的类型声明产物。

`pnpm typecheck` 对照 `devDependencies` 中的 Harness API 检查类型。项目使用了一些随宿主演进的接口，类型检查失败时应先核对宿主依赖是否具备对应 API，不应将构建成功当成全部兼容性验证。

`typecheck:local` 依赖被 Git 忽略的 `tsconfig.local.json`，属于本机源码联调配置；普通克隆不包含该文件。

## 本地更新

将本地目录安装到 profile 时，宿主保存的是副本。后续修改和构建不会自动更新已安装版本；重复 `add` 也可能只提示已经是最新状态。

重新构建后，替换对应 profile 内的安装副本：

```sh
dsh plugin --profile web remove @yirc99/dsh-jev-context
dsh plugin --profile web add file:/absolute/path/to/dsh-jev-context
```

将 `web` 和目录替换成实际值，然后重启 `dsh web`。

## 包结构与加载

| 位置 | 职责 |
| --- | --- |
| `src/index.ts` | 配置 schema、凭据解析与 `agent/pre-step` 接入 |
| `src/engine.ts` | 每轮候选选择、裁剪与召回决策 |
| `src/segments.ts` | 片段边界、原始事件引用与摘要提取 |
| `src/jev.ts` | JEV 请求构造和响应校验 |
| `src/prune.ts`、`src/render.ts` | 省略标记与召回文本 |
| `src/ledger.ts`、`src/projection.ts` | 逐轮记录与面板投影 |
| `src/client/` | Web 面板、配置交互和中英文文案 |
| `cordis.patch.yml` | 安装后贡献给 profile 的配置层 |

`package.json` 的 `dsh.bundle.patch` 与 `dsh.client` 同时声明配置层和浏览器入口，一次安装即可加载两部分，无需手动添加第二个配置项。

必须保留 `exports["./cordis.patch.yml"]`。缺少导出时，包可能安装成功并出现在 bundle 列表中，但 profile 组合时无法加载配置层。

## 上下文改写

插件在每轮第一个 `agent/pre-step` 中、主模型请求构造之前执行选择。同一轮后续步骤不重复判断，以减少请求前缀反复变化。

片段从新工作单元开始，包括人工请求、目标轮次和队友消息。省略与召回标记本身也作为片段起点，并通过引用追溯原始事件，使后续多轮仍能识别原片段。

每次替换先追加 `compaction/prune`，再紧接着追加带来源引用的 `user/message`；两次追加之间没有异步等待。这沿用宿主的 shadow-price 计量机制，原始字节仍保存在会话日志中。召回内容表现为带角色标签的文本，而非恢复原始消息节点。

服务不可达、Key 缺失或评分响应异常时，不应用本次选择。若一轮包含多个改写且中途追加失败，已成功的改写会保留，其余停止；记录按实际完成情况报告，不承诺整轮事务回滚。

## 宿主兼容性

项目清单声明的核心 peerDependencies 覆盖 `0.1.5-alpha.1`、`0.1.6-alpha.1`、`0.1.7-alpha.1` 所在的版本范围；开发依赖基线为 `0.1.7-alpha.2`。这些声明不能替代具体宿主构建上的实机验证。

### 会话格式

- 会话格式 3 及更早版本，注入标记使用带包名的 `kind: 'plugin'`。
- 会话格式 4 使用插件自己的 `kind: 'jev-context'`。
- 运行时根据 `SESSION_FORMAT_VERSION` 选择，不能把来源形状写成不随宿主变化的常量。

### 逐轮记录

逐轮事件类型为 `context-jev/turn`。宿主若没有安装本插件，就不会认识这一事件类型，因此写入时必须带宿主支持的 `ignorable` 标记，让其他读取者能够跳过它。

旧宿主不支持这一写入能力时，插件在挂载时提示一次，并关闭逐轮记录；上下文选择仍可运行，面板不能因此被当成完整运行证据。

### 设置面板

配置面板需要宿主提供 `settings.installSection`。缺失时记录提示并退回配置层，不强行安装设置入口。Web 控件还取决于相应的客户端设置能力。

## 统计口径

每条记录的 `tokensSaved` 等于本轮改写前后的模型可见上下文 token 估算差值。恢复内容可能让该值为负。

投影只保留最近 `retainedTurns` 条记录，默认 12 条。各会话汇总来自这些保留记录，跨会话总数是面板已获得投影的各会话汇总；它不是无限历史累计账单，也不是经过提供商计费核对的净收益。

JEV 的判断成本、主模型缓存失效、后续步骤的请求量，都要另外考虑。README 不承诺固定延迟、节省比例或服务商现行价格。

## 数据与凭据

JEV 请求包括当前请求原文、候选片段标签、截断的请求与回复文本，以及工具名称。`digestChars` 分别限制每个片段的请求和回复摘要长度，不代表整个请求被限制为该长度。

Key 优先从 `apiKey` 读取，其次解析 `apiKeyEnv` 指向的宿主凭据，再尝试启动环境。`apiKey` 使用 secret schema，远程设置读取只提供配置状态而非明文。

不要在文档、截图、示例配置、Git 提交或反馈日志里写入实际 Key。
