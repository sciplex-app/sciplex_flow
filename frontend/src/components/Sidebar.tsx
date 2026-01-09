import { useState, useEffect } from 'react';
import { ChevronRight, ChevronDown, Search, RefreshCw } from 'lucide-react';
import { useFlowStore } from '../store/flowStore';
import { useApi } from '../hooks/useApi';
import { LibraryNodeInfo } from '../types';

// Icon size matching desktop (50px icon + padding) - currently unused, kept for reference
 
const ICON_SIZE = 50;

interface NodeTileProps {
  nodeInfo: LibraryNodeInfo;
  libraryName: string;
}

function NodeTile({ nodeInfo, libraryName }: NodeTileProps) {
  const [iconError, setIconError] = useState(false);
  
  const onDragStart = (event: React.DragEvent) => {
    event.dataTransfer.setData('application/sciplexflow', JSON.stringify({
      nodeType: nodeInfo.name,
      libraryName,
    }));
    event.dataTransfer.effectAllowed = 'move';
  };

  // Format node name for display (split CamelCase or snake_case)
  const formatName = (name: string) => {
    if (name.includes('_')) {
      return name.split('_').map(p => p.charAt(0).toUpperCase() + p.slice(1)).join('\n');
    }
    // CamelCase split - keep consecutive capital letters together
    // Split at: lowercase followed by uppercase, or uppercase followed by lowercase (but not if next is also uppercase)
    return name
      .replace(/([a-z])([A-Z])/g, '$1\n$2')  // lowercase to uppercase
      .replace(/([A-Z]+)([A-Z][a-z])/g, '$1\n$2')  // consecutive caps followed by cap+lowercase
      .trim();
  };

  const displayName = formatName(nodeInfo.name);
  // All icons are now black icons - no variant needed
  const iconUrl = nodeInfo.icon ? `/api/icons/${nodeInfo.icon}` : null;
  const fallbackLetter = (nodeInfo.icon || nodeInfo.name).charAt(0).toUpperCase();

  return (
    <div
      draggable
      onDragStart={onDragStart}
      className="
        flex flex-col items-center justify-start
        w-[70px] h-[100px] p-1
        cursor-grab active:cursor-grabbing
        hover:bg-white/5 rounded-lg
        transition-colors duration-150
        group
      "
      title={nodeInfo.name}
    >
      {/* Icon box */}
      <div 
        className="
          w-[50px] h-[50px] rounded-lg
          flex items-center justify-center
          bg-[#d4d4d8] border-[3px] border-[#06E4A8]
          transition-colors
        "
      >
        {iconUrl && !iconError ? (
          <img 
            src={iconUrl} 
            alt={nodeInfo.icon}
            className="w-[32px] h-[32px] object-contain"
            onError={() => setIconError(true)}
          />
        ) : (
          <span className="text-lg font-medium text-gray-400">{fallbackLetter}</span>
        )}
      </div>
      
      {/* Node name */}
      <div className="mt-1 text-center w-full">
        <span className="text-[9px] text-gray-400 leading-tight whitespace-pre-line line-clamp-3">
          {displayName}
        </span>
      </div>
    </div>
  );
}

interface LibrarySectionProps {
  name: string;
  nodes: LibraryNodeInfo[];
  defaultOpen?: boolean;
}

function LibrarySection({ name, nodes, defaultOpen = false }: LibrarySectionProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  
  // Format library name for display
  const displayName = name.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

  return (
    <div className="mb-1">
      {/* Category header */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="
          w-full flex items-center gap-2 px-3 py-2
          hover:bg-white/5 transition-colors
          text-gray-300
        "
      >
        {isOpen ? (
          <ChevronDown className="w-4 h-4 text-gray-500" />
        ) : (
          <ChevronRight className="w-4 h-4 text-gray-500" />
        )}
        <span className="text-sm font-medium">{displayName}</span>
        <span className="ml-auto text-xs text-gray-500">{nodes.length}</span>
      </button>
      
      {/* Node grid */}
      {isOpen && (
        <div className="
          px-2 py-2
          grid grid-cols-4 gap-1
          animate-fade-in
        ">
          {nodes.map((node) => (
            <NodeTile
              key={node.name}
              nodeInfo={node}
              libraryName={name}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default function Sidebar() {
  const [searchQuery, setSearchQuery] = useState('');
  const libraries = useFlowStore((s) => s.libraries);
  const sidebarOpen = useFlowStore((s) => s.sidebarOpen);
  const { fetchLibraries } = useApi();

  // Fetch libraries on mount
  useEffect(() => {
    fetchLibraries().catch(console.error);
  }, [fetchLibraries]);

  // Listen for library refresh events (e.g., after upload)
  useEffect(() => {
    const handleRefresh = () => {
      fetchLibraries().catch(console.error);
    };
    window.addEventListener('refresh-libraries', handleRefresh);
    return () => window.removeEventListener('refresh-libraries', handleRefresh);
  }, [fetchLibraries]);

  // Filter libraries based on search (exclude _internal library which contains Script node)
  const filteredLibraries = Object.entries(libraries).reduce((acc, [libName, nodes]) => {
    // Skip _internal library (Script node is in toolbar, not sidebar)
    if (libName === "_internal") {
      return acc;
    }
    
    if (!searchQuery) {
      acc[libName] = nodes;
      return acc;
    }
    
    const filtered = nodes.filter(
      (node) =>
        node.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        node.description?.toLowerCase().includes(searchQuery.toLowerCase())
    );
    
    if (filtered.length > 0) {
      acc[libName] = filtered;
    }
    
    return acc;
  }, {} as Record<string, LibraryNodeInfo[]>);

  if (!sidebarOpen) {
    return null;
  }

  return (
    <div className="
      w-[330px] h-full
      bg-[#0f0f12] border-r border-white/10
      flex flex-col
      relative z-10
    ">
      {/* Header with search */}
      <div className="p-3 border-b border-white/10">
        <div className="flex items-center gap-2">
          {/* Search input */}
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
            <input
              type="text"
              placeholder="Search nodes..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="
                w-full pl-8 pr-3 py-1.5
                bg-white/5 border border-white/10 rounded-md
                text-sm text-gray-200 placeholder-gray-500
                focus:outline-none focus:border-[#06E4A8]/50
                transition-colors
              "
            />
          </div>
          
          {/* Refresh button */}
          <button
            onClick={() => fetchLibraries()}
            className="
              p-1.5 rounded-md
              hover:bg-[#06E4A8] text-gray-400 hover:text-black
              transition-colors
            "
            title="Reload libraries"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>
      
      {/* Library list */}
      <div className="flex-1 overflow-y-auto">
        {Object.keys(filteredLibraries).length === 0 ? (
          <div className="text-center py-8 text-gray-500 text-sm">
            {searchQuery ? 'No nodes found' : 'Loading libraries...'}
          </div>
        ) : (
          Object.entries(filteredLibraries)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([libName, nodes], index) => (
              <LibrarySection
                key={libName}
                name={libName}
                nodes={nodes}
                defaultOpen={index === 0}
              />
            ))
        )}
      </div>
    </div>
  );
}
