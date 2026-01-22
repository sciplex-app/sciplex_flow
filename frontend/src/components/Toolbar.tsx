import { useState } from 'react';
import { Loader2, FilePlus } from 'lucide-react';
import { useFlowStore } from '../store/flowStore';
import { useApi } from '../hooks/useApi';
import { authenticatedFetch } from '../hooks/useApi';
import SaveProjectDialog from './SaveProjectDialog';
import UnsavedChangesDialog from './UnsavedChangesDialog';
import { buildExistingProjectNames } from '../utils/projectUtils';

const ICON_SIZE = 18;

interface ToolbarButtonProps {
  icon: string;
  tooltip: string;
  onClick: () => void;
  disabled?: boolean;
  className?: string;
}

function ToolbarButton({ icon, tooltip, onClick, disabled = false, className = '' }: ToolbarButtonProps) {
  const [iconError, setIconError] = useState(false);
  
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`
        p-2.5
        flex items-center justify-center
        bg-transparent hover:bg-white/10
        rounded-md
        transition-colors duration-150
        disabled:opacity-50 disabled:cursor-not-allowed
        ${className}
      `}
      title={tooltip}
      style={{ minWidth: `${ICON_SIZE + 10}px`, minHeight: `${ICON_SIZE + 10}px` }}
    >
      {!iconError ? (
        <img 
          src={`/api/icons/${icon}`}
          alt={tooltip}
          className="w-[18px] h-[18px] object-contain"
          onError={() => setIconError(true)}
        />
      ) : (
        <span className="text-xs text-gray-400">?</span>
      )}
    </button>
  );
}

interface ToolbarProps {
  onScriptEditorOpen?: () => void;
  onWorkspaceOpen?: () => void;
  onExportCode?: () => void;
}

export default function Toolbar({ onScriptEditorOpen, onWorkspaceOpen, onExportCode }: ToolbarProps) {
  const executionState = useFlowStore((s) => s.executionState);
  const singleNodeExecutionMode = useFlowStore((s) => s.singleNodeExecutionMode);
  const toggleSingleNodeExecutionMode = useFlowStore((s) => s.toggleSingleNodeExecutionMode);
  
  const { executeGraph, resetNodes, saveProject, listProjects, clearScene } = useApi();
  const setCurrentProjectName = useFlowStore((s) => s.setCurrentProjectName);
  const currentProjectName = useFlowStore((s) => s.currentProjectName);
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [existingProjects, setExistingProjects] = useState<string[]>([]);
  const [projectFolders, setProjectFolders] = useState<Array<{ name: string; path: string; projects: any[] }>>([]);
  const [dialogInitialProjectName, setDialogInitialProjectName] = useState<string>('');
  const [conflictingProjectName, setConflictingProjectName] = useState<string | null>(null);
  const [showUnsavedDialog, setShowUnsavedDialog] = useState(false);
  const [pendingAction, setPendingAction] = useState<'new' | null>(null);
  const [execModeIconError, setExecModeIconError] = useState(false);

  const isExecuting = executionState === 'running';

  // Clear the scene and reset project name
  const performNewProject = async () => {
    await clearScene();
    setCurrentProjectName('');
    // Dispatch event to notify components of the new project
    window.dispatchEvent(new CustomEvent('newProjectCreated'));
  };

  // Handle "New Project" button click
  const handleNewClick = async () => {
    try {
      // Check if there are unsaved changes
      const response = await authenticatedFetch('/api/scene/is-modified');
      if (response.ok) {
        const data = await response.json();
        if (data.is_modified) {
          // Show unsaved changes dialog
          setPendingAction('new');
          setShowUnsavedDialog(true);
        } else {
          // No unsaved changes, just clear
          await performNewProject();
        }
      } else {
        // If we can't check, just clear (safe fallback)
        await performNewProject();
      }
    } catch (error) {
      console.error('Error checking for unsaved changes:', error);
      // On error, just clear
      await performNewProject();
    }
  };

  // Handle unsaved changes dialog actions
  const handleUnsavedSave = async () => {
    setShowUnsavedDialog(false);
    // Open save dialog, and after saving, perform the pending action
    setDialogInitialProjectName(currentProjectName || '');
    try {
      const response = await authenticatedFetch('/api/projects');
      if (response.ok) {
        const data = await response.json();
        setExistingProjects(buildExistingProjectNames(data));
        setProjectFolders(data.folders || []);
      }
    } catch (error) {
      console.error('Error fetching projects:', error);
    }
    setShowSaveDialog(true);
  };

  const handleUnsavedDiscard = async () => {
    setShowUnsavedDialog(false);
    if (pendingAction === 'new') {
      await performNewProject();
    }
    setPendingAction(null);
  };

  const handleUnsavedCancel = () => {
    setShowUnsavedDialog(false);
    setPendingAction(null);
  };

  const handleSaveClick = async () => {
    setDialogInitialProjectName(currentProjectName || '');
    try {
      // Fetch projects with folders
      const response = await authenticatedFetch('/api/projects');
      if (response.ok) {
        const data = await response.json();
        setExistingProjects(buildExistingProjectNames(data));
        setProjectFolders(data.folders || []);
      } else {
        const projects = await listProjects();
        setExistingProjects(projects.map((p: any) => p.name));
        setProjectFolders([]);
      }
    } catch (error) {
      console.error('Error fetching projects:', error);
      try {
        const projects = await listProjects();
        setExistingProjects(projects.map((p: any) => p.name));
      } catch {
        setExistingProjects([]);
      }
      setProjectFolders([]);
    } finally {
      setShowSaveDialog(true);
    }
  };

  const handleSaveProject = async (projectName: string, overwrite: boolean) => {
    try {
      await saveProject(projectName, overwrite);
      setCurrentProjectName(projectName); // Remember the project name
      setConflictingProjectName(null);
      setShowSaveDialog(false);
      
      // If there was a pending action (e.g., new project after save), perform it
      if (pendingAction === 'new') {
        await performNewProject();
        setPendingAction(null);
      }
    } catch (error: any) {
      // Check if it's an "already exists" error - show overwrite option instead of toast
      const msg = error?.message || '';
      if (msg.includes('already exists') && !overwrite) {
        setConflictingProjectName(projectName);
      }
      // Other errors are already shown by toast in saveProject
    }
  };

  return (
    <div className="
      h-14 px-2.5
      bg-[#1a1a1e]/95 backdrop-blur-sm border border-white/10 rounded-lg shadow-lg
      flex items-center justify-center gap-1
    ">
      {/* Workspace */}
      <ToolbarButton
        icon="action_workspace"
        tooltip="Show global variables"
        onClick={() => onWorkspaceOpen?.()}
      />

      {/* Build from Python Code (Script Node) */}
      <ToolbarButton
        icon="action_python"
        tooltip="Build from Python Code"
        onClick={() => onScriptEditorOpen?.()}
      />

      {/* Export Graph as Python */}
      <ToolbarButton
        icon="action_export"
        tooltip="Export Graph as Python"
        onClick={() => onExportCode?.()}
      />

      {/* Reset */}
      <ToolbarButton
        icon="action_reset"
        tooltip="Reset"
        onClick={() => resetNodes()}
      />

      {/* New Project */}
      <button
        onClick={handleNewClick}
        className="
          p-2.5
          flex items-center justify-center
          bg-transparent hover:bg-white/10
          rounded-md
          transition-colors duration-150
        "
        title="New Project"
        style={{ minWidth: `${ICON_SIZE + 10}px`, minHeight: `${ICON_SIZE + 10}px` }}
      >
        <FilePlus className="w-[18px] h-[18px] text-gray-300" />
      </button>

      {/* Save */}
      <ToolbarButton
        icon="action_save"
        tooltip="Save Project"
        onClick={handleSaveClick}
      />

      {/* Node Execution Mode Toggle */}
      <button
        onClick={toggleSingleNodeExecutionMode}
        className={`
          p-2.5
          flex items-center justify-center
          rounded-md
          transition-all duration-150
          ${singleNodeExecutionMode 
            ? 'bg-transparent hover:bg-white/10'
            : 'bg-[#06E4A8] hover:bg-[#04c790]'}
        `}
        title={singleNodeExecutionMode 
          ? "Single node execution - Click to switch to upstream execution." 
          : "Upstream execution - Click to switch to singe node execution."}
        style={{ minWidth: `${ICON_SIZE + 10}px`, minHeight: `${ICON_SIZE + 10}px` }}
      >
        {!execModeIconError ? (
          <img
            src="/api/icons/action_exec_mode"
            alt="Execution Mode"
            className="w-[18px] h-[18px] object-contain"
            onError={() => setExecModeIconError(true)}
          />
        ) : (
          <span className="text-xs text-gray-900">?</span>
        )}
      </button>

      {/* Execute */}
      <button
        onClick={() => executeGraph()}
        disabled={isExecuting}
        className={`
          p-2.5
          flex items-center justify-center
          rounded-md
          transition-colors duration-150
          disabled:opacity-50 disabled:cursor-not-allowed
          ${isExecuting 
            ? 'bg-blue-600/30 hover:bg-blue-600/30' 
            : 'bg-[#06E4A8] hover:bg-[#04c790]'}
        `}
        title="Execute Graph"
        style={{ minWidth: `${ICON_SIZE + 10}px`, minHeight: `${ICON_SIZE + 10}px` }}
      >
        {isExecuting ? (
          <Loader2 className="w-[18px] h-[18px] animate-spin text-blue-400" />
        ) : (
          <img 
            src="/api/icons/action_execute"
            alt="Execute"
            className="w-[18px] h-[18px] object-contain"
          />
        )}
      </button>

      {/* Save Project Dialog */}
      {showSaveDialog && (
        <SaveProjectDialog
          onSave={handleSaveProject}
          onCancel={() => {
            setShowSaveDialog(false);
            setConflictingProjectName(null);
            setPendingAction(null);  // Clear pending action if user cancels save
          }}
          existingProjects={existingProjects}
          projectFolders={projectFolders}
          initialProjectName={dialogInitialProjectName}
          conflictingProjectName={conflictingProjectName}
          onClearConflict={() => setConflictingProjectName(null)}
        />
      )}

      {/* Unsaved Changes Dialog */}
      {showUnsavedDialog && (
        <UnsavedChangesDialog
          onSave={handleUnsavedSave}
          onDiscard={handleUnsavedDiscard}
          onCancel={handleUnsavedCancel}
        />
      )}
    </div>
  );
}
