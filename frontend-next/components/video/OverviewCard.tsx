'use client';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { getConfidenceColor, getGradeColor, widenFactor } from '@/lib/normalize';
import type { Overview } from '@/lib/validation';
import { Info } from 'lucide-react';
import type React from 'react';

interface OverviewCardProps {
  overview: Overview;
  dataCompleteness?: number;
}

export const OverviewCard: React.FC<OverviewCardProps> = ({ overview, dataCompleteness = 0.8 }) => {
  const wideFactor = widenFactor(dataCompleteness);
  const confidenceValue = overview.confidence_value || 0.7;
  const confidenceColor = getConfidenceColor(confidenceValue);

  return (
    <Card className="relative overflow-hidden">
      {/* 数据质量提示 - 右上角 */}
      {wideFactor > 1 && (
        <div className="absolute top-4 right-4 flex items-center gap-1 text-xs text-muted-foreground">
          <Info className="h-3 w-3" />
          <span title={`Data confidence interval widened ${wideFactor}x due to limited data`}>
            Widened ×{wideFactor}
          </span>
        </div>
      )}

      <CardHeader>
        <CardTitle className="text-xl font-semibold">Analysis Overview</CardTitle>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* 总分和等级 */}
        <div className="flex items-center justify-between">
          <div className="flex-1 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Overall Score</span>
              <span className="text-2xl font-bold">{overview.score}/100</span>
            </div>
            <Progress value={overview.score} className="h-2" />
          </div>

          <div className="ml-6">
            <Badge
              className={`text-lg px-4 py-1 ${getGradeColor(overview.grade)}`}
              variant="default"
            >
              Grade {overview.grade}
            </Badge>
          </div>
        </div>

        {/* 置信度 */}
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Confidence:</span>
          <Badge
            variant={
              confidenceColor === 'green'
                ? 'default'
                : confidenceColor === 'orange'
                  ? 'secondary'
                  : 'destructive'
            }
          >
            {overview.confidence}
          </Badge>
        </div>

        {/* 摘要 */}
        {overview.summary && (
          <div className="pt-2 border-t">
            <p className="text-sm text-muted-foreground leading-relaxed">{overview.summary}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
