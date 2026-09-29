## M-mcp-is-a-model
name: 把 MCP 当成模型或模型能力
wrongModel: MCP 是某个大模型或某项训练／微调技术，只要用上对的模型，工具调用能力就自动有了。
refutation: MCP 不是模型：它是一条开放协议，用来把 LLM 应用与外部数据源和工具无缝集成，并标准化如何把额外上下文与工具集成进 AI 应用生态。

## M-mcp-vendor-private
name: 把 MCP 当成私有适配层，逐个对接
wrongModel: 接工具就是给每个客户端、每个工具各写一套调用约定；MCP 只是某家厂商的私有封装，谈不上标准化。
refutation: MCP 是开放协议，提供把 LLM 与其所需上下文连接起来的标准化方式；它借鉴 Language Server Protocol 为整个开发工具生态标准化编程语言支持的做法，标准化上下文与工具的集成。

## M-annotations-trusted
name: 把工具注解当作安全依据
wrongModel: 工具清单里写的注解（例如“只读、不碰敏感数据”）就是工具行为的可信说明，宿主可以据此直接放行调用。
refutation: 工具行为的描述如注解应被视为不可信，除非来自可信服务器；工具代表任意代码执行，必须谨慎对待；宿主仍必须在调用任何工具前获得用户的显式同意。

## M-no-consent-needed
name: 认为工具调用与采样是模型／服务器的内部行为
wrongModel: 调用工具是模型自己发起并执行的技术动作，采样请求也是服务器内部流程，用户不必参与或被征求同意。
refutation: 宿主必须在调用任何工具前获得用户的显式同意；任何 LLM 采样请求也必须由用户显式批准。

## M-schema-only-structure
name: 把 JSON Schema 限定为结构描述／校验器
wrongModel: JSON Schema 只能声明字段和类型，用于生成文档或做校验，无法表达如何从 JSON 文档中提取信息、如何与之交互。
refutation: JSON Schema 既断言 JSON 文档必须是什么样，也说明从中提取信息的方式以及与之交互的方式；它本身是基于 JSON 的格式，媒体类型为 application/schema+json。

## M-vocabularies-optional
name: 认为 JSON Schema 词汇表可自由取舍
wrongModel: 词汇表都是可选插件，实现可以只挑自己要的那几个关键字，连核心词汇表也可以不实现或关掉。
refutation: 存在一个任何实现都必须支持、且不能被禁用的核心词汇表；方言是由词汇表组成、其必需支持在元模式中标识的一组。

## M-keyword-case
name: 认为小写 must／should 同样具有规范效力
wrongModel: 文档里写“must”“should”这些小写词，和要求级别关键字大写写法一样，都是规范要求。
refutation: 只有以全大写形式出现的那些关键字才按 BCP 14（RFC2119、RFC8174）解释；全小写写法不享有该解释。

## M-internal-means-safe
name: 认为自建／内部服务器就不涉及安全与信任
wrongModel: 只要服务器都是自己团队接的、只连内部系统，就不必再考虑安全与信任问题。
refutation: MCP 通过任意数据访问和代码执行路径提供强大能力，随之而来的安全与信任考量是所有实现者都必须认真处理的；工具代表任意代码执行，必须谨慎对待。
