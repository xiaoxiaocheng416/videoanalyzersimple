'use client';

import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import { Brain, CheckCircle, FileText, Loader2, Upload } from 'lucide-react';
import type React from 'react';

interface AnalysisStep {
  id: string;
  label: string;
  description: string;
  icon: React.ReactNode;
  status: 'pending' | 'active' | 'completed';
}

interface AnalysisProgressProps {
  currentStep: 'uploading' | 'analyzing' | 'generating';
  progress: number;
}

export function AnalysisProgress({ currentStep, progress }: AnalysisProgressProps) {
  const steps: AnalysisStep[] = [
    {
      id: 'uploading',
      label: 'Uploading Video',
      description: 'Securely transferring your video file',
      icon: <Upload className="h-5 w-5" />,
      status:
        currentStep === 'uploading'
          ? 'active'
          : currentStep === 'analyzing' || currentStep === 'generating'
            ? 'completed'
            : 'pending',
    },
    {
      id: 'analyzing',
      label: 'AI Analysis',
      description: 'Processing video content with AI',
      icon: <Brain className="h-5 w-5" />,
      status:
        currentStep === 'analyzing'
          ? 'active'
          : currentStep === 'generating'
            ? 'completed'
            : 'pending',
    },
    {
      id: 'generating',
      label: 'Generating Report',
      description: 'Creating detailed analysis report',
      icon: <FileText className="h-5 w-5" />,
      status: currentStep === 'generating' ? 'active' : 'pending',
    },
  ];

  const getStepProgress = () => {
    switch (currentStep) {
      case 'uploading':
        return Math.min(progress, 33);
      case 'analyzing':
        return Math.min(33 + progress * 0.34, 67);
      case 'generating':
        return Math.min(67 + progress * 0.33, 100);
      default:
        return 0;
    }
  };

  return (
    <Card className="w-full">
      <CardContent className="p-8">
        <div className="space-y-8">
          <div className="text-center">
            <h2 className="text-2xl font-semibold mb-2">Analyzing Your Video</h2>
            <p className="text-muted-foreground">Please wait while we process your content</p>
          </div>

          <div className="space-y-2">
            <div className="flex justify-between text-sm mb-1">
              <span className="text-muted-foreground">Overall Progress</span>
              <span className="font-medium">{Math.round(getStepProgress())}%</span>
            </div>
            <Progress value={getStepProgress()} className="h-2" />
          </div>

          <div className="space-y-4">
            {steps.map((step, index) => (
              <div
                key={step.id}
                className={cn(
                  'flex items-start gap-4 p-4 rounded-lg transition-all duration-300',
                  step.status === 'active' && 'bg-primary/5 border border-primary/20',
                  step.status === 'completed' && 'opacity-70',
                  step.status === 'pending' && 'opacity-40',
                )}
              >
                <div
                  className={cn(
                    'flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center transition-all duration-300',
                    step.status === 'active' && 'bg-primary text-primary-foreground animate-pulse',
                    step.status === 'completed' && 'bg-primary/20 text-primary',
                    step.status === 'pending' && 'bg-muted text-muted-foreground',
                  )}
                >
                  {step.status === 'active' ? (
                    <Loader2 className="h-5 w-5 animate-spin" />
                  ) : step.status === 'completed' ? (
                    <CheckCircle className="h-5 w-5" />
                  ) : (
                    step.icon
                  )}
                </div>

                <div className="flex-1">
                  <h3
                    className={cn(
                      'font-semibold mb-1',
                      step.status === 'pending' && 'text-muted-foreground',
                    )}
                  >
                    {step.label}
                  </h3>
                  <p
                    className={cn(
                      'text-sm',
                      step.status === 'pending'
                        ? 'text-muted-foreground/70'
                        : 'text-muted-foreground',
                    )}
                  >
                    {step.description}
                  </p>
                  {step.status === 'active' && (
                    <div className="mt-2">
                      <Progress value={progress} className="h-1" />
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div className="text-center">
            <p className="text-sm text-muted-foreground">
              {currentStep === 'uploading' && 'Uploading your video securely...'}
              {currentStep === 'analyzing' && 'AI is analyzing your video content...'}
              {currentStep === 'generating' && 'Almost done! Generating your report...'}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
