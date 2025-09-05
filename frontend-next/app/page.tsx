'use client';

import React, { useState, useEffect } from 'react';
import { VideoUploader } from '@/components/video/VideoUploader';
import { AnalysisProgress } from '@/components/video/AnalysisProgress';
import { ResultsDisplay } from '@/components/video/ResultsDisplay';
import { useVideoAnalyzer } from '@/lib/store';
import { VideoAnalyzerAPI } from '@/lib/api';
import { AlertCircle } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Card } from '@/components/ui/card';
import Image from 'next/image';

export default function HomePage() {
  const {
    stage,
    file,
    progress,
    results,
    error,
    setStage,
    setFile,
    setProgress,
    setResults,
    setError,
    reset,
  } = useVideoAnalyzer();

  const [currentAnalysisStep, setCurrentAnalysisStep] = useState<
    'uploading' | 'analyzing' | 'generating'
  >('uploading');

  const handleFileSelect = async (selectedFile: File) => {
    setFile(selectedFile);
    setStage('uploading');
    setProgress(0);

    try {
      setCurrentAnalysisStep('uploading');
      
      const rawResults = await VideoAnalyzerAPI.analyzeVideo(selectedFile, (uploadProgress) => {
        if (uploadProgress < 100) {
          setProgress(uploadProgress);
        } else {
          setCurrentAnalysisStep('analyzing');
          setStage('analyzing');
          simulateAnalysisProgress();
        }
      });

      setCurrentAnalysisStep('generating');
      setTimeout(() => {
        const formattedResults = VideoAnalyzerAPI.formatAnalysisResults(rawResults);
        setResults(formattedResults);
        setStage('complete');
      }, 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to analyze video');
      setStage('error');
    }
  };

  const simulateAnalysisProgress = () => {
    let progress = 0;
    const interval = setInterval(() => {
      progress += Math.random() * 15;
      if (progress >= 100) {
        setProgress(100);
        clearInterval(interval);
      } else {
        setProgress(Math.min(progress, 95));
      }
    }, 1000);
  };

  const handleRemoveFile = () => {
    reset();
  };

  const handleAnalyzeAgain = () => {
    reset();
  };

  return (
    <div className="min-h-screen bg-white">
      <div className="container mx-auto px-4 py-12 max-w-2xl">
        <div className="text-center mb-8">
          <div className="flex justify-center mb-4">
            <Image
              src="/logo4.png"
              alt="Video Analyzer"
              width={60}
              height={60}
              className="rounded-lg"
              priority
            />
          </div>
          
          <h1 className="text-2xl font-normal text-gray-900">
            video analyzer
          </h1>
        </div>

        {stage === 'idle' && (
          <div className="w-full">
            <Card className="relative overflow-hidden backdrop-blur-xl bg-gradient-to-br from-white/80 to-white/60 dark:from-gray-900/80 dark:to-gray-900/60 border border-white/20 shadow-2xl">
              <div className="p-6">
                <VideoUploader
                  onFileSelect={handleFileSelect}
                  onRemove={handleRemoveFile}
                  isUploading={false}
                />
              </div>
            </Card>
          </div>
        )}

        {(stage === 'uploading' || stage === 'analyzing') && (
          <div className="w-full">
            <AnalysisProgress currentStep={currentAnalysisStep} progress={progress} />
          </div>
        )}

        {stage === 'complete' && results && (
          <div className="w-full">
            <ResultsDisplay results={results} onAnalyzeAgain={handleAnalyzeAgain} />
          </div>
        )}

        {stage === 'error' && (
          <div className="w-full">
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Analysis Failed</AlertTitle>
              <AlertDescription className="mt-2">
                <p className="mb-4">{error}</p>
                <button
                  onClick={handleAnalyzeAgain}
                  className="px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
                >
                  Try Again
                </button>
              </AlertDescription>
            </Alert>
          </div>
        )}
      </div>
    </div>
  );
}