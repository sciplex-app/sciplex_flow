import { useEffect, useState } from 'react';
import { X, Download } from 'lucide-react';

interface DataViewerProps {
  nodeId: string;
  socketId: string;
  onClose: () => void;
}

export default function DataViewer({ nodeId, socketId, onClose }: DataViewerProps) {
  const [data, setData] = useState<any>(null);
  const [dataType, setDataType] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        setError(null);
        
        const response = await fetch(
          `/api/socket-data?node_id=${encodeURIComponent(nodeId)}&socket_id=${encodeURIComponent(socketId)}`
        );
        
        if (!response.ok) {
          const errorData = await response.json().catch(() => ({ detail: response.statusText }));
          throw new Error(errorData.detail || `Failed to load data: ${response.statusText}`);
        }
        
        const result = await response.json();
        if (!result.success) {
          throw new Error('Invalid data received');
        }
        
        setDataType(result.data_type);
        setData(result);
      } catch (err: any) {
        console.error('Error loading data:', err);
        setError(err?.message || 'Failed to load data');
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [nodeId, socketId]);

  // Close on Escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [onClose]);

  const renderContent = () => {
    if (loading) {
      return (
        <div className="flex items-center justify-center h-full">
          <div className="text-gray-400">Loading data...</div>
        </div>
      );
    }

    if (error) {
      return (
        <div className="flex items-center justify-center h-full">
          <div className="text-red-400 text-center p-4">
            <div className="font-semibold mb-2">Error loading data</div>
            <div className="text-sm">{error}</div>
          </div>
        </div>
      );
    }

    if (!data || !dataType) {
      return (
        <div className="flex items-center justify-center h-full">
          <div className="text-gray-400">No data available</div>
        </div>
      );
    }

    // Render based on data type
    switch (dataType) {
      case 'table':
        return renderTable(data.preview);
      case 'dict':
        return renderDict(data.data);
      case 'scalar':
        return renderScalar(data.value, data.type);
      case 'unknown':
        return renderUnknown(data.value, data.type);
      default:
        return <div className="text-gray-400">Unsupported data type: {dataType}</div>;
    }
  };

  const renderTable = (preview: any) => {
    if (!preview || preview.kind !== 'table') {
      return <div className="text-gray-400">Invalid table data</div>;
    }

    return (
      <div className="w-full h-full overflow-auto">
        <div className="mb-4 text-sm text-gray-400">
          Showing {preview.offset + 1}-{Math.min(preview.offset + preview.limit, preview.total_rows)} of {preview.total_rows} rows
          {preview.truncated_cols && ` (${preview.total_cols} total columns, showing first ${preview.columns.length})`}
        </div>
        <div className="overflow-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-white/20">
                {preview.columns.map((col: string, idx: number) => (
                  <th key={idx} className="px-4 py-2 text-left font-semibold text-gray-300 bg-white/5">
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {preview.rows.map((row: any[], rowIdx: number) => (
                <tr key={rowIdx} className="border-b border-white/10 hover:bg-white/5">
                  {row.map((cell: any, cellIdx: number) => (
                    <td key={cellIdx} className="px-4 py-2 text-gray-200">
                      {cell === null || cell === undefined ? (
                        <span className="text-gray-500 italic">null</span>
                      ) : (
                        String(cell)
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  const renderDict = (dictData: Record<string, string>) => {
    return (
      <div className="w-full h-full overflow-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-white/20">
              <th className="px-4 py-2 text-left font-semibold text-gray-300 bg-white/5">Key</th>
              <th className="px-4 py-2 text-left font-semibold text-gray-300 bg-white/5">Value</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(dictData).map(([key, value], idx) => (
              <tr key={idx} className="border-b border-white/10 hover:bg-white/5">
                <td className="px-4 py-2 text-gray-300 font-mono">{key}</td>
                <td className="px-4 py-2 text-gray-200 font-mono text-xs whitespace-pre-wrap break-all">
                  {value}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  const renderScalar = (value: any, type: string) => {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <div className="text-xs text-gray-400 mb-2">Type: {type}</div>
          <div className="text-2xl font-mono text-white break-all">
            {String(value)}
          </div>
        </div>
      </div>
    );
  };

  const renderUnknown = (value: string, type: string) => {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <div className="text-xs text-gray-400 mb-2">Type: {type}</div>
          <div className="text-sm font-mono text-gray-300 break-all whitespace-pre-wrap">
            {value}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div 
      className="fixed inset-0 bg-black/80 flex items-center justify-center z-[200] p-8"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div 
        className="bg-[#1e1e24] rounded-xl border border-white/10 flex flex-col w-full max-w-[90vw] h-full max-h-[90vh] shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-white/10">
          <h2 className="text-xl font-semibold text-white">Data Viewer</h2>
          <div className="flex items-center gap-2">
            {/* Download CSV button (only for table data) */}
            {dataType === 'table' && (
              <a
                href={`/api/preview/csv?node_id=${encodeURIComponent(nodeId)}&socket_id=${encodeURIComponent(socketId)}`}
                target="_blank"
                rel="noreferrer"
                className="
                  px-3 py-1.5 rounded-md
                  bg-white/5 hover:bg-white/10
                  flex items-center gap-2
                  transition-colors
                  text-sm text-gray-300
                "
                title="Download CSV"
              >
                <Download className="w-4 h-4" />
                <span>Download CSV</span>
              </a>
            )}
            <button
              onClick={onClose}
              className="
                w-8 h-8 rounded-md
                bg-white/5 hover:bg-white/10
                flex items-center justify-center
                transition-colors
              "
              title="Close (Esc)"
            >
              <X className="w-4 h-4 text-gray-300" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-hidden p-4">
          {renderContent()}
        </div>
      </div>
    </div>
  );
}

