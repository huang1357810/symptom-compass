/**
 * 分诊逻辑（纯函数，不依赖 UI）
 *
 * 与 Web 版 site/index.html 中的 scoreConditions / flagsFor 保持一致，
 * 额外增加了「红 / 黄 / 绿」三级分诊判定。
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
}

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

/** 红 / 黄 / 绿 三级分诊 */
export function triageOf(results: ConditionResult[], flags: RedFlagDef[]): TriageInfo {
  if (flags.length > 0) {
    return {
      level: 'red',
      title: '建议立即就医',
      advice: '你选择的症状中有需要紧急处理的情况，不建议自行观察或用药。请立即前往医院急诊，紧急时拨打 120。'
    };
  }
  if (results.length === 0) {
    return {
      level: 'yellow',
      title: '信息不足，建议面诊',
      advice: '没有匹配到足够接近的情况。症状组合可能不典型，建议补充症状，或直接到医院让医生面诊。'
    };
  }

  const top: ConditionResult = results[0];
  const urgentDept: boolean = top.dept.includes('急诊') || top.tag === '需就医';
  if (urgentDept) {
    return {
      level: 'yellow',
      title: '建议尽快就医',
      advice: '最可能的情况需要医生评估，不宜长期自行处理。建议 24 小时内到 ' + top.dept + ' 就诊。'
    };
  }
  if (top.score >= 0.55) {
    return {
      level: 'green',
      title: '可先观察，注意变化',
      advice: '更接近常见的自限性问题，可以先按下方建议自我照护。若 3 天内无好转或症状加重，请及时就医。'
    };
  }
  return {
    level: 'yellow',
    title: '建议就诊确认',
    advice: '症状吻合度不高，存在多种可能。建议到医院 ' + top.dept + ' 进一步检查，不要仅凭自我判断用药。'
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
