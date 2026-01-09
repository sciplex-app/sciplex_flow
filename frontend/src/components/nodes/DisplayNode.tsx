import { memo, useCallback, useEffect, useMemo, useState, useRef } from 'react';
import { Handle, Position } from '@xyflow/react';
import Plot from 'react-plotly.js';
import { useFlowStore } from '../../store/flowStore';
import { useApi } from '../../hooks/useApi';
import { Play, Table as TableIcon, Hash, TrendingUp, Maximize2, Loader2 } from 'lucide-react';

const SOCKET_SIZE = 7;
const MIN_WIDTH = 200;
const MIN_HEIGHT = 120;
const DEFAULT_WIDTH = 280;
const DEFAULT_HEIGHT = 180;

// PreviewKind type - kept for documentation, values are used in PreviewState union
// type PreviewKind = 'none' | 'loading' | 'error' | 'table' | 'scalar' | 'plot';

interface TablePreview {
  kind: 'table';
  columns: string[];
  rows: any[][];
  total_rows: number;
  total_cols: number;
  offset: number;
  limit: number;
  truncated_rows: boolean;
  truncated_cols: boolean;
}

interface ScalarPreview {
  kind: 'scalar';
  value: unknown;
  type: string;
}

interface PlotPreview {
  kind: 'plot';
  plot_type: 'matplotlib' | 'plotly';
  figure: any;
}

type PreviewState =
  | { kind: 'none' }
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | (TablePreview & { kind: 'table' })
  | (ScalarPreview & { kind: 'scalar' })
  | (PlotPreview & { kind: 'plot' });

function DisplayNode(props: any): JSX.Element {
  const { id, data, selected } = props;
  const nodeData = (data as any)?.nodeData as any;
  const edges = useFlowStore((s) => s.edges);
  const singleNodeExecutionMode = useFlowStore((s) => s.singleNodeExecutionMode);
  const { executeNode } = useApi();

  const [page, setPage] = useState(0);
  const pageSize = 50; // Fetch 50 rows for scrolling
  const [preview, setPreview] = useState<PreviewState>({ kind: 'none' });
  const [isExecuting, setIsExecuting] = useState(false);
  
  // Resizable state - initialize from nodeData if available (for saved/loaded nodes)
  const initialWidth = nodeData?.width || DEFAULT_WIDTH;
  const initialHeight = nodeData?.height || DEFAULT_HEIGHT;
  const [size, setSize] = useState({ width: initialWidth, height: initialHeight });
  const sizeRef = useRef(size); // Keep ref to current size for closures
  const [isResizing, setIsResizing] = useState(false);
  const resizeRef = useRef<{ startX: number; startY: number; startWidth: number; startHeight: number } | null>(null);
  
  // Update ref when size changes
  useEffect(() => {
    sizeRef.current = size;
  }, [size]);
  
  // Update size from nodeData when it changes (e.g., when loading a project)
  useEffect(() => {
    if (nodeData?.width && nodeData?.height) {
      setSize({ width: nodeData.width, height: nodeData.height });
    }
  }, [nodeData?.width, nodeData?.height]);
  
  // Track if plot should be interactive (prevents interference with dragging)
  // Note: These are used in the Plot component (lines 918-949) but TypeScript doesn't detect all usages
   
  const [isPlotInteractive, setIsPlotInteractive] = useState(false);
  const plotInteractionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  
  // Performance optimization: always use thumbnail mode
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null);
  const [thumbnailLoading, setThumbnailLoading] = useState(false);
  const [isInViewport, setIsInViewport] = useState(true); // Track if node is visible
  const nodeRef = useRef<HTMLDivElement>(null);

  const inputSocket = nodeData?.input_sockets?.[0];

  // Find upstream node + socket connected to our input
  const sourceInfo = useMemo(() => {
    if (!inputSocket) return null;
    const edge = edges.find(
      (e) => e.target === id && e.targetHandle === inputSocket.id,
    );
    if (!edge || !edge.source || !edge.sourceHandle) return null;
    return { nodeId: edge.source, socketId: edge.sourceHandle };
  }, [edges, id, inputSocket]);
  
  // Track the previous source to detect source changes
  const prevSourceRef = useRef<{ nodeId: string; socketId: string } | null>(null);
  
  // Clear preview and thumbnail when source disconnects or changes
  useEffect(() => {
    const prevSource = prevSourceRef.current;
    const currentSourceKey = sourceInfo ? `${sourceInfo.nodeId}-${sourceInfo.socketId}` : null;
    const prevSourceKey = prevSource ? `${prevSource.nodeId}-${prevSource.socketId}` : null;
    
    // If source changed or disconnected, clear everything
    if (currentSourceKey !== prevSourceKey) {
      setPreview({ kind: 'none' });
      // Use callback form to avoid dependency on thumbnailUrl
      setThumbnailUrl((currentUrl) => {
        if (currentUrl) {
          URL.revokeObjectURL(currentUrl);
        }
        return null;
      });
    }
    
    prevSourceRef.current = sourceInfo;
  }, [sourceInfo]);
  
  // Listen for reset event from toolbar to clear preview
  useEffect(() => {
    const handleReset = () => {
      setPreview({ kind: 'none' });
      setThumbnailUrl((currentUrl) => {
        if (currentUrl) {
          URL.revokeObjectURL(currentUrl);
        }
        return null;
      });
      // Reset thumbnail loading state
      thumbnailLoadingRef.current = false;
      thumbnailSourceKeyRef.current = null;
    };
    
    window.addEventListener('resetDisplayNodes', handleReset);
    return () => {
      window.removeEventListener('resetDisplayNodes', handleReset);
    };
  }, []);
  
  // Cleanup plot interaction timeout on unmount
  useEffect(() => {
    return () => {
      if (plotInteractionTimeoutRef.current) {
        clearTimeout(plotInteractionTimeoutRef.current);
      }
      // Cleanup thumbnail URL
      if (thumbnailUrl) {
        URL.revokeObjectURL(thumbnailUrl);
      }
    };
  }, [thumbnailUrl]);

  // Viewport detection using Intersection Observer (only render visible plots)
  useEffect(() => {
    if (!nodeRef.current) return;
    
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          setIsInViewport(entry.isIntersecting);
        });
      },
      {
        root: null,
        rootMargin: '100px', // Start loading 100px before entering viewport
        threshold: 0.1, // Trigger when 10% visible
      }
    );
    
    observer.observe(nodeRef.current);
    
    return () => {
      if (nodeRef.current) {
        observer.unobserve(nodeRef.current);
      }
    };
  }, []);

  // Reset thumbnail when plot figure changes
  // Create a hash-like key from figure data to detect changes (including colors, layout, etc.)
  const figureKeyRef = useRef<string | null>(null);
  const [figureKeyVersion, setFigureKeyVersion] = useState(0); // Used to trigger thumbnail reload
  
  // Load thumbnail when plot data is available
  const thumbnailLoadingRef = useRef(false);
  const thumbnailSourceKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (preview.kind === 'plot' && sourceInfo && isInViewport && !thumbnailLoadingRef.current) {
      // Create a key that identifies the current data source + figure state
      const currentSourceKey = `${sourceInfo.nodeId}-${sourceInfo.socketId}-${figureKeyRef.current || 'no-figure'}`;
      
      // Only skip if we have a thumbnail for this exact source and figure state
      if (thumbnailUrl && thumbnailSourceKeyRef.current === currentSourceKey) {
        return;
      }
      
      thumbnailLoadingRef.current = true;
      setThumbnailLoading(true);
      thumbnailSourceKeyRef.current = currentSourceKey;
      
      const thumbnailParams = new URLSearchParams({
        node_id: sourceInfo.nodeId,
        socket_id: sourceInfo.socketId,
        width: String(Math.max(200, size.width * 2)), // 2x for retina, min 200px
        height: String(Math.max(150, size.height * 2)),
        scale: '1.0',
        // Add cache-busting parameter based on figure key version to ensure fresh fetch on refresh
        _v: String(figureKeyVersion),
      });
      
      // Fetch thumbnail
      fetch(`/api/plot/thumbnail?${thumbnailParams.toString()}`)
        .then((res) => {
          if (!res.ok) {
            // If 503 (service unavailable, e.g., kaleido missing), log warning
            if (res.status === 503) {
              console.warn('Thumbnail generation not available (kaleido may be missing).');
            }
            throw new Error(`Failed to load thumbnail: ${res.status}`);
          }
          return res.blob();
        })
        .then((blob) => {
          const url = URL.createObjectURL(blob);
          // Revoke old URL if exists
          if (thumbnailUrl) {
            URL.revokeObjectURL(thumbnailUrl);
          }
          setThumbnailUrl(url);
          setThumbnailLoading(false);
          thumbnailLoadingRef.current = false;
        })
        .catch((err) => {
          console.error('Error loading thumbnail:', err);
          setThumbnailLoading(false);
          thumbnailLoadingRef.current = false;
          thumbnailSourceKeyRef.current = null; // Reset on error so it can retry
        });
    }
  }, [preview.kind, sourceInfo, size.width, size.height, isInViewport, thumbnailUrl, figureKeyVersion, preview.kind === 'plot' ? preview.figure : null]);

  // Reset thumbnail when plot figure changes
  useEffect(() => {
    if (preview.kind === 'plot' && preview.figure) {
      // Create a key that captures data, layout, and trace properties (including colors)
      // This will detect changes in colors, markers, lines, etc.
      const figureData = preview.figure.data || [];
      const layout = preview.figure.layout || {};
      
      // Extract key properties from each trace that might change (colors, markers, etc.)
      const traceKeys = figureData.map((trace: any) => ({
        type: trace.type,
        marker: trace.marker ? JSON.stringify(trace.marker) : null,
        line: trace.line ? JSON.stringify(trace.line) : null,
        fillcolor: trace.fillcolor,
        name: trace.name,
      }));
      
      // Also include layout properties that affect appearance
      const layoutKey = {
        title: layout.title || '',
        paper_bgcolor: layout.paper_bgcolor,
        plot_bgcolor: layout.plot_bgcolor,
        xaxis: layout.xaxis ? { title: layout.xaxis.title } : null,
        yaxis: layout.yaxis ? { title: layout.yaxis.title } : null,
      };
      
      const newKey = JSON.stringify({
        plotType: preview.plot_type,
        traceKeys,
        layoutKey,
      });
      
      if (figureKeyRef.current !== null && figureKeyRef.current !== newKey) {
        // Figure changed, clear thumbnail to force reload
        if (thumbnailUrl) {
          URL.revokeObjectURL(thumbnailUrl);
          setThumbnailUrl(null);
        }
        thumbnailLoadingRef.current = false;
        thumbnailSourceKeyRef.current = null; // Reset source key to force reload
        setFigureKeyVersion(v => v + 1); // Trigger thumbnail reload
      }
      
      figureKeyRef.current = newKey;
    }
  }, [preview.kind, preview.kind === 'plot' ? (preview as Extract<PreviewState, { kind: 'plot' }>).figure : null, preview.kind === 'plot' ? (preview as Extract<PreviewState, { kind: 'plot' }>).plot_type : null, thumbnailUrl]);

  // Track the last fetched data to prevent unnecessary re-fetches
  const lastFetchedRef = useRef<{ nodeId: string; socketId: string; page: number } | null>(null);
  const isFetchingRef = useRef(false);

  // Helper to clear thumbnail state (only used for plots)
  const clearThumbnailState = useCallback(() => {
    setThumbnailUrl((currentUrl) => {
      if (currentUrl) {
        URL.revokeObjectURL(currentUrl);
      }
      return null;
    });
    thumbnailLoadingRef.current = false;
    thumbnailSourceKeyRef.current = null;
    figureKeyRef.current = null;
    setFigureKeyVersion(v => v + 1);
  }, []);

  // Fetch preview data - called on explicit execution
  const fetchPreview = useCallback(async (clearThumbnail = true) => {
    if (!sourceInfo) {
      setPreview({ kind: 'none' });
      lastFetchedRef.current = null;
      return;
    }

    // Prevent concurrent fetches
    if (isFetchingRef.current) {
      return; // Already fetching, skip
    }
    
    isFetchingRef.current = true;
    setPreview({ kind: 'loading' });

    try {
      // For tables, use preview endpoint with pagination
      // For plots and other types, use socket-data endpoint
      // First check what type of data it is
      const checkParams = new URLSearchParams({
        node_id: sourceInfo.nodeId,
        socket_id: sourceInfo.socketId,
      });

      const checkResp = await fetch(`/api/socket-data?${checkParams.toString()}`);
      if (!checkResp.ok) {
        // Handle 400 (Bad Request) gracefully - likely means no data available
        if (checkResp.status === 400) {
          setPreview({ kind: 'none' });
          lastFetchedRef.current = null;
          isFetchingRef.current = false;
          return;
        }
        const err = await checkResp.json().catch(() => ({}));
        throw new Error(err.detail || 'Failed to load data');
      }

      const result = await checkResp.json();
      if (!result.success) {
        throw new Error('Invalid data received');
      }

      // Handle different data types
      if (result.data_type === 'plot') {
        // Clear thumbnail state only for plots and only if requested
        if (clearThumbnail) {
          clearThumbnailState();
        }
        setPreview({
          kind: 'plot',
          plot_type: result.plot_type,
          figure: result.figure,
        });
        lastFetchedRef.current = { nodeId: sourceInfo.nodeId, socketId: sourceInfo.socketId, page };
      } else if (result.data_type === 'table') {
        // For tables, fetch with pagination using preview endpoint
        const previewParams = new URLSearchParams({
          node_id: sourceInfo.nodeId,
          socket_id: sourceInfo.socketId,
          offset: String(page * pageSize),
          limit: String(pageSize),
        });
        const previewResp = await fetch(`/api/preview?${previewParams.toString()}`);
        if (!previewResp.ok) {
          const err = await previewResp.json().catch(() => ({}));
          throw new Error(err.detail || 'Failed to load preview');
        }
        const previewJson = await previewResp.json();
        if (previewJson.kind === 'table') {
          setPreview(previewJson as TablePreview);
          lastFetchedRef.current = { nodeId: sourceInfo.nodeId, socketId: sourceInfo.socketId, page };
        } else {
          setPreview({ kind: 'error', message: 'Expected table data' });
        }
      } else if (result.data_type === 'scalar') {
        setPreview({
          kind: 'scalar',
          value: result.value,
          type: result.type,
        });
        lastFetchedRef.current = { nodeId: sourceInfo.nodeId, socketId: sourceInfo.socketId, page };
      } else {
        setPreview({ kind: 'error', message: `Unsupported data type: ${result.data_type}` });
      }
    } catch (e: any) {
      // Don't show error for 400 responses (no data available) - just show "none" state
      if (e?.message?.includes('400') || e?.message?.includes('Bad Request')) {
        setPreview({ kind: 'none' });
      } else {
        setPreview({ kind: 'error', message: e?.message || 'Preview failed' });
      }
    } finally {
      isFetchingRef.current = false;
    }
  }, [sourceInfo, page, pageSize, clearThumbnailState]);

  // Execute Display node handler - executes the node and fetches preview
  const handleExecute = useCallback(async () => {
    if (isExecuting) return;
    
    setIsExecuting(true);
    try {
      // Execute the Display node (this will also execute upstream nodes if needed)
      await executeNode(id, singleNodeExecutionMode);
      // After execution, fetch the preview data (clear thumbnail for fresh plot)
      await fetchPreview(true);
    } catch (error) {
      console.error('Error executing Display node:', error);
    } finally {
      setIsExecuting(false);
    }
  }, [id, singleNodeExecutionMode, executeNode, fetchPreview, isExecuting]);

  // Track the previous page to detect actual page changes
  const prevPageRef = useRef(page);
  
  // Fetch table page when page changes - only for tables with actual page changes
  useEffect(() => {
    // Only fetch if page actually changed (not just effect re-running)
    if (prevPageRef.current !== page) {
      prevPageRef.current = page;
      if (sourceInfo && preview.kind === 'table') {
        // Don't clear thumbnail for table pagination
        fetchPreview(false).catch(console.error);
      }
    }
  }, [page, sourceInfo, preview.kind, fetchPreview]);

  // Listen for graph execution completed event to refresh preview
  useEffect(() => {
    const handleGraphExecutionCompleted = () => {
      // Only fetch if we have a source connected
      if (sourceInfo) {
        fetchPreview(true).catch(console.error);
      }
    };
    
    window.addEventListener('graphExecutionCompleted', handleGraphExecutionCompleted);
    return () => {
      window.removeEventListener('graphExecutionCompleted', handleGraphExecutionCompleted);
    };
  }, [sourceInfo, fetchPreview]);

  const canPrev =
    preview.kind === 'table' ? preview.offset > 0 : page > 0;
  const canNext =
    preview.kind === 'table'
      ? preview.offset + preview.limit < preview.total_rows
      : false;

  // Handler to open in bigger view (works for all types)
  const handleOpenBiggerView = useCallback(() => {
    if (sourceInfo) {
      const event = new CustomEvent('openDataViewer', { 
        detail: { nodeId: sourceInfo.nodeId, socketId: sourceInfo.socketId }
      });
      window.dispatchEvent(event);
    }
  }, [sourceInfo]);

  // Border color based on execution state (solid border)
  const borderColor = '#3f3f46'; // default border for Display nodes
  
  // Selection outline (dashed blue border, shown on top of execution border)
  const selectionStyle = useMemo(() => {
    if (!selected) return {};
    return {
      outline: '2px dashed #3b82f6',
      outlineOffset: '2px',
    };
  }, [selected]);

  // Resize handlers
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsResizing(true);
    resizeRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      startWidth: size.width,
      startHeight: size.height,
    };

    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (!resizeRef.current) return;
      const deltaX = moveEvent.clientX - resizeRef.current.startX;
      const deltaY = moveEvent.clientY - resizeRef.current.startY;
      setSize({
        width: Math.max(MIN_WIDTH, resizeRef.current.startWidth + deltaX),
        height: Math.max(MIN_HEIGHT, resizeRef.current.startHeight + deltaY),
      });
    };

    const handleMouseUp = () => {
      setIsResizing(false);
      const currentSize = sizeRef.current; // Use ref to get latest size
      resizeRef.current = null;
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      
      // Save size to backend after resize completes
      fetch(`/api/nodes/${id}/size`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          width: currentSize.width,
          height: currentSize.height,
        }),
      }).catch((error) => {
        console.error('Error saving Display node size:', error);
      });
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [size]);

  return (
    <div
      ref={nodeRef}
      className="bg-[#121218] rounded-lg shadow-sm flex flex-col overflow-hidden relative"
      style={{ 
        width: size.width, 
        height: size.height,
        border: `1.5px solid ${borderColor}`,
        transition: isResizing ? 'none' : 'border-color 0.2s, outline 0.2s',
        ...selectionStyle,
      }}
    >
      {/* Input handle (left side) */}
      {inputSocket && (
        <Handle
          type="target"
          position={Position.Left}
          id={inputSocket.id}
          className="!bg-[#4a4a52] !border !border-[#06E4A8] hover:!bg-[#06E4A8] !transition-colors"
          style={{
            top: '50%',
            transform: 'translateY(-50%)',
            width: SOCKET_SIZE,
            height: SOCKET_SIZE,
          }}
        />
      )}

      {/* Header */}
      <div className="flex items-center justify-between px-2 py-1.5 border-b border-[#27272f] bg-[#181821]">
        <div className="flex items-center gap-1.5">
          <div className="w-4 h-4 rounded bg-[#06E4A8] flex items-center justify-center">
            {preview.kind === 'plot' ? (
              <TrendingUp className="w-3 h-3 text-white" />
            ) : (
              <TableIcon className="w-3 h-3 text-white" />
            )}
          </div>
          <span className="text-[11px] font-medium text-gray-100">
            Display
          </span>
        </div>
        <div className="flex items-center gap-1">
          {/* Open in bigger view button (for all types) */}
          {sourceInfo && (
            <button
              onClick={handleOpenBiggerView}
              className="p-1 rounded hover:bg-white/10 text-gray-300"
              title="Full screen view"
            >
              <Maximize2 className="w-3 h-3" />
            </button>
          )}
          {/* Execute button */}
          <button
            onClick={handleExecute}
            disabled={isExecuting || !sourceInfo}
            className={`p-1 rounded text-gray-300 ${isExecuting || !sourceInfo ? 'opacity-50 cursor-not-allowed' : 'hover:bg-white/10'}`}
            title="Execute"
          >
            {isExecuting ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <Play className="w-3 h-3" />
            )}
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden relative">
        {!sourceInfo && (
          <div className="h-full flex items-center justify-center px-2 py-1.5">
            <p className="text-[11px] text-gray-500 text-center px-2">
              Connect a node output to this Display node to see data.
            </p>
          </div>
        )}

        {sourceInfo && preview.kind === 'none' && (
          <div className="h-full flex items-center justify-center px-2 py-1.5">
            <p className="text-[11px] text-gray-500 text-center px-2">
              Click the play button to execute and display data.
            </p>
          </div>
        )}

        {sourceInfo && preview.kind === 'loading' && (
          <div className="h-full flex items-center justify-center px-2 py-1.5">
            <p className="text-[11px] text-gray-400">Loading…</p>
          </div>
        )}

        {sourceInfo && preview.kind === 'error' && (
          <div className="h-full flex items-center justify-center px-2 py-1.5">
            <p className="text-[11px] text-red-400 text-center px-2">
              {preview.message}
            </p>
          </div>
        )}

        {sourceInfo && preview.kind === 'scalar' && (
          <div className="h-full flex flex-col items-center justify-center gap-1 px-2 py-1.5">
            <Hash className="w-4 h-4 text-gray-500" />
            <div className="text-xl font-semibold text-white break-all text-center">
              {String(preview.value)}
            </div>
            <div className="text-[10px] text-gray-500">
              {preview.type}
            </div>
          </div>
        )}

        {sourceInfo && preview.kind === 'plot' && (
          (() => {
            // Validate figure data before rendering
            if (!preview.figure || !preview.figure.data || !Array.isArray(preview.figure.data)) {
              return (
                <div className="h-full flex items-center justify-center px-2 py-1.5">
                  <p className="text-[11px] text-red-400 text-center px-2">
                    Invalid plot data
                  </p>
                </div>
              );
            }

            // Always show thumbnail mode for performance
            if (thumbnailLoading) {
              return (
                <div className="h-full flex items-center justify-center px-2 py-1.5">
                  <p className="text-[11px] text-gray-400">Loading preview...</p>
                </div>
              );
            }

            if (!isInViewport) {
              return (
                <div className="h-full flex items-center justify-center px-2 py-1.5">
                  <p className="text-[11px] text-gray-500 text-center px-2">
                    Scroll to view
                  </p>
                </div>
              );
            }

            if (thumbnailUrl) {
              return (
                <div className="relative h-full w-full">
                  <img
                    src={thumbnailUrl}
                    alt="Plot preview"
                    className="w-full h-full object-contain"
                    style={{ imageRendering: 'auto' }}
                  />
                </div>
              );
            }

            // Fallback: show message if thumbnail failed to load
            return (
              <div className="h-full flex items-center justify-center px-2 py-1.5">
                <p className="text-[11px] text-gray-500 text-center px-2">
                  Preview unavailable
                </p>
              </div>
            );
          })()
        )}

        {sourceInfo && preview.kind === 'table' && (
          <div className="flex flex-col h-full gap-1">
            <div className="flex-1 overflow-auto border border-[#27272f] rounded bg-[#08080c]">
              <table className="min-w-full border-collapse text-[10px]">
                <thead className="sticky top-0 bg-[#181821]">
                  <tr>
                    {preview.columns.map((col) => (
                      <th
                        key={col}
                        className="px-2 py-1 text-left font-medium text-gray-300 border-b border-[#27272f]"
                      >
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.map((row, rowIndex) => (
                    <tr
                      key={rowIndex}
                      className={
                        rowIndex % 2 === 0
                          ? 'bg-[#08080c]'
                          : 'bg-[#101018]'
                      }
                    >
                      {row.map((cell, colIndex) => (
                        <td
                          key={colIndex}
                          className="px-2 py-0.5 text-gray-200 border-b border-[#15151b] whitespace-nowrap"
                        >
                          {cell === null || cell === undefined
                            ? ''
                            : String(cell)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Footer / Paging info */}
            <div className="flex items-center justify-between mt-0.5">
              <div className="text-[10px] text-gray-500">
                {preview.total_rows > 0 ? (
                  <>
                    Rows{' '}
                    <span className="text-gray-300">
                      {preview.offset + 1}-
                      {Math.min(
                        preview.offset + preview.limit,
                        preview.total_rows,
                      )}
                    </span>{' '}
                    of{' '}
                    <span className="text-gray-300">
                      {preview.total_rows}
                    </span>
                    {preview.truncated_cols && (
                      <span className="ml-1 text-yellow-400">
                        (columns truncated)
                      </span>
                    )}
                  </>
                ) : (
                  'No rows'
                )}
              </div>
              <div className="flex items-center gap-1">
                <button
                  disabled={!canPrev}
                  onClick={() => canPrev && setPage((p) => Math.max(0, p - 1))}
                  className={`px-2 py-0.5 rounded text-[10px] border border-[#27272f] ${
                    canPrev
                      ? 'text-gray-200 hover:bg-white/5'
                      : 'text-gray-600 cursor-default'
                  }`}
                >
                  Prev
                </button>
                <button
                  disabled={!canNext}
                  onClick={() => canNext && setPage((p) => p + 1)}
                  className={`px-2 py-0.5 rounded text-[10px] border border-[#27272f] ${
                    canNext
                      ? 'text-gray-200 hover:bg-white/5'
                      : 'text-gray-600 cursor-default'
                  }`}
                >
                  Next
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Resize handle - nodrag/nopan prevents React Flow from dragging the node */}
      <div
        className="nodrag nopan absolute bottom-0 right-0 w-4 h-4 cursor-se-resize group"
        onMouseDown={handleResizeStart}
        style={{ zIndex: 10 }}
      >
        {/* Diagonal lines for resize grip */}
        <svg
          className="w-full h-full text-gray-500 group-hover:text-gray-300 transition-colors"
          viewBox="0 0 16 16"
          fill="none"
        >
          <path
            d="M14 2L2 14M14 6L6 14M14 10L10 14"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      </div>
    </div>
  );
}

// Separate component for plot rendering to isolate errors (currently unused - may be used in future)
 
function _PlotRenderer({ 
  figure, 
  plotType, 
  isPlotInteractive, 
  setIsPlotInteractive, 
  plotInteractionTimeoutRef 
}: {
  figure: any;
  plotType: 'matplotlib' | 'plotly';
  isPlotInteractive: boolean;
  setIsPlotInteractive: (value: boolean) => void;
  plotInteractionTimeoutRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>;
}) {
  const [plotError, setPlotError] = useState<string | null>(null);

  const plotLayout = useMemo(() => {
    try {
      if (!figure || !figure.layout) {
        return {
          autosize: true,
          paper_bgcolor: plotType === 'matplotlib' ? 'white' : '#121218',
          plot_bgcolor: plotType === 'matplotlib' ? 'white' : '#121218',
        };
      }

      const baseLayout = plotType === 'matplotlib' ? {
        // For matplotlib plots, preserve the original styling (white background, black text)
        ...figure.layout,
      } : {
        // For native Plotly plots, apply dark theme to match Display node background
        ...figure.layout,
        paper_bgcolor: figure.layout?.paper_bgcolor || '#121218',
        plot_bgcolor: figure.layout?.plot_bgcolor || '#121218',
        font: figure.layout?.font || { color: '#e5e7eb', size: 10 },
        margin: figure.layout?.margin || { l: 40, r: 20, t: 20, b: 40 },
        xaxis: {
          ...(figure.layout?.xaxis || {}),
          gridcolor: figure.layout?.xaxis?.gridcolor || 'rgba(255, 255, 255, 0.1)',
        },
        yaxis: {
          ...(figure.layout?.yaxis || {}),
          gridcolor: figure.layout?.yaxis?.gridcolor || 'rgba(255, 255, 255, 0.1)',
        },
      };
      // Ensure autosize is true and remove fixed dimensions
      return {
        ...baseLayout,
        autosize: true,
        width: undefined,
        height: undefined,
      };
    } catch (e) {
      console.error('Error calculating plot layout:', e);
      setPlotError(e instanceof Error ? e.message : 'Layout calculation failed');
      return {
        autosize: true,
        paper_bgcolor: plotType === 'matplotlib' ? 'white' : '#121218',
        plot_bgcolor: plotType === 'matplotlib' ? 'white' : '#121218',
      };
    }
  }, [figure, plotType]);

  // Reset error when figure changes
  useEffect(() => {
    setPlotError(null);
  }, [figure]);

  if (plotError) {
    return (
      <div className="h-full flex items-center justify-center px-2 py-1.5">
        <p className="text-[11px] text-red-400 text-center px-2">
          Plot error: {plotError}
        </p>
      </div>
    );
  }

  if (!figure || !figure.data || !Array.isArray(figure.data) || figure.data.length === 0) {
    return (
      <div className="h-full flex items-center justify-center px-2 py-1.5">
        <p className="text-[11px] text-gray-400 text-center px-2">
          No plot data available
        </p>
      </div>
    );
  }

  try {
    return (
      <div 
        className={`absolute inset-0 ${plotType === 'matplotlib' ? 'bg-white' : ''}`}
        style={{ pointerEvents: isPlotInteractive ? 'auto' : 'none' }}
        onMouseEnter={() => {
          // Enable interaction when mouse enters plot area
          if (plotInteractionTimeoutRef.current) {
            clearTimeout(plotInteractionTimeoutRef.current);
          }
          setIsPlotInteractive(true);
        }}
        onMouseLeave={() => {
          // Disable interaction after a short delay to allow for smooth transitions
          if (plotInteractionTimeoutRef.current) {
            clearTimeout(plotInteractionTimeoutRef.current);
          }
          plotInteractionTimeoutRef.current = setTimeout(() => {
            setIsPlotInteractive(false);
          }, 100);
        }}
      >
        <Plot
          data={figure.data}
          layout={plotLayout}
          config={{
            displayModeBar: false,
            responsive: true,
            staticPlot: !isPlotInteractive, // Disable interactivity when not hovering
            doubleClick: false, // Disable double-click reset
            toImageButtonOptions: {
              format: 'png',
              filename: 'plot',
            },
            // Performance optimizations
            scrollZoom: isPlotInteractive, // Only allow zoom when interactive
            modeBarButtonsToRemove: ['lasso2d', 'select2d'], // Remove expensive selection tools
          }}
          style={{ width: '100%', height: '100%' }}
          useResizeHandler={false} // Disable resize handler to prevent performance issues
          revision={0} // Prevent unnecessary re-renders
        />
      </div>
    );
  } catch (e) {
    console.error('Error rendering Plot component:', e);
    return (
      <div className="h-full flex items-center justify-center px-2 py-1.5">
        <p className="text-[11px] text-red-400 text-center px-2">
          Failed to render plot: {e instanceof Error ? e.message : 'Unknown error'}
        </p>
      </div>
    );
  }
}

export default memo(DisplayNode);



