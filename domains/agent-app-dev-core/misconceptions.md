## M-1
name: ReAct 等于思维链提示
wrongModel: ReAct 只是在提示词里让模型写出推理步骤，和调用外部工具的行动无关。
refutation: react-separate-topics 指出推理与行动此前主要被分开研究；react-interleaved-synergy 说明 ReAct 的核心是交错生成推理轨迹与任务特定动作，并让行动与外部来源交互获取信息。

## M-2
name: 工具描述和注解天然可信
wrongModel: 工具描述或注解既然写在工具接口里，就可以当作可靠文档，直接据此自动调用。
refutation: mcp-tool-descriptions-untrusted 明确：工具行为描述和注解应视为不受信任，除非来自受信任服务器。

## M-3
name: MCP 是模型训练或微调方法
wrongModel: MCP 是一种把外部数据微调进模型的技术，或者是一种新模型。
refutation: mcp-definition 说明 MCP 是开放协议，用于在 LLM 应用与外部数据源和工具之间实现无缝集成。

## M-4
name: 一次用户同意可覆盖后续所有工具调用
wrongModel: 只要安装或首次使用时用户点过一次『同意』，之后 Agent 每次调用工具都不需要再问。
refutation: mcp-tool-invocation-consent 要求宿主必须在调用任何工具前获得显式用户同意，一次性总同意不能替代逐次调用前的显式同意。

## M-5
name: 工具调用只是取数据，不是执行代码
wrongModel: 工具只是只读 API 调用或数据查询，不会带来代码执行风险，因此可以宽松处理。
refutation: mcp-tool-safety-caution 指出工具代表任意代码执行，必须谨慎对待。

## M-6
name: 推理轨迹只是给人看的，不影响行动
wrongModel: 推理轨迹主要用于展示可解释性，对模型下一步做什么没有实际作用。
refutation: react-interleaved-synergy 说明推理轨迹帮助模型诱导、跟踪和更新行动计划，并处理异常。

## M-7
name: MCP 标准化的是模型或语言支持
wrongModel: MCP 像 LSP 标准化编程语言一样，是在标准化模型接入或模型能力。
refutation: mcp-lsp-inspiration 说明 LSP 标准化如何在整个开发工具生态中添加对编程语言的支持；MCP 类似地标准化如何把额外上下文和工具集成到 AI 应用生态。

## M-8
name: 幻觉只能靠训练更好模型解决，与外部工具交互无关
wrongModel: 要减少幻觉和错误传播，只能换更大或更好的模型或继续训练，调用 Wikipedia API 这类外部工具没有帮助。
refutation: react-hallucination-mitigation 说明 ReAct 在 HotpotQA 和 Fever 上通过与简单 Wikipedia API 交互，克服思维链推理中常见的幻觉和错误传播。

## M-9
name: ReAct 需要大量示例或训练数据
wrongModel: 要让模型学会推理加行动，必须提供大量任务示例或进行训练。
refutation: react-interactive-benchmarks 说明在 ALFWorld 和 WebShop 上，ReAct 只用一个或两个上下文示例进行提示即可超过模仿和强化学习方法。

## M-10
name: MCP 只是连接协议，安全与协议无关
wrongModel: MCP 只负责把 LLM 接到外部数据和工具，安全信任是应用自己的事，协议本身不讨论。
refutation: mcp-security-intro 说明 MCP 通过任意数据访问和代码执行路径带来强大能力，同时带来所有实现者必须认真处理的安全与信任考量。

## M-11
name: 用户同意只需点击，不必理解
wrongModel: 用户只要点了同意，是否理解数据访问和操作并不重要。
refutation: mcp-user-consent-data 要求用户必须显式同意并理解所有数据访问和操作。

## M-12
name: ReAct 的优势只在可解释性，成功率不及训练方法
wrongModel: ReAct 主要价值是让轨迹更可解释，在交互式决策基准上未必比模仿学习或强化学习成功率更高。
refutation: react-interactive-benchmarks 说明 ReAct 在 ALFWorld 和 WebShop 上分别以 34% 和 10% 的绝对成功率超过模仿与强化学习方法。
