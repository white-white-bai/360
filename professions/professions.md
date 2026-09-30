---
skeleton: 中华人民共和国职业分类大典（2022 年版）八大类
aliases-note: 三百六十行等民间称呼只作别名，不作分类
status-note: 职业的状态不由这里写死——签了 Domain 才是可学，高风险在两名独立审核人签字前一律未开放
---

# 行业目录（ADR 0012）
# 分类骨架是官方大典；「三百六十行」等民间称呼只作别名。
# 一行（职业）的状态是算出来的：签了 Domain 才是「可学」，高风险在两名独立审核人签字前一律「未开放」。

## state-organ
kind: category
name: 党的机关、国家机关、群众团体和社会组织负责人
scope: 治国理政与公共事务的中枢层

## professional
kind: category
name: 专业技术人员
scope: 以专业知识和技术手段工作的人群

## clerical
kind: category
name: 办事人员和有关人员
scope: 机关与企事业单位的行政事务执行层

## service
kind: category
name: 社会生产服务和生活服务人员
scope: 为生产与生活提供服务的执行层

## agriculture
kind: category
name: 农、林、牧、渔业生产及辅助人员
scope: 大农业的生产与辅助环节

## manufacturing
kind: category
name: 生产制造及有关人员
scope: 工业与建筑业的生产操作层

## military
kind: category
name: 军人
scope: 国防与武装力量；本平台不覆盖

## other
kind: category
name: 不便分类的其他从业人员
scope: 尚无归处的行业；本平台不主动覆盖

## software-developer
kind: profession
name: 软件开发人员
category: professional
tier: A
risk: ordinary
boundary: 教程序设计、工具链与工程实践——从编码规范到部署上线；不教硬件维修、行业业务逻辑与团队管理
domains:
  - time-zones
  - utf8-and-length
  - agent-dev-essentials
  - llm-agent-tool-calling
  - agent-app-dev-core
  - agent-app-development
  - claude-code-on-raspberry-pi
aliases:
  - 程序员
  - 软件工程师

## accountant
kind: profession
name: 会计专业人员
category: professional
tier: A
risk: ordinary
boundary: 教会计准则、账务处理与报表阅读，以公开准则为语料；不教具体企业的账、审计实操与税务筹划
aliases:
  - 会计
  - 出纳

## teacher
kind: profession
name: 教师
category: professional
tier: A
risk: ordinary
boundary: 教教学设计与课堂组织的一般方法，以公开教育研究为语料；不教某一学科的应试技巧与学校管理

## electrician
kind: profession
name: 电工
category: manufacturing
tier: B
risk: ordinary
boundary: 只教认知层——电路原理、安全规程与故障判断的文字知识，以国家标准为语料；实操必须跟师上手，本平台不替代
aliases:
  - 维修电工
  - 低压电工

## auto-mechanic
kind: profession
name: 汽车维修工
category: service
tier: B
risk: ordinary
boundary: 只教认知层——机械原理、故障码与维修规程的文字知识；拆装与诊断必须上车实践，本平台不替代
aliases:
  - 汽修工
  - 汽车修理工

## cook
kind: profession
name: 中式烹调师
category: service
tier: C
risk: ordinary
boundary: 只教认知层——食材特性、火候与食品安全知识；刀工火候是手上功夫，本平台不替代
aliases:
  - 厨师
  - 中餐厨师

## hairdresser
kind: profession
name: 美发师
category: service
tier: C
risk: ordinary
boundary: 只教认知层——发型理论、头皮与发质知识、卫生规范；剪烫染是手上功夫，本平台不替代
aliases:
  - 理发师
  - 美发师

## carpenter
kind: profession
name: 木工
category: manufacturing
tier: C
risk: ordinary
boundary: 只教认知层——木材特性、结构与榫卯知识、安全规程；手艺必须上手，本平台不替代
aliases:
  - 木匠

## nurse
kind: profession
name: 护士
category: professional
tier: B
risk: high
boundary: 教错了会直接伤人。在两名独立审核人签字之前不开放任何内容——包括直接课堂
domains:
aliases:
  - 护理
  - 护士

## lawyer
kind: profession
name: 律师
category: professional
tier: B
risk: high
boundary: 错误的法律建议会害人败诉。在两名独立审核人签字之前不开放任何内容——包括直接课堂
domains:
aliases:
  - 法律顾问
  - 律师
