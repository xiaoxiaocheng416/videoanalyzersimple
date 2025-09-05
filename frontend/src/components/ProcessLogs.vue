<template>
  <div class="card">
    <div class="card-header">
      <h3 class="card-title">📋 Processing Logs</h3>
    </div>
    <div class="logs-container">
      <div v-for="(log, index) in logs" :key="index" class="log-line">
        <span class="log-time">{{ getLogTime(log) }}</span>
        <span class="log-content">{{ getLogContent(log) }}</span>
      </div>
      <div ref="logsEnd"></div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, nextTick } from 'vue'

interface Props {
  logs: string[]
}

const props = defineProps<Props>()
const logsEnd = ref<HTMLElement>()

// Auto-scroll to bottom when new logs are added
watch(() => props.logs.length, () => {
  nextTick(() => {
    logsEnd.value?.scrollIntoView({ behavior: 'smooth' })
  })
})

function getLogTime(log: string): string {
  const match = log.match(/\[([\d:]+\s*[AP]?M?)\]/)
  return match ? match[1] : ''
}

function getLogContent(log: string): string {
  return log.replace(/\[[\d:]+\s*[AP]?M?\]\s*/, '')
}
</script>

<style scoped>
.logs-container {
  background: linear-gradient(135deg, #1e293b 0%, #334155 100%);
  border-radius: 8px;
  padding: 1rem;
  font-family: 'Fira Code', 'Courier New', monospace;
  font-size: 0.875rem;
  max-height: 300px;
  overflow-y: auto;
  box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.1);
}

/* Custom scrollbar */
.logs-container::-webkit-scrollbar {
  width: 8px;
}

.logs-container::-webkit-scrollbar-track {
  background: rgba(255, 255, 255, 0.05);
  border-radius: 4px;
}

.logs-container::-webkit-scrollbar-thumb {
  background: rgba(102, 126, 234, 0.5);
  border-radius: 4px;
}

.logs-container::-webkit-scrollbar-thumb:hover {
  background: rgba(102, 126, 234, 0.7);
}

.log-line {
  display: flex;
  gap: 1rem;
  margin-bottom: 0.5rem;
  padding: 0.25rem 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  animation: slideIn 0.3s ease-out;
}

@keyframes slideIn {
  from {
    opacity: 0;
    transform: translateX(-10px);
  }
  to {
    opacity: 1;
    transform: translateX(0);
  }
}

.log-line:last-child {
  border-bottom: none;
}

.log-time {
  color: #94a3b8;
  flex-shrink: 0;
  font-weight: 500;
}

.log-content {
  color: #10b981;
  word-break: break-all;
  line-height: 1.5;
}

/* Different colors for different log types */
.log-content:has-text("错误"),
.log-content:has-text("error"),
.log-content:has-text("Error") {
  color: #ef4444;
}

.log-content:has-text("完成"),
.log-content:has-text("success"),
.log-content:has-text("Success") {
  color: #22c55e;
}

.log-content:has-text("上传"),
.log-content:has-text("upload"),
.log-content:has-text("Upload") {
  color: #3b82f6;
}
</style>