const fs = require('fs');
const FormData = require('form-data');
const axios = require('axios');

// 使用刚才上传的视频文件路径
const videoPath = '/Users/borgrise/Downloads/Download.mp4';

async function testAPI() {
  try {
    const form = new FormData();
    form.append('video', fs.createReadStream(videoPath));
    
    console.log('正在调用API...');
    
    const response = await axios.post('http://localhost:5001/api/videos/upload', form, {
      headers: {
        ...form.getHeaders()
      },
      maxContentLength: Infinity,
      maxBodyLength: Infinity
    });
    
    console.log('\n=== 完整响应结构 ===');
    console.log(JSON.stringify(response.data, null, 2));
    
    if (response.data.analysisResult && response.data.analysisResult.full_analysis) {
      console.log('\n=== full_analysis 内容 ===');
      console.log(response.data.analysisResult.full_analysis);
      
      // 尝试解析full_analysis
      try {
        const cleanJson = response.data.analysisResult.full_analysis
          .replace(/^```json\s*/, '')
          .replace(/\s*```$/, '')
          .trim();
        const analysisJson = JSON.parse(cleanJson);
        
        console.log('\n=== 解析后的分析JSON ===');
        console.log(JSON.stringify(analysisJson, null, 2));
        
        // 显示具体字段
        console.log('\n=== 具体字段内容 ===');
        console.log('Overview:', analysisJson.overview);
        console.log('Pillars:', analysisJson.pillars);
        console.log('Timeline count:', analysisJson.timeline?.length || 0);
        console.log('Recommendations count:', analysisJson.recommendations?.length || 0);
        console.log('Flags count:', analysisJson.flags?.length || 0);
      } catch (e) {
        console.log('\n=== full_analysis 不是有效的JSON ===');
        console.log('解析错误:', e.message);
      }
    }
    
  } catch (error) {
    console.error('API调用失败:', error.message);
    if (error.response) {
      console.error('响应数据:', error.response.data);
    }
  }
}

testAPI();