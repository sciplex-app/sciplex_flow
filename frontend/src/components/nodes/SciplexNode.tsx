import { memo, useMemo, useState, useEffect } from 'react';
import { Handle, Position } from '@xyflow/react';
import { Play, Settings, Code } from 'lucide-react';
import { useFlowStore } from '../../store/flowStore';
import { useApi } from '../../hooks/useApi';

// Accent color for the icon background
const ACCENT_COLOR = '#06E4A8';

// Node dimensions (compact)
const NODE_WIDTH = 150;
const NODE_BASE_HEIGHT = 36;
const SOCKET_SPACING = 14;
const ICON_SIZE = 22;
const SOCKET_SIZE = 7;

function SciplexNode(props: any): JSX.Element {
  const { id, data, selected } = props;
  const nodeData = (data as any)?.nodeData as any;
  const executingNodeId = useFlowStore((s) => s.executingNodeId);
  const [iconError, setIconError] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [isButtonsHovered, setIsButtonsHovered] = useState(false);
  const setSelectedNode = useFlowStore((s) => s.setSelectedNode);
  const selectNodeInFlow = useFlowStore((s) => s.selectNodeInFlow);
  const setPropertiesPanelOpen = useFlowStore((s) => s.setPropertiesPanelOpen);
  const singleNodeExecutionMode = useFlowStore((s) => s.singleNodeExecutionMode);
  const { executeNode } = useApi();
  
  // Safety check - render placeholder if nodeData is missing
  if (!nodeData) {
    return (
      <div 
        className="bg-[#2d2d35] rounded-lg flex items-center justify-center text-red-400 text-xs"
        style={{ width: NODE_WIDTH, height: NODE_BASE_HEIGHT }}
      >
        Error
      </div>
    );
  }
  
  const isExecuting = executingNodeId === id;
  
  // Safely get arrays
  const inputSockets = nodeData.input_sockets || [];
  const outputSockets = nodeData.output_sockets || [];
  
  // Check if node has "op" parameter (makes it quadratic/square)
  const hasOpParameter = nodeData.parameters && 'op' in nodeData.parameters;
  const opValue = hasOpParameter ? (nodeData.parameters.op?.value as unknown) : null;
  
  // Border color based on execution state (solid border)
  const borderColor = useMemo(() => {
    if (isExecuting) return '#3b82f6'; // blue - executing
    if (nodeData.executed && !nodeData.failed) return '#22c55e'; // green - success
    if (nodeData.failed) return '#ef4444'; // red - failed
    return '#3f3f46'; // default border
  }, [isExecuting, nodeData.executed, nodeData.failed]);
  
  // Selection outline (dashed blue border, shown on top of execution border)
  const selectionStyle = useMemo(() => {
    if (!selected) return {};
    return {
      outline: '2px dashed #3b82f6',
      outlineOffset: '2px',
    };
  }, [selected]);

  // Calculate node dimensions
  const socketCount = Math.max(inputSockets.length, outputSockets.length, 1);
  // Calculate height based on socket count (same for all nodes)
  const calculatedHeight = Math.max(NODE_BASE_HEIGHT, socketCount * SOCKET_SPACING + 22);
  // For op parameter nodes, make it square (width = height)
  // For normal nodes, use standard width
  const nodeHeight = calculatedHeight;
  const nodeWidth = hasOpParameter ? calculatedHeight : NODE_WIDTH;

  // Icon URL - use op value as icon if op parameter exists, otherwise use node icon
  // Use _black variant for flow nodes (matching desktop behavior)
  // For op parameter nodes, don't try to load icon - just show text directly
  const iconName = hasOpParameter && opValue ? String(opValue) : (nodeData.icon as string);
  const iconUrl = (hasOpParameter && opValue) ? null : (iconName ? `/api/icons/${iconName}?variant=_black` : null);
  
  // For op parameter nodes, always show text (skip icon loading)
  // Reset icon error when icon name changes for non-op nodes
  useEffect(() => {
    if (!hasOpParameter) {
      setIconError(false);
    } else {
      // For op nodes, always use text (set error immediately)
      setIconError(true);
    }
  }, [iconName, hasOpParameter]);
  
  // Fallback text for icon
  // For op parameter nodes, show full value; for others, show first 2 chars
  const fallbackText = hasOpParameter && opValue
    ? String(opValue) // Show full op value (e.g., "True", "False", "+", "-")
    : iconName 
      ? iconName.slice(0, 2).toUpperCase() 
      : String(nodeData.title || 'N').slice(0, 2).toUpperCase();
  
  // Calculate font size to fit text in icon box for op parameter nodes
  const getOpTextFontSize = (text: string): number => {
    if (!hasOpParameter || !opValue) return 8; // Default for non-op nodes
    const textLength = text.length;
    const maxWidth = ICON_SIZE - 4; // Account for padding
    // Estimate: each character is roughly 0.6 * font-size wide
    // So font-size = maxWidth / (textLength * 0.6)
    const estimatedSize = maxWidth / (textLength * 0.6);
    // Clamp between 5px (minimum readable) and 8px (maximum)
    return Math.max(5, Math.min(8, estimatedSize));
  };
  
  const opTextFontSize = hasOpParameter && opValue ? getOpTextFontSize(String(opValue)) : 8;

  // Check if this is a script node
  const isScriptNode = nodeData.is_script || 
    (nodeData.parameters && 'function' in nodeData.parameters && 
     nodeData.parameters.function?.widget === 'codeeditor');

  // Show buttons when hovered, buttons are hovered, or selected
  const showButtons = isHovered || isButtonsHovered || selected;

  // Button handlers
  const handleExecute = (e: React.MouseEvent) => {
    e.stopPropagation();
    // Select the node when clicking execute button
    selectNodeInFlow(String(id));
    setSelectedNode(String(id));
    executeNode(String(id), singleNodeExecutionMode).catch(console.error);
  };

  const handleConfig = (e: React.MouseEvent) => {
    e.stopPropagation();
    // Select the node in React Flow and in our store
    selectNodeInFlow(String(id));
    setSelectedNode(String(id));
    setPropertiesPanelOpen(true);
  };

  const handleScriptEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    // Get the script code from the node data
    const nodeData = (data as any)?.nodeData;
    if (!nodeData) return;
    const functionParam = nodeData.parameters?.function;
    // Extract code value - handle both object with value property and direct value
    let code = '';
    if (functionParam) {
      if (typeof functionParam === 'object' && 'value' in functionParam) {
        code = functionParam.value ? String(functionParam.value) : '';
      } else {
        code = String(functionParam);
      }
    }
    
    // Dispatch custom event to open script editor dialog
    const event = new CustomEvent('openScriptEditor', { 
      detail: { nodeId: String(id), code: String(code) }
    });
    window.dispatchEvent(event);
  };

  return (
    <div className="relative">
      {/* Invisible hover bridge - connects buttons to node */}
      {showButtons && (
        <div
          className="absolute pointer-events-auto"
          style={{
            left: '50%',
            top: -32,
            width: Math.max(120, nodeWidth),
            height: 40,
            transform: 'translateX(-50%)',
            zIndex: 5,
          }}
          onMouseEnter={() => {
            setIsHovered(true);
            setIsButtonsHovered(true);
          }}
          onMouseLeave={() => {
            setIsHovered(false);
            setIsButtonsHovered(false);
          }}
        />
      )}
      
      {/* Hover buttons - positioned above the node */}
      {showButtons && (
        <div 
          className="absolute flex items-center gap-1.5 z-10 pointer-events-auto"
          style={{
            left: '50%',
            top: -32,
            transform: 'translateX(-50%)',
          }}
          onMouseEnter={() => {
            setIsButtonsHovered(true);
            setIsHovered(true);
          }}
          onMouseLeave={() => setIsButtonsHovered(false)}
        >
          {/* Config/Properties button */}
          <button
            onClick={handleConfig}
            className="
              w-7 h-7 rounded-md
              bg-[#06E4A8] hover:bg-[#04c790]
              flex items-center justify-center
              transition-colors shadow-lg
              border border-[#06E4A8]/20
            "
            title="Properties"
          >
            <Settings className="w-3.5 h-3.5 text-black" />
          </button>

          {/* Script Edit button (only for script nodes) */}
          {isScriptNode && (
            <button
              onClick={handleScriptEdit}
              className="
                w-7 h-7 rounded-md
                bg-[#06E4A8] hover:bg-[#04c790]
                flex items-center justify-center
                transition-colors shadow-lg
                border border-[#06E4A8]/20
              "
              title="Edit Code"
            >
              <Code className="w-4 h-4 text-black" />
            </button>
          )}

          {/* Execute button */}
          <button
            onClick={handleExecute}
            className="
              w-7 h-7 rounded-md
              bg-[#06E4A8] hover:bg-[#04c790]
              flex items-center justify-center
              transition-colors shadow-lg
              border border-[#06E4A8]/20
            "
            title="Execute"
          >
            <Play className="w-3.5 h-3.5 text-black" />
          </button>
        </div>
      )}
      
      {/* Node container */}
      <div
        className="bg-[#2d2d35] rounded-lg relative pointer-events-auto"
        style={{ 
          width: nodeWidth,
          height: nodeHeight,
          border: `1.5px solid ${borderColor}`,
          transition: 'border-color 0.2s, outline 0.2s',
          ...selectionStyle,
        }}
        onMouseEnter={() => {
          setIsHovered(true);
          setIsButtonsHovered(true);
        }}
        onMouseLeave={() => {
          setIsHovered(false);
          setIsButtonsHovered(false);
        }}
      >
        {/* Icon box - centered if op parameter, otherwise left side */}
        <div 
        className={`absolute top-1/2 -translate-y-1/2 rounded flex items-center justify-center overflow-hidden ${
          hasOpParameter ? 'left-1/2 -translate-x-1/2' : 'left-[6px]'
        }`}
        style={{ 
          width: ICON_SIZE, 
          height: ICON_SIZE, 
          backgroundColor: ACCENT_COLOR 
        }}
      >
        {iconUrl && !iconError ? (
          <img 
            src={iconUrl} 
            alt={iconName || String(nodeData.icon || '')}
            className="object-contain"
            style={{ width: ICON_SIZE - 6, height: ICON_SIZE - 6 }}
            onError={() => setIconError(true)}
          />
        ) : (
          <span 
            className="font-bold text-black text-center"
            style={{ 
              fontSize: hasOpParameter && opValue ? `${opTextFontSize}px` : '8px',
              lineHeight: '1',
              padding: '0 2px',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              maxWidth: hasOpParameter ? ICON_SIZE : 'auto',
              display: 'block',
              width: hasOpParameter ? ICON_SIZE : 'auto'
            }}
          >
            {fallbackText}
          </span>
        )}
      </div>
      
      {/* Title - hidden if op parameter */}
      {!hasOpParameter && (
        <div 
          className="absolute top-1/2 -translate-y-1/2 pr-1"
          style={{ left: ICON_SIZE + 12 }}
        >
          <span 
            className="text-gray-200 font-medium truncate block"
            style={{ fontSize: '10px', maxWidth: nodeWidth - ICON_SIZE - 20 }}
          >
            {String(nodeData.title || 'Node')}
          </span>
        </div>
      )}
      
      {/* Input sockets (left side) */}
      {inputSockets.map((socket: { id: string; name: string; type: string }, index: number) => {
        const yPos = (index + 1) * (nodeHeight / (inputSockets.length + 1));
        return (
          <Handle
            key={socket.id}
            type="target"
            position={Position.Left}
            id={socket.id}
            className="!bg-[#4a4a52] !border !border-[#06E4A8] hover:!bg-[#06E4A8] !transition-colors"
            style={{ 
              top: yPos, 
              transform: 'translateY(-50%)',
              width: SOCKET_SIZE,
              height: SOCKET_SIZE,
            }}
          />
        );
      })}
      
      {/* Output sockets (right side) */}
      {outputSockets.map((socket: { id: string; name: string; type: string }, index: number) => {
        const yPos = (index + 1) * (nodeHeight / (outputSockets.length + 1));

        const handleSocketContextMenu = (e: React.MouseEvent) => {
          e.preventDefault();
          e.stopPropagation();
          
          // Dispatch custom event to show socket context menu
          const event = new CustomEvent('openSocketContextMenu', { 
            detail: { 
              nodeId: String(id), 
              socketId: String(socket.id),
              x: e.clientX,
              y: e.clientY
            }
          });
          window.dispatchEvent(event);
        };

        return (
          <Handle
            key={socket.id}
            type="source"
            position={Position.Right}
            id={socket.id}
            className="!bg-[#4a4a52] !border !border-[#06E4A8] hover:!bg-[#06E4A8] !transition-colors"
            style={{ 
              top: yPos, 
              transform: 'translateY(-50%)',
              width: SOCKET_SIZE,
              height: SOCKET_SIZE,
              cursor: 'pointer',
            }}
            onContextMenu={handleSocketContextMenu}
          />
        );
      })}
      </div>
    </div>
  );
}

export default memo(SciplexNode);
