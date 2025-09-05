/**
 * Zod数据校验层 - MVP防御核心
 * 确保所有字段都有默认值，避免undefined导致的崩溃
 */

import { z } from 'zod';

// Pillars子项schema
const PillarsSchema = z.object({
  hook_0_3s: z.number().min(0).max(10).default(0),
  display_clarity: z.number().min(0).max(10).default(0),
  creator_trust: z.number().min(0).max(10).default(0),
  cta_effectiveness: z.number().min(0).max(10).default(0),
});

// Overview schema
const OverviewSchema = z.object({
  score: z.number().min(0).max(100).default(0),
  grade: z.string().default('C'),
  confidence: z.string().default('70%'),
  confidence_value: z.number().min(0).max(1).optional(),
  summary: z.string().default(''),
});

// Timeline segment schema
const TimelineSegmentSchema = z.object({
  time_range: z.string().default(''),
  timestamp: z.string().default(''),
  description: z.string().default(''),
  score_impact: z.string().default(''),
  issue: z.string().nullable().default(null),
  risk: z.string().nullable().default(null),
  fix_hint: z.string().nullable().default(null),
});

// Forecast schema
const ForecastSchema = z.object({
  pass_probability: z.string().default('50%'),
  pass_probability_value: z.number().min(0).max(1).optional(),
  revenue_forecast: z.string().default(''),
  gmv_range: z.string().default(''),
  notes: z.string().default(''),
});

// Recommendation schema
const RecommendationSchema = z.object({
  priority: z.enum(['Critical', 'High', 'Medium', 'Low']).default('Medium'),
  description: z.string().default(''),
  impact: z.string().default(''),
  effort: z.string().default(''),
});

// Flag schema
const FlagSchema = z.object({
  type: z.string().default('info'),
  message: z.string().default(''),
});

// Top opportunities schema
const TopOpportunitiesSchema = z.object({
  must_fix: z.array(z.string()).default([]),
  quick_wins: z.array(z.string()).default([]),
  technical_optimizations: z.array(z.string()).default([]),
});

// 主分析结果Schema
export const AnalysisResultSchema = z.object({
  overview: OverviewSchema.default({
    score: 0,
    grade: 'C',
    confidence: '70%',
    summary: '',
  }),
  
  pillars: PillarsSchema.default({
    hook_0_3s: 0,
    display_clarity: 0,
    creator_trust: 0,
    cta_effectiveness: 0,
  }),
  
  pillars_meta: z.object({
    scale: z.enum(['weighted_points', 'raw_0_10']).optional(),
    weights: z.object({
      hook: z.number().optional(),
      display: z.number().optional(),
      trust: z.number().optional(),
      cta: z.number().optional(),
    }).optional(),
  }).optional(),
  
  timeline: z.array(TimelineSegmentSchema).default([]),
  
  forecast: ForecastSchema.default({
    pass_probability: '50%',
    revenue_forecast: '',
    gmv_range: '',
    notes: '',
  }),
  
  recommendations: z.array(RecommendationSchema).default([]),
  
  flags: z.array(FlagSchema).default([]),
  
  top_opportunities: TopOpportunitiesSchema.default({
    must_fix: [],
    quick_wins: [],
    technical_optimizations: [],
  }),
  
  raw_notes: z.string().optional(),
  improvement_summary: z.string().default(''),
});

// 类型导出
export type AnalysisResult = z.infer<typeof AnalysisResultSchema>;
export type Pillars = z.infer<typeof PillarsSchema>;
export type Overview = z.infer<typeof OverviewSchema>;
export type TimelineSegment = z.infer<typeof TimelineSegmentSchema>;
export type Forecast = z.infer<typeof ForecastSchema>;
export type Recommendation = z.infer<typeof RecommendationSchema>;
export type Flag = z.infer<typeof FlagSchema>;
export type TopOpportunities = z.infer<typeof TopOpportunitiesSchema>;

/**
 * 安全解析分析结果
 * 验证失败时返回null而不是默认值，避免假成功状态
 */
export const parseAnalysisResult = (data: unknown): AnalysisResult | null => {
  try {
    // 首先检查是否有实际数据
    if (!data || typeof data !== 'object') {
      console.error('Invalid data type for analysis result:', typeof data);
      return null;
    }
    
    const result = AnalysisResultSchema.parse(data);
    
    // 验证是否是真实数据而不是默认值
    const hasRealData = 
      result.overview?.score > 0 &&
      result.timeline?.length > 0 &&
      result.recommendations?.length > 0;
    
    if (!hasRealData) {
      console.warn('Parsed result appears to be default values only');
    }
    
    return result;
  } catch (error) {
    console.error('Analysis result validation failed:', error);
    // 不返回默认值，返回null表示验证失败
    return null;
  }
};
