import { useEffect, useRef } from 'react';
import { Maximize2 } from 'lucide-react';

interface SocketContextMenuProps {
  x: number;
  y: number;
  nodeId: string;
  socketId: string;
  onClose: () => void;
  onCreateDisplayNode?: (nodeId: string, socketId: string) => void;
  onViewOutput?: (nodeId: string, socketId: string) => void;
}

export default function SocketContextMenu({
  x,
  y,
  nodeId,
  socketId,
  onClose,
  onCreateDisplayNode,
  onViewOutput,
}: SocketContextMenuProps) {
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

  const handleCreateDisplayNode = () => {
    if (onCreateDisplayNode) {
      onCreateDisplayNode(nodeId, socketId);
    }
    onClose();
  };

  const handleViewOutput = () => {
    if (onViewOutput) {
      onViewOutput(nodeId, socketId);
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
      {/* Embed Output (Display Node) */}
      {onCreateDisplayNode && (
        <button
          onClick={handleCreateDisplayNode}
          className="
            w-full px-4 py-2 text-left text-sm text-gray-200
            hover:bg-white/10 transition-colors
            flex items-center gap-2
          "
        >
          <img 
            src="/api/icons/action_newnode" 
            alt="New Node" 
            className="w-4 h-4 object-contain opacity-75" 
          />
          <span>Embed Output</span>
        </button>
      )}

      {/* View Output */}
      {onViewOutput && (
        <button
          onClick={handleViewOutput}
          className="
            w-full px-4 py-2 text-left text-sm text-gray-200
            hover:bg-white/10 transition-colors
            flex items-center gap-2
          "
        >
          <Maximize2 className="w-4 h-4 text-gray-300" />
          <span>View Output</span>
        </button>
      )}
    </div>
  );
}
