import { useState, useEffect, useRef, useCallback } from 'react';
import { X } from 'lucide-react';
import CodeBlockWidget from './LLMCodeBlock';
import TextBlockWidget from './LLMTextBlock';
import { authenticatedFetch } from '../hooks/useApi';

interface LLMSidebarProps {
  onClose?: () => void;
  onEditCode?: (code: string) => void;
  onPasteCode?: (code: string) => void;
}

export default function LLMSidebar({ onClose, onEditCode, onPasteCode }: LLMSidebarProps) {
  const [prompt, setPrompt] = useState('');
  const [response, setResponse] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [status, setStatus] = useState('');
  const [streamingText, setStreamingText] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const responseContainerRef = useRef<HTMLDivElement>(null);
  const streamingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Auto-scroll to bottom when content changes
  useEffect(() => {
    if (responseContainerRef.current) {
      responseContainerRef.current.scrollTop = responseContainerRef.current.scrollHeight;
    }
  }, [streamingText, response]);

  // Handle streaming display
  useEffect(() => {
    if (isStreaming && streamingText) {
      // Stream word by word
      let currentIndex = 0;
      const streamSpeed = 25; // milliseconds between words

      const streamNext = () => {
        if (currentIndex < streamingText.length) {
          // Find next word boundary
          let end = currentIndex;
          while (end < streamingText.length && streamingText[end] !== ' ' && streamingText[end] !== '\n' && streamingText[end] !== '\t') {
            end++;
          }
          // Include trailing whitespace
          while (end < streamingText.length && (streamingText[end] === ' ' || streamingText[end] === '\n' || streamingText[end] === '\t')) {
            end++;
          }
          if (end === currentIndex) {
            end = Math.min(currentIndex + 1, streamingText.length);
          }
          
          currentIndex = end;
          setResponse(streamingText.substring(0, currentIndex));
          
          streamingTimeoutRef.current = setTimeout(streamNext, streamSpeed);
        } else {
          setIsStreaming(false);
          setResponse(streamingText);
        }
      };

      streamNext();
      return () => {
        if (streamingTimeoutRef.current) {
          clearTimeout(streamingTimeoutRef.current);
        }
      };
    }
  }, [isStreaming, streamingText]);


  const handleGenerate = useCallback(async () => {
    if (!prompt.trim()) {
      setStatus('Please enter a prompt first.');
      return;
    }

    setIsGenerating(true);
    setStatus('Generating with Gemini 2.5 Flash…');
    setResponse('');
    setStreamingText('');
    setIsStreaming(false);

    try {
      const response = await authenticatedFetch('/api/llm/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: prompt.trim(),
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || 'Failed to generate response');
      }

      const result = await response.json();
      if (result.success && result.response) {
        // Start streaming
        setStreamingText(result.response);
        setIsStreaming(true);
        setStatus('');
      } else {
        throw new Error('Invalid response from server');
      }
    } catch (error: any) {
      console.error('Error generating LLM response:', error);
      setStatus(`Error: ${error.message || 'Failed to generate response'}`);
    } finally {
      setIsGenerating(false);
    }
  }, [prompt]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleGenerate();
    }
  };

  // Parse response into parts (text and code blocks)
  const parseResponse = (text: string): Array<{ type: 'text' | 'code'; content: string; language?: string }> => {
    if (!text) return [];

    const parts: Array<{ type: 'text' | 'code'; content: string; language?: string }> = [];
    const codePattern = /```(\w*)\s*\n?(.*?)```/gs;

    let lastIndex = 0;
    let match;

    while ((match = codePattern.exec(text)) !== null) {
      // Add text before code block
      const beforeText = text.substring(lastIndex, match.index).trim();
      if (beforeText) {
        parts.push({ type: 'text', content: beforeText });
      }

      // Add code block
      const language = match[1] || 'python';
      const codeContent = match[2].trim();
      parts.push({ type: 'code', content: codeContent, language });

      lastIndex = match.index + match[0].length;
    }

    // Add remaining text
    const remainingText = text.substring(lastIndex).trim();
    if (remainingText) {
      parts.push({ type: 'text', content: remainingText });
    }

    // If no code blocks found, return as single text block
    if (parts.length === 0) {
      parts.push({ type: 'text', content: text.trim() });
    }

    return parts;
  };

  const responseParts = parseResponse(response);

  return (
    <div className="w-full h-full bg-[#1e1e1e] text-white flex flex-col border-l border-white/10">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
        <h2 className="text-lg font-bold">AI Assistant</h2>
        {onClose && (
          <button
            onClick={onClose}
            className="p-1 text-gray-400 hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        )}
      </div>

      {/* Status */}
      {status && (
        <div className="px-4 py-2 text-xs text-gray-400 border-b border-white/10">
          {status}
        </div>
      )}

      {/* Response area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3" ref={responseContainerRef}>
        {responseParts.length === 0 && !isStreaming && !isGenerating && (
          <div className="text-gray-500 italic text-center py-8">
            LLM response will appear here...
          </div>
        )}

        {(isStreaming || isGenerating) && responseParts.length === 0 && (
          <div className="text-gray-400 italic text-center py-8">
            {isGenerating ? 'Generating response...' : 'Streaming response...'}
          </div>
        )}

        {responseParts.map((part, index) => {
          if (part.type === 'code') {
            return (
              <CodeBlockWidget
                key={index}
                code={part.content}
                language={part.language || 'python'}
                onEdit={onEditCode}
                onPaste={onPasteCode}
              />
            );
          } else {
            return <TextBlockWidget key={index} text={part.content} />;
          }
        })}
      </div>

      {/* Prompt input */}
      <div className="p-4 border-t border-white/10">
        <label className="block text-sm font-semibold mb-2">Prompt</label>
        <div className="relative">
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Describe what you want to build... (Press Enter to generate, Shift+Enter for new line)"
            disabled={isGenerating}
            className="w-full bg-[#1e1e1e] border border-white/20 rounded-lg p-3 pr-12 text-sm resize-none focus:outline-none focus:border-[#06E4A8] disabled:opacity-50"
            rows={3}
          />
          <button
            onClick={handleGenerate}
            disabled={isGenerating || !prompt.trim()}
            className="absolute bottom-3 right-3 w-7 h-7 bg-[#06E4A8] text-[#1A1A1A] rounded-full flex items-center justify-center font-bold text-sm hover:opacity-85 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
            title="Generate (Enter)"
          >
            ▲
          </button>
        </div>
      </div>
    </div>
  );
}

