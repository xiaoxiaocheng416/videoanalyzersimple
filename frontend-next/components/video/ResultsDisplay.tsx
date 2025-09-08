'use client';

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Download,
  FileText,
  Info,
  RefreshCw,
  Shield,
  Target,
  Trophy,
} from 'lucide-react';
import React, { useMemo } from 'react';

import NarrativeDetails from '@/components/video/NarrativeDetails';
import type { AnalysisResult } from '@/lib/validation';
import EditableSummary from './EditableSummary';
import { FlagsPills } from './FlagsPills';
// 导入新组件
import { OverviewCard } from './OverviewCard';
import { RecommendationsList } from './RecommendationsList';
import { TimelineAnalysis } from './TimelineAnalysis';

// ---- local types for data quality ----
type DataQualityObj = {
  completeness?: number;
  score?: number;
  issues?: number;
  notes?: string;
  [k: string]: unknown;
};
type DataQuality = number | string | DataQualityObj | null | undefined;

// 页面本地认知的数据形状（不改全局类型，只做局部放宽）
type AnalysisDataLocal = {
  overview: { score: number; grade: string; [k: string]: unknown };
  // 后端有时用 snake_case，有时 camelCase，这里两者都兼容
  data_quality?: DataQuality;
  dataQuality?: DataQuality;
  [k: string]: unknown;
};

interface ResultsDisplayProps {
  results: {
    type: 'structured' | 'text';
    data?: AnalysisResult;
    fullText?: string;
    metadata?: {
      filename?: string;
      filesize?: number;
      mimetype?: string;
      analysis_time?: number;
      timestamp?: string;
    };
    validation?: {
      is_valid_json?: boolean;
      is_complete_structure?: boolean;
      missing_fields?: string[];
      has_actual_scores?: boolean;
    };
    warning?: string;
    rawResponse?: string;
  };
  onAnalyzeAgain: () => void;
  onDownloadReport?: () => void;
}

export function ResultsDisplay({ results, onAnalyzeAgain, onDownloadReport }: ResultsDisplayProps) {
  // 生成analysisId（使用timestamp或metadata.timestamp）
  const analysisId = useMemo(() => {
    if (results.metadata?.timestamp) {
      return results.metadata.timestamp;
    }
    return Date.now().toString();
  }, [results.metadata?.timestamp]);

  // 渲染结构化数据
  if (results.type === 'structured' && results.data) {
    const data = results.data;
    const validation = results.validation;
    const hasValidationWarning = validation && !validation.is_complete_structure;

    // 兼容两种字段名，并做类型归一化
    const dqRaw =
      (data as Partial<AnalysisDataLocal>).data_quality ??
      (data as Partial<AnalysisDataLocal>).dataQuality;

    const dataCompleteness =
      typeof dqRaw === 'object' && dqRaw !== null
        ? // 对象时优先 completeness，其次 score
          ((dqRaw as DataQualityObj).completeness ?? (dqRaw as DataQualityObj).score ?? undefined)
        : ((dqRaw as number | string | null | undefined) ?? undefined);

    return (
      <div className="w-full space-y-6">
        {/* 验证警告 - 第三层防护UI反馈 */}
        {hasValidationWarning && (
          <Alert className="border-orange-300 bg-orange-50 dark:bg-orange-950/20">
            <AlertTriangle className="h-4 w-4 text-orange-600" />
            <AlertTitle>Incomplete Analysis Detected</AlertTitle>
            <AlertDescription className="mt-2 space-y-1">
              <p>The AI analysis returned incomplete data. Some values may be defaults:</p>
              {validation.missing_fields && validation.missing_fields.length > 0 && (
                <p className="text-sm">Missing fields: {validation.missing_fields.join(', ')}</p>
              )}
              {validation.has_actual_scores === false && (
                <p className="text-sm">No actual scores were detected in the response.</p>
              )}
              <p className="text-sm font-medium mt-2">Try analyzing again for better results.</p>
            </AlertDescription>
          </Alert>
        )}

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold">Analysis Complete</h2>
            <p className="text-muted-foreground mt-1">TikTok Shop Video Analysis Results</p>
          </div>
          <div className="flex gap-2">
            {onDownloadReport && (
              <Button variant="outline" onClick={onDownloadReport}>
                <Download className="h-4 w-4 mr-2" />
                Download Report
              </Button>
            )}
            <Button onClick={onAnalyzeAgain}>
              <RefreshCw className="h-4 w-4 mr-2" />
              Analyze Another
            </Button>
          </div>
        </div>

        {/* Flags Pills - 顶部显示警告标记 */}
        {data.flags && data.flags.length > 0 && (
          <div className="p-4 border rounded-lg bg-muted/30">
            <FlagsPills flags={data.flags} />
          </div>
        )}

        {/* 主要内容区域 - 使用Tabs */}
        <Tabs defaultValue="overview" className="w-full">
          <TabsList className="flex w-full overflow-hidden gap-1 p-1 bg-muted rounded-lg">
            <TabsTrigger
              value="overview"
              className="flex-1 basis-0 min-w-0 justify-center overflow-hidden text-ellipsis whitespace-nowrap text-xs sm:text-sm"
            >
              Overview
            </TabsTrigger>
            <TabsTrigger
              value="timeline"
              className="flex-1 basis-0 min-w-0 justify-center overflow-hidden text-ellipsis whitespace-nowrap text-xs sm:text-sm"
            >
              Timeline
            </TabsTrigger>
            <TabsTrigger
              value="recommendations"
              className="flex-1 basis-0 min-w-0 justify-center overflow-hidden text-ellipsis whitespace-nowrap text-xs sm:text-sm"
            >
              Suggest
            </TabsTrigger>
            <TabsTrigger
              value="summary"
              className="flex-1 basis-0 min-w-0 justify-center overflow-hidden text-ellipsis whitespace-nowrap text-xs sm:text-sm"
            >
              Summary
            </TabsTrigger>
            <TabsTrigger
              value="details"
              className="flex-1 basis-0 min-w-0 justify-center overflow-hidden text-ellipsis whitespace-nowrap text-xs sm:text-sm"
            >
              Details
            </TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="mt-6 space-y-6">
            {/* 总览卡片 */}
            <OverviewCard
              overview={data.overview}
              dataCompleteness={
                typeof dataCompleteness === 'number'
                  ? dataCompleteness
                  : typeof dataCompleteness === 'string'
                    ? Number.parseFloat(dataCompleteness) || undefined
                    : undefined
              }
            />

            {/* Pillars分数展示 */}
            {data.pillars && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <BarChart3 className="h-5 w-5" />
                    Performance Pillars
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {Object.entries(data.pillars).map(([key, value]) => (
                    <div key={key} className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium capitalize">
                          {key.replace(/_/g, ' ')}
                        </span>
                        <span className="text-sm font-bold">{value}/10</span>
                      </div>
                      <div className="h-2 bg-muted rounded-full overflow-hidden">
                        <div
                          className="h-full bg-primary transition-all"
                          style={{ width: `${value * 10}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}

            {/* 预测 */}
            {data.forecast && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Target className="h-5 w-5" />
                    Performance Forecast
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Pass Probability</span>
                    <Badge variant="secondary">{data.forecast.pass_probability}</Badge>
                  </div>
                  {data.forecast.revenue_forecast && (
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">Revenue Forecast</span>
                      <span className="text-sm font-medium">{data.forecast.revenue_forecast}</span>
                    </div>
                  )}
                  {data.forecast.notes && (
                    <p className="text-sm text-muted-foreground mt-2">{data.forecast.notes}</p>
                  )}
                </CardContent>
              </Card>
            )}
          </TabsContent>

          <TabsContent value="timeline" className="mt-6">
            <TimelineAnalysis timeline={data.timeline || []} />
          </TabsContent>

          <TabsContent value="recommendations" className="mt-6">
            <RecommendationsList
              recommendations={data.recommendations || []}
              topOpportunities={data.top_opportunities}
            />
          </TabsContent>

          <TabsContent value="summary" className="mt-6">
            <EditableSummary
              analysisId={analysisId}
              aiText={(data as any)?.improvement_summary || ''}
              userText={undefined}
            />
          </TabsContent>

          <TabsContent value="details" className="mt-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Shield className="h-5 w-5" />
                  Analysis Data Details
                </CardTitle>
                <CardDescription>Raw AI response and normalized data</CardDescription>
              </CardHeader>
              <CardContent>
                <Accordion type="single" collapsible className="w-full">
                  {/* 原始AI响应 */}
                  {results.rawResponse && (
                    <AccordionItem value="ai-response">
                      <AccordionTrigger className="font-medium">
                        <div className="inline-flex items-center gap-2">
                          <span className="w-5 inline-flex justify-center" aria-hidden>
                            🤖
                          </span>
                          <span>Raw AI Response (Actual Output)</span>
                        </div>
                      </AccordionTrigger>
                      <AccordionContent>
                        <div className="space-y-2">
                          <p className="text-xs text-muted-foreground mb-2">
                            This is the exact response from the AI model:
                          </p>
                          <div className="overflow-x-auto max-w-full">
                            <pre className="bg-muted/50 rounded-lg p-4 text-xs max-h-[400px] overflow-y-auto">
                              {typeof results.rawResponse === 'string'
                                ? results.rawResponse
                                : JSON.stringify(results.rawResponse, null, 2)}
                            </pre>
                          </div>
                        </div>
                      </AccordionContent>
                    </AccordionItem>
                  )}

                  {/* 规范化后的数据 */}
                  <AccordionItem value="normalized">
                    <AccordionTrigger className="font-medium">
                      <div className="inline-flex items-center gap-2">
                        <span className="w-5 inline-flex justify-center" aria-hidden>
                          📊
                        </span>
                        <span>Normalized Data (After Processing)</span>
                      </div>
                    </AccordionTrigger>
                    <AccordionContent>
                      <div className="space-y-2">
                        <p className="text-xs text-muted-foreground mb-2">
                          This is the data after validation and normalization:
                        </p>
                        <div className="overflow-x-auto max-w-full">
                          <pre className="bg-muted/50 rounded-lg p-4 text-xs max-h-[400px] overflow-y-auto">
                            {JSON.stringify(data, null, 2)}
                          </pre>
                        </div>
                      </div>
                    </AccordionContent>
                  </AccordionItem>

                  {/* 验证状态 */}
                  {validation && (
                    <AccordionItem value="validation">
                      <AccordionTrigger className="font-medium">
                        <div className="inline-flex items-center gap-2">
                          <span className="w-5 inline-flex justify-center" aria-hidden>
                            ✅
                          </span>
                          <span>Validation Status</span>
                        </div>
                      </AccordionTrigger>
                      <AccordionContent>
                        <div className="space-y-2">
                          <div className="grid grid-cols-2 gap-2 text-sm">
                            <div>Valid JSON:</div>
                            <div
                              className={
                                validation.is_valid_json ? 'text-green-600' : 'text-red-600'
                              }
                            >
                              {validation.is_valid_json ? '✓ Yes' : '✗ No'}
                            </div>
                            <div>Complete Structure:</div>
                            <div
                              className={
                                validation.is_complete_structure ? 'text-green-600' : 'text-red-600'
                              }
                            >
                              {validation.is_complete_structure ? '✓ Yes' : '✗ No'}
                            </div>
                            <div>Has Actual Scores:</div>
                            <div
                              className={
                                validation.has_actual_scores ? 'text-green-600' : 'text-red-600'
                              }
                            >
                              {validation.has_actual_scores ? '✓ Yes' : '✗ No'}
                            </div>
                          </div>
                          {validation.missing_fields && validation.missing_fields.length > 0 && (
                            <div className="mt-2 p-2 bg-orange-50 dark:bg-orange-950/20 rounded">
                              <p className="text-xs font-medium">Missing Fields:</p>
                              <p className="text-xs">{validation.missing_fields.join(', ')}</p>
                            </div>
                          )}
                        </div>
                      </AccordionContent>
                    </AccordionItem>
                  )}

                  {data.raw_notes && (
                    <AccordionItem value="notes">
                      <AccordionTrigger>Additional Notes</AccordionTrigger>
                      <AccordionContent>
                        <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                          {data.raw_notes}
                        </p>
                      </AccordionContent>
                    </AccordionItem>
                  )}
                  {/* Natural Language Narrative */}
                  <AccordionItem value="narrative">
                    <AccordionTrigger className="font-medium">
                      <div className="inline-flex items-center gap-2">
                        <span className="w-5 inline-flex justify-center" aria-hidden>
                          📝
                        </span>
                        <span>Natural Language Narrative</span>
                      </div>
                    </AccordionTrigger>
                    <AccordionContent>
                      <NarrativeDetails data={data as any} showHeading={false} />
                    </AccordionContent>
                  </AccordionItem>
                </Accordion>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    );
  }

  // 回退到原始文本显示（向后兼容）
  const parsedAnalysis = useMemo(() => {
    const text = results.fullText || '';
    const sections: { [key: string]: string } = {
      overview: '',
      scoring: '',
      improvements: '',
      full: text,
    };

    const overviewMatch = text.match(/##\s*Overall Assessment.*?(?=##|$)/s);
    const scoringMatch = text.match(/##\s*Category Scores.*?(?=##|$)/s);
    const improvementsMatch = text.match(/##\s*Key Improvements.*?(?=##|$)/s);

    if (overviewMatch) sections.overview = overviewMatch[0];
    if (scoringMatch) sections.scoring = scoringMatch[0];
    if (improvementsMatch) sections.improvements = improvementsMatch[0];

    if (!sections.overview && !sections.scoring && !sections.improvements) {
      sections.overview = text;
    }

    return sections;
  }, [results.fullText]);

  const formatAnalysisText = (text: string) => {
    return text.split('\n').map((line, index) => {
      if (line.startsWith('###')) {
        return (
          <h3 key={index} className="text-lg font-semibold mt-6 mb-3 text-primary">
            {line.replace(/^#+\s*/, '')}
          </h3>
        );
      }
      if (line.startsWith('##')) {
        return (
          <h2 key={index} className="text-xl font-bold mt-8 mb-4">
            {line.replace(/^#+\s*/, '')}
          </h2>
        );
      }
      if (line.startsWith('•') || line.startsWith('-')) {
        return (
          <div key={index} className="flex items-start gap-2 ml-4 mb-2">
            <span className="text-primary mt-1">•</span>
            <span className="text-sm">{line.replace(/^[•-]\s*/, '')}</span>
          </div>
        );
      }
      if (/^\d+\./.test(line)) {
        return (
          <div key={index} className="ml-4 mb-2">
            <span className="text-sm">{line}</span>
          </div>
        );
      }
      if (line.trim()) {
        return (
          <p key={index} className="text-sm text-muted-foreground mb-2 leading-relaxed">
            {line}
          </p>
        );
      }
      return <div key={index} className="h-2" />;
    });
  };

  return (
    <div className="w-full space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Analysis Complete</h2>
          <p className="text-muted-foreground mt-1">TikTok Shop Video Analysis Results</p>
        </div>
        <div className="flex gap-2">
          {onDownloadReport && (
            <Button variant="outline" onClick={onDownloadReport}>
              <Download className="h-4 w-4 mr-2" />
              Download Report
            </Button>
          )}
          <Button onClick={onAnalyzeAgain}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Analyze Another
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {results.metadata?.filename && (
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <FileText className="h-8 w-8 text-primary" />
              <div>
                <p className="text-sm text-muted-foreground">Video File</p>
                <p className="text-sm font-medium truncate">{results.metadata.filename}</p>
              </div>
            </CardContent>
          </Card>
        )}
        {results.metadata?.filesize && (
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <Activity className="h-8 w-8 text-primary" />
              <div>
                <p className="text-sm text-muted-foreground">File Size</p>
                <p className="text-xl font-bold">
                  {((results.metadata.filesize || 0) / 1024 / 1024).toFixed(1)}MB
                </p>
              </div>
            </CardContent>
          </Card>
        )}
        {results.metadata?.analysis_time && (
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <Target className="h-8 w-8 text-primary" />
              <div>
                <p className="text-sm text-muted-foreground">Analysis Time</p>
                <p className="text-xl font-bold">
                  {(results.metadata.analysis_time / 1000).toFixed(1)}s
                </p>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Info className="h-5 w-5" />
            Analysis Results
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Accordion type="single" collapsible className="w-full">
            <AccordionItem value="analysis">
              <AccordionTrigger>Complete Analysis Results</AccordionTrigger>
              <AccordionContent>
                <div className="prose prose-sm max-w-full dark:prose-invert">
                  <div className="bg-muted/30 rounded-lg p-6 max-h-[600px] overflow-y-auto overflow-x-auto">
                    {formatAnalysisText(results.fullText || '')}
                  </div>
                </div>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </CardContent>
      </Card>
    </div>
  );
}
