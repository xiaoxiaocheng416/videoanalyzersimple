import {
  percentToUnit,
  normalizePillars,
  cleanEmptyValue,
  calculateTotalScore
} from './normalize';
import { parseAnalysisResult } from './validation';

// API base: env override, fallback to /api (for proxy)
const API_BASE = (process.env.NEXT_PUBLIC_API_BASE?.replace(/\/$/, '') || '/api');

// 完整性检查 - 确保数据不是全默认值
function hasRealData(data: any): boolean {
  if (!data) return false;

  // 检查pillars是否有非零值
  const hasPillarsData = data.pillars && Object.values(data.pillars).some((v: any) => v > 0);

  // 检查overview score
  const hasScore = data.overview?.score > 0;

  // 检查timeline是否有内容
  const hasTimeline = data.timeline?.length > 0;

  // 检查recommendations是否有内容
  const hasRecommendations = data.recommendations?.length > 0;

  // 至少需要有分数和其他内容之一
  return (hasPillarsData || hasScore) && (hasTimeline || hasRecommendations);
}

export class VideoAnalyzerAPI {
  static async analyzeVideo(
    file: File,
    onProgress?: (progress: number) => void,
  ): Promise<any> {
    const formData = new FormData();
    formData.append('video', file);

    try {
      const xhr = new XMLHttpRequest();

      return new Promise((resolve, reject) => {
        // Set timeout to 2 minutes for Gemini processing
        xhr.timeout = 120000; // 120 seconds

        xhr.upload.addEventListener('progress', (e) => {
          if (e.lengthComputable && onProgress) {
            const progress = (e.loaded / e.total) * 100;
            onProgress(progress);
          }
        });

        xhr.addEventListener('load', () => {
          if (xhr.status === 200) {
            try {
              const response = JSON.parse(xhr.responseText);
              resolve(response);
            } catch (error) {
              reject(new Error('Failed to parse response'));
            }
          } else {
            // 尝试解析错误响应以获取详细信息
            try {
              const errorResponse = JSON.parse(xhr.responseText);
              const errorMessage = errorResponse.message || `Request failed with status ${xhr.status}`;
              console.error('[API Error]', errorMessage, errorResponse);
              reject(new Error(errorMessage));
            } catch (parseError) {
              // 如果无法解析，返回通用错误
              console.error('[API Error] Failed to parse error response:', xhr.responseText);
              reject(new Error(`Request failed with status ${xhr.status}`));
            }
          }
        });

        xhr.addEventListener('error', () => {
          reject(new Error('Network error occurred'));
        });

        xhr.addEventListener('timeout', () => {
          reject(new Error('Request timeout - video analysis is taking longer than expected'));
        });

        xhr.open('POST', `${API_BASE}/videos/upload`);
        xhr.send(formData);
      });
    } catch (error) {
      throw new Error(
        error instanceof Error ? error.message : 'Failed to analyze video',
      );
    }
  }

  static formatAnalysisResults(rawResults: any) {
    // 新的JSON格式处理 - 第三层防护
    if (rawResults?.analysisResult) {
      const result = rawResults.analysisResult;

      // 检查验证状态
      const validationStatus = result.validation_status || {};
      const hasWarning = result.warning;

      // 如果后端已经解析了JSON，使用parsed_data
      if (result.parsed_data) {
        console.log('[前端] 使用后端解析的数据');
        console.log('[前端] 验证状态:', validationStatus);

        // 🔍 调试日志 1：原始后端数据
        console.log('[调试1] 原始后端parsed_data:', JSON.stringify(result.parsed_data, null, 2));

        // 检测是否是不完整的响应
        if (!validationStatus.is_complete_structure) {
          console.warn('[前端] 检测到不完整的数据结构');
          console.warn('[前端] 缺失字段:', validationStatus.missing_fields);
          console.warn('[前端] 是否有实际分数:', validationStatus.has_actual_scores);
        }

        try {
          // 先通过Zod验证，获得带默认值的数据结构
          const validatedData = parseAnalysisResult(result.parsed_data);

          // 🔍 调试日志 2：Zod验证后的数据
          console.log('[调试2] Zod验证后数据:', validatedData ? '验证成功' : '验证失败返回null');
          if (validatedData) {
            console.log('[调试2] 验证后的pillars:', validatedData.pillars);
            console.log('[调试2] 验证后的overview.score:', validatedData.overview.score);
          }

          // 应用数据规范化
          if (validatedData) {
            // 🔍 调试日志 3：规范化前的pillars
            console.log('[调试3] 规范化前的pillars:', JSON.stringify(validatedData.pillars));

            // 规范化pillars分数到0-10
            validatedData.pillars = normalizePillars(
              validatedData.pillars,
              validatedData.pillars_meta
            );

            // 🔍 调试日志 4：规范化后的pillars
            console.log('[调试4] 规范化后的pillars:', JSON.stringify(validatedData.pillars));

            // 计算总分
            if (!validatedData.overview.score || validatedData.overview.score === 0) {
              const calculatedScore = calculateTotalScore(validatedData.pillars);
              console.log('[调试5] 计算的总分:', calculatedScore);
              validatedData.overview.score = calculatedScore;
            } else {
              console.log('[调试5] 使用原有总分:', validatedData.overview.score);
            }

            // 清洗timeline中的空值
            if (validatedData.timeline) {
              validatedData.timeline = validatedData.timeline.map((segment: any) => ({
                ...segment,
                issue: cleanEmptyValue(segment.issue),
                risk: cleanEmptyValue(segment.risk),
                fix_hint: cleanEmptyValue(segment.fix_hint)
              }));
            }

            // 规范化百分比值
            if (validatedData.overview.confidence) {
              validatedData.overview.confidence_value = percentToUnit(validatedData.overview.confidence);
            }
            if (validatedData.forecast.pass_probability) {
              validatedData.forecast.pass_probability_value = percentToUnit(validatedData.forecast.pass_probability);
            }

            // 🔍 调试日志 6：最终返回的数据
            console.log('[调试6] 最终返回数据:', {
              score: validatedData.overview.score,
              pillars: validatedData.pillars,
              timeline_length: validatedData.timeline?.length || 0,
              recommendations_length: validatedData.recommendations?.length || 0
            });

            // 完整性检查 - 确保不是全默认值
            if (!hasRealData(validatedData)) {
              console.error('[完整性检查失败] 数据看起来全是默认值');
              console.error('[完整性检查] 返回原始数据而不是默认值');

              // 尝试直接使用原始数据
              return {
                type: 'structured',
                data: result.parsed_data, // 使用原始数据而不是验证后的默认值
                metadata: result.metadata,
                validation: {
                  ...validationStatus,
                  completeness_check_failed: true,
                  message: 'Data appears to be all defaults, showing raw data instead'
                },
                warning: 'Data completeness check failed - showing raw data',
                rawResponse: result.raw_response || result.full_analysis
              };
            }

            return {
              type: 'structured',
              data: validatedData,
              metadata: result.metadata,
              validation: validationStatus,
              warning: hasWarning,
              rawResponse: result.raw_response || result.full_analysis // 包含原始响应
            };
          } else {
            // 验证失败，返回null，需要特殊处理
            console.error('[前端] Zod验证失败，返回null');
            console.error('[前端] 原始数据:', result.parsed_data);

            // 即使验证失败，也要应用规范化
            const rawData = result.parsed_data || {};

            // 规范化pillars（即使验证失败）
            if (rawData.pillars) {
              rawData.pillars = normalizePillars(rawData.pillars, rawData.pillars_meta);
              console.log('[前端] 验证失败但已规范化pillars:', rawData.pillars);
            }

            // 尝试直接使用原始数据而不是返回错误
            // 这可以帮助我们看到实际数据，即使它不符合schema
            return {
              type: 'structured',
              data: rawData,
              metadata: result.metadata,
              validation: {
                ...validationStatus,
                zod_validation_failed: true
              },
              warning: hasWarning || 'Data validation failed but showing raw data',
              rawResponse: result.raw_response || result.full_analysis
            };
          }
        } catch (e) {
          console.error('Failed to parse parsed_data:', e);

          // 即使出错也要应用规范化
          const rawData = result.parsed_data || {};

          // 规范化pillars（即使出错）
          if (rawData.pillars) {
            rawData.pillars = normalizePillars(rawData.pillars, rawData.pillars_meta);
            console.log('[前端] 解析错误但已规范化pillars:', rawData.pillars);
          }

          // 即使出错也尝试返回原始数据
          return {
            type: 'structured',
            data: rawData,
            metadata: result.metadata,
            validation: {
              ...validationStatus,
              parse_error: true,
              error_message: e instanceof Error ? e.message : 'Unknown error'
            },
            warning: hasWarning || 'Parse error occurred but showing raw data',
            rawResponse: result.raw_response || result.full_analysis
          };
        }
      } // 关闭 if (result.parsed_data) 块

      // 如果没有parsed_data，尝试解析full_analysis（向后兼容）
      try {
        let analysisData;

        if (typeof result.full_analysis === 'string') {
          const cleanJson = result.full_analysis
            .replace(/^```json\s*/, '')
            .replace(/\s*```$/, '')
            .trim();

          analysisData = JSON.parse(cleanJson);
        } else {
          analysisData = result.full_analysis;
        }

        const validatedData = parseAnalysisResult(analysisData);

        console.log('[调试-fallback] 使用full_analysis解析，结果:', validatedData ? '成功' : 'null');

        if (validatedData) {
          // 应用相同的规范化逻辑
          validatedData.pillars = normalizePillars(
            validatedData.pillars,
            validatedData.pillars_meta
          );

          if (!validatedData.overview.score || validatedData.overview.score === 0) {
            validatedData.overview.score = calculateTotalScore(validatedData.pillars);
          }

          if (validatedData.timeline) {
            validatedData.timeline = validatedData.timeline.map((segment: any) => ({
              ...segment,
              issue: cleanEmptyValue(segment.issue),
              risk: cleanEmptyValue(segment.risk),
              fix_hint: cleanEmptyValue(segment.fix_hint)
            }));
          }

          if (validatedData.overview.confidence) {
            validatedData.overview.confidence_value = percentToUnit(validatedData.overview.confidence);
          }
          if (validatedData.forecast.pass_probability) {
            validatedData.forecast.pass_probability_value = percentToUnit(validatedData.forecast.pass_probability);
          }

          return {
            type: 'structured',
            data: validatedData,
            metadata: result.metadata,
            validation: validationStatus,
            warning: hasWarning,
            rawResponse: result.raw_response || result.full_analysis
          };
        }
      } catch (e) {
        console.error('Failed to parse JSON analysis:', e);
        // 如果解析失败，返回原始文本
        return {
          type: 'text',
          fullText: result.full_analysis,
          metadata: result.metadata,
          validation: validationStatus,
          warning: hasWarning,
          rawResponse: result.raw_response || result.full_analysis
        };
      }
    } // 关闭 if (rawResults?.analysisResult) 块

    // 兼容旧格式
    return {
      type: 'text',
      fullText: JSON.stringify(rawResults, null, 2),
      metadata: null
    };
  }
}
