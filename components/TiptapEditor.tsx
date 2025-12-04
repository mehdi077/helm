'use client';

import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { TextStyle } from '@tiptap/extension-text-style';
import { Color } from '@tiptap/extension-color';
import { Highlight } from '@tiptap/extension-highlight';
import { useEffect, useState, useCallback, useRef } from 'react';
import { debounce } from 'lodash';
import { ChevronRight, ChevronLeft, Bold, Highlighter, Palette, Sparkles, Loader2, DollarSign, RefreshCw, Check, X, ChevronsRight, RotateCcw, Split } from 'lucide-react';
import { AVAILABLE_MODELS, DEFAULT_MODEL, ModelId, ModelPricing, formatCost } from '@/lib/model-config';
import { CompletionMark } from '@/lib/completion-mark';

interface TiptapEditorProps {
  initialContent: any;
  onContentUpdate: (content: any) => void;
}

const DEFAULT_PROMPT = 'Provide a two sentence long completion to this text:';
const DEFAULT_REGEN_PROMPT_TEMPLATE = `This is the already generated text:
{{ATTEMPTS}}

Now generate a drastically  different path to the completion for the next attempt, very far deferent from the ones that are shown in the attempts above.
{{ORIGINAL_PROMPT}}`;

interface CompletionState {
  isActive: boolean;
  words: string[];
  selectedCount: number;
  range: { from: number; to: number } | null;
}

interface AttemptHistory {
  attempts: string[];  // Array of previous completion attempts
}

interface BalanceInfo {
  balance: number;
  totalCredits: number;
  totalUsage: number;
}

interface ModelPricingMap {
  [modelId: string]: ModelPricing;
}

const TiptapEditor = ({ initialContent, onContentUpdate }: TiptapEditorProps) => {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isLeftSidebarOpen, setIsLeftSidebarOpen] = useState(false);
  const [selectedModel, setSelectedModel] = useState<ModelId>(DEFAULT_MODEL);
  const [isAutoCompleting, setIsAutoCompleting] = useState(false);
  const [autoCompleteError, setAutoCompleteError] = useState<string | null>(null);
  const [customPrompt, setCustomPrompt] = useState(DEFAULT_PROMPT);
  const [regenPromptTemplate, setRegenPromptTemplate] = useState(DEFAULT_REGEN_PROMPT_TEMPLATE);
  const [attemptHistory, setAttemptHistory] = useState<AttemptHistory>({ attempts: [] });
  const [completion, setCompletion] = useState<CompletionState>({
    isActive: false,
    words: [],
    selectedCount: 0,
    range: null,
  });
  const completionTextRef = useRef<string>('');
  const abortControllerRef = useRef<AbortController | null>(null);
  // Force re-render on editor updates to reflect active states in toolbar
  const [, forceUpdate] = useState({});
  
  // Balance and pricing state
  const [balanceInfo, setBalanceInfo] = useState<BalanceInfo | null>(null);
  const [isLoadingBalance, setIsLoadingBalance] = useState(false);
  const [modelPricing, setModelPricing] = useState<ModelPricingMap>({});
  const [lastGenerationCost, setLastGenerationCost] = useState<number | null>(null);
  const [promptsLoaded, setPromptsLoaded] = useState(false);
  
  // Editor styling controls (desktop only - mobile uses hardcoded values)
  const [lineHeight, setLineHeight] = useState(1.6);
  const [horizontalPadding, setHorizontalPadding] = useState(2); // in rem
  const [isMobile, setIsMobile] = useState(false);
  
  // Keyboard visibility for mobile FAB positioning
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit,
      TextStyle,
      Color,
      Highlight.configure({
        multicolor: true,
      }),
      CompletionMark,
    ],
    content: initialContent || '<p>> </p>',
    onUpdate: ({ editor }) => {
      onContentUpdate(editor.getJSON());
    },
    onSelectionUpdate: () => {
       forceUpdate({});
    },
    onTransaction: () => {
       forceUpdate({});
    },
    editorProps: {
      attributes: {
        class: 'prose prose-invert max-w-none focus:outline-none min-h-screen text-white',
        style: `line-height: ${lineHeight}; padding: 2rem ${horizontalPadding}rem;`,
      },
    },
  });

  // Detect mobile viewport
  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768);
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // Get effective values (mobile uses hardcoded tight values)
  const effectiveLineHeight = isMobile ? 1.0 : lineHeight;
  const effectiveHorizontalPadding = isMobile ? 0.15 : horizontalPadding;

  // Update editor styles when controls change
  useEffect(() => {
    if (editor) {
      editor.setOptions({
        editorProps: {
          attributes: {
            class: 'prose prose-invert max-w-none focus:outline-none min-h-screen text-white',
            style: `line-height: ${effectiveLineHeight}; padding: 2rem ${effectiveHorizontalPadding}rem;`,
          },
        },
      });
    }
  }, [editor, effectiveLineHeight, effectiveHorizontalPadding]);

  // Fetch balance from OpenRouter
  const fetchBalance = useCallback(async () => {
    setIsLoadingBalance(true);
    try {
      const response = await fetch('/api/balance');
      if (response.ok) {
        const data = await response.json();
        setBalanceInfo(data);
      }
    } catch (error) {
      console.error('Failed to fetch balance:', error);
    } finally {
      setIsLoadingBalance(false);
    }
  }, []);

  // Fetch model pricing from OpenRouter
  const fetchModelPricing = useCallback(async () => {
    try {
      const response = await fetch('/api/models');
      if (response.ok) {
        const data = await response.json();
        const pricingMap: ModelPricingMap = {};
        for (const model of data.models || []) {
          pricingMap[model.id] = model.pricing;
        }
        setModelPricing(pricingMap);
      }
    } catch (error) {
      console.error('Failed to fetch model pricing:', error);
    }
  }, []);

  // Fetch prompts from database
  const fetchPrompts = useCallback(async () => {
    try {
      const response = await fetch('/api/prompts');
      if (response.ok) {
        const data = await response.json();
        setCustomPrompt(data.customPrompt);
        setRegenPromptTemplate(data.regenPromptTemplate);
      }
    } catch (error) {
      console.error('Failed to fetch prompts:', error);
    } finally {
      setPromptsLoaded(true);
    }
  }, []);

  // Debounced save prompts function
  const savePrompts = useCallback(
    debounce(async (prompt: string, regenTemplate: string) => {
      try {
        await fetch('/api/prompts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ customPrompt: prompt, regenPromptTemplate: regenTemplate }),
        });
      } catch (error) {
        console.error('Failed to save prompts:', error);
      }
    }, 1000),
    []
  );

  // Fetch balance, pricing, and prompts on mount
  useEffect(() => {
    fetchBalance();
    fetchModelPricing();
    fetchPrompts();
  }, [fetchBalance, fetchModelPricing, fetchPrompts]);

  // Save prompts when they change (after initial load)
  useEffect(() => {
    if (promptsLoaded) {
      savePrompts(customPrompt, regenPromptTemplate);
    }
  }, [customPrompt, regenPromptTemplate, promptsLoaded, savePrompts]);

  // Build regeneration prompt from template
  const buildRegenPrompt = useCallback((attempts: string[]) => {
    const attemptsText = attempts
      .map((attempt, idx) => `Attempt ${idx + 1}: ${attempt}`)
      .join('\n');
    
    return regenPromptTemplate
      .replace('{{ATTEMPTS}}', attemptsText)
      .replace('{{ORIGINAL_PROMPT}}', customPrompt);
  }, [regenPromptTemplate, customPrompt]);

  const getTextForCompletion = useCallback(() => {
    if (!editor) return '';
    
    const fullText = editor.getText();
    const cursorPos = editor.state.selection.anchor;
    const textUpToCursor = fullText.slice(0, cursorPos);
    
    // Find the last period or newline
    const lastPeriod = textUpToCursor.lastIndexOf('.');
    const lastNewline = textUpToCursor.lastIndexOf('\n');
    const lastBreak = Math.max(lastPeriod, lastNewline);
    
    // Get text from last break to cursor, or all text if no break found
    const textForCompletion = lastBreak >= 0 
      ? textUpToCursor.slice(lastBreak + 1).trim()
      : textUpToCursor.trim();
    
    return textForCompletion;
  }, [editor]);

  // Loader position state
  const [loaderPosition, setLoaderPosition] = useState<{ top: number; left: number } | null>(null);

  // Get cursor coordinates for loader positioning
  const getCursorCoords = useCallback(() => {
    if (!editor) return null;
    const { from } = editor.state.selection;
    const coords = editor.view.coordsAtPos(from);
    const editorRect = editor.view.dom.getBoundingClientRect();
    return {
      top: coords.top - editorRect.top + editor.view.dom.scrollTop,
      left: coords.left - editorRect.left,
    };
  }, [editor]);

  const handleAutoComplete = useCallback(async () => {
    if (!editor || isAutoCompleting) return;

    const text = getTextForCompletion();
    if (!text) {
      setAutoCompleteError('No text to complete. Write something first.');
      return;
    }

    setIsAutoCompleting(true);
    setAutoCompleteError(null);

    // Show loading indicator at cursor position
    setLoaderPosition(getCursorCoords());

    // Create abort controller for this request
    abortControllerRef.current = new AbortController();

    try {
      const response = await fetch('/api/autocomplete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, modelId: selectedModel, prompt: customPrompt }),
        signal: abortControllerRef.current.signal,
      });

      const data = await response.json();

      // Hide loading indicator
      setLoaderPosition(null);

      if (!response.ok) {
        throw new Error(data.error || 'Failed to get completion');
      }

      if (data.completion && editor) {
        const completionText = data.completion.trim();
        const words = completionText.split(/\s+/).filter((w: string) => w.length > 0);
        
        if (words.length > 0) {
          const from = editor.state.selection.from;
          
          // Check if character before cursor is a space (to avoid double spaces)
          const textBeforeCursor = editor.state.doc.textBetween(0, from);
          const needsSpace = textBeforeCursor.length > 0 && !textBeforeCursor.endsWith(' ');
          const textToInsert = (needsSpace ? ' ' : '') + completionText;
          
          // Insert the completion text with the mark
          editor
            .chain()
            .focus()
            .insertContent(textToInsert)
            .setTextSelection({ from, to: from + textToInsert.length })
            .setCompletionMark()
            .setTextSelection(from)  // Cursor at start of generated text
            .run();
          
          completionTextRef.current = textToInsert;
          
          setCompletion({
            isActive: true,
            words,
            selectedCount: 0,
            range: { from, to: from + textToInsert.length },
          });
          
          // Calculate and store the generation cost
          if (data.usage && modelPricing[selectedModel]) {
            const pricing = modelPricing[selectedModel];
            const promptCost = (data.usage.promptTokens / 1000000) * pricing.prompt;
            const completionCost = (data.usage.completionTokens / 1000000) * pricing.completion;
            setLastGenerationCost(promptCost + completionCost);
          } else {
            setLastGenerationCost(null);
          }
        }
      }
      
      // Refresh balance after successful generation
      fetchBalance();
    } catch (error) {
      setLoaderPosition(null);
      // Don't show error for aborted requests
      if (error instanceof Error && error.name === 'AbortError') {
        console.log('Generation cancelled');
      } else {
        const message = error instanceof Error ? error.message : 'Failed to get completion';
        setAutoCompleteError(message);
        console.error('Auto-complete error:', error);
      }
    } finally {
      setIsAutoCompleting(false);
      abortControllerRef.current = null;
    }
  }, [editor, isAutoCompleting, getTextForCompletion, selectedModel, customPrompt, fetchBalance, modelPricing, getCursorCoords]);

  // Handle regeneration when Tab is pressed with no words selected
  const handleRegenerate = useCallback(async () => {
    if (!editor || isAutoCompleting || !completion.isActive || !completion.range) return;

    // Get the current ghost text before removing it
    const currentCompletionText = completionTextRef.current.trim();
    
    // Add current completion to attempts
    const newAttempts = [...attemptHistory.attempts, currentCompletionText];
    setAttemptHistory({ attempts: newAttempts });

    // Remove the current ghost text
    const { from, to } = completion.range;
    editor.chain().focus().setTextSelection({ from, to }).deleteSelection().run();

    setIsAutoCompleting(true);
    setAutoCompleteError(null);

    // Show loading indicator at cursor position
    setLoaderPosition(getCursorCoords());

    // Create abort controller for this request
    abortControllerRef.current = new AbortController();

    try {
      const text = getTextForCompletion();
      const regenPrompt = buildRegenPrompt(newAttempts);

      const response = await fetch('/api/autocomplete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, modelId: selectedModel, prompt: regenPrompt }),
        signal: abortControllerRef.current.signal,
      });

      const data = await response.json();

      // Hide loading indicator
      setLoaderPosition(null);

      if (!response.ok) {
        throw new Error(data.error || 'Failed to get completion');
      }

      if (data.completion && editor) {
        const completionText = data.completion.trim();
        const words = completionText.split(/\s+/).filter((w: string) => w.length > 0);
        
        if (words.length > 0) {
          const insertFrom = editor.state.selection.from;
          
          // Check if character before cursor is a space (to avoid double spaces)
          const textBeforeCursor = editor.state.doc.textBetween(0, insertFrom);
          const needsSpace = textBeforeCursor.length > 0 && !textBeforeCursor.endsWith(' ');
          const textToInsert = (needsSpace ? ' ' : '') + completionText;
          
          editor
            .chain()
            .focus()
            .insertContent(textToInsert)
            .setTextSelection({ from: insertFrom, to: insertFrom + textToInsert.length })
            .setCompletionMark()
            .setTextSelection(insertFrom)  // Cursor at start of generated text
            .run();
          
          completionTextRef.current = textToInsert;
          
          setCompletion({
            isActive: true,
            words,
            selectedCount: 0,
            range: { from: insertFrom, to: insertFrom + textToInsert.length },
          });
          
          // Calculate and store the generation cost
          if (data.usage && modelPricing[selectedModel]) {
            const pricing = modelPricing[selectedModel];
            const promptCost = (data.usage.promptTokens / 1000000) * pricing.prompt;
            const completionCost = (data.usage.completionTokens / 1000000) * pricing.completion;
            setLastGenerationCost(promptCost + completionCost);
          } else {
            setLastGenerationCost(null);
          }
        }
      }
      
      // Refresh balance after successful generation
      fetchBalance();
    } catch (error) {
      setLoaderPosition(null);
      // Don't show error for aborted requests
      if (error instanceof Error && error.name === 'AbortError') {
        console.log('Regeneration cancelled');
      } else {
        const message = error instanceof Error ? error.message : 'Failed to regenerate';
        setAutoCompleteError(message);
        console.error('Regenerate error:', error);
      }
    } finally {
      setIsAutoCompleting(false);
      abortControllerRef.current = null;
    }
  }, [editor, isAutoCompleting, completion, attemptHistory, getTextForCompletion, buildRegenPrompt, selectedModel, fetchBalance, modelPricing, getCursorCoords]);

  // Cancel ongoing generation
  const cancelGeneration = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setLoaderPosition(null);
    setIsAutoCompleting(false);
  }, []);

  const confirmCompletion = useCallback(() => {
    if (!editor || !completion.isActive || !completion.range) return;

    const { from, to } = completion.range;
    const selectedWords = completion.words.slice(0, completion.selectedCount);
    
    // Build the text to keep (with leading space if original had one)
    const hasLeadingSpace = completionTextRef.current.startsWith(' ');
    const textToKeep = selectedWords.length > 0 
      ? (hasLeadingSpace ? ' ' : '') + selectedWords.join(' ')
      : '';
    
    // Delete the entire ghost text range
    editor
      .chain()
      .focus()
      .setTextSelection({ from, to })
      .deleteSelection()
      .run();
    
    // Insert the selected words as regular text (without any marks)
    if (textToKeep) {
      editor.chain().focus().clearCompletionMark().insertContent(textToKeep).run();
    }
    
    // Ensure mark is fully cleared
    editor.chain().focus().clearCompletionMark().run();
    
    completionTextRef.current = '';
    // Clear attempt history when words are confirmed
    setAttemptHistory({ attempts: [] });
    setCompletion({
      isActive: false,
      words: [],
      selectedCount: 0,
      range: null,
    });
  }, [editor, completion]);

  const cancelCompletion = useCallback(() => {
    if (!editor || !completion.isActive || !completion.range) return;

    const { from, to } = completion.range;
    
    // Delete the ghost text and clear the completion mark to reset styling
    editor
      .chain()
      .focus()
      .setTextSelection({ from, to })
      .unsetCompletionMark()
      .deleteSelection()
      .clearCompletionMark()
      .run();
    
    completionTextRef.current = '';
    // Clear attempt history when cancelled
    setAttemptHistory({ attempts: [] });
    setCompletion({
      isActive: false,
      words: [],
      selectedCount: 0,
      range: null,
    });
  }, [editor, completion.isActive, completion.range]);

  const selectNextWord = useCallback(() => {
    if (!completion.isActive) return;
    
    // Clear attempt history when user starts selecting words
    if (completion.selectedCount === 0 && attemptHistory.attempts.length > 0) {
      setAttemptHistory({ attempts: [] });
    }
    
    setCompletion(prev => ({
      ...prev,
      selectedCount: Math.min(prev.selectedCount + 1, prev.words.length),
    }));
  }, [completion.isActive, completion.selectedCount, attemptHistory.attempts.length]);

  const deselectLastWord = useCallback(() => {
    if (!completion.isActive) return;
    
    setCompletion(prev => ({
      ...prev,
      selectedCount: Math.max(prev.selectedCount - 1, 0),
    }));
  }, [completion.isActive]);

  const selectAllWords = useCallback(() => {
    if (!completion.isActive) return;
    
    // Clear attempt history when user selects all words
    if (attemptHistory.attempts.length > 0) {
      setAttemptHistory({ attempts: [] });
    }
    
    setCompletion(prev => ({
      ...prev,
      selectedCount: prev.words.length,
    }));
  }, [completion.isActive, attemptHistory.attempts.length]);

  // Update visual selection when selectedCount changes
  useEffect(() => {
    if (!editor || !completion.isActive || !completion.range) return;

    const { from, to } = completion.range;
    const selectedWords = completion.words.slice(0, completion.selectedCount);
    
    // Calculate the position where selected words end
    const hasLeadingSpace = completionTextRef.current.startsWith(' ');
    const selectedText = selectedWords.length > 0 
      ? (hasLeadingSpace ? ' ' : '') + selectedWords.join(' ')
      : (hasLeadingSpace ? ' ' : '');
    const splitPos = from + selectedText.length;
    
    // Remove mark from selected portion, keep mark on unselected
    // Position cursor at the selection boundary (splitPos)
    if (splitPos < to) {
      editor.chain()
        .setTextSelection({ from, to })
        .unsetCompletionMark()
        .setTextSelection({ from: splitPos, to })
        .setCompletionMark()
        .setTextSelection(splitPos)  // Cursor follows selection
        .run();
    } else {
      // All words selected - remove all marks, cursor at end
      editor.chain()
        .setTextSelection({ from, to })
        .unsetCompletionMark()
        .setTextSelection(splitPos)  // Cursor at end of selection
        .run();
    }
  }, [editor, completion.isActive, completion.range, completion.selectedCount, completion.words]);

  // Handle keyboard events
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Handle Escape - cancel generation or completion
      if (e.key === 'Escape') {
        e.preventDefault();
        if (isAutoCompleting) {
          cancelGeneration();
        } else if (completion.isActive) {
          cancelCompletion();
        }
        return;
      }

      if (e.key === 'Tab' && !e.shiftKey) {
        e.preventDefault();
        
        if (completion.isActive) {
          // If no words selected, regenerate instead of confirm
          if (completion.selectedCount === 0) {
            handleRegenerate();
          } else {
            confirmCompletion();
          }
        } else if (!isAutoCompleting) {
          handleAutoComplete();
        }
        return;
      }

      if (completion.isActive) {
        if (e.key === 'ArrowRight') {
          e.preventDefault();
          selectNextWord();
          return;
        }
        
        if (e.key === 'ArrowLeft') {
          e.preventDefault();
          deselectLastWord();
          return;
        }
        
        if (e.key === ' ') {
          e.preventDefault();
          selectAllWords();
          return;
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [completion.isActive, completion.selectedCount, isAutoCompleting, handleAutoComplete, handleRegenerate, confirmCompletion, cancelCompletion, cancelGeneration, selectNextWord, deselectLastWord, selectAllWords]);

  useEffect(() => {
    if (editor && initialContent && editor.isEmpty) {
       // Content init logic
    }
  }, [initialContent, editor]);

  // Detect mobile keyboard visibility using Visual Viewport API
  useEffect(() => {
    if (typeof window === 'undefined' || !window.visualViewport) return;

    const viewport = window.visualViewport;
    
    const handleResize = () => {
      // Calculate keyboard height by comparing viewport height to window height
      const keyboardH = window.innerHeight - viewport.height;
      setKeyboardHeight(keyboardH > 100 ? keyboardH : 0); // Only set if significant (keyboard)
    };

    viewport.addEventListener('resize', handleResize);
    viewport.addEventListener('scroll', handleResize);
    
    return () => {
      viewport.removeEventListener('resize', handleResize);
      viewport.removeEventListener('scroll', handleResize);
    };
  }, []);

  if (!editor) {
    return null;
  }

  const toggleSidebar = () => setIsSidebarOpen(!isSidebarOpen);
  const toggleLeftSidebar = () => setIsLeftSidebarOpen(!isLeftSidebarOpen);

  return (
    <div className={`flex w-full min-h-screen bg-black text-white relative ${completion.isActive ? 'completion-active' : ''} ${isAutoCompleting ? 'generating' : ''}`}>
      {/* Completion Mode Indicator - Hidden on mobile (mobile has touch controls) */}
      {completion.isActive && (
        <div className="hidden md:flex fixed top-4 left-1/2 -translate-x-1/2 z-[70] bg-blue-600 text-white px-4 py-2 rounded-lg shadow-lg items-center gap-3 text-sm">
          <Sparkles size={16} />
          <span>
            <strong>{completion.selectedCount}</strong> / {completion.words.length} words selected
            {attemptHistory.attempts.length > 0 && (
              <span className="text-blue-200 ml-2">(attempt {attemptHistory.attempts.length + 1})</span>
            )}
          </span>
          {lastGenerationCost !== null && (
            <>
              <span className="text-blue-200">|</span>
              <span className="text-green-300 font-mono">${lastGenerationCost.toFixed(6)}</span>
            </>
          )}
          <span className="text-blue-200">|</span>
          <span className="text-blue-200">→ select</span>
          <span className="text-blue-200">← deselect</span>
          <span className="text-green-200">Space all</span>
          {completion.selectedCount === 0 ? (
            <span className="text-yellow-200">Tab regenerate</span>
          ) : (
            <span className="text-blue-200">Tab confirm</span>
          )}
          <span className="text-blue-200">Esc cancel</span>
        </div>
      )}

      {/* Left Sidebar - AI Auto-complete */}
      <div 
        className={`fixed top-0 left-0 h-full bg-zinc-900 border-r border-zinc-800 transition-all duration-300 ease-in-out z-[60] ${
          isLeftSidebarOpen ? 'w-72' : 'w-0'
        } overflow-hidden`}
      >
        <div className="p-4 flex flex-col gap-6 w-72 h-full overflow-y-auto">
          <h2 className="text-lg font-semibold text-zinc-400 border-b border-zinc-700 pb-2">
            <Sparkles size={18} className="inline mr-2" />
            AI Assistant
          </h2>
          
          {/* Balance Display */}
          <div className="flex flex-col gap-2 p-3 bg-zinc-800/50 rounded-lg border border-zinc-700">
            <div className="flex items-center justify-between">
              <span className="text-sm text-zinc-400 flex items-center gap-2">
                <DollarSign size={16} />
                Balance
              </span>
              <button
                type="button"
                onClick={fetchBalance}
                disabled={isLoadingBalance}
                className="p-1 hover:bg-zinc-700 rounded transition-colors cursor-pointer disabled:opacity-50"
                title="Refresh balance"
              >
                <RefreshCw size={14} className={isLoadingBalance ? 'animate-spin' : ''} />
              </button>
            </div>
            <div className="text-xl font-mono text-green-400">
              {balanceInfo ? `$${balanceInfo.balance.toFixed(4)}` : '---'}
            </div>
          </div>
          
          {/* Model Selection */}
          <div className="flex flex-col gap-2">
            <span className="text-sm text-zinc-400">Model</span>
            <div className="flex flex-col gap-1">
              {AVAILABLE_MODELS.map((model) => {
                const pricing = modelPricing[model.id];
                const isSelected = model.id === selectedModel;
                return (
                  <button
                    key={model.id}
                    type="button"
                    onClick={() => setSelectedModel(model.id)}
                    className={`flex items-center justify-between px-3 py-2 rounded text-sm text-left transition-colors cursor-pointer ${
                      isSelected 
                        ? 'bg-blue-600 text-white' 
                        : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'
                    }`}
                  >
                    <div className="flex flex-col">
                      <span className="font-medium">{model.name}</span>
                      <span className={`text-xs ${isSelected ? 'text-blue-200' : 'text-zinc-500'}`}>
                        {model.description}
                      </span>
                    </div>
                    {pricing && (
                      <div className={`text-xs text-right ${isSelected ? 'text-blue-200' : 'text-zinc-500'}`}>
                        <div>{formatCost(pricing.prompt)}/M in</div>
                        <div>{formatCost(pricing.completion)}/M out</div>
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Prompt Editor */}
          <div className="flex flex-col gap-2">
            <span className="text-sm text-zinc-400">Prompt</span>
            <textarea
              value={customPrompt}
              onChange={(e) => setCustomPrompt(e.target.value)}
              rows={3}
              className="bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-zinc-500 resize-none"
              placeholder="Enter your prompt..."
            />
            <span className="text-xs text-zinc-500">
              Your text will be appended after this prompt
            </span>
          </div>

          {/* Regeneration Prompt Template */}
          <div className="flex flex-col gap-2">
            <span className="text-sm text-zinc-400">Regeneration Prompt</span>
            <div className="relative">
              <textarea
                value={regenPromptTemplate}
                onChange={(e) => setRegenPromptTemplate(e.target.value)}
                rows={6}
                className="bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-zinc-500 resize-none w-full font-mono"
                placeholder="Regeneration prompt template..."
              />
            </div>
            <div className="text-xs text-zinc-500 space-y-1">
              <p><code className="px-1 bg-zinc-700 rounded text-blue-300">{'{{ATTEMPTS}}'}</code> = previous attempts</p>
              <p><code className="px-1 bg-zinc-700 rounded text-green-300">{'{{ORIGINAL_PROMPT}}'}</code> = prompt above</p>
            </div>
            {attemptHistory.attempts.length > 0 && (
              <div className="mt-1 p-2 bg-blue-900/30 border border-blue-700 rounded text-xs text-blue-300">
                <span className="font-medium">Attempts: {attemptHistory.attempts.length}</span>
                <p className="mt-1 text-blue-400">Press Tab with no selection to regenerate</p>
              </div>
            )}
          </div>

          {/* Auto-complete Button */}
          <div className="flex flex-col gap-2">
            <span className="text-sm text-zinc-400">Auto-complete</span>
            <button
              type="button"
              onClick={handleAutoComplete}
              disabled={isAutoCompleting}
              className="flex items-center justify-center gap-2 px-4 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-zinc-700 disabled:cursor-not-allowed rounded text-white font-medium transition-colors cursor-pointer"
            >
              {isAutoCompleting ? (
                <>
                  <Loader2 size={18} className="animate-spin" />
                  Generating...
                </>
              ) : (
                <>
                  <Sparkles size={18} />
                  Complete 2 Sentences
                </>
              )}
            </button>
            <div className="text-xs text-zinc-500 space-y-1">
              <p><kbd className="px-1 py-0.5 bg-zinc-700 rounded">Tab</kbd> to generate completion</p>
              <p><kbd className="px-1 py-0.5 bg-zinc-700 rounded">→</kbd> <kbd className="px-1 py-0.5 bg-zinc-700 rounded">←</kbd> to select words</p>
              <p><kbd className="px-1 py-0.5 bg-zinc-700 rounded">Space</kbd> to select all words</p>
              <p><kbd className="px-1 py-0.5 bg-zinc-700 rounded">Tab</kbd> confirm or regenerate</p>
              <p><kbd className="px-1 py-0.5 bg-zinc-700 rounded">Esc</kbd> to cancel</p>
            </div>
            {autoCompleteError && (
              <div className="mt-2 p-2 bg-red-900/50 border border-red-700 rounded text-xs text-red-300">
                {autoCompleteError}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Left Toggle Button */}
      <button
        type="button"
        onClick={toggleLeftSidebar}
        className={`fixed top-8 z-[60] p-2 bg-zinc-800 rounded-r-md text-white transition-all duration-300 cursor-pointer hover:bg-zinc-700 ${
          isLeftSidebarOpen ? 'left-72 max-md:left-72' : 'left-0'
        }`}
      >
        {isLeftSidebarOpen ? <ChevronLeft size={20} /> : <ChevronRight size={20} />}
      </button>

      {/* Right Sidebar - Formatting Tools */}
      <div 
        className={`fixed top-0 right-0 h-full bg-zinc-900 border-l border-zinc-800 transition-all duration-300 ease-in-out z-[60] ${
          isSidebarOpen ? 'w-64' : 'w-0'
        } overflow-hidden`}
      >
        <div className="p-4 flex flex-col gap-6 w-64">
          <h2 className="text-lg font-semibold text-zinc-400 border-b border-zinc-700 pb-2">Tools</h2>
          
          {/* Bold Control */}
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-2 text-sm"><Bold size={16} /> Bold</span>
            <button
              type="button"
              onClick={() => editor.chain().focus().toggleBold().run()}
              className={`w-10 h-6 rounded-full transition-colors cursor-pointer ${editor.isActive('bold') ? 'bg-blue-600' : 'bg-zinc-700'}`}
            >
              <div className={`w-4 h-4 bg-white rounded-full shadow-md transform transition-transform ${editor.isActive('bold') ? 'translate-x-5' : 'translate-x-1'}`} />
            </button>
          </div>

          {/* Color Control */}
          <div className="flex flex-col gap-2">
            <span className="flex items-center gap-2 text-sm"><Palette size={16} /> Text Color</span>
            <div className="flex gap-2 flex-wrap">
              {['#ffffff', '#ef4444', '#3b82f6', '#22c55e', '#eab308', '#a855f7'].map((color) => (
                <button
                  key={color}
                  type="button"
                  onClick={() => editor.chain().focus().setColor(color).run()}
                  className={`w-6 h-6 rounded-full border cursor-pointer hover:scale-110 transition-transform ${editor.isActive('textStyle', { color }) ? 'border-white scale-110' : 'border-transparent'}`}
                  style={{ backgroundColor: color }}
                  title={color}
                />
              ))}
            </div>
          </div>

          {/* Highlight Control */}
          <div className="flex flex-col gap-2">
            <span className="flex items-center gap-2 text-sm"><Highlighter size={16} /> Highlight</span>
            <div className="flex gap-2 flex-wrap">
              <button
                  type="button"
                  onClick={() => editor.chain().focus().unsetHighlight().run()}
                  className="px-2 py-1 text-xs bg-zinc-800 rounded border border-zinc-700 cursor-pointer hover:bg-zinc-700 transition-colors"
              >
                None
              </button>
              {['#facc15', '#4ade80', '#60a5fa', '#f472b6'].map((color) => (
                <button
                  key={color}
                  type="button"
                  onClick={() => editor.chain().focus().toggleHighlight({ color }).run()}
                  className={`w-6 h-6 rounded-full border cursor-pointer hover:scale-110 transition-transform ${editor.isActive('highlight', { color }) ? 'border-white scale-110' : 'border-transparent'}`}
                  style={{ backgroundColor: color }}
                  title={color}
                />
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Toggle Button */}
      <button
        type="button"
        onClick={toggleSidebar}
        className={`fixed top-8 z-[60] p-2 bg-zinc-800 rounded-l-md text-white transition-all duration-300 cursor-pointer hover:bg-zinc-700 ${
          isSidebarOpen ? 'right-64 max-md:right-64' : 'right-0'
        }`}
      >
        {isSidebarOpen ? <ChevronRight size={20} /> : <ChevronLeft size={20} />}
      </button>

      {/* Mobile Sidebar Overlay */}
      {(isLeftSidebarOpen || isSidebarOpen) && (
        <div 
          className="sidebar-overlay md:hidden"
          onClick={() => {
            setIsLeftSidebarOpen(false);
            setIsSidebarOpen(false);
          }}
        />
      )}

      {/* Editor Area */}
      <div className={`flex-1 transition-all duration-300 relative editor-area ${isSidebarOpen ? 'md:mr-64' : ''} ${isLeftSidebarOpen ? 'md:ml-72' : ''}`}>
        <EditorContent editor={editor} />
        
        {/* Loading Indicator Overlay */}
        {loaderPosition && (
          <div 
            className="ai-loading-indicator absolute pointer-events-none"
            style={{ 
              top: loaderPosition.top, 
              left: loaderPosition.left,
            }}
          >
            <div className="orbit-container">
              <div className="orbit-dot"></div>
              <div className="orbit-dot"></div>
              <div className="orbit-dot"></div>
            </div>
          </div>
        )}
      </div>

      {/* Mobile Touch Controls - moves up when keyboard is visible */}
      <div 
        className="fixed right-6 z-[80] flex flex-col items-end gap-3 transition-all duration-200"
        style={{ bottom: keyboardHeight > 0 ? `${keyboardHeight + 24}px` : '24px' }}
      >
        {/* Completion Controls - shown when completion is active */}
        {completion.isActive && (
          <div className="flex items-center gap-2 bg-zinc-900/95 backdrop-blur-sm rounded-full px-3 py-2 shadow-lg border border-zinc-700/50">
            {/* Word count indicator */}
            <span className="text-xs text-zinc-400 px-2">
              {completion.selectedCount}/{completion.words.length}
            </span>
            
            {/* Deselect word */}
            <button
              type="button"
              onClick={deselectLastWord}
              disabled={completion.selectedCount === 0}
              className="p-2 rounded-full text-zinc-400 hover:text-white hover:bg-zinc-700 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              title="Deselect word"
            >
              <ChevronLeft size={18} />
            </button>
            
            {/* Select next word */}
            <button
              type="button"
              onClick={selectNextWord}
              disabled={completion.selectedCount >= completion.words.length}
              className="p-2 rounded-full text-zinc-400 hover:text-white hover:bg-zinc-700 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              title="Select word"
            >
              <ChevronRight size={18} />
            </button>
            
            {/* Select all */}
            <button
              type="button"
              onClick={selectAllWords}
              disabled={completion.selectedCount >= completion.words.length}
              className="p-2 rounded-full text-zinc-400 hover:text-white hover:bg-zinc-700 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              title="Select all"
            >
              <ChevronsRight size={18} />
            </button>
            
            {/* Divider */}
            <div className="w-px h-5 bg-zinc-700" />
            
            {/* Regenerate (when no words selected) or Confirm */}
            {completion.selectedCount === 0 ? (
              <button
                type="button"
                onClick={handleRegenerate}
                className="p-2 rounded-full text-amber-400 hover:text-amber-300 hover:bg-zinc-700 transition-colors"
                title="Regenerate"
              >
                <RotateCcw size={18} />
              </button>
            ) : (
              <button
                type="button"
                onClick={confirmCompletion}
                className="p-2 rounded-full text-green-400 hover:text-green-300 hover:bg-zinc-700 transition-colors"
                title="Confirm"
              >
                <Check size={18} />
              </button>
            )}
            
            {/* Cancel */}
            <button
              type="button"
              onClick={cancelCompletion}
              className="p-2 rounded-full text-red-400 hover:text-red-300 hover:bg-zinc-700 transition-colors"
              title="Cancel"
            >
              <X size={18} />
            </button>
          </div>
        )}

        {/* Cancel generation button - shown during loading */}
        {isAutoCompleting && !completion.isActive && (
          <button
            type="button"
            onClick={cancelGeneration}
            className="p-3 rounded-full bg-zinc-900/95 backdrop-blur-sm text-red-400 hover:text-red-300 hover:bg-zinc-800 transition-all shadow-lg border border-zinc-700/50"
            title="Cancel generation"
          >
            <X size={22} />
          </button>
        )}

        {/* Main FAB - Generate completion */}
        {!completion.isActive && !isAutoCompleting && (
          <button
            type="button"
            onClick={handleAutoComplete}
            className="p-4 rounded-full bg-blue-600 hover:bg-blue-500 text-white transition-all shadow-lg hover:shadow-blue-500/25 hover:scale-105 active:scale-95"
            title="Generate AI completion"
          >
            <Split size={24} />
          </button>
        )}
      </div>
    </div>
  );
};

export default TiptapEditor;
