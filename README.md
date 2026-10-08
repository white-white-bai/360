# 教学平台 · all walks of life

一个**讲得出出处**的教学平台：学习者选一个主题，得到一堂有板书、能提问、末尾有检查的课——课上每一句关于世界的话，都必须追溯到教材语料里的原文，由**内核**核对，而不是由模型保证（ADR 0004）。

仓库里现在跑着两套栈（ADR 0013 的决定）：`platform/` 是 TypeScript 的教材平台；`agent/` 是按《AI 大模型应用全栈开发知识体系》分期落地的 Python agent 服务。两套共用同一批知识资产与学习记录——**共享的是文件本身，不是副本**。

## 两条腿，两扇门

- **教材课**：先有教材，再有课。语料精选、逐句可追溯，末尾有 Understanding Check（不明白就是没教会）。
- **直接课堂**（ADR 0011）：不建教材，和模型直接对话。主讲人靠提示词把知识点拆开、一次讲一个，质疑者在你露出错误直觉时上场。它**没有**语料校验，界面上全程标注这一点。

agent 服务把这两条腿做成了**同一个图上的两种模式**：**grounded** 先检索再回答，另一个 actor 逐条核对（能引用就必须引用，搜不到就说语料没有）；**chat** 就是直接课堂。两种模式**不许互相冒充**——这是这个仓库最重要的一条规则。

## 现在能做什么

### 网页（板书）

```bash
cd platform
npm run board          # 打开 http://localhost:18087/
```

- **怎么上**：直接课堂 / 教材课。
- **学什么**：输入任意主题。教材课下，匹配到已签字的 Domain 就直接上课；匹配不到就**现场造一份**——抓取公开来源、逐句证明引文出自原文（伪造引文整个构建作废并点名）、起草误解与检查题——过目材料、在页面上签字，进目录才能上课（ADR 0010）。
- **怎么教 / 主讲人 / 质疑者 / 模型**：Persona 决定谁在说，Style 决定怎么说；两个 Position 可以是不同声音，共享同一份内容与讲法（ADR 0009）。

课中随时可以提问（ADR 0008）：问题在下一个板书停顿处被接住，答案走和教学相同的两段通道。直接课堂里，底部输入框就是对话本身。

### 终端

教材平台（`cd platform`）：

```bash
npm run classroom -- "时区为什么有缺口"   # 直接课堂（ADR 0011）
npm run enter                             # 终端里的教材课；-- --followup <sessionId> 回访一节
npm run build-domain -- "<主题>"          # 现造一份草稿（ADR 0010）
npm run review-domain -- <id>             # 过目、签字，进目录
npm run probe                             # provider 自检：端点/模型/key 长度，各一次最小调用
npm run validate                          # 校验全部教材资产
npm test                                  # 269 个测试（node --test，无框架）
```

agent 服务（`cd agent`；一次性 `python -m venv .venv && .venv\Scripts\pip install -e ".[dev]"`）：

```bash
.venv\Scripts\python -m agent.probe                        # provider 自检（chat + embeddings）
.venv\Scripts\python -m agent.search "时区是怎么定义的"      # 混合检索 + LLM 重排，每条带出处
.venv\Scripts\python -m agent.chat "时区为什么有缺口"        # grounded：检索 → 回答 → 独立校验
.venv\Scripts\python -m agent.chat "时区是什么" --mode chat  # 直接课堂
.venv\Scripts\pip install -e ".[ui]" && .venv\Scripts\python -m agent.ui   # Gradio 原型页
.venv\Scripts\python evals\retrieval.py                    # golden 查询命中率
.venv\Scripts\python evals\grounding.py                    # 整图评测：首考通过、拒答诚实、成本
```

整个栈一条命令（Docker）：

```bash
cd agent
docker compose up --build    # agent :18088 + 板书 :18087，共享同一批资产
```

MCP（把工具递给别的 agent；**签字工具不在协议里**，builder 默认关）：

```powershell
cmd mcp add teaching -- "D:\all-walks-of-life\agent\.venv\Scripts\python.exe" -m agent.mcp_server
```

### 环境

本项目当前接入的是 Command Code Provider API（OpenAI/Anthropic 双兼容）：

```bash
export ATP_API_KEY=...        # Command Code 的 API key（Studio → API keys；和 CLI 同一个 key）
export ATP_MODEL=...          # 目录里的模型 id，当前选用 deepseek/deepseek-v4.1-flash（1M 上下文）
export ATP_BASE_URL=https://api.commandcode.ai/provider/v1
export ATP_ZDR=1              # 可选：零数据保留。只走 ZDR 上游；没有 ZDR 上游时 422 失败，而不是降级
```

不方便动 `setx`/`export` 也行：把这几行写进仓库根目录的 **`.env`**——两套栈的入口都会读它；已进 `.gitignore`，永不提交；同名变量进程环境优先。

几条边界，免得撞上：**Claude 模型只在 `/messages` 上应答**（走 `/chat/completions` 会 400），用 `ATP_ANTHROPIC_MODEL` / `ATP_ANTHROPIC_API_KEY` / `ATP_ANTHROPIC_BASE_URL`；**Go 套餐没有 API 权限**（403 `upgrade_required`，401 才是 key 不对）；该提供商**没有 embeddings 端点**——agent 的检索用本地多语模型兜底，不需要联网。模型目录见 `GET /provider/v1/models`。

没有配置 provider 时：网页玩录播回放（只有一节：时间戳、时区与夏令时），直接课堂被锁。

## 目录

| 路径 | 是什么 |
| --- | --- |
| `platform/` | 教材平台（TypeScript）：内核、会话、构建器、校验器、板书服务器与单页界面 |
| `agent/` | agent 服务（Python）：RAG、LangGraph 图、工具、MCP server、Gradio 页、评测与部署 |
| `domains/` | 已签字的教材；现场造的还带 `sources.json`（抓取的原文在 `sources/`，不入库，出处引用在语料正文里） |
| `domains-draft/` | 未签字的草稿（gitignored） |
| `library/` · `professions/` | 全站共用的 Persona 与 Style；行业目录（ADR 0012） |
| `platform/.sessions/` | 学习者的课堂记录（gitignored；agent 的 memory **只读**它） |
| `agent/.state/` | agent 的会话检查点（gitignored） |
| `docs/adr/` | 决策记录，0001–0013——代码之前的每个决定都在这里 |
| `CONTEXT.md` | 术语表：代码与文档必须使用其中的词 |
| `.commandcode/skills/` | 本仓库自己的工程 skill 资产，和教学平台不是一回事 |

## 这个仓库的规矩（不是建议）

- 每句关于世界的话必须追溯到语料（Grounded Assertion）；比喻与例子以 Scaffold 的身份出现，绝不冒充结论。**提示词不能充当边界**——边界由内核执行。
- 没被提供的东西在门口拒绝，绝不默认（ADR 0007）；录播只播录下来的那一节。
- 教材要先有具体的人签字（签字人即 Owner）；草稿与目录之间隔着这道门（ADR 0006、0010）。
- 先写 ADR，再写代码；术语跟随 `CONTEXT.md`。
- **新栈加的三条**：引用 id 必须出自本轮检索，内核先查、再付钱请校验者思考（引文证明搬到了说话时刻）；**杠杆要测量后才默认开**（query 改写实测无增益，默认关）；memory 只读——课堂对话从不写回测量记录。

## 状态与边界

- ADR 0013 的分期全部落地：Stage 0 骨架 → 1 RAG（golden hits@K **5/5**）→ 2 Agent 图（有界 ReAct + 独立校验 + 质疑者）→ 3 MCP + 评测（可回答题 **3/3**、首考通过 **1/3**、不可回答题老实说"语料查不到"）→ 4 交付（compose 整套真机验证）。
- 测试：教材平台 **269**、agent **74**，全绿。
- ADR 0001 的验收实验**仍未运行**——"有没有教得更好"还没有数据；`agent/evals/` 是它的种子指标。
- 明确未落地：FineTuning 与多模态视觉（本机 GPU 是 GT 710，且无必要）；内容安全只有预留位置；K8s 清单与 vLLM 文档未在任何地方验证过；高风险行业关闭（ADR 0012）。
- 直接课堂是明确接受的取舍：快、任意主题，代价是不设防的边界；它永远不计分、不签字、不声明接地（ADR 0011）。
