import { useEffect, useRef, useCallback } from 'react';
import { useFlowStore } from '../store/flowStore';
import { WSEvent, NodeData } from '../types';

// Determine WebSocket URL based on current window location
const getWebSocketUrl = (): string => {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const hostname = window.location.hostname;
  // Use the same port as the current page (works for both local and server mode)
  const port = window.location.port || (protocol === 'wss:' ? '443' : '80');
  return `${protocol}//${hostname}${port ? `:${port}` : ''}/ws`;
};

const WS_URL = getWebSocketUrl();
const RECONNECT_DELAY = 3000;

export function useWebSocket() {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<number | null>(null);
  
  const setConnectionStatus = useFlowStore((s) => s.setConnectionStatus);
  const addNode = useFlowStore((s) => s.addNode);
  const setNodeExecuted = useFlowStore((s) => s.setNodeExecuted);
  const syncFromBackend = useFlowStore((s) => s.syncFromBackend);
  const setCurrentProjectName = useFlowStore((s) => s.setCurrentProjectName);

  const handleMessage = useCallback((event: MessageEvent) => {
    try {
      const message: WSEvent = JSON.parse(event.data);
      
      switch (message.event) {
        case 'pong':
          // Keep-alive response
          break;
          
        case 'node_model_created':
          // New node created from backend - skip if already added via API response
          if (message.data) {
            const nodeData = message.data as NodeData;
            const existingNodes = useFlowStore.getState().nodes;
            const alreadyExists = existingNodes.some(n => n.id === nodeData.id);
            if (!alreadyExists) {
              addNode(nodeData);
            }
          }
          break;
          
        case 'edge_model_created':
          // Edge created from backend - handled via graph sync
          break;
          
        case 'execute_state_updated':
          // Node execution state changed
          if (Array.isArray(message.data) && message.data.length >= 2) {
            const [state, _message] = message.data;
            const nodeId = message.kwargs?.node_id as string;
            if (nodeId) {
              setNodeExecuted(nodeId, state === 1, state === -1);
            }
          }
          break;
          
        case 'graph_state':
          // Full graph state received
          if (message.data) {
            const graphData = message.data as { nodes: NodeData[]; edges: { id: string; start_socket_id: string; end_socket_id: string }[] };
            syncFromBackend(graphData.nodes || [], graphData.edges || []);
          }
          break;
          
        case 'scene_cleared':
          // For the web app we manage clearing the graph explicitly via the REST
          // API (/api/graph/clear) and local store actions. Relying on this
          // WebSocket event to clear the frontend can race with graph_state
          // updates (e.g. immediately after loading a project), causing the
          // graph to briefly appear and then disappear. So we intentionally
          // ignore this event here.
          break;
          
        default:
          console.log('Unknown WS event:', message.event, message.data);
      }
    } catch (e) {
      console.error('Error parsing WebSocket message:', e);
    }
  }, [addNode, setNodeExecuted, syncFromBackend]);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;
    
    // Don't reconnect if we're already trying to connect
    if (wsRef.current?.readyState === WebSocket.CONNECTING) return;
    
    setConnectionStatus('connecting');
    
    try {
      wsRef.current = new WebSocket(WS_URL);
      
      wsRef.current.onopen = () => {
        console.log('WebSocket connected to', WS_URL);
        setConnectionStatus('connected');
        
        // Request current graph state
        wsRef.current?.send(JSON.stringify({ action: 'get_graph' }));
      };
      
      wsRef.current.onmessage = handleMessage;
      
      wsRef.current.onerror = (error) => {
        console.error('WebSocket error:', error);
        console.error('WebSocket URL:', WS_URL);
        // Don't set status to error immediately - wait for onclose
        // The onclose handler will handle reconnection
      };
      
      wsRef.current.onclose = (event) => {
        console.log('WebSocket disconnected', { 
          code: event.code, 
          reason: event.reason, 
          wasClean: event.wasClean,
          url: WS_URL
        });
        
        // Set status based on close code
        // 1000 = Normal closure (clean close)
        // 1001 = Going away (browser/tab closing)
        // 1006 = Abnormal closure (connection lost)
        if (event.code === 1000 || event.code === 1001) {
          // Clean close - don't show error, just set disconnected
          setConnectionStatus('disconnected');
        } else {
          // Abnormal closure - set to disconnected and try to reconnect
          setConnectionStatus('disconnected');
          // Only reconnect if it wasn't a manual close
          if (event.code !== 1000) {
            reconnectTimeoutRef.current = window.setTimeout(() => {
              console.log('Attempting to reconnect...');
              connect();
            }, RECONNECT_DELAY);
          }
        }
      };
    } catch (error) {
      console.error('Failed to create WebSocket:', error);
      setConnectionStatus('error');
      
      // Try to reconnect after delay even on error
      reconnectTimeoutRef.current = window.setTimeout(() => {
        console.log('Attempting to reconnect after error...');
        connect();
      }, RECONNECT_DELAY);
    }
  }, [handleMessage, setConnectionStatus]);

  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
  }, []);

  const send = useCallback((message: object) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message));
    }
  }, []);

  // Connect on mount
  useEffect(() => {
    console.log('Initializing WebSocket connection to', WS_URL);
    connect();
    
    return () => {
      disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only run once on mount

  // Ping to keep connection alive
  useEffect(() => {
    const pingInterval = setInterval(() => {
      send({ action: 'ping' });
    }, 30000);
    
    return () => clearInterval(pingInterval);
  }, [send]);

  return { send, connect, disconnect };
}

