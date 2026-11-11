/**
 * 分诊逻辑（纯函数，不依赖 UI）
 *
 * 与 Web 版 site/index.html 中的 scoreConditions / flagsFor / computeTriage 保持一致：
 * 先用危险信号做一票拦截，再用「病程 / 体温 / 活动能力」三个问题加权，最后给出红黄绿分级。
 */
import { CONDITIONS, SYMPTOMS, RED_FLAGS, MedInfo, RedFlagDef } from './Data';

export interface ConditionResult {
  id: string;
  name: string;
  dept: string;
  tag: string;
  summary: string;
  score: number;
  matched: string[];
  care: string[];
  meds: MedInfo[];
  see: string;
}

export interface TriageInfo {
  level: string; // 'red' | 'yellow' | 'green'
  title: string;
  advice: string;
  reasons: string[];
}

export interface QuestionOption {
  label: string;
  score: number;
  reason: string;
}

export interface Question {
  id: string;
  title: string;
  hint: string;
  options: QuestionOption[];
}

export interface AnswerScore {
  score: number;
  reasons: string[];
  answered: number;
}

/** 三个追问问题，与 Web 版逐字一致 */
export const QUESTIONS: Question[] = [
  {
    id: 'duration',
    title: '症状持续多久了？',
    hint: '从第一个症状出现算起',
    options: [
      { label: '今天刚开始', score: 0, reason: '' },
      { label: '1–3 天', score: 0, reason: '' },
      { label: '4–7 天', score: 1, reason: '症状已持续 4–7 天' },
      { label: '超过 1 周', score: 2, reason: '症状持续超过 1 周' }
    ]
  },
  {
    id: 'fever',
    title: '有没有发热？最高多少度？',
    hint: '按测量到的最高温度选',
    options: [
      { label: '没有发热', score: 0, reason: '' },
      { label: '37.3–38℃', score: 1, reason: '低热 37.3–38℃' },
      { label: '38.1–39℃', score: 2, reason: '中度发热 38.1–39℃' },
      { label: '超过 39℃', score: 3, reason: '高热超过 39℃' }
    ]
  },
  {
    id: 'activity',
    title: '目前的状态怎么样？',
    hint: '按最难受的时候判断',
    options: [
      { label: '活动正常', score: 0, reason: '' },
      { label: '影响工作，但能自理', score: 1, reason: '已影响日常活动' },
      { label: '卧床，需要人照顾', score: 3, reason: '需要卧床、无法自理' }
    ]
  }
];

/** 命中的危险信号 */
export function flagsFor(selected: string[]): RedFlagDef[] {
  const picked: RedFlagDef[] = [];
  for (const flag of RED_FLAGS) {
    let hit: boolean = false;
    if (flag.mode === 'all') {
      hit = true;
      for (const id of flag.ids) {
        if (!selected.includes(id)) {
          hit = false;
          break;
        }
      }
    } else {
      for (const id of flag.ids) {
        if (selected.includes(id)) {
          hit = true;
          break;
        }
      }
    }
    if (hit) {
      picked.push(flag);
    }
  }
  return picked;
}

/** 按症状吻合度排序的可能情况 */
export function scoreConditions(selected: string[]): ConditionResult[] {
  const results: ConditionResult[] = [];
  const minHit: number = selected.length >= 3 ? 2 : 1;

  for (const c of CONDITIONS) {
    let total: number = 0;
    let hit: number = 0;
    const matched: string[] = [];

    const keys: string[] = Object.keys(c.symptoms);
    for (const key of keys) {
      const w: number = c.symptoms[key];
      total += w;
      if (selected.includes(key)) {
        hit += w;
        matched.push(key);
      }
    }

    const score: number = total > 0 ? hit / total : 0;
    let coreHit: boolean = false;
    for (const key of c.core) {
      if (selected.includes(key)) {
        coreHit = true;
        break;
      }
    }

    if (matched.length >= minHit && score >= 0.18 && (coreHit || score >= 0.5)) {
      results.push({
        id: c.id,
        name: c.name,
        dept: c.dept,
        tag: c.tag,
        summary: c.summary,
        score: score,
        matched: matched,
        care: c.care,
        meds: c.meds,
        see: c.see
      });
    }
  }

  results.sort((a: ConditionResult, b: ConditionResult): number => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    return b.matched.length - a.matched.length;
  });

  return results.slice(0, 8);
}

/** 问卷加权：0–8 分 */
export function answersScore(answers: Record<string, number>): AnswerScore {
  let score: number = 0;
  const reasons: string[] = [];
  let answered: number = 0;

  for (const q of QUESTIONS) {
    const idx: number = answers[q.id];
    if (idx === undefined || idx < 0 || idx >= q.options.length) {
      continue;
    }
    answered += 1;
    const opt: QuestionOption = q.options[idx];
    score += opt.score;
    if (opt.reason.length > 0) {
      reasons.push(opt.reason);
    }
  }

  return { score: score, reasons: reasons, answered: answered };
}

/** 红 / 黄 / 绿 三级分诊 */
export function triageOf(results: ConditionResult[], flags: RedFlagDef[], answers: Record<string, number>): TriageInfo {
  if (flags.length > 0) {
    const titles: string[] = [];
    for (const f of flags) {
      titles.push(f.title);
    }
    return {
      level: 'red',
      title: '建议立即就医',
      advice: '你选择的症状里有需要紧急处理的情况，不适合自我观察或自行用药。请立即前往医院急诊，紧急时拨打 120。',
      reasons: titles
    };
  }

  const a: AnswerScore = answersScore(answers);

  if (results.length === 0) {
    return {
      level: 'yellow',
      title: '信息不足，建议面诊',
      advice: '没有匹配到足够接近的情况，症状组合可能不典型。建议补充症状，或直接到医院让医生面诊。',
      reasons: a.reasons
    };
  }

  const top: ConditionResult = results[0];
  const urgentDept: boolean = top.dept.includes('急诊') || top.tag === '需就医';

  if (a.score >= 7) {
    return {
      level: 'red',
      title: '建议今天内就医',
      advice: '结合病程、体温和活动能力，整体情况偏重，建议今天内前往医院就诊，不要继续自行观察。',
      reasons: a.reasons
    };
  }
  if (urgentDept) {
    return {
      level: 'yellow',
      title: '建议 24 小时内就诊',
      advice: '最可能的情况需要医生评估，不宜长期自行处理。建议尽快到 ' + top.dept + ' 就诊。',
      reasons: a.reasons
    };
  }
  if (a.score >= 3) {
    return {
      level: 'yellow',
      title: '建议尽快就诊',
      advice: '症状已经持续或影响到日常活动，建议这两天到 ' + top.dept + ' 检查一下。',
      reasons: a.reasons
    };
  }
  return {
    level: 'green',
    title: '可以先观察',
    advice: '目前整体偏轻，可以先按下方建议自我照护。若 3 天内没有好转，或症状加重，请及时就医。',
    reasons: a.reasons
  };
}

/** 症状 id → 中文标签 */
export function labelsOf(ids: string[]): string[] {
  const out: string[] = [];
  for (const id of ids) {
    if (SYMPTOMS[id] !== undefined) {
      out.push(SYMPTOMS[id].label);
    }
  }
  return out;
}
