import { create } from 'zustand';
import {
  Node,
  Edge,
  Connection,
  addEdge,
  applyNodeChanges,
  applyEdgeChanges,
  NodeChange,
  EdgeChange,
} from '@xyflow/react';
import { 
  NodeData, 
  Libraries, 
  ConnectionStatus, 
  ExecutionState,
  FlowNodeData,
  AnnotationData
} from '../types';

interface FlowState {
  // React Flow state
  nodes: Node<FlowNodeData>[];
  edges: Edge[];
  
  // Annotations state
  annotations: AnnotationData[];
  
  // Library state
  libraries: Libraries;
  
  // Connection state
  connectionStatus: ConnectionStatus;
  
  // Execution state
  executionState: ExecutionState;
  executingNodeId: string | null;
  singleNodeExecutionMode: boolean;
  
  // UI state
  selectedNodeId: string | null;
  selectedAnnotationId: string | null;
  sidebarOpen: boolean;
  propertiesPanelOpen: boolean;
  
  // Project state
  currentProjectName: string | null;
  
  // Actions - React Flow
  onNodesChange: (changes: NodeChange[]) => void;
  onEdgesChange: (changes: EdgeChange[]) => void;
  onConnect: (connection: Connection) => void;
  
  // Actions - Nodes
  addNode: (nodeData: NodeData) => void;
  removeNode: (nodeId: string) => void;
  updateNodePosition: (nodeId: string, x: number, y: number) => void;
  updateNodeParameter: (nodeId: string, paramName: string, value: unknown) => void;
  setNodeExecuted: (nodeId: string, executed: boolean, failed?: boolean) => void;
  
  // Actions - Edges
  addEdge: (sourceId: string, targetId: string, sourceHandle: string, targetHandle: string, edgeId?: string) => void;
  updateEdgeId: (oldId: string, newId: string) => void;
  removeEdge: (edgeId: string) => void;
  
  // Actions - Annotations
  addAnnotation: (annotation: AnnotationData) => void;
  updateAnnotation: (annotationId: string, updates: Partial<AnnotationData>) => void;
  removeAnnotation: (annotationId: string) => void;
  setAnnotations: (annotations: AnnotationData[]) => void;
  
  // Actions - Libraries
  setLibraries: (libraries: Libraries) => void;
  
  // Actions - Connection
  setConnectionStatus: (status: ConnectionStatus) => void;
  
  // Actions - Execution
  setExecutionState: (state: ExecutionState, nodeId?: string | null) => void;
  
  // Actions - UI
  setSelectedNode: (nodeId: string | null) => void;
  selectNodeInFlow: (nodeId: string) => void;
  setSelectedAnnotation: (annotationId: string | null) => void;
  toggleSidebar: () => void;
  setPropertiesPanelOpen: (open: boolean) => void;
  
  // Actions - Project
  setCurrentProjectName: (projectName: string | null) => void;
  setSingleNodeExecutionMode: (value: boolean) => void;
  toggleSingleNodeExecutionMode: () => void;
  
  // Actions - Sync
  syncFromBackend: (nodes: NodeData[], edges: { id: string; start_socket_id: string; end_socket_id: string }[], annotations?: AnnotationData[]) => void;
  clearGraph: () => void;
  cleanupOrphanedEdges: () => void;
}

// Convert backend node data to React Flow node
const nodeDataToFlowNode = (nodeData: NodeData): Node<FlowNodeData> => {
  // Display nodes use a dedicated node type
  const type =
    nodeData.title === 'Display' || nodeData.library_name === 'Display'
      ? 'display'
      : 'sciplex';

  return {
    id: nodeData.id,
    type,
    position: { x: nodeData.pos_x || 0, y: nodeData.pos_y || 0 },
    data: {
      nodeData,
    },
  };
};

export const useFlowStore = create<FlowState>((set, get) => ({
  // Initial state
  nodes: [],
  edges: [],
  annotations: [],
  libraries: {},
  connectionStatus: 'disconnected',
  executionState: 'idle',
  executingNodeId: null,
  selectedNodeId: null,
  selectedAnnotationId: null,
  sidebarOpen: true,
  propertiesPanelOpen: false,
  singleNodeExecutionMode: false,
  currentProjectName: null,

  // React Flow handlers
  onNodesChange: (changes) => {
    // Filter out position changes from keyboard (arrow keys)
    // We only want viewport panning, not node movement via keyboard
    const filteredChanges = changes.filter(change => {
      if (change.type === 'position') {
        // Allow position changes only if they're from dragging
        // Block position changes that aren't from dragging (keyboard movement)
        return change.dragging === true;
      }
      // Allow all other change types (selection, etc.)
      return true;
    });
    const updatedNodes = applyNodeChanges(filteredChanges, get().nodes) as Node<FlowNodeData>[];
    set({ nodes: updatedNodes });
    
    // Sync selectedNodeId with React Flow's selection state
    const selectedNode = updatedNodes.find(n => n.selected);
    if (selectedNode) {
      set({ selectedNodeId: selectedNode.id });
    } else if (filteredChanges.some(c => c.type === 'select' && !c.selected)) {
      // Only clear selection if it was a deselect action
      set({ selectedNodeId: null });
    }
  },
  
  // Programmatically select a node in React Flow
  selectNodeInFlow: (nodeId: string) => {
    const { nodes, onNodesChange } = get();
    // Create a selection change to select the node
    const changes = nodes.map(node => ({
      id: node.id,
      type: 'select' as const,
      selected: node.id === nodeId,
    }));
    onNodesChange(changes);
  },
  
  onEdgesChange: (changes) => {
    set({ edges: applyEdgeChanges(changes, get().edges) });
  },
  
  onConnect: (connection) => {
    // Create edge via API, then add to state
    const { edges } = get();
    const newEdge: Edge = {
      id: `e-${connection.source}-${connection.target}-${Date.now()}`,
      source: connection.source!,
      target: connection.target!,
      sourceHandle: connection.sourceHandle,
      targetHandle: connection.targetHandle,
      type: 'smoothstep',
      animated: false,
    };
    set({ edges: addEdge(newEdge, edges) });
  },

  // Node actions
  addNode: (nodeData) => {
    // Prevent duplicate nodes
    const existingNodes = get().nodes;
    if (existingNodes.some(n => n.id === nodeData.id)) {
      return;
    }
    const newNode = nodeDataToFlowNode(nodeData);
    set({ nodes: [...existingNodes, newNode] });
  },
  
  removeNode: (nodeId) => {
    set({
      nodes: get().nodes.filter((n) => n.id !== nodeId),
      edges: get().edges.filter((e) => e.source !== nodeId && e.target !== nodeId),
    });
  },
  
  updateNodePosition: (nodeId, x, y) => {
    set({
      nodes: get().nodes.map((node) =>
        node.id === nodeId
          ? { ...node, position: { x, y } }
          : node
      ),
    });
  },
  
  updateNodeParameter: (nodeId, paramName, value) => {
    set({
      nodes: get().nodes.map((node) => {
        if (node.id !== nodeId) return node;
        return {
          ...node,
          data: {
            ...node.data,
            nodeData: {
              ...node.data.nodeData,
              parameters: {
                ...node.data.nodeData.parameters,
                [paramName]: {
                  ...node.data.nodeData.parameters[paramName],
                  value,
                },
              },
            },
          },
        };
      }),
    });
  },
  
  setNodeExecuted: (nodeId, executed, failed = false) => {
    set({
      nodes: get().nodes.map((node) => {
        if (node.id !== nodeId) return node;
        return {
          ...node,
          data: {
            ...node.data,
            nodeData: {
              ...node.data.nodeData,
              executed,
              failed,
            },
          },
        };
      }),
    });
  },

  // Edge actions
  addEdge: (sourceId, targetId, sourceHandle, targetHandle, edgeId?: string) => {
    const newEdge: Edge = {
      id: edgeId || `e-${sourceId}-${targetId}-${Date.now()}`,
      source: sourceId,
      target: targetId,
      sourceHandle,
      targetHandle,
      type: 'smoothstep',
      animated: false,
    };
    set({ edges: [...get().edges, newEdge] });
  },
  
  updateEdgeId: (oldId, newId) => {
    set({
      edges: get().edges.map((e) => (e.id === oldId ? { ...e, id: newId } : e)),
    });
  },
  
  removeEdge: (edgeId) => {
    set({ edges: get().edges.filter((e) => e.id !== edgeId) });
  },

  // Annotation actions
  addAnnotation: (annotation) => {
    set({ annotations: [...get().annotations, annotation] });
  },
  
  updateAnnotation: (annotationId, updates) => {
    set({
      annotations: get().annotations.map((ann) =>
        ann.id === annotationId ? { ...ann, ...updates } : ann
      ),
    });
  },
  
  removeAnnotation: (annotationId) => {
    set({ annotations: get().annotations.filter((ann) => ann.id !== annotationId) });
  },
  
  setAnnotations: (annotations) => set({ annotations }),

  // Library actions
  setLibraries: (libraries) => set({ libraries }),

  // Connection actions
  setConnectionStatus: (status) => set({ connectionStatus: status }),

  // Execution actions
  setExecutionState: (state, nodeId = null) => set({ 
    executionState: state, 
    executingNodeId: nodeId 
  }),

  // UI actions
  setSelectedNode: (nodeId) => set({ selectedNodeId: nodeId }),
  setSelectedAnnotation: (annotationId) => set({ selectedAnnotationId: annotationId }),
  toggleSidebar: () => set({ sidebarOpen: !get().sidebarOpen }),
  setPropertiesPanelOpen: (open) => set({ propertiesPanelOpen: open }),
  setSingleNodeExecutionMode: (value) => set({ singleNodeExecutionMode: value }),
  toggleSingleNodeExecutionMode: () => set((state) => ({ singleNodeExecutionMode: !state.singleNodeExecutionMode })),
  
  // Project actions
  setCurrentProjectName: (projectName) => set({ currentProjectName: projectName }),

  // Sync from backend
  syncFromBackend: (nodes, edges, annotations = []) => {
    // Get existing nodes to preserve execution state
    const existingNodes = get().nodes;
    const executionStateMap = new Map<string, { executed: boolean; failed: boolean }>();
    existingNodes.forEach((node) => {
      if (node.data?.nodeData) {
        executionStateMap.set(node.id, {
          executed: node.data.nodeData.executed || false,
          failed: node.data.nodeData.failed || false,
        });
      }
    });
    
    const flowNodes = nodes.map((nodeData) => {
      const flowNode = nodeDataToFlowNode(nodeData);
      // Preserve execution state from existing nodes if available
      const existingState = executionStateMap.get(nodeData.id);
      if (existingState && flowNode.data?.nodeData) {
        // Only preserve if backend data doesn't have explicit execution state
        // or if backend state is false (not executed) but we had it as executed
        if (flowNode.data.nodeData.executed === undefined || 
            (!flowNode.data.nodeData.executed && existingState.executed)) {
          flowNode.data.nodeData.executed = existingState.executed;
          flowNode.data.nodeData.failed = existingState.failed;
        }
      }
      return flowNode;
    });
    
    const nodeIds = new Set(flowNodes.map(n => n.id));
    
    // Build socket ID to node ID map
    const socketToNode: Record<string, string> = {};
    nodes.forEach((node) => {
      node.input_sockets?.forEach((s) => {
        socketToNode[s.id] = node.id;
      });
      node.output_sockets?.forEach((s) => {
        socketToNode[s.id] = node.id;
      });
    });
    
    // Only create edges that have valid source and target nodes
    const flowEdges: Edge[] = edges
      .filter((edge) => {
        const sourceNodeId = socketToNode[edge.start_socket_id];
        const targetNodeId = socketToNode[edge.end_socket_id];
        return sourceNodeId && targetNodeId && 
               nodeIds.has(sourceNodeId) && nodeIds.has(targetNodeId);
      })
      .map((edge) => ({
        id: edge.id,
        source: socketToNode[edge.start_socket_id],
        target: socketToNode[edge.end_socket_id],
        sourceHandle: edge.start_socket_id,
        targetHandle: edge.end_socket_id,
        type: 'smoothstep',
      }));
    
    // Completely replace state (don't merge)
    set({ 
      nodes: flowNodes, 
      edges: flowEdges,
      annotations: annotations || []
    });
    
    console.log(`[Sync] Synced ${flowNodes.length} nodes, ${flowEdges.length} edges, and ${annotations.length} annotations from backend`);
  },
  
  clearGraph: () => set({ nodes: [], edges: [], annotations: [] }),
  
  // Clean up orphaned edges (edges pointing to non-existent nodes)
  cleanupOrphanedEdges: () => {
    const state = get();
    const nodeIds = new Set(state.nodes.map(n => n.id));
    
    const validEdges = state.edges.filter(edge => 
      nodeIds.has(edge.source) && nodeIds.has(edge.target)
    );
    
    if (validEdges.length !== state.edges.length) {
      set({ edges: validEdges });
    }
  },
}));

