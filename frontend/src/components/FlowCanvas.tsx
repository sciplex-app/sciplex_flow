import { useCallback, useRef, useEffect, useState, useMemo } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  ReactFlowProvider,
  useReactFlow,
  BackgroundVariant,
  NodeTypes,
  Node as ReactFlowNode,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { useFlowStore } from '../store/flowStore';
import { useApi } from '../hooks/useApi';
import SciplexNode from './nodes/SciplexNode';
import DisplayNode from './nodes/DisplayNode';
import NodeContextMenu from './NodeContextMenu';
import PaneContextMenu from './PaneContextMenu';
import SceneAnnotation from './SceneAnnotation';
import SaveToLibraryDialog from './SaveToLibraryDialog';
import { FlowNodeData } from '../types';

// Register custom node types
const nodeTypes: NodeTypes = {
  sciplex: SciplexNode as any, // Type cast needed due to FlowNodeData structure
  display: DisplayNode as any, // Type cast needed due to FlowNodeData structure
};

function FlowCanvasInner() {
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const annotationUpdateTimeoutsRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const { screenToFlowPosition, getNodes, getEdges, getViewport, setViewport } = useReactFlow();
  
  const nodes = useFlowStore((s) => s.nodes);
  const edges = useFlowStore((s) => s.edges);
  const annotations = useFlowStore((s) => s.annotations);
  const selectedAnnotationId = useFlowStore((s) => s.selectedAnnotationId);
  const onNodesChange = useFlowStore((s) => s.onNodesChange);
  const onEdgesChange = useFlowStore((s) => s.onEdgesChange);
  const setSelectedNode = useFlowStore((s) => s.setSelectedNode);
  const setPropertiesPanelOpen = useFlowStore((s) => s.setPropertiesPanelOpen);
  const updateAnnotation = useFlowStore((s) => s.updateAnnotation);
  const setSelectedAnnotation = useFlowStore((s) => s.setSelectedAnnotation);
  
  const { createNode, updateNodePosition, executeNode, createEdge, deleteNode, deleteEdge, resetNode, saveNodeToLibrary, createAnnotation, updateAnnotation: updateAnnotationApi, deleteAnnotation, createNodeFromCode, copySelection, pasteGraph } = useApi();
  
  // Context menu state
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; nodeIds: string[] } | null>(null);
  const [paneContextMenu, setPaneContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [saveDialogOpen, setSaveDialogOpen] = useState<string | null>(null); // nodeId to save
  const [isPanning, setIsPanning] = useState(false);

  // Handle node selection (single click) - don't open properties panel
  const onNodeClick = useCallback((_: React.MouseEvent, node: { id: string }) => {
    setSelectedNode(node.id);
    // Don't open properties panel on node click, only on settings button
  }, [setSelectedNode]);

  // Helper function to check if an edge's path intersects with selection rectangle
  const edgeIntersectsSelection = useCallback((edgeId: string, selectionRect: DOMRect): boolean => {
    // Find edge by checking all edge elements
    const allEdgeElements = document.querySelectorAll('.react-flow__edge');
    
    for (const edgeElement of Array.from(allEdgeElements)) {
      const pathElement = edgeElement.querySelector('.react-flow__edge-path') as SVGPathElement;
      if (!pathElement) continue;
      
      // React Flow v11+ uses data-id on the path element
      // Also check the edge element itself and various ID attributes
      const pathId = pathElement.getAttribute('data-id') || 
                     pathElement.getAttribute('id') || 
                     pathElement.id;
      const edgeIdAttr = edgeElement.getAttribute('data-id') || 
                         edgeElement.getAttribute('id') || 
                         (edgeElement as HTMLElement).id;
      
      // Check if this edge matches our target ID
      const matches = pathId === edgeId || 
                      edgeIdAttr === edgeId ||
                      pathElement.id === edgeId ||
                      (edgeElement as HTMLElement).id === edgeId;
      
      if (matches) {
        const pathRect = pathElement.getBoundingClientRect();
        // Use tolerance to make selection easier (edges are thin)
        const tolerance = 15; // pixels
        const intersects = !(pathRect.right + tolerance < selectionRect.left || 
                            pathRect.left - tolerance > selectionRect.right || 
                            pathRect.bottom + tolerance < selectionRect.top || 
                            pathRect.top - tolerance > selectionRect.bottom);
        
        if (intersects) {
          return true;
        }
      }
    }
    
    return false;
  }, []);

  // Track selection state to detect when selection ends
  const selectionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Handle selection change (for multi-selection via selection box)
  const onSelectionChange = useCallback(({ nodes: selectedNodes }: { nodes: any[] }) => {
    // Update selected node for properties panel (use first selected or null)
    if (selectedNodes.length > 0) {
      setSelectedNode(selectedNodes[0].id);
    } else {
      setSelectedNode(null);
    }
    
    // Clear any pending timeout
    if (selectionTimeoutRef.current) {
      clearTimeout(selectionTimeoutRef.current);
    }
    
    // Check for edges in the selection box - use a small delay to ensure selection box is rendered
    selectionTimeoutRef.current = setTimeout(() => {
      const selectionBox = document.querySelector('.react-flow__nodesselection-rect');
      const currentEdges = getEdges();
      // const flowRect = reactFlowWrapper.current?.getBoundingClientRect() || null; // Currently unused
      
      if (selectionBox) {
        const selectionRect = selectionBox.getBoundingClientRect();
        const edgesToSelect: string[] = [];
        
        // Check all edges for intersection with selection box
        currentEdges.forEach(edge => {
          if (edgeIntersectsSelection(edge.id, selectionRect)) {
            edgesToSelect.push(edge.id);
          }
        });
        
        // Update edge selection state
        if (edgesToSelect.length > 0) {
          console.log('Selecting edges via rectangle:', edgesToSelect);
          onEdgesChange(
            currentEdges.map(edge => ({
              id: edge.id,
              type: 'select' as const,
              selected: edgesToSelect.includes(edge.id),
            }))
          );
        }
      } else if (selectedNodes.length === 0) {
        // If selection box is gone and no nodes selected, check if we should deselect edges
        // Only deselect if no edges are currently selected (to avoid interfering with click selection)
        const hasSelectedEdges = currentEdges.some(e => e.selected);
        if (!hasSelectedEdges) {
          onEdgesChange(
            currentEdges.map(edge => ({
              id: edge.id,
              type: 'select' as const,
              selected: false,
            }))
          );
        }
      }
    }, 50); // Small delay to ensure selection box is fully rendered
  }, [setSelectedNode, getEdges, edgeIntersectsSelection, onEdgesChange]);
  
  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (selectionTimeoutRef.current) {
        clearTimeout(selectionTimeoutRef.current);
      }
    };
  }, []);

  // Handle pane click (deselect and close properties panel)
  const _onPaneClick = useCallback((event: MouseEvent | React.MouseEvent) => {
    setSelectedNode(null);
    setSelectedAnnotation(null); // Deselect annotation
    setPropertiesPanelOpen(false);
    setContextMenu(null); // Close context menu
    setPaneContextMenu(null); // Close pane context menu
  }, [setSelectedNode, setSelectedAnnotation, setPropertiesPanelOpen]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const onPaneClick: any = _onPaneClick;

  // Handle pane context menu (right-click on empty space)
  const onPaneContextMenu = useCallback((event: React.MouseEvent) => {
    event.preventDefault();
    setPaneContextMenu({
      x: event.clientX,
      y: event.clientY,
    });
  }, []);

  // Handle add comment from pane context menu
  const handleAddComment = useCallback(async () => {
    if (!paneContextMenu) return;
    
    // Convert screen coordinates (clientX/clientY) directly to flow coordinates
    const flowPosition = screenToFlowPosition({
      x: paneContextMenu.x,
      y: paneContextMenu.y,
    });
    
    try {
      await createAnnotation('Type Here ...', flowPosition.x, flowPosition.y);
    } catch (error) {
      console.error('Failed to create annotation:', error);
    }
  }, [paneContextMenu, screenToFlowPosition, createAnnotation]);

  // Handle annotation update - immediate local update, debounced API call
  const handleAnnotationUpdate = useCallback((annotationId: string, updates: Partial<any>) => {
    // Update local state immediately for responsive UI
    updateAnnotation(annotationId, updates);
    
    // Clear any pending timeout for this annotation
    const existingTimeout = annotationUpdateTimeoutsRef.current.get(annotationId);
    if (existingTimeout) {
      clearTimeout(existingTimeout);
    }
    
    // Debounce API calls
    // For position updates (dragging), use shorter debounce for responsiveness
    // For text updates, use longer debounce since they're only sent on blur
    const isPositionUpdate = 'pos_x' in updates || 'pos_y' in updates;
    const debounceTime = isPositionUpdate ? 100 : 500;
    
    const timeoutId = setTimeout(async () => {
      try {
        await updateAnnotationApi(annotationId, updates);
        annotationUpdateTimeoutsRef.current.delete(annotationId);
      } catch (error) {
        console.error('Failed to update annotation:', error);
        annotationUpdateTimeoutsRef.current.delete(annotationId);
      }
    }, debounceTime);
    
    annotationUpdateTimeoutsRef.current.set(annotationId, timeoutId);
  }, [updateAnnotation, updateAnnotationApi]);

  // Handle annotation delete
  const handleAnnotationDelete = useCallback(async (annotationId: string) => {
    try {
      await deleteAnnotation(annotationId);
      if (selectedAnnotationId === annotationId) {
        setSelectedAnnotation(null);
      }
    } catch (error) {
      console.error('Failed to delete annotation:', error);
    }
  }, [deleteAnnotation, selectedAnnotationId, setSelectedAnnotation]);

  // Handle Delete key for selected annotation
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Only handle Delete key when not typing in an input/textarea
      const target = event.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return;
      }

      // Delete selected annotation with Delete key
      if (event.key === 'Delete' && selectedAnnotationId) {
        event.preventDefault();
        handleAnnotationDelete(selectedAnnotationId);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [selectedAnnotationId, handleAnnotationDelete]);

  // Handle copy (Ctrl+C / Cmd+C)
  useEffect(() => {
    const handleCopy = async (event: KeyboardEvent) => {
      // Check for Ctrl+C (Windows/Linux) or Cmd+C (Mac)
      const isCopy = (event.ctrlKey || event.metaKey) && event.key === 'c';
      if (!isCopy) return;

      // Only handle copy when not typing in an input/textarea
      const target = event.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return;
      }

      // Get selected nodes
      const currentNodes = getNodes();
      const selectedNodes = currentNodes.filter(n => n.selected);
      
      if (selectedNodes.length === 0) {
        return; // Nothing selected, ignore
      }

      try {
        event.preventDefault();
        const nodeIds = selectedNodes.map(n => n.id);
        await copySelection(nodeIds);
      } catch (error: any) {
        console.error('Error copying selection:', error);
      }
    };

    window.addEventListener('keydown', handleCopy);
    return () => {
      window.removeEventListener('keydown', handleCopy);
    };
  }, [copySelection, getNodes]);

  // Handle paste (Ctrl+V / Cmd+V) - try JSON graph data first, then fall back to code
  useEffect(() => {
    const handlePaste = async (event: KeyboardEvent) => {
      // Check for Ctrl+V (Windows/Linux) or Cmd+V (Mac)
      const isPaste = (event.ctrlKey || event.metaKey) && event.key === 'v';
      if (!isPaste) return;

      // Only handle paste when not typing in an input/textarea
      const target = event.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return;
      }

      try {
        // Get clipboard text
        const clipboardText = await navigator.clipboard.readText();
        if (!clipboardText || !clipboardText.trim()) {
          return; // Empty clipboard, ignore
        }

        // Get viewport center position
        const viewportCenter = screenToFlowPosition({
          x: window.innerWidth / 2,
          y: window.innerHeight / 2,
        });

        event.preventDefault();

        // Try to parse as JSON (graph data)
        try {
          const jsonData = JSON.parse(clipboardText);
          // Check if it looks like graph data
          if (jsonData && (jsonData.graph || (jsonData.nodes && jsonData.edges))) {
            // It's graph data, paste it
            await pasteGraph(clipboardText, viewportCenter);
            return;
          }
        } catch (e) {
          // Not JSON, continue to try as code
        }

        // Not JSON or not graph data, try as Python code
        await createNodeFromCode(clipboardText, viewportCenter);
      } catch (error: any) {
        // Clipboard API might fail (e.g., if not in secure context or user denied permission)
        // Silently ignore - we don't want to show errors for normal paste operations
        console.debug('Could not read clipboard for paste:', error);
      }
    };

    window.addEventListener('keydown', handlePaste);
    return () => {
      window.removeEventListener('keydown', handlePaste);
    };
  }, [createNodeFromCode, pasteGraph, getViewport, screenToFlowPosition]);

  // Get current viewport for annotation positioning (will be called during render)
  const currentViewport = getViewport();

  // Handle node context menu (right-click)
  const onNodeContextMenu = useCallback((event: React.MouseEvent, node: { id: string }) => {
    event.preventDefault();
    
    // Get all selected nodes (support multi-selection)
    // Use filtered nodes if in presentation mode
    const currentNodes = getNodes();
    const selectedNodes = currentNodes.filter(n => n.selected);
    
    // If the right-clicked node is not selected, use just that node
    // Otherwise, use all selected nodes
    const nodeIds = selectedNodes.length > 0 && selectedNodes.some(n => n.id === node.id)
      ? selectedNodes.map(n => n.id)
      : [node.id];
    
    setContextMenu({
      x: event.clientX,
      y: event.clientY,
      nodeIds,
    });
  }, [getNodes]);

  // Handle delete nodes
  const handleDeleteNodes = useCallback(async (nodeIds: string[]) => {
    try {
      await Promise.all(nodeIds.map(nodeId => deleteNode(nodeId)));
    } catch (error) {
      console.error('Failed to delete nodes:', error);
    }
  }, [deleteNode]);

  // Handle reset nodes
  const handleResetNodes = useCallback(async (nodeIds: string[]) => {
    try {
      await Promise.all(nodeIds.map(nodeId => resetNode(nodeId)));
    } catch (error) {
      console.error('Failed to reset nodes:', error);
    }
  }, [resetNode]);

  // Handle save node
  const handleSaveNode = useCallback((nodeId: string) => {
    setSaveDialogOpen(nodeId);
  }, []);

  // Build nodesData map for context menu (isScript, libraryName)
  const nodesData = nodes.reduce((acc, node) => {
    const nodeData = node.data?.nodeData;
    acc[node.id] = {
      isScript: nodeData?.is_script || false,
      libraryName: nodeData?.library_name || '',
    };
    return acc;
  }, {} as Record<string, { isScript: boolean; libraryName: string }>);

  // Handle arrow key navigation (pan the scene)
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Only handle arrow keys when not typing in an input/textarea
      const target = event.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return;
      }

      // Check if arrow key is pressed
      if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) {
        return;
      }

      const panAmount = 20; // pixels to pan per keypress
      const viewport = getViewport();

      // Prevent default to stop React Flow from moving nodes with arrow keys
      event.preventDefault();
      event.stopPropagation();

      switch (event.key) {
        case 'ArrowUp':
          // Pan up: move viewport down (increase y)
          setViewport({ ...viewport, y: viewport.y + panAmount });
          break;
        case 'ArrowDown':
          // Pan down: move viewport up (decrease y)
          setViewport({ ...viewport, y: viewport.y - panAmount });
          break;
        case 'ArrowLeft':
          // Pan left: move viewport left (increase x)
          setViewport({ ...viewport, x: viewport.x + panAmount });
          break;
        case 'ArrowRight':
          // Pan right: move viewport right (decrease x)
          setViewport({ ...viewport, x: viewport.x - panAmount });
          break;
      }
    };

    // Use capture phase to intercept before React Flow handles it
    window.addEventListener('keydown', handleKeyDown, true);
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [getViewport, setViewport]);

  // Handle edge click (select edge)
  const onEdgeClick = useCallback((_: React.MouseEvent, edge: { id: string }) => {
    // Deselect nodes when selecting an edge
    setSelectedNode(null);
    // Explicitly select the clicked edge
    const currentEdges = getEdges();
    onEdgesChange(
      currentEdges.map(e => ({
        id: e.id,
        type: 'select' as const,
        selected: e.id === edge.id,
      }))
    );
  }, [setSelectedNode, getEdges, onEdgesChange]);

  // Handle node drag end - sync position to backend
  const onNodeDragStop = useCallback(
    (_: React.MouseEvent, node: { id: string; position: { x: number; y: number } }) => {
      updateNodePosition(node.id, node.position.x, node.position.y);
    },
    [updateNodePosition]
  );

  // Handle drop from sidebar
  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback(
    async (event: React.DragEvent) => {
      event.preventDefault();

      const data = event.dataTransfer.getData('application/sciplexflow');
      if (!data) return;

      try {
        const { nodeType } = JSON.parse(data);
        
        // Get drop position in flow coordinates
        const position = screenToFlowPosition({
          x: event.clientX,
          y: event.clientY,
        });

        await createNode(nodeType, position.x, position.y);
      } catch (error) {
        console.error('Error creating node:', error);
      }
    },
    [screenToFlowPosition, createNode]
  );

  // Handle connection with API sync
  const handleConnect = useCallback(
    async (connection: { source: string | null; target: string | null; sourceHandle: string | null; targetHandle: string | null }) => {
      if (!connection.source || !connection.target || !connection.sourceHandle || !connection.targetHandle) {
        return;
      }

      // Add edge optimistically to store immediately (before API call)
      // This makes the edge appear instantly, matching the preview
      const addEdge = useFlowStore.getState().addEdge;
      const tempEdgeId = `e-${connection.source}-${connection.target}-${Date.now()}`;
      addEdge(
        connection.source!,
        connection.target!,
        connection.sourceHandle!,
        connection.targetHandle!,
        tempEdgeId
      );

      try {
        // Create edge on backend
        const response = await createEdge(
          connection.source,
          connection.sourceHandle,
          connection.target,
          connection.targetHandle
        );
        
        // If backend returned edge with ID, update the edge ID
        if (response?.edge?.id && response.edge.id !== tempEdgeId) {
          const updateEdgeId = useFlowStore.getState().updateEdgeId;
          updateEdgeId(tempEdgeId, response.edge.id);
        }
      } catch (error) {
        console.error('Error creating edge:', error);
        // Remove the optimistically added edge if backend creation failed
        const removeEdge = useFlowStore.getState().removeEdge;
        removeEdge(tempEdgeId);
      }
    },
    [createEdge]
  );

  // Handle Delete key to delete selected nodes and edges (supports multi-selection)
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Only handle Delete/Backspace if no input is focused
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
        return;
      }

      if (event.key === 'Delete' || event.key === 'Backspace') {
        // Get all selected nodes and edges from React Flow's internal state (most up-to-date)
        const currentNodes = getNodes();
        const currentEdges = getEdges();
        const selectedNodes = currentNodes.filter((node) => node.selected);
        const selectedEdges = currentEdges.filter((edge) => edge.selected);
        
        if (selectedNodes.length > 0 || selectedEdges.length > 0) {
          event.preventDefault();
          
          // Get IDs of nodes being deleted (edges connected to these will be auto-deleted)
          const nodeIdsBeingDeleted = new Set(selectedNodes.map((node) => node.id));
          
          // Filter out edges that are connected to nodes being deleted
          // These edges will be automatically removed when the nodes are deleted
          const standaloneEdges = selectedEdges.filter((edge) => {
            const isConnectedToDeletedNode = nodeIdsBeingDeleted.has(edge.source) || nodeIdsBeingDeleted.has(edge.target);
            return !isConnectedToDeletedNode;
          });
          
          // Delete all selected nodes (this will auto-delete connected edges)
          if (selectedNodes.length > 0) {
            Promise.all(selectedNodes.map((node) => deleteNode(node.id))).catch(console.error);
            setSelectedNode(null);
          }
          
          // Only delete standalone edges (edges not connected to nodes being deleted)
          if (standaloneEdges.length > 0) {
            Promise.all(standaloneEdges.map((edge) => deleteEdge(edge.id))).catch((error) => {
              console.error('Error deleting edges:', error);
            });
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [getNodes, getEdges, deleteNode, deleteEdge, setSelectedNode]);

  // Handle middle mouse button for panning cursor
  useEffect(() => {
    const handleMouseDown = (event: MouseEvent) => {
      // Middle mouse button (button === 1)
      if (event.button === 1) {
        setIsPanning(true);
        // Prevent default to avoid browser back/forward navigation
        event.preventDefault();
      }
    };

    const handleMouseUp = (event: MouseEvent) => {
      if (event.button === 1) {
        setIsPanning(false);
      }
    };

    // Also handle when mouse leaves the window while panning
    const handleMouseLeave = () => {
      setIsPanning(false);
    };

    window.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('mouseup', handleMouseUp);
    window.addEventListener('mouseleave', handleMouseLeave);

    return () => {
      window.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('mouseleave', handleMouseLeave);
    };
  }, []);

  // Update cursor style based on panning state
  useEffect(() => {
    if (reactFlowWrapper.current) {
      const reactFlowPane = reactFlowWrapper.current.querySelector('.react-flow__pane') as HTMLElement;
      if (reactFlowPane) {
        if (isPanning) {
          reactFlowPane.style.cursor = 'grabbing';
          // Also set on the wrapper to ensure it applies
          reactFlowWrapper.current.style.cursor = 'grabbing';
        } else {
          // Show grab cursor when hovering over pane (for middle mouse panning)
          reactFlowPane.style.cursor = 'grab';
          reactFlowWrapper.current.style.cursor = '';
        }
      }
    }
  }, [isPanning]);

  // Add execute handler to node data
  const nodesWithHandlers = useMemo(() => {
    return nodes.map((node) => ({
      ...node,
      data: {
        ...node.data,
        onExecute: executeNode,
      } as FlowNodeData,
    })) as ReactFlowNode<FlowNodeData>[];
  }, [nodes, executeNode]);

  return (
    <div ref={reactFlowWrapper} className="w-full h-full" style={{ cursor: isPanning ? 'grabbing' : 'default' }}>
      <ReactFlow
        nodes={nodesWithHandlers || []}
        edges={edges || []}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={handleConnect}
        onNodeClick={onNodeClick}
        onNodeContextMenu={onNodeContextMenu}
        onEdgeClick={onEdgeClick}
        {...({ onPaneClick } as any)}
        onPaneContextMenu={onPaneContextMenu}
        onNodeDragStop={onNodeDragStop}
        onDragOver={onDragOver}
        onDrop={onDrop}
        onSelectionChange={onSelectionChange}
        nodeTypes={nodeTypes}
        defaultEdgeOptions={{
          type: 'smoothstep',
          animated: false,
          selectable: true,
        }}
        defaultViewport={{ x: 50, y: 50, zoom: 1 }}
        snapToGrid
        snapGrid={[1, 1]}
        minZoom={0.2}
        maxZoom={3}
        proOptions={{ hideAttribution: true }}
        selectionOnDrag
        panOnDrag={[1, 2]}
        zoomOnScroll={true}
        zoomOnScrollSpeed={0.01}
        zoomOnPinch={true}
        zoomOnDoubleClick={false}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={20}
          size={1}
          color="#2a2a30"
        />
        <Controls
          showInteractive={false}
          className="!bg-[#1e1e24] !border-white/10 !shadow-lg"
        />
        <MiniMap
          nodeColor="#06E4A8"
          maskColor="rgba(0, 0, 0, 0.6)"
          className="!bg-[#1e1e24] !border-white/10 !shadow-lg"
          style={{ 
            bottom: '16px',
            right: '16px'
          }}
        />
      </ReactFlow>
      
      {/* Node Context Menu */}
      {contextMenu && (
        <NodeContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          nodeIds={contextMenu.nodeIds}
          onClose={() => setContextMenu(null)}
          onDelete={handleDeleteNodes}
          onReset={handleResetNodes}
          onSave={handleSaveNode}
          nodesData={nodesData}
        />
      )}

      {/* Annotations Overlay - positioned absolutely within canvas container, behind sidebar */}
      {/* Sidebar is in a sibling container, so we use lower z-index to ensure annotations stay behind */}
      <div 
        className="absolute inset-0 pointer-events-none" 
        style={{ zIndex: 0 }}
      >
        {annotations.map((annotation) => (
          <SceneAnnotation
            key={annotation.id}
            annotation={annotation}
            onUpdate={handleAnnotationUpdate}
            onDelete={handleAnnotationDelete}
            onSelect={setSelectedAnnotation}
            isSelected={selectedAnnotationId === annotation.id}
            screenToFlowPosition={screenToFlowPosition}
            viewport={currentViewport}
          />
        ))}
      </div>

      {/* Pane Context Menu */}
      {paneContextMenu && (
        <PaneContextMenu
          x={paneContextMenu.x}
          y={paneContextMenu.y}
          onClose={() => setPaneContextMenu(null)}
          onAddComment={handleAddComment}
        />
      )}

      {/* Save to Library Dialog */}
      {saveDialogOpen && (() => {
        const node = nodes.find(n => n.id === saveDialogOpen);
        const nodeData = node?.data?.nodeData;
        const functionName = nodeData?.title || 'function';
        
        return (
          <SaveToLibraryDialog
            nodeId={saveDialogOpen}
            functionName={functionName}
            onSave={async (libraryName: string, isNew: boolean) => {
              try {
                await saveNodeToLibrary(saveDialogOpen, libraryName, isNew);
                setSaveDialogOpen(null);
              } catch (error) {
                // Error already shown via toast
              }
            }}
            onCancel={() => setSaveDialogOpen(null)}
          />
        );
      })()}
    </div>
  );
}

export default function FlowCanvas() {
  return (
    <ReactFlowProvider>
      <FlowCanvasInner />
    </ReactFlowProvider>
  );
}

