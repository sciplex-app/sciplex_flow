import { useEffect, useState } from 'react';
import PythonEditor from './PythonEditor';
import { API_BASE } from '../api/constants';

interface ScriptEditorDialogProps {
  onBuild: (code: string) => void;
  onCancel: () => void;
  initialCode?: string;
}

export default function ScriptEditorDialog({ onBuild, onCancel, initialCode }: ScriptEditorDialogProps) {
  const [code, setCode] = useState(() => (initialCode && initialCode.trim() ? initialCode : ''));
  const [building, setBuilding] = useState(false);
  const [defaultCode, setDefaultCode] = useState('');

  useEffect(() => {
    if (initialCode && initialCode.trim()) {
      return;
    }

    let cancelled = false;
    fetch(`${API_BASE}/script/default-code`)
      .then((response) => response.json())
      .then((data) => {
        if (!cancelled && data?.code) {
          setDefaultCode(data.code);
          setCode(data.code);
        }
      })
      .catch(() => {
        // Ignore failures; leave code blank
      });

    return () => {
      cancelled = true;
    };
  }, [initialCode]);

  const handleBuild = async () => {
    if (!code.trim()) {
      return;
    }
    setBuilding(true);
    try {
      await onBuild(code);
    } finally {
      setBuilding(false);
    }
  };

  return (
    <PythonEditor
      code={code}
      onChange={setCode}
      onSave={handleBuild}
      onClose={onCancel}
      saving={building}
      title="Script Node Editor"
      readOnly={false}
      saveLabel="Build"
    />
  );
}

