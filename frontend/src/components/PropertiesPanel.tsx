import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useFlowStore } from '../store/flowStore';
import { useApi, authenticatedFetch } from '../hooks/useApi';
import { X, Settings, FolderOpen, RefreshCw, Upload, ChevronDown, ChevronRight } from 'lucide-react';
import { Link } from 'react-router-dom';

interface WorkspaceFile {
  name: string;
  size: number;
  modified: string;
  type: string;
  folder?: string;
  path?: string;
}

interface WorkspaceFileFolder {
  name: string;
  path: string;
  files: WorkspaceFile[];
}

export default function PropertiesPanel() {
  const nodes = useFlowStore((s) => s.nodes);
  const selectedNodeId = useFlowStore((s) => s.selectedNodeId);
  const propertiesPanelOpen = useFlowStore((s) => s.propertiesPanelOpen);
  const setSelectedNode = useFlowStore((s) => s.setSelectedNode);
  const setPropertiesPanelOpen = useFlowStore((s) => s.setPropertiesPanelOpen);
  const updateNodeParameter = useFlowStore((s) => s.updateNodeParameter);
  const { updateNodeParameter: updateNodeParameterApi } = useApi();

  // Workspace files for file selector
  const [workspaceFiles, setWorkspaceFiles] = useState<WorkspaceFile[]>([]);
  const [workspaceFileFolders, setWorkspaceFileFolders] = useState<WorkspaceFileFolder[]>([]);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [expandedFileFolders, setExpandedFileFolders] = useState<Set<string>>(new Set());

  const fetchWorkspaceFiles = useCallback(async () => {
    setLoadingFiles(true);
    try {
      const response = await authenticatedFetch('/api/workspace/files');
      if (response.ok) {
        const data = await response.json();
        setWorkspaceFiles(data.files || []);
        setWorkspaceFileFolders(data.folders || []);
      }
    } catch (error) {
      console.error('Error fetching workspace files:', error);
    } finally {
      setLoadingFiles(false);
    }
  }, []);
  
  const toggleFileFolder = (folderName: string) => {
    const newExpanded = new Set(expandedFileFolders);
    if (newExpanded.has(folderName)) {
      newExpanded.delete(folderName);
    } else {
      newExpanded.add(folderName);
    }
    setExpandedFileFolders(newExpanded);
  };

  // Fetch workspace files when panel opens with a node that has filepath parameter
  useEffect(() => {
    if (!propertiesPanelOpen || !selectedNodeId) return;
    
    const nodeData = nodes.find((n) => n.id === selectedNodeId)?.data?.nodeData;
    if (nodeData) {
      const hasFilePathWidget = Object.values(nodeData.parameters || {}).some(
        (param: any) => param?.widget === 'filepath'
      );
      if (hasFilePathWidget) {
        fetchWorkspaceFiles();
      }
    }
  }, [selectedNodeId, nodes, fetchWorkspaceFiles, propertiesPanelOpen]);
  
  // Don't render if panel is closed (after all hooks are called)
  if (!propertiesPanelOpen) {
    return null;
  }

  const selectedNode = nodes.find((n) => n.id === selectedNodeId);
  const nodeData = selectedNode?.data?.nodeData;
  
  // Safety check - don't render if nodeData is missing
  if (!nodeData) {
    return null;
  }

  if (!selectedNodeId || !nodeData) {
    return (
      <div className="w-72 h-full bg-[#0f0f12] border-l border-white/10 flex flex-col">
        <div className="p-4 border-b border-white/10">
          <h2 className="text-lg font-semibold text-white flex items-center gap-2">
            <Settings className="w-5 h-5" />
            Properties
          </h2>
        </div>
        <div className="flex-1 flex items-center justify-center p-4">
          <p className="text-gray-500 text-sm text-center">
            Select a node to view its properties
          </p>
        </div>
      </div>
    );
  }

  const handleParameterChange = async (paramName: string, value: unknown) => {
    // Update local state immediately
    updateNodeParameter(selectedNodeId, paramName, value);
    
    // Sync to backend
    try {
      await updateNodeParameterApi(selectedNodeId, paramName, value);
    } catch (error) {
      console.error('Failed to update parameter:', error);
    }
  };

  // Ensure parameters are always objects with {widget, value, ...} structure
  // If a parameter is a plain value, wrap it in an object
  const rawParameters = nodeData.parameters || {};
  const parameters: Record<string, { widget?: string; value?: unknown; options?: string[] | null; source?: string; extractor?: string; description?: string; type?: string }> = {};
  for (const [key, value] of Object.entries(rawParameters)) {
    if (value && typeof value === 'object' && 'value' in value) {
      // Already an object with widget/value structure
      parameters[key] = value as any;
    } else {
      // Plain value - wrap it (fallback for legacy data or edge cases)
      // Only log in development mode to reduce console noise
      if (import.meta.env.DEV) {
        console.debug(`[PROPERTIES] Parameter '${key}' is a plain value, wrapping it:`, value);
      }
      parameters[key] = {
        widget: 'text',
        value: value,
        options: null,
        description: '',
        type: '',
      };
    }
  }
  const inputSockets = nodeData.input_sockets || [];
  const outputSockets = nodeData.output_sockets || [];
  
  // Check if this is a script node
  const isScriptNode = nodeData.is_script || false;
  
  // For script nodes, filter out the "function" parameter - it will be shown separately
  const filteredParameters = isScriptNode 
    ? Object.fromEntries(Object.entries(parameters).filter(([key]) => key !== 'function'))
    : parameters;
  
  // Get the function parameter for script nodes (currently unused but kept for potential future use)
  // const functionParameter = isScriptNode && parameters.function ? parameters.function : null;

  return (
    <div className="w-72 h-full bg-[#0f0f12] border-l border-white/10 flex flex-col">
      {/* Header */}
      <div className="p-4 border-b border-white/10">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-lg font-semibold text-white truncate">
            {nodeData.title}
          </h2>
          <button
            onClick={() => {
              setSelectedNode(null);
              setPropertiesPanelOpen(false);
            }}
            className="p-1 rounded hover:bg-white/10 text-gray-400 hover:text-white"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <p className="text-xs text-gray-500 uppercase">
          {nodeData.library_name?.replace(/_/g, ' ')}
        </p>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Description / Docstring */}
        {nodeData.description && (
          <div>
            <div 
              className="text-sm text-gray-300 leading-relaxed whitespace-pre-wrap"
              style={{ 
                wordWrap: 'break-word',
                maxWidth: '100%'
              }}
            >
              {nodeData.description}
            </div>
            <div className="mt-3 border-t border-white/10"></div>
        </div>
        )}

        {/* Inputs */}
        {inputSockets.length > 0 && (
          <div>
            <h3 className="text-xs font-medium text-gray-400 uppercase mb-2">Inputs</h3>
            <div className="space-y-2">
              {inputSockets.map((socket) => (
                <div key={socket.id} className="text-sm">
                  <div className="flex items-start gap-2">
                    <span className="text-gray-300 font-medium">{socket.name}</span>
                    {(socket.description_type || socket.type) && (
                      <span className="text-gray-500 text-xs">
                        ({socket.description_type || socket.type || 'any'})
                      </span>
                    )}
                  </div>
                  {socket.description && (
                    <p className="text-xs text-gray-400 mt-0.5 ml-0">{socket.description}</p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Outputs */}
        {outputSockets.length > 0 && (
          <div>
            <h3 className="text-xs font-medium text-gray-400 uppercase mb-2">Outputs</h3>
            <div className="space-y-2">
              {outputSockets.map((socket) => (
                <div key={socket.id} className="text-sm">
                  <div className="flex items-start gap-2">
                    <span className="text-gray-300 font-medium">{socket.name}</span>
                    {(socket.description_type || socket.type) && (
                      <span className="text-gray-500 text-xs">
                        ({socket.description_type || socket.type || 'any'})
                      </span>
                    )}
                  </div>
                  {socket.description && (
                    <p className="text-xs text-gray-400 mt-0.5 ml-0">{socket.description}</p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Parameters */}
        {Object.keys(filteredParameters).length > 0 && (
          <div>
            <h3 className="text-xs font-medium text-gray-400 uppercase mb-2">Parameters</h3>
            <div className="space-y-3">
              {Object.entries(filteredParameters).map(([name, param]) => (
                <ParameterInput
                  key={name}
                  name={name}
                  param={param}
                  workspaceFiles={workspaceFiles}
                  workspaceFileFolders={workspaceFileFolders}
                  expandedFileFolders={expandedFileFolders}
                  toggleFileFolder={toggleFileFolder}
                  loadingFiles={loadingFiles}
                  onRefreshFiles={fetchWorkspaceFiles}
                  onChange={(value) => handleParameterChange(name, value)}
                  nodeId={selectedNodeId}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

interface ParameterInputProps {
  name: string;
  param: { widget?: string; value?: unknown; options?: string[] | null; source?: string; extractor?: string; description?: string; type?: string; range?: [number, number] };
  workspaceFiles: WorkspaceFile[];
  workspaceFileFolders: WorkspaceFileFolder[];
  expandedFileFolders: Set<string>;
  toggleFileFolder: (folderName: string) => void;
  loadingFiles: boolean;
  onRefreshFiles: () => void;
  onChange: (value: unknown) => void;
  nodeId?: string;
}

function ParameterInput({ name, param, workspaceFiles, workspaceFileFolders, expandedFileFolders, toggleFileFolder, loadingFiles, onRefreshFiles, onChange, nodeId }: ParameterInputProps) {
  const [showFilePicker, setShowFilePicker] = useState(false);
  const [localNumberValue, setLocalNumberValue] = useState<string | null>(null);
  const [localTextValue, setLocalTextValue] = useState<string | null>(null); // For text inputs like filesave
  const [dynamicOptions, setDynamicOptions] = useState<string[]>([]);
  const [loadingOptions, setLoadingOptions] = useState(false);
  const [showCheckableCombo, setShowCheckableCombo] = useState(false);
  const checkableComboRef = useRef<HTMLDivElement>(null);
  
  // Color picker state (must be at top level, not conditional)
  const [showColorPicker, setShowColorPicker] = useState(false);
  const colorPickerRef = useRef<HTMLDivElement>(null);
  
  const widget = param?.widget || 'text';
  const value = param?.value ?? '';
  
  // Reset local text value when param value changes externally (e.g., node selection changes)
  useEffect(() => {
    if (widget === 'filesave') {
      setLocalTextValue(null);
    }
  }, [widget, value]);
  const options = param?.options || [];
  const source = param?.source;
  const extractor = param?.extractor;
  
  // Build tooltip from parameter description and type (like desktop version)
  const buildTooltip = (): string => {
    const parts: string[] = [name];
    if (param?.type) {
      parts.push(`(${param.type})`);
    }
    if (param?.description) {
      parts.push(`: ${param.description}`);
    }
    return parts.join(' ');
  };
  
  const tooltip = buildTooltip();
  
  // Fetch dynamic options if source and extractor are present
  useEffect(() => {
    if (source && extractor && nodeId) {
      setLoadingOptions(true);
      fetch(`/api/nodes/${nodeId}/parameter-options?source=${encodeURIComponent(source)}&extractor=${encodeURIComponent(extractor)}`)
        .then(res => {
          if (!res.ok) {
            // If response is not ok, return empty options
            return { options: [] };
          }
          return res.json();
        })
        .then(data => {
          const options = data?.options || [];
          setDynamicOptions(options);
          setLoadingOptions(false);
          
          // Auto-select first option if value is None/undefined/empty and we have options
          // This ensures the backend parameter is set when options become available
          if (widget === 'combobox' && options.length > 0 && (value === null || value === undefined || value === '')) {
            const firstOption = options[0];
            // Only update if the value is actually empty
            if (firstOption) {
              // Use a small delay to ensure state is updated
              setTimeout(() => {
                onChangeRef.current(firstOption);
              }, 0);
            }
          }
        })
        .catch(err => {
          console.error('Error fetching parameter options:', err);
          setDynamicOptions([]);
          setLoadingOptions(false);
        });
    } else {
      // Reset options if source/extractor/nodeId are not available
      setDynamicOptions([]);
      setLoadingOptions(false);
    }
  }, [source, extractor, nodeId, widget, value]); // Include widget and value to check for auto-select
  
  // Close dropdown when clicking outside (for checkable combobox)
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (checkableComboRef.current && !checkableComboRef.current.contains(event.target as Node)) {
        setShowCheckableCombo(false);
      }
    };
    
    if (showCheckableCombo) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showCheckableCombo]);

  // Close color picker when clicking outside (only for colorpicker widget)
  useEffect(() => {
    if (widget !== 'colorpicker' && widget !== 'color') {
      return; // Early return is fine in useEffect, but we need to ensure it's always called
    }
    
    const handleClickOutside = (event: MouseEvent) => {
      if (colorPickerRef.current && !colorPickerRef.current.contains(event.target as Node)) {
        setShowColorPicker(false);
      }
    };
    
    if (showColorPicker) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showColorPicker, widget]);

  // Use dynamic options if available, otherwise use static options
  // Memoize to prevent unnecessary re-renders and hooks issues
  const availableOptions = useMemo(() => {
    return (source && extractor) ? dynamicOptions : options;
  }, [source, extractor, dynamicOptions, options]);
  
  // Auto-select first option when dynamic options become available and value is empty
  // Use a ref to store the latest onChange to avoid dependency issues
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);
  
  // Track if we've already auto-selected to prevent loops
  const hasAutoSelectedRef = useRef<string>(''); // Track which option set we auto-selected
  
  useEffect(() => {
    try {
      // Only auto-select for combobox widgets with dynamic options (source/extractor)
      if (widget === 'combobox' && source && extractor && availableOptions.length > 0 && (value === null || value === undefined || value === '')) {
        const firstOption = availableOptions[0];
        const optionsKey = availableOptions.join(','); // Create a key from options to track changes
        
        // Only update if the value is actually empty and we haven't already auto-selected for these options
        if (value !== firstOption && firstOption && hasAutoSelectedRef.current !== optionsKey) {
          hasAutoSelectedRef.current = optionsKey;
          onChangeRef.current(firstOption);
        }
      }
      // Reset the flag when options are cleared
      if (availableOptions.length === 0) {
        hasAutoSelectedRef.current = '';
      }
    } catch (err) {
      console.error('Error in auto-select logic:', err);
    }
  }, [availableOptions, widget, value, source, extractor]); // Removed onChange from dependencies

  const inputClass = `
    w-full px-2 py-1.5 
    bg-white/5 border border-white/10 rounded 
    text-sm text-gray-200 
    focus:outline-none focus:border-blue-500/50
  `;

  // Checkable Combobox (multiselect)
  if (widget === 'checkable-combobox') {
    // Value is an array for checkable-combobox
    const selectedValues = Array.isArray(value) ? value : (value ? [value] : []);
    
    const toggleOption = (option: string) => {
      const newValues = selectedValues.includes(option)
        ? selectedValues.filter(v => v !== option)
        : [...selectedValues, option];
      onChange(newValues);
    };
    
    const displayText = selectedValues.length > 0 
      ? selectedValues.join(', ')
      : 'Select options...';
    
    return (
      <div ref={checkableComboRef}>
        <label 
          className="block text-xs text-gray-500 mb-1"
          title={tooltip !== name ? tooltip : undefined}
        >
          {name}
        </label>
        <div className="relative">
          <button
            onClick={() => setShowCheckableCombo(!showCheckableCombo)}
            className={`
              ${inputClass}
              flex items-center justify-between gap-2 cursor-pointer
              hover:border-white/20 transition-colors
              ${loadingOptions ? 'opacity-50' : ''}
            `}
            disabled={loadingOptions}
            title={tooltip !== name ? tooltip : undefined}
          >
            <span className="truncate text-left flex-1">
              {loadingOptions ? 'Loading options...' : displayText}
            </span>
            <ChevronDown className={`w-4 h-4 text-gray-400 flex-shrink-0 transition-transform ${showCheckableCombo ? 'rotate-180' : ''}`} />
          </button>
          
          {showCheckableCombo && availableOptions.length > 0 && (
            <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-[#1e1e24] border border-white/10 rounded-md shadow-xl max-h-48 overflow-y-auto">
              {availableOptions.map((option) => (
                <label
                  key={option}
                  className="flex items-center gap-2 px-2 py-1.5 hover:bg-white/10 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={selectedValues.includes(option)}
                    onChange={() => toggleOption(option)}
                    className="w-4 h-4 rounded border-white/20 bg-white/5 text-blue-500 focus:ring-blue-500/50"
                  />
                  <span className="text-sm text-gray-300">{option}</span>
                </label>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  // Combobox / Select
  if (widget === 'combobox') {
    // Show loading state while fetching dynamic options
    if (source && extractor && loadingOptions) {
      return (
        <div>
          <label 
            className="block text-xs text-gray-500 mb-1"
            title={tooltip !== name ? tooltip : undefined}
          >
            {name}
          </label>
          <div className={`${inputClass} bg-[#252526] text-gray-400`}>
            Loading options...
          </div>
        </div>
      );
    }
    
    // Only render select if we have options (either static or dynamic)
    if (availableOptions.length > 0) {
      return (
        <div>
          <label 
            className="block text-xs text-gray-500 mb-1"
            title={tooltip !== name ? tooltip : undefined}
          >
            {name}
          </label>
          <select
            value={value != null ? String(value) : ''}
            onChange={(e) => onChange(e.target.value)}
            className={`${inputClass} bg-[#252526] text-gray-200`}
            style={{
              color: value != null ? '#e5e5e5' : '#888',
            }}
            title={tooltip !== name ? tooltip : undefined}
          >
            {value == null && (
              <option value="" disabled style={{ backgroundColor: '#252526', color: '#888' }}>
                Select option...
              </option>
            )}
            {availableOptions.map((opt) => (
              <option 
                key={opt} 
                value={opt}
                style={{
                  backgroundColor: '#252526',
                  color: '#e5e5e5',
                }}
              >
                {opt}
              </option>
            ))}
          </select>
        </div>
      );
    }
    
    // If no options available yet, show placeholder
    return (
      <div>
        <label 
          className="block text-xs text-gray-500 mb-1"
          title={tooltip !== name ? tooltip : undefined}
        >
          {name}
        </label>
        <div className={`${inputClass} bg-[#252526] text-gray-500`}>
          {source && extractor ? 'No options available' : 'No options'}
        </div>
      </div>
    );
  }

  // Checkbox / Boolean / Toggle
  if (widget === 'checkbox' || widget === 'toggle' || typeof value === 'boolean') {
    return (
      <div className="flex items-center justify-between">
        <label 
          className="text-xs text-gray-500"
          title={tooltip !== name ? tooltip : undefined}
        >
          {name}
        </label>
        <input
          type="checkbox"
          checked={Boolean(value)}
          onChange={(e) => onChange(e.target.checked)}
          className="w-4 h-4 rounded border-white/20 bg-white/5 text-blue-500 focus:ring-blue-500/50"
          title={tooltip !== name ? tooltip : undefined}
        />
      </div>
    );
  }

  // Pylineedit - Python expression input (can be True, False, lists, numbers, etc.)
  if (widget === 'pylineedit') {
    // Display value as string representation
    const displayValue = localNumberValue !== null ? localNumberValue : (value !== null && value !== undefined ? String(value) : '');
    const enterPressedRef = useRef(false);
    
    return (
      <div>
        <label 
          className="block text-xs text-gray-500 mb-1"
          title={tooltip !== name ? tooltip : undefined}
        >
          {name}
        </label>
        <input
          type="text"
          value={displayValue}
          title={tooltip !== name ? tooltip : undefined}
          onChange={(e) => {
            // Just update local state while typing
            setLocalNumberValue(e.target.value);
            enterPressedRef.current = false; // Reset flag on any change
          }}
          onBlur={(e) => {
            // Skip blur if Enter was just pressed (to avoid double API call)
            if (enterPressedRef.current) {
              enterPressedRef.current = false;
              return;
            }
            // On blur, send the raw string to backend - backend will parse it
            const rawValue = e.target.value;
            // Send as string - backend should parse Python literals
            onChange(rawValue);
            setLocalNumberValue(null); // Reset to use store value
          }}
          onKeyDown={(e) => {
            // Also sync on Enter key
            if (e.key === 'Enter') {
              e.preventDefault(); // Prevent form submission if in a form
              enterPressedRef.current = true; // Mark that Enter was pressed
              const rawValue = (e.target as HTMLInputElement).value;
              onChange(rawValue);
              setLocalNumberValue(null);
              // Use setTimeout to blur after the blur handler has checked the flag
              setTimeout(() => {
                (e.target as HTMLInputElement).blur();
                enterPressedRef.current = false; // Reset flag after blur
              }, 0);
            }
          }}
          className={inputClass}
          placeholder="Enter Python expression (e.g., True, [1,2,3], 2*3)"
        />
      </div>
    );
  }

  // Spinbox - integer input with up/down buttons
  if (widget === 'spinbox') {
    const range = param.range;
    const min = range ? range[0] : -Infinity;
    const max = range ? range[1] : Infinity;
    
    // Parse integer, clamping to range
    const parseInteger = (str: string): number => {
      if (!str || str === '' || str === '-') {
        // Return min if provided, otherwise 0
        return range ? min : 0;
      }
      const parsed = parseInt(str, 10);
      if (isNaN(parsed)) {
        return range ? min : 0;
      }
      // Clamp to range
      return Math.max(min, Math.min(max, parsed));
    };
    
    // Get current integer value
    const currentValue = typeof value === 'number' ? Math.round(value) : parseInteger(String(value));
    const clampedValue = Math.max(min, Math.min(max, currentValue));
    const displayValue = localNumberValue !== null ? localNumberValue : String(clampedValue);
    
    const handleIncrement = () => {
      const newValue = Math.min(max, clampedValue + 1);
      onChange(newValue);
      setLocalNumberValue(null);
    };
    
    const handleDecrement = () => {
      const newValue = Math.max(min, clampedValue - 1);
      onChange(newValue);
      setLocalNumberValue(null);
    };
    
    return (
      <div>
        <label 
          className="block text-xs text-gray-500 mb-1"
          title={tooltip !== name ? tooltip : undefined}
        >
          {name}
        </label>
        <div className="flex items-center gap-1">
          <input
            type="text"
            inputMode="numeric"
            value={displayValue}
            title={tooltip !== name ? tooltip : undefined}
            onChange={(e) => {
              // Only allow digits and minus sign
              const val = e.target.value;
              if (val === '' || val === '-' || /^-?\d*$/.test(val)) {
                setLocalNumberValue(val);
              }
            }}
            onBlur={(e) => {
              // On blur, parse and clamp to range
              const parsed = parseInteger(e.target.value);
              onChange(parsed);
              setLocalNumberValue(null);
            }}
            onKeyDown={(e) => {
              // Handle arrow keys for increment/decrement
              if (e.key === 'ArrowUp') {
                e.preventDefault();
                handleIncrement();
              } else if (e.key === 'ArrowDown') {
                e.preventDefault();
                handleDecrement();
              } else if (e.key === 'Enter') {
                const parsed = parseInteger((e.target as HTMLInputElement).value);
                onChange(parsed);
                setLocalNumberValue(null);
                (e.target as HTMLInputElement).blur();
              }
            }}
            className={`${inputClass} flex-1`}
          />
          <div className="flex flex-col">
            <button
              type="button"
              onClick={handleIncrement}
              disabled={clampedValue >= max}
              className="
                w-6 h-3 flex items-center justify-center
                bg-white/10 hover:bg-white/20
                border border-white/10 rounded-t
                text-gray-400 hover:text-white
                disabled:opacity-30 disabled:cursor-not-allowed
                transition-colors
                text-xs leading-none
              "
              title="Increment"
            >
              ▲
            </button>
            <button
              type="button"
              onClick={handleDecrement}
              disabled={clampedValue <= min}
              className="
                w-6 h-3 flex items-center justify-center
                bg-white/10 hover:bg-white/20
                border border-white/10 rounded-b border-t-0
                text-gray-400 hover:text-white
                disabled:opacity-30 disabled:cursor-not-allowed
                transition-colors
                text-xs leading-none
              "
              title="Decrement"
            >
              ▼
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Doublespinbox - float input with up/down buttons
  if (widget === 'doublespinbox') {
    const range = param.range;
    const min = range ? range[0] : -Infinity;
    const max = range ? range[1] : Infinity;
    const step = 1.0; // User requested increment of 1
    
    // Parse float, clamping to range
    const parseFloatValue = (str: string): number => {
      if (!str || str === '' || str === '-') {
        return range ? min : 0;
      }
      // Replace comma with point for parsing (handle European locales)
      const normalized = str.replace(',', '.');
      const parsed = Number.parseFloat(normalized);
      if (Number.isNaN(parsed)) {
        return range ? min : 0;
      }
      // Clamp to range
      return Math.max(min, Math.min(max, parsed));
    };
    
    // Get current float value
    const currentValue = typeof value === 'number' ? value : parseFloatValue(String(value));
    const clampedValue = Math.max(min, Math.min(max, currentValue));
    const displayValue = localNumberValue !== null ? localNumberValue : String(clampedValue);
    
    const handleIncrement = () => {
      const newValue = Math.min(max, clampedValue + step);
      onChange(newValue);
      setLocalNumberValue(null);
    };
    
    const handleDecrement = () => {
      const newValue = Math.max(min, clampedValue - step);
      onChange(newValue);
      setLocalNumberValue(null);
    };
    
    return (
      <div>
        <label 
          className="block text-xs text-gray-500 mb-1"
          title={tooltip !== name ? tooltip : undefined}
        >
          {name}
        </label>
        <div className="flex items-center gap-1">
          <input
            type="text"
            inputMode="decimal"
            value={displayValue}
            title={tooltip !== name ? tooltip : undefined}
            onChange={(e) => {
              // Allow digits, decimal point, comma, and minus sign
              const val = e.target.value;
              if (val === '' || val === '-' || val === '.' || val === ',' || /^-?\d*[.,]?\d*$/.test(val)) {
                setLocalNumberValue(val);
              }
            }}
            onBlur={(e) => {
              // On blur, parse and clamp to range
              const parsed = parseFloatValue(e.target.value);
              onChange(parsed);
              setLocalNumberValue(null);
            }}
            onKeyDown={(e) => {
              // Handle arrow keys for increment/decrement
              if (e.key === 'ArrowUp') {
                e.preventDefault();
                handleIncrement();
              } else if (e.key === 'ArrowDown') {
                e.preventDefault();
                handleDecrement();
              } else if (e.key === 'Enter') {
                const parsed = parseFloatValue((e.target as HTMLInputElement).value);
                onChange(parsed);
                setLocalNumberValue(null);
                (e.target as HTMLInputElement).blur();
              }
            }}
            className={`${inputClass} flex-1`}
          />
          <div className="flex flex-col">
            <button
              type="button"
              onClick={handleIncrement}
              disabled={clampedValue >= max}
              className="
                w-6 h-3 flex items-center justify-center
                bg-white/10 hover:bg-white/20
                border border-white/10 rounded-t
                text-gray-400 hover:text-white
                disabled:opacity-30 disabled:cursor-not-allowed
                transition-colors
                text-xs leading-none
              "
              title="Increment"
            >
              ▲
            </button>
            <button
              type="button"
              onClick={handleDecrement}
              disabled={clampedValue <= min}
              className="
                w-6 h-3 flex items-center justify-center
                bg-white/10 hover:bg-white/20
                border border-white/10 rounded-b border-t-0
                text-gray-400 hover:text-white
                disabled:opacity-30 disabled:cursor-not-allowed
                transition-colors
                text-xs leading-none
              "
              title="Decrement"
            >
              ▼
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Fallback for numeric values without explicit widget type
  if (typeof value === 'number') {
    const range = param.range;
    const min = range ? range[0] : -Infinity;
    const max = range ? range[1] : Infinity;
    
    // Parse number handling both comma and point as decimal separators
    const parseNumber = (str: string): number => {
      if (!str || str === '' || str === '-') {
        return range ? min : 0;
      }
      // Replace comma with point for parsing (handle European locales)
      const normalized = str.replace(',', '.');
      const parsed = Number.parseFloat(normalized);
      if (Number.isNaN(parsed)) {
        return range ? min : 0;
      }
      // Clamp to range
      return Math.max(min, Math.min(max, parsed));
    };
    
    // Use local state while typing, sync to store on blur
    const storeValue = typeof value === 'number' ? value : parseNumber(String(value));
    const clampedValue = Math.max(min, Math.min(max, storeValue));
    const displayValue = localNumberValue !== null ? localNumberValue : String(clampedValue);
    
    return (
      <div>
        <label 
          className="block text-xs text-gray-500 mb-1"
          title={tooltip !== name ? tooltip : undefined}
        >
          {name}
        </label>
        <input
          type="text"
          inputMode="decimal"
          value={displayValue}
          title={tooltip !== name ? tooltip : undefined}
          onChange={(e) => {
            // Just update local state while typing
            setLocalNumberValue(e.target.value);
          }}
          onBlur={(e) => {
            // On blur, parse and clamp to range
            const parsed = parseNumber(e.target.value);
            onChange(parsed);
            setLocalNumberValue(null); // Reset to use store value
          }}
          onKeyDown={(e) => {
            // Also sync on Enter key
            if (e.key === 'Enter') {
              const parsed = parseNumber((e.target as HTMLInputElement).value);
              onChange(parsed);
              setLocalNumberValue(null);
            }
          }}
          className={inputClass}
        />
      </div>
    );
  }

  // Filepath - File Selector from Workspace
  if (widget === 'filepath') {
    const currentValue = String(value || '');
    const isWorkspacePath = currentValue.startsWith('workspace://');
    const currentFileName = isWorkspacePath 
      ? currentValue.replace('workspace://', '')
      : currentValue.split('/').pop() || currentValue.split('\\').pop() || '';
    
    return (
      <div>
        <label 
          className="block text-xs text-gray-500 mb-1"
          title={tooltip !== name ? tooltip : undefined}
        >
          {name}
        </label>
        
        {/* File selector button */}
        <div className="relative">
          <button
            onClick={() => setShowFilePicker(!showFilePicker)}
            className={`
              ${inputClass}
              flex items-center justify-between gap-2 cursor-pointer
              hover:border-white/20 transition-colors
            `}
            title={tooltip !== name ? tooltip : undefined}
          >
            <div className="flex items-center gap-2 min-w-0">
              <FolderOpen className="w-4 h-4 text-gray-400 flex-shrink-0" />
              <span className="truncate text-left">
                {currentFileName || 'Select from workspace...'}
              </span>
            </div>
            <ChevronDown className={`w-4 h-4 text-gray-400 flex-shrink-0 transition-transform ${showFilePicker ? 'rotate-180' : ''}`} />
          </button>
          
          {/* Dropdown file list */}
          {showFilePicker && (
            <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-[#1e1e24] border border-white/10 rounded-md shadow-xl max-h-48 overflow-y-auto">
              {/* Header with refresh */}
              <div className="flex items-center justify-between px-2 py-1.5 border-b border-white/10 sticky top-0 bg-[#1e1e24]">
                <span className="text-xs text-gray-400">Workspace Files</span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onRefreshFiles();
                  }}
                  className="p-1 rounded hover:bg-white/10 text-gray-400"
                  title="Refresh files"
                >
                  <RefreshCw className={`w-3 h-3 ${loadingFiles ? 'animate-spin' : ''}`} />
                </button>
              </div>
              
              {workspaceFileFolders.length === 0 && workspaceFiles.length === 0 ? (
                <div className="p-3 text-center">
                  <p className="text-xs text-gray-500 mb-2">No files in workspace</p>
                  <Link
                    to="/workspace"
                    className="inline-flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300"
                    onClick={() => setShowFilePicker(false)}
                  >
                    <Upload className="w-3 h-3" />
                    Upload files
                  </Link>
                </div>
              ) : (
                <>
                  {/* Folders */}
                  {workspaceFileFolders.map((folder: WorkspaceFileFolder) => {
                    const isExpanded = expandedFileFolders.has(folder.name);
                    return (
                      <div key={folder.name}>
                        <button
                          onClick={() => toggleFileFolder(folder.name)}
                          className="w-full px-2 py-1.5 text-left text-sm hover:bg-white/10 transition-colors flex items-center gap-2"
                        >
                          {isExpanded ? (
                            <ChevronDown className="w-3 h-3 text-gray-400" />
                          ) : (
                            <ChevronRight className="w-3 h-3 text-gray-400" />
                          )}
                          <FolderOpen className="w-3 h-3 text-blue-400" />
                          <span className="text-gray-300">{folder.name}</span>
                        </button>
                        {isExpanded && (
                          <div className="ml-4 border-l border-white/10 pl-1">
                            {folder.files.map((file: WorkspaceFile) => (
                              <button
                                key={file.path || file.name}
                                onClick={() => {
                                  // Use workspace path format with folder
                                  onChange(`workspace://${file.path || file.name}`);
                                  setShowFilePicker(false);
                                }}
                                className={`
                                  w-full px-2 py-1.5 text-left text-sm hover:bg-white/10 transition-colors
                                  flex items-center justify-between
                                  ${currentFileName === file.name ? 'bg-blue-600/20 text-blue-400' : 'text-gray-300'}
                                `}
                              >
                                <span className="truncate">{file.name}</span>
                                <span className="text-xs text-gray-500 ml-2">{file.type}</span>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                  
                  {/* Root level files */}
                  {workspaceFiles.map((file) => (
                    <button
                      key={file.path || file.name}
                      onClick={() => {
                        // Use workspace path format
                        onChange(`workspace://${file.path || file.name}`);
                        setShowFilePicker(false);
                      }}
                      className={`
                        w-full px-2 py-1.5 text-left text-sm hover:bg-white/10 transition-colors
                        flex items-center justify-between
                        ${currentFileName === file.name ? 'bg-blue-600/20 text-blue-400' : 'text-gray-300'}
                      `}
                    >
                      <span className="truncate">{file.name}</span>
                      <span className="text-xs text-gray-500 ml-2">{file.type}</span>
                    </button>
                  ))}
                </>
              )}
            </div>
          )}
        </div>
        
        {/* Manual path entry */}
        <input
          type="text"
          value={isWorkspacePath ? '' : currentValue}
          onChange={(e) => {
            // Allow any path input - user can type full local path or workspace path
            onChange(e.target.value);
          }}
          onBlur={(e) => {
            const path = e.target.value.trim();
            if (path) {
              onChange(path);
            }
          }}
          placeholder="... or enter path manually"
          className={`
            ${inputClass}
            mt-1 text-xs
          `}
        />
      </div>
    );
  }

  // Code editor for script nodes
  // Note: codeeditor widget is now handled separately for script nodes in the main component
  // This section is kept for non-script nodes that might use codeeditor
  if (widget === 'codeeditor') {
    // For script nodes, this should not be reached as function parameter is filtered
    // But if it is, show a simple read-only display
    return (
      <div>
        <label 
          className="block text-xs text-gray-500 mb-1"
          title={tooltip !== name ? tooltip : undefined}
        >
          {name}
        </label>
        <textarea
          value={String(value)}
          readOnly
          rows={6}
          className={`${inputClass} resize-y font-mono text-xs opacity-75 cursor-not-allowed`}
          placeholder="Code editor (use Edit & Build Script button for script nodes)"
        />
      </div>
    );
  }

  // Text area for longer text / code
  if (widget === 'textarea' || widget === 'code') {
    return (
      <div>
        <label 
          className="block text-xs text-gray-500 mb-1"
          title={tooltip !== name ? tooltip : undefined}
        >
          {name}
        </label>
        <textarea
          value={String(value)}
          onChange={(e) => onChange(e.target.value)}
          rows={4}
          className={`${inputClass} resize-y font-mono`}
          title={tooltip !== name ? tooltip : undefined}
        />
      </div>
    );
  }

  // Color input
  // Color picker widget - custom implementation without native browser dialog
  if (widget === 'colorpicker' || widget === 'color') {
    const currentColor = String(value || '#06E4A8');
    
    // Common preset colors
    const presetColors = [
      '#06E4A8', '#000000', '#FFFFFF', '#FF0000', '#00FF00', '#0000FF',
      '#FFFF00', '#FF00FF', '#00FFFF', '#808080', '#FFA500', '#800080',
      '#FFC0CB', '#A52A2A', '#008000', '#000080', '#FFD700', '#C0C0C0',
    ];
    
    // Validate hex color
    const isValidHex = (hex: string) => {
      return /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/.test(hex);
    };
    
    const handleColorChange = (newColor: string) => {
      if (isValidHex(newColor)) {
        onChange(newColor);
      }
    };
    
    return (
      <div ref={colorPickerRef} className="relative">
        <label 
          className="block text-xs text-gray-500 mb-1"
          title={tooltip !== name ? tooltip : undefined}
        >
          {name}
        </label>
        <div className="flex items-center gap-2">
          {/* Color swatch button */}
          <button
            type="button"
            onClick={() => setShowColorPicker(!showColorPicker)}
            className="w-8 h-8 rounded border border-white/10 cursor-pointer flex-shrink-0 hover:border-white/20 transition-colors"
            style={{ backgroundColor: currentColor }}
            title="Click to pick color"
          />
          
          {/* Text input for hex value */}
          <input
            type="text"
            value={currentColor}
            onChange={(e) => {
              const val = e.target.value;
              if (val.startsWith('#') && isValidHex(val)) {
                onChange(val);
              } else if (!val.startsWith('#') && val.length > 0) {
                // Auto-add # if missing
                const withHash = '#' + val;
                if (isValidHex(withHash)) {
                  onChange(withHash);
                }
              }
            }}
            onBlur={(e) => {
              // Ensure valid hex on blur
              const val = e.target.value;
              if (!isValidHex(val)) {
                onChange('#06E4A8'); // Reset to default if invalid
              }
            }}
            placeholder="#06E4A8"
            className={`${inputClass} flex-1`}
            title={tooltip !== name ? tooltip : undefined}
          />
        </div>
        
        {/* Custom color picker dropdown */}
        {showColorPicker && (
          <div className="absolute z-50 top-full left-0 mt-1 bg-[#1e1e24] border border-white/10 rounded-md shadow-xl p-3 min-w-[200px]">
            {/* Preset colors grid */}
            <div className="mb-3">
              <div className="text-xs text-gray-400 mb-2">Preset Colors</div>
              <div className="grid grid-cols-6 gap-1">
                {presetColors.map((color) => (
                  <button
                    key={color}
                    type="button"
                    onClick={() => {
                      handleColorChange(color);
                      setShowColorPicker(false);
                    }}
                    className="w-6 h-6 rounded border border-white/10 hover:border-white/30 hover:scale-110 transition-all cursor-pointer"
                    style={{ backgroundColor: color }}
                    title={color}
                  />
                ))}
              </div>
            </div>
            
            {/* Custom hex input */}
            <div>
              <div className="text-xs text-gray-400 mb-1">Custom Color</div>
              <input
                type="text"
                value={currentColor}
                onChange={(e) => {
                  const val = e.target.value;
                  if (val.startsWith('#') && isValidHex(val)) {
                    onChange(val);
                  } else if (!val.startsWith('#') && val.length > 0) {
                    const withHash = '#' + val;
                    if (isValidHex(withHash)) {
                      onChange(withHash);
                    }
                  }
                }}
                placeholder="#06E4A8"
                className={`${inputClass} w-full`}
                onClick={(e) => e.stopPropagation()}
              />
            </div>
          </div>
        )}
      </div>
    );
  }

  // Filesave - filename input (saves to workspace)
  if (widget === 'filesave') {
    // Use local state to avoid feedback loop - only sync on blur/Enter
    const storeValue = String(value || '');
    const displayValue = localTextValue !== null ? localTextValue : storeValue;
    
    return (
      <div>
        <label 
          className="block text-xs text-gray-500 mb-1"
          title={tooltip !== name ? tooltip : undefined}
        >
          {name}
        </label>
        <input
          type="text"
          value={displayValue}
          onChange={(e) => {
            // Just update local state while typing
            setLocalTextValue(e.target.value);
          }}
          onBlur={(e) => {
            // On blur, sync to store/backend
            onChange(e.target.value);
            setLocalTextValue(null); // Reset to use store value
          }}
          onKeyDown={(e) => {
            // Also sync on Enter key
            if (e.key === 'Enter') {
              onChange((e.target as HTMLInputElement).value);
              setLocalTextValue(null);
              (e.target as HTMLInputElement).blur();
            }
          }}
          className={inputClass}
          placeholder="Enter filename (e.g., data.csv) or enter path manually"
          title={tooltip !== name ? tooltip : undefined}
        />
        <p className="text-xs text-gray-500 mt-1">
          File will be saved to workspace (or use full path for local save)
        </p>
      </div>
    );
  }

  // Default: text input (lineedit) - use local state to avoid feedback loop
  const [localTextInputValue, setLocalTextInputValue] = useState<string | null>(null);
  
  // Reset local text input value when param value changes externally
  useEffect(() => {
    setLocalTextInputValue(null);
  }, [value]);
  
  const displayTextValue = localTextInputValue !== null ? localTextInputValue : String(value || '');
  
  return (
    <div>
      <label 
        className="block text-xs text-gray-500 mb-1"
        title={tooltip !== name ? tooltip : undefined}
      >
        {name}
      </label>
      <input
        type="text"
        value={displayTextValue}
        onChange={(e) => {
          // Just update local state while typing
          setLocalTextInputValue(e.target.value);
        }}
        onBlur={(e) => {
          // On blur, sync to store/backend
          onChange(e.target.value);
          setLocalTextInputValue(null); // Reset to use store value
        }}
        onKeyDown={(e) => {
          // Also sync on Enter key
          if (e.key === 'Enter') {
            onChange((e.target as HTMLInputElement).value);
            setLocalTextInputValue(null);
            (e.target as HTMLInputElement).blur();
          }
        }}
        className={inputClass}
        title={tooltip !== name ? tooltip : undefined}
      />
    </div>
  );
}
