import { useState } from 'react';
import PythonEditor from './PythonEditor';

const SCRIPT_DEFAULT_CODE = `def my_function(data):
    """
    Write your function here. Use type hints:

    def process(df: pd.DataFrame, n: int = 10) -> pd.DataFrame:
        return df.head(n)

    - Parameters with defaults → editable widgets
    - Parameters without defaults → input sockets
    - Return type → output socket(s)

    Workspace variables:
        workspace["a"] = 2
        xs = np.arange(0, 1, 0.1)
        workspace["xs"] = xs
        ys = workspace["xs"]

    Available: np, pd, plt, sklearn, workspace
    """
    return data
`;

interface ScriptEditorDialogProps {
  onBuild: (code: string) => void;
  onCancel: () => void;
  initialCode?: string;
}

export default function ScriptEditorDialog({ onBuild, onCancel, initialCode }: ScriptEditorDialogProps) {
  // Use initialCode if provided and not empty, otherwise use default
  const initialCodeValue = initialCode && initialCode.trim() ? initialCode : SCRIPT_DEFAULT_CODE;
  const [code, setCode] = useState(initialCodeValue);
  const [building, setBuilding] = useState(false);

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

