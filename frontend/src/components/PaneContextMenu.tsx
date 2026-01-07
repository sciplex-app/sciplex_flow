import { useEffect, useRef } from 'react';
import { MessageSquare } from 'lucide-react';

interface PaneContextMenuProps {
  x: number;
  y: number;
  onClose: () => void;
  onAddComment: () => void;
}

export default function PaneContextMenu({
  x,
  y,
  onClose,
  onAddComment,
}: PaneContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

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

  const handleAddComment = () => {
    onAddComment();
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
      <button
        onClick={handleAddComment}
        className="
          w-full px-4 py-2 text-left text-sm text-gray-200
          hover:bg-white/10 transition-colors
          flex items-center gap-2
        "
      >
        <MessageSquare className="w-4 h-4 text-gray-400" />
        <span>Add Comment</span>
      </button>
    </div>
  );
}

