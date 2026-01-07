import { useEffect, useState } from 'react';
import Plot from 'react-plotly.js';
import { X } from 'lucide-react';

interface PlotViewerProps {
  nodeId: string;
  socketId: string;
  onClose: () => void;
}

export default function PlotViewer({ nodeId, socketId, onClose }: PlotViewerProps) {
  const [plotData, setPlotData] = useState<any>(null);
  const [plotType, setPlotType] = useState<'matplotlib' | 'plotly' | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchPlot = async () => {
      try {
        setLoading(true);
        setError(null);
        
        const response = await fetch(
          `/api/plot?node_id=${encodeURIComponent(nodeId)}&socket_id=${encodeURIComponent(socketId)}`
        );
        
        if (!response.ok) {
          const errorData = await response.json().catch(() => ({ detail: response.statusText }));
          throw new Error(errorData.detail || `Failed to load plot: ${response.statusText}`);
        }
        
        const data = await response.json();
        if (!data.success || !data.figure) {
          throw new Error('Invalid plot data received');
        }
        
        setPlotData(data.figure);
        setPlotType(data.plot_type || 'plotly'); // Store plot type to preserve styling
      } catch (err: any) {
        console.error('Error loading plot:', err);
        setError(err?.message || 'Failed to load plot');
      } finally {
        setLoading(false);
      }
    };

    fetchPlot();
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

  return (
    <div 
      className="fixed inset-0 bg-black/80 flex items-center justify-center z-[200] p-8"
      onClick={(e) => {
        // Close when clicking the backdrop
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
          <h2 className="text-xl font-semibold text-white">Plot Viewer</h2>
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

        {/* Content */}
        <div className="flex-1 overflow-hidden relative">
          {loading && (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="text-gray-400">Loading plot...</div>
            </div>
          )}
          
          {error && (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="text-red-400 text-center p-4">
                <div className="font-semibold mb-2">Error loading plot</div>
                <div className="text-sm">{error}</div>
              </div>
            </div>
          )}
          
          {plotData && !loading && !error && (
            <div className={`w-full h-full p-4 ${plotType === 'matplotlib' ? 'bg-white' : ''}`}>
              <Plot
                data={plotData.data || []}
                layout={plotType === 'matplotlib' ? {
                  // For matplotlib plots, preserve the original styling (white background, black text)
                  ...plotData.layout,
                } : {
                  // For native Plotly plots, apply dark theme
                  ...plotData.layout,
                  paper_bgcolor: plotData.layout?.paper_bgcolor || '#1e1e24',
                  plot_bgcolor: plotData.layout?.plot_bgcolor || '#1e1e24',
                  font: plotData.layout?.font || { color: '#e5e7eb' },
                  xaxis: {
                    ...plotData.layout?.xaxis,
                    gridcolor: plotData.layout?.xaxis?.gridcolor || 'rgba(255, 255, 255, 0.1)',
                  },
                  yaxis: {
                    ...plotData.layout?.yaxis,
                    gridcolor: plotData.layout?.yaxis?.gridcolor || 'rgba(255, 255, 255, 0.1)',
                  },
                }}
                config={{
                  displayModeBar: true,
                  displaylogo: false,
                  modeBarButtonsToRemove: ['lasso2d', 'select2d'],
                  toImageButtonOptions: {
                    format: 'png',
                    filename: 'plot',
                    height: 600,
                    width: 800,
                  },
                }}
                style={{ width: '100%', height: '100%' }}
                useResizeHandler={true}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

