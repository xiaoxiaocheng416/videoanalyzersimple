<template>
  <div class="upload-section">
    <div class="card">
      <div class="card-header">
        <h3 class="card-title">📹 Video Upload</h3>
      </div>
      
      <div class="upload-box" :class="{ 'uploading': isUploading }">
        <input 
          type="file" 
          ref="fileInput"
          @change="handleFileSelect"
          accept="video/mp4,video/mov,video/avi"
          :disabled="isUploading"
        />
        
        <div v-if="!selectedFile && !isUploading" class="upload-prompt">
          <div class="upload-icon">📹</div>
          <p>Select a video file to analyze</p>
          <button @click="$refs.fileInput.click()" class="btn btn-primary">
            📁 Choose Video
          </button>
        </div>
        
        <div v-else-if="selectedFile && !isUploading" class="file-selected">
          <div class="file-info">
            <span class="file-icon">📄</span>
            <div>
              <p class="file-name">{{ selectedFile.name }}</p>
              <p class="file-size">{{ formatFileSize(selectedFile.size) }}</p>
            </div>
          </div>
          <div class="action-buttons">
            <button @click="uploadAndAnalyze" class="btn btn-primary">
              🚀 Analyze Video
            </button>
            <button @click="clearSelection" class="btn btn-outline">
              Clear
            </button>
          </div>
        </div>
        
        <div v-else-if="isUploading" class="uploading-status">
          <p class="upload-status-text">{{ uploadStatus }}</p>
          <div class="progress-container">
            <div class="progress-bar" :style="{ width: uploadProgress + '%' }"></div>
          </div>
        </div>
      </div>
    </div>
    
    <!-- 错误信息 -->
    <div v-if="error" class="form-error general-error">
      {{ error }}
      <button @click="error = ''" class="error-dismiss">×</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import axios from 'axios'

// Props & Emits
const emit = defineEmits<{
  uploadComplete: [result: any]
  log: [message: string]
}>()

// State
const fileInput = ref<HTMLInputElement>()
const selectedFile = ref<File | null>(null)
const isUploading = ref(false)
const uploadStatus = ref('')
const uploadProgress = ref(0)
const error = ref('')

// Methods
function handleFileSelect(event: Event) {
  const target = event.target as HTMLInputElement
  if (target.files && target.files[0]) {
    selectedFile.value = target.files[0]
    error.value = ''
    
    // 检查文件大小（50MB限制）
    if (selectedFile.value.size > 50 * 1024 * 1024) {
      error.value = 'File size exceeds 50MB limit'
      selectedFile.value = null
    }
  }
}

function addLog(message: string) {
  const timestamp = new Date().toLocaleTimeString()
  emit('log', `[${timestamp}] ${message}`)
}

async function uploadAndAnalyze() {
  if (!selectedFile.value) return
  
  isUploading.value = true
  uploadStatus.value = 'Uploading video...'
  uploadProgress.value = 0
  error.value = ''
  
  addLog(`开始上传视频: ${selectedFile.value.name}`)
  addLog(`文件大小: ${formatFileSize(selectedFile.value.size)}`)
  
  const formData = new FormData()
  formData.append('video', selectedFile.value)
  formData.append('title', `Test Video - ${new Date().toISOString()}`)
  formData.append('description', 'Direct test upload for Gemini analysis')
  
  try {
    // 上传视频
    const response = await axios.post('/api/videos/upload', formData, {
      headers: {
        'Content-Type': 'multipart/form-data'
      },
      onUploadProgress: (progressEvent) => {
        if (progressEvent.total) {
          uploadProgress.value = Math.round((progressEvent.loaded * 100) / progressEvent.total)
          addLog(`上传进度: ${uploadProgress.value}%`)
          if (uploadProgress.value === 100) {
            uploadStatus.value = 'Processing and analyzing with Gemini...'
            addLog('视频上传完成，开始Gemini分析...')
          }
        }
      }
    })
    
    // 显示分析结果
    addLog('收到服务器响应')
    if (response.data) {
      emit('uploadComplete', response.data.analysisResult || response.data)
      
      if (response.data.analysisResult) {
        addLog('成功获取Gemini分析结果')
      }
      
      // 2秒后清除上传状态
      setTimeout(() => {
        isUploading.value = false
        uploadStatus.value = ''
        uploadProgress.value = 0
        selectedFile.value = null
        if (fileInput.value) {
          fileInput.value.value = ''
        }
      }, 2000)
    }
  } catch (err: any) {
    console.error('Upload/Analysis error:', err)
    addLog(`错误: ${err.message}`)
    if (err.response?.data) {
      addLog(`服务器错误详情: ${JSON.stringify(err.response.data)}`)
    }
    error.value = err.response?.data?.message || err.message || 'Upload failed'
    isUploading.value = false
    uploadStatus.value = ''
    uploadProgress.value = 0
  }
}

function clearSelection() {
  selectedFile.value = null
  if (fileInput.value) {
    fileInput.value.value = ''
  }
  error.value = ''
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
}
</script>

<style scoped>
.upload-section {
  margin-bottom: 2rem;
}

.upload-box {
  padding: 3rem 2rem;
  text-align: center;
  min-height: 300px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  background: linear-gradient(135deg, #f6f8fb 0%, #ffffff 100%);
  border-radius: 12px;
  position: relative;
}

.upload-box.uploading {
  background: linear-gradient(135deg, #f0fff4 0%, #e6ffed 100%);
}

.upload-box input[type="file"] {
  display: none;
}

.upload-prompt {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1rem;
}

.upload-icon {
  font-size: 4rem;
  animation: float 3s ease-in-out infinite;
}

@keyframes float {
  0%, 100% { transform: translateY(0px); }
  50% { transform: translateY(-10px); }
}

.upload-prompt p {
  font-size: 1.25rem;
  color: #64748b;
  margin: 0;
  font-weight: 500;
}

.file-selected {
  display: flex;
  flex-direction: column;
  gap: 2rem;
  width: 100%;
  max-width: 400px;
}

.file-info {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 1rem;
  background: white;
  border-radius: 12px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
}

.file-icon {
  font-size: 2.5rem;
}

.file-name {
  font-weight: 600;
  color: #1e293b;
  margin: 0 0 0.25rem 0;
  word-break: break-all;
}

.file-size {
  color: #64748b;
  font-size: 0.875rem;
  margin: 0;
}

.action-buttons {
  display: flex;
  gap: 1rem;
  justify-content: center;
}

.uploading-status {
  width: 100%;
  max-width: 500px;
}

.upload-status-text {
  color: #059669;
  font-weight: 600;
  margin-bottom: 1.5rem;
  font-size: 1.125rem;
  animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.8; }
}

.general-error {
  background-color: #fee2e2;
  border: 1px solid #fecaca;
  border-radius: var(--radius-md);
  padding: 0.75rem 1rem;
  text-align: center;
  margin-top: 1rem;
  position: relative;
}

.error-dismiss {
  position: absolute;
  right: 0.5rem;
  top: 50%;
  transform: translateY(-50%);
  background: none;
  border: none;
  font-size: 1.5rem;
  color: var(--error-color);
  cursor: pointer;
  padding: 0.25rem;
  line-height: 1;
}

.progress-container {
  width: 100%;
  height: 2rem;
  background-color: var(--border-color);
  border-radius: var(--radius-md);
  overflow: hidden;
  position: relative;
}

.progress-bar {
  height: 100%;
  background: linear-gradient(90deg, var(--primary-color), var(--primary-dark));
  transition: width 0.3s ease;
  position: relative;
  overflow: hidden;
}

.progress-bar::after {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: linear-gradient(
    90deg,
    transparent,
    rgba(255, 255, 255, 0.3),
    transparent
  );
  animation: shimmer 2s infinite;
}

@keyframes shimmer {
  0% { transform: translateX(-100%); }
  100% { transform: translateX(100%); }
}
</style>