import { useState, useEffect, useRef, useCallback } from 'react';
import { X, Check, XCircle } from 'lucide-react';
import CodeBlockWidget from './LLMCodeBlock';
import TextBlockWidget from './LLMTextBlock';
import CodeViewer from './CodeViewer';

interface ScriptNodeLLMDialogProps {
  nodeId: string;
  currentCode: string;
  onClose: () => void;
  onAcceptCode: (code: string) => void;
}

export default function ScriptNodeLLMDialog({
  nodeId,
  currentCode: initialCurrentCode,
  onClose,
  onAcceptCode,
}: ScriptNodeLLMDialogProps) {
  const [prompt, setPrompt] = useState('');
  const [response, setResponse] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [status, setStatus] = useState('');
  const [streamingText, setStreamingText] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [improvedCode, setImprovedCode] = useState<string | null>(null);
  const [acceptedCode, setAcceptedCode] = useState<string | null>(null); // Code that was accepted but not yet applied
  
  // Use acceptedCode if available, otherwise use initial currentCode
  const displayCode = acceptedCode || initialCurrentCode;
  const responseContainerRef = useRef<HTMLDivElement>(null);
  const streamingTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Auto-scroll to bottom when content changes
  useEffect(() => {
    if (responseContainerRef.current) {
      responseContainerRef.current.scrollTop = responseContainerRef.current.scrollHeight;
    }
  }, [streamingText, response]);

  // Handle streaming display
  useEffect(() => {
    if (isStreaming && streamingText) {
      let currentIndex = 0;
      const streamSpeed = 25;

      const streamNext = () => {
        if (currentIndex < streamingText.length) {
          let end = currentIndex;
          while (end < streamingText.length && streamingText[end] !== ' ' && streamingText[end] !== '\n' && streamingText[end] !== '\t') {
            end++;
          }
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
          // Extract code from response
          extractCodeFromResponse(streamingText);
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

  // Extract code from response
  const extractCodeFromResponse = (text: string) => {
    const codePattern = /```(?:python)?\s*\n?(.*?)```/gs;
    const match = codePattern.exec(text);
    if (match && match[1]) {
      setImprovedCode(match[1].trim());
    } else {
      // Try to find function definition without code fences
      const functionPattern = /def\s+\w+[^`]*/s;
      const funcMatch = functionPattern.exec(text);
      if (funcMatch) {
        setImprovedCode(funcMatch[0].trim());
      }
    }
  };

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
    setImprovedCode(null);

    try {
      const response = await fetch(`/api/nodes/${nodeId}/llm-improve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: prompt.trim(),
          current_code: displayCode,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || 'Failed to generate response');
      }

      const result = await response.json();
      if (result.success && result.improved_code) {
        // Clean the code - extract only the function code
        let cleanedCode = result.improved_code.trim();
        
        // Remove markdown code fences if present
        if (cleanedCode.startsWith('```')) {
          cleanedCode = cleanedCode.replace(/^```(?:python)?\s*\n?/, '').replace(/\n?```$/, '').trim();
        }
        
        // Try to extract just the function if there's extra text
        const functionMatch = cleanedCode.match(/\bdef\s+\w+.*/s);
        if (functionMatch) {
          cleanedCode = functionMatch[0].trim();
        }
        
        // Set the improved code (don't show in response area, only in preview)
        setImprovedCode(cleanedCode);
        setResponse('');
        setStreamingText('');
        setIsStreaming(false);
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
  }, [prompt, nodeId, displayCode]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleGenerate();
    }
  };

  const handleAccept = () => {
    if (improvedCode) {
      // Accept the code - replace the current code preview with improved code
      setAcceptedCode(improvedCode);
      // Update the current code display to show the accepted code
      // Clear the improved code preview since it's now accepted
      setImprovedCode(null);
      setResponse('');
      setStreamingText('');
    }
  };

  const handleApply = () => {
    // Apply the accepted code to the node
    if (acceptedCode) {
      onAcceptCode(acceptedCode);
      onClose();
    } else if (improvedCode) {
      // If no accepted code but there's improved code, apply that directly
      onAcceptCode(improvedCode);
      onClose();
    }
  };

  const handleReject = () => {
    setImprovedCode(null);
    setResponse('');
    setStreamingText('');
  };

  // Parse response into parts (text and code blocks)
  const parseResponse = (text: string): Array<{ type: 'text' | 'code'; content: string; language?: string }> => {
    if (!text) return [];

    const parts: Array<{ type: 'text' | 'code'; content: string; language?: string }> = [];
    const codePattern = /```(\w*)\s*\n?(.*?)```/gs;

    let lastIndex = 0;
    let match;

    while ((match = codePattern.exec(text)) !== null) {
      const beforeText = text.substring(lastIndex, match.index).trim();
      if (beforeText) {
        parts.push({ type: 'text', content: beforeText });
      }

      const language = match[1] || 'python';
      const codeContent = match[2].trim();
      parts.push({ type: 'code', content: codeContent, language });

      lastIndex = match.index + match[0].length;
    }

    const remainingText = text.substring(lastIndex).trim();
    if (remainingText) {
      parts.push({ type: 'text', content: remainingText });
    }

    if (parts.length === 0) {
      parts.push({ type: 'text', content: text.trim() });
    }

    return parts;
  };

  const responseParts = parseResponse(response);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-[90vw] h-[90vh] max-w-6xl bg-[#1e1e24] border border-white/20 rounded-lg shadow-xl flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
          <h2 className="text-xl font-bold text-white">Improve Script Node with AI</h2>
          <button
            onClick={onClose}
            className="p-1 text-gray-400 hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 flex overflow-hidden">
          {/* Left side: Current code */}
          <div className="w-1/2 border-r border-white/10 flex flex-col">
            <div className="px-4 py-2 border-b border-white/10 bg-[#0f0f12]">
              <h3 className="text-sm font-semibold text-gray-300">Current Code</h3>
            </div>
            <div className="flex-1 overflow-auto">
              <CodeViewer code={displayCode} />
            </div>
          </div>

          {/* Right side: Chat interface */}
          <div className="w-1/2 flex flex-col">
            {/* Status */}
            {status && (
              <div className="px-4 py-2 text-xs text-gray-400 border-b border-white/10 bg-[#0f0f12]">
                {status}
              </div>
            )}

            {/* Response area */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3" ref={responseContainerRef}>
              {responseParts.length === 0 && !isStreaming && !isGenerating && (
                <div className="text-gray-500 italic text-center py-8">
                  Describe what you want to improve or change in the code...
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
                    />
                  );
                } else {
                  return <TextBlockWidget key={index} text={part.content} />;
                }
              })}
            </div>

            {/* Improved code preview and actions */}
            {improvedCode && (
              <div className="border-t border-white/10 p-4 bg-[#0f0f12]">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-semibold text-gray-300">Improved Code</h3>
                  <div className="flex gap-2">
                    <button
                      onClick={handleReject}
                      className="px-3 py-1.5 text-sm bg-white/10 hover:bg-white/20 rounded-md transition-colors flex items-center gap-1"
                    >
                      <XCircle className="w-4 h-4" />
                      Reject
                    </button>
                    <button
                      onClick={handleAccept}
                      className="px-3 py-1.5 text-sm bg-[#06E4A8] hover:bg-[#04c790] text-black font-medium rounded-md transition-colors flex items-center gap-1"
                    >
                      <Check className="w-4 h-4" />
                      Accept
                    </button>
                  </div>
                </div>
                <div className="max-h-48 overflow-auto bg-[#1e1e24] border border-white/10 rounded">
                  <CodeViewer code={improvedCode} />
                </div>
              </div>
            )}

            {/* Apply button - shown when code is accepted */}
            {acceptedCode && !improvedCode && (
              <div className="border-t border-white/10 p-4 bg-[#0f0f12]">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-semibold text-gray-300 mb-1">Code Accepted</h3>
                    <p className="text-xs text-gray-500">Click Apply to update the script node</p>
                  </div>
                  <button
                    onClick={handleApply}
                    className="px-4 py-2 text-sm bg-[#06E4A8] hover:bg-[#04c790] text-black font-medium rounded-md transition-colors flex items-center gap-2"
                  >
                    <Check className="w-4 h-4" />
                    Apply
                  </button>
                </div>
              </div>
            )}

            {/* Prompt input */}
            <div className="p-4 border-t border-white/10">
              <label className="block text-sm font-semibold mb-2">Your Feedback</label>
              <div className="relative">
                <textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Describe what you want to improve or change... (Press Enter to generate, Shift+Enter for new line)"
                  disabled={isGenerating}
                  className="w-full bg-[#1e1e24] border border-white/20 rounded-lg p-3 pr-12 text-sm resize-none focus:outline-none focus:border-[#06E4A8] disabled:opacity-50"
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
        </div>
      </div>
    </div>
  );
}

