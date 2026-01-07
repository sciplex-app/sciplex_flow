import { useState, useEffect } from 'react';
import { useFlowStore } from '../store/flowStore';

interface SaveToLibraryDialogProps {
  nodeId: string;
  functionName: string;
  onSave: (libraryName: string, isNew: boolean) => void;
  onCancel: () => void;
}

export default function SaveToLibraryDialog({
  nodeId: _nodeId, // Currently unused but kept for potential future use
  functionName,
  onSave,
  onCancel,
}: SaveToLibraryDialogProps) {
  const libraries = useFlowStore((s) => s.libraries);
  const [selectedLibrary, setSelectedLibrary] = useState<string>('');
  const [newLibraryName, setNewLibraryName] = useState<string>('');
  const [isNewLibrary, setIsNewLibrary] = useState<boolean>(false);

  // Get library names (exclude _internal)
  const libraryNames = Object.keys(libraries).filter(name => name !== '_internal');

  useEffect(() => {
    if (libraryNames.length > 0 && !selectedLibrary) {
      setSelectedLibrary(libraryNames[0]);
    }
  }, [libraryNames, selectedLibrary]);

  const handleSave = () => {
    if (isNewLibrary) {
      const name = newLibraryName.trim();
      if (!name) {
        alert('Please enter a library name.');
        return;
      }
      // Validate name (alphanumeric + underscore)
      if (!/^[a-zA-Z0-9_]+$/.test(name)) {
        alert('Library name should only contain letters, numbers, and underscores.');
        return;
      }
      onSave(name.replace(/\s+/g, '_'), true);
    } else {
      if (!selectedLibrary) {
        alert('Please select a library.');
        return;
      }
      onSave(selectedLibrary, false);
    }
  };

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
        className="w-full max-w-md bg-[#1E1E1E] rounded-xl border border-white/10 flex flex-col overflow-hidden shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-white/10">
          <h2 className="text-xl font-semibold text-white">Save to Library</h2>
          <p className="text-sm text-gray-400 mt-1">Save function: {functionName}</p>
        </div>

        {/* Content */}
        <div className="px-6 py-4 space-y-4">
          {/* Library selection */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Select Library
            </label>
            <select
              value={isNewLibrary ? 'new' : selectedLibrary}
              onChange={(e) => {
                if (e.target.value === 'new') {
                  setIsNewLibrary(true);
                } else {
                  setIsNewLibrary(false);
                  setSelectedLibrary(e.target.value);
                }
              }}
              className="
                w-full px-3 py-2
                bg-white/5 border border-white/10 rounded
                text-white text-sm
                focus:outline-none focus:border-[#06E4A8]
              "
            >
              {libraryNames.map(name => (
                <option key={name} value={name}>{name}</option>
              ))}
              <option value="new">➕ Create New Library...</option>
            </select>
          </div>

          {/* New library name input */}
          {isNewLibrary && (
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                New Library Name
              </label>
              <input
                type="text"
                value={newLibraryName}
                onChange={(e) => setNewLibraryName(e.target.value)}
                placeholder="Enter library name"
                className="
                  w-full px-3 py-2
                  bg-white/5 border border-white/10 rounded
                  text-white text-sm
                  focus:outline-none focus:border-[#06E4A8]
                "
                autoFocus
              />
            </div>
          )}
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
            onClick={handleSave}
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

