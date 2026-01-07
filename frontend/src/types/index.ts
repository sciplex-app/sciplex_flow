// Node and Graph Types

export interface SocketInfo {
  id: string;
  name: string;
  type: string;
  data?: unknown;
  description?: string;
  description_type?: string;
}

export interface ParameterInfo {
  widget: string;
  value: unknown;
  options?: string[];
  range?: [number, number];
  description?: string;
  type?: string;
}

export interface NodeData {
  id: string;
  title: string;
  icon: string;
  library_name: string;
  description?: string;
  input_sockets: SocketInfo[];
  output_sockets: SocketInfo[];
  parameters: Record<string, ParameterInfo>;
  executed?: boolean;
  failed?: boolean;
  pos_x: number;
  pos_y: number;
  hide_for_presentation?: boolean;
  is_script?: boolean;
}

export interface EdgeData {
  id: string;
  start_socket_id: string;
  end_socket_id: string;
  start_node?: NodeData;
  end_node?: NodeData;
}

export interface AnnotationData {
  id: string;
  text: string;
  pos_x: number;
  pos_y: number;
  width: number;
  height: number;
  is_selected?: boolean;
}

export interface GraphData {
  id: string;
  nodes: NodeData[];
  edges: EdgeData[];
  annotations?: AnnotationData[];
}

// Library Types

export interface LibraryNodeInfo {
  name: string;
  icon: string;
  description: string;
  inputs: Array<{ name: string; type: string }>;
  outputs: Array<{ name: string; type: string }>;
  parameters: Record<string, ParameterInfo>;
}

export interface Libraries {
  [libraryName: string]: LibraryNodeInfo[];
}

// WebSocket Event Types

export interface WSEvent {
  event: string;
  data: unknown;
  kwargs?: Record<string, unknown>;
}

// React Flow Types (extended)

export interface FlowNodeData {
  nodeData: NodeData;
  onExecute?: (nodeId: string) => void;
  onDelete?: (nodeId: string) => void;
  onParameterChange?: (nodeId: string, paramName: string, value: unknown) => void;
  [key: string]: unknown; // Index signature to satisfy Record<string, unknown> constraint
}

// Connection state
export type ConnectionStatus = 'connected' | 'connecting' | 'disconnected' | 'error';

// Execution state  
export type ExecutionState = 'idle' | 'running' | 'completed' | 'failed';

// Execution mode (single node vs up-to-node)
export type ExecutionMode = 'single' | 'up_to';

// UI State
export interface UIState {
  selectedNodeId: string | null;
  sidebarOpen: boolean;
  sidebarTab: 'library' | 'properties';
}

