/**
 * 明辨康途 · 本机档案（Preferences）
 * 供页面、服务卡片、本地提醒共用：
 *   - 记录每次查看的方向与症状（卡片展示「最近一次方向」）
 *   - 今日打卡（卡片展示「今日症状打卡」）
 *   - 3 天内同一方向 ≥3 次 → 建议就医（通知）
 *   - 距最后一次查看 ≥7 天 → 复查关心
 */
import { common } from '@kit.AbilityKit';
import { preferences } from '@kit.ArkData';
import { formBindingData, formProvider } from '@kit.FormKit';

const PREF_NAME: string = 'mbkt_profile';
const PREF_KEY: string = 'profile_v1';
const MAX_ENTRIES: number = 200;
const ADVISE_DAYS: number = 3;
const ADVISE_TIMES: number = 3;
const RECHECK_DAYS: number = 3;
const DAY_MS: number = 86400000;

export interface VisitEntry {
  t: number;
  dir: string;
  dirName: string;
  level: string;
  selected: string[];
}

export interface ProfileData {
  entries: VisitEntry[];
  lastDir: string;
  lastDirName: string;
  lastLevel: string;
  lastTitle: string;
  lastAdvice: string;
  lastSelected: string[];
  lastTime: number;
  lastCheckIn: string;
  muted: Record<string, number>;
  cardFormId: string;
}

export interface AdviseInfo {
  dir: string;
  name: string;
  count: number;
}

export interface CardSummary {
  lastDirName: string;
  checkedInToday: boolean;
  careDays: number;
  advise: string;
}

export function emptyProfile(): ProfileData {
  return {
    entries: [] as VisitEntry[],
    lastDir: '',
    lastDirName: '',
    lastLevel: '',
    lastTitle: '',
    lastAdvice: '',
    lastSelected: [] as string[],
    lastTime: 0,
    lastCheckIn: '',
    muted: {} as Record<string, number>,
    cardFormId: ''
  };
}

export function dayKey(t: number): string {
  const d = new Date(t);
  const m = (d.getMonth() + 1 < 10 ? '0' : '') + (d.getMonth() + 1).toString();
  const day = (d.getDate() < 10 ? '0' : '') + d.getDate().toString();
  return d.getFullYear().toString() + '-' + m + '-' + day;
}

export function todayKey(): string {
  return dayKey(Date.now());
}

function normalize(data: ProfileData): ProfileData {
  const base = emptyProfile();
  if (data.entries && Array.isArray(data.entries)) {
    base.entries = data.entries.slice(-MAX_ENTRIES);
  }
  base.lastDir = data.lastDir || '';
  base.lastDirName = data.lastDirName || '';
  base.lastLevel = data.lastLevel || '';
  base.lastTitle = data.lastTitle || '';
  base.lastAdvice = data.lastAdvice || '';
  base.lastSelected = data.lastSelected || ([] as string[]);
  base.lastTime = data.lastTime || 0;
  base.lastCheckIn = data.lastCheckIn || '';
  base.muted = data.muted || ({} as Record<string, number>);
  base.cardFormId = data.cardFormId || '';
  return base;
}

async function getPref(ctx: common.Context): Promise<preferences.Preferences> {
  return await preferences.getPreferences(ctx, PREF_NAME);
}

export async function loadProfile(ctx: common.Context): Promise<ProfileData> {
  try {
    const pref = await getPref(ctx);
    const text = await pref.get(PREF_KEY, '') as string;
    if (!text) {
      return emptyProfile();
    }
    return normalize(JSON.parse(text) as ProfileData);
  } catch (e) {
    return emptyProfile();
  }
}

export async function saveProfile(ctx: common.Context, data: ProfileData): Promise<void> {
  try {
    const pref = await getPref(ctx);
    await pref.put(PREF_KEY, JSON.stringify(data));
    await pref.flush();
  } catch (e) {
  }
}

/** 3 天内同一方向是否已到提醒阈值（不改状态，供卡片/通知判断） */
export function pendingAdvise(data: ProfileData, now: number): AdviseInfo | null {
  if (!data.lastDir) {
    return null;
  }
  const since = now - ADVISE_DAYS * DAY_MS;
  let count = 0;
  for (const e of data.entries) {
    if (e.dir === data.lastDir && e.t >= since) {
      count += 1;
    }
  }
  const mutedAt = data.muted['advise:' + data.lastDir] || 0;
  if (count >= ADVISE_TIMES && mutedAt < since) {
    return { dir: data.lastDir, name: data.lastDirName, count } as AdviseInfo;
  }
  return null;
}

/** 距最后一次查看的天数；不到 7 天返回 0 */
export function recheckDays(data: ProfileData, now: number): number {
  if (!data.lastTime) {
    return 0;
  }
  const days = Math.floor((now - data.lastTime) / DAY_MS);
  return days >= RECHECK_DAYS ? days : 0;
}

/**
 * 记录一次查看；返回本次是否触发「建议就医」。
 * 触发时写入 muted，避免反复打扰。
 */
export async function recordVisit(ctx: common.Context, selected: string[], dirId: string,
  dirName: string, level: string, title: string, advice: string): Promise<AdviseInfo | null> {
  const data = await loadProfile(ctx);
  const now = Date.now();
  const entry: VisitEntry = {
    t: now,
    dir: dirId,
    dirName: dirName,
    level: level,
    selected: selected.slice()
  };
  data.entries.push(entry);
  if (data.entries.length > MAX_ENTRIES) {
    data.entries = data.entries.slice(-MAX_ENTRIES);
  }
  data.lastDir = dirId;
  data.lastDirName = dirName;
  data.lastLevel = level;
  data.lastTitle = title;
  data.lastAdvice = advice;
  data.lastSelected = selected.slice();
  data.lastTime = now;

  const advise = pendingAdvise(data, now);
  if (advise) {
    data.muted['advise:' + advise.dir] = now;
  }
  await saveProfile(ctx, data);
  return advise;
}

/** 今日打卡（结果页「今天仍有症状」） */
export async function checkInToday(ctx: common.Context): Promise<void> {
  const data = await loadProfile(ctx);
  data.lastCheckIn = todayKey();
  await saveProfile(ctx, data);
}

export async function setCardFormId(ctx: common.Context, formId: string): Promise<void> {
  const data = await loadProfile(ctx);
  data.cardFormId = formId;
  await saveProfile(ctx, data);
}

export async function cardSummary(ctx: common.Context): Promise<CardSummary> {
  const data = await loadProfile(ctx);
  const now = Date.now();
  const advise = pendingAdvise(data, now);
  return {
    lastDirName: data.lastDirName ? data.lastDirName : '还没有记录',
    checkedInToday: data.lastCheckIn === todayKey(),
    careDays: recheckDays(data, now),
    advise: advise ? advise.name : ''
  } as CardSummary;
}

/** 主应用记录后刷新卡片（卡片 formId 由 EntryFormAbility 写入） */
export async function refreshCard(ctx: common.Context): Promise<void> {
  try {
    const data = await loadProfile(ctx);
    if (!data.cardFormId) {
      return;
    }
    const summary = await cardSummary(ctx);
    const binding = formBindingData.createFormBindingData({
      lastDirName: summary.lastDirName,
      checkedInToday: summary.checkedInToday,
      careDays: summary.careDays,
      advise: summary.advise
    });
    await formProvider.updateForm(data.cardFormId, binding);
  } catch (e) {
  }
}