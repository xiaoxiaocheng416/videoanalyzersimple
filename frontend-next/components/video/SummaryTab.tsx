'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useCallback, useMemo } from 'react';
import { Toaster, toast } from 'sonner';
import { splitIntoParagraphs } from '@/lib/text';

export default function SummaryTab({ summary }: { summary?: string }) {
  const paragraphs = useMemo(() => splitIntoParagraphs(summary ?? '', 3), [summary]);
  const textBlock = useMemo(() => (paragraphs.length ? paragraphs.join('\n\n') : ''), [paragraphs]);

  const handleCopy = useCallback(async () => {
    try {
      if (!textBlock) return;
      await navigator.clipboard.writeText(textBlock);
      toast.success('Summary copied to clipboard', { duration: 1500 });
    } catch {
      toast.error('Copy failed — clipboard permission denied?', { duration: 1500 });
    }
  }, [textBlock]);

  if (!paragraphs.length) {
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
        <div className="space-y-3 leading-7 text-slate-700">
          {paragraphs.map((p, i) => (
            <p key={i}>{p}</p>
          ))}
        </div>
      </CardContent>
      {/* Local toaster to ensure feedback is visible without global setup */}
      <Toaster richColors position="top-right" />
    </Card>
  );
}
