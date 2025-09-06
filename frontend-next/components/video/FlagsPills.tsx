'use client';

import { Badge } from '@/components/ui/badge';
import type { Flag } from '@/lib/validation';
import { AlertCircle, AlertTriangle, CheckCircle, Info, XCircle } from 'lucide-react';
import type React from 'react';

interface FlagsPillsProps {
  flags: Flag[];
}

// 静态规则映射 - 前端兜底解释
const flagDescriptions: Record<string, string> = {
  upper_bound_b: 'No product shown in first 3s',
  upper_bound_c: 'No effective hook in 0-3s',
  fatal_flaw: 'Poor video/audio quality',
  missing_cta: 'No clear call-to-action',
  no_product_display: 'Product not clearly visible',
  low_creator_trust: 'Creator credibility issues',
  unclear_value_prop: 'Value proposition not clear',
  poor_lighting: 'Lighting quality issues',
  bad_audio: 'Audio quality problems',
  too_long: 'Video duration too long',
  too_short: 'Video duration too short',
  no_urgency: 'Missing urgency elements',
  weak_hook: 'Opening hook not engaging',
  technical_issue: 'Technical quality problems',
  content_warning: 'Content policy concerns',
};

// 标记类型映射到图标和颜色
const flagTypeConfig = {
  error: {
    icon: XCircle,
    color: 'text-red-600 border-red-300 bg-red-50 dark:bg-red-950/20',
    label: 'Error',
  },
  warning: {
    icon: AlertTriangle,
    color: 'text-orange-600 border-orange-300 bg-orange-50 dark:bg-orange-950/20',
    label: 'Warning',
  },
  info: {
    icon: Info,
    color: 'text-blue-600 border-blue-300 bg-blue-50 dark:bg-blue-950/20',
    label: 'Info',
  },
  success: {
    icon: CheckCircle,
    color: 'text-green-600 border-green-300 bg-green-50 dark:bg-green-950/20',
    label: 'Good',
  },
  critical: {
    icon: AlertCircle,
    color: 'text-red-600 border-red-500 bg-red-100 dark:bg-red-950/30',
    label: 'Critical',
  },
};

// 从消息内容推断类型
const inferFlagType = (flag: Flag): keyof typeof flagTypeConfig => {
  const message = flag.message?.toLowerCase() || '';
  const type = flag.type?.toLowerCase() || '';

  if (
    type === 'fatal' ||
    type === 'critical' ||
    message.includes('fatal') ||
    message.includes('critical')
  ) {
    return 'critical';
  }
  if (type === 'error' || message.includes('error') || message.includes('fail')) {
    return 'error';
  }
  if (type === 'warning' || message.includes('warning') || message.includes('caution')) {
    return 'warning';
  }
  if (type === 'success' || message.includes('good') || message.includes('excellent')) {
    return 'success';
  }
  return 'info';
};

export const FlagsPills: React.FC<FlagsPillsProps> = ({ flags }) => {
  if (!flags || flags.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-wrap gap-2">
      {flags.map((flag, index) => {
        const flagType = inferFlagType(flag);
        const config = flagTypeConfig[flagType];
        const Icon = config.icon;

        // 获取描述文本 - 优先使用message，其次使用静态映射
        const description = flag.message || flagDescriptions[flag.type] || flag.type;

        return (
          <Badge
            key={index}
            variant="outline"
            className={`px-3 py-1.5 flex items-center gap-1.5 ${config.color} cursor-default hover:shadow-sm transition-shadow`}
            title={description} // Tooltip显示完整文本
          >
            <Icon className="h-3.5 w-3.5" />
            <span className="text-xs font-medium max-w-[200px] truncate">{description}</span>
          </Badge>
        );
      })}
    </div>
  );
};
