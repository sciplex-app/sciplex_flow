import { AlertTriangle } from 'lucide-react';

interface UnsavedChangesDialogProps {
  onSave: () => void;
  onDiscard: () => void;
  onCancel: () => void;
}

export default function UnsavedChangesDialog({
  onSave,
  onDiscard,
  onCancel,
}: UnsavedChangesDialogProps) {
  return (
    <div 
      className="fixed inset-0 bg-black/80 flex items-center justify-center z-[100] p-8"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onCancel();
        }
      }}
    >
      <div 
        className="w-full max-w-md bg-[#1E1E1E] rounded-xl border border-yellow-500/50 flex flex-col overflow-hidden shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-white/10 flex items-center gap-3">
          <AlertTriangle className="w-6 h-6 text-yellow-500" />
          <div>
            <h2 className="text-xl font-semibold text-white">Unsaved Changes</h2>
            <p className="text-sm text-gray-400 mt-1">Current project has unsaved changes</p>
          </div>
        </div>

        {/* Content */}
        <div className="px-6 py-4">
          <p className="text-sm text-gray-300">
            Do you want to save your changes before opening a new project?
          </p>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-white/10 flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="
              px-4 py-2
              bg-white/5 hover:bg-white/10
              text-gray-300 rounded text-sm font-medium
              transition-colors
            "
          >
            Cancel
          </button>
          <button
            onClick={onDiscard}
            className="
              px-4 py-2
              bg-red-600/20 hover:bg-red-600/30 text-red-400
              border border-red-600/50 rounded text-sm font-medium
              transition-colors
            "
          >
            Discard
          </button>
          <button
            onClick={onSave}
            className="
              px-4 py-2
              bg-[#06E4A8] hover:bg-[#04c790] text-black
              rounded text-sm font-medium
              transition-colors
            "
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

