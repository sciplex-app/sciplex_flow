import { useEffect, useRef } from 'react';

interface NodeContextMenuProps {
  x: number;
  y: number;
  nodeIds: string[];
  onClose: () => void;
  onDelete: (nodeIds: string[]) => void;
  onReset: (nodeIds: string[]) => void;
  onSave: (nodeId: string) => void;
  nodesData: Record<string, { isScript: boolean; libraryName: string }>; // Map of nodeId -> node data
}

export default function NodeContextMenu({
  x,
  y,
  nodeIds,
  onClose,
  onDelete,
  onReset,
  onSave,
  nodesData,
}: NodeContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    // Add event listener after a short delay to avoid immediate closing
    const timeoutId = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside);
    }, 0);

    return () => {
      clearTimeout(timeoutId);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [onClose]);

  // Close menu on escape key
  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('keydown', handleEscape);
    };
  }, [onClose]);

  // Check if first node is script/custom (for Save Node option)
  const firstNodeId = nodeIds[0];
  const firstNodeData = firstNodeId ? nodesData[firstNodeId] : null;
  const showSaveNode = firstNodeData && (firstNodeData.isScript || firstNodeData.libraryName?.toLowerCase() === 'custom');
  
  console.log('NodeContextMenu render - firstNodeId:', firstNodeId, 'firstNodeData:', firstNodeData);

  const handleDelete = () => {
    onDelete(nodeIds);
    onClose();
  };

  const handleReset = () => {
    onReset(nodeIds);
    onClose();
  };

  const handleSave = () => {
    if (firstNodeId) {
      onSave(firstNodeId);
    }
    onClose();
  };

  return (
    <div
      ref={menuRef}
      className="
        fixed z-[200]
        bg-[#1e1e24] border border-white/20 rounded-lg shadow-xl
        py-1 min-w-[200px]
      "
      style={{
        left: `${x}px`,
        top: `${y}px`,
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Save Node - only for script/custom nodes, single selection */}
      {showSaveNode && nodeIds.length === 1 && (
        <button
          onClick={handleSave}
          className="
            w-full px-4 py-2 text-left text-sm text-gray-200
            hover:bg-white/10 transition-colors
            flex items-center gap-2
          "
        >
          <img 
            src="/api/icons/action_save" 
            alt="Save" 
            className="w-4 h-4 object-contain opacity-75" 
          />
          <span>Save Node</span>
        </button>
      )}

      {/* Delete Node */}
      <button
        onClick={handleDelete}
        className="
          w-full px-4 py-2 text-left text-sm text-gray-200
          hover:bg-white/10 transition-colors
          flex items-center gap-2
        "
      >
        <img 
          src="/api/icons/action_delete" 
          alt="Delete" 
          className="w-4 h-4 object-contain opacity-75" 
        />
        <span>
          {nodeIds.length > 1 
            ? `Delete Node (${nodeIds.length} nodes)`
            : 'Delete Node'}
        </span>
      </button>

      {/* Reset Node */}
      <button
        onClick={handleReset}
        className="
          w-full px-4 py-2 text-left text-sm text-gray-200
          hover:bg-white/10 transition-colors
          flex items-center gap-2
        "
      >
        <img 
          src="/api/icons/action_reset" 
          alt="Reset" 
          className="w-4 h-4 object-contain opacity-75" 
        />
        <span>
          {nodeIds.length > 1 
            ? `Reset Node (${nodeIds.length} nodes)`
            : 'Reset Node'}
        </span>
      </button>

    </div>
  );
}

