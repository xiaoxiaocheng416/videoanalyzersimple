'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { CheckCircle, Upload, Video, X } from 'lucide-react';
import React, { useCallback, useState } from 'react';
import { useDropzone } from 'react-dropzone';

interface VideoUploaderProps {
  onFileSelect: (file: File) => void;
  onRemove: () => void;
  isUploading?: boolean;
}

export function VideoUploader({ onFileSelect, onRemove, isUploading }: VideoUploaderProps) {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  const onDrop = useCallback(
    (acceptedFiles: File[]) => {
      if (acceptedFiles.length > 0) {
        const file = acceptedFiles[0];
        setSelectedFile(file);
        setPreview(URL.createObjectURL(file));
        onFileSelect(file);
      }
    },
    [onFileSelect],
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'video/*': ['.mp4'],
    },
    maxFiles: 1,
    disabled: isUploading,
  });

  const handleRemove = () => {
    if (preview) {
      URL.revokeObjectURL(preview);
    }
    setSelectedFile(null);
    setPreview(null);
    onRemove();
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
  };

  if (selectedFile && preview) {
    return (
      <Card className="relative overflow-hidden">
        <div className="p-8">
          <div className="flex items-start gap-6">
            <div className="relative flex-shrink-0">
              {isUploading ? (
                <Skeleton className="w-32 h-20 rounded-lg" />
              ) : (
                <>
                  <video src={preview} className="w-32 h-20 object-cover rounded-lg" muted />
                  <div className="absolute inset-0 bg-black/20 rounded-lg flex items-center justify-center">
                    <Video className="w-8 h-8 text-white" />
                  </div>
                </>
              )}
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-2">
                <h3 className="font-semibold text-lg truncate">{selectedFile.name}</h3>
                {!isUploading && (
                  <Badge variant="secondary" className="flex items-center gap-1">
                    <CheckCircle className="h-3 w-3" />
                    Ready
                  </Badge>
                )}
              </div>

              <div className="flex flex-wrap gap-2">
                <Badge variant="outline">{formatFileSize(selectedFile.size)}</Badge>
                <Badge variant="outline">
                  {selectedFile.type?.split('/')[1]?.toUpperCase() || 'VIDEO'}
                </Badge>
                {selectedFile.size > 100 * 1024 * 1024 && (
                  <Badge variant="destructive">Large File</Badge>
                )}
              </div>

              {isUploading && (
                <div className="mt-3 space-y-2">
                  <Skeleton className="h-2 w-full" />
                  <p className="text-xs text-muted-foreground">Preparing for analysis...</p>
                </div>
              )}
            </div>

            {!isUploading && (
              <Button size="icon" variant="ghost" onClick={handleRemove} className="flex-shrink-0">
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      </Card>
    );
  }

  return (
    <div
      {...getRootProps()}
      className={cn(
        'relative overflow-hidden rounded-xl border-2 border-dashed transition-all duration-200',
        isDragActive
          ? 'border-primary bg-primary/5 scale-[1.02]'
          : 'border-muted-foreground/25 hover:border-muted-foreground/50',
        isUploading && 'pointer-events-none opacity-50',
      )}
    >
      <input {...getInputProps()} />

      <div className="flex flex-col items-center justify-center p-12 text-center">
        <div
          className={cn(
            'rounded-full p-4 mb-4 transition-all duration-200',
            isDragActive ? 'bg-primary/20 scale-110' : 'bg-muted',
          )}
        >
          <Upload
            className={cn(
              'h-8 w-8 transition-colors',
              isDragActive ? 'text-primary' : 'text-muted-foreground',
            )}
          />
        </div>

        <h3 className="text-lg font-semibold mb-2">
          {isDragActive ? 'Drop your video here' : 'Upload your TikTok Shop video'}
        </h3>

        <p className="text-sm text-muted-foreground mb-4">Drag and drop or click to select</p>

        <div className="flex flex-wrap gap-2 justify-center">
          <Badge variant="secondary">MP4</Badge>
        </div>

        <p className="text-xs text-muted-foreground mt-4">Max size: 50MB</p>
      </div>
    </div>
  );
}
