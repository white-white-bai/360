## M-annotation-trusted
name: 注解即可信声明
wrongModel: 工具的注解和描述是服务器提供的元数据，读一读就能判断这个工具安不安全，可以照它说的直接用。
refutation: 语料明确要求把工具行为的描述（例如注解）视为不可信，除非它来自可信服务器；注解是待验证的输入，不是安全凭证。

## M-consent-implicit
name: 启动即授权
wrongModel: 用户既然已经打开并使用了这个宿主应用，就等于默认同意调用它背后的任何工具，不需要每次单独征求同意。
refutation: 规范要求宿主在调用任何工具之前必须获得用户显式同意；使用应用本身不构成对某个具体工具调用的显式同意。

## M-tool-harmless-data
name: 工具只是数据通道
wrongModel: 工具调用不过是从外部数据源取点数据读一读，属于只读操作，不需要按高危能力对待。
refutation: 规范指出工具代表任意代码执行，必须谨慎对待；工具不等同于只读数据访问。

## M-mcp-equals-safety
name: 接入协议即安全保证
wrongModel: 既然 MCP 是让 LLM 应用与外部工具无缝集成的开放协议，那用 MCP 接进来的工具就是被协议背书过的、可以放心调用。
refutation: 同一份规范把工具定义为任意代码执行、要求谨慎对待、要求显式同意、并把注解视为不可信；MCP 解决的是接入方式，不提供工具安全性背书。

## M-react-two-phases
name: 先想完再做
wrongModel: ReAct 就是两段式流程：先用思维链把完整行动计划一次性想好，然后再进入执行阶段去行动。
refutation: 语料强调推理轨迹与任务特定行动是交错进行的：推理轨迹帮助模型归纳、跟踪、更新行动计划并处理异常，行动则去外部来源取回信息反哺推理，二者互为输入，而非一次性规划后执行。

## M-react-needs-training
name: 必须训练才能用
wrongModel: 要让 Agent 会推理加行动，必须用模仿学习或强化学习去训练模型，或者至少准备大量示例。
refutation: 语料显示在 ALFWorld 与 WebShop 上，ReAct 只用一到两个上下文示例进行提示，就比模仿学习和强化学习方法分别高出 34% 与 10% 的绝对成功率。

## M-trace-cosmetic
name: 推理轨迹只是装饰
wrongModel: 链路里真正有用的是行动和结果，推理轨迹只是给模型自己看的中间产物，去掉它照样能解决问题，也无助于排查。
refutation: 语料指出推理轨迹帮助模型归纳、跟踪和更新行动计划并处理异常，且在 HotpotQA 与 Fever 上，带推理轨迹产生的任务求解轨迹比不含推理轨迹的基线更可解释，并克服了幻觉与错误传播。

## M-schema-validation-only
name: JSON Schema 只管校验
wrongModel: JSON Schema 的唯一用途是判断一份数据是否合法，和文档说明、超链接导航、交互控制都没关系。
refutation: 语料说明 JSON Schema 的意图涵盖校验、文档说明、超链接导航与交互控制，它同时断言 JSON 文档必须长什么样、如何从中提取信息以及如何与之交互。

## M-core-vocab-optional
name: 核心词汇表可裁剪
wrongModel: 为了精简体积或加快启动，实现可以只支持自己用到的那部分 JSON Schema 关键字，把核心词汇表里其余部分关掉。
refutation: 语料规定存在一个核心词汇表，任何实现都必须支持且不能禁用。

## M-semconv-page-current
name: GenAI 语义约定页仍是权威
wrongModel: OpenTelemetry 的生成式 AI 语义约定页面就是当前维护中的权威列表，直接照它取属性名即可。
refutation: 该页面已迁移，不再在此仓库维护；据此页取用属性名会落到不再维护的内容上。
