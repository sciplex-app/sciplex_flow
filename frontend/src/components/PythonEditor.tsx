import { useState, useEffect, useRef, useCallback } from 'react';
import { Save, X } from 'lucide-react';

// Python syntax colors (matching desktop editor dark theme)
const SYNTAX_COLORS = {
  keyword: '#C586C0',
  string: '#CE9178',
  comment: '#6A9955',
  number: '#B5CEA8',
  function: '#DCDCAA',
  class: '#4EC9B0',
  decorator: '#DCDCAA',
  operator: '#D4D4D4',
  default: '#D4D4D4',
  background: '#1E1E1E',
  lineNumber: '#858585',
  lineNumberBg: '#1E1E1E',
  currentLine: '#2A2A2A',
  selection: '#264F78',
};

// Python keywords
const KEYWORDS = new Set([
  'and', 'as', 'assert', 'async', 'await', 'break', 'class', 'continue',
  'def', 'del', 'elif', 'else', 'except', 'finally', 'for', 'from',
  'global', 'if', 'import', 'in', 'is', 'lambda', 'nonlocal', 'not',
  'or', 'pass', 'raise', 'return', 'try', 'while', 'with', 'yield',
  'True', 'False', 'None'
]);

// Format docstring content - just return as red text (like VS Code)
function formatDocstringContent(content: string): { text: string; color: string }[] {
  // Simply return the content as red text, preserving newlines
  const lines = content.split('\n');
  const tokens: { text: string; color: string }[] = [];
  
  lines.forEach((line, lineIdx) => {
    tokens.push({ text: line, color: SYNTAX_COLORS.string });
    // Add newline (except for last line)
    if (lineIdx < lines.length - 1) {
      tokens.push({ text: '\n', color: SYNTAX_COLORS.string });
    }
  });
  
  return tokens.length > 0 ? tokens : [{ text: content, color: SYNTAX_COLORS.string }];
}

// Tokenize a line of Python code
function tokenizeLine(line: string, inDocstring: { active: boolean; quote: string } = { active: false, quote: '' }): { tokens: { text: string; color: string }[]; docstringState: { active: boolean; quote: string } } {
  const tokens: { text: string; color: string }[] = [];
  let i = 0;
  let docstringState = { ...inDocstring };
  
  while (i < line.length) {
    // If we're in a docstring, look for closing quotes
    if (docstringState.active) {
      const closingQuote = docstringState.quote;
      const end = line.indexOf(closingQuote, i);
      if (end === -1) {
        // Docstring continues to next line
        const content = line.slice(i);
        const formatted = formatDocstringContent(content);
        tokens.push(...formatted);
        return { tokens, docstringState };
      } else {
        // Docstring ends on this line
        const content = line.slice(i, end);
        const formatted = formatDocstringContent(content);
        tokens.push(...formatted);
        tokens.push({ text: closingQuote, color: SYNTAX_COLORS.string }); // Closing quotes in string color
        i = end + closingQuote.length;
        docstringState.active = false;
        docstringState.quote = '';
        continue;
      }
    }
    
    // Decorator
    if (line[i] === '@' && (i === 0 || /\s/.test(line[i - 1]))) {
      let end = i + 1;
      while (end < line.length && /[\w.]/.test(line[end])) end++;
      tokens.push({ text: line.slice(i, end), color: SYNTAX_COLORS.decorator });
      i = end;
      continue;
    }
    
    // Comment
    if (line[i] === '#') {
      tokens.push({ text: line.slice(i), color: SYNTAX_COLORS.comment });
      break;
    }
    
    // String (double quote)
    if (line[i] === '"') {
      let end = i + 1;
      // Check for triple quotes
      if (line.slice(i, i + 3) === '"""') {
        tokens.push({ text: '"""', color: SYNTAX_COLORS.string }); // Opening quotes in string color
        i += 3;
        end = line.indexOf('"""', i);
        if (end === -1) {
          // Multi-line docstring
          const content = line.slice(i);
          const formatted = formatDocstringContent(content);
          tokens.push(...formatted);
          docstringState.active = true;
          docstringState.quote = '"""';
          return { tokens, docstringState };
        } else {
          // Single-line docstring
          const content = line.slice(i, end);
          const formatted = formatDocstringContent(content);
          tokens.push(...formatted);
          tokens.push({ text: '"""', color: SYNTAX_COLORS.string }); // Closing quotes
          i = end + 3;
        }
      } else {
        while (end < line.length && (line[end] !== '"' || line[end - 1] === '\\')) end++;
        tokens.push({ text: line.slice(i, end + 1), color: SYNTAX_COLORS.string });
        i = end + 1;
      }
      continue;
    }
    
    // String (single quote)
    if (line[i] === "'") {
      let end = i + 1;
      // Check for triple quotes
      if (line.slice(i, i + 3) === "'''") {
        tokens.push({ text: "'''", color: SYNTAX_COLORS.string }); // Opening quotes in string color
        i += 3;
        end = line.indexOf("'''", i);
        if (end === -1) {
          // Multi-line docstring
          const content = line.slice(i);
          const formatted = formatDocstringContent(content);
          tokens.push(...formatted);
          docstringState.active = true;
          docstringState.quote = "'''";
          return { tokens, docstringState };
        } else {
          // Single-line docstring
          const content = line.slice(i, end);
          const formatted = formatDocstringContent(content);
          tokens.push(...formatted);
          tokens.push({ text: "'''", color: SYNTAX_COLORS.string }); // Closing quotes
          i = end + 3;
        }
      } else {
        while (end < line.length && (line[end] !== "'" || line[end - 1] === '\\')) end++;
        tokens.push({ text: line.slice(i, end + 1), color: SYNTAX_COLORS.string });
        i = end + 1;
      }
      continue;
    }
    
    // Number
    if (/\d/.test(line[i]) && (i === 0 || !/\w/.test(line[i - 1]))) {
      let end = i;
      while (end < line.length && /[\d.eE+-]/.test(line[end])) end++;
      tokens.push({ text: line.slice(i, end), color: SYNTAX_COLORS.number });
      i = end;
      continue;
    }
    
    // Word (keyword, function, class, identifier)
    if (/[a-zA-Z_]/.test(line[i])) {
      let end = i;
      while (end < line.length && /\w/.test(line[end])) end++;
      const word = line.slice(i, end);
      
      let color = SYNTAX_COLORS.default;
      if (KEYWORDS.has(word)) {
        color = SYNTAX_COLORS.keyword;
      } else if (line.slice(end).match(/^\s*\(/)) {
        // Function call
        color = SYNTAX_COLORS.function;
      }
      
      tokens.push({ text: word, color });
      i = end;
      continue;
    }
    
    // Operator or other
    tokens.push({ text: line[i], color: SYNTAX_COLORS.default });
    i++;
  }
  
  return { tokens, docstringState };
}

interface PythonEditorProps {
  code: string;
  onChange: (code: string) => void;
  onSave: () => void;
  onClose: () => void;
  saving?: boolean;
  title?: string;
  readOnly?: boolean;
  saveLabel?: string;  // Custom label for save button (default: "Save & Reload")
  warnings?: string[];  // Warnings to display
  error?: string | null;  // Error message to display (e.g., syntax errors on save)
}

export default function PythonEditor({
  code,
  onChange,
  onSave,
  onClose,
  saving = false,
  title = 'Python Editor',
  readOnly = false,
  saveLabel = 'Save & Reload',
  warnings,
  error,
}: PythonEditorProps) {
  const [lines, setLines] = useState<string[]>([]);
  const [cursorLine, setCursorLine] = useState(0);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const highlightRef = useRef<HTMLDivElement>(null);
  const lineNumbersRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setLines(code.split('\n'));
  }, [code]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newCode = e.target.value;
    onChange(newCode);
    setLines(newCode.split('\n'));
  }, [onChange]);

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    // Scroll container drives layout; keep line numbers vertically in sync.
    if (lineNumbersRef.current) {
      lineNumbersRef.current.scrollTop = e.currentTarget.scrollTop;
    }
  }, []);

  const handleCursorChange = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    // Update current line for highlighting
    const pos = textarea.selectionStart;
    const textBefore = code.slice(0, pos);
    const lineNum = textBefore.split('\n').length - 1;
    setCursorLine(lineNum);
  }, [code]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const textarea = textareaRef.current;
      if (!textarea) return;
      
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const newValue = code.slice(0, start) + '    ' + code.slice(end);
      onChange(newValue);
      
      // Set cursor position after the tab
      setTimeout(() => {
        if (!textareaRef.current) return;
        textareaRef.current.selectionStart = textareaRef.current.selectionEnd = start + 4;
        handleCursorChange();
      }, 0);
    }
    
    if (e.key === 'Enter') {
      const textarea = textareaRef.current;
      if (!textarea) return;
      
      const start = textarea.selectionStart;
      const textBefore = code.slice(0, start);
      const lines = textBefore.split('\n');
      const currentLine = lines[lines.length - 1];
      
      // Calculate indentation of current line
      const indentMatch = currentLine.match(/^(\s*)/);
      const currentIndent = indentMatch ? indentMatch[1] : '';
      
      // Check if line ends with colon (allowing for trailing whitespace)
      const trimmedLine = currentLine.trimEnd();
      if (trimmedLine.endsWith(':')) {
        e.preventDefault();
        // Add newline with 4 more spaces of indentation
        const newIndent = currentIndent + '    ';
        const newValue = code.slice(0, start) + '\n' + newIndent + code.slice(start);
        onChange(newValue);
        
        // Set cursor position after the indentation
        setTimeout(() => {
          if (!textareaRef.current) return;
          const newPos = start + 1 + newIndent.length;
          textareaRef.current.selectionStart = textareaRef.current.selectionEnd = newPos;
          handleCursorChange();
        }, 0);
      }
    }
    
    // Ensure scrolling stays in sync when navigating with the keyboard
    // (especially Arrow keys on long lines).
    if (
      e.key === 'ArrowLeft' ||
      e.key === 'ArrowRight' ||
      e.key === 'ArrowUp' ||
      e.key === 'ArrowDown' ||
      e.key === 'Home' ||
      e.key === 'End'
    ) {
      // Let the browser move the caret first, then sync scroll + cursor line.
      setTimeout(() => {
        handleCursorChange();
      }, 0);
    }
    
    if (e.key === 's' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      onSave();
    }
  }, [code, onChange, onSave, handleCursorChange]);

  return (
    <div 
      className="fixed inset-0 bg-black/80 flex items-center justify-center z-[100] p-8"
      onClick={(e) => {
        // Close when clicking the backdrop
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div 
        className="w-full max-w-6xl h-full max-h-[90vh] bg-[#1E1E1E] rounded-xl border border-white/10 flex flex-col overflow-hidden shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 bg-[#252526] border-b border-white/10">
          <div className="flex items-center gap-3">
            <span className="text-gray-300 font-medium">{title}</span>
          </div>
          <div className="flex items-center gap-2">
            {!readOnly && (
              <button
                onClick={onSave}
                disabled={saving}
                className="flex items-center gap-2 px-4 py-1.5 bg-[#06E4A8] text-black rounded-md text-sm font-medium hover:bg-[#04c790] transition-colors disabled:opacity-50"
              >
                <Save className="w-4 h-4" />
                {saving ? 'Saving...' : saveLabel}
              </button>
            )}
            <button
              onClick={onClose}
              className="p-2 text-gray-400 hover:text-white transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Editor */}
        <div className="flex-1 relative flex overflow-hidden">
          {/* Line numbers */}
          <div
            ref={lineNumbersRef}
            className="w-14 flex-shrink-0 overflow-hidden select-none"
            style={{ backgroundColor: SYNTAX_COLORS.lineNumberBg }}
          >
            <div className="py-2 px-2 text-right font-mono text-sm">
              {lines.map((_, i) => (
                <div
                  key={i}
                  className="h-6 leading-6"
                  style={{
                    color: SYNTAX_COLORS.lineNumber,
                    backgroundColor: cursorLine === i ? SYNTAX_COLORS.currentLine : 'transparent',
                  }}
                >
                  {i + 1}
                </div>
              ))}
            </div>
          </div>

          {/* Code area */}
          <div
            ref={scrollContainerRef}
            className="flex-1 overflow-auto"
            onScroll={handleScroll}
          >
            <div
              className="relative min-w-max"
              style={{ backgroundColor: SYNTAX_COLORS.background }}
            >
              {/* Syntax highlighted overlay (visual layer) */}
              <div
                ref={highlightRef}
                className="py-2 px-4 font-mono text-sm whitespace-pre"
              >
                {(() => {
                  let docstringState = { active: false, quote: '' };
                  return lines.map((line, i) => {
                    const result = tokenizeLine(line, docstringState);
                    docstringState = result.docstringState;
                    return (
                      <div
                        key={i}
                        className="h-6 leading-6"
                        style={{
                          backgroundColor: cursorLine === i ? SYNTAX_COLORS.currentLine : 'transparent',
                        }}
                      >
                        {result.tokens.map((token, j) => (
                          <span key={j} style={{ color: token.color }}>
                            {token.text}
                          </span>
                        ))}
                        {line === '' && '\u00A0'}
                      </div>
                    );
                  });
                })()}
              </div>

              {/* Actual textarea (invisible but captures input) */}
              <textarea
                ref={textareaRef}
                value={code}
                onChange={handleChange}
                onKeyDown={handleKeyDown}
                onKeyUp={handleCursorChange}
                onClick={handleCursorChange}
                readOnly={readOnly}
                className="absolute inset-0 w-full h-full resize-none py-2 px-4 font-mono text-sm leading-6 bg-transparent text-transparent caret-white outline-none whitespace-pre"
                style={{
                  caretColor: 'white',
                  whiteSpace: 'pre',        // keep logical lines intact; no soft-wrap
                  // Scrolling is controlled by the outer container; textarea just sits inside.
                  overflow: 'hidden',
                  wordBreak: 'normal',
                  overflowWrap: 'normal',
                }}
                // Disable soft wrapping so long lines scroll horizontally instead of wrapping.
                // This keeps the textarea's logical lines in sync with the syntax-highlighted overlay,
                // and prevents issues with selection and Home/End behavior on long lines.
                wrap="off"
                spellCheck={false}
                autoCapitalize="off"
                autoCorrect="off"
              />
            </div>
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="px-4 py-3 bg-red-500/20 border-t border-red-500/50">
            <div className="text-sm text-red-400">
              <div className="font-semibold mb-1">❌ Error:</div>
              <pre className="ml-2 whitespace-pre-wrap font-mono text-xs">{error}</pre>
            </div>
          </div>
        )}

        {/* Warnings */}
        {warnings && warnings.length > 0 && (
          <div className="px-4 py-2 bg-yellow-500/20 border-t border-yellow-500/50">
            <div className="text-xs text-yellow-400">
              <div className="font-semibold mb-1">Warnings:</div>
              {warnings.map((warning, i) => (
                <div key={i} className="ml-2">• {warning}</div>
              ))}
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between px-4 py-2 bg-[#252526] border-t border-white/10 text-xs text-gray-500">
          <span>Line {cursorLine + 1}, {lines.length} lines</span>
          <span>Python • UTF-8</span>
        </div>
      </div>
    </div>
  );
}

