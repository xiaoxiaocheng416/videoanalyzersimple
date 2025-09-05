'use client';

import React, { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Copy, CheckCircle, TrendingUp, Clock, AlertCircle, Lightbulb } from 'lucide-react';
import { Recommendation } from '@/lib/validation';

interface RecommendationsListProps {
  recommendations: Recommendation[];
  topOpportunities?: {
    must_fix?: string[];
    quick_wins?: string[];
    technical_optimizations?: string[];
  };
}

// 前端派生优先级计算
const calculatePriority = (rec: any): 'Critical' | 'High' | 'Medium' | 'Low' => {
  const impact = parseFloat(rec.expected_lift || rec.impact || '0');
  const effortMap: Record<string, number> = { 
    simple: 1, 
    medium: 2, 
    reshoot: 3,
    low: 1,
    high: 3
  };
  const effort = effortMap[rec.difficulty || rec.effort || 'medium'] || 2;
  
  const score = (0.7 * impact) + (0.3 * (1/effort));
  
  if (score > 0.7) return 'Critical';
  if (score > 0.5) return 'High';
  if (score > 0.3) return 'Medium';
  return 'Low';
};

const priorityColors = {
  Critical: 'bg-red-500',
  High: 'bg-orange-500',
  Medium: 'bg-yellow-500',
  Low: 'bg-gray-500'
};

export const RecommendationsList: React.FC<RecommendationsListProps> = ({ 
  recommendations,
  topOpportunities 
}) => {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  
  // 添加派生优先级并排序
  const sortedRecommendations = useMemo(() => {
    const withPriority = recommendations.map(rec => ({
      ...rec,
      calculatedPriority: rec.priority || calculatePriority(rec)
    }));
    
    // 按优先级排序
    const priorityOrder = { Critical: 0, High: 1, Medium: 2, Low: 3 };
    return withPriority.sort((a, b) => 
      priorityOrder[a.calculatedPriority] - priorityOrder[b.calculatedPriority]
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
            {topOpportunities.technical_optimizations && topOpportunities.technical_optimizations.length > 0 && (
              <div>
                <span className="text-xs font-semibold text-blue-600">Technical Optimizations:</span>
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
            {sortedRecommendations.map((rec, index) => {
              // 安全提取oral examples（处理可能的对象结构）
              const rawOral = rec.examples?.oral || [];
              const oralExamples = Array.isArray(rawOral) 
                ? rawOral.map(item => {
                    // 如果oral item是对象，提取其text属性（确保返回字符串）
                    if (typeof item === 'object' && item !== null && !React.isValidElement(item)) {
                      // 优先获取text字段
                      const text = item.text || item.content || '';
                      // 确保是字符串
                      return typeof text === 'string' ? text : String(text);
                    }
                    // 确保总是返回字符串
                    return typeof item === 'string' ? item : '';
                  }).filter(text => text !== '') // 过滤空字符串
                : [];
              
              // 安全提取text content（处理嵌套对象）
              let textContent = '';
              if (rec.examples?.text) {
                if (typeof rec.examples.text === 'string') {
                  textContent = rec.examples.text;
                } else if (typeof rec.examples.text === 'object' && rec.examples.text !== null) {
                  // 处理 {text: "...", source: "..."} 结构
                  textContent = rec.examples.text.text || rec.examples.text.content || '';
                }
              }
              
              const hasExamples = oralExamples.length > 0 || textContent;
              
              return (
                <AccordionItem key={index} value={`rec-${index}`} className="border rounded-lg">
                  <AccordionTrigger className="hover:no-underline px-4">
                    <div className="flex items-start justify-between w-full pr-4">
                      <div className="flex-1 space-y-2">
                        <div className="flex items-center gap-2">
                          <Badge 
                            className={`${priorityColors[rec.calculatedPriority]} text-white`}
                          >
                            {rec.calculatedPriority}
                          </Badge>
                          
                          {rec.impact && (
                            <div className="flex items-center gap-1 text-xs text-muted-foreground">
                              <TrendingUp className="h-3 w-3" />
                              <span>Impact: {rec.impact}</span>
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
                        <span className="text-xs font-semibold text-muted-foreground">Oral Examples:</span>
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
                        <span className="text-xs font-semibold text-muted-foreground">Screen Text Example:</span>
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