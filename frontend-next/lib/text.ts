export function splitIntoParagraphs(text: string, maxSentencesPerPara = 3): string[] {
  if (!text || typeof text !== 'string') return [];
  // Normalize whitespace
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) return [];

  // Split into sentences based on punctuation followed by a space and capital letter
  const sentences = normalized.split(/(?<=[.!?])\s+(?=[A-Z])/);
  const paras: string[] = [];
  for (let i = 0; i < sentences.length; i += maxSentencesPerPara) {
    const chunk = sentences
      .slice(i, i + maxSentencesPerPara)
      .join(' ')
      .trim();
    if (chunk) paras.push(chunk);
  }
  return paras;
}
