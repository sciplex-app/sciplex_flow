import { useEffect, useState } from 'react';
import { CheckCircle, XCircle, X } from 'lucide-react';

export type ToastType = 'success' | 'error' | 'info';

export interface ToastData {
  id: string;
  message: string;
  type: ToastType;
  duration?: number;
}

interface ToastProps {
  toast: ToastData;
  onRemove: (id: string) => void;
}

export function Toast({ toast, onRemove }: ToastProps) {
  const [isVisible, setIsVisible] = useState(false);
  const [isRemoving, setIsRemoving] = useState(false);

  useEffect(() => {
    // Fade in
    setTimeout(() => setIsVisible(true), 10);

    // Auto-remove after duration
    const duration = toast.duration ?? (toast.type === 'error' ? 6000 : 3000);
    const timer = setTimeout(() => {
      handleRemove();
    }, duration);

    return () => clearTimeout(timer);
  }, [toast.duration, toast.type]);

  const handleRemove = () => {
    setIsRemoving(true);
    setTimeout(() => {
      onRemove(toast.id);
    }, 200); // Match fade-out duration
  };

  const getIcon = () => {
    switch (toast.type) {
      case 'success':
        return <CheckCircle className="w-5 h-5" />;
      case 'error':
        return <XCircle className="w-5 h-5" />;
      default:
        return null;
    }
  };

  const getColors = () => {
    switch (toast.type) {
      case 'success':
        return {
          bg: 'bg-[#22c55e]', // green - executedColor
          text: 'text-black',
          border: 'border-[#22c55e]',
        };
      case 'error':
        return {
          bg: 'bg-[#ef4444]', // red - failedColor
          text: 'text-white',
          border: 'border-[#ef4444]',
        };
      default:
        return {
          bg: 'bg-[#06E4A8]', // accent color
          text: 'text-black',
          border: 'border-[#06E4A8]',
        };
    }
  };

  const colors = getColors();

  return (
    <div
      className={`
        min-w-[300px] max-w-[600px] 
        ${colors.bg} ${colors.text}
        rounded-lg shadow-lg
        border ${colors.border}
        px-4 py-3
        flex items-center gap-3
        transition-all duration-200
        ${isVisible && !isRemoving ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2'}
      `}
    >
      {/* Icon */}
      {getIcon() && (
        <div className="flex-shrink-0">
          {getIcon()}
        </div>
      )}

      {/* Message */}
      <div className="flex-1 text-sm font-medium break-words whitespace-pre-line">
        {toast.message}
      </div>

      {/* Close button */}
      <button
        onClick={handleRemove}
        className="flex-shrink-0 p-1 rounded hover:bg-black/10 transition-colors"
        aria-label="Close"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}

