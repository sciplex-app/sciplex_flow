import { useCallback } from 'react';
import { useFlowStore } from '../store/flowStore';
import { Libraries, NodeData, AnnotationData } from '../types';
import { useToast } from './useToast';
import { useAuthStore } from '../store/authStore';
import { config } from '../config';

const API_BASE = '/api';

// Helper to add auth headers to fetch requests
function getAuthHeaders(): Record<string, string> {
  // In local mode, no auth headers needed
  if (!config.authEnabled) {
    return {};
  }
  
  const token = useAuthStore.getState().token;
  if (token) {
    return {
      'Authorization': `Bearer ${token}`,
    };
  }
  return {};
}

// Wrapper for fetch that automatically adds auth headers
// Export this so it can be used in other components (WorkspacePage, etc.)
export async function authenticatedFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const headers = new Headers(options.headers);
  const authHeaders = getAuthHeaders();
  Object.entries(authHeaders).forEach(([key, value]) => {
    headers.set(key, value);
  });
  
  return fetch(url, {
    ...options,
    headers,
  });
}

export function useApi() {
  const addNode = useFlowStore((s) => s.addNode);
  const removeNode = useFlowStore((s) => s.removeNode);
  const setLibraries = useFlowStore((s) => s.setLibraries);
  const setExecutionState = useFlowStore((s) => s.setExecutionState);
  const setNodeExecuted = useFlowStore((s) => s.setNodeExecuted);
  const clearGraph = useFlowStore((s) => s.clearGraph);
  const toast = useToast();

  const fetchLibraries = useCallback(async () => {
    try {
      const response = await authenticatedFetch(`${API_BASE}/libraries`);
      if (!response.ok) throw new Error('Failed to fetch libraries');
      
      const libraries: Libraries = await response.json();
      setLibraries(libraries);
      return libraries;
    } catch (error) {
      console.error('Error fetching libraries:', error);
      throw error;
    }
  }, [setLibraries]);

  const createNode = useCallback(async (nodeType: string, x: number, y: number) => {
    try {
      const response = await authenticatedFetch(`${API_BASE}/nodes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          node_type: nodeType,
          position: { x, y },
        }),
      });
      
      const text = await response.text();
      let json: any;
      try {
        json = text ? JSON.parse(text) : {};
      } catch {
        json = {};
      }

      if (!response.ok) {
        const detail = json?.detail || text || 'Failed to create node';
        throw new Error(detail);
      }
      
      if (json?.success && json?.node) {
        addNode(json.node as NodeData);
      }
      return json;
    } catch (error: any) {
      console.error('Error creating node:', error);
      toast.error(error?.message || 'Failed to create node');
      throw error;
    }
  }, [addNode, toast]);

  const deleteNode = useCallback(async (nodeId: string) => {
    try {
      const response = await authenticatedFetch(`${API_BASE}/nodes/${nodeId}`, {
        method: 'DELETE',
      });
      
      if (!response.ok) {
        const error = await response.json();
        const errorMsg = error.detail || 'Failed to delete node';
        toast.error(errorMsg);
        throw new Error(errorMsg);
      }
      
      removeNode(nodeId);
      toast.success('Node deleted successfully');
      return true;
    } catch (error: any) {
      console.error('Error deleting node:', error);
      if (!error.message || !error.message.includes('Failed to delete node')) {
        toast.error(error?.message || 'Failed to delete node');
      }
      throw error;
    }
  }, [removeNode, toast]);

  const updateNodePosition = useCallback(async (nodeId: string, x: number, y: number) => {
    try {
      const response = await authenticatedFetch(`${API_BASE}/nodes/${nodeId}/position`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ x, y }),
      });
      
      if (!response.ok) {
        console.warn('Failed to update node position on server');
      }
    } catch (error) {
      console.error('Error updating node position:', error);
    }
  }, []);

  const updateNodeParameter = useCallback(async (nodeId: string, paramName: string, value: unknown) => {
    try {
      const response = await authenticatedFetch(`${API_BASE}/nodes/${nodeId}/parameter`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          node_id: nodeId,
          parameter_name: paramName,
          value,
        }),
      });
      
      if (!response.ok) {
        const error = await response.json();
        const errorMsg = error.detail || 'Failed to update parameter';
        toast.error(errorMsg);
        throw new Error(errorMsg);
      }
    } catch (error: any) {
      console.error('Error updating parameter:', error);
      if (!error.message || !error.message.includes('Failed to update parameter')) {
        toast.error(error?.message || 'Failed to update parameter');
      }
      throw error;
    }
  }, [toast]);

  const createEdge = useCallback(async (
    sourceNodeId: string,
    sourceSocketId: string,
    targetNodeId: string,
    targetSocketId: string
  ) => {
    try {
      const response = await authenticatedFetch(`${API_BASE}/edges`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source_node_id: sourceNodeId,
          source_socket_id: sourceSocketId,
          target_node_id: targetNodeId,
          target_socket_id: targetSocketId,
        }),
      });
      
      if (!response.ok) {
        const error = await response.json();
        const errorMsg = error.detail || 'Failed to create edge';
        toast.error(errorMsg);
        throw new Error(errorMsg);
      }
      
      return await response.json();
    } catch (error: any) {
      console.error('Error creating edge:', error);
      if (!error.message || !error.message.includes('Failed to create edge')) {
        // Only show toast if it wasn't already shown above
        toast.error(error?.message || 'Failed to create edge');
      }
      throw error;
    }
  }, [toast]);

  const deleteEdge = useCallback(async (edgeId: string) => {
    try {
      const response = await authenticatedFetch(`${API_BASE}/edges/${edgeId}`, {
        method: 'DELETE',
      });
      
      if (!response.ok) {
        const error = await response.json();
        const errorMsg = error.detail || 'Failed to delete edge';
        toast.error(errorMsg);
        return; // Don't throw, just return to prevent double toast
      }
      
      // Remove edge from store
      const removeEdge = useFlowStore.getState().removeEdge;
      removeEdge(edgeId);
      
      toast.success('Edge deleted');
    } catch (error: any) {
      console.error('Error deleting edge:', error);
      // Only show toast if it's a network error (not already shown above)
      if (!error.message?.includes('Failed to delete edge')) {
        toast.error(error?.message || 'Failed to delete edge');
      }
    }
  }, [toast]);

  const executeGraph = useCallback(async () => {
    try {
      setExecutionState('running');
      
      const response = await authenticatedFetch(`${API_BASE}/execute`, {
        method: 'POST',
      });
      
      const result = await response.json();
      
      if (result.success) {
        toast.success(result.message || 'Graph executed successfully');
        setExecutionState('completed');
        
        // Dispatch event to notify Display nodes to refresh their previews
        window.dispatchEvent(new CustomEvent('graphExecutionCompleted'));
      } else {
        toast.error(result.message || 'Graph execution failed');
        setExecutionState('failed');
      }
      
      return result;
    } catch (error: any) {
      console.error('Error executing graph:', error);
      toast.error(error?.message || 'Failed to execute graph');
      setExecutionState('failed');
      throw error;
    }
  }, [setExecutionState, toast]);

  const executeNode = useCallback(async (nodeId: string, singleNodeOnly: boolean = false) => {
    try {
      setExecutionState('running', nodeId);
      
      const query = singleNodeOnly ? '?single_node=true' : '';
      const response = await authenticatedFetch(`${API_BASE}/execute/${nodeId}${query}`, {
        method: 'POST',
      });
      
      const result = await response.json();
      
      if (result.success) {
        toast.success(result.message || 'Node executed successfully');
        setNodeExecuted(nodeId, true, false);
        setExecutionState('completed');
      } else {
        toast.error(result.message || 'Node execution failed');
        setNodeExecuted(nodeId, false, true);
        setExecutionState('failed');
      }
      
      return result;
    } catch (error: any) {
      console.error('Error executing node:', error);
      toast.error(error?.message || 'Failed to execute node');
      setNodeExecuted(nodeId, false, true);
      setExecutionState('failed');
      throw error;
    }
  }, [setExecutionState, setNodeExecuted, toast]);

  const resetNodes = useCallback(async () => {
    try {
      const response = await authenticatedFetch(`${API_BASE}/reset`, {
        method: 'POST',
      });
      
      if (response.ok) {
        // Reset all node states in store
        const nodes = useFlowStore.getState().nodes;
        nodes.forEach((node) => {
          setNodeExecuted(node.id, false, false);
        });
        
        // Dispatch event to notify Display nodes to clear their previews
        window.dispatchEvent(new CustomEvent('resetDisplayNodes'));
      }
    } catch (error) {
      console.error('Error resetting nodes:', error);
    }
  }, [setNodeExecuted]);

  const clearScene = useCallback(async () => {
    try {
      const response = await authenticatedFetch(`${API_BASE}/graph/clear`, {
        method: 'POST',
      });
      
      if (response.ok) {
        clearGraph();
      }
    } catch (error) {
      console.error('Error clearing graph:', error);
    }
  }, [clearGraph]);

  const syncFromBackend = useCallback(async () => {
    try {
      const response = await authenticatedFetch(`${API_BASE}/graph`);
      if (!response.ok) {
        throw new Error('Failed to fetch graph state');
      }
      
      const graphData = await response.json();
      const nodes = graphData.nodes || [];
      const edges = graphData.edges || [];
      const annotations = graphData.annotations || [];
      
      const syncFromBackend = useFlowStore.getState().syncFromBackend;
      syncFromBackend(nodes, edges, annotations);
      
      // Clean up any remaining orphaned edges
      const cleanupOrphanedEdges = useFlowStore.getState().cleanupOrphanedEdges;
      cleanupOrphanedEdges();
      
      const state = useFlowStore.getState();
      toast.success(`Graph synced: ${state.nodes.length} nodes, ${state.edges.length} edges, ${state.annotations.length} annotations`);
    } catch (error: any) {
      console.error('Error syncing from backend:', error);
      toast.error(error?.message || 'Failed to sync from backend');
    }
  }, [toast]);

  const createNodeFromCode = useCallback(async (code: string, position?: { x: number; y: number }) => {
    try {
      // Use provided position or default to center
      const centerX = position?.x ?? 400;
      const centerY = position?.y ?? 300;

      const response = await authenticatedFetch(`${API_BASE}/nodes/from-code`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: code.trim(),
          position: { x: centerX, y: centerY },
        }),
      });
      
      const text = await response.text();
      let json: any;
      try {
        json = text ? JSON.parse(text) : {};
      } catch {
        json = {};
      }

      if (!response.ok) {
        const detail = json?.detail || json?.message || text || 'Failed to build graph from code';
        throw new Error(detail);
      }
      
      if (json?.success) {
        // build_graph_from_python_code can create multiple nodes, so sync from backend
        // to get all the newly created nodes
        setTimeout(() => {
          syncFromBackend();
        }, 100);
        toast.success(json?.message || 'Graph built successfully');
      }
      return json;
    } catch (error: any) {
      console.error('Error building graph from code:', error);
      toast.error(error?.message || 'Failed to build graph from code');
      throw error;
    }
  }, [toast, syncFromBackend]);

  const resetNode = useCallback(async (nodeId: string) => {
    try {
      console.log(`Resetting node: ${nodeId}`);
      const response = await authenticatedFetch(`${API_BASE}/nodes/${nodeId}/reset`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      
      const text = await response.text();
      console.log(`Reset response status: ${response.status}, text: ${text}`);
      
      let json: any;
      try {
        json = text ? JSON.parse(text) : {};
      } catch {
        json = {};
      }

      if (!response.ok) {
        const detail = json?.detail || json?.message || text || 'Failed to reset node';
        console.error('Reset API error:', detail);
        throw new Error(detail);
      }
      
      if (json?.success) {
        // Sync from backend to get updated node state
        setTimeout(() => {
          syncFromBackend();
        }, 100);
        toast.success(json?.message || 'Node reset successfully');
        return json;
      }
      throw new Error(json?.message || 'Failed to reset node');
    } catch (error: any) {
      console.error('Error resetting node:', error);
      toast.error(error?.message || 'Failed to reset node');
      throw error;
    }
  }, [toast, syncFromBackend]);

  const saveNodeToLibrary = useCallback(async (nodeId: string, libraryName: string, isNew: boolean) => {
    try {
      const response = await authenticatedFetch(`${API_BASE}/nodes/${nodeId}/save-to-library`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ library_name: libraryName, is_new: isNew }),
      });
      
      const text = await response.text();
      let json: any;
      try {
        json = text ? JSON.parse(text) : {};
      } catch {
        json = {};
      }

      if (!response.ok) {
        const detail = json?.detail || json?.message || text || 'Failed to save node to library';
        throw new Error(detail);
      }
      
      if (json?.success) {
        // Refresh libraries to show the new node
        setTimeout(() => {
          syncFromBackend();
          // Trigger library refresh event
          window.dispatchEvent(new Event('refresh-libraries'));
        }, 100);
        toast.success(json?.message || 'Node saved to library successfully');
        return json;
      }
      throw new Error(json?.message || 'Failed to save node to library');
    } catch (error: any) {
      console.error('Error saving node to library:', error);
      toast.error(error?.message || 'Failed to save node to library');
      throw error;
    }
  }, [toast, syncFromBackend]);

  const toggleNodeHideInPresentation = useCallback(async (nodeId: string) => {
    try {
      console.log(`Toggling hide for presentation for node: ${nodeId}`);
      const response = await authenticatedFetch(`${API_BASE}/nodes/${nodeId}/toggle-hide-presentation`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      
      const text = await response.text();
      console.log(`Response status: ${response.status}, text: ${text}`);
      
      let json: any;
      try {
        json = text ? JSON.parse(text) : {};
      } catch {
        json = {};
      }

      if (!response.ok) {
        const detail = json?.detail || json?.message || text || 'Failed to toggle hide in presentation';
        console.error('API error:', detail);
        throw new Error(detail);
      }
      
      if (json?.success) {
        // Sync from backend to get updated node
        setTimeout(() => {
          syncFromBackend();
        }, 100);
        return json;
      }
      throw new Error(json?.message || 'Failed to toggle hide in presentation');
    } catch (error: any) {
      console.error('Error toggling hide in presentation:', error);
      toast.error(error?.message || 'Failed to toggle hide in presentation');
      throw error;
    }
  }, [toast, syncFromBackend]);

  const updateScriptNodeCode = useCallback(async (nodeId: string, code: string) => {
    try {
      const response = await authenticatedFetch(`${API_BASE}/nodes/${nodeId}/script-code`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: code.trim() }),
      });
      
      const text = await response.text();
      let json: any;
      try {
        json = text ? JSON.parse(text) : {};
      } catch {
        json = {};
      }

      if (!response.ok) {
        const detail = json?.detail || json?.message || text || 'Failed to update script code';
        throw new Error(detail);
      }
      
      if (json?.success) {
        // Sync from backend to get updated node structure (sockets may have changed)
        setTimeout(() => {
          syncFromBackend();
        }, 100);
        toast.success(json?.message || 'Script node updated successfully');
        return json;
      }
      throw new Error(json?.message || 'Failed to update script code');
    } catch (error: any) {
      console.error('Error updating script code:', error);
      toast.error(error?.message || 'Failed to update script code');
      throw error;
    }
  }, [toast, syncFromBackend]);

  const createAnnotation = useCallback(async (text: string, x: number, y: number) => {
    try {
      const response = await authenticatedFetch(`${API_BASE}/annotations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          position: { x, y },
        }),
      });
      
      const text_response = await response.text();
      let json: any;
      try {
        json = text_response ? JSON.parse(text_response) : {};
      } catch {
        json = {};
      }

      if (!response.ok) {
        const detail = json?.detail || text_response || 'Failed to create annotation';
        throw new Error(detail);
      }
      
      if (json?.success && json?.annotation) {
        const addAnnotation = useFlowStore.getState().addAnnotation;
        addAnnotation(json.annotation as AnnotationData);
        return json.annotation;
      }
      throw new Error('Invalid response from server');
    } catch (error: any) {
      console.error('Error creating annotation:', error);
      toast.error(error?.message || 'Failed to create annotation');
      throw error;
    }
  }, [toast]);

  const updateAnnotation = useCallback(async (annotationId: string, updates: Partial<AnnotationData>) => {
    try {
      const body: any = {};
      if (updates.text !== undefined) body.text = updates.text;
      if (updates.pos_x !== undefined || updates.pos_y !== undefined) {
        body.position = { x: updates.pos_x, y: updates.pos_y };
      }
      if (updates.width !== undefined || updates.height !== undefined) {
        body.dimensions = { width: updates.width, height: updates.height };
      }

      const response = await authenticatedFetch(`${API_BASE}/annotations/${annotationId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      
      const text_response = await response.text();
      let json: any;
      try {
        json = text_response ? JSON.parse(text_response) : {};
      } catch {
        json = {};
      }

      if (!response.ok) {
        const detail = json?.detail || text_response || 'Failed to update annotation';
        throw new Error(detail);
      }
      
      if (json?.success && json?.annotation) {
        const updateAnnotationState = useFlowStore.getState().updateAnnotation;
        updateAnnotationState(annotationId, json.annotation);
        return json.annotation;
      }
      throw new Error('Invalid response from server');
    } catch (error: any) {
      console.error('Error updating annotation:', error);
      toast.error(error?.message || 'Failed to update annotation');
      throw error;
    }
  }, [toast]);

  const deleteAnnotation = useCallback(async (annotationId: string) => {
    try {
      const response = await authenticatedFetch(`${API_BASE}/annotations/${annotationId}`, {
        method: 'DELETE',
      });
      
      if (!response.ok) {
        const error = await response.json().catch(() => ({ detail: 'Failed to delete annotation' }));
        throw new Error(error.detail || 'Failed to delete annotation');
      }
      
      const removeAnnotation = useFlowStore.getState().removeAnnotation;
      removeAnnotation(annotationId);
      return true;
    } catch (error: any) {
      console.error('Error deleting annotation:', error);
      toast.error(error?.message || 'Failed to delete annotation');
      throw error;
    }
  }, [toast]);

  const saveProject = useCallback(async (projectName: string, overwrite: boolean = false) => {
    try {
      // Sync all node positions before saving (positions are updated in real-time on drag,
      // but this ensures everything is synced before save)
      const nodes = useFlowStore.getState().nodes;
      await Promise.all(
        nodes.map(node => 
          updateNodePosition(node.id, node.position.x, node.position.y).catch(err => {
            console.warn(`Failed to sync position for node ${node.id}:`, err);
          })
        )
      );

      const response = await authenticatedFetch(`${API_BASE}/projects/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_name: projectName,
          overwrite: overwrite,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || 'Failed to save project');
      }

      const result = await response.json();
      toast.success(result.message || 'Project saved successfully');
      return result;
    } catch (error: any) {
      console.error('Error saving project:', error);
      // Don't show toast for "already exists" errors - the dialog will handle showing overwrite option
      const msg = error?.message || '';
      if (!msg.includes('already exists')) {
        toast.error(msg || 'Failed to save project');
      }
      throw error;
    }
  }, [toast, updateNodePosition]);

  const listProjects = useCallback(async () => {
    try {
      const response = await authenticatedFetch(`${API_BASE}/projects`);
      if (!response.ok) throw new Error('Failed to fetch projects');
      
      const data = await response.json();
      return data.projects || [];
    } catch (error) {
      console.error('Error fetching projects:', error);
      throw error;
    }
  }, []);

  const copySelection = useCallback(async (nodeIds: string[]) => {
    try {
      const response = await authenticatedFetch(`${API_BASE}/graph/copy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ node_ids: nodeIds }),
      });
      
      const text = await response.text();
      let json: any;
      try {
        json = text ? JSON.parse(text) : {};
      } catch {
        json = {};
      }

      if (!response.ok) {
        const detail = json?.detail || text || 'Failed to copy selection';
        throw new Error(detail);
      }
      
      if (json?.success && json?.data) {
        // Store in clipboard
        await navigator.clipboard.writeText(json.data);
        toast.success('Selection copied to clipboard');
        return json.data;
      }
      throw new Error('Invalid response from server');
    } catch (error: any) {
      console.error('Error copying selection:', error);
      toast.error(error?.message || 'Failed to copy selection');
      throw error;
    }
  }, [toast]);

  const pasteGraph = useCallback(async (data: string, position: { x: number; y: number }) => {
    try {
      const response = await authenticatedFetch(`${API_BASE}/graph/paste`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          data: data,
          position: position,
        }),
      });
      
      const text = await response.text();
      let json: any;
      try {
        json = text ? JSON.parse(text) : {};
      } catch {
        json = {};
      }

      if (!response.ok) {
        const detail = json?.detail || text || 'Failed to paste graph';
        throw new Error(detail);
      }
      
      if (json?.success) {
        // Sync from backend to get newly created nodes
        setTimeout(() => {
          syncFromBackend();
        }, 100);
        toast.success(json?.message || 'Graph pasted successfully');
        return json;
      }
      throw new Error(json?.message || 'Failed to paste graph');
    } catch (error: any) {
      console.error('Error pasting graph:', error);
      toast.error(error?.message || 'Failed to paste graph');
      throw error;
    }
  }, [toast, syncFromBackend]);

  const getSocketSchema = useCallback(async (nodeId: string, socketId: string) => {
    try {
      const response = await authenticatedFetch(`${API_BASE}/socket/${nodeId}/${socketId}/schema`);
      
      const text = await response.text();
      let json: any;
      try {
        json = text ? JSON.parse(text) : {};
      } catch {
        json = {};
      }

      if (!response.ok) {
        const detail = json?.detail || text || 'Failed to get socket schema';
        throw new Error(detail);
      }
      
      if (json?.success) {
        return json.schema || null;
      }
      return null;
    } catch (error: any) {
      console.error('Error getting socket schema:', error);
      toast.error(error?.message || 'Failed to get socket schema');
      throw error;
    }
  }, [toast]);

  return {
    fetchLibraries,
    createNode,
    createNodeFromCode,
    deleteNode,
    resetNode,
    saveNodeToLibrary,
    updateNodePosition,
    updateNodeParameter,
    updateScriptNodeCode,
    toggleNodeHideInPresentation,
    createEdge,
    deleteEdge,
    executeGraph,
    executeNode,
    resetNodes,
    clearScene,
    syncFromBackend,
    createAnnotation,
    updateAnnotation,
    deleteAnnotation,
    saveProject,
    listProjects,
    copySelection,
    pasteGraph,
    getSocketSchema,
  };
}

