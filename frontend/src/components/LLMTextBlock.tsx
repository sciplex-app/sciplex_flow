interface TextBlockProps {
  text: string;
}

export default function TextBlockWidget({ text }: TextBlockProps) {
  // Convert markdown to HTML
  const markdownToHtml = (text: string): string => {
    if (!text) return '';

    // Escape HTML first
    let html = text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    // Bold: **text** or __text__
    html = html.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
    html = html.replace(/__(.+?)__/g, '<b>$1</b>');

    // Italic: *text* or _text_ (but not inside words)
    html = html.replace(/(?<!\w)\*([^*]+?)\*(?!\w)/g, '<i>$1</i>');
    html = html.replace(/(?<!\w)_([^_]+?)_(?!\w)/g, '<i>$1</i>');

    // Bullet points: lines starting with - or *
    const lines = html.split('\n');
    const result: string[] = [];
    let inList = false;
    let listType: 'ul' | 'ol' | null = null;

    for (const line of lines) {
      const stripped = line.trim();
      
      if (stripped.match(/^[-*]\s/)) {
        if (!inList || listType !== 'ul') {
          if (inList && listType === 'ol') {
            result.push('</ol>');
          }
          result.push('<ul style="margin: 4px 0; padding-left: 20px;">');
          inList = true;
          listType = 'ul';
        }
        const itemText = stripped.substring(2);
        result.push(`<li style="margin: 2px 0;">${itemText}</li>`);
      } else if (stripped.match(/^\d+\.\s/)) {
        if (!inList || listType !== 'ol') {
          if (inList && listType === 'ul') {
            result.push('</ul>');
          }
          result.push('<ol style="margin: 4px 0; padding-left: 20px;">');
          inList = true;
          listType = 'ol';
        }
        const itemText = stripped.split(/^\d+\.\s/, 2)[1] || stripped;
        result.push(`<li style="margin: 2px 0;">${itemText}</li>`);
      } else {
        if (inList) {
          result.push(listType === 'ul' ? '</ul>' : '</ol>');
          inList = false;
          listType = null;
        }
        if (stripped) {
          result.push(`<p style="margin: 4px 0;">${line}</p>`);
        } else {
          result.push('<br>');
        }
      }
    }

    if (inList) {
      result.push(listType === 'ul' ? '</ul>' : '</ol>');
    }

    return result.join('');
  };

  const htmlContent = markdownToHtml(text);

  return (
    <div
      className="text-sm leading-relaxed"
      dangerouslySetInnerHTML={{ __html: htmlContent }}
    />
  );
}

