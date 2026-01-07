import { useState, useEffect } from 'react';

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
  const lines = content.split('\n');
  const tokens: { text: string; color: string }[] = [];
  
  lines.forEach((line, lineIdx) => {
    tokens.push({ text: line, color: SYNTAX_COLORS.string });
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
        const content = line.slice(i);
        const formatted = formatDocstringContent(content);
        tokens.push(...formatted);
        return { tokens, docstringState };
      } else {
        const content = line.slice(i, end);
        const formatted = formatDocstringContent(content);
        tokens.push(...formatted);
        tokens.push({ text: closingQuote, color: SYNTAX_COLORS.string });
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
      if (line.slice(i, i + 3) === '"""') {
        tokens.push({ text: '"""', color: SYNTAX_COLORS.string });
        i += 3;
        end = line.indexOf('"""', i);
        if (end === -1) {
          docstringState.active = true;
          docstringState.quote = '"""';
          const content = line.slice(i);
          const formatted = formatDocstringContent(content);
          tokens.push(...formatted);
          return { tokens, docstringState };
        } else {
          const content = line.slice(i, end);
          const formatted = formatDocstringContent(content);
          tokens.push(...formatted);
          tokens.push({ text: '"""', color: SYNTAX_COLORS.string });
          i = end + 3;
          continue;
        }
      } else {
        while (end < line.length && line[end] !== '"') {
          if (line[end] === '\\') end += 2;
          else end++;
        }
        if (end < line.length) end++;
        tokens.push({ text: line.slice(i, end), color: SYNTAX_COLORS.string });
        i = end;
        continue;
      }
    }
    
    // String (single quote)
    if (line[i] === "'") {
      let end = i + 1;
      if (line.slice(i, i + 3) === "'''") {
        tokens.push({ text: "'''", color: SYNTAX_COLORS.string });
        i += 3;
        end = line.indexOf("'''", i);
        if (end === -1) {
          docstringState.active = true;
          docstringState.quote = "'''";
          const content = line.slice(i);
          const formatted = formatDocstringContent(content);
          tokens.push(...formatted);
          return { tokens, docstringState };
        } else {
          const content = line.slice(i, end);
          const formatted = formatDocstringContent(content);
          tokens.push(...formatted);
          tokens.push({ text: "'''", color: SYNTAX_COLORS.string });
          i = end + 3;
          continue;
        }
      } else {
        while (end < line.length && line[end] !== "'") {
          if (line[end] === '\\') end += 2;
          else end++;
        }
        if (end < line.length) end++;
        tokens.push({ text: line.slice(i, end), color: SYNTAX_COLORS.string });
        i = end;
        continue;
      }
    }
    
    // Number
    if (/\d/.test(line[i])) {
      let end = i;
      while (end < line.length && /[\d.eE+-]/.test(line[end])) end++;
      tokens.push({ text: line.slice(i, end), color: SYNTAX_COLORS.number });
      i = end;
      continue;
    }
    
    // Identifier or keyword
    if (/[a-zA-Z_]/.test(line[i])) {
      let end = i;
      while (end < line.length && /[a-zA-Z0-9_]/.test(line[end])) end++;
      const word = line.slice(i, end);
      if (KEYWORDS.has(word)) {
        tokens.push({ text: word, color: SYNTAX_COLORS.keyword });
      } else if (i > 0 && line[i - 1] === '.' && end < line.length && line[end] === '(') {
        tokens.push({ text: word, color: SYNTAX_COLORS.function });
      } else if (end < line.length && line[end] === '(') {
        tokens.push({ text: word, color: SYNTAX_COLORS.function });
      } else {
        tokens.push({ text: word, color: SYNTAX_COLORS.default });
      }
      i = end;
      continue;
    }
    
    // Default: single character
    tokens.push({ text: line[i], color: SYNTAX_COLORS.default });
    i++;
  }
  
  return { tokens, docstringState };
}

interface CodeViewerProps {
  code: string;
}

export default function CodeViewer({ code }: CodeViewerProps) {
  const [lines, setLines] = useState<string[]>([]);

  useEffect(() => {
    setLines(code.split('\n'));
  }, [code]);

  return (
    <div className="w-full h-full flex overflow-hidden" style={{ backgroundColor: SYNTAX_COLORS.background }}>
      {/* Line numbers */}
      <div
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
              }}
            >
              {i + 1}
            </div>
          ))}
        </div>
      </div>

      {/* Code area */}
      <div className="flex-1 relative overflow-auto">
        <div
          className="py-2 px-4 font-mono text-sm whitespace-pre"
          style={{ backgroundColor: SYNTAX_COLORS.background }}
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
      </div>
    </div>
  );
}

