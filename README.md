<div align="center">

# dsh-jev-context

**这一轮需要的历史才带上，话题回来时再找回来。**

为 DeepSeek Harness 提供基于 JEV 相关度评分的上下文裁剪与召回，
用可视化面板记录每一轮保留了什么、收起了什么，以及上下文 token 的变化。

![Version](https://img.shields.io/badge/version-0.1.0-2C7A73)
![Node.js](https://img.shields.io/badge/Node.js-%E2%89%A522.19.0-339933?logo=node.js&logoColor=white)
![Platform](https://img.shields.io/badge/DeepSeek%20Harness-Plugin-4D6BFE)
![License](https://img.shields.io/badge/license-MIT-blue)

[使用效果](#使用效果) · [开始使用](#开始使用) · [工作方式](#工作方式) · [配置说明](#配置说明)

</div>

## 为什么做这个插件

长对话里经常混着不同任务：刚讨论完部署，又开始改界面，之后再回头处理部署问题。先前的内容不一定每轮都用得上，但回到旧话题时又可能需要。

`dsh-jev-context` 在每轮开始时，让 JEV 判断历史片段与当前请求的相关程度：暂时无关的先收起，再次相关时从原始会话日志恢复。它改变模型看到的上下文，保留原始历史记录。

- **按相关度选择历史**：为候选片段分别打分，低于阈值且足够大的片段替换成省略标记。
- **支持旧话题召回**：被收起的片段再次相关时恢复为带角色标记的文本记录。
- **保留近期内容**：默认保护最近 1 个片段，不交给 JEV 裁剪。
- **逐轮看得见**：面板展示片段相关度、保留与收起情况、上下文前后 token 数，以及跳过或失败原因。
- **只在轮次开头判断**：同一轮后续工具步骤不反复改写上下文。
- **判断失败不阻断对话**：未配置 Key、请求超时或响应异常时跳过本次选择，让原任务继续。

## 使用效果

[![JEV 上下文裁剪面板：跨会话统计、逐轮片段记录与配置入口](https://raw.githubusercontent.com/YIRC99/dsh-jev-context/master/docs/images/jev-context-console.png)](docs/images/jev-context-console.png)

*作者提供的实际使用截图，点击可查看原图。*

面板把三件事放在一起：左侧选择会话，右侧查看每轮的裁剪记录，下方配置 Key、相关度阈值和近期保留数量。

**截图中的 1,099,742 tokens 是该次面板记录的上下文净缩减合计，不是账单节省承诺，也不是性能基准。** 当前统计基于各会话保留的轮次记录，默认每个会话最近 12 条。召回可能增加上下文；实际费用还受主模型缓存命中、JEV 调用和后续请求影响。

## 开始使用

### 使用条件

- 已安装并可以运行 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)。
- Node.js **22.19.0 或更高版本**，以及 Git、pnpm。
- 自己的 **JEV / TypeSafe API Key**。

插件同时包含服务端逻辑和 Web 面板。宿主版本会影响设置面板、会话格式和逐轮记录能力，详见[兼容性说明](docs/DEVELOPMENT.md#宿主兼容性)。

### 从源码安装

```sh
git clone https://github.com/YIRC99/dsh-jev-context.git
cd dsh-jev-context
pnpm install
pnpm build
```

然后把本地目录加入正在使用的 Harness profile，将路径替换为你的实际目录：

```sh
dsh plugin --profile web add file:/absolute/path/to/dsh-jev-context
```

Windows 路径示例：

```powershell
dsh plugin --profile web add file:D:/code_file/dsh-jev-context
```

如果使用其他 profile，将 `web` 换成对应名称。安装后重启 `dsh web`，在侧栏底部打开 **「JEV 配置」**，填写 Key 并保存。

目前以 GitHub 源码安装为准；截至 2026-09-23，npm 注册表未查询到 `@yirc99/dsh-jev-context`。包名用于插件标识，不代表已经发布到 npm。

### 第一次使用

1. 打开侧栏底部的「JEV 配置」，展开配置区域。
2. 填入 JEV API Key，点击「保存」，保持上下文剪枝开关开启。
3. 在有历史内容的会话中发送新的请求。
4. 回到面板，查看本轮哪些片段被保留、收起，以及上下文变化。

没有 Key 或历史片段不足时，不会强行裁剪。保存 Key 后，后续决策会读取新配置，不需要再次安装插件。

## 工作方式

| 阶段 | 做什么 |
| --- | --- |
| 划分片段 | 按用户请求、目标轮次或队友消息等工作起点划分当前历史 |
| 提取摘要 | 为候选片段提取请求文本、回复文本的截断摘要及工具名称 |
| 判断相关度 | 将当前请求与候选摘要交给 JEV，独立评分 |
| 收起或召回 | 低相关片段换成省略标记；再次相关的已收起片段从日志恢复 |
| 记录结果 | 在支持的宿主上写入逐轮记录，汇总到 Web 面板 |

例如，前几轮在排查部署，现在转去调整按钮文案，部署片段可能被收起。之后问“继续刚才的部署问题”，如果相关度判断达到阈值且片段进入候选范围，就会恢复。

这是概率驱动的选择，可能遗漏摘要没有体现的信息。原始日志保留，并不等于每轮都能找回所有相关细节。

## 配置说明

设置命名空间为 `jev-context`。面板提供常用开关、Key、相关度阈值和近期保留数量；其他字段可通过宿主配置层设置。

| 字段 | 默认值 | 作用 |
| --- | --- | --- |
| `enabled` | `true` | 启用上下文选择 |
| `apiKey` | 未设置 | 直接配置 JEV Key，使用宿主的 secret 字段机制 |
| `apiKeyEnv` | `TYPESAFE_API_KEY` | 凭据引用或启动环境中的变量名 |
| `threshold` | `0.5` | 低于该分数的合格片段可被收起；提高阈值会更积极地裁剪 |
| `keepRecentSegments` | `1` | 始终保留的末尾片段数，这些片段不参与评分 |
| `minSegmentTokens` | `400` | 低相关片段达到该估算大小后才值得替换 |
| `maxSegmentsPerDecision` | `40` | 每次最多判断多少候选片段，优先取较近的候选 |
| `digestChars` | `320` | 每段请求、回复摘要各自的字符上限 |
| `retainedTurns` | `12` | 每个会话面板保留的轮次记录数，挂载时读取 |
| `model` | `jev-1.13.0` | JEV 模型 |
| `baseURL` | `https://api.typesafe.ai/v1` | API 基地址，程序会追加 `/systemone` |
| `timeoutMs` | `20000` | 单次判断请求的超时时间，单位毫秒 |

Key 的读取顺序是：直接配置的 `apiKey` → `apiKeyEnv` 指向的宿主凭据 → 启动环境变量。配置字段使用 secret 标记，远程设置读取不会回传明文 Key。

## 边界与隐私

- **会发起额外的模型请求**：当前请求、候选片段标签、请求与回复摘要、工具名称会发送到配置的 JEV 服务。摘要可能包含代码或私人内容，并非匿名统计。
- **保留原始会话日志**：裁剪通过追加替换事件改变模型可见内容，原始历史不被删除；逐轮记录也可能保留请求摘要和片段标签。
- **缩短上下文不一定省钱**：改写可能让主模型从最早变更处失去提示词缓存复用；频繁切换话题还会产生召回和额外判断成本。
- **判断依赖摘要**：仅存在于工具返回正文或被截断内容中的关键细节，可能无法被正确识别。
- **每轮会增加一次判断等待**：有合格候选且已配置 Key 时，JEV 请求处于主模型请求之前，默认最多等待 20 秒。
- **恢复形式有所不同**：召回使用带角色标签的文本记录，而非重新插入原始消息节点。

## 常见问题

**为什么装了插件却没有记录？**

先确认安装到了正在运行的 profile，并在安装后重启了 Web 服务。没有 Key、没有可裁剪的历史，或宿主缺少逐轮记录支持，都可能影响记录内容。旧宿主缺少相关能力时，插件会在日志中说明。

**关闭开关会把所有历史恢复吗？**

不会。关闭开关停止后续选择，不会自动把之前收起的片段全部展开。

**为什么显示“多花 tokens”？**

本轮恢复的历史可能比收起的更多。面板记录实际上下文净变化，出现增加也是正常情况。

**更新本地代码后为什么没有生效？**

本地安装会复制目录，不会跟随源码变动。重新构建后，需要从 profile 移除再添加，并重启 Web 服务，详见[开发说明](docs/DEVELOPMENT.md#本地更新)。

## 开发与反馈

- [开发、配置层与宿主兼容性](docs/DEVELOPMENT.md)
- [提交问题或建议](https://github.com/YIRC99/dsh-jev-context/issues)
- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)

反馈时请附上宿主与插件版本、profile、复现步骤和相关错误，去掉 Key 与私人会话内容。

## License

[MIT](LICENSE) · Copyright © 2026 yirc99
