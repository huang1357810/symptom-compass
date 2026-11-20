/**
 * 反馈统计（纯函数，供 Worker 汇总页使用）
 * 输入：feedback records（含 rating / context.top.name）
 * 输出：总数、平均分、1–5 星分布、低分病症 Top5
 */

export function summarizeFeedback(items) {
  const list = Array.isArray(items) ? items : [];
  let total = 0;
  const dist = [0, 0, 0, 0, 0];
  let sum = 0;
  const groups = new Map();

  for (const it of list) {
    const rating = Number(it && it.rating);
    if (!Number.isFinite(rating)) continue;
    total += 1;
    if (rating >= 1 && rating <= 5) dist[rating - 1] += 1;
    sum += rating;

    const name = (it.context && it.context.top && it.context.top.name)
      ? String(it.context.top.name).slice(0, 60)
      : '未记录方向';

    let g = groups.get(name);
    if (!g) {
      g = { name, total: 0, low: 0, sum: 0 };
      groups.set(name, g);
    }
    g.total += 1;
    g.sum += rating;
    if (rating <= 2) g.low += 1;
  }

  const lowTop = Array.from(groups.values())
    .filter(g => g.low > 0)
    .sort((a, b) =>
      b.low - a.low ||
      (a.sum / a.total) - (b.sum / b.total) ||
      b.total - a.total
    )
    .slice(0, 5)
    .map(g => ({
      name: g.name,
      low: g.low,
      total: g.total,
      avg: Number((g.sum / g.total).toFixed(2))
    }));

  return {
    total,
    avg: total ? Number((sum / total).toFixed(2)) : 0,
    dist,
    lowTop
  };
}