'use client';

import { useEffect, useRef, useState } from 'react';
import { clearSummaryDraft, draftKey } from '../../utils/summaryDraft';

type Props = {
  analysisId: string;
  aiText: string;
  userText?: string;
  onSave?: (text: string, source: 'user' | 'ai') => Promise<void>;
};

export default function EditableSummary({ analysisId, aiText, userText, onSave }: Props) {
  // Helper: Resolve initial source with validation
  const resolveInitialSource = (
    storedSource: 'ai' | 'user' | undefined,
    userText?: string,
  ): 'ai' | 'user' => {
    // Only use 'user' if we have actual user text
    return storedSource === 'user' && userText ? 'user' : 'ai';
  };

  // Check localStorage on mount
  const storageKey = `summaryData:${analysisId}`;
  const storedData = typeof window !== 'undefined' ? localStorage.getItem(storageKey) : null;
  const parsedStoredData = storedData ? JSON.parse(storedData) : null;
  console.log('[Mount] localStorage summaryData:', parsedStoredData);

  // FIX: Validate source against actual userText availability
  const initialSource = resolveInitialSource(parsedStoredData?.source, userText);
  console.log(
    '[Mount] initialSource calculation: stored=',
    parsedStoredData?.source,
    'userText=',
    userText,
    '=> resolved to',
    initialSource,
  );

  const [mode, setMode] = useState<'view' | 'edit'>('view');
  const [source, setSource] = useState<'ai' | 'user'>(initialSource);

  // Local state for edited text (instead of modifying props)
  const [localUserText, setLocalUserText] = useState<string | undefined>(userText);

  // FIX: Guarded displayText - only use userText if it exists (prioritize local state over prop)
  const effectiveUserText = localUserText ?? userText;
  const displayText = source === 'user' && effectiveUserText ? effectiveUserText : aiText;

  // Debug: Initial state
  console.log('[EditableSummary Init] analysisId=', analysisId);
  console.log(
    '[EditableSummary Init] source=',
    source,
    'userText=',
    userText,
    'aiText.len=',
    aiText?.length,
  );
  console.log(
    '[DisplayText] source=',
    source,
    '=> using',
    source === 'user' ? 'userText' : 'aiText',
    'displayText.len=',
    displayText?.length,
  );

  const [draft, setDraft] = useState(displayText);
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);
  const textRef = useRef<HTMLTextAreaElement>(null);

  // 进入编辑态时初始化草稿 & 聚焦
  useEffect(() => {
    if (mode === 'edit') {
      const k = draftKey(analysisId);
      const local = typeof window !== 'undefined' ? localStorage.getItem(k) : null;
      // FIX: Use guarded displayText for initial draft value with effectiveUserText
      const effectiveUser = localUserText ?? userText;
      const initialDraft = local ?? (source === 'user' && effectiveUser ? effectiveUser : aiText);
      console.log('[Draft init] mode=', mode, 'analysisId=', analysisId);
      console.log(
        '[Draft init] local draft=',
        local?.length ? `${local.length} chars` : 'null/empty',
      );
      console.log(
        '[Draft init] initialDraft.len=',
        initialDraft?.length,
        'will use:',
        local ? 'localStorage' : 'guarded displayText',
      );
      setDraft(initialDraft);
      requestAnimationFrame(() => textRef.current?.focus());
    }
  }, [mode, analysisId, source, userText, aiText, localUserText]);

  // 草稿本地持久化
  useEffect(() => {
    if (mode === 'edit') {
      const k = draftKey(analysisId);
      try {
        localStorage.setItem(k, draft ?? '');
      } catch {}
    }
  }, [mode, draft, analysisId]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(mode === 'edit' ? draft : displayText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  };

  const save = async (text: string, src: 'user' | 'ai') => {
    setSaving(true);
    try {
      // Use localStorage to simulate save (temporary solution while backend is not ready)
      if (onSave) {
        await onSave(text, src);
      } else {
        // Local storage simulation
        const storageKey = `summaryData:${analysisId}`;
        localStorage.setItem(
          storageKey,
          JSON.stringify({ userText: src === 'user' ? text : null, source: src }),
        );
      }

      setMode('view');
      setSource(src);
      if (src === 'user') {
        // FIX: Update local state instead of modifying props
        setLocalUserText(text);
        console.log('[Save] Updated localUserText with', text?.length, 'chars');
      } else {
        // Reset to AI means clearing user text
        setLocalUserText(undefined);
      }
      console.log('[Save] Saved with source=', src, 'text.len=', text?.length);
      clearSummaryDraft(analysisId);
    } catch (e) {
      console.error('Save failed:', e);
    } finally {
      setSaving(false);
    }
  };

  const onSaveClick = () => save(draft, 'user');

  const onCancel = () => {
    // 还原为进入编辑前的展示文本
    setDraft(displayText);
    setMode('view');
  };

  const onRevertToAI = () => {
    // 回到 AI 文本并保存为来源=AI
    save(aiText, 'ai');
  };

  // 快捷键：Cmd/Ctrl+S 保存；Esc 取消
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (mode !== 'edit') return;
      const isSave = (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's';
      if (isSave) {
        e.preventDefault();
        onSaveClick();
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [mode, draft]); // eslint-disable-line

  // 自动计算textarea高度
  const rows = Math.min(12, Math.max(6, draft.split('\n').length + 1));

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4 sm:p-6">
      {/* 标题 + 按钮 */}
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-2">
          <h3 className="text-[15px] sm:text-base font-semibold">Improvement Summary</h3>
          <span
            className={`text-xs rounded px-1.5 py-0.5 ${
              source === 'user' && effectiveUserText
                ? 'bg-indigo-50 text-indigo-600'
                : 'bg-gray-100 text-gray-600'
            }`}
          >
            {(console.log('[Badge] source=', source, 'effectiveUserText=', !!effectiveUserText),
            source === 'user' && effectiveUserText)
              ? 'Edited'
              : 'AI'}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {mode === 'view' ? (
            <>
              <button
                onClick={() => {
                  console.log('[Edit click] source=', source);
                  console.log(
                    '[Edit click] aiText.len=',
                    aiText?.length,
                    'userText.len=',
                    userText?.length,
                  );
                  console.log('[Edit click] displayText.len=', displayText?.length);
                  console.log('[Edit click] analysisId=', analysisId);
                  setMode('edit');
                }}
                className="px-3 py-1.5 text-sm rounded-md bg-gray-100 hover:bg-gray-200 transition-colors"
              >
                Edit
              </button>
              <button
                onClick={handleCopy}
                className="px-3 py-1.5 text-sm rounded-md bg-gray-100 hover:bg-gray-200 transition-colors"
              >
                {copied ? '✓ Copied' : 'Copy'}
              </button>
              <button
                onClick={onRevertToAI}
                disabled={!(source === 'user' && effectiveUserText)}
                className="px-3 py-1.5 text-sm rounded-md bg-gray-100 hover:bg-gray-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                title={
                  !(source === 'user' && effectiveUserText) ? 'Already AI version' : 'Revert to AI'
                }
              >
                Revert to AI
              </button>
            </>
          ) : (
            <>
              <button
                onClick={onSaveClick}
                disabled={saving}
                className="px-3 py-1.5 text-sm rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
              <button
                onClick={onCancel}
                className="px-3 py-1.5 text-sm rounded-md bg-gray-100 hover:bg-gray-200 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleCopy}
                className="px-3 py-1.5 text-sm rounded-md bg-gray-100 hover:bg-gray-200 transition-colors"
              >
                {copied ? '✓ Copied' : 'Copy'}
              </button>
            </>
          )}
        </div>
      </div>

      {/* 内容/编辑区 */}
      {mode === 'view' ? (
        <div className="text-gray-800 leading-relaxed whitespace-pre-wrap">{displayText}</div>
      ) : (
        <div className="relative">
          <textarea
            ref={textRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={rows}
            className="w-full rounded-lg border border-gray-300 p-3 outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            placeholder="Write your improvements here…"
          />
          <div className="absolute right-2 bottom-2 text-xs text-gray-400">
            {draft.length} chars
          </div>
        </div>
      )}
    </div>
  );
}
