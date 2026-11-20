/**
 * 反馈统计（纯函数）：评分分布 + 低分病症 Top5
 * 与 Worker 的 worker/feedback-stats.mjs 保持同一口径。
 */

function summarizeFeedback(items) {
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

module.exports = { summarizeFeedback };