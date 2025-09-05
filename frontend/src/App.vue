<template>
  <div id="app">
    <div class="container">
      <div class="header">
        <h1 class="title">🎬 视频分析工具</h1>
        <p class="subtitle">使用 Google Gemini AI 分析您的视频内容</p>
      </div>
      
      <div class="main-content">
        <VideoUploader @upload-complete="handleUploadComplete" @log="addLog" />
        <ProcessLogs v-if="logs.length > 0" :logs="logs" />
        <AnalysisReport v-if="analysisResult" :analysis-result="analysisResult" @clear="clearResults" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import VideoUploader from './components/VideoUploader.vue'
import ProcessLogs from './components/ProcessLogs.vue'
import AnalysisReport from './components/AnalysisReport.vue'

// State
const logs = ref<string[]>([])
const analysisResult = ref<any>(null)

// Methods
function addLog(message: string) {
  logs.value.push(message)
}

function handleUploadComplete(result: any) {
  console.log('Analysis complete:', result)
  analysisResult.value = result
}

function clearResults() {
  analysisResult.value = null
  logs.value = []
}
</script>

<style>
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  min-height: 100vh;
}

#app {
  min-height: 100vh;
  padding: 2rem;
}

.container {
  max-width: 1200px;
  margin: 0 auto;
}

.header {
  text-align: center;
  margin-bottom: 3rem;
}

.title {
  font-size: 3rem;
  color: white;
  margin-bottom: 1rem;
  text-shadow: 2px 2px 4px rgba(0, 0, 0, 0.2);
}

.subtitle {
  font-size: 1.25rem;
  color: rgba(255, 255, 255, 0.9);
}

.main-content {
  display: flex;
  flex-direction: column;
  gap: 2rem;
}
</style>