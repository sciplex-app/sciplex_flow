import { useState, useEffect, useRef } from 'react';
import { X } from 'lucide-react';

interface SchemaInfo {
  columns?: string[];
  dtypes?: Record<string, string>;
  shape?: [number, number];
  sample?: Record<string, any>[];
}

interface LLMDataPromptDialogProps {
  schemaInfo: SchemaInfo | null;
  onClose: () => void;
  onGenerate: (prompt: string) => void;
}

export default function LLMDataPromptDialog({
  schemaInfo,
  onClose,
  onGenerate,
}: LLMDataPromptDialogProps) {
  const [prompt, setPrompt] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Focus textarea on mount
  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const handleGenerate = () => {
    if (prompt.trim()) {
      onGenerate(prompt.trim());
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && e.ctrlKey) {
      e.preventDefault();
      handleGenerate();
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/80 flex items-center justify-center z-[100] p-8"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        className="w-full max-w-2xl bg-[#1E1E1E] rounded-xl border border-white/10 flex flex-col overflow-hidden shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 bg-[#252526] border-b border-white/10">
          <div className="flex items-center gap-3">
            <img 
              src="/api/icons/action_chat" 
              alt="AI" 
              className="w-5 h-5 object-contain opacity-75 ml-4" 
            />
            <span className="text-gray-300 font-medium">New node with AI</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="p-2 text-gray-400 hover:text-white transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Help text */}
          <div className="text-sm text-gray-400">
            Enter a description of what you want to do with this data.
            <br />
            For example: "compute the mean value of the AT column"
          </div>

          {/* Schema information */}
          {schemaInfo && (
            <div className="space-y-2">
              <div className="text-sm font-semibold text-gray-300">Data Schema:</div>
              <div className="bg-[#252526] rounded-lg p-3 font-mono text-xs text-gray-300 space-y-1 max-h-40 overflow-y-auto">
                {schemaInfo.columns && (
                  <div>
                    <span className="text-gray-500">Columns: </span>
                    <span>{schemaInfo.columns.join(', ')}</span>
                  </div>
                )}
                {schemaInfo.dtypes && (
                  <div>
                    <span className="text-gray-500">Data types: </span>
                    <span>
                      {Object.entries(schemaInfo.dtypes)
                        .map(([col, dtype]) => `${col}: ${dtype}`)
                        .join(', ')}
                    </span>
                  </div>
                )}
                {schemaInfo.shape && (
                  <div>
                    <span className="text-gray-500">Shape: </span>
                    <span>
                      {schemaInfo.shape[0]} rows × {schemaInfo.shape[1]} columns
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Prompt input */}
          <div className="space-y-2">
            <div className="text-sm font-semibold text-gray-300">Your Request:</div>
            <textarea
              ref={textareaRef}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="e.g., compute the mean value of the 'AT' column"
              className="
                w-full h-32 px-3 py-2
                bg-[#252526] border border-white/10 rounded-lg
                text-gray-200 text-sm
                placeholder-gray-500
                focus:outline-none focus:border-[#06E4A8]
                resize-none
              "
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-4 py-3 bg-[#252526] border-t border-white/10">
          <button
            onClick={onClose}
            className="
              px-4 py-2 text-sm text-gray-300
              hover:bg-white/10 rounded-lg transition-colors
            "
          >
            Cancel
          </button>
          <button
            onClick={handleGenerate}
            disabled={!prompt.trim()}
            className="
              px-4 py-2 text-sm text-white font-medium
              bg-[#06E4A8] hover:bg-[#04c790] rounded-lg transition-colors
              disabled:opacity-50 disabled:cursor-not-allowed
            "
          >
            Generate Node
          </button>
        </div>
      </div>
    </div>
  );
}

