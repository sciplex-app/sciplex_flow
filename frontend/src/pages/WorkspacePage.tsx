import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Upload, 
  File, 
  Folder,
  FolderOpen,
  Trash2, 
  RefreshCw, 
  FileCode,
  Database,
  Table,
  FileText,
  Check,
  AlertCircle,
  Download,
  ChevronRight,
  ChevronDown,
  Plus,
  FolderPlus,
  MoreVertical,
  Copy,
  Move,
  Edit,
} from 'lucide-react';
import PythonEditor from '../components/PythonEditor';
import UnsavedChangesDialog from '../components/UnsavedChangesDialog';
import SaveProjectDialog from '../components/SaveProjectDialog';
import { buildExistingProjectNames } from '../utils/projectUtils';
import { useFlowStore } from '../store/flowStore';
import { authenticatedFetch } from '../hooks/useApi';

type Tab = 'files' | 'libraries' | 'projects' | 'icons' | 'packages';

interface WorkspaceFile {
  name: string;
  size: number;
  modified: string;
  type: string;
  folder?: string;
  path?: string;
}

interface FileFolder {
  name: string;
  path: string;
  files: WorkspaceFile[];
}

interface WorkspaceLibrary {
  name: string;
  filename: string;
  folder: string;
  path: string;
  full_path: string;
  nodes: string[];
  loaded: boolean;
  is_helper?: boolean;  // True for helper files like _helpers.py
  enabled?: boolean | null;  // null for helpers, true/false for regular libraries
  size?: number;
  modified?: string;
}

interface LibraryFolder {
  name: string;
  path: string;
  libraries: WorkspaceLibrary[];
  is_default: boolean;
}

interface LibraryContent {
  name: string;
  filename: string;
  path: string;
  content: string;
  size: number;
}

interface LibrariesResponse {
  folders: LibraryFolder[];
  libraries: WorkspaceLibrary[];
}

interface Project {
  name: string;
  filename: string;
  id: string;
  imported_libraries: string[];
  modified_time: number;
  folder?: string;
  path?: string;
}

interface ProjectFolder {
  name: string;
  path: string;
  projects: Project[];
}

export default function WorkspacePage() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<Tab>('libraries');
  const [files, setFiles] = useState<WorkspaceFile[]>([]);
  const [fileFolders, setFileFolders] = useState<FileFolder[]>([]);
  const [folders, setFolders] = useState<LibraryFolder[]>([]);
  const [rootLibraries, setRootLibraries] = useState<WorkspaceLibrary[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectFolders, setProjectFolders] = useState<ProjectFolder[]>([]);
  const [uploadFolder, setUploadFolder] = useState<string>(''); // Selected folder for file uploads
  const [libraryUploadFolder, setLibraryUploadFolder] = useState<string>(''); // Selected folder for library uploads
  const [showMoveDialog, setShowMoveDialog] = useState(false);
  const [moveDialogType, setMoveDialogType] = useState<'file' | 'library' | 'project'>('file');
  const [itemToMove, setItemToMove] = useState<string | null>(null);
  const [moveTargetFolder, setMoveTargetFolder] = useState<string>('');
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [showRenameDialog, setShowRenameDialog] = useState(false);
  const [renameDialogType, setRenameDialogType] = useState<'file' | 'library' | 'project'>('file');
  const [itemToRename, setItemToRename] = useState<string | null>(null);
  const [renameNewName, setRenameNewName] = useState<string>('');
  const [icons, setIcons] = useState<Array<{ name: string; size: number; modified_time: number }>>([]);
  const [packages, setPackages] = useState<Array<{ name: string; version: string }>>([]);
  const [pythonEnv, setPythonEnv] = useState<{
    python_executable: string;
    python_version: string;
    in_venv: boolean;
    venv_path: string | null;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [installingPackage, setInstallingPackage] = useState(false);
  const [newPackageName, setNewPackageName] = useState('');
  const [packageSuggestions, setPackageSuggestions] = useState<Array<{ name: string; version: string; description: string }>>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [searchingPackages, setSearchingPackages] = useState(false);
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isLocalMode, setIsLocalMode] = useState(false);
  
  // Editor state
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorContent, setEditorContent] = useState('');
  const [editorPath, setEditorPath] = useState('');
  const [editorTitle, setEditorTitle] = useState('');
  const [saving, setSaving] = useState(false);
  const [editorError, setEditorError] = useState<string | null>(null);
  
  // UI state
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set(['default']));
  const [selectedItem, setSelectedItem] = useState<string | null>(null);
  const [showNewFolderModal, setShowNewFolderModal] = useState(false);
  const [showNewLibraryModal, setShowNewLibraryModal] = useState(false);
  const [newItemName, setNewItemName] = useState('');
  const [newLibraryFolder, setNewLibraryFolder] = useState('');
  
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Fetch files
  const fetchFiles = useCallback(async () => {
    setLoading(true);
    try {
      const response = await authenticatedFetch('/api/workspace/files');
      if (response.ok) {
        const data = await response.json();
        setFiles(data.files || []);
        setFileFolders(data.folders || []);
      }
    } catch (error) {
      console.error('Error fetching files:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch libraries
  const fetchLibraries = useCallback(async () => {
    setLoading(true);
    try {
      const response = await authenticatedFetch('/api/workspace/libraries');
      if (response.ok) {
        const data: LibrariesResponse = await response.json();
        setFolders(data.folders || []);
        setRootLibraries(data.libraries || []);
      }
    } catch (error) {
      console.error('Error fetching libraries:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch projects
  const fetchProjects = useCallback(async () => {
    setLoading(true);
    try {
      const response = await authenticatedFetch('/api/projects');
      if (response.ok) {
        const data = await response.json();
        setProjects(data.projects || []);
        setProjectFolders(data.folders || []);
      }
    } catch (error) {
      console.error('Error fetching projects:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch icons
  const fetchIcons = useCallback(async () => {
    setLoading(true);
    try {
      const response = await authenticatedFetch('/api/workspace/icons');
      if (response.ok) {
        const data = await response.json();
        setIcons(data.icons || []);
      }
    } catch (error) {
      console.error('Error fetching icons:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch config to check if running in local mode
  useEffect(() => {
    const fetchConfig = async () => {
      try {
        const response = await authenticatedFetch('/api/config');
        if (response.ok) {
          const config = await response.json();
          const localMode = config.is_local_mode || false;
          setIsLocalMode(localMode);
          // If in local mode and currently on packages tab, switch to libraries
          if (localMode && activeTab === 'packages') {
            setActiveTab('libraries');
          }
        }
      } catch (error) {
        console.error('Error fetching config:', error);
        // If config endpoint doesn't exist, assume not local mode
        setIsLocalMode(false);
      }
    };
    fetchConfig();
  }, [activeTab]);

  // Fetch packages
  const fetchPackages = useCallback(async () => {
    setLoading(true);
    try {
      const response = await authenticatedFetch('/api/packages');
      if (response.ok) {
        const data = await response.json();
        setPackages(data.packages || []);
        if (data.environment) {
          setPythonEnv(data.environment);
        }
      }
    } catch (error) {
      console.error('Error fetching packages:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial fetch
  useEffect(() => {
    if (activeTab === 'files') {
      fetchFiles();
    } else if (activeTab === 'libraries') {
      fetchLibraries();
    } else if (activeTab === 'projects') {
      fetchProjects();
    } else if (activeTab === 'icons') {
      fetchIcons();
    } else if (activeTab === 'packages' && !isLocalMode) {
      fetchPackages();
    }
  }, [activeTab, fetchFiles, fetchLibraries, fetchProjects, fetchIcons, fetchPackages]);

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (openMenuId && !(event.target as Element).closest('.menu-container')) {
        setOpenMenuId(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [openMenuId]);

  // File upload handler
  const handleFileUpload = async (uploadFiles: FileList | null) => {
    if (!uploadFiles || uploadFiles.length === 0) return;
    
    setUploading(true);
    const formData = new FormData();
    let endpoint = '/api/workspace/files/upload';
    let folder = '';
    
    if (activeTab === 'libraries') {
      endpoint = '/api/workspace/libraries/upload';
      folder = libraryUploadFolder;
    } else if (activeTab === 'icons') {
      endpoint = '/api/workspace/icons/upload';
    } else if (activeTab === 'files') {
      // Use selected folder for uploads
      folder = uploadFolder;
    }
    
    for (let i = 0; i < uploadFiles.length; i++) {
      formData.append('files', uploadFiles[i]);
    }
    
    try {
      let url = endpoint;
      if ((activeTab === 'files' && folder) || (activeTab === 'libraries' && folder)) {
        url = `${endpoint}?folder=${encodeURIComponent(folder)}`;
      }
      const response = await authenticatedFetch(url, { method: 'POST', body: formData });
      
      if (response.ok) {
        const result = await response.json();
        setMessage({ type: 'success', text: result.message || 'Upload successful!' });
        if (activeTab === 'files') {
          fetchFiles();
          setUploadFolder(''); // Reset folder selection after upload
        } else if (activeTab === 'libraries') {
          fetchLibraries();
          setLibraryUploadFolder(''); // Reset folder selection after upload
          window.dispatchEvent(new CustomEvent('refresh-libraries'));
        } else if (activeTab === 'icons') {
          fetchIcons();
        }
      } else {
        const error = await response.json();
        setMessage({ type: 'error', text: error.detail || 'Upload failed' });
      }
    } catch {
      setMessage({ type: 'error', text: 'Upload failed: Network error' });
    } finally {
      setUploading(false);
      setTimeout(() => setMessage(null), 3000);
    }
  };
  
  // Move item to folder (files, libraries, or projects)
  const handleMoveItem = async () => {
    if (!itemToMove) return;
    
    try {
      let endpoint = '';
      if (moveDialogType === 'file') {
        endpoint = `/api/workspace/files/${encodeURIComponent(itemToMove)}/move`;
      } else if (moveDialogType === 'library') {
        endpoint = `/api/workspace/libraries/${encodeURIComponent(itemToMove)}/move`;
      } else if (moveDialogType === 'project') {
        endpoint = `/api/projects/${encodeURIComponent(itemToMove)}/move`;
      }
      
      const response = await authenticatedFetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target_folder: moveTargetFolder }),
      });
      
      if (response.ok) {
        setMessage({ type: 'success', text: `${moveDialogType === 'file' ? 'File' : moveDialogType === 'library' ? 'Library' : 'Project'} moved successfully` });
        setShowMoveDialog(false);
        setItemToMove(null);
        setMoveTargetFolder('');
        if (activeTab === 'files') {
          fetchFiles();
        } else if (activeTab === 'libraries') {
          fetchLibraries();
          window.dispatchEvent(new CustomEvent('refresh-libraries'));
        } else if (activeTab === 'projects') {
          fetchProjects();
        }
        if (selectedItem === itemToMove) setSelectedItem(null);
      } else {
        const error = await response.json();
        setMessage({ type: 'error', text: error.detail || `Failed to move ${moveDialogType}` });
      }
    } catch {
      setMessage({ type: 'error', text: `Move failed: Network error` });
    }
    setTimeout(() => setMessage(null), 3000);
  };

  // Duplicate file
  const handleDuplicateFile = async (filepath: string) => {
    try {
      const response = await authenticatedFetch(`/api/workspace/files/${encodeURIComponent(filepath)}/duplicate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      
      if (response.ok) {
        setMessage({ type: 'success', text: 'File duplicated successfully' });
        fetchFiles();
      } else {
        const error = await response.json();
        setMessage({ type: 'error', text: error.detail || 'Failed to duplicate file' });
      }
    } catch {
      setMessage({ type: 'error', text: 'Duplicate failed: Network error' });
    }
    setTimeout(() => setMessage(null), 3000);
  };

  // Duplicate library
  const handleDuplicateLibrary = async (libraryPath: string) => {
    try {
      const response = await authenticatedFetch(`/api/workspace/libraries/${encodeURIComponent(libraryPath)}/duplicate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      
      if (response.ok) {
        setMessage({ type: 'success', text: 'Library duplicated successfully' });
        fetchLibraries();
        window.dispatchEvent(new CustomEvent('refresh-libraries'));
      } else {
        const error = await response.json();
        setMessage({ type: 'error', text: error.detail || 'Failed to duplicate library' });
      }
    } catch {
      setMessage({ type: 'error', text: 'Duplicate failed: Network error' });
    }
    setTimeout(() => setMessage(null), 3000);
  };

  // Duplicate project
  const handleDuplicateProject = async (projectPath: string) => {
    try {
      const response = await authenticatedFetch(`/api/projects/${encodeURIComponent(projectPath)}/duplicate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      
      if (response.ok) {
        setMessage({ type: 'success', text: 'Project duplicated successfully' });
        fetchProjects();
      } else {
        const error = await response.json();
        setMessage({ type: 'error', text: error.detail || 'Failed to duplicate project' });
      }
    } catch {
      setMessage({ type: 'error', text: 'Duplicate failed: Network error' });
    }
    setTimeout(() => setMessage(null), 3000);
  };

  // Rename file
  const handleRenameFile = async () => {
    if (!itemToRename || !renameNewName.trim()) return;
    
    try {
      const response = await authenticatedFetch(`/api/workspace/files/${encodeURIComponent(itemToRename)}/rename`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ new_name: renameNewName.trim() }),
      });
      
      if (response.ok) {
        setMessage({ type: 'success', text: 'File renamed successfully' });
        setShowRenameDialog(false);
        setItemToRename(null);
        setRenameNewName('');
        fetchFiles();
        if (selectedItem === itemToRename) setSelectedItem(null);
      } else {
        const error = await response.json();
        setMessage({ type: 'error', text: error.detail || 'Failed to rename file' });
      }
    } catch {
      setMessage({ type: 'error', text: 'Rename failed: Network error' });
    }
    setTimeout(() => setMessage(null), 3000);
  };

  // Rename library
  const handleRenameLibrary = async () => {
    if (!itemToRename || !renameNewName.trim()) return;
    
    try {
      const response = await authenticatedFetch(`/api/workspace/libraries/${encodeURIComponent(itemToRename)}/rename`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ new_name: renameNewName.trim() }),
      });
      
      if (response.ok) {
        setMessage({ type: 'success', text: 'Library renamed successfully' });
        setShowRenameDialog(false);
        setItemToRename(null);
        setRenameNewName('');
        fetchLibraries();
        window.dispatchEvent(new CustomEvent('refresh-libraries'));
        if (selectedItem === itemToRename) setSelectedItem(null);
      } else {
        const error = await response.json();
        setMessage({ type: 'error', text: error.detail || 'Failed to rename library' });
      }
    } catch {
      setMessage({ type: 'error', text: 'Rename failed: Network error' });
    }
    setTimeout(() => setMessage(null), 3000);
  };

  // Rename project
  const handleRenameProject = async () => {
    if (!itemToRename || !renameNewName.trim()) return;
    
    try {
      const response = await authenticatedFetch(`/api/projects/${encodeURIComponent(itemToRename)}/rename`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ new_name: renameNewName.trim() }),
      });
      
      if (response.ok) {
        setMessage({ type: 'success', text: 'Project renamed successfully' });
        setShowRenameDialog(false);
        setItemToRename(null);
        setRenameNewName('');
        fetchProjects();
        if (selectedItem === itemToRename) setSelectedItem(null);
      } else {
        const error = await response.json();
        setMessage({ type: 'error', text: error.detail || 'Failed to rename project' });
      }
    } catch {
      setMessage({ type: 'error', text: 'Rename failed: Network error' });
    }
    setTimeout(() => setMessage(null), 3000);
  };

  // Handle rename (unified)
  const handleRename = () => {
    if (renameDialogType === 'file') {
      handleRenameFile();
    } else if (renameDialogType === 'library') {
      handleRenameLibrary();
    } else if (renameDialogType === 'project') {
      handleRenameProject();
    }
  };

  // State for unsaved changes dialog
  const [unsavedChangesDialog, setUnsavedChangesDialog] = useState<{
    show: boolean;
    projectName: string;
  }>({ show: false, projectName: '' });

  // State for save project dialog (when saving before loading)
  const [saveDialogState, setSaveDialogState] = useState<{
    show: boolean;
    projectNameToLoad: string;
    existingProjects: string[];
  }>({ show: false, projectNameToLoad: '', existingProjects: [] });

  // Load project
  const handleLoadProject = async (projectName: string, force: boolean = false) => {
    try {
      const response = await authenticatedFetch(`/api/projects/load?force=${force}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project_name: projectName }),
      });
      
      const result = await response.json();
      
      if (response.status === 409) {
        // Unsaved changes detected - show dialog
        setUnsavedChangesDialog({ show: true, projectName });
        return;
      }
      
      if (response.ok && result.success) {
        // Set the current project name in the store
        const setCurrentProjectName = useFlowStore.getState().setCurrentProjectName;
        setCurrentProjectName(projectName);
        
        setMessage({ type: 'success', text: result.message || 'Project loaded successfully' });
        if (result.warnings && result.warnings.length > 0) {
          setTimeout(() => {
            setMessage({ type: 'error', text: result.warnings.join('; ') });
          }, 2000);
        }
        // Navigate back to flow editor using React Router (no page reload)
        // This preserves the WebSocket connection and state, allowing graph_state
        // events to arrive properly without race conditions
        navigate('/');
      } else {
        setMessage({ type: 'error', text: result.detail || result.message || 'Failed to load project' });
        setTimeout(() => setMessage(null), 5000);
      }
    } catch {
      setMessage({ type: 'error', text: 'Load failed: Network error' });
      setTimeout(() => setMessage(null), 5000);
    }
  };

  // Handle unsaved changes dialog actions
  const handleSaveAndLoad = async () => {
    const projectNameToLoad = unsavedChangesDialog.projectName;
    setUnsavedChangesDialog({ show: false, projectName: '' });
    
    // Fetch existing projects and show save dialog
    try {
      const response = await authenticatedFetch('/api/projects');
      if (response.ok) {
        const data = await response.json();
        const existingProjects = buildExistingProjectNames(data);
        setSaveDialogState({
          show: true,
          projectNameToLoad,
          existingProjects,
        });
      } else {
        // If we can't fetch projects, just show dialog with empty list
        setSaveDialogState({
          show: true,
          projectNameToLoad,
          existingProjects: [],
        });
      }
    } catch {
      // On error, show dialog with empty list
      setSaveDialogState({
        show: true,
        projectNameToLoad,
        existingProjects: [],
      });
    }
  };

  const handleDiscardAndLoad = async () => {
    setUnsavedChangesDialog({ show: false, projectName: '' });
    await handleLoadProject(unsavedChangesDialog.projectName, true);
  };

  const handleCancelLoad = () => {
    setUnsavedChangesDialog({ show: false, projectName: '' });
  };

  // Handle save project dialog (when saving before loading)
  const handleSaveProjectAndLoad = async (projectName: string, overwrite: boolean) => {
    try {
      // Save the current project
      const response = await authenticatedFetch('/api/projects/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_name: projectName,
          overwrite: overwrite,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        setMessage({ type: 'error', text: error.detail || 'Failed to save project' });
        setTimeout(() => setMessage(null), 5000);
        return;
      }

      const result = await response.json();
      setMessage({ type: 'success', text: result.message || 'Project saved successfully' });
      
      // Close save dialog
      const projectNameToLoad = saveDialogState.projectNameToLoad;
      setSaveDialogState({ show: false, projectNameToLoad: '', existingProjects: [] });
      
      // Now load the new project
      await handleLoadProject(projectNameToLoad, true);
    } catch (error: any) {
      setMessage({ type: 'error', text: error?.message || 'Failed to save project' });
      setTimeout(() => setMessage(null), 5000);
    }
  };

  const handleCancelSaveDialog = () => {
    setSaveDialogState({ show: false, projectNameToLoad: '', existingProjects: [] });
  };

  // Delete project
  const handleDeleteProject = async (projectPath: string) => {
    const projectName = projectPath.split('/').pop() || projectPath;
    if (!confirm(`Delete project "${projectName}"?`)) return;
    
    try {
      const response = await authenticatedFetch(`/api/projects/${encodeURIComponent(projectPath)}`, {
        method: 'DELETE',
      });
      
      if (response.ok) {
        setMessage({ type: 'success', text: 'Project deleted' });
        fetchProjects();
        if (selectedItem === projectPath) setSelectedItem(null);
      } else {
        const result = await response.json();
        setMessage({ type: 'error', text: result.detail || 'Failed to delete project' });
      }
    } catch {
      setMessage({ type: 'error', text: 'Delete failed: Network error' });
    }
    setTimeout(() => setMessage(null), 3000);
  };

  // Search packages on PyPI
  const handleSearchPackages = async (query: string) => {
    if (!query || query.length < 2) {
      setPackageSuggestions([]);
      return;
    }
    
    setSearchingPackages(true);
    try {
      const response = await fetch(`/api/packages/search?q=${encodeURIComponent(query)}`);
      if (response.ok) {
        const data = await response.json();
        setPackageSuggestions(data.results || []);
        setShowSuggestions(true);
      }
    } catch (error) {
      console.error('Error searching packages:', error);
      // Don't show error to user, just don't show suggestions
      setPackageSuggestions([]);
    } finally {
      setSearchingPackages(false);
    }
  };

  // Install package
  const handleInstallPackage = async () => {
    if (!newPackageName.trim()) return;
    
    setInstallingPackage(true);
    try {
      // Parse package name and optional version
      const parts = newPackageName.trim().split(/(==|>=|<=|>|<)/);
      const packageName = parts[0].trim();
      const version = parts.length > 1 ? parts.slice(1).join('') : undefined;
      
      const response = await authenticatedFetch('/api/packages/install', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          package_name: packageName,
          version: version,
        }),
      });
      
      if (response.ok) {
        const result = await response.json();
        setMessage({ type: 'success', text: result.message || 'Package installed successfully' });
        setNewPackageName('');
        fetchPackages();
      } else {
        const error = await response.json();
        setMessage({ type: 'error', text: error.detail || 'Failed to install package' });
      }
    } catch {
      setMessage({ type: 'error', text: 'Install failed: Network error' });
    } finally {
      setInstallingPackage(false);
      setTimeout(() => setMessage(null), 5000);
    }
  };

  // Uninstall package
  const handleUninstallPackage = async (packageName: string) => {
    if (!confirm(`Uninstall package "${packageName}"?`)) return;
    
    try {
      const response = await authenticatedFetch(`/api/packages/${encodeURIComponent(packageName)}`, {
        method: 'DELETE',
      });
      
      if (response.ok) {
        const result = await response.json();
        setMessage({ type: 'success', text: result.message || 'Package uninstalled successfully' });
        fetchPackages();
      } else {
        const error = await response.json();
        setMessage({ type: 'error', text: error.detail || 'Failed to uninstall package' });
      }
    } catch {
      setMessage({ type: 'error', text: 'Uninstall failed: Network error' });
    }
    setTimeout(() => setMessage(null), 5000);
  };

  // Toggle library enabled state
  const handleToggleLibraryEnabled = async (libraryPath: string, enabled: boolean) => {
    try {
      const response = await authenticatedFetch(`/api/workspace/libraries/${encodeURIComponent(libraryPath)}/toggle-enabled`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      });
      
      if (response.ok) {
        setMessage({ type: 'success', text: `Library ${enabled ? 'enabled' : 'disabled'}` });
        fetchLibraries();
        window.dispatchEvent(new CustomEvent('refresh-libraries'));
      } else {
        const error = await response.json();
        setMessage({ type: 'error', text: error.detail || 'Failed to toggle library' });
      }
    } catch {
      setMessage({ type: 'error', text: 'Toggle failed: Network error' });
    }
    setTimeout(() => setMessage(null), 3000);
  };

  // Delete library
  const handleDeleteLibrary = async (libraryPath: string) => {
    const displayName = libraryPath.split('/').pop() || libraryPath;
    if (!confirm(`Delete "${displayName}"?`)) return;
    
    try {
      const response = await authenticatedFetch(`/api/workspace/libraries/${encodeURIComponent(libraryPath)}`, {
        method: 'DELETE',
      });
      
      if (response.ok) {
        setMessage({ type: 'success', text: 'Library deleted' });
        fetchLibraries();
        window.dispatchEvent(new CustomEvent('refresh-libraries'));
        if (selectedItem === libraryPath) setSelectedItem(null);
      } else {
        setMessage({ type: 'error', text: 'Failed to delete library' });
      }
    } catch {
      setMessage({ type: 'error', text: 'Delete failed: Network error' });
    }
    setTimeout(() => setMessage(null), 3000);
  };

  // Open library in editor
  const handleOpenLibrary = async (libraryPath: string, libraryName: string) => {
    try {
      const response = await authenticatedFetch(`/api/workspace/libraries/${encodeURIComponent(libraryPath)}/content`);
      if (response.ok) {
        const content: LibraryContent = await response.json();
        setEditorContent(content.content);
        setEditorPath(libraryPath);
        setEditorTitle(`${libraryName}.py`);
        setEditorError(null);  // Clear any previous errors
        setEditorOpen(true);
      } else {
        setMessage({ type: 'error', text: 'Failed to load library' });
      }
    } catch {
      setMessage({ type: 'error', text: 'Failed to load library' });
    }
  };

  // Save library from editor
  const handleSaveLibrary = async () => {
    if (!editorPath) return;
    
    setSaving(true);
    setEditorError(null);  // Clear previous error
    try {
      const response = await authenticatedFetch(`/api/workspace/libraries/${encodeURIComponent(editorPath)}/content`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: editorContent }),
      });
      
      const result = await response.json();
      
      if (response.ok && result.success) {
        setMessage({ type: 'success', text: `Saved! Nodes: ${result.nodes?.join(', ') || 'none'}` });
        setEditorError(null);
        setEditorOpen(false);
        fetchLibraries();
        window.dispatchEvent(new CustomEvent('refresh-libraries'));
      } else {
        // Show error in the editor instead of background message
        const errorMsg = result.message || result.detail || 'Failed to save';
        setEditorError(errorMsg);
      }
    } catch {
      setEditorError('Save failed: Network error');
    } finally {
      setSaving(false);
    }
  };

  // Download library
  const handleDownloadLibrary = (libraryPath: string, filename: string) => {
    const link = document.createElement('a');
    link.href = `/api/workspace/libraries/${encodeURIComponent(libraryPath)}/download`;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Download project
  const handleDownloadProject = (projectPath: string) => {
    const link = document.createElement('a');
    link.href = `/api/projects/${encodeURIComponent(projectPath)}/download`;
    const projectName = projectPath.split('/').pop() || projectPath;
    link.download = `${projectName}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Download file
  const handleDownloadFile = (filepath: string) => {
    const link = document.createElement('a');
    link.href = `/api/workspace/files/${encodeURIComponent(filepath)}/download`;
    const filename = filepath.split('/').pop() || filepath;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };
  
  // Delete file
  const handleDeleteFile = async (filepath: string) => {
    const filename = filepath.split('/').pop() || filepath;
    if (!confirm(`Delete "${filename}"?`)) return;
    
    try {
      const response = await authenticatedFetch(`/api/workspace/files/${encodeURIComponent(filepath)}`, {
        method: 'DELETE',
      });
      
      if (response.ok) {
        setMessage({ type: 'success', text: 'File deleted' });
        fetchFiles();
        if (selectedItem === filepath) setSelectedItem(null);
      } else {
        const error = await response.json();
        setMessage({ type: 'error', text: error.detail || 'Failed to delete file' });
      }
    } catch {
      setMessage({ type: 'error', text: 'Delete failed: Network error' });
    }
    setTimeout(() => setMessage(null), 3000);
  };

  // Create new folder
  const handleCreateFolder = async () => {
    if (!newItemName.trim()) return;
    
    try {
      let endpoint = '/api/workspace/libraries/folders';
      if (activeTab === 'files') {
        endpoint = '/api/workspace/files/folders';
      } else if (activeTab === 'projects') {
        endpoint = '/api/projects/folders';
      }
      
      const response = await authenticatedFetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newItemName.trim() }),
      });
      
      if (response.ok) {
        setMessage({ type: 'success', text: `Folder created` });
        setShowNewFolderModal(false);
        setNewItemName('');
        if (activeTab === 'libraries') {
          fetchLibraries();
          setExpandedFolders(new Set([...expandedFolders, newItemName.trim()]));
        } else if (activeTab === 'files') {
          fetchFiles();
          setExpandedFolders(new Set([...expandedFolders, newItemName.trim()]));
        } else if (activeTab === 'projects') {
          fetchProjects();
          setExpandedFolders(new Set([...expandedFolders, newItemName.trim()]));
        }
      } else {
        const error = await response.json();
        setMessage({ type: 'error', text: error.detail || 'Failed to create folder' });
      }
    } catch {
      setMessage({ type: 'error', text: 'Failed to create folder' });
    }
    setTimeout(() => setMessage(null), 3000);
  };

  // Create new library file
  const handleCreateLibrary = async () => {
    if (!newItemName.trim()) return;
    
    try {
      const response = await authenticatedFetch('/api/workspace/libraries/files', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newItemName.trim(), folder: newLibraryFolder }),
      });
      
      if (response.ok) {
        const result = await response.json();
        setMessage({ type: 'success', text: `Library created` });
        setShowNewLibraryModal(false);
        setNewItemName('');
        setNewLibraryFolder('');
        fetchLibraries();
        window.dispatchEvent(new CustomEvent('refresh-libraries'));
        // Open the new library in editor
        if (result.library?.path) {
          handleOpenLibrary(result.library.path, result.library.name);
        }
      } else {
        const error = await response.json();
        setMessage({ type: 'error', text: error.detail || 'Failed to create library' });
      }
    } catch {
      setMessage({ type: 'error', text: 'Failed to create library' });
    }
    setTimeout(() => setMessage(null), 3000);
  };

  // Toggle folder expansion
  const toggleFolder = (folderName: string) => {
    const newExpanded = new Set(expandedFolders);
    if (newExpanded.has(folderName)) {
      newExpanded.delete(folderName);
    } else {
      newExpanded.add(folderName);
    }
    setExpandedFolders(newExpanded);
  };

  // Reload libraries (currently unused, kept for potential future use)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const handleReloadLibraries = async () => {
    setLoading(true);
    try {
      const response = await authenticatedFetch('/api/workspace/libraries/reload', { method: 'POST' });
      if (response.ok) {
        setMessage({ type: 'success', text: 'Libraries reloaded' });
        fetchLibraries();
        window.dispatchEvent(new CustomEvent('refresh-libraries'));
      } else {
        setMessage({ type: 'error', text: 'Failed to reload' });
      }
    } catch {
      setMessage({ type: 'error', text: 'Reload failed' });
    }
    setTimeout(() => setMessage(null), 3000);
  };

  // Get file icon
  const getFileIcon = (filename: string) => {
    const ext = filename.split('.').pop()?.toLowerCase();
    switch (ext) {
      case 'csv': return <Table className="w-4 h-4 text-green-400" />;
      case 'xlsx':
      case 'xls': return <Table className="w-4 h-4 text-emerald-400" />;
      case 'json': return <Database className="w-4 h-4 text-yellow-400" />;
      case 'py': return <FileCode className="w-4 h-4 text-blue-400" />;
      default: return <FileText className="w-4 h-4 text-gray-400" />;
    }
  };

  // Format file size
  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className="h-full flex flex-col bg-[#0a0a0a]">
      {/* Python Editor Modal */}
      {editorOpen && (
        <PythonEditor
          code={editorContent}
          onChange={setEditorContent}
          onSave={handleSaveLibrary}
          onClose={() => {
            setEditorOpen(false);
            setEditorError(null);
          }}
          saving={saving}
          title={editorTitle}
          error={editorError}
        />
      )}

      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/10 bg-[#121212]">
        <div className="flex items-center gap-4">
          <h1 className="text-lg font-semibold text-white">Workspace</h1>
          
          {/* Tabs */}
          <div className="flex bg-white/5 rounded-lg p-1">
            <button
              onClick={() => setActiveTab('files')}
              className={`px-3 py-1.5 rounded-md text-sm transition-colors ${
                activeTab === 'files' ? 'bg-[#06E4A8] text-black font-medium' : 'text-gray-400 hover:text-white'
              }`}
            >
              Data Files
            </button>
            <button
              onClick={() => setActiveTab('libraries')}
              className={`px-3 py-1.5 rounded-md text-sm transition-colors ${
                activeTab === 'libraries' ? 'bg-[#06E4A8] text-black font-medium' : 'text-gray-400 hover:text-white'
              }`}
            >
              Libraries
            </button>
            <button
              onClick={() => setActiveTab('projects')}
              className={`px-3 py-1.5 rounded-md text-sm transition-colors ${
                activeTab === 'projects' ? 'bg-[#06E4A8] text-black font-medium' : 'text-gray-400 hover:text-white'
              }`}
            >
              Projects
            </button>
            <button
              onClick={() => setActiveTab('icons')}
              className={`px-3 py-1.5 rounded-md text-sm transition-colors ${
                activeTab === 'icons' ? 'bg-[#06E4A8] text-black font-medium' : 'text-gray-400 hover:text-white'
              }`}
            >
              Icons
            </button>
            {!isLocalMode && (
              <button
                onClick={() => setActiveTab('packages')}
                className={`px-3 py-1.5 rounded-md text-sm transition-colors ${
                  activeTab === 'packages' ? 'bg-[#06E4A8] text-black font-medium' : 'text-gray-400 hover:text-white'
                }`}
              >
                Packages
              </button>
            )}
          </div>
        </div>
        
        <div className="flex items-center gap-2">
          {(activeTab === 'libraries' || activeTab === 'files' || activeTab === 'projects') && (
            <>
              <button
                onClick={() => { setNewItemName(''); setShowNewFolderModal(true); }}
                className="p-2 text-gray-400 hover:text-white transition-colors"
                title="New Folder"
              >
                <FolderPlus className="w-5 h-5" />
              </button>
              {activeTab === 'libraries' && (
                <button
                  onClick={() => { setNewItemName(''); setNewLibraryFolder(''); setShowNewLibraryModal(true); }}
                  className="flex items-center gap-1 px-3 py-1.5 bg-[#06E4A8] text-black rounded-md text-sm font-medium hover:bg-[#04c790] transition-colors"
                >
                  <Plus className="w-4 h-4" />
                  New Library
                </button>
              )}
            </>
          )}
          <button
            onClick={() => {
              if (activeTab === 'files') {
                fetchFiles();
              } else if (activeTab === 'libraries') {
                fetchLibraries();
              } else if (activeTab === 'icons') {
                fetchIcons();
              } else if (activeTab === 'packages' && !isLocalMode) {
                fetchPackages();
              }
            }}
            className="flex items-center gap-1 px-3 py-1.5 bg-white/10 text-white rounded-md text-sm hover:bg-white/20 transition-colors"
            title="Refresh"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
          {activeTab === 'files' && (
            <div className="relative">
              <select
                value={uploadFolder}
                onChange={(e) => setUploadFolder(e.target.value)}
                className="px-3 py-1.5 bg-white/10 text-white rounded-md text-sm border border-white/20 hover:bg-white/20 transition-colors cursor-pointer"
                title="Select folder for upload"
              >
                <option value="">Root (no folder)</option>
                {fileFolders.map((folder) => (
                  <option key={folder.name} value={folder.name}>{folder.name}</option>
                ))}
              </select>
            </div>
          )}
          {activeTab === 'libraries' && (
            <div className="relative">
              <select
                value={libraryUploadFolder}
                onChange={(e) => setLibraryUploadFolder(e.target.value)}
                className="px-3 py-1.5 bg-white/10 text-white rounded-md text-sm border border-white/20 hover:bg-white/20 transition-colors cursor-pointer"
                title="Select folder for upload"
              >
                <option value="">Root (no folder)</option>
                {folders.map((folder) => (
                  <option key={folder.name} value={folder.name}>{folder.name}</option>
                ))}
              </select>
            </div>
          )}
          <label className="cursor-pointer">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept={activeTab === 'files' ? '.csv,.xlsx,.xls,.json,.txt,.parquet' : activeTab === 'icons' ? '.png,.svg,.jpg,.jpeg' : '.py'}
              onChange={(e) => handleFileUpload(e.target.files)}
              className="hidden"
            />
            <div className="flex items-center gap-1 px-3 py-1.5 bg-white/10 text-white rounded-md text-sm hover:bg-white/20 transition-colors">
              <Upload className="w-4 h-4" />
              {uploading ? 'Uploading...' : 'Upload'}
            </div>
          </label>
        </div>
      </div>

      {/* Message */}
      {message && (
        <div className={`mx-4 mt-3 px-4 py-2 rounded-lg flex items-center gap-2 text-sm ${
          message.type === 'success' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'
        }`}>
          {message.type === 'success' ? <Check className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
          {message.text}
        </div>
      )}

      {/* File Explorer */}
      <div className="flex-1 overflow-auto p-4">
        {activeTab === 'files' ? (
          // Files view - with folders
          <div className="space-y-1">
            {fileFolders.length === 0 && files.length === 0 ? (
              <div className="text-center py-12 text-gray-500">
                <File className="w-12 h-12 mx-auto mb-3 opacity-50" />
                <p>No files uploaded yet</p>
              </div>
            ) : (
              <>
                {/* Folders */}
                {fileFolders.map((folder) => {
                  const isExpanded = expandedFolders.has(folder.name);
                  
                  return (
                    <div key={folder.name}>
                      {/* Folder row */}
                      <div
                        className={`flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-white/5 transition-colors cursor-pointer ${
                          selectedItem === `folder:${folder.name}` ? 'bg-white/10' : ''
                        }`}
                        onClick={() => { toggleFolder(folder.name); setSelectedItem(`folder:${folder.name}`); }}
                      >
                        {isExpanded ? (
                          <ChevronDown className="w-4 h-4 text-gray-500" />
                        ) : (
                          <ChevronRight className="w-4 h-4 text-gray-500" />
                        )}
                        {isExpanded ? (
                          <FolderOpen className="w-4 h-4 text-blue-400" />
                        ) : (
                          <Folder className="w-4 h-4 text-blue-400" />
                        )}
                        <span className="flex-1 text-gray-200 text-sm font-medium">{folder.name}</span>
                        <span className="text-xs text-gray-500">{folder.files.length} files</span>
                        <button
                          onClick={(e) => { e.stopPropagation(); handleDeleteFile(folder.name); }}
                          className="p-1 text-gray-500 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all"
                          title="Delete Folder"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                      
                      {/* Folder contents */}
                      {isExpanded && (
                        <div className="ml-6 border-l border-white/10 pl-2">
                          {folder.files.map((file) => (
                            <div
                              key={file.path || file.name}
                              className={`flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-white/5 transition-colors group cursor-pointer ${
                                selectedItem === (file.path || file.name) ? 'bg-white/10' : ''
                              }`}
                              onClick={() => setSelectedItem(file.path || file.name)}
                            >
                              {getFileIcon(file.name)}
                              <span className="flex-1 text-gray-200 text-sm truncate">{file.name}</span>
                              <span className="text-xs text-gray-500">{formatSize(file.size)}</span>
                              <div className="relative menu-container">
                                <button
                                  onClick={(e) => { e.stopPropagation(); setOpenMenuId(openMenuId === file.path ? null : (file.path || file.name)); }}
                                  className="p-1 text-gray-500 hover:text-white opacity-0 group-hover:opacity-100 transition-all"
                                  title="More options"
                                >
                                  <MoreVertical className="w-4 h-4" />
                                </button>
                                {openMenuId === (file.path || file.name) && (
                                  <div className="absolute right-0 top-8 z-50 bg-[#1a1a1a] border border-white/10 rounded-lg shadow-xl min-w-[160px]">
                                    <button
                                      onClick={(e) => { e.stopPropagation(); setOpenMenuId(null); handleDownloadFile(file.path || file.name); }}
                                      className="w-full text-left px-3 py-2 text-sm text-gray-300 hover:bg-white/10 flex items-center gap-2"
                                    >
                                      <Download className="w-4 h-4" />
                                      Download
                                    </button>
                                    <button
                                      onClick={(e) => { 
                                        e.stopPropagation(); 
                                        setOpenMenuId(null); 
                                        const fileName = (file.path || file.name).split('/').pop() || file.name;
                                        setItemToRename(file.path || file.name);
                                        setRenameDialogType('file');
                                        setRenameNewName(fileName);
                                        setShowRenameDialog(true);
                                      }}
                                      className="w-full text-left px-3 py-2 text-sm text-gray-300 hover:bg-white/10 flex items-center gap-2"
                                    >
                                      <Edit className="w-4 h-4" />
                                      Rename
                                    </button>
                                    <button
                                      onClick={(e) => { e.stopPropagation(); setOpenMenuId(null); handleDuplicateFile(file.path || file.name); }}
                                      className="w-full text-left px-3 py-2 text-sm text-gray-300 hover:bg-white/10 flex items-center gap-2"
                                    >
                                      <Copy className="w-4 h-4" />
                                      Duplicate
                                    </button>
                                    <button
                                      onClick={(e) => { e.stopPropagation(); setOpenMenuId(null); setItemToMove(file.path || file.name); setMoveDialogType('file'); setMoveTargetFolder(''); setShowMoveDialog(true); }}
                                      className="w-full text-left px-3 py-2 text-sm text-gray-300 hover:bg-white/10 flex items-center gap-2"
                                    >
                                      <Move className="w-4 h-4" />
                                      Move
                                    </button>
                                    <button
                                      onClick={(e) => { e.stopPropagation(); setOpenMenuId(null); handleDeleteFile(file.path || file.name); }}
                                      className="w-full text-left px-3 py-2 text-sm text-red-400 hover:bg-white/10 flex items-center gap-2"
                                    >
                                      <Trash2 className="w-4 h-4" />
                                      Delete
                                    </button>
                                  </div>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
                
                {/* Root level files */}
                {files.map((file) => (
                  <div
                    key={file.path || file.name}
                    className={`flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-white/5 transition-colors group cursor-pointer ${
                      selectedItem === (file.path || file.name) ? 'bg-white/10' : ''
                    }`}
                    onClick={() => setSelectedItem(file.path || file.name)}
                  >
                    {getFileIcon(file.name)}
                    <span className="flex-1 text-gray-200 text-sm truncate">{file.name}</span>
                    <span className="text-xs text-gray-500">{formatSize(file.size)}</span>
                    <div className="relative menu-container">
                      <button
                        onClick={(e) => { e.stopPropagation(); setOpenMenuId(openMenuId === file.path ? null : (file.path || file.name)); }}
                        className="p-1 text-gray-500 hover:text-white opacity-0 group-hover:opacity-100 transition-all"
                        title="More options"
                      >
                        <MoreVertical className="w-4 h-4" />
                      </button>
                      {openMenuId === (file.path || file.name) && (
                        <div className="absolute right-0 top-8 z-50 bg-[#1a1a1a] border border-white/10 rounded-lg shadow-xl min-w-[160px]">
                          <button
                            onClick={(e) => { e.stopPropagation(); setOpenMenuId(null); handleDownloadFile(file.path || file.name); }}
                            className="w-full text-left px-3 py-2 text-sm text-gray-300 hover:bg-white/10 flex items-center gap-2"
                          >
                            <Download className="w-4 h-4" />
                            Download
                          </button>
                          <button
                            onClick={(e) => { 
                              e.stopPropagation(); 
                              setOpenMenuId(null); 
                              const fileName = (file.path || file.name).split('/').pop() || file.name;
                              setItemToRename(file.path || file.name);
                              setRenameDialogType('file');
                              setRenameNewName(fileName);
                              setShowRenameDialog(true);
                            }}
                            className="w-full text-left px-3 py-2 text-sm text-gray-300 hover:bg-white/10 flex items-center gap-2"
                          >
                            <Edit className="w-4 h-4" />
                            Rename
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); setOpenMenuId(null); handleDuplicateFile(file.path || file.name); }}
                            className="w-full text-left px-3 py-2 text-sm text-gray-300 hover:bg-white/10 flex items-center gap-2"
                          >
                            <Copy className="w-4 h-4" />
                            Duplicate
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); setOpenMenuId(null); setItemToMove(file.path || file.name); setMoveDialogType('file'); setMoveTargetFolder(''); setShowMoveDialog(true); }}
                            className="w-full text-left px-3 py-2 text-sm text-gray-300 hover:bg-white/10 flex items-center gap-2"
                          >
                            <Move className="w-4 h-4" />
                            Move
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); setOpenMenuId(null); handleDeleteFile(file.path || file.name); }}
                            className="w-full text-left px-3 py-2 text-sm text-red-400 hover:bg-white/10 flex items-center gap-2"
                          >
                            <Trash2 className="w-4 h-4" />
                            Delete
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </>
            )}
          </div>
        ) : activeTab === 'libraries' ? (
          // Libraries view - File Explorer style
          <div className="space-y-1">
            {folders.length === 0 && rootLibraries.length === 0 ? (
              <div className="text-center py-12 text-gray-500">
                <FileCode className="w-12 h-12 mx-auto mb-3 opacity-50" />
                <p>No libraries yet</p>
                <p className="text-sm mt-1">Create a new library to get started</p>
              </div>
            ) : (
              <>
                {/* Folders */}
                {folders.map((folder) => {
                  const isExpanded = expandedFolders.has(folder.name);
                  
                  return (
                    <div key={folder.name}>
                      {/* Folder row */}
                      <div
                        className={`flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-white/5 transition-colors cursor-pointer ${
                          selectedItem === `folder:${folder.name}` ? 'bg-white/10' : ''
                        }`}
                        onClick={() => { toggleFolder(folder.name); setSelectedItem(`folder:${folder.name}`); }}
                      >
                        {isExpanded ? (
                          <ChevronDown className="w-4 h-4 text-gray-500" />
                        ) : (
                          <ChevronRight className="w-4 h-4 text-gray-500" />
                        )}
                        {isExpanded ? (
                          <FolderOpen className={`w-4 h-4 ${folder.is_default ? 'text-yellow-400' : 'text-blue-400'}`} />
                        ) : (
                          <Folder className={`w-4 h-4 ${folder.is_default ? 'text-yellow-400' : 'text-blue-400'}`} />
                        )}
                        <span className="flex-1 text-gray-200 text-sm font-medium">{folder.name}</span>
                        <span className="text-xs text-gray-500">{folder.libraries.length} files</span>
                      </div>
                      
                      {/* Folder contents */}
                      {isExpanded && (
                        <div className="ml-6 border-l border-white/10 pl-2">
                          {folder.libraries.map((lib) => (
                            <LibraryRow
                              key={lib.path}
                              lib={lib}
                              isSelected={selectedItem === lib.path}
                              onSelect={() => setSelectedItem(lib.path)}
                              onOpen={() => handleOpenLibrary(lib.path, lib.name)}
                              onDownload={() => handleDownloadLibrary(lib.path, lib.filename)}
                              onDelete={() => handleDeleteLibrary(lib.path)}
                              onDuplicate={() => handleDuplicateLibrary(lib.path)}
                              onMove={() => { setItemToMove(lib.path); setMoveDialogType('library'); setMoveTargetFolder(''); setShowMoveDialog(true); }}
                              onRename={(path, currentName) => { setItemToRename(path); setRenameDialogType('library'); setRenameNewName(currentName); setShowRenameDialog(true); }}
                              onToggleEnabled={(enabled) => handleToggleLibraryEnabled(lib.path, enabled)}
                              formatSize={formatSize}
                              openMenuId={openMenuId}
                              setOpenMenuId={setOpenMenuId}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}

                {/* Root-level libraries */}
                {rootLibraries.map((lib) => (
                  <LibraryRow
                    key={lib.path}
                    lib={lib}
                    isSelected={selectedItem === lib.path}
                    onSelect={() => setSelectedItem(lib.path)}
                    onOpen={() => handleOpenLibrary(lib.path, lib.name)}
                    onDownload={() => handleDownloadLibrary(lib.path, lib.filename)}
                    onDelete={() => handleDeleteLibrary(lib.path)}
                    onDuplicate={() => handleDuplicateLibrary(lib.path)}
                    onMove={() => { setItemToMove(lib.path); setMoveDialogType('library'); setMoveTargetFolder(''); setShowMoveDialog(true); }}
                    onRename={(path, currentName) => { setItemToRename(path); setRenameDialogType('library'); setRenameNewName(currentName); setShowRenameDialog(true); }}
                    onToggleEnabled={(enabled) => handleToggleLibraryEnabled(lib.path, enabled)}
                    formatSize={formatSize}
                    openMenuId={openMenuId}
                    setOpenMenuId={setOpenMenuId}
                  />
                ))}
              </>
            )}
          </div>
        ) : activeTab === 'projects' ? (
          // Projects view - with folders
          <div className="space-y-1">
            {projectFolders.length === 0 && projects.length === 0 ? (
              <div className="text-center py-12 text-gray-500">
                <Database className="w-12 h-12 mx-auto mb-3 opacity-50" />
                <p>No projects saved yet</p>
                <p className="text-sm mt-1">Save your workflow from the flow editor</p>
              </div>
            ) : (
              <>
                {/* Folders */}
                {projectFolders.map((folder) => {
                  const isExpanded = expandedFolders.has(folder.name);
                  
                  return (
                    <div key={folder.name}>
                      {/* Folder row */}
                      <div
                        className={`flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-white/5 transition-colors cursor-pointer ${
                          selectedItem === `folder:${folder.name}` ? 'bg-white/10' : ''
                        }`}
                        onClick={() => { toggleFolder(folder.name); setSelectedItem(`folder:${folder.name}`); }}
                      >
                        {isExpanded ? (
                          <ChevronDown className="w-4 h-4 text-gray-500" />
                        ) : (
                          <ChevronRight className="w-4 h-4 text-gray-500" />
                        )}
                        {isExpanded ? (
                          <FolderOpen className="w-4 h-4 text-blue-400" />
                        ) : (
                          <Folder className="w-4 h-4 text-blue-400" />
                        )}
                        <span className="flex-1 text-gray-200 text-sm font-medium">{folder.name}</span>
                        <span className="text-xs text-gray-500">{folder.projects.length} projects</span>
                        <button
                          onClick={(e) => { e.stopPropagation(); handleDeleteProject(folder.name); }}
                          className="p-1 text-gray-500 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all"
                          title="Delete Folder"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                      
                      {/* Folder contents */}
                      {isExpanded && (
                        <div className="ml-6 border-l border-white/10 pl-2">
                          {folder.projects.map((project) => (
                            <div
                              key={project.path || project.name}
                              className={`flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-white/5 transition-colors group cursor-pointer ${
                                selectedItem === (project.path || project.name) ? 'bg-white/10' : ''
                              }`}
                              onClick={() => setSelectedItem(project.path || project.name)}
                            >
                              <Database className="w-4 h-4 text-yellow-400" />
                              <div className="flex-1 min-w-0">
                                <div className="text-gray-200 text-sm truncate">{project.name}</div>
                                <div className="text-xs text-gray-500">
                                  {new Date(project.modified_time * 1000).toLocaleString()}
                                  {project.imported_libraries.length > 0 && (
                                    <span className="ml-2">• {project.imported_libraries.length} lib{project.imported_libraries.length !== 1 ? 's' : ''}</span>
                                  )}
                                </div>
                              </div>
                              <button
                                onClick={(e) => { e.stopPropagation(); handleLoadProject(project.path || project.name); }}
                                className="px-2 py-1 text-xs bg-[#06E4A8] text-black rounded hover:bg-[#04c790] transition-colors opacity-0 group-hover:opacity-100"
                                title="Load Project"
                              >
                                Load
                              </button>
                              <div className="relative menu-container">
                                <button
                                  onClick={(e) => { e.stopPropagation(); setOpenMenuId(openMenuId === `proj-${project.path}` ? null : `proj-${project.path}`); }}
                                  className="p-1 text-gray-500 hover:text-white opacity-0 group-hover:opacity-100 transition-all"
                                  title="More options"
                                >
                                  <MoreVertical className="w-4 h-4" />
                                </button>
                                {openMenuId === `proj-${project.path}` && (
                                  <div className="absolute right-0 top-8 z-50 bg-[#1a1a1a] border border-white/10 rounded-lg shadow-xl min-w-[160px]">
                                    <button
                                      onClick={(e) => { e.stopPropagation(); setOpenMenuId(null); handleDownloadProject(project.path || project.name); }}
                                      className="w-full text-left px-3 py-2 text-sm text-gray-300 hover:bg-white/10 flex items-center gap-2"
                                    >
                                      <Download className="w-4 h-4" />
                                      Download
                                    </button>
                                    <button
                                      onClick={(e) => { 
                                        e.stopPropagation(); 
                                        setOpenMenuId(null); 
                                        const projectName = (project.path || project.name).replace('.json', '').split('/').pop() || project.name.replace('.json', '');
                                        setItemToRename(project.path || project.name);
                                        setRenameDialogType('project');
                                        setRenameNewName(projectName);
                                        setShowRenameDialog(true);
                                      }}
                                      className="w-full text-left px-3 py-2 text-sm text-gray-300 hover:bg-white/10 flex items-center gap-2"
                                    >
                                      <Edit className="w-4 h-4" />
                                      Rename
                                    </button>
                                    <button
                                      onClick={(e) => { e.stopPropagation(); setOpenMenuId(null); handleDuplicateProject(project.path || project.name); }}
                                      className="w-full text-left px-3 py-2 text-sm text-gray-300 hover:bg-white/10 flex items-center gap-2"
                                    >
                                      <Copy className="w-4 h-4" />
                                      Duplicate
                                    </button>
                                    <button
                                      onClick={(e) => { e.stopPropagation(); setOpenMenuId(null); setItemToMove(project.path || project.name); setMoveDialogType('project'); setMoveTargetFolder(''); setShowMoveDialog(true); }}
                                      className="w-full text-left px-3 py-2 text-sm text-gray-300 hover:bg-white/10 flex items-center gap-2"
                                    >
                                      <Move className="w-4 h-4" />
                                      Move
                                    </button>
                                    <button
                                      onClick={(e) => { e.stopPropagation(); setOpenMenuId(null); handleDeleteProject(project.path || project.name); }}
                                      className="w-full text-left px-3 py-2 text-sm text-red-400 hover:bg-white/10 flex items-center gap-2"
                                    >
                                      <Trash2 className="w-4 h-4" />
                                      Delete
                                    </button>
                                  </div>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
                
                {/* Root level projects */}
                {projects.map((project) => (
                  <div
                    key={project.path || project.name}
                    className={`flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-white/5 transition-colors group cursor-pointer ${
                      selectedItem === (project.path || project.name) ? 'bg-white/10' : ''
                    }`}
                    onClick={() => setSelectedItem(project.path || project.name)}
                  >
                    <Database className="w-4 h-4 text-yellow-400" />
                    <div className="flex-1 min-w-0">
                      <div className="text-gray-200 text-sm truncate">{project.name}</div>
                      <div className="text-xs text-gray-500">
                        {new Date(project.modified_time * 1000).toLocaleString()}
                        {project.imported_libraries.length > 0 && (
                          <span className="ml-2">• {project.imported_libraries.length} lib{project.imported_libraries.length !== 1 ? 's' : ''}</span>
                        )}
                      </div>
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleLoadProject(project.path || project.name); }}
                      className="px-2 py-1 text-xs bg-[#06E4A8] text-black rounded hover:bg-[#04c790] transition-colors opacity-0 group-hover:opacity-100"
                      title="Load Project"
                    >
                      Load
                    </button>
                    <div className="relative menu-container">
                      <button
                        onClick={(e) => { e.stopPropagation(); setOpenMenuId(openMenuId === `proj-${project.path}` ? null : `proj-${project.path}`); }}
                        className="p-1 text-gray-500 hover:text-white opacity-0 group-hover:opacity-100 transition-all"
                        title="More options"
                      >
                        <MoreVertical className="w-4 h-4" />
                      </button>
                      {openMenuId === `proj-${project.path}` && (
                        <div className="absolute right-0 top-8 z-50 bg-[#1a1a1a] border border-white/10 rounded-lg shadow-xl min-w-[160px]">
                          <button
                            onClick={(e) => { e.stopPropagation(); setOpenMenuId(null); handleDownloadProject(project.path || project.name); }}
                            className="w-full text-left px-3 py-2 text-sm text-gray-300 hover:bg-white/10 flex items-center gap-2"
                          >
                            <Download className="w-4 h-4" />
                            Download
                          </button>
                          <button
                            onClick={(e) => { 
                              e.stopPropagation(); 
                              setOpenMenuId(null); 
                              const projectName = (project.path || project.name).replace('.json', '').split('/').pop() || project.name.replace('.json', '');
                              setItemToRename(project.path || project.name);
                              setRenameDialogType('project');
                              setRenameNewName(projectName);
                              setShowRenameDialog(true);
                            }}
                            className="w-full text-left px-3 py-2 text-sm text-gray-300 hover:bg-white/10 flex items-center gap-2"
                          >
                            <Edit className="w-4 h-4" />
                            Rename
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); setOpenMenuId(null); handleDuplicateProject(project.path || project.name); }}
                            className="w-full text-left px-3 py-2 text-sm text-gray-300 hover:bg-white/10 flex items-center gap-2"
                          >
                            <Copy className="w-4 h-4" />
                            Duplicate
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); setOpenMenuId(null); setItemToMove(project.path || project.name); setMoveDialogType('project'); setMoveTargetFolder(''); setShowMoveDialog(true); }}
                            className="w-full text-left px-3 py-2 text-sm text-gray-300 hover:bg-white/10 flex items-center gap-2"
                          >
                            <Move className="w-4 h-4" />
                            Move
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); setOpenMenuId(null); handleDeleteProject(project.path || project.name); }}
                            className="w-full text-left px-3 py-2 text-sm text-red-400 hover:bg-white/10 flex items-center gap-2"
                          >
                            <Trash2 className="w-4 h-4" />
                            Delete
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </>
            )}
          </div>
        ) : activeTab === 'icons' ? (
          // Icons view - Grid display
          <div className="p-4">
            {icons.length === 0 ? (
              <div className="text-center py-12 text-gray-500">
                <File className="w-12 h-12 mx-auto mb-3 opacity-50" />
                <p>No icons yet</p>
                <p className="text-sm mt-1">Upload icon files (.png, .svg, .jpg, .jpeg) to get started</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
                {icons.map((icon) => {
                  // Extract icon base name (without extension)
                  const iconBaseName = icon.name.replace(/\.(png|svg|jpg|jpeg)$/i, '');
                  return (
                    <div
                      key={icon.name}
                      className="flex flex-col items-center p-3 bg-white/5 rounded-lg hover:bg-white/10 transition-colors group"
                    >
                      <img
                        src={`/api/icons/${iconBaseName}`}
                        alt={icon.name}
                        className="w-16 h-16 object-contain mb-2 bg-white/5 rounded p-1"
                        onError={(e) => {
                          // Fallback if icon doesn't load
                          (e.target as HTMLImageElement).style.display = 'none';
                        }}
                      />
                    <div className="text-xs text-gray-400 text-center truncate w-full" title={icon.name}>
                      {icon.name}
                    </div>
                    <div className="text-xs text-gray-500 mt-1">
                      {formatSize(icon.size)}
                    </div>
                    <button
                      onClick={async () => {
                        if (confirm(`Delete icon "${icon.name}"?`)) {
                          try {
                            const response = await authenticatedFetch(`/api/workspace/icons/${encodeURIComponent(icon.name)}`, {
                              method: 'DELETE',
                            });
                            if (response.ok) {
                              setMessage({ type: 'success', text: 'Icon deleted' });
                              fetchIcons();
                            } else {
                              const error = await response.json();
                              setMessage({ type: 'error', text: error.detail || 'Failed to delete icon' });
                            }
                          } catch {
                            setMessage({ type: 'error', text: 'Delete failed: Network error' });
                          }
                          setTimeout(() => setMessage(null), 3000);
                        }
                      }}
                      className="mt-2 p-1 text-gray-500 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all"
                      title="Delete Icon"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ) : activeTab === 'packages' && !isLocalMode ? (
          // Packages view
          <div className="space-y-4">
            {/* Python Environment Info */}
            {pythonEnv && (
              <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4">
                <h3 className="text-sm font-semibold text-blue-300 mb-2">Python Environment</h3>
                <div className="space-y-1 text-xs text-gray-300">
                  <div className="flex items-center gap-2">
                    <span className="text-gray-500">Version:</span>
                    <span className="font-mono">{pythonEnv.python_version}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-gray-500">Executable:</span>
                    <span className="font-mono text-gray-400 truncate">{pythonEnv.python_executable}</span>
                  </div>
                  {pythonEnv.in_venv && pythonEnv.venv_path ? (
                    <div className="flex items-center gap-2">
                      <span className="text-gray-500">Virtual Environment:</span>
                      <span className="font-mono text-green-400 truncate">{pythonEnv.venv_path}</span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <span className="text-gray-500">Environment:</span>
                      <span className="text-yellow-400">System Python (not in virtual environment)</span>
                    </div>
                  )}
                </div>
                <p className="text-xs text-gray-500 mt-3">
                  Packages are installed in this Python environment. All script nodes will use packages from this environment.
                </p>
              </div>
            )}

            {/* Install package section */}
            <div className="bg-white/5 rounded-lg p-4">
              <h3 className="text-sm font-semibold text-gray-300 mb-3">Install Package</h3>
              <div className="flex gap-2 relative">
                <div className="flex-1 relative">
                  <input
                    type="text"
                    value={newPackageName}
                    onChange={(e) => {
                      const value = e.target.value;
                      setNewPackageName(value);
                      
                      // Clear previous timeout
                      if (searchTimeoutRef.current) {
                        clearTimeout(searchTimeoutRef.current);
                      }
                      
                      // Search PyPI if there's text (and no version specifiers)
                      if (value.trim() && !value.match(/[=<>]/)) {
                        searchTimeoutRef.current = setTimeout(() => {
                          handleSearchPackages(value.trim());
                        }, 500); // Debounce: wait 500ms after user stops typing
                      } else {
                        setPackageSuggestions([]);
                        setShowSuggestions(false);
                      }
                    }}
                    onFocus={() => {
                      if (packageSuggestions.length > 0) {
                        setShowSuggestions(true);
                      }
                    }}
                    onBlur={() => {
                      // Delay hiding suggestions to allow clicking on them
                      setTimeout(() => setShowSuggestions(false), 200);
                    }}
                    placeholder="Package name (e.g., numpy, pandas, scikit-learn)"
                    className="w-full bg-[#1e1e24] border border-white/20 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-[#06E4A8]"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && newPackageName.trim() && !installingPackage) {
                        handleInstallPackage();
                      } else if (e.key === 'Escape') {
                        setShowSuggestions(false);
                      }
                    }}
                    disabled={installingPackage}
                  />
                  
                  {/* Package suggestions dropdown */}
                  {showSuggestions && packageSuggestions.length > 0 && (
                    <div className="absolute z-50 w-full mt-1 bg-[#1e1e24] border border-white/20 rounded-lg shadow-xl max-h-60 overflow-y-auto">
                      {packageSuggestions.map((suggestion, index) => (
                        <button
                          key={index}
                          onClick={() => {
                            setNewPackageName(suggestion.name);
                            setShowSuggestions(false);
                            setPackageSuggestions([]);
                          }}
                          className="w-full text-left px-3 py-2 hover:bg-white/10 transition-colors border-b border-white/5 last:border-b-0"
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex-1 min-w-0">
                              <div className="text-sm font-medium text-white truncate">{suggestion.name}</div>
                              {suggestion.description && (
                                <div className="text-xs text-gray-400 truncate mt-0.5">{suggestion.description}</div>
                              )}
                            </div>
                            <div className="text-xs text-gray-500 ml-2 flex-shrink-0">{suggestion.version}</div>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                  
                  {searchingPackages && (
                    <div className="absolute right-3 top-2.5 text-xs text-gray-500">Searching...</div>
                  )}
                </div>
                <button
                  onClick={handleInstallPackage}
                  disabled={!newPackageName.trim() || installingPackage}
                  className="px-4 py-2 bg-[#06E4A8] text-black rounded-lg text-sm font-medium hover:bg-[#04c790] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {installingPackage ? 'Installing...' : 'Install'}
                </button>
              </div>
              <p className="text-xs text-gray-500 mt-2">
                Packages are installed in the current Python environment. You can specify a version like "numpy==1.24.0" or "pandas{'>='}2.0.0".
              </p>
            </div>

            {/* Installed packages list */}
            <div>
              <h3 className="text-sm font-semibold text-gray-300 mb-3">Installed Packages ({packages.length})</h3>
              {packages.length === 0 ? (
                <div className="text-center py-12 text-gray-500">
                  <Database className="w-12 h-12 mx-auto mb-3 opacity-50" />
                  <p>No packages installed</p>
                </div>
              ) : (
                <div className="space-y-1">
                  {packages.map((pkg) => (
                    <div
                      key={pkg.name}
                      className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-white/5 transition-colors group"
                    >
                      <Database className="w-4 h-4 text-blue-400" />
                      <span className="flex-1 text-gray-200 text-sm font-mono">{pkg.name}</span>
                      <span className="text-xs text-gray-500">{pkg.version}</span>
                      <button
                        onClick={() => handleUninstallPackage(pkg.name)}
                        className="p-1 text-gray-500 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all"
                        title="Uninstall Package"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : null}
      </div>

      {/* Modals */}
      {showNewFolderModal && (
        <Modal
          title="New Folder"
          onClose={() => setShowNewFolderModal(false)}
          onSubmit={handleCreateFolder}
          submitLabel="Create"
          disabled={!newItemName.trim()}
        >
          <input
            type="text"
            value={newItemName}
            onChange={(e) => setNewItemName(e.target.value)}
            placeholder="Folder name"
            className="w-full px-4 py-2 bg-white/5 border border-white/10 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-[#06E4A8]"
            autoFocus
            onKeyDown={(e) => e.key === 'Enter' && handleCreateFolder()}
          />
        </Modal>
      )}

      {showNewLibraryModal && (
        <Modal
          title="New Library"
          onClose={() => setShowNewLibraryModal(false)}
          onSubmit={handleCreateLibrary}
          submitLabel="Create"
          disabled={!newItemName.trim()}
        >
          <input
            type="text"
            value={newItemName}
            onChange={(e) => setNewItemName(e.target.value)}
            placeholder="Library name (e.g., my_nodes)"
            className="w-full px-4 py-2 bg-white/5 border border-white/10 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-[#06E4A8] mb-3"
            autoFocus
            onKeyDown={(e) => e.key === 'Enter' && handleCreateLibrary()}
          />
          <select
            value={newLibraryFolder}
            onChange={(e) => setNewLibraryFolder(e.target.value)}
            className="w-full px-4 py-2 bg-white/5 border border-white/10 rounded-lg text-white focus:outline-none focus:border-[#06E4A8]"
          >
            <option value="">Root (no folder)</option>
            {folders.map((f) => (
              <option key={f.name} value={f.name}>{f.name}</option>
            ))}
          </select>
        </Modal>
      )}
      {showMoveDialog && itemToMove && (
        <Modal
          title={`Move ${moveDialogType === 'file' ? 'File' : moveDialogType === 'library' ? 'Library' : 'Project'}`}
          onClose={() => { setShowMoveDialog(false); setItemToMove(null); setMoveTargetFolder(''); }}
          onSubmit={handleMoveItem}
          submitLabel="Move"
        >
          <div className="space-y-4">
            <div>
              <label className="block text-sm text-gray-400 mb-1">{moveDialogType === 'file' ? 'File' : moveDialogType === 'library' ? 'Library' : 'Project'}</label>
              <div className="px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-gray-300">
                {itemToMove.split('/').pop() || itemToMove}
              </div>
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">Move to Folder</label>
              <select
                value={moveTargetFolder}
                onChange={(e) => setMoveTargetFolder(e.target.value)}
                className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white focus:outline-none focus:border-[#06E4A8]"
              >
                <option value="">Root (no folder)</option>
                {(moveDialogType === 'file' ? fileFolders : moveDialogType === 'library' ? folders : projectFolders).map((folder) => (
                  <option key={folder.name} value={folder.name}>{folder.name}</option>
                ))}
              </select>
            </div>
          </div>
        </Modal>
      )}

      {showRenameDialog && itemToRename && (
        <Modal
          title={`Rename ${renameDialogType === 'file' ? 'File' : renameDialogType === 'library' ? 'Library' : 'Project'}`}
          onClose={() => { setShowRenameDialog(false); setItemToRename(null); setRenameNewName(''); }}
          onSubmit={handleRename}
          submitLabel="Rename"
          disabled={!renameNewName.trim()}
        >
          <div className="space-y-4">
            <div>
              <label className="block text-sm text-gray-400 mb-1">Current Name</label>
              <div className="px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-gray-300">
                {itemToRename.split('/').pop() || itemToRename}
              </div>
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">New Name</label>
              <input
                type="text"
                value={renameNewName}
                onChange={(e) => setRenameNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && renameNewName.trim()) {
                    handleRename();
                  } else if (e.key === 'Escape') {
                    setShowRenameDialog(false);
                    setItemToRename(null);
                    setRenameNewName('');
                  }
                }}
                className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white focus:outline-none focus:border-[#06E4A8]"
                placeholder={renameDialogType === 'library' ? 'library_name (without .py)' : renameDialogType === 'project' ? 'project_name (without .json)' : 'file_name'}
                autoFocus
              />
              {renameDialogType === 'library' && (
                <p className="text-xs text-gray-500 mt-1">.py extension will be added automatically</p>
              )}
              {renameDialogType === 'project' && (
                <p className="text-xs text-gray-500 mt-1">.json extension will be added automatically</p>
              )}
            </div>
          </div>
        </Modal>
      )}

      {/* Unsaved Changes Dialog */}
      {unsavedChangesDialog.show && (
        <UnsavedChangesDialog
          onSave={handleSaveAndLoad}
          onDiscard={handleDiscardAndLoad}
          onCancel={handleCancelLoad}
        />
      )}

      {/* Save Project Dialog (when saving before loading) */}
      {saveDialogState.show && (
        <SaveProjectDialog
          onSave={handleSaveProjectAndLoad}
          onCancel={handleCancelSaveDialog}
          existingProjects={saveDialogState.existingProjects}
          projectFolders={projectFolders}
        />
      )}
    </div>
  );
}

// Library row component
interface LibraryRowProps {
  lib: WorkspaceLibrary;
  isSelected: boolean;
  onSelect: () => void;
  onOpen: () => void;
  onDownload: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onMove: () => void;
  onRename: (path: string, currentName: string) => void;
  onToggleEnabled?: (enabled: boolean) => void;
  formatSize: (bytes: number) => string;
  openMenuId: string | null;
  setOpenMenuId: (id: string | null) => void;
}

function LibraryRow({ lib, isSelected, onSelect, onOpen, onDownload, onDelete, onDuplicate, onMove, onRename, onToggleEnabled, formatSize, openMenuId, setOpenMenuId }: LibraryRowProps) {
  // Only show checkbox for non-helper libraries
  const showCheckbox = !lib.is_helper && onToggleEnabled !== undefined;
  const menuId = `lib-${lib.path}`;
  
  return (
    <div
      className={`flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-white/5 transition-colors group cursor-pointer ${
        isSelected ? 'bg-white/10' : ''
      }`}
      onClick={onSelect}
      onDoubleClick={onOpen}
    >
      {/* Checkbox for enabling/disabling library */}
      {showCheckbox ? (
        <input
          type="checkbox"
          checked={lib.enabled ?? true}
          onChange={(e) => {
            e.stopPropagation();
            onToggleEnabled?.(e.target.checked);
          }}
          onClick={(e) => e.stopPropagation()}
          className="w-4 h-4 rounded border-white/20 bg-white/5 text-[#06E4A8] focus:ring-[#06E4A8] focus:ring-offset-0 cursor-pointer"
          title={lib.enabled ? "Disable library" : "Enable library"}
        />
      ) : (
        <div className="w-4 h-4" /> // Spacer for alignment
      )}
      <FileCode className={`w-4 h-4 ${lib.is_helper ? 'text-purple-400' : 'text-blue-400'}`} />
      <span className="flex-1 text-gray-200 text-sm truncate">{lib.filename}</span>
      {lib.is_helper ? (
        <span className="px-1.5 py-0.5 rounded text-xs bg-purple-500/20 text-purple-400">
          Helper
        </span>
      ) : (
        <span className={`px-1.5 py-0.5 rounded text-xs ${lib.loaded ? 'bg-green-500/20 text-green-400' : 'bg-yellow-500/20 text-yellow-400'}`}>
          {lib.loaded ? `${lib.nodes.length}` : '0'}
        </span>
      )}
      {lib.size && (
        <span className="text-xs text-gray-500">{formatSize(lib.size)}</span>
      )}
      <div className="relative menu-container">
        <button
          onClick={(e) => { e.stopPropagation(); setOpenMenuId(openMenuId === menuId ? null : menuId); }}
          className="p-1 text-gray-500 hover:text-white opacity-0 group-hover:opacity-100 transition-all"
          title="More options"
        >
          <MoreVertical className="w-4 h-4" />
        </button>
        {openMenuId === menuId && (
          <div className="absolute right-0 top-8 z-50 bg-[#1a1a1a] border border-white/10 rounded-lg shadow-xl min-w-[160px]">
            <button
              onClick={(e) => { e.stopPropagation(); setOpenMenuId(null); onDownload(); }}
              className="w-full text-left px-3 py-2 text-sm text-gray-300 hover:bg-white/10 flex items-center gap-2"
            >
              <Download className="w-4 h-4" />
              Download
            </button>
            <button
              onClick={(e) => { 
                e.stopPropagation(); 
                setOpenMenuId(null); 
                const libName = lib.filename.replace('.py', '');
                onRename(lib.path, libName);
              }}
              className="w-full text-left px-3 py-2 text-sm text-gray-300 hover:bg-white/10 flex items-center gap-2"
            >
              <Edit className="w-4 h-4" />
              Rename
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); setOpenMenuId(null); onDuplicate(); }}
              className="w-full text-left px-3 py-2 text-sm text-gray-300 hover:bg-white/10 flex items-center gap-2"
            >
              <Copy className="w-4 h-4" />
              Duplicate
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); setOpenMenuId(null); onMove(); }}
              className="w-full text-left px-3 py-2 text-sm text-gray-300 hover:bg-white/10 flex items-center gap-2"
            >
              <Move className="w-4 h-4" />
              Move
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); setOpenMenuId(null); onDelete(); }}
              className="w-full text-left px-3 py-2 text-sm text-red-400 hover:bg-white/10 flex items-center gap-2"
            >
              <Trash2 className="w-4 h-4" />
              Delete
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// Modal component
interface ModalProps {
  title: string;
  onClose: () => void;
  onSubmit: () => void;
  submitLabel: string;
  disabled?: boolean;
  children: React.ReactNode;
}

function Modal({ title, onClose, onSubmit, submitLabel, disabled, children }: ModalProps) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-[#1a1a1a] rounded-xl p-6 w-96 border border-white/10">
        <h3 className="text-lg font-semibold text-white mb-4">{title}</h3>
        {children}
        <div className="flex justify-end gap-2 mt-4">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-white/10 text-gray-300 rounded-lg hover:bg-white/20 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onSubmit}
            disabled={disabled}
            className="px-4 py-2 bg-[#06E4A8] text-black rounded-lg hover:bg-[#04c790] transition-colors font-medium disabled:opacity-50"
          >
            {submitLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
