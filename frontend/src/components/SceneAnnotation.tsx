import { useState, useRef, useEffect, useCallback } from 'react';
import { AnnotationData } from '../types';

interface SceneAnnotationProps {
  annotation: AnnotationData;
  onUpdate: (annotationId: string, updates: Partial<AnnotationData>) => void;
  onDelete: (annotationId: string) => void;
  onSelect: (annotationId: string) => void;
  isSelected: boolean;
  screenToFlowPosition: (screenPosition: { x: number; y: number }) => { x: number; y: number };
  viewport: { x: number; y: number; zoom: number };
}

const MIN_WIDTH = 100;

export default function SceneAnnotation({ 
  annotation, 
  onUpdate, 
  onDelete,
  onSelect,
  isSelected,
  screenToFlowPosition,
  viewport
}: SceneAnnotationProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [localText, setLocalText] = useState(annotation.text);
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const dragStartRef = useRef<{ flowX: number; flowY: number; offsetX: number; offsetY: number } | null>(null);
  const resizeStartRef = useRef<{ startWidth: number; startPosX: number; startHandleFlowX: number } | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const resizeHandleRef = useRef<HTMLDivElement>(null);
  
  // Sync local text with annotation text when not editing
  useEffect(() => {
    if (!isEditing) {
      setLocalText(annotation.text);
    }
  }, [annotation.text, isEditing]);
  
  // Helper to convert flow coordinates to screen coordinates
  const flowToScreen = useCallback((flowX: number, flowY: number) => {
    // React Flow transform: screen = flow * zoom + viewport.offset
    return {
      x: flowX * viewport.zoom + viewport.x,
      y: flowY * viewport.zoom + viewport.y,
    };
  }, [viewport]);
  
  // Calculate screen position from flow coordinates
  const screenPos = flowToScreen(annotation.pos_x, annotation.pos_y);

  // Auto-resize textarea to fit content
  useEffect(() => {
    if (textareaRef.current && isEditing) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.max(30, textareaRef.current.scrollHeight)}px`;
    }
  }, [localText, isEditing]);

  // Focus textarea when editing starts
  useEffect(() => {
    if (isEditing && textareaRef.current) {
      textareaRef.current.focus();
      // Select all text when starting to edit
      textareaRef.current.select();
    }
  }, [isEditing]);

  // Handle text change (local only while editing)
  const handleTextChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setLocalText(e.target.value);
  }, []);

  // Save text when done editing (on blur)
  const handleBlur = useCallback(() => {
    setIsEditing(false);
    // Only update if text actually changed
    if (localText !== annotation.text) {
      onUpdate(annotation.id, { text: localText });
    }
  }, [localText, annotation.text, annotation.id, onUpdate]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    // If clicking on resize handle, don't start dragging
    if (e.target === resizeHandleRef.current || resizeHandleRef.current?.contains(e.target as Node)) {
      e.preventDefault();
      e.stopPropagation();
      onSelect(annotation.id);
      
      // Start resizing - store initial state
      const currentWidth = annotation.width || 150;
      // const mouseFlowPos = screenToFlowPosition({ x: e.clientX, y: e.clientY }); // Currently unused
      
      // Calculate where the right edge (handle) is in flow coordinates
      // Right edge is at pos_x + width/2 (since annotation is centered)
      const rightEdgeFlowX = annotation.pos_x + currentWidth / 2;
      
      resizeStartRef.current = {
        startWidth: currentWidth,
        startPosX: annotation.pos_x,
        startHandleFlowX: rightEdgeFlowX, // Where the handle was when we started
      };
      setIsResizing(true);
      return;
    }
    
    // If clicking on textarea, don't start dragging
    if (e.target === textareaRef.current || (e.target as HTMLElement).tagName === 'TEXTAREA') {
      // Select annotation but don't drag
      onSelect(annotation.id);
      return;
    }
    
    e.preventDefault();
    e.stopPropagation();
    
    // Select annotation
    onSelect(annotation.id);
    
    // Convert mouse position to flow coordinates
    const mouseFlowPos = screenToFlowPosition({ x: e.clientX, y: e.clientY });
    
    // Calculate offset from annotation center to mouse position in flow coordinates
    const offsetX = mouseFlowPos.x - annotation.pos_x;
    const offsetY = mouseFlowPos.y - annotation.pos_y;
    
    dragStartRef.current = {
      flowX: annotation.pos_x,
      flowY: annotation.pos_y,
      offsetX,
      offsetY,
    };
    setIsDragging(true);
  }, [annotation.id, annotation.pos_x, annotation.pos_y, annotation.width, onSelect, screenToFlowPosition]);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (isResizing && resizeStartRef.current) {
      e.preventDefault();
      
      // Convert current mouse position to flow coordinates
      const currentHandleFlowX = screenToFlowPosition({ x: e.clientX, y: e.clientY }).x;
      
      // The handle should follow the mouse 1:1 (not twice as fast)
      // The handle is at the right edge = pos_x + width/2
      // Start: right edge = startPosX + startWidth/2 = startHandleFlowX
      // New: right edge should be at currentHandleFlowX (where the mouse is)
      
      // Calculate the left edge position (stays fixed during resize)
      const leftEdgeFlowX = resizeStartRef.current.startPosX - resizeStartRef.current.startWidth / 2;
      
      // Calculate desired width: new right edge - left edge
      const desiredWidth = currentHandleFlowX - leftEdgeFlowX;
      const newWidth = Math.max(MIN_WIDTH, desiredWidth);
      
      // Calculate position change only if width would actually change
      // This prevents position jumps when hitting minimum width
      const actualWidthDelta = newWidth - resizeStartRef.current.startWidth;
      const isClamped = desiredWidth < MIN_WIDTH;
      
      // Prepare updates - always include width, conditionally include pos_x
      const updates: Partial<AnnotationData> = { 
        width: newWidth,
        // Explicitly preserve pos_y to prevent jumps
        pos_y: annotation.pos_y
      };
      
      // Only update pos_x if width is actually changing (not clamped to minimum)
      if (!isClamped && actualWidthDelta !== 0) {
        // Calculate new position: keep left edge fixed
        // newPosX = startPosX - startWidth/2 + newWidth/2
        const newPosX = resizeStartRef.current.startPosX - resizeStartRef.current.startWidth / 2 + newWidth / 2;
        updates.pos_x = newPosX;
      } else {
        // If width is clamped, explicitly preserve pos_x as well to prevent jumps
        updates.pos_x = annotation.pos_x;
      }
      
      onUpdate(annotation.id, updates);
      return;
    }
    
    if (isDragging && dragStartRef.current) {
      e.preventDefault();
      
      // Convert current mouse position to flow coordinates
      const currentFlowPos = screenToFlowPosition({ x: e.clientX, y: e.clientY });
      
      // Calculate new position by subtracting the offset
      const newX = currentFlowPos.x - dragStartRef.current.offsetX;
      const newY = currentFlowPos.y - dragStartRef.current.offsetY;
      
      onUpdate(annotation.id, { pos_x: newX, pos_y: newY });
    }
  }, [isDragging, isResizing, annotation.id, onUpdate, screenToFlowPosition]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
    setIsResizing(false);
    dragStartRef.current = null;
    resizeStartRef.current = null;
  }, []);

  useEffect(() => {
    if (isDragging || isResizing) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      return () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [isDragging, isResizing, handleMouseMove, handleMouseUp]);

  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setIsEditing(true);
  }, []);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setIsEditing(false);
      setLocalText(annotation.text); // Reset to original text
      textareaRef.current?.blur();
    } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      // Ctrl+Enter or Cmd+Enter to finish editing
      handleBlur();
    } else if (e.key === 'Delete' && isSelected && !isEditing) {
      // Delete key to remove annotation when selected and not editing
      onDelete(annotation.id);
    }
    e.stopPropagation();
  }, [annotation.text, annotation.id, isSelected, isEditing, handleBlur, onDelete]);

  // Calculate dimensions based on annotation data
  const width = annotation.width || 150;
  const minHeight = annotation.height || 50;

  return (
    <div
      ref={containerRef}
      className="absolute pointer-events-auto"
      style={{
        left: `${screenPos.x}px`,
        top: `${screenPos.y}px`,
        width: `${width}px`,
        minHeight: `${minHeight}px`,
        transform: 'translate(-50%, -50%)', // Center on the position point
      }}
      onMouseDown={handleMouseDown}
      onDoubleClick={handleDoubleClick}
      onKeyDown={handleKeyDown}
    >
      <div
        className={`
          relative bg-[#1a1a1e]/95 border-2 rounded-md p-2
          transition-all shadow-lg
          ${isSelected 
            ? 'border-[#06E4A8] shadow-[#06E4A8]/30' 
            : 'border-white/20 hover:border-[#06E4A8]/50'}
          ${isDragging || isResizing ? 'opacity-80' : ''}
        `}
        style={{
          width: '100%',
          minHeight: '100%',
        }}
      >
        {/* Resize handle - only visible when selected */}
        {isSelected && (
          <div
            ref={resizeHandleRef}
            className="
              absolute right-0 top-1/2 -translate-y-1/2 translate-x-1/2
              w-3 h-8 bg-[#06E4A8] rounded-full
              cursor-ew-resize hover:bg-[#04c790]
              transition-colors z-10
              shadow-lg
            "
            style={{
              touchAction: 'none',
            }}
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onSelect(annotation.id);
              
              // Store initial state for resize
              const currentWidth = annotation.width || 150;
              // const mouseFlowPos = screenToFlowPosition({ x: e.clientX, y: e.clientY }); // Currently unused
              
              // Calculate where the right edge (handle) is in flow coordinates
              const rightEdgeFlowX = annotation.pos_x + currentWidth / 2;
              
              resizeStartRef.current = {
                startWidth: currentWidth,
                startPosX: annotation.pos_x,
                startHandleFlowX: rightEdgeFlowX,
              };
              setIsResizing(true);
            }}
          />
        )}
        {isEditing ? (
          <textarea
            ref={textareaRef}
            value={localText}
            onChange={handleTextChange}
            onBlur={handleBlur}
            onKeyDown={handleKeyDown}
            className="
              w-full bg-transparent text-white text-sm
              outline-none resize-none overflow-hidden
              font-sans
            "
            style={{
              minHeight: '24px',
              fontSize: '14px',
              lineHeight: '1.5',
            }}
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            placeholder="Type your comment..."
          />
        ) : (
          <div
            className="
              text-white whitespace-pre-wrap break-words
              font-sans cursor-text select-text
            "
            style={{
              minHeight: '24px',
              fontSize: '14px',
              lineHeight: '1.5',
            }}
          >
            {annotation.text || <span className="text-gray-500 italic">Click to edit...</span>}
          </div>
        )}
      </div>
    </div>
  );
}
