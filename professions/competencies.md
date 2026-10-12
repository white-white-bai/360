---
units-note: 能力单元（ADR 0015）：一个职业「必须会、且要能用上」的单元，由已签字的 Domain 背书
beyond-note: beyond 是这张地图的后半张——本平台不教的部分，和该由什么来教；答「无」也是回答
order-note: requires 说出先后；一个职业的单元全都没有先修，学习者读到的就是清单而不是路线
---

# 能力单元（ADR 0015）
# 中间层：Profession → Competency → Domain。状态由签字算出——教它的 Domain 里签了一个，才算「可学」。
# 每个单元必须答出 beyond：这一单元里本平台不教的部分，以及该由什么来教。

## data-representation-basics
kind: competency
profession: software-developer
name: 数据的表示与编码
boundary: 只讲公开规范里写死的东西——编码形式、码点与字符编号的区别、时区与偏移量的定义；不讲师门习惯与实现取舍
domains:
  - utf8-and-length
  - time-zones
beyond:
  - 无——这一单元完全落在认知层

## tool-calling-loop
kind: competency
profession: software-developer
name: 工具调用与 Agent 循环
boundary: 讲一次模型调用如何带工具、结果如何回灌、循环为何必须有界；不评价某个框架的工程成熟度
domains:
  - llm-agent-tool-calling
  - agent-dev-essentials
requires:
  - data-representation-basics
beyond:
  - 无——这一单元完全落在认知层

## agent-app-build
kind: competency
profession: software-developer
name: 应用的构建与工程实践
boundary: 讲把检索、图与校验接成一个能跑的应用时，哪些边界由内核而非提示词执行；不教具体云厂商的选型
domains:
  - agent-app-dev-core
  - agent-app-development
requires:
  - tool-calling-loop
beyond:
  - 无——这一单元完全落在认知层

## agent-operations
kind: competency
profession: software-developer
name: 生产部署与成本治理
boundary: 本平台对该单元没有任何已签字 Domain，因此不主张能教它
requires:
  - agent-app-build
beyond:
  - 生产级部署、容量规划与成本运维不在本平台教——现有 Agent 教材的边界句都明确排除了它；由真实上线环境、云服务商与承担运维责任的团队来教

## coding-agent-workflow
kind: competency
profession: software-developer
name: 编码代理的工作方式
boundary: 讲编码代理如何读仓库、改文件、跑命令，以及在受限设备上有什么取舍；不教这门手艺的团队协作规范
domains:
  - claude-code-on-raspberry-pi
requires:
  - data-representation-basics
beyond:
  - 树莓派 GPIO 与外设硬件编程不在本平台教——由硬件实验与跟师实操来完成
