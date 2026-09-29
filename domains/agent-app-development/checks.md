## C-simplest
prompt: 团队要做一个需求稳定、步骤固定的合同摘要功能。按照语料建议，第一版应优先采用什么方案？
expected: 先采用最简可行方案；只有当需求确实需要时才增加复杂度。不要一开始就上 agentic 系统。
grounding:
  - P-simplest-solution
  - P-complexity-tradeoff
diagnoses:
  - 一开始就上 Agent/多 Agent，越复杂越自主越好 => M-complexity-first

## C-workflow-vs-agent
prompt: 某系统的 LLM 调用路径由代码预先写死：先抽取字段，再分类，最后生成回复。按语料定义，这是 workflow 还是 agent？
expected: 是 workflow，因为 LLM 和工具通过预定义代码路径编排；agent 是 LLM 动态主导自身流程和工具使用的系统。
grounding:
  - P-workflow-definition
  - P-agent-definition
diagnoses:
  - 由代码写死路径也算 agent，两者只是叫法不同 => M-workflow-is-agent

## C-framework
prompt: 两个开发者准备实现路由和提示链。语料建议他们第一步用什么？
expected: 从直接使用 LLM API 开始；许多模式只需少量代码即可实现，不必先引入框架。
grounding:
  - P-use-llm-apis-directly
diagnoses:
  - 必须先上编排框架，直接调 LLM API 不现实 => M-framework-first

## C-augmented
prompt: 要搭一个最小可用的 agentic 系统，语料指出除了 LLM 本身，基础构建块还应包含哪些增强？
expected: 检索、工具和记忆等增强；基本构建块是带增强的 LLM。
grounding:
  - P-augmented-llm
diagnoses:
  - 裸 LLM 就够，检索/工具/记忆只是后期可选优化 => M-bare-llm-enough

## C-prompt-chain
prompt: 一个三环节流程：第一步输出 JSON，第二步基于该 JSON 格式化，第三步基于格式化文本生成摘要。这最符合哪种工作流？
expected: Prompt chaining，因为它把任务分解为步骤序列，每次 LLM 调用处理上一次调用的输出。
grounding:
  - P-prompt-chaining
diagnoses:
  - 这属于单次 LLM 调用完成的多步生成 => M-chaining-is-single-call

## C-routing
prompt: 入口先判断用户问题属于退款、技术故障还是账单，再交给对应专用处理链。这最符合哪种工作流？
expected: Routing，因为它对输入进行分类并将其导向专用后续任务。
grounding:
  - P-routing
diagnoses:
  - 这是随机分流或并行分发，不需要先分类 => M-routing-is-random

## C-evaluator
prompt: 一个系统让 LLM A 写代码，LLM B 检查并给反馈，A 根据反馈修改，重复直到 B 通过。这符合哪种工作流？
expected: Evaluator-optimizer，因为一次 LLM 调用生成响应，另一次提供评估和反馈，并在循环中迭代。
grounding:
  - P-evaluator-optimizer
diagnoses:
  - 这只是生成模型自己检查一次，不需要评估者或循环 => M-evaluator-single-pass

## C-latency-cost
prompt: 一个 agentic 系统在基准上比固定 workflow 高 8 个点，团队认为它没有额外代价。按语料，这个判断漏掉了什么？
expected: 漏掉了 agentic 系统常用延迟和成本换更好任务性能的权衡；需要判断该权衡是否值得。
grounding:
  - P-complexity-tradeoff
diagnoses:
  - Agentic 只提升效果，不会增加延迟和成本 => M-agent-no-cost

## C-tool-safety
prompt: 某 MCP 工具只是查询数据库，不修改文件。能否认为它不涉及任意代码执行，因此无需安全审查？
expected: 不能；工具代表任意代码执行，必须按相应安全要求对待。
grounding:
  - P-tool-safety
diagnoses:
  - 查询工具不执行代码，无需安全控制 => M-tool-not-code

## C-annotation-consent
prompt: 一个从未连接过的 MCP 服务器在工具注解里写“本工具只读、无副作用”。客户端应据此注解自动允许调用吗？
expected: 不应。工具注解应视为不可信，除非来自受信任服务器；并且宿主必须在调用任何工具前获得显式用户同意。
grounding:
  - P-tool-annotations-untrusted
  - P-consent-before-tool-invocation
  - P-tool-safety
diagnoses:
  - 注解写了只读就可以自动调用 => M-trust-annotations
  - 接入时一次授权即可覆盖所有工具调用 => M-no-consent-tool

## C-user-data
prompt: 为了调用某个 MCP 服务器，需要把用户的历史对话发给它。服务器声明会保密。宿主是否可以直接发送？
expected: 不可以；宿主必须先获得显式用户同意才可把用户数据暴露给服务器。
grounding:
  - P-user-data-consent
diagnoses:
  - 服务器声明保密即可直接发送用户数据 => M-data-auto-share

## C-sampling
prompt: MCP 服务器想在对话中请求宿主侧的 LLM 做一次采样，用户没有点过同意。能否直接发起？
expected: 不能；用户必须显式批准任何 LLM 采样请求。
grounding:
  - P-sampling-approval
diagnoses:
  - 服务器可以自行采样，无需用户批准 => M-sampling-auto
