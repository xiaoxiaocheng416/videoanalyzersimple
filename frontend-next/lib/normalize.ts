/**
 * 数据规范化层 - MVP防御核心
 * 处理AI输出的各种不一致性
 */

/**
 * 百分比字符串转换为0-1的数值
 * "85%" | 0.85 | "85" → 0.85
 */
export const percentToUnit = (s?: string | number): number => {
  if (!s && s !== 0) return 0;

  // 如果已经是数字
  if (typeof s === 'number') {
    // 如果是0-1之间，直接返回
    if (s >= 0 && s <= 1) return s;
    // 如果是0-100之间，转换为0-1
    if (s > 1 && s <= 100) return s / 100;
    return 0;
  }

  // 处理字符串
  const str = String(s).trim();
  const n = Number.parseFloat(str.replace('%', ''));
  if (isNaN(n)) return 0;

  // 如果解析出的数字在0-1之间，直接返回
  if (n >= 0 && n <= 1) return n;
  // 如果在1-100之间，转换为0-1
  if (n > 1 && n <= 100) return n / 100;

  return 0;
};

/**
 * Pillars分数标准化到0-10
 * 智能识别加权分(0-40/25/20/15)并转换
 */
const WEIGHTS = { hook: 40, display: 25, trust: 20, cta: 15 };

export const normalizePillars = (
  pillars: {
    hook_0_3s?: number;
    display_clarity?: number;
    creator_trust?: number;
    cta_effectiveness?: number;
  },
  meta?: {
    scale?: 'weighted_points' | 'raw_0_10';
    // 后端可能只返回部分权重，这里放宽为 Partial
    weights?: Partial<typeof WEIGHTS>;
  },
): {
  hook_0_3s: number;
  display_clarity: number;
  creator_trust: number;
  cta_effectiveness: number;
} => {
  // 提取值并设置默认值
  const values = {
    hook_0_3s: pillars?.hook_0_3s ?? 0,
    display_clarity: pillars?.display_clarity ?? 0,
    creator_trust: pillars?.creator_trust ?? 0,
    cta_effectiveness: pillars?.cta_effectiveness ?? 0,
  };

  // 判断是否为加权分
  const isWeighted =
    meta?.scale === 'weighted_points' ||
    values.hook_0_3s > 10 ||
    values.display_clarity > 10 ||
    values.creator_trust > 10 ||
    values.cta_effectiveness > 10;

  if (!isWeighted) {
    // 已经是0-10标度，确保值在范围内
    return {
      hook_0_3s: Math.min(10, Math.max(0, values.hook_0_3s)),
      display_clarity: Math.min(10, Math.max(0, values.display_clarity)),
      creator_trust: Math.min(10, Math.max(0, values.creator_trust)),
      cta_effectiveness: Math.min(10, Math.max(0, values.cta_effectiveness)),
    };
  }

  // 加权分转换为0-10
  // 合并默认权重，确保所有键都存在
  const weights = { ...WEIGHTS, ...(meta?.weights ?? {}) };

  // 四舍五入到最近的0.5
  const toNearestHalf = (x: number) => Math.round(x * 2) / 2;

  // 转换函数：从加权分到0-10，并clamp到[0,10]
  const to10 = (value: number, maxWeight: number) => {
    const scaled = maxWeight ? (value / maxWeight) * 10 : 0;
    return Math.max(0, Math.min(10, toNearestHalf(scaled)));
  };

  return {
    hook_0_3s: to10(values.hook_0_3s, weights.hook),
    display_clarity: to10(values.display_clarity, weights.display),
    creator_trust: to10(values.creator_trust, weights.trust),
    cta_effectiveness: to10(values.cta_effectiveness, weights.cta),
  };
};

/**
 * 计算预测区间放宽因子
 * 基于数据完整度决定区间放宽倍数
 */
export const widenFactor = (completeness?: number): number => {
  const value = completeness ?? 0.8; // 默认值

  if (value < 0.5) return 5; // 数据很少，区间放宽5倍
  if (value < 0.8) return 2; // 数据一般，区间放宽2倍
  return 1; // 数据充足，不放宽
};

/**
 * 清洗空值和特殊文案
 * "N/A - ..." → ""
 */
export const cleanEmptyValue = (value?: string): string => {
  if (!value) return '';

  // 清洗N/A相关文案
  if (value.toLowerCase().startsWith('n/a')) return '';
  if (value.toLowerCase() === 'none') return '';
  if (value === '-') return '';

  return value.trim();
};

/**
 * 计算总分（基于0-10的pillars分数和权重）
 */
export const calculateTotalScore = (pillars: {
  hook_0_3s: number;
  display_clarity: number;
  creator_trust: number;
  cta_effectiveness: number;
}): number => {
  const weights = WEIGHTS;
  const totalWeight = weights.hook + weights.display + weights.trust + weights.cta;

  const weightedSum =
    (pillars.hook_0_3s / 10) * weights.hook +
    (pillars.display_clarity / 10) * weights.display +
    (pillars.creator_trust / 10) * weights.trust +
    (pillars.cta_effectiveness / 10) * weights.cta;

  return Math.round((weightedSum / totalWeight) * 100);
};

/**
 * 获取置信度颜色
 */
export const getConfidenceColor = (confidence: number): 'red' | 'orange' | 'green' => {
  if (confidence < 0.5) return 'red';
  if (confidence < 0.8) return 'orange';
  return 'green';
};

/**
 * 获取等级颜色（用于Badge）
 */
export const getGradeColor = (grade: string): string => {
  switch (grade?.toUpperCase()) {
    case 'S':
      return 'bg-green-500';
    case 'A':
      return 'bg-blue-500';
    case 'B':
      return 'bg-yellow-500';
    case 'C':
      return 'bg-pink-500';
    case 'D':
      return 'bg-red-500';
    default:
      return 'bg-gray-500';
  }
};
