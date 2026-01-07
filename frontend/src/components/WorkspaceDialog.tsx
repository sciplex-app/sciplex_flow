import { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import { authenticatedFetch } from '../hooks/useApi';

interface WorkspaceDialogProps {
  onClose: () => void;
}

export default function WorkspaceDialog({ onClose }: WorkspaceDialogProps) {
  const [variables, setVariables] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchVariables = async () => {
      try {
        setLoading(true);
        const response = await authenticatedFetch('/api/workspace/variables');
        if (!response.ok) {
          throw new Error('Failed to fetch variables');
        }
        const data = await response.json();
        setVariables(data.variables || {});
        setError(null);
      } catch (err: any) {
        setError(err.message || 'Failed to load variables');
      } finally {
        setLoading(false);
      }
    };

    fetchVariables();
  }, []);

  const formatValue = (value: any): string => {
    if (value === null || value === undefined) {
      return 'None';
    }
    
    // Handle arrays
    if (Array.isArray(value)) {
      // Check if it's a 2D array (array of arrays)
      if (value.length > 0 && Array.isArray(value[0])) {
        return '[\n' + value.map((row: unknown[]) => '  [' + row.map((v: unknown) => formatSingleValue(v)).join(', ') + ']').join(',\n') + '\n]';
      }
      // Check if it's an array of objects (likely a DataFrame)
      if (value.length > 0 && typeof value[0] === 'object' && !Array.isArray(value[0])) {
        return JSON.stringify(value, null, 2);
      }
      // Regular array
      return '[' + value.map((v: unknown) => formatSingleValue(v)).join(', ') + ']';
    }
    
    // Handle objects (dictionaries)
    if (typeof value === 'object') {
      return JSON.stringify(value, null, 2);
    }
    
    return formatSingleValue(value);
  };

  const formatSingleValue = (value: any): string => {
    if (value === null || value === undefined) {
      return 'None';
    }
    if (typeof value === 'string') {
      return `"${value}"`;
    }
    return String(value);
  };

  const displayVariables = () => {
    if (!variables || Object.keys(variables).length === 0) {
      return <div className="text-gray-400 text-sm">No variables in workspace</div>;
    }

    const maxKeyLen = Math.max(...Object.keys(variables).map(k => k.length), 0);
    const lines: string[] = [];

    for (const [key, value] of Object.entries(variables)) {
      const keyStr = key.padEnd(maxKeyLen);
      const valueStr = formatValue(value);
      const valueLines = valueStr.split('\n');
      
      lines.push(`${keyStr} : ${valueLines[0]}`);
      for (let i = 1; i < valueLines.length; i++) {
        lines.push(`${' '.repeat(maxKeyLen)}   ${valueLines[i]}`);
      }
    }

    return (
      <pre className="text-sm text-gray-300 font-mono whitespace-pre-wrap">
        {lines.join('\n')}
      </pre>
    );
  };

  return (
    <div 
      className="fixed inset-0 bg-black/80 flex items-center justify-center z-[100] p-8"
      onClick={(e) => {
        // Close when clicking the backdrop
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div 
        className="w-full max-w-4xl h-full max-h-[90vh] bg-[#1E1E1E] rounded-xl border border-white/10 flex flex-col overflow-hidden shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 bg-[#252526] border-b border-white/10">
          <div className="flex items-center gap-3">
            <span className="text-gray-300 font-medium">Workspace</span>
            <span className="text-xs text-gray-500">Global variables</span>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-gray-400 hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 px-6 py-4 overflow-auto bg-[#1E1E1E]">
          {loading ? (
            <div className="flex items-center justify-center h-full">
              <div className="text-gray-400">Loading variables...</div>
            </div>
          ) : error ? (
            <div className="flex items-center justify-center h-full">
              <div className="text-red-400">{error}</div>
            </div>
          ) : (
            displayVariables()
          )}
        </div>
      </div>
    </div>
  );
}

