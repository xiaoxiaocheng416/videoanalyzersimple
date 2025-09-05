<template>
  <div class="card">
    <div class="card-header">
      <h3 class="card-title">Video Analysis Report</h3>
    </div>
    <div class="tabs-container">
      <div class="tabs-nav">
        <button
          v-for="tab in tabs"
          :key="tab.key"
          @click="viewMode = tab.key"
          :class="['tab-button', { active: viewMode === tab.key }]"
        >
          {{ tab.icon }} {{ tab.label }}
        </button>
      </div>
      <!-- Analysis Report Tab -->
      <div v-show="viewMode === 'report'" class="analysis-report">
        <div v-if="analysisResult.analysis_type === 'natural_language'" 
             v-html="formatAnalysisText(analysisResult.full_analysis)">
        </div>
        <div v-else class="legacy-format">
          <!-- 兼容旧的JSON格式 -->
          <div v-if="analysisResult.overall_assessment">
            <h3>Overall Assessment</h3>
            <div class="assessment-grid">
              <div class="assessment-item">
                <span class="label">Grade</span>
                <span class="value">{{ analysisResult.overall_assessment.grade }}</span>
              </div>
              <div class="assessment-item">
                <span class="label">Score</span>
                <span class="value">{{ analysisResult.overall_assessment.score }}</span>
              </div>
              <div class="assessment-item">
                <span class="label">Confidence</span>
                <span class="value">{{ analysisResult.overall_assessment.confidence }}</span>
              </div>
            </div>
            <div class="judgment-box">
              <span class="label">Core Judgment</span>
              <p>{{ analysisResult.overall_assessment.core_judgment }}</p>
            </div>
          </div>
        </div>
      </div>
      
      <!-- Raw Data Tab -->
      <div v-show="viewMode === 'json'" class="json-view">
        <div class="json-actions">
          <button @click="copyToClipboard" class="btn btn-sm btn-outline">
            📋 Copy JSON
          </button>
        </div>
        <pre class="json-display">{{ JSON.stringify(analysisResult, null, 2) }}</pre>
      </div>
    </div>
    
    <div class="card-footer">
      <button @click="$emit('clear')" class="btn btn-outline">
        🗑️ Clear Results
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'

interface Props {
  analysisResult: any
}

const props = defineProps<Props>()
defineEmits<{
  clear: []
}>()

const viewMode = ref('report')
const tabs = [
  { key: 'report', label: 'Analysis Report', icon: '📊' },
  { key: 'json', label: 'Raw Data', icon: '🔧' }
]

function formatAnalysisText(text: string): string {
  if (!text) return ''
  
  // 转换markdown格式为HTML
  let html = text
    // 转换 ### 标题
    .replace(/^### (.+)$/gm, '<h3 class="formatted-title">$1</h3>')
    // 转换 ** 粗体
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    // 转换 * 斜体
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    // 转换项目符号
    .replace(/^• (.+)$/gm, '<li>$1</li>')
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    // 包裹连续的li标签
    .replace(/(<li>.*<\/li>\n?)+/g, (match) => `<ul class="formatted-list">${match}</ul>`)
    // 转换换行
    .replace(/\n\n/g, '</p><p class="formatted-paragraph">')
    .replace(/\n/g, '<br>')
  
  // 包裹在段落中
  if (!html.startsWith('<')) {
    html = `<p class="formatted-paragraph">${html}</p>`
  }
  
  return html
}

function copyToClipboard() {
  if (props.analysisResult) {
    navigator.clipboard.writeText(JSON.stringify(props.analysisResult, null, 2))
      .then(() => {
        // Could use a toast notification here instead
        console.log('JSON copied to clipboard!')
      })
      .catch(() => {
        console.error('Failed to copy')
      })
  }
}
</script>

<style scoped>
/* Analysis Report Styles */
.analysis-report {
  padding: 1rem 0;
  min-height: 400px;
}

:deep(.formatted-title) {
  color: #1e293b;
  margin: 2rem 0 1rem 0;
  font-size: 1.5rem;
  font-weight: 600;
  padding-bottom: 0.75rem;
  border-bottom: 2px solid;
  border-image: linear-gradient(90deg, #667eea 0%, #764ba2 100%) 1;
}

:deep(.formatted-title:first-child) {
  margin-top: 0;
}

:deep(.formatted-paragraph) {
  margin: 1rem 0;
  line-height: 1.8;
  color: #475569;
}

:deep(.formatted-list) {
  margin: 1rem 0;
  padding-left: 1.5rem;
}

:deep(.formatted-list li) {
  margin: 0.75rem 0;
  color: #475569;
  line-height: 1.6;
}

:deep(strong) {
  color: #667eea;
  font-weight: 600;
}

:deep(em) {
  color: #64748b;
  font-style: italic;
}

/* Legacy Format Styles */
.legacy-format {
  padding: 1rem;
}

.assessment-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 1.5rem;
  margin: 2rem 0;
}

.assessment-item {
  text-align: center;
  padding: 1.5rem;
  background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%);
  border-radius: 12px;
  transition: transform 0.3s;
}

.assessment-item:hover {
  transform: translateY(-2px);
}

.assessment-item .label {
  display: block;
  font-size: 0.875rem;
  color: #64748b;
  margin-bottom: 0.5rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.assessment-item .value {
  display: block;
  font-size: 1.5rem;
  font-weight: 700;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.judgment-box {
  margin-top: 2rem;
  padding: 1.5rem;
  background: linear-gradient(135deg, #f0f9ff 0%, #e0f2fe 100%);
  border-left: 4px solid #667eea;
  border-radius: 8px;
}

.judgment-box .label {
  display: block;
  font-size: 0.875rem;
  color: #64748b;
  margin-bottom: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.judgment-box p {
  color: #1e293b;
  line-height: 1.8;
  margin: 0;
}

/* JSON View Styles */
.json-view {
  position: relative;
  min-height: 400px;
}

.json-actions {
  position: absolute;
  top: 1rem;
  right: 1rem;
  z-index: 10;
}

.json-display {
  background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%);
  color: #4ec9b0;
  padding: 2rem;
  border-radius: 12px;
  overflow-x: auto;
  font-family: 'Fira Code', 'Courier New', monospace;
  font-size: 0.875rem;
  line-height: 1.6;
  max-height: 600px;
  overflow-y: auto;
  box-shadow: inset 0 2px 8px rgba(0, 0, 0, 0.2);
}

/* Custom scrollbar for JSON view */
.json-display::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}

.json-display::-webkit-scrollbar-track {
  background: rgba(255, 255, 255, 0.05);
  border-radius: 4px;
}

.json-display::-webkit-scrollbar-thumb {
  background: rgba(102, 126, 234, 0.5);
  border-radius: 4px;
}

.json-display::-webkit-scrollbar-thumb:hover {
  background: rgba(102, 126, 234, 0.7);
}

/* Card Footer */
.card-footer {
  margin-top: 1.5rem;
  padding-top: 1.5rem;
  border-top: 1px solid var(--border-color);
  display: flex;
  justify-content: center;
}

/* Tabs Styles */
.tabs-container {
  margin-bottom: 1.5rem;
}

.tabs-nav {
  display: flex;
  gap: 0.5rem;
  border-bottom: 2px solid var(--border-color);
  margin-bottom: 1.5rem;
}

.tab-button {
  padding: 0.75rem 1.5rem;
  background: none;
  border: none;
  color: var(--text-secondary);
  cursor: pointer;
  font-weight: 500;
  position: relative;
  transition: all var(--transition-fast);
}

.tab-button:hover {
  color: var(--primary-color);
}

.tab-button.active {
  color: var(--primary-color);
}

.tab-button.active::after {
  content: '';
  position: absolute;
  bottom: -2px;
  left: 0;
  right: 0;
  height: 2px;
  background: var(--primary-color);
}
</style>