'use client';

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { TimelineSegment } from '@/lib/validation';
import { AlertTriangle, Clock, Info, Lightbulb } from 'lucide-react';
import type React from 'react';

// 兼容更丰富的时间线字段（本地放宽，不改全局类型）
type TimelineSegmentLoose = {
  segment?: string;
  phase?: string;
  t_start?: number;
  t_end?: number;
  score?: number;
  spoken_excerpt?: string;
  screen_text?: string;
  visual_cue?: string;
  product_visible?: boolean;
  ceiling_rules_triggered?: string[];
  time_range?: string;
  timestamp?: string;
  description?: string;
  score_impact?: string;
  issue?: string | null;
  risk?: string | null;
  fix_hint?: string | null;
  [k: string]: unknown;
};

interface TimelineAnalysisProps {
  timeline: (TimelineSegment | TimelineSegmentLoose)[];
}

// 空值处理函数
const renderValue = (value: string | null | undefined): string => {
  if (!value || value === '') return '—';
  return value;
};

// 获取segment标题 - 回退链
const getSegmentTitle = (segment: any, index: number): string => {
  const title =
    segment?.segment ??
    segment?.segment_title ??
    segment?.timestamp ??
    segment?.time_range ??
    `Segment ${index + 1}`;

  // 统一使用 en dash
  return title.replace(/-/g, '–');
};

// 获取phase标签
const getPhaseLabel = (phase: string): string => {
  const phaseMap: Record<string, string> = {
    hook: 'Hook',
    trust: 'Trust',
    desire: 'Desire',
    cta: 'CTA',
  };
  return phaseMap[phase?.toLowerCase()] || 'Phase';
};

// 获取phase颜色
const getPhaseColor = (phase: string): string => {
  const colorMap: Record<string, string> = {
    hook: 'bg-purple-500',
    trust: 'bg-blue-500',
    desire: 'bg-green-500',
    cta: 'bg-orange-500',
  };
  return colorMap[phase?.toLowerCase()] || 'bg-gray-500';
};

// 获取segment分数
const getSegmentScore = (segment: any): string | null => {
  if (segment?.score !== undefined && segment.score !== null) {
    return `${segment.score}/10`;
  }
  return null;
};

// 分数影响颜色
const getScoreImpactColor = (impact: string): string => {
  const impactLower = impact?.toLowerCase() || '';
  if (impactLower.includes('high') || impactLower.includes('+')) return 'bg-green-500';
  if (impactLower.includes('negative') || impactLower.includes('-')) return 'bg-red-500';
  if (impactLower.includes('medium')) return 'bg-yellow-500';
  return 'bg-gray-500';
};

export const TimelineAnalysis: React.FC<TimelineAnalysisProps> = ({ timeline }) => {
  if (!timeline || timeline.length === 0) {
    return (
      <Card className="w-full text-left">
        <CardHeader className="items-start text-left">
          <CardTitle className="text-xl font-semibold">Timeline Analysis</CardTitle>
        </CardHeader>
        <CardContent className="text-left">
          <p className="text-sm text-muted-foreground py-4">No timeline data available</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="w-full text-left">
      <CardHeader className="items-start text-left">
        <CardTitle className="text-xl font-semibold">Timeline Analysis</CardTitle>
      </CardHeader>

      <CardContent className="text-left">
        <Accordion type="single" collapsible className="w-full">
          {timeline.map((segment, index) => {
            const seg = segment as any; // 宽松兼容两种时间线结构
            const hasIssues = seg.issue || seg.risk || seg.fix_hint;

            return (
              <AccordionItem key={index} value={`item-${index}`}>
                <AccordionTrigger className="hover:no-underline">
                  <div className="flex items-center justify-between w-full pr-4">
                    <div className="flex items-center gap-3">
                      <Clock className="h-4 w-4 text-muted-foreground" />
                      <span className="font-medium">
                        {getSegmentTitle(segment, index)}
                        {getSegmentScore(segment) && ` · ${getSegmentScore(segment)}`}
                      </span>

                      {/* Phase badge */}
                      {seg.phase && (
                        <Badge
                          variant="secondary"
                          className={`${getPhaseColor(seg.phase)} text-white text-xs px-2 py-0.5`}
                        >
                          {getPhaseLabel(seg.phase)}
                        </Badge>
                      )}

                      {/* Ceiling rules indicator */}
                      {seg.ceiling_rules_triggered && seg.ceiling_rules_triggered.length > 0 && (
                        <Badge variant="destructive" className="text-xs px-2 py-0.5">
                          Ceiling
                        </Badge>
                      )}

                      {/* Issue indicator - only show if severity !== 'none' or hasIssues */}
                      {seg.severity && seg.severity !== 'none' && (
                        <AlertTriangle className="h-3 w-3 text-orange-500" />
                      )}
                    </div>

                    {seg.score_impact && seg.score_impact !== '—' && (
                      <Badge
                        variant="secondary"
                        className={`${getScoreImpactColor(seg.score_impact)} text-white text-xs`}
                      >
                        {seg.score_impact}
                      </Badge>
                    )}
                  </div>
                </AccordionTrigger>

                <AccordionContent className="space-y-3 pt-3 text-left items-start">
                  {/* Timeline info with new fields */}
                  {(seg.t_start !== undefined || seg.t_end !== undefined) && (
                    <div className="text-xs text-muted-foreground mb-2">
                      Time: {seg.t_start}s - {seg.t_end}s
                    </div>
                  )}

                  {/* Spoken excerpt */}
                  {seg.spoken_excerpt && seg.spoken_excerpt !== '' && (
                    <div className="space-y-1 text-left items-start">
                      <span className="text-xs font-semibold text-muted-foreground">Spoken:</span>
                      <p className="text-sm italic leading-relaxed">
                        {seg.spoken_excerpt.startsWith('~') && (
                          <Badge variant="outline" className="text-xs mr-2">
                            approx.
                          </Badge>
                        )}
                        "{seg.spoken_excerpt.replace(/^~/, '')}"
                      </p>
                    </div>
                  )}

                  {/* Screen text */}
                  {seg.screen_text && seg.screen_text !== '' && (
                    <div className="space-y-1 text-left items-start">
                      <span className="text-xs font-semibold text-muted-foreground">
                        On-screen text:
                      </span>
                      <p className="text-sm font-medium leading-relaxed">{seg.screen_text}</p>
                    </div>
                  )}

                  {/* Visual cue */}
                  {seg.visual_cue && seg.visual_cue !== '' && (
                    <div className="space-y-1 text-left items-start">
                      <span className="text-xs font-semibold text-muted-foreground">Visual:</span>
                      <p className="text-sm text-muted-foreground leading-relaxed">
                        {seg.visual_cue}
                      </p>
                    </div>
                  )}

                  {/* Product visibility indicator */}
                  {seg.product_visible !== undefined && (
                    <div className="flex items-center gap-2 text-left items-start">
                      <span className="text-xs font-semibold text-muted-foreground">
                        Product visible:
                      </span>
                      <Badge variant={seg.product_visible ? 'default' : 'secondary'}>
                        {seg.product_visible ? 'Yes' : 'No'}
                      </Badge>
                    </div>
                  )}

                  {/* 描述 (if exists) */}
                  {seg.description && (
                    <div className="text-sm text-muted-foreground leading-relaxed">
                      {renderValue(seg.description as string)}
                    </div>
                  )}

                  {/* --- Feedback blocks: Issue / Risk / Fix --- */}
                  <div className="mt-4 grid gap-3 text-left">
                    {/* Issue */}
                    <div className="w-full rounded-lg border bg-amber-50/60 p-4">
                      <div className="mb-1 flex items-center gap-2">
                        <span className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-amber-400 text-amber-700">
                          ⚠️
                        </span>
                        <span className="text-sm font-semibold text-amber-900">Issue:</span>
                      </div>
                      <p className="text-sm leading-relaxed text-amber-900/90">
                        {seg.issue || 'No major issue — keep as-is.'}
                      </p>
                    </div>

                    {/* Risk */}
                    <div className="w-full rounded-lg border bg-rose-50/60 p-4">
                      <div className="mb-1 flex items-center gap-2">
                        <span className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-rose-400 text-rose-700">
                          ℹ️
                        </span>
                        <span className="text-sm font-semibold text-rose-900">Risk:</span>
                      </div>
                      <p className="text-sm leading-relaxed text-rose-900/90">
                        {seg.risk || 'Low risk; maintain current approach.'}
                      </p>
                    </div>

                    {/* Fix Hint */}
                    <div className="w-full rounded-lg border bg-emerald-50/60 p-4">
                      <div className="mb-1 flex items-center gap-2">
                        <span className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-emerald-400 text-emerald-700">
                          💡
                        </span>
                        <span className="text-sm font-semibold text-emerald-900">Fix Hint:</span>
                      </div>
                      <p className="text-sm leading-relaxed text-emerald-900/90">
                        {seg.fix_hint || 'Optional micro-optimization: —'}
                      </p>
                    </div>
                  </div>
                </AccordionContent>
              </AccordionItem>
            );
          })}
        </Accordion>
      </CardContent>
    </Card>
  );
};
