# 方向评测（Hit@1 / Hit@3 / MRR）

> 由 `tools/eval-direction.js` 自动生成。数据集 `data/direction-eval.json`：100 条（train 70 / holdout 30）。
> gold 由 `CONDITIONS` 的 core 症状 + 人工判定确定，未使用 `scoreConditions` 输出反填。

## 当前指标

| 分组 | 条数 | Hit@1 | Hit@3 | MRR |
| --- | --- | --- | --- | --- |
| train | 70 | 95.7% | 98.6% | 0.9714 |
| holdout | 30 | 86.7% | 96.7% | 0.9167 |
| 全部 | 100 | 93.0% | 98.0% | 0.9550 |

## 改动前后对比

| 阶段 | 算法 | train Hit@1 | holdout Hit@1 | train Hit@3 | holdout Hit@3 | train MRR | holdout MRR | 结论 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 阶段 0 · 基线（gold 审计后） | hit / total | 0.9571 | 0.8333 | 0.9857 | 0.9667 | 0.9714 | 0.9000 | 修正 10 条 gold 后重算 |
| 阶段 1 · IDF+平滑 | hit/(hit+0.4(total-hit)+0.2) | 0.9571 | 0.8667 | 0.9857 | 0.9667 | 0.9714 | 0.9167 | 未胜出：holdout Hit@3 未提升（96.7%），不启用 |
| 阶段 1 · IDF+幂次 | hit/total^0.7 | 0.9571 | 0.8667 | 1.0000 | 1.0000 | 0.9762 | 0.9278 | 已启用：holdout Hit@3 96.7%→100%；7 条非红旗 Top1 不变，胸痛+气短仍判红 |
| 阶段 2 · 阴性按权重罚 | hit/total + negPenalty | 0.9571 | 0.8667 | 1.0000 | 1.0000 | 0.9762 | 0.9278 | 已开启：10 组混淆对 10/10；评测集无否定，指标同阶段 1 |
| 阶段 3 · core 加成（v2 下） | score×min(1.2,1+0.08·core) / hit≥0.8 | 0.9571 | 0.8667 | 1.0000 | 1.0000 | 0.9762 | 0.9333 | 已开启：holdout MRR +0.0055 |
| 阶段 4 · 乘子加强 ×1.15/×0.85/×1.10 | typicalDays ±15% + 年龄 ×1.10 | 0.9571 | 0.8000 | 1.0000 | 0.9667 | 0.9786 | 0.8833 | 回退：30 条仅变化 5/30（16.7%，要求 ≥50%），Hit@1/Hit@3 回落；gold 审计后仅 6 组可区分 |
| 阶段 5 · 阈值网格（审计前） | minScore 0.12–0.30 | 0.9571 | 0.8667 | 1.0000 | 1.0000 | 0.9762 | 0.9333 | 暂保持 0.18；未在审计后数据上重跑网格 |
| 阶段 6 · 分母回退 + 证据降权 | IDF+smooth / evidence ×0.55 | 0.9571 | 0.8667 | 0.9857 | 0.9667 | 0.9714 | 0.9167 | 已启用：优先 Top3 合理性；holdout Hit@3 100%→96.7%（≥70% 达标），手足口病/中暑被挤出 Top3 |

## 8 个典型输入 Top1（回归对比）

| 输入 | 症状 id | 当前 Top1 |
| --- | --- | --- |
| 咽痛+发热 | sore_throat, fever | 急性咽炎 / 扁桃体炎 |
| 腹泻+恶心 | diarrhea, nausea | 急性胃肠炎 |
| 胸痛+气短 | chest_pain, dyspnea | 肺炎 |
| 头痛+恶心 | headache, nausea | 偏头痛 |
| 咳嗽+黄痰 | dry_cough, sputum | 急性支气管炎 |
| 高热+咽痛 | fever, high_fever, sore_throat | 急性咽炎 / 扁桃体炎 |
| 皮疹+发热 | rash, fever | 湿疹 / 皮炎 |
| 腹痛+呕吐 | abdominal_pain, vomiting | 急性胃肠炎 |

## 临床合理性（Top3）

> 原则：**优先保证 Top3 不出现明显不相关方向，其次追求 Hit@3**。
> 「改动前」= IDF + 幂次分母（无证据降权）；「改动后」= IDF + 平滑分母 + 证据充分性降权。

| 输入 | 改动前 Top3 | 改动后 Top3 |
| --- | --- | --- |
| 咽痛+发热 | 急性咽炎 / 扁桃体炎 / 手足口病 / 流行性感冒 | 急性咽炎 / 扁桃体炎 / 流行性感冒 / 普通感冒 |
| 干咳+咳痰 | 急性支气管炎 / 肺炎 / 肺结核（需排查） | 急性支气管炎 / 肺炎 |
| 腹泻+恶心 | 急性胃肠炎 | 急性胃肠炎 |
| 皮疹+发热 | 湿疹 / 皮炎 / 流行性感冒 | 湿疹 / 皮炎 / 流行性感冒 |
| 头痛+恶心 | 偏头痛 / 紧张性头痛 / 中暑 | 偏头痛 / 紧张性头痛 |
| 腹痛+呕吐 | 急性胃肠炎 | 急性胃肠炎 |

典型变化：咽痛+发热的「手足口病」被挤出 Top3，由流感/感冒补位；头痛+恶心的「中暑」被挤出。

## 错例（gold 未进 Top1，共 7 条）

| 编号 | 分组 | 输入症状 | gold | 当前 Top1 | 排名 |
| --- | --- | --- | --- | --- | --- |
| d001 | train | runny_nose + congestion + sneeze | cold | 过敏性鼻炎 | 第 2 位 |
| d074 | holdout | fever + ear_pain + sore_throat | pharyngitis | 急性中耳炎 | 第 2 位 |
| d080 | holdout | headache + nausea | tension_headache | 偏头痛 | 第 2 位 |
| d084 | holdout | epigastric_pain + heartburn | gerd | 急性胃炎 / 消化性溃疡 | 第 2 位 |
| d085 | train | fever + dry_cough | pneumonia | 急性支气管炎 | 未进 Top8 |
| d087 | train | dry_cough + night_sweat | bronchitis | 肺结核（需排查） | 第 2 位 |
| d090 | holdout | flank_pain + hematuria | uti | 泌尿系结石 | 未进 Top8 |
