import { useEffect, useState, useCallback } from 'react';
import { PanelLeftClose, PanelLeft, Maximize2 } from 'lucide-react';
import Toolbar from '../components/Toolbar';
import Sidebar from '../components/Sidebar';
import FlowCanvas from '../components/FlowCanvas';
import PropertiesPanel from '../components/PropertiesPanel';
import ScriptEditorDialog from '../components/ScriptEditorDialog';
import PlotViewer from '../components/PlotViewer';
import DataViewer from '../components/DataViewer';
import SocketContextMenu from '../components/SocketContextMenu';
import WorkspaceDialog from '../components/WorkspaceDialog';
import ExportCodeDialog from '../components/ExportCodeDialog';
import { useFlowStore } from '../store/flowStore';
import { useToast } from '../hooks/useToast';
import { useApi, authenticatedFetch } from '../hooks/useApi';
import { buildExistingProjectNames } from '../utils/projectUtils';
import SaveProjectDialog from '../components/SaveProjectDialog';

export default function FlowEditorPage() {
  const [showScriptEditor, setShowScriptEditor] = useState(false);
  const [scriptEditorNodeId, setScriptEditorNodeId] = useState<string | null>(null);
  const [scriptEditorInitialCode, setScriptEditorInitialCode] = useState<string>('');
  const [showPlotViewer, setShowPlotViewer] = useState(false);
  const [plotViewerNodeId, setPlotViewerNodeId] = useState<string | null>(null);
  const [plotViewerSocketId, setPlotViewerSocketId] = useState<string | null>(null);
  const [showDataViewer, setShowDataViewer] = useState(false);
  const [dataViewerNodeId, setDataViewerNodeId] = useState<string | null>(null);
  const [dataViewerSocketId, setDataViewerSocketId] = useState<string | null>(null);
  const [showSocketContextMenu, setShowSocketContextMenu] = useState(false);
  const [socketContextMenuPos, setSocketContextMenuPos] = useState<{ x: number; y: number } | null>(null);
  const [socketContextMenuNodeId, setSocketContextMenuNodeId] = useState<string | null>(null);
  const [socketContextMenuSocketId, setSocketContextMenuSocketId] = useState<string | null>(null);
  const [showWorkspaceDialog, setShowWorkspaceDialog] = useState(false);
  const [showExportCodeDialog, setShowExportCodeDialog] = useState(false);
  const nodes = useFlowStore((s) => s.nodes);
  const addEdgeToStore = useFlowStore((s) => s.addEdge);
  const edges = useFlowStore((s) => s.edges);
  const cleanupOrphanedEdges = useFlowStore((s) => s.cleanupOrphanedEdges);
  const sidebarOpen = useFlowStore((s) => s.sidebarOpen);
  const toggleSidebar = useFlowStore((s) => s.toggleSidebar);
  const toast = useToast();
  const { syncFromBackend, createNodeFromCode, updateScriptNodeCode, createNode, createEdge, saveProject, listProjects } = useApi();
  const setCurrentProjectName = useFlowStore((s) => s.setCurrentProjectName);
  const currentProjectName = useFlowStore((s) => s.currentProjectName);
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [existingProjects, setExistingProjects] = useState<string[]>([]);
  const [projectFolders, setProjectFolders] = useState<Array<{ name: string; path: string; projects: any[] }>>([]);
  const connectionStatus = useFlowStore((s) => s.connectionStatus);

  // Note: We don't sync on mount here because:
  // 1. The WebSocket connection (useWebSocket hook) automatically requests graph state when it connects
  // 2. When loading a project, the backend emits graph_state via WebSocket which updates the store
  // 3. Syncing here can cause race conditions where we fetch an empty graph before the loaded one arrives
  // If the graph is empty after WebSocket connects, the WebSocket's get_graph request will populate it.

  // Handle script editor dialog opening from script node hover button or properties panel
  useEffect(() => {
    const handleOpenScriptEditor = (event: CustomEvent<{ nodeId: string; code: string }>) => {
      setScriptEditorNodeId(event.detail.nodeId);
      setScriptEditorInitialCode(event.detail.code);
      setShowScriptEditor(true);
    };

    const scriptEditorHandler = (event: Event) => {
      handleOpenScriptEditor(event as CustomEvent<{ nodeId: string; code: string }>);
    };

    window.addEventListener('openScriptEditor', scriptEditorHandler);
    return () => {
      window.removeEventListener('openScriptEditor', scriptEditorHandler);
    };
  }, []);

  const openDataViewerForSocket = useCallback(async (nodeId: string, socketId: string) => {
    try {
      const response = await fetch(
        `/api/socket-data?node_id=${encodeURIComponent(nodeId)}&socket_id=${encodeURIComponent(socketId)}`
      );

      if (!response.ok) {
        toast.error('Failed to load socket data');
        return;
      }

      const result = await response.json();
      if (!result.success) {
        toast.error('Invalid socket data');
        return;
      }

      if (result.data_type === 'plot') {
        setPlotViewerNodeId(nodeId);
        setPlotViewerSocketId(socketId);
        setShowPlotViewer(true);
      } else {
        setDataViewerNodeId(nodeId);
        setDataViewerSocketId(socketId);
        setShowDataViewer(true);
      }
    } catch (error) {
      console.error('Error opening data viewer:', error);
      toast.error('Failed to open data viewer');
    }
  }, [toast]);

  useEffect(() => {
    const dataViewerHandler = (event: Event) => {
      const detail = (event as CustomEvent<{ nodeId: string; socketId: string }>).detail;
      openDataViewerForSocket(detail.nodeId, detail.socketId);
    };

    window.addEventListener('openDataViewer', dataViewerHandler);
    return () => {
      window.removeEventListener('openDataViewer', dataViewerHandler);
    };
  }, [openDataViewerForSocket]);

  // Handle socket context menu opening from socket right-click
  useEffect(() => {
    const handleOpenSocketContextMenu = (event: CustomEvent<{ nodeId: string; socketId: string; x: number; y: number }>) => {
      setSocketContextMenuNodeId(event.detail.nodeId);
      setSocketContextMenuSocketId(event.detail.socketId);
      setSocketContextMenuPos({ x: event.detail.x, y: event.detail.y });
      setShowSocketContextMenu(true);
    };

    const socketContextMenuHandler = (event: Event) => {
      handleOpenSocketContextMenu(event as CustomEvent<{ nodeId: string; socketId: string; x: number; y: number }>);
    };

    window.addEventListener('openSocketContextMenu', socketContextMenuHandler);
    return () => {
      window.removeEventListener('openSocketContextMenu', socketContextMenuHandler);
    };
  }, []);

  // Handle creating Display node from socket context menu
  const handleCreateDisplayNode = async (nodeId: string, socketId: string) => {
    try {
      // Find the source node to get its position
      const sourceNode = nodes.find(n => n.id === nodeId);
      if (!sourceNode) {
        toast.error('Source node not found');
        return;
      }

      // Calculate display node position: to the right of this node
      const displayX = (sourceNode.position?.x || 0) + 250;
      const displayY = (sourceNode.position?.y || 0);

      // Create Display node
      const createResult = await createNode('Display', displayX, displayY);
      const displayNode = createResult?.node;
      const displayInput = displayNode?.input_sockets && displayNode.input_sockets[0]?.id;
      
      if (!displayNode?.id || !displayInput) {
        toast.error('Failed to create Display node');
        return;
      }

      // Create edge in backend and store
      await createEdge(nodeId, socketId, displayNode.id, displayInput);
      addEdgeToStore(nodeId, displayNode.id, socketId, displayInput);
      
      toast.success('Display node created');
    } catch (error: any) {
      console.error('Failed to create display node:', error);
      toast.error(error?.message || 'Failed to create Display node');
    }
  };

  // Handle Ctrl+S / Cmd+S for saving
  const handleSaveProject = async (projectName: string, overwrite: boolean) => {
    try {
      await saveProject(projectName, overwrite);
      setCurrentProjectName(projectName); // Remember the project name
      setShowSaveDialog(false);
      toast.success(`Project "${projectName}" saved`);
    } catch (error) {
      // Error already shown by toast
    }
  };

  useEffect(() => {
    const handleSave = async (event: KeyboardEvent) => {
      // Check for Ctrl+S (Windows/Linux) or Cmd+S (Mac)
      const isSave = (event.ctrlKey || event.metaKey) && event.key === 's';
      if (!isSave) return;

      // Only handle save when not typing in an input/textarea
      const target = event.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return;
      }

      event.preventDefault();

      // If there's a current project, save directly
      if (currentProjectName) {
        try {
          await saveProject(currentProjectName, true);
          toast.success(`Project "${currentProjectName}" saved`);
        } catch (error) {
          // Error already shown by toast
        }
        return;
      }

      // Otherwise, show dialog
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
        setShowSaveDialog(true);
      } catch (error) {
        console.error('Error fetching projects:', error);
        try {
          const projects = await listProjects();
          setExistingProjects(projects.map((p: any) => p.name));
        } catch {
          setExistingProjects([]);
        }
        setProjectFolders([]);
        setShowSaveDialog(true); // Show dialog anyway
      }
    };

    window.addEventListener('keydown', handleSave);
    return () => {
      window.removeEventListener('keydown', handleSave);
    };
  }, [currentProjectName, saveProject, listProjects, toast]);

  // Handle "P" key press to show graph statistics
  useEffect(() => {
    const handleKeyPress = async (event: KeyboardEvent) => {
      // Only trigger if not typing in an input/textarea
      if (event.key === 'p' || event.key === 'P') {
        const target = event.target as HTMLElement;
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
          return;
        }
        
        event.preventDefault();
        
        // Get frontend counts
        const frontendNodes = nodes.length;
        const frontendEdges = edges.length;
        
        // Get backend counts
        try {
          const response = await authenticatedFetch('/api/graph/stats');
          const backendStats = await response.json();
          const backendNodes = backendStats.nodes || 0;
          const backendEdges = backendStats.edges || 0;
          
          // Show comparison
          const message = `Graph Statistics\n\nFrontend:\n  Nodes: ${frontendNodes}\n  Edges: ${frontendEdges}\n\nBackend:\n  Nodes: ${backendNodes}\n  Edges: ${backendEdges}`;
          
          // Show warning if counts don't match
          if (frontendNodes !== backendNodes || frontendEdges !== backendEdges) {
            toast.error(`${message}\n\n⚠️ Counts don't match! Syncing and cleaning up...`, 8000);
            // Clean up orphaned edges first
            cleanupOrphanedEdges();
            // Then sync from backend
            setTimeout(() => {
              syncFromBackend();
            }, 500);
          } else {
            // Even if counts match, clean up orphaned edges to be safe
            cleanupOrphanedEdges();
            toast.info(message, 4000);
          }
        } catch (error) {
          // Fallback to frontend only if backend fails
          toast.info(`Graph Statistics (Frontend)\nNodes: ${frontendNodes}\nEdges: ${frontendEdges}`, 4000);
        }
      }
    };

    window.addEventListener('keydown', handleKeyPress);
    return () => {
      window.removeEventListener('keydown', handleKeyPress);
    };
  }, [nodes, edges, toast, syncFromBackend]);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Main content */}
      <div className="flex flex-1 overflow-hidden relative">
        {/* Left Sidebar - Node Library */}
        <Sidebar />
        
        {/* Sidebar Toggle Button - attached to sidebar like desktop version */}
        <button
          onClick={toggleSidebar}
          className="
            absolute top-1/2 -translate-y-1/2 z-40
            w-5 h-[60px]
            bg-[#06E4A8] hover:bg-[#04c790] border border-[#06E4A8] rounded
            flex items-center justify-center
            transition-all duration-200
            shadow-lg
          "
          style={{
            left: sidebarOpen ? '330px' : '0px',
          }}
          title={sidebarOpen ? 'Hide library' : 'Show library'}
        >
          {sidebarOpen ? (
            <PanelLeftClose className="w-4 h-4 text-black" />
          ) : (
            <PanelLeft className="w-4 h-4 text-black" />
          )}
        </button>
        
        {/* Canvas */}
        <div className="flex-1 relative">
          <FlowCanvas />
          {connectionStatus !== 'connected' && (
            <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/70 text-sm font-semibold text-white pointer-events-auto">
              {connectionStatus === 'connecting' ? 'Connecting, please wait…' : 'Waiting for backend connection…'}
            </div>
          )}
          
          {/* Floating Toolbar - positioned over canvas like desktop version */}
          <div className="absolute top-5 left-1/2 transform -translate-x-1/2 z-40">
            <Toolbar 
              onScriptEditorOpen={() => {
                setScriptEditorNodeId(null);
                setScriptEditorInitialCode('');
                setShowScriptEditor(true);
              }}
              onWorkspaceOpen={() => {
                setShowWorkspaceDialog(true);
              }}
              onExportCode={() => {
                setShowExportCodeDialog(true);
              }}
            />
          </div>
        </div>
        
        {/* Right Sidebar - Properties */}
        <PropertiesPanel />
      </div>

      {/* Script Editor Dialog - rendered at page level for proper z-index */}
      {showScriptEditor && (
        <ScriptEditorDialog
          key={scriptEditorNodeId || 'new'} // Force remount when nodeId changes to use new initialCode
          initialCode={scriptEditorInitialCode}
          onBuild={async (code: string) => {
            try {
              if (scriptEditorNodeId) {
                // Update existing script node
                await updateScriptNodeCode(scriptEditorNodeId, code);
              } else {
                // Create new node from code
                await createNodeFromCode(code);
              }
              setShowScriptEditor(false);
              setScriptEditorNodeId(null);
              setScriptEditorInitialCode('');
            } catch (error) {
              console.error('Failed to build/update script node:', error);
              // Don't close dialog on error so user can fix the code
            }
          }}
          onCancel={() => {
            setShowScriptEditor(false);
            setScriptEditorNodeId(null);
            setScriptEditorInitialCode('');
                }}
              />
            )}

            {/* Plot Viewer Dialog - rendered at page level for proper z-index */}
            {showPlotViewer && plotViewerNodeId && plotViewerSocketId && (
              <PlotViewer
                nodeId={plotViewerNodeId}
                socketId={plotViewerSocketId}
                onClose={() => {
                  setShowPlotViewer(false);
                  setPlotViewerNodeId(null);
                  setPlotViewerSocketId(null);
                }}
              />
            )}

            {/* Data Viewer Dialog - rendered at page level for proper z-index */}
            {showDataViewer && dataViewerNodeId && dataViewerSocketId && (
              <DataViewer
                nodeId={dataViewerNodeId}
                socketId={dataViewerSocketId}
                onClose={() => {
                  setShowDataViewer(false);
                  setDataViewerNodeId(null);
                  setDataViewerSocketId(null);
                }}
              />
            )}

            {/* Socket Context Menu */}
            {showSocketContextMenu && socketContextMenuPos && socketContextMenuNodeId && socketContextMenuSocketId && (
              <SocketContextMenu
                x={socketContextMenuPos.x}
                y={socketContextMenuPos.y}
                nodeId={socketContextMenuNodeId}
                socketId={socketContextMenuSocketId}
                onClose={() => {
                  setShowSocketContextMenu(false);
                  setSocketContextMenuPos(null);
                  setSocketContextMenuNodeId(null);
                  setSocketContextMenuSocketId(null);
                }}
                onCreateDisplayNode={handleCreateDisplayNode}
                onViewOutput={openDataViewerForSocket}
              />
            )}

            {/* Workspace Dialog - rendered at page level for proper z-index */}
            {showWorkspaceDialog && (
              <WorkspaceDialog onClose={() => setShowWorkspaceDialog(false)} />
            )}

            {/* Export Code Dialog - rendered at page level for proper z-index */}
            {showExportCodeDialog && (
              <ExportCodeDialog onClose={() => setShowExportCodeDialog(false)} />
            )}
            
            {/* Save Project Dialog */}
            {showSaveDialog && (
              <SaveProjectDialog
                onSave={handleSaveProject}
                onCancel={() => setShowSaveDialog(false)}
                existingProjects={existingProjects}
                projectFolders={projectFolders}
              />
            )}
          </div>
        );
      }

