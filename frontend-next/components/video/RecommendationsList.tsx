'use client';

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { Recommendation } from '@/lib/validation';
import { AlertCircle, CheckCircle, Clock, Copy, Lightbulb, TrendingUp } from 'lucide-react';
import type React from 'react';
import { useMemo, useState } from 'react';

// local types: some recommendations may include oral "examples"
type OralExample = string | { text?: string; content?: string };
type WithExamples = { examples?: OralExample[] };

// ---- priority types & helpers ----
export const PRIORITIES = ['Critical', 'High', 'Medium', 'Low'] as const;
export type Priority = (typeof PRIORITIES)[number];

export const priorityColors: Record<Priority, string> = {
  Critical: 'bg-red-100 text-red-700',
  High: 'bg-orange-100 text-orange-700',
  Medium: 'bg-yellow-100 text-yellow-700',
  Low: 'bg-green-100 text-green-700',
};

const isPriority = (x: unknown): x is Priority =>
  typeof x === 'string' && (PRIORITIES as readonly string[]).includes(x);

interface RecommendationsListProps {
  recommendations: Recommendation[];
  topOpportunities?: {
    must_fix?: string[];
    quick_wins?: string[];
    technical_optimizations?: string[];
  };
}

// 局部补充类型（保留 WithExamples）
type RecommendationItem = Recommendation &
  WithExamples & {
    calculatedPriority?: unknown; // 后端可能返回任意，需要本地校验
    impact?: string | number; // 可选 impact（字符串或数字）
    effort?: string | number; // 可选 effort，修复 TS 报错
    difficulty?: string; // 可选难度描述
    expected_lift?: string | number; // 可选预期提升
    problem?: string; // 可选问题描述
    solution?: string; // 可选解决方案
  };

// 前端派生优先级计算
const calculatePriority = (rec: any): Priority => {
  const impact = Number.parseFloat(rec.expected_lift || rec.impact || '0');
  const effortMap: Record<string, number> = {
    simple: 1,
    medium: 2,
    reshoot: 3,
    low: 1,
    high: 3,
  };
  const effort = effortMap[rec.difficulty || rec.effort || 'medium'] || 2;

  const score = 0.7 * impact + 0.3 * (1 / effort);

  if (score > 0.7) return 'Critical';
  if (score > 0.5) return 'High';
  if (score > 0.3) return 'Medium';
  return 'Low';
};

export const RecommendationsList: React.FC<RecommendationsListProps> = ({
  recommendations,
  topOpportunities,
}) => {
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // 添加派生优先级并排序
  const sortedRecommendations = useMemo(() => {
    const withPriority = recommendations.map((rec) => ({
      ...rec,
      calculatedPriority: isPriority(rec.priority) ? rec.priority : calculatePriority(rec),
    }));

    // 按优先级排序
    const priorityOrder: Record<Priority, number> = { Critical: 0, High: 1, Medium: 2, Low: 3 };
    return withPriority.sort(
      (a, b) => priorityOrder[a.calculatedPriority] - priorityOrder[b.calculatedPriority],
    );
  }, [recommendations]);

  const handleCopy = async (text: string, id: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  // 渲染口播和屏幕字的复制按钮
  const renderCopyableText = (text: string, label: string, recIndex: number, itemIndex: number) => {
    const copyId = `${recIndex}-${label}-${itemIndex}`;
    const isCopied = copiedId === copyId;

    return (
      <div className="flex items-start gap-2 p-2 bg-muted/30 rounded-md">
        <div className="flex-1">
          <span className="text-xs font-medium text-muted-foreground">{label}:</span>
          <p className="text-sm mt-1 whitespace-pre-wrap">{text}</p>
        </div>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => handleCopy(text, copyId)}
          className="h-8 w-8 p-0"
        >
          {isCopied ? (
            <CheckCircle className="h-4 w-4 text-green-500" />
          ) : (
            <Copy className="h-4 w-4" />
          )}
        </Button>
      </div>
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl font-semibold">Recommendations</CardTitle>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* 快速优化提示 */}
        {topOpportunities && (
          <div className="space-y-2 p-3 bg-blue-50 dark:bg-blue-950/20 rounded-lg">
            {topOpportunities.must_fix && topOpportunities.must_fix.length > 0 && (
              <div>
                <span className="text-xs font-semibold text-red-600">Must Fix:</span>
                <ul className="text-sm mt-1 space-y-1">
                  {topOpportunities.must_fix.map((fix, i) => (
                    <li key={i} className="flex items-center gap-1">
                      <span className="text-red-500">•</span> {fix}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {topOpportunities.quick_wins && topOpportunities.quick_wins.length > 0 && (
              <div>
                <span className="text-xs font-semibold text-green-600">Quick Wins:</span>
                <ul className="text-sm mt-1 space-y-1">
                  {topOpportunities.quick_wins.map((win, i) => (
                    <li key={i} className="flex items-center gap-1">
                      <span className="text-green-500">•</span> {win}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {topOpportunities.technical_optimizations &&
              topOpportunities.technical_optimizations.length > 0 && (
                <div>
                  <span className="text-xs font-semibold text-blue-600">
                    Technical Optimizations:
                  </span>
                  <ul className="text-sm mt-1 space-y-1">
                    {topOpportunities.technical_optimizations.map((opt, i) => (
                      <li key={i} className="flex items-center gap-1">
                        <span className="text-blue-500">•</span> {opt}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
          </div>
        )}

        {/* 推荐列表 - 使用Accordion */}
        {sortedRecommendations.length > 0 ? (
          <Accordion type="multiple" defaultValue={['rec-0']} className="space-y-2">
            {sortedRecommendations.map((rec: RecommendationItem, index) => {
              // 安全提取 oral examples
              const rawOral = (rec as WithExamples).examples ?? [];
              const oralExamples = Array.isArray(rawOral)
                ? rawOral
                    .map((item) =>
                      typeof item === 'string' ? item : (item?.text ?? item?.content ?? ''),
                    )
                    .filter(Boolean)
                : [];

              // 安全提取text content（处理嵌套对象）
              let textContent = '';
              const recWithExamples = rec as WithExamples & any;
              if (recWithExamples.examples?.text) {
                if (typeof recWithExamples.examples.text === 'string') {
                  textContent = recWithExamples.examples.text;
                } else if (
                  typeof recWithExamples.examples.text === 'object' &&
                  recWithExamples.examples.text !== null
                ) {
                  // 处理 {text: "...", source: "..."} 结构
                  textContent =
                    recWithExamples.examples.text.text ||
                    recWithExamples.examples.text.content ||
                    '';
                }
              }

              const hasExamples = oralExamples.length > 0 || textContent;

              // 归一化优先级：非法值回退到 'Medium'
              const priority: Priority = isPriority(rec.calculatedPriority)
                ? rec.calculatedPriority
                : 'Medium';

              const priorityColor = priorityColors[priority];
              const impact = rec.impact; // 安全读取，可为 string/number/undefined

              return (
                <AccordionItem key={index} value={`rec-${index}`} className="border rounded-lg">
                  <AccordionTrigger className="hover:no-underline px-4">
                    <div className="flex items-start justify-between w-full pr-4">
                      <div className="flex-1 space-y-2">
                        <div className="flex items-center gap-2">
                          <Badge className={`${priorityColor}`}>{priority}</Badge>

                          {impact !== undefined && impact !== null && impact !== '' && (
                            <div className="flex items-center gap-1 text-xs text-muted-foreground">
                              <TrendingUp className="h-3 w-3" />
                              <span>Impact: {String(impact)}</span>
                            </div>
                          )}

                          {rec.effort && (
                            <div className="flex items-center gap-1 text-xs text-muted-foreground">
                              <Clock className="h-3 w-3" />
                              <span>Effort: {rec.effort}</span>
                            </div>
                          )}

                          {!hasExamples && (
                            <div className="flex items-center gap-1" title="Incomplete examples">
                              <AlertCircle className="h-3 w-3 text-yellow-500" />
                            </div>
                          )}
                        </div>

                        <p className="text-sm leading-relaxed text-left">{rec.description}</p>
                      </div>
                    </div>
                  </AccordionTrigger>

                  <AccordionContent className="px-4 pb-4 space-y-3">
                    {/* Problem */}
                    {rec.problem && (
                      <div className="p-3 bg-red-50 dark:bg-red-950/20 rounded-md">
                        <div className="flex items-start gap-2">
                          <AlertCircle className="h-4 w-4 text-red-600 mt-0.5" />
                          <div>
                            <span className="text-xs font-semibold text-red-600">Problem:</span>
                            <p className="text-sm mt-1">{rec.problem}</p>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Solution */}
                    {rec.solution && (
                      <div className="p-3 bg-green-50 dark:bg-green-950/20 rounded-md">
                        <div className="flex items-start gap-2">
                          <Lightbulb className="h-4 w-4 text-green-600 mt-0.5" />
                          <div>
                            <span className="text-xs font-semibold text-green-600">Solution:</span>
                            <p className="text-sm mt-1">{rec.solution}</p>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Examples - 口播 */}
                    {oralExamples.length > 0 && (
                      <div className="space-y-2">
                        <span className="text-xs font-semibold text-muted-foreground">
                          Oral Examples:
                        </span>
                        {oralExamples.map((oral, oralIdx) => (
                          <div key={oralIdx}>
                            {renderCopyableText(oral, `Oral ${oralIdx + 1}`, index, oralIdx)}
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Examples - 屏幕字 */}
                    {textContent && (
                      <div>
                        <span className="text-xs font-semibold text-muted-foreground">
                          Screen Text Example:
                        </span>
                        {renderCopyableText(textContent, 'Screen Text', index, 99)}
                      </div>
                    )}

                    {/* Difficulty & Expected Lift */}
                    <div className="flex items-center gap-4 text-xs text-muted-foreground pt-2">
                      {rec.difficulty && (
                        <div>
                          <span className="font-medium">Difficulty:</span> {rec.difficulty}
                        </div>
                      )}
                      {rec.expected_lift && (
                        <div>
                          <span className="font-medium">Expected Lift:</span> {rec.expected_lift}
                        </div>
                      )}
                    </div>
                  </AccordionContent>
                </AccordionItem>
              );
            })}
          </Accordion>
        ) : (
          <p className="text-sm text-muted-foreground text-center py-4">
            No recommendations available
          </p>
        )}
      </CardContent>
    </Card>
  );
};
