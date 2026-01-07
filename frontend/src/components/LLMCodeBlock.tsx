import { useState } from 'react';
import { Copy, Edit, Workflow } from 'lucide-react';

interface CodeBlockProps {
  code: string;
  language?: string;
  onEdit?: (code: string) => void;
  onPaste?: (code: string) => void;
}

export default function CodeBlockWidget({ code, language = 'python', onEdit, onPaste }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error('Failed to copy code:', error);
    }
  };

  const handleEdit = () => {
    if (onEdit) {
      onEdit(code);
    }
  };

  const handlePaste = () => {
    if (onPaste) {
      onPaste(code);
    }
  };

  // Apply Python syntax highlighting (simplified)
  const highlightCode = (code: string): string => {
    // Escape HTML first
    let html = code
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    // Split into tokens using a simple approach: protect strings and comments first
    const tokens: Array<{ type: 'string' | 'comment' | 'code'; content: string }> = [];

    // Extract strings and comments first
    const stringPattern = /(['"])(?:(?=(\\?))\2.)*?\1/g;
    const commentPattern = /#.*?(?=\n|$)/g;
    const allMatches: Array<{ index: number; length: number; type: 'string' | 'comment'; content: string }> = [];

    let match;
    while ((match = stringPattern.exec(html)) !== null) {
      allMatches.push({
        index: match.index,
        length: match[0].length,
        type: 'string',
        content: match[0]
      });
    }
    while ((match = commentPattern.exec(html)) !== null) {
      allMatches.push({
        index: match.index,
        length: match[0].length,
        type: 'comment',
        content: match[0]
      });
    }

    // Sort by index
    allMatches.sort((a, b) => a.index - b.index);

    // Build tokens
    let currentIndex = 0;
    for (const m of allMatches) {
      if (m.index > currentIndex) {
        tokens.push({ type: 'code', content: html.substring(currentIndex, m.index) });
      }
      tokens.push({ type: m.type, content: m.content });
      currentIndex = m.index + m.length;
    }
    if (currentIndex < html.length) {
      tokens.push({ type: 'code', content: html.substring(currentIndex) });
    }

    if (tokens.length === 0) {
      tokens.push({ type: 'code', content: html });
    }

    // Now process each token
    const processedTokens = tokens.map(token => {
      if (token.type === 'string') {
        return `<span class="text-[#CE9178]">${token.content}</span>`;
      } else if (token.type === 'comment') {
        return `<span class="text-[#6A9955] italic">${token.content}</span>`;
      } else {
        // Process code token
        let codeHtml = token.content;

        // Functions (def function_name)
        codeHtml = codeHtml.replace(/\bdef\s+(\w+)/g, '<span class="text-[#569CD6] font-bold">def</span> <span class="text-[#DCDCAA] font-bold">$1</span>');

        // Classes (class ClassName)
        codeHtml = codeHtml.replace(/\bclass\s+(\w+)/g, '<span class="text-[#569CD6] font-bold">class</span> <span class="text-[#4EC9B0] font-bold">$1</span>');

        // Keywords (excluding def/class)
        const keywords = [
          'and', 'as', 'assert', 'break', 'continue', 'del', 'elif', 'else',
          'except', 'exec', 'finally', 'for', 'from', 'global', 'if', 'import', 'in', 'is',
          'lambda', 'not', 'or', 'pass', 'print', 'raise', 'return', 'try', 'while', 'with',
          'yield', 'True', 'False', 'None'
        ];

        keywords.forEach(keyword => {
          const regex = new RegExp(`\\b${keyword}\\b`, 'g');
          codeHtml = codeHtml.replace(regex, `<span class="text-[#569CD6] font-bold">${keyword}</span>`);
        });

        // Numbers
        codeHtml = codeHtml.replace(/\b(\d+\.?\d*)\b/g, '<span class="text-[#B5CEA8]">$1</span>');

        return codeHtml;
      }
    });

    html = processedTokens.join('');

    // Preserve newlines and indentation
    html = html.replace(/\n/g, '<br>');
    html = html.replace(/\t/g, '&nbsp;&nbsp;&nbsp;&nbsp;');
    
    return html;
  };

  const highlightedCode = language === 'python' ? highlightCode(code) : code;

  return (
    <div className="bg-[#2d2d2d] border border-white/20 rounded-lg overflow-hidden">
      {/* Header */}
      <div className="bg-[#1a1a1a] border-b border-white/20 px-3 py-1 flex items-center justify-end gap-2">
        <button
          onClick={handleCopy}
          className="p-1 text-gray-400 hover:text-white transition-colors"
          title="Copy code"
        >
          {copied ? <span className="text-[#06E4A8] text-xs">✓</span> : <Copy className="w-4 h-4" />}
        </button>
        {onEdit && (
          <button
            onClick={handleEdit}
            className="p-1 text-gray-400 hover:text-white transition-colors"
            title="Edit in editor"
          >
            <Edit className="w-4 h-4" />
          </button>
        )}
        {onPaste && (
          <button
            onClick={handlePaste}
            className="p-1 text-gray-400 hover:text-white transition-colors"
            title="Paste to workflow"
          >
            <Workflow className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Code content */}
      <div className="p-4 font-mono text-sm">
        <pre
          className="whitespace-pre-wrap"
          dangerouslySetInnerHTML={{ __html: highlightedCode }}
        />
      </div>
    </div>
  );
}

