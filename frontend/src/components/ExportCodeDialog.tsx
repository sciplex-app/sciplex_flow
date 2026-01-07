import { useState, useEffect } from 'react';
import PythonEditor from './PythonEditor';
import { authenticatedFetch } from '../hooks/useApi';

interface ExportCodeDialogProps {
  onClose: () => void;
  initialCode?: string;
}

export default function ExportCodeDialog({ onClose, initialCode = '' }: ExportCodeDialogProps) {
  const [code, setCode] = useState<string>(initialCode);
  const [loading, setLoading] = useState(!initialCode);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);

  useEffect(() => {
    if (!initialCode) {
      // Fetch code from backend
      const fetchCode = async () => {
        try {
          setLoading(true);
          const response = await authenticatedFetch('/api/graph/export-python');
          if (!response.ok) {
            throw new Error('Failed to export graph');
          }
          const data = await response.json();
          setCode(data.code || '');
          setWarnings(data.warnings || []);
          setError(null);
        } catch (err: any) {
          setError(err.message || 'Failed to load exported code');
        } finally {
          setLoading(false);
        }
      };

      fetchCode();
    } else {
      setCode(initialCode);
    }
  }, [initialCode]);

  const handleDownload = () => {
    if (!code.trim()) {
      return;
    }

    // Create a blob with the code
    const blob = new Blob([code], { type: 'text/python' });
    const url = URL.createObjectURL(blob);
    
    // Create a temporary anchor element and trigger download
    const a = document.createElement('a');
    a.href = url;
    a.download = 'graph_export.py';
    document.body.appendChild(a);
    a.click();
    
    // Cleanup
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  if (loading) {
    return (
      <div 
        className="fixed inset-0 bg-black/80 flex items-center justify-center z-[100] p-8"
        onClick={(e) => {
          if (e.target === e.currentTarget) {
            onClose();
          }
        }}
      >
        <div className="bg-[#1E1E1E] rounded-xl border border-white/10 p-8">
          <div className="text-gray-400">Exporting graph...</div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div 
        className="fixed inset-0 bg-black/80 flex items-center justify-center z-[100] p-8"
        onClick={(e) => {
          if (e.target === e.currentTarget) {
            onClose();
          }
        }}
      >
        <div className="bg-[#1E1E1E] rounded-xl border border-white/10 p-8 max-w-md">
          <div className="text-red-400 mb-4">Error: {error}</div>
          <button
            onClick={onClose}
            className="px-4 py-2 bg-[#06E4A8] text-black rounded-md hover:bg-[#04c790]"
          >
            Close
          </button>
        </div>
      </div>
    );
  }

  return (
    <PythonEditor
      code={code}
      onChange={setCode}
      onSave={handleDownload}
      onClose={onClose}
      saving={false}
      title="Export Graph as Python"
      readOnly={false}
      saveLabel="Download .py"
      warnings={warnings.length > 0 ? warnings : undefined}
    />
  );
}

