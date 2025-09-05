'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useCallback, useMemo } from 'react';
import { Toaster, toast } from 'sonner';

export default function SummaryTab({ summary }: { summary?: string }) {
  const sentences = useMemo(() => {
    if (!summary || typeof summary !== 'string') return [] as string[];
    return summary
      .split(/[.!?。！？]\s*/g)
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 12);
  }, [summary]);

  const textBlock = useMemo(
    () => (sentences.length ? sentences.join('. ') + '.' : ''),
    [sentences]
  );

  const handleCopy = useCallback(async () => {
    try {
      if (!textBlock) return;
      await navigator.clipboard.writeText(textBlock);
      toast.success('Summary copied to clipboard', { duration: 1500 });
    } catch {
      toast.error('Copy failed — clipboard permission denied?', { duration: 1500 });
    }
  }, [textBlock]);

  if (!sentences.length) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Improvement Summary</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          No summary available for this run.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card data-improvement-summary>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Improvement Summary</CardTitle>
        <Button variant="secondary" size="sm" onClick={handleCopy}>
          Copy
        </Button>
      </CardHeader>
      <CardContent>
        <ul className="list-disc pl-5 space-y-1">
          {sentences.map((s, i) => (
            <li key={i} className="text-sm leading-relaxed">
              {s}
            </li>
          ))}
        </ul>
      </CardContent>
      {/* Local toaster to ensure feedback is visible without global setup */}
      <Toaster richColors position="top-right" />
    </Card>
  );
}
