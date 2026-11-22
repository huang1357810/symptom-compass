/**
 * 评测结果 schema 校验（纯函数，供 Worker 与单测使用）
 */
export function validateEvals(body) {
  if (!body || typeof body !== 'object') {
    return { ok: false, error: 'bad_evals' };
  }

  const version = typeof body.version === 'string' ? body.version.slice(0, 40).trim() : '';
  if (!version) {
    return { ok: false, error: 'bad_version' };
  }

  const nonNegInt = (v) => (Number.isInteger(v) && v >= 0 ? v : null);
  const total = nonNegInt(body.total);
  const red = nonNegInt(body.red);
  const negatives = nonNegInt(body.negatives);
  const falsePositive = nonNegInt(body.falsePositive);

  if (total === null || red === null || negatives === null || falsePositive === null) {
    return { ok: false, error: 'bad_numbers' };
  }
  if (red > total) {
    return { ok: false, error: 'red_gt_total' };
  }
  if (falsePositive > negatives) {
    return { ok: false, error: 'fp_gt_negatives' };
  }

  return { ok: true, value: { ...body, version, total, red, negatives, falsePositive } };
}