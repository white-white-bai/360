# 教学平台 · all walks of life

一个**讲得出出处**的教学平台：学习者选一个主题，得到一堂有板书、能提问、末尾有检查的课——而课上每一句关于世界的话，都必须追溯到教材语料里的原文，由**内核**核对，而不是由模型保证（ADR 0004）。

平台现在有两条腿，走的是两个方向：

- **教材课**：先有教材，再有课。语料是精选的、逐句可追溯的，末尾有 Understanding Check（不明白就是没教会）。
- **直接课堂**（ADR 0011）：不建教材，和模型直接对话。主讲人靠提示词把知识点拆开、一次讲一个，质疑者在你露出错误直觉时上场。它**没有**语料校验，并且界面上全程标注这一点。

两种模式**不许互相冒充**——这是这个仓库最重要的一条规则。

## 现在能做什么

### 网页（板书）

```bash
cd platform
npm run board          # 打开 http://localhost:18087/
```

入口依次是：

- **怎么上**：直接课堂 / 教材课。
- **学什么**：输入任意主题。教材课下，主题匹配到已签字的 Domain 就直接上课；匹配不到就**现场造一份**——抓取公开来源、逐句证明引文出自原文（伪造引文整个构建作废并点名）、起草误解与检查题——完成后在页面上过目材料、在页面上签字，进目录才能上课（ADR 0010）。
- **怎么教 / 主讲人 / 质疑者 / 模型**：Persona 决定谁在说，Style 决定怎么说；两个 Position 可以是不同的声音，共享同一份内容与讲法（ADR 0009）。

课中随时可以提问（ADR 0008）：问题在下一个板书停顿处被接住，答案走和教学相同的两段通道——没通过校验就不上板。

直接课堂里，底部输入框就是对话本身：你说的每句话连同全部上下文直接进模型。全程标注**未校验**：没有检查、没有判分、不落记录，不进验收实验。

### 终端

```bash
npm run classroom -- "时区为什么有缺口"   # 直接课堂（ADR 0011）
npm run enter                             # 终端里的教材课；-- --followup <sessionId> 回访一节
npm run build-domain -- "<主题>"          # 造一份草稿（ADR 0010）
npm run review-domain -- <id>             # 过目、签字，进目录
npm run probe                             # provider 自检：打印端点/模型/key 长度，发一次最小调用
npm run validate                          # 校验全部教材资产
npm test                                  # 250+ 个测试（node --test，无框架）
npm run typecheck
```

**环境**（Node ≥ 22.6，无依赖，type-stripping 直接跑）。本项目当前接入的是 Command Code Provider API（OpenAI/Anthropic 双兼容）：

```bash
export ATP_API_KEY=...        # Command Code 的 API key（Studio → API keys；和 CLI 同一个 key）
export ATP_MODEL=...          # 目录里的模型 id，如 deepseek/deepseek-v4-flash
export ATP_BASE_URL=https://api.commandcode.ai/provider/v1
export ATP_ZDR=1              # 可选：零数据保留。只走 ZDR 上游；模型没有 ZDR 上游时请求 422 失败，而不是降级
```

几条边界，免得撞上：**Claude 模型只在 `/messages` 上应答**（走 `/chat/completions` 会 400），改用 `ATP_ANTHROPIC_MODEL` / `ATP_ANTHROPIC_API_KEY` / `ATP_ANTHROPIC_BASE_URL`（同样指向 `https://api.commandcode.ai/provider/v1`）；**Go 套餐没有 API 权限**（403 `upgrade_required`，401 才是 key 不对）；该提供商的端点里**没有 embeddings**，所以 RAG 阶段（Stage 1）要另找 embedding 源或走本地兜底。模型目录可直接看 `GET /provider/v1/models`（每个模型带 `supported_endpoints`）。

没有配置 provider 时：网页玩录播回放（只有一节：时间戳、时区与夏令时），直接课堂被锁——它的每句话都来自模型。

## 目录

| 路径 | 是什么 |
| --- | --- |
| `platform/` | 平台本体：内核、会话、构建器、校验器、服务器与单页界面 |
| `domains/` | 已签字的教材；每份含 meta / corpus / misconceptions / glossary / checks；现场造的还带 `sources.json` 与原文 `sources/`（原文不入库，引用在语料正文里） |
| `domains-draft/` | 未签字的草稿（gitignored） |
| `library/` | 全站共用的 Persona 与 Style |
| `professions/` | 行业目录：Category / Profession / Tier / Risk（ADR 0012） |
| `docs/adr/` | 决策记录，0001–0012——代码之前的每个决定都在这里 |
| `CONTEXT.md` | 术语表：代码与文档必须使用其中的词 |
| `.commandcode/skills/` | 本仓库自己的工程 skill 资产，和教学平台不是一回事 |

## 这个仓库的规矩（不是建议）

- 每句关于世界的话必须追溯到语料（Grounded Assertion）；比喻与例子必须以 Scaffold 的身份出现，绝不冒充结论。**提示词不能充当边界**——边界由内核执行。
- 没被提供的东西在门口拒绝，绝不默认（ADR 0007）；录播只播录下来的那一节。
- 教材要先有具体的人签字（签字人即 Owner），草稿与目录之间隔着这道门（ADR 0006、0010）。
- 先写 ADR，再写代码；术语跟随 `CONTEXT.md`。

## 状态与边界

- v1 进行中；ADR 0001 的验收实验**尚未运行**——"有没有教得更好"现在还没有数据。
- 高风险行业是关闭的：要两名独立审核人签字，目前无一家满足（ADR 0012）。
- 直接课堂是明确接受的取舍：快、任意主题，代价是不设防的边界；它永远不会计分、签字或声明接地（ADR 0011）。
