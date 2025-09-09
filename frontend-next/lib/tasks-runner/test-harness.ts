// Phase 2 Test Harness - Demonstrates concurrency pool functionality

import { ConcurrencyPool, UploadTask } from './uploader';
import { createUrlTasks, uploadFiles } from './api';
import type { CreateTasksResponse } from './types';

// Test configuration
const TEST_URLS = [
  'https://example.com/video1.mp4',
  'https://example.com/video2.mp4',
  'https://example.com/video3.mp4',
  'https://example.com/video4.mp4',
  'https://example.com/video5.mp4',
];

// Create test files
function createTestFile(name: string, sizeMB: number): File {
  const bytes = new Uint8Array(sizeMB * 1024 * 1024);
  return new File([bytes], name, { type: 'video/mp4' });
}

// Test scenarios
export class TestHarness {
  private pool: ConcurrencyPool;
  private taskStates: Map<string, any> = new Map();
  
  constructor() {
    this.pool = new ConcurrencyPool(2); // Start with concurrency 2
  }
  
  // Test 1: Basic URL task processing
  async testUrlTasks() {
    console.log('=== Test 1: URL Tasks with Concurrency 2 ===');
    
    for (let i = 0; i < TEST_URLS.length; i++) {
      const taskId = `url-task-${i}`;
      const task: UploadTask = {
        id: taskId,
        url: TEST_URLS[i],
        retryCount: 0,
        status: 'queued',
        onProgress: (progress) => {
          console.log(`Task ${taskId}: Progress ${progress}%`);
        },
        onComplete: (response) => {
          console.log(`Task ${taskId}: Completed`, response);
          this.taskStates.set(taskId, { status: 'completed', response });
        },
        onError: (error) => {
          console.error(`Task ${taskId}: Failed`, error);
          this.taskStates.set(taskId, { status: 'failed', error });
        }
      };
      
      await this.pool.addTask(task);
      console.log(`Task ${taskId}: Added to queue`);
    }
  }
  
  // Test 2: File upload with progress tracking
  async testFileUpload() {
    console.log('=== Test 2: File Upload with Progress ===');
    
    const smallFile = createTestFile('small.mp4', 10); // 10MB
    const largeFile = createTestFile('large.mp4', 100); // 100MB (>80MB threshold)
    
    const files = [smallFile, largeFile];
    
    for (let i = 0; i < files.length; i++) {
      const taskId = `file-task-${i}`;
      const task: UploadTask = {
        id: taskId,
        file: files[i],
        retryCount: 0,
        status: 'queued',
        onProgress: (progress) => {
          console.log(`Task ${taskId}: Upload progress ${progress}%`);
          this.taskStates.set(taskId, { status: 'uploading', progress });
        },
        onComplete: (response) => {
          console.log(`Task ${taskId}: Upload completed`, response);
          this.taskStates.set(taskId, { status: 'completed', response });
        },
        onError: (error) => {
          console.error(`Task ${taskId}: Upload failed`, error);
          this.taskStates.set(taskId, { status: 'failed', error });
        }
      };
      
      await this.pool.addTask(task);
      console.log(`Task ${taskId}: Added to queue (${files[i].name}, ${files[i].size / 1024 / 1024}MB)`);
    }
  }
  
  // Test 3: Concurrency change
  async testConcurrencyChange() {
    console.log('=== Test 3: Concurrency Change ===');
    
    // Add 10 tasks
    for (let i = 0; i < 10; i++) {
      const taskId = `concurrency-test-${i}`;
      const task: UploadTask = {
        id: taskId,
        url: `https://example.com/test${i}.mp4`,
        retryCount: 0,
        status: 'queued',
        onComplete: (response) => {
          console.log(`Task ${taskId}: Completed`);
        },
        onError: (error) => {
          console.error(`Task ${taskId}: Failed`, error);
        }
      };
      
      await this.pool.addTask(task);
    }
    
    console.log('Initial concurrency: 2');
    
    // Change concurrency after 2 seconds
    setTimeout(() => {
      console.log('Changing concurrency to 5');
      this.pool.setCapacity(5);
    }, 2000);
    
    // Change concurrency after 4 seconds
    setTimeout(() => {
      console.log('Changing concurrency to 10');
      this.pool.setCapacity(10);
    }, 4000);
  }
  
  // Test 4: Cancel single task
  async testCancelSingle() {
    console.log('=== Test 4: Cancel Single Task ===');
    
    const taskId = 'cancel-single-test';
    const task: UploadTask = {
      id: taskId,
      url: 'https://example.com/cancel-test.mp4',
      retryCount: 0,
      status: 'queued',
      onComplete: (response) => {
        console.log(`Task ${taskId}: Should not complete`);
      },
      onError: (error) => {
        console.log(`Task ${taskId}: Cancelled - ${error.message}`);
      }
    };
    
    await this.pool.addTask(task);
    console.log(`Task ${taskId}: Added to queue`);
    
    // Cancel after 100ms
    setTimeout(() => {
      console.log(`Cancelling task ${taskId}`);
      this.pool.cancelTask(taskId);
    }, 100);
  }
  
  // Test 5: Cancel all tasks
  async testCancelAll() {
    console.log('=== Test 5: Cancel All Tasks ===');
    
    // Add 5 tasks
    for (let i = 0; i < 5; i++) {
      const taskId = `cancel-all-${i}`;
      const task: UploadTask = {
        id: taskId,
        url: `https://example.com/cancel-all-${i}.mp4`,
        retryCount: 0,
        status: 'queued',
        onComplete: (response) => {
          console.log(`Task ${taskId}: Should not complete`);
        },
        onError: (error) => {
          console.log(`Task ${taskId}: Cancelled - ${error.message}`);
        }
      };
      
      await this.pool.addTask(task);
      console.log(`Task ${taskId}: Added to queue`);
    }
    
    // Cancel all after 200ms
    setTimeout(() => {
      console.log('Cancelling all tasks');
      this.pool.cancelAll();
    }, 200);
  }
  
  // Test 6: Retry logic simulation
  async testRetryLogic() {
    console.log('=== Test 6: Retry Logic (Simulated) ===');
    
    // This would need a mock server that returns 429/500 errors
    // For now, we demonstrate the retry structure
    
    const taskId = 'retry-test';
    let attemptCount = 0;
    
    const task: UploadTask = {
      id: taskId,
      url: 'https://httpstat.us/500', // This URL returns 500 error
      retryCount: 0,
      status: 'queued',
      onComplete: (response) => {
        console.log(`Task ${taskId}: Completed after ${attemptCount} attempts`);
      },
      onError: (error) => {
        attemptCount++;
        console.log(`Task ${taskId}: Attempt ${attemptCount} failed - ${error.message}`);
        if (attemptCount < 3) {
          console.log(`Task ${taskId}: Will retry (${2 ** attemptCount}s delay with jitter)`);
        } else {
          console.log(`Task ${taskId}: Max retries reached, giving up`);
        }
      }
    };
    
    await this.pool.addTask(task);
    console.log(`Task ${taskId}: Added to queue (will retry 3 times)`);
  }
  
  // Run all tests
  async runAll() {
    console.log('========================================');
    console.log('Phase 2 Test Harness - Concurrency Pool');
    console.log('========================================\n');
    
    // Run tests sequentially with delays
    await this.testUrlTasks();
    await this.delay(3000);
    
    await this.testFileUpload();
    await this.delay(3000);
    
    await this.testConcurrencyChange();
    await this.delay(6000);
    
    await this.testCancelSingle();
    await this.delay(1000);
    
    await this.testCancelAll();
    await this.delay(1000);
    
    await this.testRetryLogic();
    await this.delay(10000);
    
    console.log('\n========================================');
    console.log('Test Harness Complete');
    console.log('Final task states:', this.taskStates);
    console.log('========================================');
  }
  
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Export for use in components
export function runTestHarness() {
  const harness = new TestHarness();
  harness.runAll().catch(console.error);
}