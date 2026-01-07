import { useState, useEffect } from 'react';

interface SaveProjectDialogProps {
  onSave: (projectName: string, overwrite: boolean) => void;
  onCancel: () => void;
  existingProjects?: string[];
  projectFolders?: Array<{ name: string; path: string; projects: any[] }>;
  initialProjectName?: string;
  conflictingProjectName?: string | null;  // Set when backend says project already exists
  onClearConflict?: () => void;  // Called when user changes the project name
}

export default function SaveProjectDialog({
  onSave,
  onCancel,
  existingProjects = [],
  projectFolders = [],
  initialProjectName = '',
  conflictingProjectName = null,
  onClearConflict,
}: SaveProjectDialogProps) {
  const [projectName, setProjectName] = useState<string>('');
  const [selectedFolder, setSelectedFolder] = useState<string>('');
  const [showOverwriteWarning, setShowOverwriteWarning] = useState<boolean>(false);

  useEffect(() => {
    setProjectName(initialProjectName || '');
  }, [initialProjectName]);

  // Show overwrite warning when backend reports conflict
  useEffect(() => {
    if (conflictingProjectName) {
      setShowOverwriteWarning(true);
    }
  }, [conflictingProjectName]);

  const handleProjectNameChange = (newName: string) => {
    setProjectName(newName);
    // Clear conflict state when user changes the name
    if (conflictingProjectName && onClearConflict) {
      onClearConflict();
    }
    // Also reset overwrite warning if they're typing a new name
    if (showOverwriteWarning) {
      setShowOverwriteWarning(false);
    }
  };

  useEffect(() => {
    // Focus the input when dialog opens
    const input = document.querySelector<HTMLInputElement>('#project-name-input');
    if (input) {
      input.focus();
    }
  }, []);

  const getFullProjectName = () => {
    const name = projectName.trim();
    if (!name) return '';
    if (selectedFolder) {
      return `${selectedFolder}/${name}`;
    }
    return name;
  };

  const handleSave = () => {
    const name = projectName.trim();
    if (!name) {
      alert('Please enter a project name.');
      return;
    }

    const fullName = getFullProjectName();
    
    // Check if project already exists
    if (existingProjects.includes(fullName)) {
      setShowOverwriteWarning(true);
      return;
    }

    onSave(fullName, false);
  };

  const handleOverwrite = () => {
    // Use conflictingProjectName if set (from backend error), otherwise use current input
    const nameToSave = conflictingProjectName || getFullProjectName();
    onSave(nameToSave, true);
  };

  const handleCancel = () => {
    setShowOverwriteWarning(false);
    setProjectName('');
    onCancel();
  };

  return (
    <div 
      className="fixed inset-0 bg-black/80 flex items-center justify-center z-[100] p-8"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          handleCancel();
        }
      }}
    >
      <div 
        className="w-full max-w-md bg-[#1E1E1E] rounded-xl border border-white/10 flex flex-col overflow-hidden shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-white/10">
          <h2 className="text-xl font-semibold text-white">Save Project</h2>
          <p className="text-sm text-gray-400 mt-1">Save your current workflow</p>
        </div>

        {/* Content */}
        <div className="px-6 py-4 space-y-4">
          {!showOverwriteWarning ? (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Project Name
                </label>
                <input
                  id="project-name-input"
                  type="text"
                  value={projectName}
                  onChange={(e) => handleProjectNameChange(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      handleSave();
                    } else if (e.key === 'Escape') {
                      handleCancel();
                    }
                  }}
                  placeholder="Enter project name"
                  className="
                    w-full px-3 py-2
                    bg-white/5 border border-white/10 rounded
                    text-white text-sm
                    focus:outline-none focus:border-[#06E4A8]
                  "
                  autoFocus
                />
                <div className="mt-3">
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Folder (optional)
                  </label>
                  <select
                    value={selectedFolder}
                    onChange={(e) => setSelectedFolder(e.target.value)}
                    className="
                      w-full px-3 py-2
                      bg-white/5 border border-white/10 rounded
                      text-white text-sm
                      focus:outline-none focus:border-[#06E4A8]
                    "
                  >
                    <option value="">Root (no folder)</option>
                    {projectFolders.map((folder) => (
                      <option key={folder.name} value={folder.name}>{folder.name}</option>
                    ))}
                  </select>
                  <p className="text-xs text-gray-500 mt-1">
                    {selectedFolder ? `Project will be saved to folder: ${selectedFolder}` : 'Project will be saved to the projects folder'}
                  </p>
                </div>
              </div>
            </>
          ) : (
            <div className="space-y-3">
              <div className="p-3 bg-yellow-500/20 border border-yellow-500/50 rounded-lg">
                <p className="text-sm text-yellow-400">
                  Project <span className="font-semibold">"{conflictingProjectName || getFullProjectName()}"</span> already exists.
                </p>
                <p className="text-sm text-yellow-400/80 mt-1">
                  Do you want to overwrite it?
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-white/10 flex justify-end gap-2">
          {showOverwriteWarning ? (
            <>
              <button
                onClick={() => {
                  setShowOverwriteWarning(false);
                  if (onClearConflict) onClearConflict();
                }}
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
                onClick={handleOverwrite}
                className="
                  px-4 py-2
                  bg-yellow-600 hover:bg-yellow-700 text-white
                  rounded text-sm font-medium
                  transition-colors
                "
              >
                Overwrite
              </button>
            </>
          ) : (
            <>
              <button
                onClick={handleCancel}
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
                disabled={!projectName.trim()}
                className="
                  px-4 py-2
                  bg-[#06E4A8] hover:bg-[#04c790] text-black
                  rounded text-sm font-medium
                  transition-colors
                  disabled:opacity-50 disabled:cursor-not-allowed
                "
              >
                Save
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

