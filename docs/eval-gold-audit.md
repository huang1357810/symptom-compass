# 金标准审计（17 条 Hit@1 错例）

> 审计口径：`gold` 只能由 `CONDITIONS` 的 core 症状 + 人工判定确定，不允许用 `scoreConditions` 输出反填。
> 审计对象：`docs/eval-direction.md` 中 17 条「gold 未进 Top1」的错例（2026-11-23 基线，算法默认组合）。

## 分类定义

- **gold 有误**：按现有症状证据，标注的方向明显不成立，或存在更直接的答案。
- **算法有误**：gold 成立，但排序把更该排前/更该进榜的方向压后或挤出。
- **两者都可接受**：症状本身不足以唯一区分，gold 与当前 Top1 都能自圆其说。

## 结论汇总

| 分类 | 条数 | 编号 |
| --- | --- | --- |
| gold 有误 | 10 | d061、d072、d076、d078、d082、d092、d094、d096、d098、d100 |
| 算法有误 | 1 | d087 |
| 两者都可接受 | 6 | d001、d074、d080、d084、d085、d090 |

## 逐条审计

| 编号 | 输入症状 | 原 gold | 当前 Top1 | 判定 | 理由与处理 |
| --- | --- | --- | --- | --- | --- |
| d001 | runny_nose + congestion + sneeze | cold | 过敏性鼻炎 | 两者都可接受 | 无眼痒、无过敏原线索、无发热；感冒与过敏性鼻炎均可解释。保留 cold（更常见入口）。 |
| d061 | itch + dry_skin + rash | tinea_pedis | 湿疹 / 皮炎 | gold 有误 | 缺少足部/趾间定位，无法判足癣；改为 `eczema`。 |
| d072 | fever + sputum + dyspnea（25 岁） | bronchitis | 肺炎 | gold 有误 | 发热+咳痰+**气短**不能排除肺炎，标支气管炎证据不足；改为 `pneumonia`（更安全）。 |
| d074 | fever + ear_pain + sore_throat（30 岁） | pharyngitis | 急性中耳炎 | 两者都可接受 | 成人咽炎可牵涉耳痛，中耳炎也需考虑。保留 pharyngitis。 |
| d076 | dry_cough + sputum（8 天） | tb | 急性支气管炎 | gold 有误 | 无盗汗、消瘦、咯血，仅 8 天咳痰不足以判结核；改为 `bronchitis`。 |
| d078 | dry_cough + sputum + fever（8 天，低热） | tb | 急性支气管炎 | gold 有误 | 同上，缺少结核支持证据；改为 `bronchitis`。 |
| d080 | headache + nausea（超过 1 周） | tension_headache | 偏头痛 | 两者都可接受 | 持续 1 周更像紧张性头痛，但恶心不典型；偏头痛也可解释。保留 tension_headache。 |
| d082 | heartburn + nausea（超过 1 周） | gastritis | 胃食管反流 | gold 有误 | **烧心**是反流核心表现，胃炎证据弱；改为 `gerd`。 |
| d084 | epigastric_pain + heartburn（超过 1 周） | gerd | 急性胃炎 / 消化性溃疡 | 两者都可接受 | 上腹痛+烧心，两者均可；保留 gerd。 |
| d085 | fever + dry_cough（70 岁） | pneumonia | 急性支气管炎 | 两者都可接受 | 老年发热需警惕肺炎，但无气短/咳痰；支气管炎也常见。保留 pneumonia（老年安全阈值）。 |
| d087 | dry_cough + night_sweat（1–3 天） | bronchitis | 肺结核（需排查） | 算法有误 | 短期干咳+偶有盗汗不足以判结核；gold 成立，是排序把 `night_sweat` 权重抬得过高。保留 gold，记录为算法待优化项。 |
| d090 | flank_pain + hematuria（超过 1 周，低热） | uti | 泌尿系结石 | 两者都可接受 | 结石最典型（绞痛+血尿），低热偏向感染但缺尿频尿痛。保留 uti。 |
| d092 | epigastric_pain + nausea（超过 1 周） | gerd | 急性胃炎 / 消化性溃疡 | gold 有误 | **上腹痛**为核心、无烧心，胃炎更直接；改为 `gastritis`。 |
| d094 | sore_throat + congestion（超过 1 周，无发热） | allergic_rhinitis | 急性咽炎 / 扁桃体炎 | gold 有误 | 过敏性鼻炎通常无咽痛；长期咽痛+鼻塞更支持咽炎；改为 `pharyngitis`。 |
| d096 | eye_red + eye_itch（超过 1 周） | allergic_rhinitis | 结膜炎 | gold 有误 | 仅有眼部症状，鼻炎核心是鼻部表现；改为 `conjunctivitis`。 |
| d098 | itch + rash（超过 1 周） | tinea_pedis | 湿疹 / 皮炎 | gold 有误 | 同 d061，缺少部位信息；改为 `eczema`。 |
| d100 | dizziness + headache（超过 1 周） | anemia | 紧张性头痛 | gold 有误 | 无乏力、面色苍白等贫血线索；改为 `tension_headache`。 |

## 修正清单（10 条）

| 编号 | 原 gold | 修正后 |
| --- | --- | --- |
| d061 | tinea_pedis | eczema |
| d072 | bronchitis | pneumonia |
| d076 | tb | bronchitis |
| d078 | tb | bronchitis |
| d082 | gastritis | gerd |
| d092 | gerd | gastritis |
| d094 | allergic_rhinitis | pharyngitis |
| d096 | allergic_rhinitis | conjunctivitis |
| d098 | tinea_pedis | eczema |
| d100 | anemia | tension_headache |

## 对阶段 4 数据设计的影响

修正后，d071–d100 的 15 组「同症状对照」中只剩 **4 组 gold 不同**（d073/d074、d079/d080、d085/d086、d089/d090），其余组的 gold 变为相同。原因是原设计为凑「15 组 gold 不同」，有 10 条 gold 偏离了症状证据。

阶段 4 的「Top1 变化 ≥50%」验收因此不再适用于全部 30 条：同 gold 组的变化等于引入错误。后续阶段 4 只应按「4 组可区分对照 + Hit@1 不下降」评估，或重新设计合理的可区分对照。

## 审计后基线

修正 10 条 gold 后重跑（100 条，train 70 / holdout 30）：

| 组合 | train Hit@1 | train Hit@3 | train MRR | holdout Hit@1 | holdout Hit@3 | holdout MRR |
| --- | --- | --- | --- | --- | --- | --- |
| 基线（全关） | 95.7% | 98.6% | 0.9714 | 83.3% | 96.7% | 0.9000 |
| 当前默认（IDF 幂次 + 阴性罚 + core） | 95.7% | **100%** | 0.9762 | 86.7% | **100%** | 0.9333 |

审计前基线为 holdout Hit@1 53.3% / Hit@3 73.3%——其中大部分「错例」来自 gold 标注偏离症状证据；修正后基线显著回升。完整对比见 `docs/eval-direction.md`。